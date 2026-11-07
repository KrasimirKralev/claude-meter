// node --test test/widget-lib.test.js - what the widget and dashboard say, without a window.
const test = require('node:test');
const assert = require('node:assert');
const {
  answerParts,
  filledCells,
  meterClass,
  refillText,
  rowMeters,
  rowState,
  shortLabel,
  timelineMarks,
  weekSeries,
} = require('../widget-lib');

const NOW = new Date(2026, 10, 7, 11, 47).getTime(); // Saturday
const HOUR = 3600000;
const meter = (pct, hours, extra) => ({ pct, resetsAt: new Date(NOW + hours * HOUR).toISOString(), ...extra });
const weekly = (all, fable, hours) => ({
  session: null,
  weekAll: meter(all, hours, { label: 'Current week (all models)' }),
  weekSonnet: meter(fable, hours, { label: 'Current week (Fable)', model: 'Fable' }),
  otherLimits: [],
});
const account = (name, usage, extra) => ({ id: `.claude-${name}`, name, usage, error: null, needsLogin: false, ...extra });
const today = [
  account('Studio', weekly(98, 21, 21.2)),
  account('Personal', weekly(68, 33, 19.2)),
  account('Marketing', weekly(14, 18, 150.2)),
  account('Side', weekly(2, 2, 94.2)),
];

test('filledCells rounds to 12 cells and never hides real usage', () => {
  assert.strictEqual(filledCells(68), 8);
  assert.strictEqual(filledCells(33), 4);
  assert.strictEqual(filledCells(100), 12);
  assert.strictEqual(filledCells(0), 0);
  assert.strictEqual(filledCells(1), 1);
  assert.strictEqual(filledCells(140), 12);
  assert.strictEqual(filledCells(-3), 0);
  assert.strictEqual(filledCells(undefined), 0);
});

test('meterClass trusts the server, then falls back to thresholds', () => {
  assert.strictEqual(meterClass({ pct: 10, severity: 'critical' }), 'danger');
  assert.strictEqual(meterClass({ pct: 99, severity: 'normal' }), '');
  assert.strictEqual(meterClass({ pct: 90 }), 'danger');
  assert.strictEqual(meterClass({ pct: 70 }), 'warning');
  assert.strictEqual(meterClass({ pct: 10 }), '');
  assert.strictEqual(meterClass(null), '');
});

test('shortLabel keeps what tells two meters apart', () => {
  assert.strictEqual(shortLabel({ label: 'Current week (all models)' }), 'All models');
  assert.strictEqual(shortLabel({ label: 'Current week (Fable)', model: 'Fable' }), 'Fable');
  assert.strictEqual(shortLabel({ label: 'Current session' }), 'Session');
  assert.strictEqual(shortLabel({ label: 'Daily routines' }), 'Daily routines');
  assert.strictEqual(shortLabel({}), 'Limit');
});

test('rowMeters leads with weekly on a plan with no session limit', () => {
  const { main, subs } = rowMeters(weekly(68, 33, 19));
  assert.strictEqual(main.pct, 68);
  assert.deepStrictEqual(subs.map((m) => m.pct), [33]);
});

test('rowMeters leads with the session on a plan that has one, and keeps every other limit', () => {
  const usage = { ...weekly(40, 20, 50), session: meter(75, 2, { label: 'Current session' }), otherLimits: [meter(9, 5, { label: 'Extra' })] };
  const { main, subs } = rowMeters(usage);
  assert.strictEqual(main.pct, 75);
  assert.deepStrictEqual(subs.map((m) => m.pct), [40, 20, 9]);
});

test('rowState says it is the session refilling, because the main meter has no label', () => {
  const usage = { ...weekly(40, 20, 50), session: meter(75, 2, { label: 'Current session' }) };
  assert.strictEqual(rowState(account('Personal', usage), NOW).detail, 'Session refills in 2h 0m');
});

