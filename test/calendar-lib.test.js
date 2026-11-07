// node --test test/calendar-lib.test.js
const test = require('node:test');
const assert = require('node:assert');
const C = require('../calendar-lib');

const MIN = 60000;
const at = (hhmm) => new Date(`2026-11-07T${hhmm}`).getTime();
const evt = (over) => ({ id: 'e', date: '2026-11-07', time: '14:00', reminder: 15, ...over });
const keys = (stages) => stages.map((s) => s.key);

test('the stages follow what the event asked for', () => {
  assert.deepStrictEqual(keys(C.reminderStages(evt({ reminder: 15 }))), ['15m', '10m', '0m']);
  assert.deepStrictEqual(keys(C.reminderStages(evt({ reminder: 60 }))), ['60m', '10m', '0m']);
  assert.deepStrictEqual(keys(C.reminderStages(evt({ reminder: 5 }))), ['5m', '0m']);
  assert.deepStrictEqual(keys(C.reminderStages(evt({ reminder: 0 }))), ['0m']);
  assert.deepStrictEqual(C.reminderStages(evt({ reminder: null })), []);
  assert.deepStrictEqual(C.reminderStages(evt({ reminder: undefined })), []);
  assert.deepStrictEqual(keys(C.reminderStages(evt({ reminder: true }))), ['15m', '10m', '0m']);
  assert.strictEqual(C.reminderStages(evt({ reminder: 60 }))[0].body, 'In 1 hour');
});

test('an all-day event gets one morning note and is never overdue', () => {
  const allDay = evt({ time: null });
  assert.deepStrictEqual(keys(C.reminderStages(allDay)), ['allday']);
  assert.strictEqual(C.planReminders(allDay, at('09:10'), new Set()).overdue, false);
  assert.strictEqual(C.planReminders(allDay, at('08:00'), new Set()).later[0].delay, 60 * MIN);
});

test('a reminder set to none plans nothing at all', () => {
  const plan = C.planReminders(evt({ reminder: null }), at('14:06'), new Set());
  assert.deepStrictEqual(plan, { fireNow: null, later: [], forget: [], overdue: false });
});

test('future stages get timers, and only within the next day', () => {
  const plan = C.planReminders(evt(), at('13:00'), new Set());
  assert.deepStrictEqual(plan.later.map((l) => l.delay), [45 * MIN, 50 * MIN, 60 * MIN]);
  assert.strictEqual(plan.fireNow, null);
  const far = C.planReminders(evt({ date: '2026-11-20' }), at('13:00'), new Set());
  assert.deepStrictEqual(far.later, []);
});

test('waking up after several stages fires only the latest and forgets the rest', () => {
  const plan = C.planReminders(evt(), at('14:03'), new Set());
  assert.strictEqual(plan.fireNow.key, '0m');
  assert.deepStrictEqual(plan.forget, ['15m', '10m']);
  const mid = C.planReminders(evt(), at('13:52'), new Set());
  assert.strictEqual(mid.fireNow.key, '10m');
  assert.deepStrictEqual(mid.forget, ['15m']);
  assert.deepStrictEqual(mid.later.map((l) => l.stage.key), ['0m']);
});

test('stages already fired stay quiet, and long-missed ones are dropped', () => {
  assert.strictEqual(C.planReminders(evt(), at('14:03'), new Set(['15m', '10m', '0m'])).fireNow, null);
  const late = C.planReminders(evt(), at('15:00'), new Set());
  assert.strictEqual(late.fireNow, null);
  assert.deepStrictEqual(late.forget, ['15m', '10m', '0m']);
});

