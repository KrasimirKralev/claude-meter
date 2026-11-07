// node --test test/relax.test.js - the Relax schedule and its checks, without Electron.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const relax = require('../relax');

const DAY = '2026-09-29';
const at = (hhmm, sec) => relax.atTime(DAY, hhmm) + (sec || 0) * 1000;
const MIN = 60 * 1000;
// The planner tests keep their own schedule; the defaults are checked on their own.
const TIMES = ['10:30', '12:30', '15:00', '17:30'];
const cfg = (over) => relax.normalizeConfig(Object.assign({}, relax.DEFAULT_CONFIG, { times: TIMES }, over || {}));
const day = (over) => Object.assign(relax.normalizeState(null, DAY), over || {});

test('config: defaults, cleaning and an empty schedule', () => {
  assert.deepStrictEqual(relax.normalizeConfig(null), {
    enabled: true, times: ['11:00', '13:00', '15:00', '17:00'], minutes: 4, music: true, breathing: true, musicSource: 'auto',
  });
  const c = relax.normalizeConfig({ times: ['17:30', '9:05', 'noon', '25:00', '09:05'], minutes: 99, enabled: false });
  assert.deepStrictEqual(c.times, ['09:05', '17:30']);
  assert.strictEqual(c.minutes, 4);
  assert.strictEqual(c.enabled, false);
  assert.deepStrictEqual(relax.normalizeConfig({ times: [] }).times, []);
  assert.strictEqual(relax.normalizeConfig({ minutes: 1 }).minutes, 1);
  assert.strictEqual(relax.normalizeConfig({ minutes: '4' }).minutes, 4);
});

test('config file: created when missing, left alone when broken', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relax-'));
  const file = path.join(dir, 'usage-widget-relax.json');
  const first = relax.loadConfig(file);
  assert.strictEqual(first.error, null);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf-8')).times, ['11:00', '13:00', '15:00', '17:00']);
  fs.writeFileSync(file, '{"times": ["10:00",');
  const broken = relax.loadConfig(file);
  assert.match(broken.error, /not valid JSON/);
  assert.strictEqual(fs.readFileSync(file, 'utf-8'), '{"times": ["10:00",'); // not overwritten
  assert.strictEqual(broken.config.minutes, 4);
});

test('state: a new day resets the count but never forgets the banners to restore', () => {
  const old = { date: '2026-09-28', done: 3, lastDoneAt: 123, slots: { '10:30': { status: 'done' } }, bannersRestore: true };
  const s = relax.normalizeState(old, DAY);
  assert.deepStrictEqual([s.date, s.done, Object.keys(s.slots).length, s.bannersRestore, s.lastDoneAt],
    [DAY, 0, 0, true, 123]);
  const same = relax.normalizeState({ date: DAY, done: 2, slots: { '10:30': { status: 'done' }, junk: {} } }, DAY);
  assert.deepStrictEqual([same.done, Object.keys(same.slots)], [2, ['10:30']]);
  assert.strictEqual(relax.normalizeState('nonsense', DAY).done, 0);
});

test('slots: nothing before the heads-up, due from 30 s before', () => {
  const s = day();
  let p = relax.planSlots(cfg(), s, at('10:29', 29));
  assert.strictEqual(p.due, null);
  assert.deepStrictEqual(p.next, { time: '10:30', at: at('10:30'), retry: false });
  p = relax.planSlots(cfg(), s, at('10:29', 30));
  assert.strictEqual(p.due, '10:30');
});

test('slots: a deferred slot waits 10 min, and is missed after an hour', () => {
  const s = day({ slots: { '10:30': { status: 'waiting', nextAt: at('10:40'), reason: 'away' } } });
  let p = relax.planSlots(cfg(), s, at('10:35'));
  assert.strictEqual(p.due, null);
  assert.deepStrictEqual(p.next, { time: '10:30', at: at('10:40'), retry: true });
  p = relax.planSlots(cfg(), s, at('10:40'));
  assert.strictEqual(p.due, '10:30');
  p = relax.planSlots(cfg(), s, at('11:30'));
  assert.strictEqual(p.due, null);
  assert.strictEqual(s.slots['10:30'].status, 'missed');
  assert.strictEqual(s.slots['10:30'].reason, 'away');
  assert.strictEqual(p.changed, true);
  assert.strictEqual(p.next.time, '12:30');
});

test('slots: "Later" can outlive the hour; settled slots stay settled', () => {
  const s = day({ slots: {
    '10:30': { status: 'waiting', nextAt: at('11:35'), laterUntil: at('11:36') },
    '12:30': { status: 'skipped' },
  } });
  const p = relax.planSlots(cfg(), s, at('11:35')); // past the usual hour, inside "Later"
  assert.strictEqual(p.due, '10:30');
  const after = relax.planSlots(cfg(), s, at('12:31'));
  assert.strictEqual(after.due, null);
  assert.deepStrictEqual([s.slots['10:30'].status, s.slots['12:30'].status], ['missed', 'skipped']);
});

test('slots: a break in the last hour covers the slot; four done covers the rest', () => {
  const s = day({ done: 1, lastDoneAt: at('10:05') });
  const p = relax.planSlots(cfg(), s, at('10:30'));
  assert.strictEqual(p.due, null);
  assert.strictEqual(s.slots['10:30'].status, 'covered');
  const full = day({ done: 4, lastDoneAt: at('09:00') });
  relax.planSlots(cfg(), full, at('12:30'));
  assert.strictEqual(full.slots['12:30'].status, 'covered');
});

