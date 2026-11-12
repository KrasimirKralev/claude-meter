// node --test test/usage-limits.test.js - reading /api/oauth/usage the way Claude Code does.
const test = require('node:test');
const assert = require('node:assert');
const limits = require('../usage-limits');

const NOW = 1793718423000;

// Trimmed from real Ultra-plan answers (2026-11-03): no 5-hour session limit,
// a weekly limit and a Fable-only weekly cap.
const ultraNormal = () => ({
  five_hour: null,
  seven_day: { utilization: 24.0, resets_at: '2026-11-08T05:00:00.664348+00:00' },
  seven_day_opus: null,
  seven_day_sonnet: null,
  extra_usage: { is_enabled: false, monthly_limit: null, used_credits: null, utilization: null,
    currency: null, decimal_places: null },
  limits: [
    { kind: 'weekly_all', group: 'weekly', percent: 24, severity: 'normal',
      resets_at: '2026-11-08T05:00:00.664348+00:00', scope: null, is_active: true },
    { kind: 'weekly_scoped', group: 'weekly', percent: 2, severity: 'normal',
      resets_at: '2026-11-08T04:59:59.664546+00:00',
      scope: { model: { id: null, display_name: 'Fable' }, surface: null }, is_active: false },
  ],
  spend: { percent: 0, severity: 'normal', enabled: false },
});

// The same plan once the Fable cap is used up: the server moves is_active to it.
const ultraFableHit = () => ({
  five_hour: null,
  seven_day: { utilization: 54.0, resets_at: '2026-11-04T08:00:00.254817+00:00' },
  seven_day_sonnet: null,
  limits: [
    { kind: 'weekly_all', group: 'weekly', percent: 54, severity: 'normal',
      resets_at: '2026-11-04T08:00:00.254817+00:00', scope: null, is_active: false },
    { kind: 'weekly_scoped', group: 'weekly', percent: 100, severity: 'critical',
      resets_at: '2026-11-04T08:00:00.255060+00:00',
      scope: { model: { id: null, display_name: 'Fable' }, surface: null }, is_active: true },
  ],
});

// An older plan shape: a 5-hour window and no limits[] at all.
const legacyMax = () => ({
  five_hour: { utilization: 37.4, resets_at: '2026-11-03T18:00:00+00:00' },
  seven_day: { utilization: 12, resets_at: '2026-11-08T05:00:00+00:00' },
  seven_day_sonnet: { utilization: 3, resets_at: '2026-11-08T05:00:00+00:00' },
});

test('Ultra: no session meter at all, never a fake 0 %', () => {
  const u = limits.buildUsage(ultraNormal(), NOW);
  assert.strictEqual(u.session, null);
  assert.deepStrictEqual(
    { pct: u.weekAll.pct, label: u.weekAll.label, severity: u.weekAll.severity, active: u.weekAll.active },
    { pct: 24, label: 'Current week (all models)', severity: 'normal', active: true });
  assert.strictEqual(u.weekAll.resetsAt, '2026-11-08T05:00:00.664348+00:00');
  assert.deepStrictEqual(
    { pct: u.weekSonnet.pct, label: u.weekSonnet.label, model: u.weekSonnet.model },
    { pct: 2, label: 'Current week (Fable)', model: 'Fable' });
  assert.deepStrictEqual(u.otherLimits, []);
  assert.strictEqual(u.headline, 'weekAll');
  assert.strictEqual(u.syncTime, NOW);
  assert.strictEqual(u.extraUsage.enabled, false);
});

test('a used-up scoped cap becomes the headline and grades critical', () => {
  const u = limits.buildUsage(ultraFableHit(), NOW);
  assert.strictEqual(u.headline, 'weekSonnet');
  assert.strictEqual(u.weekSonnet.pct, 100);
  assert.strictEqual(limits.gradeOf(u.weekSonnet), 'danger');
  assert.strictEqual(limits.gradeOf(u.weekAll), 'normal');
  assert.strictEqual(limits.summaryLine(u), '7d 54% · Fable 100%');
});

test('server severity wins over the pct thresholds', () => {
  assert.strictEqual(limits.gradeOf({ pct: 70, severity: 'normal' }), 'normal');
  assert.strictEqual(limits.gradeOf({ pct: 40, severity: 'warning' }), 'warning');
  assert.strictEqual(limits.gradeOf({ pct: 50, severity: 'critical' }), 'danger');
  // No severity (legacy fields): the widget's own 60 / 85 thresholds.
  assert.strictEqual(limits.gradeOf({ pct: 59, severity: null }), 'normal');
  assert.strictEqual(limits.gradeOf({ pct: 60, severity: null }), 'warning');
  assert.strictEqual(limits.gradeOf({ pct: 85 }), 'danger');
  assert.strictEqual(limits.gradeOf(null), null);
});

