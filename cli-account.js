// Which account the meter marks Active, from the launcher's record
// (~/.claude/active-account.json). Pure: no file, no clock.
//
// Only a record written by a launcher SESSION counts - it carries `session_dir`.
// Headless runs (a scheduled `claude -p` on another account) rewrite the same
// file through the same hook, without it; following those would move the tray
// badge and the alerts to an account nobody is typing on.

function normalizeEmail(email) {
  return (typeof email === 'string' && email) ? email.trim().toLowerCase() : '';
}

// marker: the parsed record, or anything else when there is none.
// accounts: [{ id, email, enabled? }] - the accounts the meter shows.
// Returns that account's id, or null to leave Active where it is.
function cliAccountId(marker, accounts) {
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) return null;
  if (typeof marker.session_dir !== 'string' || !marker.session_dir.trim()) return null;
  const email = normalizeEmail(marker.email);
  if (!email || !Array.isArray(accounts)) return null;
  for (const account of accounts) {
    if (account && account.enabled !== false && normalizeEmail(account.email) === email) return account.id;
  }
  return null;
}

// The name the launcher knows an account by: `~/.claude-bob` -> "bob".
// The shared settings home (`~/.claude`) holds no login and has none.
function launcherAccountKey(dir) {
  if (typeof dir !== 'string') return null;
  const base = dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
  const match = /^\.claude-([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(base);
  return match ? match[1] : null;
}

// The move helper prints one JSON object. Anything else is no answer.
function readMoveResult(stdout) {
  try {
    const data = JSON.parse(String(stdout || '').trim());
    return (data && typeof data === 'object' && !Array.isArray(data)) ? data : null;
  } catch { return null; }
}

function count(list) { return Array.isArray(list) ? list.length : 0; }

// What the clicked page says, in one short line; `detail` is the whole reason for a tooltip.
function moveMessage(result) {
  if (!result) return { ok: false, text: 'The launcher did not answer', detail: '' };
  const to = typeof result.target === 'string' && result.target ? result.target : 'that account';
  const skipped = Array.isArray(result.skipped) ? result.skipped : [];
  const why = skipped.length && skipped[0] && typeof skipped[0].why === 'string' ? skipped[0].why : '';
  if (!result.ok) {
    const error = typeof result.error === 'string' && result.error ? result.error : 'The launcher refused';
    return { ok: false, text: 'Not moved: ' + error.split(';')[0], detail: error };
  }
  const moved = count(result.moved);
  const stayed = skipped.length;
  if (moved > 0) {
    return {
      ok: true,
      text: 'Moved ' + moved + (moved === 1 ? ' session' : ' sessions') + ' to ' + to
        + (stayed ? ', ' + stayed + ' stayed' : ''),
      detail: why,
    };
  }
  if (!result.sessions) return { ok: true, text: 'No session is running: nothing to move', detail: '' };
  if (stayed) return { ok: false, text: stayed + ' stayed: ' + why.split(';')[0], detail: why };
  return { ok: true, text: 'Every session is already on ' + to, detail: '' };
}

module.exports = { cliAccountId, launcherAccountKey, readMoveResult, moveMessage };