test('slots: the app starting late in the day marks the past slots missed, never starts one', () => {
  const s = day();
  const p = relax.planSlots(cfg(), s, at('22:30'));
  assert.strictEqual(p.due, null);
  assert.deepStrictEqual(Object.values(s.slots).map((e) => e.status), ['missed', 'missed', 'missed', 'missed']);
  assert.strictEqual(p.next, null);
});

test('calendar: running or starting soon blocks, done/all-day/later do not', () => {
  const now = at('10:30');
  const ev = (time, duration, extra) => Object.assign({ date: DAY, time, duration, title: 'x' }, extra || {});
  const breakMs = 4 * MIN;
  assert.ok(relax.busyEvent([ev('10:00', 60)], now, breakMs), 'running');
  assert.ok(relax.busyEvent([ev('10:34', 30)], now, breakMs), 'starts within 5 min');
  assert.ok(relax.busyEvent([ev('10:10', null)], now, breakMs), 'no length: half an hour');
  assert.strictEqual(relax.busyEvent([ev('10:45', 30)], now, breakMs), null);
  assert.strictEqual(relax.busyEvent([ev('09:00', 60)], now, breakMs), null);
  assert.strictEqual(relax.busyEvent([ev('10:00', 60, { done: true })], now, breakMs), null);
  assert.strictEqual(relax.busyEvent([{ date: DAY, time: null, title: 'all day' }], now, breakMs), null);
  assert.strictEqual(relax.busyEvent([ev('10:30', 30, { date: '2026-09-30' })], now, breakMs), null);
  // A long break needs a longer clear window than the 5 min margin.
  assert.ok(relax.busyEvent([ev('10:40', 30)], now, 10 * MIN));
});

test('microphone: only running capture streams count, not monitors or players', () => {
  const node = (id, cls, state, props) => ({ id, type: 'PipeWire:Interface:Node',
    info: { state, props: Object.assign({ 'media.class': cls, 'application.name': 'App' + id }, props || {}) } });
  const dump = [
    node(1, 'Audio/Source', 'running'),
    node(2, 'Stream/Output/Audio', 'running'),
    node(3, 'Stream/Input/Audio', 'idle'),
    node(4, 'Stream/Input/Audio', 'running', { 'stream.monitor': true }),
    node(5, 'Stream/Input/Audio', 'running', { 'application.name': 'Google Chrome' }),
    { id: 6, type: 'PipeWire:Interface:Link' },
  ];
  assert.deepStrictEqual(relax.micCaptures(dump), [{ id: 5, app: 'Google Chrome' }]);
  assert.deepStrictEqual(relax.micCaptures(null), []);
});

test('view: count, next slot, tomorrow and the finished day', () => {
  let v = relax.relaxView(cfg(), day({ done: 1, slots: { '10:30': { status: 'done' } } }), at('11:00'));
  assert.deepStrictEqual([v.done, v.total, v.next, v.phase], [1, 4, { time: '12:30', tomorrow: false, retry: false }, 'idle']);
  v = relax.relaxView(cfg(), day({ done: 4 }), at('18:40'));
  assert.deepStrictEqual(v.next, { time: '10:30', tomorrow: true, retry: false });
  v = relax.relaxView(cfg({ enabled: false }), day(), at('09:00'));
  assert.strictEqual(v.next, null);
  const s = day();
  relax.relaxView(cfg(), s, at('22:00'));
  assert.deepStrictEqual(s.slots, {}, 'the view never changes the saved state');
});

test('habit: ticked only when the day reaches its target, never by an earlier break', () => {
  const c = cfg();
  assert.strictEqual(relax.dailyTarget(c), 4);
  for (const done of [0, 1, 2, 3]) assert.strictEqual(relax.habitDue(c, day({ done }), false), false, done + '/4');
  assert.strictEqual(relax.habitDue(c, day({ done: 4 }), false), true);
  assert.strictEqual(relax.habitDue(c, day({ done: 5 }), false), true, 'an extra Relax now still counts');
  assert.strictEqual(relax.habitDue(c, day({ done: 4 }), true), false, 'already ticked: nothing to do');
  assert.strictEqual(relax.habitDue(c, day({ done: 0 }), true), false, 'never un-ticks a recorded day');
  // The target follows the configured slots; "Relax now" only keeps the default four.
  assert.strictEqual(relax.dailyTarget(cfg({ times: ['09:00', '14:00', '18:00'] })), 3);
  assert.strictEqual(relax.habitDue(cfg({ times: ['09:00', '14:00', '18:00'] }), day({ done: 3 }), false), true);
  assert.strictEqual(relax.dailyTarget(cfg({ times: [] })), 4);
  assert.strictEqual(relax.relaxView(cfg({ times: [] }), day({ done: 2 }), at('12:00')).total, 4);
  // 4/4 before the last slot (two of them were "Relax now"): the day is done, no "next 15:00".
  const v = relax.relaxView(cfg(), day({ done: 4 }), at('13:00'));
  assert.deepStrictEqual(v.next, { time: '10:30', tomorrow: true, retry: false });
  assert.strictEqual(relax.relaxView(cfg(), day({ done: 3 }), at('13:00')).next.tomorrow, false);
});