test('overdue comes 5 minutes after the start, for an hour, once, and not when done', () => {
  assert.strictEqual(C.planReminders(evt(), at('14:04'), new Set()).overdue, false);
  assert.strictEqual(C.planReminders(evt(), at('14:06'), new Set()).overdue, true);
  assert.strictEqual(C.planReminders(evt(), at('15:01'), new Set()).overdue, false);
  assert.strictEqual(C.planReminders(evt(), at('14:06'), new Set(['overdue'])).overdue, false);
  assert.strictEqual(C.planReminders(evt({ done: true }), at('14:06'), new Set()).overdue, false);
  assert.strictEqual(C.planReminders(evt({ time: '25:99' }), at('14:06'), new Set()).overdue, false);
});

test('daily, weekly and fortnightly dates, from a given day up to a limit', () => {
  assert.deepStrictEqual(C.occurrences('2026-11-07', 'daily', '2026-11-07', '2026-11-09'), ['2026-11-08', '2026-11-09']);
  assert.deepStrictEqual(C.occurrences('2026-11-07', 'weekly', '2026-11-20', '2026-12-05'), ['2026-11-21', '2026-11-28', '2026-12-05']);
  assert.deepStrictEqual(C.occurrences('2026-11-07', 'biweekly', '2026-11-08', '2026-12-05'), ['2026-11-21', '2026-12-05']);
});

test('weekly dates stay right across a clock change', () => {
  assert.deepStrictEqual(C.occurrences('2026-10-18', 'weekly', '2026-10-19', '2026-11-01'), ['2026-10-25', '2026-11-01']);
});

test('monthly dates never drift, even from the 31st', () => {
  assert.deepStrictEqual(
    C.occurrences('2027-01-31', 'monthly', '2027-02-01', '2027-05-31'),
    ['2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31'],
  );
  assert.deepStrictEqual(C.occurrences('2026-11-07', 'monthly', '2026-11-08', '2027-02-07'), ['2026-12-07', '2027-01-07', '2027-02-07']);
});

test('a Google event with a time keeps its local date, time and length', () => {
  const [one] = C.mapGoogleItem({ id: 'x', summary: 'Call', start: { dateTime: '2026-11-07T14:00:00' }, end: { dateTime: '2026-11-07T14:45:00' }, htmlLink: 'https://l' }, 'a@b');
  assert.strictEqual(one.id, 'gcal:a@b:x');
  assert.strictEqual(one.date, '2026-11-07');
  assert.strictEqual(one.time, '14:00');
  assert.strictEqual(one.duration, 45);
  assert.strictEqual(one.reminder, 15);
  assert.strictEqual(one.isGoogleEvent, true);
});

test('an all-day Google event shows on every day it covers, with stable ids', () => {
  const days = C.mapGoogleItem({ id: 'x', start: { date: '2026-11-07' }, end: { date: '2026-11-10' } }, 'a@b');
  assert.deepStrictEqual(days.map((d) => d.date), ['2026-11-07', '2026-11-08', '2026-11-09']);
  assert.deepStrictEqual(days.map((d) => d.id), ['gcal:a@b:x', 'gcal:a@b:x:2026-11-08', 'gcal:a@b:x:2026-11-09']);
  assert.strictEqual(C.mapGoogleItem({ id: 'y', start: { date: '2026-11-07' }, end: { date: '2026-11-08' } }, 'a@b').length, 1);
  assert.strictEqual(C.mapGoogleItem({ id: 'z', start: { date: '2026-11-07' } }, 'a@b').length, 1);
  assert.strictEqual(C.mapGoogleItem({ id: 'long', start: { date: '2026-01-01' }, end: { date: '2027-01-01' } }, 'a@b').length, 31);
});

test('an invite you declined, or a cancelled event, is left out', () => {
  const item = { id: 'x', start: { date: '2026-11-07' }, attendees: [{ self: true, responseStatus: 'declined' }] };
  assert.deepStrictEqual(C.mapGoogleItem(item, 'a'), []);
  item.attendees = [{ self: true, responseStatus: 'accepted' }, { responseStatus: 'declined' }];
  assert.strictEqual(C.mapGoogleItem(item, 'a').length, 1);
  assert.deepStrictEqual(C.mapGoogleItem({ id: 'x', status: 'cancelled', start: { date: '2026-11-07' } }, 'a'), []);
  assert.deepStrictEqual(C.mapGoogleItem({ id: 'x' }, 'a'), []);
});

