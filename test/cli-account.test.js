// node --test test/cli-account.test.js - which account the meter marks Active from the launcher's record.
const test = require('node:test');
const assert = require('node:assert');
const { cliAccountId, launcherAccountKey, readMoveResult, moveMessage } = require('../cli-account');

const ACCOUNTS = [
  { id: '_claude-bob', email: 'bob@example.com' },
  { id: '_claude-alice', email: 'Alice@Example.com' },
  { id: '_claude-old', email: 'old@example.com', enabled: false },
];
const session = (email, extra) => ({ email, launcher: 'clx', session_dir: '/home/u/.clx-sessions/4242', ...extra });

test('a launcher session on an account names that account', () => {
  assert.strictEqual(cliAccountId(session('bob@example.com'), ACCOUNTS), '_claude-bob');
});

test('the e-mail is matched whatever its case or padding', () => {
  assert.strictEqual(cliAccountId(session('  ALICE@example.COM '), ACCOUNTS), '_claude-alice');
});

test('a record no session wrote names nobody: a headless run must not move the meter', () => {
  // what a cron run on another account leaves behind: the same fields, no session_dir
  assert.strictEqual(cliAccountId({ email: 'alice@example.com', launcher: 'clx', reason: 'session' }, ACCOUNTS), null);
  assert.strictEqual(cliAccountId(session('alice@example.com', { session_dir: '' }), ACCOUNTS), null);
  assert.strictEqual(cliAccountId(session('alice@example.com', { session_dir: 7 }), ACCOUNTS), null);
});

test('the same account, once a session opens on it, is named', () => {
  const headless = { email: 'alice@example.com', launcher: 'clx' };
  assert.strictEqual(cliAccountId(headless, ACCOUNTS), null);
  assert.strictEqual(cliAccountId({ ...headless, session_dir: '/home/u/.clx-sessions/7' }, ACCOUNTS), '_claude-alice');
});

test('no record, a damaged one, or one with no e-mail names nobody', () => {
  for (const marker of [null, undefined, 'bob@example.com', [], {}, session(''), session(null)]) {
    assert.strictEqual(cliAccountId(marker, ACCOUNTS), null);
  }
});

test('an account the meter does not show is never named', () => {
  assert.strictEqual(cliAccountId(session('stranger@example.com'), ACCOUNTS), null);
  assert.strictEqual(cliAccountId(session('old@example.com'), ACCOUNTS), null);
  assert.strictEqual(cliAccountId(session('bob@example.com'), []), null);
  assert.strictEqual(cliAccountId(session('bob@example.com'), null), null);
});

test('the launcher knows an account by the end of its folder name', () => {
  assert.strictEqual(launcherAccountKey('/home/u/.claude-bob'), 'bob');
  assert.strictEqual(launcherAccountKey('/home/u/.claude-carol/'), 'carol');
  assert.strictEqual(launcherAccountKey('C:\\Users\\u\\.claude-work'), 'work');
});

test('a folder that is no account folder has no launcher name, so nothing odd reaches a command line', () => {
  for (const dir of ['/home/u/.claude', '/home/u/.claude-', '/home/u/.claude-a b', '/home/u/.claude-$(id)',
    '/home/u/.claude--dry-run', '/home/u/claude-bob', '', null, 7]) {
    assert.strictEqual(launcherAccountKey(dir), null, String(dir));
  }
});

test('the helper answer is one JSON object or nothing', () => {
  assert.deepStrictEqual(readMoveResult(' {"ok": true, "moved": ["1"]}\n'), { ok: true, moved: ['1'] });
  for (const out of ['', 'Traceback (most recent call last):', '[1, 2]', '"ok"', null, undefined]) {
    assert.strictEqual(readMoveResult(out), null);
  }
});

test('what the page says after a click', () => {
  const full = 'Alice is at 100% of its 7d limit; clx switches away at 90% and would move it off again';
  assert.deepStrictEqual(moveMessage({ ok: true, target: 'Bob', sessions: 3, moved: ['1', '2'], already: ['3'], skipped: [] }),
    { ok: true, text: 'Moved 2 sessions to Bob', detail: '' });
  assert.deepStrictEqual(moveMessage({ ok: true, target: 'Marketing', sessions: 2, moved: ['1'], skipped: [{ pid: '2', why: full, limit: true }] }),
    { ok: true, text: 'Moved 1 session to Marketing, 1 stayed', detail: full });
  assert.deepStrictEqual(moveMessage({ ok: true, target: 'Bob', sessions: 2, moved: [], already: ['1', '2'], skipped: [] }),
    { ok: true, text: 'Every session is already on Bob', detail: '' });
  assert.deepStrictEqual(moveMessage({ ok: true, target: 'Bob', sessions: 0, moved: [], already: [], skipped: [] }),
    { ok: true, text: 'No session is running: nothing to move', detail: '' });
  assert.deepStrictEqual(moveMessage({ ok: false, target: 'Alice', sessions: 3, error: full }),
    { ok: false, text: 'Not moved: Alice is at 100% of its 7d limit', detail: full });
  assert.deepStrictEqual(moveMessage({ ok: true, target: 'Bob', sessions: 3, moved: [], already: ['1', '2'], skipped: [{ pid: '3', why: full, limit: true }] }),
    { ok: false, text: '1 stayed: Alice is at 100% of its 7d limit', detail: full });
});

test('no answer, or a damaged one, is said as such and never as a success', () => {
  assert.strictEqual(moveMessage(null).ok, false);
  assert.strictEqual(moveMessage({}).ok, false);
  assert.strictEqual(moveMessage({ ok: false }).text, 'Not moved: The launcher refused');
  assert.strictEqual(moveMessage({ ok: true, moved: 'x', skipped: 'y', sessions: 1 }).text, 'Every session is already on that account');
});
