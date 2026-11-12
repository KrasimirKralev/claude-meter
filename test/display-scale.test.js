// node --test test/display-scale.test.js - the display-scale guard, without Electron.
const test = require('node:test');
const assert = require('node:assert');
const { RELAUNCH_ARG, lastRelaunchFromArgv, shouldRelaunch } = require('../display-scale');

test('lastRelaunchFromArgv finds the timestamp the previous process left behind', () => {
  assert.strictEqual(lastRelaunchFromArgv(['/bin/app', RELAUNCH_ARG + '1700000000000']), 1700000000000);
  assert.strictEqual(lastRelaunchFromArgv(['/bin/app', '--no-sandbox']), 0);
  assert.strictEqual(lastRelaunchFromArgv([RELAUNCH_ARG + 'junk']), 0);
  assert.strictEqual(lastRelaunchFromArgv(undefined), 0);
});

const base = { startScale: 2, nowScale: 1, breakRunning: false, lastRelaunchAt: 0, now: 1e12 };

test('relaunches when the scale now differs from the scale at start', () => {
  assert.strictEqual(shouldRelaunch(base), true);
  assert.strictEqual(shouldRelaunch({ ...base, startScale: 1, nowScale: 1.25 }), true);
});

test('no relaunch when the scales agree, within rounding', () => {
  assert.strictEqual(shouldRelaunch({ ...base, startScale: 1, nowScale: 1 }), false);
  assert.strictEqual(shouldRelaunch({ ...base, startScale: 1.25, nowScale: 1.2500001 }), false);
});

test('an unknown scale is never a reason to restart', () => {
  assert.strictEqual(shouldRelaunch({ ...base, nowScale: null }), false);
  assert.strictEqual(shouldRelaunch({ ...base, startScale: null }), false);
});

test('never mid-break, and at most once per ten minutes across the restart', () => {
  assert.strictEqual(shouldRelaunch({ ...base, breakRunning: true }), false);
  assert.strictEqual(shouldRelaunch({ ...base, lastRelaunchAt: base.now - 5 * 60 * 1000 }), false);
  assert.strictEqual(shouldRelaunch({ ...base, lastRelaunchAt: base.now - 11 * 60 * 1000 }), true);
});

test('quietWait holds a popup for 15 s after start and 10 s after a display change', () => {
  const { quietWait } = require('../display-scale');
  const t0 = 1e12;
  // Fresh process, no display change yet: the start floor alone.
  assert.strictEqual(quietWait({ now: t0 + 3000, startedAt: t0, lastChangeAt: 0 }), 12000);
  assert.strictEqual(quietWait({ now: t0 + 15000, startedAt: t0, lastChangeAt: 0 }), 0);
  // A display change 4 s ago on an old process: six more seconds.
  assert.strictEqual(quietWait({ now: t0 + 600000, startedAt: t0, lastChangeAt: t0 + 596000 }), 6000);
  // Both floors pending: the longer one wins.
  assert.strictEqual(quietWait({ now: t0 + 2000, startedAt: t0, lastChangeAt: t0 + 1000 }), 13000);
  // Quiet for long: no wait.
  assert.strictEqual(quietWait({ now: t0 + 600000, startedAt: t0, lastChangeAt: t0 + 100000 }), 0);
});