test('meeting links: Meet, then a video entry, then a known address in the text', () => {
  assert.strictEqual(C.extractMeetLink({ hangoutLink: 'https://meet.google.com/a' }), 'https://meet.google.com/a');
  assert.strictEqual(C.extractMeetLink({ conferenceData: { entryPoints: [{ entryPointType: 'phone', uri: 'tel:1' }, { entryPointType: 'video', uri: 'https://v' }] } }), 'https://v');
  assert.strictEqual(C.extractMeetLink({ description: 'Join https://acme.zoom.us/j/1 now' }), 'https://acme.zoom.us/j/1');
  assert.strictEqual(C.extractMeetLink({ location: 'https://evil.example/x' }), null);
});

test('a provider named only in the path is no meeting link', () => {
  assert.strictEqual(C.extractMeetLink({ location: 'https://evil.example/zoom.us/j/1' }), null);
  assert.strictEqual(C.extractMeetLink({ location: 'https://zoom.us.evil.example/j/1' }), null);
  assert.strictEqual(C.extractMeetLink({ description: 'First https://evil.example/x then https://meet.google.com/abc' }), 'https://meet.google.com/abc');
});

test('a waiting reminder stops being worth showing once its moment has gone', () => {
  assert.strictEqual(C.stillCurrent(evt(), at('14:20')), true);
  assert.strictEqual(C.stillCurrent(evt(), at('14:31')), false);
  assert.strictEqual(C.stillCurrent(evt({ done: true }), at('14:00')), false);
});

test('events from older versions: future ones without a reminder keep getting one', () => {
  const events = [
    { id: 'p', date: '2026-11-20', reminder: null },
    { id: 'o', date: '2026-11-01', reminder: null },
    { id: 'g', date: '2026-11-20', reminder: null, isGoogleEvent: true },
    { id: 'n', date: '2026-11-20', reminder: 60 },
  ];
  C.migrateEvents(events, '2026-11-07');
  assert.deepStrictEqual(events.map((e) => e.reminder), [15, null, null, 60]);
});

test('series from older versions: gaps stay gaps, and long-finished ones stay finished', () => {
  const parent = { id: 'w', date: '2026-10-05', recurrence: 'weekly', reminder: 15 };
  const instance = (date) => ({ id: date, date, recurringParentId: 'w' });
  const old = { id: 'x', date: '2025-01-06', recurrence: 'weekly', reminder: 15 };
  const events = [parent, instance('2026-10-12'), instance('2026-10-26'), old, { id: 'y', date: '2025-01-13', recurringParentId: 'x' }];
  C.migrateEvents(events, '2026-11-07');
  assert.deepStrictEqual(parent.skipDates, ['2026-10-19']);
  assert.strictEqual(parent.ended, undefined);
  assert.strictEqual(old.ended, true);
});

test('a failed sync keeps that account\'s events, and done marks survive a sync', () => {
  const local = { id: 'l' };
  const failing = { id: 'gcal:bad:1', isGoogleEvent: true, googleAccount: 'bad' };
  const stale = { id: 'gcal:good:1', isGoogleEvent: true, googleAccount: 'good', done: true };
  const gone = { id: 'gcal:good:2', isGoogleEvent: true, googleAccount: 'good' };
  const fresh = [{ id: 'gcal:good:1', isGoogleEvent: true, googleAccount: 'good' }, { id: 'gcal:good:3', isGoogleEvent: true, googleAccount: 'good' }];
  const merged = C.mergeGoogleEvents([local, failing, stale, gone], fresh, ['bad']);
  assert.deepStrictEqual(merged.map((e) => e.id), ['l', 'gcal:bad:1', 'gcal:good:1', 'gcal:good:3']);
  assert.strictEqual(merged[2].done, true);
  assert.strictEqual(merged[3].done, undefined);
});