test('rowMeters copes with no data', () => {
  assert.deepStrictEqual(rowMeters(null), { main: null, subs: [] });
  assert.deepStrictEqual(rowMeters({ session: null, weekAll: null, weekSonnet: null }), { main: null, subs: [] });
});

test('refillText counts down inside a day, then names the weekday', () => {
  assert.strictEqual(refillText(new Date(NOW + 19.2 * HOUR).toISOString(), NOW), 'in 19h 12m');
  assert.strictEqual(refillText(new Date(NOW + 0.5 * HOUR).toISOString(), NOW), 'in 30m');
  assert.strictEqual(refillText(new Date(NOW + 30000).toISOString(), NOW), 'in 30s');
  assert.strictEqual(refillText(new Date(2026, 10, 13, 17, 59).toISOString(), NOW), 'Fri, 5:59pm');
  assert.strictEqual(refillText(new Date(2026, 10, 11, 9, 0).toISOString(), NOW), 'Wed, 9am');
});

test('refillText gives a date when a weekday would be ambiguous', () => {
  assert.strictEqual(refillText(new Date(2026, 10, 20, 9, 0).toISOString(), NOW), 'Nov 20, 9am');
});

test('refillText says so when the moment has passed, and is empty with no time', () => {
  assert.strictEqual(refillText(new Date(NOW - 1000).toISOString(), NOW), 'now');
  assert.strictEqual(refillText(null, NOW), '');
  assert.strictEqual(refillText('nonsense', NOW), '');
});

test('rowState warns on the fullest limit in plain words', () => {
  const state = rowState(today[0], NOW);
  assert.strictEqual(state.status, 'ok');
  assert.strictEqual(state.alert, 'Nearly full.');
  assert.strictEqual(state.detail, 'Refills in 21h 12m');
});

test('rowState names a used-up scoped limit even when the week is fine', () => {
  const usage = { ...weekly(54, 100, 30) };
  usage.weekSonnet.severity = 'critical';
  const state = rowState(account('Side', usage), NOW);
  assert.strictEqual(state.alert, 'Fable full.');
  assert.strictEqual(state.main.pct, 54);
});

test('rowState is calm when nothing is wrong', () => {
  const state = rowState(today[1], NOW);
  assert.strictEqual(state.alert, '');
  assert.strictEqual(state.detail, 'Refills in 19h 12m');
});

test('a logged-out account says so and never claims 0%', () => {
  const state = rowState(account('Side', null, { needsLogin: true }), NOW);
  assert.strictEqual(state.status, 'out');
  assert.strictEqual(state.alert, 'Logged out.');
  assert.strictEqual(state.main, null);
});

test('login expiry takes the second line when it needs action', () => {
  const state = rowState(account('Personal', weekly(10, 10, 20), { login: { state: 'warn', short: '09 Nov · 2 d', text: 'x', detail: 'y' } }), NOW);
  assert.strictEqual(state.alert, 'Login ends 09 Nov · 2 d.');
  const out = rowState(account('Personal', weekly(10, 10, 20), { login: { state: 'out', short: 'Expired', text: 'x', detail: 'y' } }), NOW);
  assert.strictEqual(out.status, 'out');
});

test('a rate-limited account keeps its numbers and says why they may be old', () => {
  const state = rowState(account('Personal', weekly(10, 10, 20), { rateLimitedUntil: NOW + 5 * 60000 }), NOW);
  assert.strictEqual(state.status, 'limited');
  assert.strictEqual(state.main.pct, 10);
  assert.strictEqual(state.detail, 'Rate limited, retrying in 5m');
});

test('an account with no numbers explains itself', () => {
  assert.strictEqual(rowState(account('Personal', null), NOW).detail, 'Waiting for first sync');
  assert.strictEqual(rowState(account('Personal', null, { error: 'Network down' }), NOW).detail, 'Network down');
  assert.strictEqual(rowState(account('Personal', null, { rateLimitedUntil: NOW + 60000 }), NOW).detail, 'Rate limited, retrying in 1m');
});

