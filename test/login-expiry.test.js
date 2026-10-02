// node --test test/login-expiry.test.js - when each login runs out, without Electron.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const login = require('../login-expiry');

// Local-time instants, so the expected strings hold in any timezone.
const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi || 0).getTime();
const NOW = at(2026, 10, 2, 20, 47);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const CMD = 'cm-login marketing marketing@example.com';

const facts = (over) => Object.assign(
  { access: true, refresh: true, expiresAt: NOW + 8 * HOUR, refreshExpiresAt: at(2026, 11, 1, 3, 44) },
  over || {}
);
const read = (over) => ({ missing: false, mtimeMs: 1000, facts: facts(over) });

test('credsFacts keeps presence and timestamps, never a token value', () => {
  const doc = {
    claudeAiOauth: {
      accessToken: 'ACCESS-TOKEN-VALUE', refreshToken: 'REFRESH-TOKEN-VALUE',
      expiresAt: 1790995000000, refreshTokenExpiresAt: 1793497440000, scopes: ['user:profile'],
    },
  };
  const f = login.credsFacts(doc);
  assert.deepStrictEqual(f, { access: true, refresh: true, expiresAt: 1790995000000, refreshExpiresAt: 1793497440000 });
  assert.ok(JSON.stringify(f).indexOf('TOKEN-VALUE') < 0);
  assert.deepStrictEqual(
    login.credsFacts({ claudeAiOauth: { accessToken: '', refreshToken: null, expiresAt: 'soon' } }),
    { access: false, refresh: false, expiresAt: null, refreshExpiresAt: null }
  );
  assert.strictEqual(login.credsFacts({}), null);
  assert.strictEqual(login.credsFacts(null), null);
});