test('legacy body without limits[] still fills all three meters', () => {
  const u = limits.buildUsage(legacyMax(), NOW);
  assert.strictEqual(u.session.pct, 37);
  assert.strictEqual(u.session.label, 'Current session');
  assert.strictEqual(u.weekAll.pct, 12);
  assert.deepStrictEqual(
    { pct: u.weekSonnet.pct, model: u.weekSonnet.model, label: u.weekSonnet.label },
    { pct: 3, model: 'Sonnet', label: 'Current week (Sonnet)' });
  // No is_active anywhere: the fullest meter is the headline.
  assert.strictEqual(u.headline, 'session');
  assert.strictEqual(limits.summaryLine(u), '5h 37% · 7d 12% · Sonnet 3%');
});

test('a session row in limits[] fills the session meter', () => {
  const body = ultraNormal();
  body.limits.unshift({ kind: 'session', group: 'session', percent: 91, severity: 'warning',
    resets_at: '2026-11-03T18:00:00+00:00', scope: null, is_active: false });
  const u = limits.buildUsage(body, NOW);
  assert.deepStrictEqual(
    { pct: u.session.pct, label: u.session.label, severity: u.session.severity },
    { pct: 91, label: 'Current session', severity: 'warning' });
  assert.strictEqual(u.headline, 'weekAll'); // still the server's pick
});

test('rows the three meters do not cover are kept, in server order', () => {
  const body = ultraNormal();
  body.limits.push(
    { kind: 'weekly_scoped', group: 'weekly', percent: 40, severity: 'normal', resets_at: null,
      scope: { model: { display_name: 'Opus' } }, is_active: false },
    { kind: 'weekly_scoped', group: 'weekly', percent: 7, severity: 'normal', resets_at: null,
      scope: { model: null, surface: { display_name: 'Cowork' } }, is_active: false },
    { kind: 'daily_all', group: 'daily', percent: 3, severity: 'normal', resets_at: null,
      scope: null, is_active: false },
    { kind: 'weekly_all', group: 'weekly', percent: null }, // unreadable: dropped
  );
  const u = limits.buildUsage(body, NOW);
  assert.strictEqual(u.weekSonnet.model, 'Fable'); // the first scoped model row
  assert.deepStrictEqual(u.otherLimits.map((r) => [r.label, r.pct]), [
    ['Current week (Opus)', 40],
    ['Current week (Cowork)', 7],
    ['daily all', 3],
  ]);
});

test('an empty or broken body yields no meters and no headline', () => {
  for (const body of [{}, null, { limits: [] }, { limits: 'x', five_hour: null }]) {
    const u = limits.buildUsage(body, NOW);
    assert.strictEqual(u.session, null);
    assert.strictEqual(u.weekAll, null);
    assert.strictEqual(u.weekSonnet, null);
    assert.strictEqual(u.headline, null);
    assert.strictEqual(limits.looksEmpty(u), true);
    assert.strictEqual(limits.anyUsage(u), false);
    assert.strictEqual(limits.summaryLine(u), '');
  }
});

test('looksEmpty: all zero without resets is a bad answer, a fresh week is not', () => {
  const zero = limits.buildUsage({ seven_day: { utilization: 0, resets_at: null } }, NOW);
  assert.strictEqual(limits.looksEmpty(zero), true);
  const fresh = limits.buildUsage({ seven_day: { utilization: 0, resets_at: '2026-11-08T05:00:00Z' } }, NOW);
  assert.strictEqual(limits.looksEmpty(fresh), false);
  assert.strictEqual(limits.looksEmpty(limits.buildUsage(ultraNormal(), NOW)), false);
});

test('normalizeCached drops the pre-2.15 { pct: 0 } placeholders', () => {
  const old = {
    session: { pct: 0, resetsAt: null, label: 'Current session' },
    weekAll: { pct: 24, resetsAt: '2026-11-08T05:00:00Z', label: 'Current week (all models)' },
    weekSonnet: { pct: 2, resetsAt: '2026-11-08T05:00:00Z', label: 'Current week (Fable only)', model: 'Fable' },
    extraUsage: { enabled: false },
    syncTime: NOW,
  };
  const u = limits.normalizeCached(old);
  assert.strictEqual(u.session, null);
  assert.strictEqual(u.weekAll.pct, 24);
  assert.strictEqual(u.headline, 'weekAll');
  assert.deepStrictEqual(u.otherLimits, []);
  // A current object passes through unchanged in substance.
  const cur = limits.buildUsage(ultraFableHit(), NOW);
  assert.deepStrictEqual(limits.normalizeCached(cur), cur);
  assert.strictEqual(limits.normalizeCached(null), null);
});

test('clampPct', () => {
  assert.strictEqual(limits.clampPct(37.6), 38);
  assert.strictEqual(limits.clampPct(140), 100);
  assert.strictEqual(limits.clampPct(-3), 0);
  assert.strictEqual(limits.clampPct(null), null);
  assert.strictEqual(limits.clampPct(undefined), null);
  assert.strictEqual(limits.clampPct('x'), null);
});