test('answerParts names the roomiest account and the next refill', () => {
  assert.deepStrictEqual(answerParts(today, NOW), { most: 'Side', full: false, nextName: 'Personal', nextText: 'in 19h 12m' });
});

test('answerParts counts the fullest limit, so a used-up Fable cap is not "room"', () => {
  const parts = answerParts([account('A', weekly(1, 100, 10)), account('B', weekly(40, 40, 20))], NOW);
  assert.strictEqual(parts.most, 'B');
});

test('answerParts claims nothing about room with one account, or when all are level', () => {
  const single = answerParts([today[1]], NOW);
  assert.strictEqual(single.most, null);
  assert.strictEqual(single.nextName, null);
  assert.strictEqual(single.nextText, 'in 19h 12m');
  assert.strictEqual(answerParts([account('A', weekly(5, 5, 10)), account('B', weekly(5, 5, 20))], NOW).most, null);
});

test('answerParts says when no account has room', () => {
  const parts = answerParts([account('A', weekly(100, 10, 10)), account('B', weekly(100, 40, 20))], NOW);
  assert.strictEqual(parts.full, true);
  assert.strictEqual(parts.most, null);
});

test('answerParts skips logged-out and empty accounts, and gives nothing when none are left', () => {
  const parts = answerParts([account('A', weekly(1, 1, 10), { needsLogin: true }), account('B', null), today[1]], NOW);
  assert.strictEqual(parts.most, null);
  assert.strictEqual(parts.nextText, 'in 19h 12m');
  assert.strictEqual(answerParts([account('B', null)], NOW), null);
  assert.strictEqual(answerParts([], NOW), null);
});

test('timelineMarks places refills across the next week in time order', () => {
  const marks = timelineMarks(today, NOW);
  assert.deepStrictEqual(marks.map((m) => m.name), ['Personal', 'Studio', 'Side', 'Marketing']);
  assert.ok(Math.abs(marks[0].x - 19.2 / 168 * 100) < 0.2);
  assert.deepStrictEqual(marks.map((m) => m.lane), ['up', 'down', 'up', 'down']);
  assert.deepStrictEqual(marks.map((m) => m.flip), [false, false, false, true]);
  assert.strictEqual(marks[0].index, 1);
  assert.strictEqual(marks[0].text, 'in 19h 12m');
});

test('timelineMarks leaves out accounts with no refill in sight', () => {
  const later = account('Later', weekly(1, 1, 400));
  const past = account('Past', weekly(1, 1, -2));
  assert.deepStrictEqual(timelineMarks([later, past, account('None', null)], NOW), []);
});

test('weekSeries scales the current week to 0-100 and ignores older points', () => {
  const resetsAt = new Date(NOW + 19.2 * HOUR).toISOString();
  const start = NOW + 19.2 * HOUR - 168 * HOUR;
  const points = [
    { ts: start - HOUR, weekAll: 90, weekSonnet: 50 },
    { ts: start, weekAll: 0, weekSonnet: 0 },
    { ts: start + 84 * HOUR, weekAll: 30, weekSonnet: null },
    { ts: NOW, weekAll: 68, weekSonnet: 33 },
  ];
  const series = weekSeries(points, resetsAt);
  assert.deepStrictEqual(series.map((p) => p.x), [0, 50, Math.round((NOW - start) / (168 * HOUR) * 1000) / 10]);
  assert.deepStrictEqual(series.map((p) => p.all), [0, 30, 68]);
  assert.deepStrictEqual(series.map((p) => p.scoped), [0, null, 33]);
});

test('weekSeries gives nothing without a reset time or points', () => {
  assert.deepStrictEqual(weekSeries([{ ts: NOW, weekAll: 1 }], null), []);
  assert.deepStrictEqual(weekSeries(null, new Date(NOW).toISOString()), []);
});