test('readCredsFacts: missing file, broken file, real file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-login-expiry-'));
  try {
    const file = path.join(dir, '.credentials.json');
    assert.deepStrictEqual(login.readCredsFacts(file), { missing: true, mtimeMs: 0, facts: null });
    fs.writeFileSync(file, '{"claudeAiOauth": {"accessTo');
    const broken = login.readCredsFacts(file);
    assert.strictEqual(broken.missing, false);
    assert.strictEqual(broken.facts, null);
    assert.ok(broken.mtimeMs > 0);
    fs.writeFileSync(file, JSON.stringify({ claudeAiOauth: { accessToken: 'a', refreshToken: 'r', refreshTokenExpiresAt: 5 } }));
    assert.deepStrictEqual(login.readCredsFacts(file).facts, { access: true, refresh: true, expiresAt: null, refreshExpiresAt: 5 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('classifyLogin: ok, amber within three days, red when nothing can authenticate', () => {
  assert.strictEqual(login.classifyLogin(read(), NOW).state, 'ok');
  assert.strictEqual(login.classifyLogin(read({ refreshExpiresAt: NOW + 3 * DAY + 1 }), NOW).state, 'ok');
  assert.strictEqual(login.classifyLogin(read({ refreshExpiresAt: NOW + 3 * DAY - 1 }), NOW).state, 'warn');
  assert.strictEqual(login.classifyLogin(read({ refreshExpiresAt: NOW + HOUR }), NOW).state, 'warn');
  // An expired access token alone is fine - Claude Code refreshes it.
  assert.strictEqual(login.classifyLogin(read({ expiresAt: NOW - HOUR }), NOW).state, 'ok');

  assert.deepStrictEqual(login.classifyLogin(read({ refreshExpiresAt: NOW }), NOW), { state: 'out', reason: 'login expired' });
  assert.deepStrictEqual(login.classifyLogin(read({ refresh: false }), NOW), { state: 'out', reason: 'refresh token missing' });
  assert.deepStrictEqual(login.classifyLogin(read({ access: false }), NOW), { state: 'out', reason: 'logged out' });
  assert.deepStrictEqual(login.classifyLogin(read({ access: false, refresh: false }), NOW), { state: 'out', reason: 'logged out' });
  assert.deepStrictEqual(login.classifyLogin({ missing: true, mtimeMs: 0, facts: null }, NOW), { state: 'out', reason: 'logged out' });
  assert.deepStrictEqual(login.classifyLogin(read(), NOW, 'sign-in rejected'), { state: 'out', reason: 'sign-in rejected' });
  // A file that could not be parsed is never evidence of a dead login.
  assert.strictEqual(login.classifyLogin({ missing: false, mtimeMs: 1, facts: null }, NOW).state, 'unknown');
});

test('formatLeft: calendar days, then hours and minutes on the last day', () => {
  assert.strictEqual(login.formatLeft(at(2026, 11, 1, 3, 44), NOW), '30 d');
  assert.strictEqual(login.formatLeft(at(2026, 10, 30, 14, 9), NOW), '28 d');
  assert.strictEqual(login.formatLeft(at(2026, 10, 30, 0, 30), NOW), '28 d');
  assert.strictEqual(login.formatLeft(at(2026, 10, 4, 20, 48), NOW), '2 d');
  assert.strictEqual(login.formatLeft(NOW + 7 * HOUR + 59 * 60000, NOW), '7 h');
  assert.strictEqual(login.formatLeft(NOW + 45 * 60000, NOW), '45 m');
  assert.strictEqual(login.formatLeft(NOW - 1, NOW), '0 m');
});

test('dates and times are fixed-format, not locale-dependent', () => {
  const t = at(2026, 11, 1, 3, 44);
  assert.strictEqual(login.formatDate(t), '01 Nov');
  assert.strictEqual(login.formatTime(t), '03:44');
  assert.strictEqual(login.formatDateTime(t), 'Sun 01 Nov 03:44');
});

test('loginCommand: cm-login by dir name when available, else plain claude auth login', () => {
  assert.strictEqual(
    login.loginCommand({ dir: '/home/u/.claude-marketing', email: 'marketing@example.com', cmLogin: true }), CMD);
  assert.strictEqual(login.loginCommand({ dir: '/home/u/.claude', email: null, cmLogin: true }), 'cm-login default');
  assert.strictEqual(
    login.loginCommand({ dir: '/home/u/.claude-work', email: 'w@example.com', cmLogin: false }),
    'CLAUDE_CONFIG_DIR=/home/u/.claude-work claude auth login');
  assert.strictEqual(
    login.loginCommand({ dir: '/srv/other', email: 'o@example.com', cmLogin: true }),
    'CLAUDE_CONFIG_DIR=/srv/other claude auth login');
});

test('findCmLogin: an executable on PATH or in ~/.local/bin', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-login-home-'));
  try {
    const bin = path.join(home, '.local', 'bin');
    fs.mkdirSync(bin, { recursive: true });
    assert.strictEqual(login.findCmLogin('', home), false);
    fs.writeFileSync(path.join(bin, 'cm-login'), '#!/bin/sh\n', { mode: 0o644 });
    assert.strictEqual(login.findCmLogin('', home), false, 'not executable');
    fs.chmodSync(path.join(bin, 'cm-login'), 0o755);
    assert.strictEqual(login.findCmLogin('', home), true);
    assert.strictEqual(login.findCmLogin(bin, null), true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('clxVerdict: only "token rejected", only for the same dir and the same file', () => {
  const cache = {
    marketing: { dir: '/h/.claude-marketing', auth: 'token rejected (http-401)', credsMtime: 1790000100.25 },
    work: { dir: '/h/.claude-work', auth: 'login expired', credsMtime: 1790000000.1235 },
    _meta: { usageCalls: 3 },
  };
  const mtimeMs = 1790000100250;
  assert.strictEqual(login.clxVerdict(cache, '/h/.claude-marketing', mtimeMs), 'token rejected (http-401)');
  assert.strictEqual(login.clxVerdict(cache, '/h/.claude-marketing', mtimeMs + 5000), null, 're-logged since');
  assert.strictEqual(login.clxVerdict(cache, '/h/.claude-work', 1790000000123.5), null);
  assert.strictEqual(login.clxVerdict(cache, '/h/.claude-other', mtimeMs), null);
  assert.strictEqual(login.clxVerdict(null, '/h/.claude-marketing', mtimeMs), null);
});

test('describeLogin: the strings each state renders', () => {
  const ok = login.describeLogin(read(), NOW, { command: CMD });
  assert.strictEqual(ok.state, 'ok');
  assert.strictEqual(ok.short, '01 Nov · 30 d');
  assert.strictEqual(ok.text, 'Login until 01 Nov · 30 d');
  assert.strictEqual(ok.detail, 'Login until Sun 01 Nov 03:44 (30 d left)');
  assert.strictEqual(ok.until, at(2026, 11, 1, 3, 44));

  const warn = login.describeLogin(read({ refreshExpiresAt: at(2026, 10, 4, 9, 5) }), NOW, { command: CMD });
  assert.strictEqual(warn.state, 'warn');
  assert.strictEqual(warn.short, '04 Oct · 2 d');
  assert.strictEqual(warn.text, 'Login until 04 Oct 09:05 · 2 d — renew: ' + CMD);

  const lastDay = login.describeLogin(read({ refreshExpiresAt: NOW + 5 * HOUR + 10 * 60000 }), NOW, { command: CMD });
  assert.strictEqual(lastDay.short, '03 Oct · 5 h');

  const expired = login.describeLogin(read({ refreshExpiresAt: at(2026, 10, 2, 3, 44) }), NOW, { command: CMD });
  assert.strictEqual(expired.state, 'out');
  assert.strictEqual(expired.short, 'Logged out');
  assert.strictEqual(expired.text, 'Logged out — run: ' + CMD);
  assert.strictEqual(expired.detail, 'Login expired Fri 02 Oct 03:44 — run: ' + CMD);

  const blank = login.describeLogin(read({ access: false, refresh: false }), NOW, { command: CMD });
  assert.strictEqual(blank.text, 'Logged out — run: ' + CMD);
  assert.strictEqual(blank.detail, 'Logged out — run: ' + CMD);

  const rejected = login.describeLogin(read(), NOW, { command: CMD, rejected: 'token rejected (http-401)' });
  assert.strictEqual(rejected.state, 'out');
  assert.strictEqual(rejected.detail, 'Token rejected (http-401) — run: ' + CMD);

  const old = login.describeLogin(read({ refreshExpiresAt: null }), NOW, { command: CMD });
  assert.strictEqual(old.state, 'ok');
  assert.strictEqual(old.text, 'Login expiry unknown');

  const unreadable = login.describeLogin({ missing: false, mtimeMs: 1, facts: null }, NOW, { command: CMD });
  assert.strictEqual(unreadable.state, 'unknown');
  assert.strictEqual(unreadable.text, '');
});

test('loginSignature changes with what is drawn, not with the clock alone', () => {
  const a = login.describeLogin(read(), NOW, { command: CMD });
  const b = login.describeLogin(read(), NOW + 60000, { command: CMD });
  assert.strictEqual(login.loginSignature([a]), login.loginSignature([b]));
  const c = login.describeLogin(read(), NOW + DAY, { command: CMD });
  assert.notStrictEqual(login.loginSignature([a]), login.loginSignature([c]));
  const fresh = login.describeLogin(read({ refreshExpiresAt: at(2026, 11, 2, 10, 0) }), NOW, { command: CMD });
  assert.notStrictEqual(login.loginSignature([a]), login.loginSignature([fresh]));
});
