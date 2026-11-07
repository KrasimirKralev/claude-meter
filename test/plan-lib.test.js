// node --test test/plan-lib.test.js
const test = require('node:test');
const assert = require('node:assert');
const P = require('../plan-lib');

const NOW = new Date('2026-11-07T15:00:00').getTime();

test('weeks start on Monday, across months and on a Sunday', () => {
  assert.strictEqual(P.weekStart('2026-11-07'), '2026-11-02');
  assert.strictEqual(P.weekStart('2026-11-08'), '2026-11-02');
  assert.strictEqual(P.weekStart('2026-11-02'), '2026-11-02');
  assert.strictEqual(P.weekStart('2026-11-01'), '2026-10-26');
  assert.deepStrictEqual(P.weekDays('2026-12-31'), ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']);
  assert.strictEqual(P.weekLabel('2026-11-01'), 'Oct 26 – Nov 1');
});

test('adding days is right across a clock change', () => {
  assert.strictEqual(P.addDays('2026-10-24', 1), '2026-10-25');
  assert.strictEqual(P.addDays('2026-10-25', 1), '2026-10-26');
  assert.strictEqual(P.addDays('2026-03-28', 2), '2026-03-30');
});

test('a month grid is whole weeks, starting Monday, and marks the days around it', () => {
  const nov = P.monthGrid(2026, 10);
  assert.strictEqual(nov.length % 7, 0);
  assert.strictEqual(nov[0].date, '2026-10-26');
  assert.strictEqual(nov[0].inMonth, false);
  assert.strictEqual(nov[6].date, '2026-11-01');
  assert.strictEqual(nov[6].inMonth, true);
  assert.strictEqual(nov.at(-1).date, '2026-12-06');
  // February 2027 starts on a Monday and has exactly four weeks.
  const feb = P.monthGrid(2027, 1);
  assert.strictEqual(feb.length, 28);
  assert.strictEqual(feb[0].date, '2027-02-01');
  // December's grid ends in the new year.
  const dec = P.monthGrid(2026, 11);
  assert.strictEqual(dec.at(-1).date, '2027-01-03');
});

test('day checks refuse nonsense', () => {
  assert.strictEqual(P.isValidDay('2026-11-07'), true);
  for (const bad of ['2026-02-30', '2026-13-01', 'soon', '', null, undefined, 5]) assert.strictEqual(P.isValidDay(bad), false);
});

test('events: done last, then all day, then by time', () => {
  const sorted = P.sortEvents([
    { id: 'late', time: '17:00' },
    { id: 'done', time: '08:00', done: true },
    { id: 'early', time: '09:00' },
    { id: 'allday', time: null },
  ]).map((e) => e.id);
  assert.deepStrictEqual(sorted, ['allday', 'early', 'late', 'done']);
});

test('an event is late only once its time has passed and it is not done', () => {
  assert.strictEqual(P.isLate({ date: '2026-11-07', time: '14:00' }, NOW), true);
  assert.strictEqual(P.isLate({ date: '2026-11-07', time: '16:00' }, NOW), false);
  assert.strictEqual(P.isLate({ date: '2026-11-07', time: null }, NOW), false);
  assert.strictEqual(P.isLate({ date: '2026-11-06', time: null }, NOW), true);
  assert.strictEqual(P.isLate({ date: '2026-11-06', time: null, done: true }, NOW), false);
});

test('colours: names, hex from a sync, and unknown', () => {
  assert.strictEqual(P.eventColor('red'), '#f87171');
  assert.strictEqual(P.eventColor('#123abc'), '#123abc');
  assert.strictEqual(P.eventColor('url(x)'), '#60a5fa');
  assert.strictEqual(P.eventColor(undefined), '#60a5fa');
});

test('durations and reminders read as words', () => {
  assert.strictEqual(P.durationText(null), '');
  assert.strictEqual(P.durationText(30), '30m');
  assert.strictEqual(P.durationText(60), '1h');
  assert.strictEqual(P.durationText(90), '1h 30m');
  assert.strictEqual(P.reminderText(null), '');
  assert.strictEqual(P.reminderText(0), 'Reminder at the time');
  assert.strictEqual(P.reminderText(15), 'Reminder 15m before');
  assert.strictEqual(P.repeatText({ recurrence: 'biweekly' }), 'Every 2 weeks');
  assert.strictEqual(P.repeatText({ recurringParentId: 'x' }), 'Repeats');
  assert.strictEqual(P.repeatText({}), '');
});

test('a meeting link comes from the sync or from the title, and only over https', () => {
  assert.strictEqual(P.meetingLink({ meetLink: 'https://meet.example/a' }), 'https://meet.example/a');
  assert.strictEqual(P.meetingLink({ title: 'Call https://zoom.example/1 now' }), 'https://zoom.example/1');
  assert.strictEqual(P.meetingLink({ title: 'Call http://plain.example' }), null);
  assert.strictEqual(P.meetingLink({ title: 'Lunch' }), null);
});

test('a link names where it goes', () => {
  assert.strictEqual(P.linkHost('https://www.meet.example/abc?x=1'), 'meet.example');
  assert.strictEqual(P.linkHost('https://accounts.google.com.evil.example/x'), 'accounts.google.com.evil.example');
  assert.strictEqual(P.linkHost('not a url'), '');
});

test('the shown title leaves out a pasted meeting link, unless it is all there is', () => {
  assert.strictEqual(P.eventTitle({ title: 'Design review https://meet.example/abc' }), 'Design review');
  assert.strictEqual(P.eventTitle({ title: 'https://meet.example/abc' }), 'https://meet.example/abc');
  assert.strictEqual(P.eventTitle({ title: 'Lunch' }), 'Lunch');
});

test('quick add finds the time and duration and leaves the title', () => {
  assert.deepStrictEqual(P.parseQuickAdd('Design review 3pm 1h'), { title: 'Design review', time: '15:00', duration: 60 });
  assert.deepStrictEqual(P.parseQuickAdd('Standup 9:30 15m'), { title: 'Standup', time: '09:30', duration: 15 });
  assert.deepStrictEqual(P.parseQuickAdd('Lunch 12am'), { title: 'Lunch', time: '00:00', duration: null });
  assert.deepStrictEqual(P.parseQuickAdd('Plain words'), { title: 'Plain words', time: null, duration: null });
  assert.deepStrictEqual(P.parseQuickAdd('13pm party'), { title: '13pm party', time: null, duration: null });
  assert.deepStrictEqual(P.parseQuickAdd('Workshop 1.5h 10:00'), { title: 'Workshop', time: '10:00', duration: 90 });
  assert.strictEqual(P.parseQuickAdd('3pm').title, '3pm');
});

test('tasks: active sorted by priority then order, done kept apart', () => {
  const { active, done } = P.splitTasks([
    { id: 1, priority: 'low', order: 0 },
    { id: 2, priority: 'high', order: 5 },
    { id: 3, order: 1 },
    { id: 4, priority: 'high', order: 2 },
    { id: 5, done: true, priority: 'high' },
  ]);
  assert.deepStrictEqual(active.map((t) => t.id), [4, 2, 3, 1]);
  assert.deepStrictEqual(done.map((t) => t.id), [5]);
  assert.deepStrictEqual(P.splitTasks(null), { active: [], done: [] });
});

test('a task dragged among rows of another priority takes that priority', () => {
  const rows = (...p) => p.map((priority, i) => ({ id: i, priority }));
  assert.strictEqual(P.priorityAfterMove(rows('high', 'low', 'high', 'medium'), 1), 'high');
  assert.strictEqual(P.priorityAfterMove(rows('high', 'medium', 'medium'), 1), 'medium');
  assert.strictEqual(P.priorityAfterMove(rows('low', 'high'), 0), 'high');
  assert.strictEqual(P.priorityAfterMove(rows('low'), 0), 'low');
  assert.strictEqual(P.priorityAfterMove(rows('low'), 9), null);
});

test('priority cycles through all three', () => {
  assert.strictEqual(P.nextPriority('low'), 'medium');
  assert.strictEqual(P.nextPriority('medium'), 'high');
  assert.strictEqual(P.nextPriority('high'), 'low');
  assert.strictEqual(P.nextPriority(undefined), 'low');
});

test('a task due date says today, overdue or the date', () => {
  assert.deepStrictEqual(P.dueInfo({ dueDate: '2026-11-07', dueTime: '16:00' }, NOW), { tone: 'today', text: 'Today · 16:00' });
  assert.deepStrictEqual(P.dueInfo({ dueDate: '2026-11-07' }, NOW), { tone: 'today', text: 'Today' });
  assert.deepStrictEqual(P.dueInfo({ dueDate: '2026-11-07', dueTime: '14:00' }, NOW), { tone: 'late', text: 'Overdue · Nov 7 · 14:00' });
  assert.deepStrictEqual(P.dueInfo({ dueDate: '2026-11-20' }, NOW), { tone: '', text: 'Nov 20' });
  assert.deepStrictEqual(P.dueInfo({ dueDate: '2026-11-01', done: true }, NOW), { tone: '', text: 'Nov 1' });
  assert.strictEqual(P.dueInfo({}, NOW), null);
  assert.strictEqual(P.dueInfo({ dueDate: 'junk' }, NOW), null);
});

test('a habit row has every day of the month, with today and the future marked', () => {
  const days = P.habitDays(['2026-11-03'], 2026, 10, '2026-11-07');
  assert.strictEqual(days.length, 30);
  assert.strictEqual(days[2].done, true);
  assert.strictEqual(days[6].today, true);
  assert.strictEqual(days[6].future, false);
  assert.strictEqual(days[7].future, true);
  assert.strictEqual(P.habitDays(null, 2028, 1, '2028-01-01').length, 29);
});

test('a streak counts back from today, and an unticked today does not break it', () => {
  assert.strictEqual(P.habitStreak(['2026-11-07', '2026-11-06', '2026-11-04'], '2026-11-07'), 2);
  assert.strictEqual(P.habitStreak(['2026-11-06', '2026-11-05'], '2026-11-07'), 2);
  assert.strictEqual(P.habitStreak(['2026-11-05'], '2026-11-07'), 0);
  assert.strictEqual(P.habitStreak(['2026-10-31', '2026-11-01'], '2026-11-01'), 2);
  assert.strictEqual(P.habitStreak(null, '2026-11-07'), 0);
});
