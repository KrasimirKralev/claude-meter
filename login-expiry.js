// Login expiry: when each account's Claude Code login runs out, read from its
// credentials file without ever touching a token value. Plain Node - main.js
// reads the files on its sync/discovery ticks and ships the result to the
// renderers, so everything here can be tested without Electron
// (test/login-expiry.test.js).
//
// A login lives as long as its refresh token. Claude Code refreshes the access
// token (~8 h to 1 day) on its own, but the refresh token hard-expires at
// `refreshTokenExpiresAt` (~30 days after the login) and a refresh never moves
// that date - only a new login does.

const fs = require('fs');
const path = require('path');

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
// Amber this long before the hard expiry (the same window clx warns in).
const WARN_MS = 3 * DAY_MS;
const DEFAULT_DIR_NAME = '.claude';
const NAMED_DIR_PREFIX = '.claude-';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function stamp(value) {
  return (typeof value === 'number' && Number.isFinite(value) && value > 0) ? value : null;
}

function present(value) {
  return typeof value === 'string' && value.length > 0;
}

// Presence flags and timestamps from a parsed credentials document. A token
// value never leaves this function. null = no OAuth block to judge.
function credsFacts(doc) {
  const oauth = (doc && typeof doc === 'object') ? doc.claudeAiOauth : null;
  if (!oauth || typeof oauth !== 'object') return null;
  return {
    access: present(oauth.accessToken),
    refresh: present(oauth.refreshToken),
    expiresAt: stamp(oauth.expiresAt),
    refreshExpiresAt: stamp(oauth.refreshTokenExpiresAt),
  };
}

// { missing, mtimeMs, facts } for one credentials file. An unreadable or
// half-written file gives facts: null, which is "cannot tell", never "dead".
function readCredsFacts(file) {
  let mtimeMs;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    return { missing: true, mtimeMs: 0, facts: null };
  }
  try {
    return { missing: false, mtimeMs, facts: credsFacts(JSON.parse(fs.readFileSync(file, 'utf-8'))) };
  } catch {
    return { missing: false, mtimeMs, facts: null };
  }
}

// 'out' = nothing left that can authenticate (or the server already said so),
// 'warn' = the hard expiry is under three days away, 'ok' otherwise and
// 'unknown' when the file could not be read.
function classifyLogin(read, now, rejected) {
  if (!read || read.missing) return { state: 'out', reason: 'logged out' };
  const facts = read.facts;
  if (!facts) return { state: 'unknown', reason: null };
  if (!facts.access) return { state: 'out', reason: 'logged out' };
  if (!facts.refresh) return { state: 'out', reason: 'refresh token missing' };
  if (facts.refreshExpiresAt && facts.refreshExpiresAt <= now) {
    return { state: 'out', reason: 'login expired' };
  }
  if (rejected) return { state: 'out', reason: rejected };
  if (facts.refreshExpiresAt && facts.refreshExpiresAt - now < WARN_MS) {
    return { state: 'warn', reason: null };
  }
  return { state: 'ok', reason: null };
}

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

// "01 Nov"
function formatDate(ts) {
  const d = new Date(ts);
  return pad2(d.getDate()) + ' ' + MONTHS[d.getMonth()];
}

// "03:44"
function formatTime(ts) {
  const d = new Date(ts);
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

// "Sun 01 Nov 03:44"
function formatDateTime(ts) {
  return WEEKDAYS[new Date(ts).getDay()] + ' ' + formatDate(ts) + ' ' + formatTime(ts);
}

// Whole calendar days between two instants, so "01 Nov" seen on 02 Oct reads
// "30 d" whatever the hour. Rounding absorbs 23/25-hour DST days.
function calendarDays(from, to) {
  const a = new Date(from);
  a.setHours(0, 0, 0, 0);
  const b = new Date(to);
  b.setHours(0, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

// "30 d", then "7 h" and "45 m" on the last day, when the hour matters.
function formatLeft(until, now) {
  const ms = until - now;
  if (ms < HOUR_MS) return Math.max(0, Math.floor(ms / MINUTE_MS)) + ' m';
  if (ms < DAY_MS) return Math.floor(ms / HOUR_MS) + ' h';
  return calendarDays(now, until) + ' d';
}

// The name cm-login knows a config dir by: ~/.claude-marketing -> "marketing",
// ~/.claude -> "default".
function cmLoginName(dir) {
  const base = path.basename(dir || '');
  if (base === DEFAULT_DIR_NAME) return 'default';
  if (base.indexOf(NAMED_DIR_PREFIX) === 0) return base.slice(NAMED_DIR_PREFIX.length);
  return null;
}

// The one command that renews this login. cm-login is a local helper some
// setups carry (it wraps `claude auth login` for one named config dir); without
// it, the plain Claude Code command for that dir.
function loginCommand(opts) {
  const name = opts.cmLogin ? cmLoginName(opts.dir) : null;
  if (name) return 'cm-login ' + name + (opts.email ? ' ' + opts.email : '');
  return 'CLAUDE_CONFIG_DIR=' + (opts.dir || '') + ' claude auth login';
}

// Is a cm-login executable on PATH (or in ~/.local/bin, which a desktop
// session's PATH often lacks)?
function findCmLogin(envPath, homeDir) {
  const dirs = String(envPath || '').split(path.delimiter).filter(Boolean);
  if (homeDir) dirs.push(path.join(homeDir, '.local', 'bin'));
  for (const dir of dirs) {
    try {
      fs.accessSync(path.join(dir, 'cm-login'), fs.constants.X_OK);
      return true;
    } catch { /* not here */ }
  }
  return false;
}

// clx (a launcher that also polls /usage) records a per-account `auth` verdict
// in its usage cache, measured against one exact credentials file. Only its
// "token rejected" verdict adds anything - the rest is what the file already
// says - and only while that same file is still in place.
function clxVerdict(cache, dir, mtimeMs) {
  if (!cache || typeof cache !== 'object' || !dir || !mtimeMs) return null;
  for (const key of Object.keys(cache)) {
    const entry = cache[key];
    if (!entry || typeof entry !== 'object' || entry.dir !== dir) continue;
    if (typeof entry.auth !== 'string' || entry.auth.indexOf('token rejected') !== 0) continue;
    if (typeof entry.credsMtime !== 'number') continue;
    if (Math.abs(entry.credsMtime * 1000 - mtimeMs) < 1) return entry.auth;
  }
  return null;
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Everything a renderer shows for one login, as ready-made strings:
//   short  - the tab's second line      "01 Nov · 30 d" | "Logged out"
//   text   - the account's own line     "Login until 01 Nov · 30 d"
//   detail - the hover text, with the exact time and the fix
function describeLogin(read, now, opts) {
  const o = opts || {};
  const command = o.command || '';
  const verdict = classifyLogin(read, now, o.rejected || null);
  const until = (read && read.facts && read.facts.refreshExpiresAt) || null;
  const info = { state: verdict.state, until, reason: verdict.reason, command, short: '', text: '', detail: '' };

  if (verdict.state === 'unknown') return info;
  if (verdict.state === 'out') {
    info.short = 'Logged out';
    info.text = 'Logged out — run: ' + command;
    const why = (verdict.reason === 'login expired' && until)
      ? 'Login expired ' + formatDateTime(until)
      : capitalize(verdict.reason || 'logged out');
    info.detail = why + ' — run: ' + command;
    return info;
  }
  if (!until) {
    // Older logins carry no refresh-token expiry at all.
    info.short = 'No expiry date';
    info.text = 'Login expiry unknown';
    info.detail = 'This login records no expiry date. Renew: ' + command;
    return info;
  }
  const left = formatLeft(until, now);
  info.short = formatDate(until) + ' · ' + left;
  info.detail = 'Login until ' + formatDateTime(until) + ' (' + left + ' left)';
  if (verdict.state === 'warn') {
    info.text = 'Login until ' + formatDate(until) + ' ' + formatTime(until) + ' · ' + left
      + ' — renew: ' + command;
    info.detail += ' — renew: ' + command;
  } else {
    info.text = 'Login until ' + info.short;
  }
  return info;
}

// What a renderer would draw differently - used to push a fresh payload only
// when a login line actually changed.
function loginSignature(infos) {
  return infos.map((i) => (i ? i.state + '|' + i.text + '|' + i.short : '-')).join('\n');
}

module.exports = {
  WARN_MS,
  credsFacts,
  readCredsFacts,
  classifyLogin,
  formatDate,
  formatTime,
  formatDateTime,
  formatLeft,
  cmLoginName,
  loginCommand,
  findCmLogin,
  clxVerdict,
  describeLogin,
  loginSignature,
};
