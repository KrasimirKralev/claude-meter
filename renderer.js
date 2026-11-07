var WL = window.WidgetLib;
var usageData = null;     // the active account's usage: the extra strip and "Synced" follow it
var lastSyncError = null; // persists error message until next successful sync
var syncing = false;
var syncingSince = 0;
// Some syncs end with no message, so "Syncing..." may not hide how old the numbers are for long.
var SYNCING_LIMIT_MS = 20000;
var accountsData = [];    // one entry per enabled account, from the usage-update payload
var activeAccountId = null;
// The account the user just clicked. A usage-update already in flight still
// carries the previous active id, and must not undo the click.
var pendingAccountId = null;
var pendingAccountTimer = null;
// Name the CLI launcher reports for itself; falls back to the product name.
var cliLauncherName = 'Claude Code';

function createElement(tag, cls, text) {
  var el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

// --- Setup overlay (first-launch onboarding) ---
function showSetupOverlay() {
  // With several accounts, the logged-out row says so and offers its own login command. This
  // screen's Sign In doesn't know which account it would log in to.
  if (accountsData.length > 1) return;
  document.getElementById('setupOverlay').classList.add('visible');
  document.querySelector('.widget').classList.add('setup');
  reportMinHeight();
}

function hideSetupOverlay() {
  document.getElementById('setupOverlay').classList.remove('visible');
  document.querySelector('.widget').classList.remove('setup');
  reportMinHeight();
}



var fmtMoney = WL.money;

// Extra usage inline strip — spend this month toward the monthly limit
function renderExtraUsage(eu) {
  var section = document.getElementById('extraSection');
  if (!section) return;
  if (!eu || !eu.enabled) { section.style.display = 'none'; return; }
  section.style.display = '';

  var strip = document.getElementById('extraStrip');
  var amtEl = document.getElementById('extraAmt');
  var cellsEl = document.getElementById('extraCells');
  var pctEl = document.getElementById('extraPct');

  var used = eu.usedMinor, limit = eu.limitMinor, dec = eu.decimals;
  var pct;
  if (typeof eu.percent === 'number') pct = eu.percent;
  else if (limit) pct = Math.round(used / limit * 100);
  else if (typeof eu.utilization === 'number') pct = Math.round(eu.utilization);
  else pct = 0;
  var clamped = Math.max(0, Math.min(100, pct));

  amtEl.textContent = (used != null) ? fmtMoney(used, dec, eu.currency) : '—';
  while (cellsEl.firstChild) cellsEl.removeChild(cellsEl.firstChild);
  cellsEl.appendChild(buildCells({
    label: 'Current extra usage',
    pct: clamped,
    severity: (pct >= 100 || eu.severity === 'critical') ? 'critical'
      : ((pct >= 80 || eu.severity === 'warning') ? 'warning' : 'normal'),
  }, false));
  pctEl.textContent = pct + '%';

  var usedStr = (used != null) ? fmtMoney(used, dec, eu.currency) : '—';
  var limStr = (limit != null) ? fmtMoney(limit, dec, eu.currency) : null;
  if (strip) strip.title = 'Extra usage this month: ' + usedStr + (limStr ? ' of ' + limStr : '') + ' (' + pct + '%)';
}

// --- Account board: every account at once, so choosing between them takes one glance ---

function getActiveAccount() {
  for (var i = 0; i < accountsData.length; i++) {
    if (accountsData[i].id === activeAccountId) return accountsData[i];
  }
  return accountsData.length > 0 ? accountsData[0] : null;
}

function clearPendingAccount() {
  pendingAccountId = null;
  if (pendingAccountTimer) { clearTimeout(pendingAccountTimer); pendingAccountTimer = null; }
}

function buildCells(meter, small) {
  var grade = WL.meterClass(meter);
  var cells = createElement('span', 'cells' + (small ? ' s' : '')
    + (grade === 'danger' ? ' hot' : (grade === 'warning' ? ' warm' : '')));
  cells.setAttribute('role', 'img');
  cells.setAttribute('aria-label', WL.shortLabel(meter) + ', ' + meter.pct + '% used');
  var filled = WL.filledCells(meter.pct);
  for (var i = 0; i < WL.CELLS; i++) cells.appendChild(createElement('u', i < filled ? 'on' : undefined));
  return cells;
}

function selectAccount(acc) {
  if (acc.id === activeAccountId) return;
  activeAccountId = acc.id;
  clearPendingAccount();
  pendingAccountId = acc.id;
  // Safety net: never pin the choice for longer than one sync round.
  pendingAccountTimer = setTimeout(clearPendingAccount, 8000);
  if (window.electronAPI.setActiveAccount) {
    window.electronAPI.setActiveAccount(acc.id).then(function(res) {
      if (!res || !res.success) clearPendingAccount();
    }, clearPendingAccount);
  }
  // Re-render from the payload we already have: switching never refetches.
  showActiveAccountUsage();
}

// The whole story of an account, for whoever hovers: e-mail, login end, and the fix when it's broken.
function accountTooltip(acc) {
  var login = acc.login;
  if (acc.needsLogin || (login && login.state === 'out')) {
    return (login && login.state === 'out')
      ? login.detail
      : 'Run: ' + ((login && login.command) || 'CLAUDE_CONFIG_DIR=' + (acc.dir || '') + ' claude auth login');
  }
  if (acc.error) return acc.name + ': ' + acc.error;
  return acc.name + (acc.email ? ' · ' + acc.email : '') + (login && login.detail ? '\n' + login.detail : '');
}

// Each limit keeps its own refill time here, because the row only prints one of them.
function meterTooltip(meter, now) {
  var refill = WL.refillText(meter.resetsAt, now);
  return WL.shortLabel(meter) + ': ' + meter.pct + '% used' + (refill ? ', refills ' + refill : '');
}

function loginCommand(acc) {
  return (acc.login && acc.login.command) || 'CLAUDE_CONFIG_DIR=' + (acc.dir || '') + ' claude auth login';
}

// Copies the command rather than running it: a login has to land in this account's own folder, and
// CLAUDE.md's rule is to check the e-mail it reports.
function buildLoginButton(acc) {
  var button = createElement('button', 'login-btn', 'Copy login command');
  button.title = loginCommand(acc);
  button.addEventListener('click', function(e) {
    e.stopPropagation();
    navigator.clipboard.writeText(loginCommand(acc)).then(function() {
      button.textContent = 'Copied, paste it in a terminal';
    }, function() {
      button.textContent = loginCommand(acc);
    });
  });
  return button;
}

// Called every second by the timer, so it only touches the page when the words change.
function setRowText(el, state) {
  var key = state.alert + '|' + state.detail;
  if (el.getAttribute('data-text') === key) return;
  el.setAttribute('data-text', key);
  while (el.firstChild) el.removeChild(el.firstChild);
  // Two whole pieces: when they don't fit on one line, they break between them, never inside.
  if (state.alert) el.appendChild(createElement('strong', null, state.alert));
  if (state.alert && state.detail) el.appendChild(document.createTextNode(' '));
  if (state.detail) el.appendChild(createElement('span', null, state.detail));
}

function buildAccountRow(acc, index) {
  var state = WL.rowState(acc, Date.now());
  var active = acc.id === activeAccountId;
  var name = acc.name || acc.id;
  // With one account there is nothing to choose between, so nothing to highlight.
  var chosen = active && accountsData.length > 1;
  var row = createElement('li', 'acct' + (chosen ? ' active' : '')
    + (state.main && WL.meterClass(state.main) === 'danger' ? ' crit' : '')
    + (state.status === 'limited' || state.status === 'error' || state.status === 'out' ? ' stale' : ''));
  row.setAttribute('role', 'button');
  row.setAttribute('tabindex', '0');
  row.setAttribute('aria-pressed', chosen ? 'true' : 'false');
  row.setAttribute('data-id', acc.id);
  row.title = accountTooltip(acc);

  var bullet = createElement('span', 'bullet b-' + (index % 4), name.charAt(0).toUpperCase());
  bullet.setAttribute('aria-hidden', 'true');
  row.appendChild(bullet);

  var who = createElement('div', 'who');
  var nameEl = createElement('span', 'name');
  nameEl.appendChild(createElement('span', 'name-text', name));
  if (chosen) nameEl.appendChild(createElement('em', null, 'Active'));
  if (acc.cliActive) {
    var cli = createElement('em', 'cli', 'CLI');
    cli.title = cliLauncherName + ' is running on this account';
    nameEl.appendChild(cli);
  }
  who.appendChild(nameEl);
  var reset = createElement('span', 'reset');
  setRowText(reset, state);
  who.appendChild(reset);
  row.appendChild(who);

  var meters = createElement('div', 'meters');
  if (state.status === 'out') {
    // Old bars say nothing once logged out. Getting back in is the only thing left to do.
    meters.appendChild(buildLoginButton(acc));
  } else if (state.main) {
    var now = Date.now();
    var mainLabel = WL.labelMeter(state.main, acc.usage);
    if (mainLabel) meters.appendChild(createElement('span', 'lab wide', mainLabel));
    var mainCells = buildCells(state.main, false);
    mainCells.classList.add('wide');
    mainCells.title = meterTooltip(state.main, now);
    meters.appendChild(mainCells);
    state.subs.forEach(function(meter) {
      var lab = createElement('span', 'lab', WL.shortLabel(meter) + ' ' + meter.pct + '%');
      lab.title = meterTooltip(meter, now);
      meters.appendChild(lab);
      var cells = buildCells(meter, true);
      cells.title = lab.title;
      meters.appendChild(cells);
    });
  } else {
    row.classList.add('no-meters');
  }
  if (!row.classList.contains('no-meters')) row.appendChild(meters);

  var pct = createElement('div', 'pct');
  if (state.main) {
    pct.appendChild(createElement('b', null, String(state.main.pct)));
    pct.appendChild(createElement('small', null, '%'));
  }
  row.appendChild(pct);

  row.addEventListener('click', function() { selectAccount(acc); });
  row.addEventListener('keydown', function(e) {
    // Keys pressed on a button inside the row belong to that button.
    if (e.target !== row || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    selectAccount(acc);
  });
  return { acc: acc, reset: reset, row: row };
}

var boardRows = [];
var lastPcts = {};

function renderAccountBoard() {
  var board = document.getElementById('accountTabs');
  var focused = document.activeElement && document.activeElement.getAttribute('data-id');
  while (board.firstChild) board.removeChild(board.firstChild);
  boardRows = accountsData.map(buildAccountRow);
  boardRows.forEach(function(entry) {
    board.appendChild(entry.row);
    var main = WL.rowMeters(entry.acc.usage).main;
    var previous = lastPcts[entry.acc.id];
    if (main) {
      // One brief flash on the row whose number just moved.
      if (previous !== undefined && previous !== main.pct) entry.row.querySelector('.cells').classList.add('bar-pulse');
      lastPcts[entry.acc.id] = main.pct;
    }
    if (entry.acc.id === focused) entry.row.focus();
  });
}

function renderAnswer() {
  var el = document.getElementById('answerLine');
  var parts = WL.answerParts(accountsData, Date.now());
  var key = JSON.stringify(parts);
  if (el.getAttribute('data-key') === key) return;
  el.setAttribute('data-key', key);
  while (el.firstChild) el.removeChild(el.firstChild);
  el.hidden = !parts || (!parts.most && !parts.full && !parts.nextText);
  if (el.hidden) return;
  if (parts.full) {
    el.appendChild(createElement('b', null, parts.of ? 'Every readable account is full.' : 'Every account is full.'));
  } else if (parts.most) {
    el.appendChild(createElement('b', null, parts.most));
    el.appendChild(document.createTextNode(' has the most room'
      + (parts.of ? ' of ' + parts.of + ' readable accounts.' : '.')));
  }
  if (parts.nextText) {
    if (el.firstChild) el.appendChild(document.createTextNode(' '));
    el.appendChild(document.createTextNode('Next refill: '));
    var who = [parts.nextName, parts.nextKind].filter(Boolean).join(' ');
    el.appendChild(createElement('b', null, (who ? who + ', ' : '') + parts.nextText));
    el.appendChild(document.createTextNode('.'));
  }
}

// Paint everything that depends on the accounts. The extra-usage strip follows the active one.
function showActiveAccountUsage() {
  renderAccountBoard();
  renderAnswer();
  var active = getActiveAccount();
  var data = active ? active.usage : null;
  var state = active ? WL.rowState(active, Date.now()) : null;
  usageData = data;
  if (!data) {
    lastSyncError = active ? (active.name || active.id) + ': ' + (state.alert || state.detail) : 'No account';
    setSyncStatus('stale');
    if (accountsData.length > 1) hideSetupOverlay();
  } else {
    lastSyncError = state.status === 'limited' ? state.detail : null;
    hideSetupOverlay();
    setSyncStatus(state.status === 'limited' ? 'stale' : 'live');
  }
  renderExtraUsage(data ? data.extraUsage : null);
  updateFooter();
  if (typeof reportMinHeight === 'function') reportMinHeight();
}

function updateFooter() {
  var footer = document.getElementById('footerHint');
  if (lastSyncError) {
    footer.textContent = lastSyncError;
    footer.className = 'footer-hint error';
  } else if (syncing && Date.now() - syncingSince < SYNCING_LIMIT_MS) {
    footer.textContent = 'Syncing...';
    footer.className = 'footer-hint';
  } else if (usageData && usageData.syncTime) {
    var ago = Math.round((Date.now() - usageData.syncTime) / 60000);
    footer.textContent = ago < 1 ? 'Synced just now' : 'Synced ' + ago + 'm ago';
    footer.className = ago >= 5 ? 'footer-hint stale' : 'footer-hint';
  } else {
    footer.textContent = 'Syncing...';
    footer.className = 'footer-hint';
  }
}

// Lightweight timer update: only changes text, no rebuild.
function updateTimers() {
  var now = Date.now();
  boardRows.forEach(function(entry) { setRowText(entry.reset, WL.rowState(entry.acc, now)); });
  renderAnswer();
  updateFooter();
}

function setSyncStatus(status) {
  var dot = document.getElementById('statusDot');
  var badge = document.getElementById('syncStatus');

  // Only the first of a run of syncs starts the clock: offline, they keep arriving every few seconds.
  if (status === 'syncing' && !syncing) syncingSince = Date.now();
  syncing = status === 'syncing';
  if (status === 'syncing') {
    dot.className = 'dot syncing';
    badge.className = 'sync-status syncing';
    badge.textContent = '';
    badge.appendChild(createElement('span', 'mini-dot'));
    badge.appendChild(document.createTextNode(' SYNCING'));
  } else if (status === 'live') {
    dot.className = 'dot';
    void dot.offsetWidth;   // reflow: restarts the finite pulse on each sync
    dot.className = 'dot live';
    badge.className = 'sync-status live';
    badge.textContent = '';
    badge.appendChild(createElement('span', 'mini-dot'));
    badge.appendChild(document.createTextNode(' LIVE'));
  } else {
    dot.className = 'dot stale';
    badge.className = 'sync-status';
    badge.textContent = '';
  }
}

// IPC bridge
document.getElementById('minimizeBtn').addEventListener('click', function() {
  window.electronAPI.minimize(); // yellow: minimize widget only
});

document.getElementById('closeBtn').addEventListener('click', function() {
  window.electronAPI.minimize(); // red: hide all panels (same as hotkey hide)
});

// Block dblclick on all header buttons so it doesn't trigger compact toggle
document.querySelectorAll('.header button').forEach(function(btn) {
  btn.addEventListener('dblclick', function(e) { e.stopPropagation(); });
});
// Double-click title bar to toggle compact mode
document.querySelector('.header').addEventListener('dblclick', function(e) {
  if (e.target.closest('button')) return;
  document.body.classList.toggle('compact');
  window.electronAPI.toggleCompact(document.body.classList.contains('compact'));
});

// Listen for usage updates from main process. The payload carries every
// enabled account plus which one is active; the meters show the active one.
window.electronAPI.onUsageUpdate(function(payload) {
  if (payload && Array.isArray(payload.accounts)) {
    accountsData = payload.accounts;
    if (typeof payload.cliLauncher === 'string' && payload.cliLauncher) {
      cliLauncherName = payload.cliLauncher;
    }
    if (pendingAccountId && payload.activeAccountId !== pendingAccountId) {
      // Main has not applied the click yet — hold the user's choice.
      activeAccountId = pendingAccountId;
    } else {
      clearPendingAccount();
      activeAccountId = payload.activeAccountId
        || (accountsData[0] ? accountsData[0].id : null);
    }
  } else if (payload && payload.session) {
    // Defensive: a bare usage object (pre-multi-account payload)
    accountsData = [{ id: 'default', name: '', email: null, usage: payload, error: null, needsLogin: false }];
    activeAccountId = 'default';
  } else {
    return;
  }
  showActiveAccountUsage();
});

window.electronAPI.onSyncStart(function() {
  setSyncStatus('syncing');
});

window.electronAPI.onSyncError(function(msg) {
  setSyncStatus('stale');
  if (msg && (msg.indexOf('OAuth') >= 0 || msg.indexOf('re-authenticate') >= 0)) {
    showSetupOverlay();
  } else if (msg) {
    lastSyncError = 'Sync failed';
  }
});

var pendingWidgetUpdate = null;

window.electronAPI.onUpdateAvailable(function(data) {
  pendingWidgetUpdate = data;
  var btn = document.getElementById('updateBtn');
  btn.textContent = 'Update v' + data.latestVersion;
  btn.classList.add('visible');
  reportMinHeight();
});

window.electronAPI.onUpdateProgress(function(pct) {
  var btn = document.getElementById('updateBtn');
  btn.textContent = pct + '% downloaded';
  btn.style.backgroundSize = pct + '% 100%, 100% 100%';
});

document.getElementById('updateBtn').addEventListener('click', function() {
  if (!pendingWidgetUpdate) return;
  var btn = document.getElementById('updateBtn');

  if (!pendingWidgetUpdate.downloadUrl) {
    btn.textContent = 'No installer found';
    setTimeout(function() {
      btn.textContent = 'Update v' + pendingWidgetUpdate.latestVersion;
    }, 3000);
    return;
  }

  btn.textContent = 'Downloading...';
  btn.disabled = true;
  btn.classList.add('downloading');

  window.electronAPI.installUpdate().then(function(result) {
    if (result.success) {
      btn.textContent = 'Installing...';
      btn.classList.remove('downloading');
      btn.style.backgroundSize = '';
      btn.style.background = 'linear-gradient(90deg, #6366f1, #a855f7, #ec4899)';
    } else {
      btn.textContent = 'Failed — retry';
      btn.classList.remove('downloading');
      btn.style.backgroundSize = '';
      btn.style.background = '';
      setTimeout(function() {
        btn.textContent = 'Update v' + pendingWidgetUpdate.latestVersion;
        btn.disabled = false;
      }, 3000);
    }
  }).catch(function() {
    btn.textContent = 'Failed — retry';
    btn.classList.remove('downloading');
    btn.style.backgroundSize = '';
    btn.style.background = '';
    btn.disabled = false;
  });
});

document.getElementById('dashBtn').addEventListener('click', function() {
  window.electronAPI.openDashboard();
});
document.getElementById('dashBtn').addEventListener('dblclick', function(e) {
  e.stopPropagation();
});

document.getElementById('tasksBtn').addEventListener('click', function() {
  window.electronAPI.openTasks();
});
document.getElementById('tasksBtn').addEventListener('dblclick', function(e) {
  e.stopPropagation();
});

document.getElementById('notesBtn').addEventListener('click', function() {
  window.electronAPI.openNotes();
});
document.getElementById('notesBtn').addEventListener('dblclick', function(e) { e.stopPropagation(); });

document.getElementById('calendarBtn').addEventListener('click', function() {
  window.electronAPI.openCalendar();
});
document.getElementById('calendarBtn').addEventListener('dblclick', function(e) {
  e.stopPropagation();
});

// Extra usage strip opens the usage overview too
(function() {
  var strip = document.getElementById('extraStrip');
  if (!strip) return;
  strip.addEventListener('click', function() { window.electronAPI.openDashboard('overview'); });
})();

// Task streak badge opens the Tasks window (it tracks task completion streaks)
(function() {
  var streak = document.getElementById('streakBadge');
  if (!streak) return;
  streak.style.cursor = 'pointer';
  streak.title = 'Task completion streak — open Tasks';
  streak.addEventListener('click', function(e) {
    e.stopPropagation();
    window.electronAPI.openTasks();
  });
})();

// Manual refresh button
document.getElementById('refreshBtn').addEventListener('click', function() {
  var btn = document.getElementById('refreshBtn');
  btn.classList.add('spinning');
  window.electronAPI.requestSync();
  setTimeout(function() {
    btn.classList.remove('spinning');
  }, 1000);
});

// --- First-launch auth check ---
window.electronAPI.checkAuthStatus().then(function(status) {
  if (!status.authenticated) {
    showSetupOverlay();
    if (!status.claudeCodeInstalled) {
      // Claude Code not installed — show install link, change button text
      document.getElementById('setupDesc').textContent =
        'Claude Code is required. Install it first, then sign in.';
      document.getElementById('setupSignInBtn').style.display = 'none';
      document.getElementById('setupInstallLink').style.display = '';
      document.getElementById('setupInstallLink').textContent = 'Download Claude Code';
    }
  } else {
    window.electronAPI.requestSync();
  }
});

// Sign In button — launches claude auth login
document.getElementById('setupSignInBtn').addEventListener('click', function() {
  var btn = document.getElementById('setupSignInBtn');
  var waiting = document.getElementById('setupWaiting');
  btn.disabled = true;
  btn.textContent = 'Opening browser...';
  window.electronAPI.launchAuthLogin().then(function(result) {
    if (result.success) {
      btn.style.display = 'none';
      waiting.style.display = '';
    } else {
      btn.textContent = 'Sign In';
      btn.disabled = false;
      document.getElementById('setupDesc').textContent =
        'Could not launch login. Run "claude auth login" in a terminal.';
    }
  });
});

// Install Claude Code link — opens download page in browser
document.getElementById('setupInstallLink').addEventListener('click', function() {
  window.electronAPI.openExternalUrl('https://docs.anthropic.com/en/docs/claude-code/getting-started');
});

// Auto-hide overlay when credentials appear
window.electronAPI.onAuthStatusChanged(function(data) {
  if (data.authenticated) {
    hideSetupOverlay();
  } else {
    showSetupOverlay();
  }
});

// --- Claude official status banner ---
function relativeTime(isoStr) {
  if (!isoStr) return '';
  var diff = Date.now() - new Date(isoStr).getTime();
  if (diff < 0) return 'just now';
  if (diff < 60000) return 'just now';
  var mins = Math.floor(diff / 60000);
  if (mins < 60) return mins + 'm ago';
  var hrs = Math.floor(diff / 3600000);
  if (hrs < 24) return hrs + 'h ago';
  return Math.floor(diff / 86400000) + 'd ago';
}

function shortComponentName(name) {
  var lower = name.toLowerCase();
  if (lower.indexOf('api.anthropic.com') >= 0 || lower.indexOf('claude api') >= 0) return 'API';
  if (lower.indexOf('claude.ai') >= 0) return 'claude.ai';
  if (lower.indexOf('claude code') >= 0) return 'Claude Code';
  if (lower.indexOf('console') >= 0 || lower.indexOf('platform') >= 0) return 'Console';
  if (lower.indexOf('government') >= 0) return 'Gov';
  return name.split(' ')[0];
}

function updateClaudeStatusBanner(status) {
  var banner = document.getElementById('claudeStatusBanner');
  var nameEl = document.getElementById('claudeStatusName');
  var metaEl = document.getElementById('claudeStatusMeta');
  if (!banner || !nameEl || !metaEl) return;

  if (!status || !status.incidents || status.incidents.length === 0 || status.indicator === 'none') {
    banner.className = 'claude-status-banner';
    reportMinHeight();
    return;
  }

  var inc = status.incidents[0];
  nameEl.textContent = inc.name;
  var components = (inc.components || []).map(shortComponentName).join(', ');
  var started = inc.startedAt ? 'Started ' + relativeTime(inc.startedAt) : '';
  metaEl.textContent = [components, started].filter(Boolean).join(' \u00B7 ');
  banner.className = 'claude-status-banner ' + status.indicator + ' visible';
  reportMinHeight();
}

window.electronAPI.getClaudeStatus().then(function(status) {
  updateClaudeStatusBanner(status);
});

window.electronAPI.onClaudeStatusUpdate(function(status) {
  updateClaudeStatusBanner(status);
});

document.getElementById('claudeStatusBanner').addEventListener('click', function() {
  window.electronAPI.openExternalUrl('https://status.claude.com');
});

// Update countdown + "synced X ago" every second (lightweight, no DOM rebuild)
// Pauses while window is hidden to avoid unnecessary CPU wakeups
var timerInterval = null;
function startTimerInterval() {
  if (timerInterval) return;
  timerInterval = setInterval(function() {
    if (!accountsData.length) return;
    updateTimers();
  }, 1000);
}
function stopTimerInterval() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}
document.addEventListener('visibilitychange', function() {
  if (document.hidden) { stopTimerInterval(); } else { startTimerInterval(); }
});
startTimerInterval();

// --- JS-based window drag (entire widget is draggable, buttons are excluded) ---
(function() {
  var dragging = false;
  var startX = 0;
  var startY = 0;
  var moveScheduled = false;
  var pendingDx = 0;
  var pendingDy = 0;

  var SKIP_TAGS = { BUTTON: 1, INPUT: 1, SELECT: 1, TEXTAREA: 1, A: 1, SVG: 1 };

  function isInteractive(el) {
    while (el && el !== document.body) {
      if (SKIP_TAGS[el.tagName]) return true;
      if (el.classList && (el.classList.contains('dash-btn') || el.classList.contains('win-btn')
        || el.classList.contains('pomo-ring-wrap')
        || el.classList.contains('refresh-btn') || el.classList.contains('footer-update-btn')
        || el.classList.contains('acct') || el.classList.contains('widget-habits-badge')
        || el.classList.contains('pomo-tooltip') || el.classList.contains('icon-badge'))) return true;
      el = el.parentElement;
    }
    return false;
  }

  document.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return;
    if (isInteractive(e.target)) return;
    dragging = true;
    startX = e.screenX;
    startY = e.screenY;
    pendingDx = 0;
    pendingDy = 0;
    document.body.style.cursor = 'grabbing';
    // Do NOT call e.preventDefault() — it breaks drag on Mica/transparent windows
  });

  document.addEventListener('mousemove', function(e) {
    if (!dragging) return;
    pendingDx += e.screenX - startX;
    pendingDy += e.screenY - startY;
    startX = e.screenX;
    startY = e.screenY;
    if (!moveScheduled) {
      moveScheduled = true;
      requestAnimationFrame(function() {
        if (pendingDx !== 0 || pendingDy !== 0) {
          window.electronAPI.moveBy(pendingDx, pendingDy);
          pendingDx = 0;
          pendingDy = 0;
        }
        moveScheduled = false;
      });
    }
  });

  document.addEventListener('mouseup', function() {
    if (dragging) {
      dragging = false;
      document.body.style.cursor = '';
      // Flush any remaining movement
      if (pendingDx !== 0 || pendingDy !== 0) {
        window.electronAPI.moveBy(pendingDx, pendingDy);
        pendingDx = 0;
        pendingDy = 0;
      }
    }
  });
})();

// --- Toggle animation ---
window.electronAPI.onToggleAnimate(function(dir) {
  var widget = document.querySelector('.widget');
  if (!widget) return;
  if (dir === 'in') {
    // Keep widget invisible until animation starts — prevents flash
    widget.style.opacity = '0';
    widget.classList.remove('fade-in', 'fade-out');
    void widget.offsetWidth;
    widget.style.opacity = '';
    widget.classList.add('fade-in');
  } else {
    widget.classList.remove('fade-in', 'fade-out');
    void widget.offsetWidth;
    widget.classList.add('fade-out');
  }
});

// --- Badge updates ---
window.electronAPI.onBadgeUpdate(function(data) {
  if (data.tasks !== undefined) {
    tasksLeft = data.tasks;
    renderToday();
  }
});

// --- Streak display ---
window.electronAPI.onStreakUpdate(function(data) {
  var badge = document.getElementById('streakBadge');
  var count = document.getElementById('streakCount');
  if (data && data.current > 0) {
    count.textContent = data.current;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
});

// --- Overdue event banner ---
window.electronAPI.onEventOverdue(function(data) {
  var banner = document.getElementById('overdueBanner');
  document.getElementById('overdueBannerText').textContent = data.title;
  document.getElementById('overdueBannerTime').textContent = data.time || 'today';
  banner.classList.add('visible');
  reportMinHeight();
});

document.getElementById('overdueBannerClose').addEventListener('click', function(e) {
  e.stopPropagation();
  document.getElementById('overdueBanner').classList.remove('visible');
  reportMinHeight();
});

// Clicking the overdue banner itself opens the Calendar (where the event lives)
document.getElementById('overdueBanner').addEventListener('click', function() {
  window.electronAPI.openCalendar();
});

// --- Theme system ---
window.electronAPI.onThemeUpdate(function(theme) {
  UI.applyTheme(theme);
  // The widget's own ground may be translucent, where the window system allows it.
  document.documentElement.style.setProperty('--bg', theme.bg);
});

// --- Snap glow effect ---
window.electronAPI.onSnapGlow(function() {
  var widget = document.querySelector('.widget');
  if (widget) {
    widget.classList.remove('snap-glow');
    void widget.offsetWidth;
    widget.classList.add('snap-glow');
  }
});

// --- Pomodoro Ring Timer (state lives in main process) ---
var POMO_CIRC = 2 * Math.PI * 11; // r=11 from SVG

function pomoUpdateRing(data) {
  var state = data.state;
  var seconds = data.seconds;
  var total = data.total;
  var mins = Math.floor(seconds / 60);
  var secs = seconds % 60;
  var ringFill = document.getElementById('pomoRingFill');
  var ringText = document.getElementById('pomoRingText');
  var tooltipTime = document.getElementById('pomoTooltipTime');
  var tooltipLabel = document.getElementById('pomoTooltipLabel');
  var startBtn = document.getElementById('pomoStartBtn');

  // Ring progress
  var progress = total > 0 ? seconds / total : 1;
  ringFill.style.strokeDashoffset = POMO_CIRC * (1 - progress);

  // Ring style
  var fillCls = 'pomo-ring-fill';
  if (state === 'break') fillCls += ' break';
  else if (state === 'idle') fillCls += ' idle';
  else fillCls += ' running';
  ringFill.className = fillCls;
  document.getElementById('pomoRing').classList.toggle('idle', state === 'idle');
  ringText.className = 'pomo-ring-text' + (state === 'running' ? ' active' : (state === 'break' ? ' break' : ''));

  // Ring text
  ringText.textContent = (state === 'break' ? 'Break ' : 'Focus ') + (state === 'idle' ? String(mins) : String(mins).padStart(2, '0'));

  // Tooltip
  tooltipTime.textContent = String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
  tooltipTime.className = 'pomo-tooltip-time' + (state === 'running' ? ' active' : (state === 'break' ? ' break' : ''));
  tooltipLabel.textContent = state === 'break' ? 'Break' : (state === 'running' ? 'Focus' : (state === 'paused' ? 'Paused' : 'Focus'));

  if (state === 'running') startBtn.textContent = 'Pause';
  else if (state === 'paused') startBtn.textContent = 'Resume';
  else if (state === 'break') startBtn.textContent = 'Skip';
  else startBtn.textContent = 'Start';
}

function showPomoCelebration(type) {
  var banner = document.getElementById('pomoCelebration');
  var textEl = document.getElementById('celebText');
  var container = document.getElementById('confettiContainer');
  var isBreak = type === 'break';

  textEl.textContent = isBreak ? 'Break over \u2014 Ready to focus!' : 'Focus session complete!';
  banner.querySelector('.celeb-sub').textContent = isBreak ? 'Start another session' : 'Time for a 5 min break';

  while (container.firstChild) container.removeChild(container.firstChild);
  var colors = ['#facc15', '#f87171', '#60a5fa', '#4ade80', '#c084fc', '#fb923c', '#f472b6'];
  for (var i = 0; i < 30; i++) {
    var piece = document.createElement('div');
    piece.className = 'confetti';
    piece.style.left = Math.random() * 100 + '%';
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDelay = (Math.random() * 0.8) + 's';
    piece.style.animationDuration = (1.5 + Math.random()) + 's';
    piece.style.width = (4 + Math.random() * 4) + 'px';
    piece.style.height = (4 + Math.random() * 4) + 'px';
    piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '1px';
    container.appendChild(piece);
  }
  banner.classList.add('visible');
  setTimeout(function() { banner.classList.remove('visible'); }, 4000);
}

// Listen for state updates from main process
window.electronAPI.onPomoUpdate(function(data) { pomoUpdateRing(data); });
window.electronAPI.onPomoComplete(function(type) { showPomoCelebration(type); });

// Buttons send commands to main process
document.getElementById('pomoStartBtn').addEventListener('click', function(e) {
  e.stopPropagation();
  window.electronAPI.pomoStart();
});

document.getElementById('pomoResetBtn').addEventListener('click', function(e) {
  e.stopPropagation();
  window.electronAPI.pomoReset();
});

// Click ring to toggle tooltip
var pomoTooltipOpen = false;
document.getElementById('pomoRing').addEventListener('click', function(e) {
  e.stopPropagation();
  pomoTooltipOpen = !pomoTooltipOpen;
  document.getElementById('pomoTooltip').classList.toggle('open', pomoTooltipOpen);
});
document.getElementById('pomoRing').addEventListener('dblclick', function(e) { e.stopPropagation(); });
document.addEventListener('click', function() {
  if (pomoTooltipOpen) {
    pomoTooltipOpen = false;
    document.getElementById('pomoTooltip').classList.remove('open');
  }
});
document.getElementById('pomoTooltip').addEventListener('click', function(e) { e.stopPropagation(); });

// Load initial state
window.electronAPI.pomoGet().then(function(data) { pomoUpdateRing(data); });

// --- Today: the next event and the tasks left, on one line ---
var todayEvents = [];
var tasksLeft = null;
var nextJoinLink = null;

function eventJoinLink(evt) {
  if (evt.meetLink) return evt.meetLink;
  var match = typeof evt.title === 'string' && evt.title.match(/https:\/\/[^\s<>"']+/);
  return match ? match[0] : null;
}

function renderToday() {
  var nextEl = document.getElementById('nextEvent');
  var tasksEl = document.getElementById('tasksLeft');
  var now = Date.now();
  var upcoming = WL.upcomingEvents(todayEvents, now);
  var today = WL.localDay(now);
  var next = upcoming[0];
  while (nextEl.firstChild) nextEl.removeChild(nextEl.firstChild);
  nextJoinLink = null;
  if (next) {
    nextEl.appendChild(createElement('b', null, WL.eventTimeText(next, now)));
    nextEl.appendChild(document.createTextNode(' ' + PlanLib.eventTitle(next)));
    var moreToday = upcoming.filter(function(evt) { return evt.date === today; }).length - 1;
    if (next.date === today && moreToday > 0) nextEl.appendChild(createElement('span', 'more', ' +' + moreToday));
    nextJoinLink = eventJoinLink(next);
    nextEl.title = nextJoinLink ? 'Join meeting: ' + nextJoinLink : PlanLib.eventTitle(next);
  } else {
    nextEl.textContent = 'Nothing coming up';
    nextEl.title = 'Open the calendar';
  }
  tasksEl.textContent = tasksLeft ? '· ' + tasksLeft + (tasksLeft === 1 ? ' task' : ' tasks') + ' left' : '';
  if (typeof reportMinHeight === 'function') reportMinHeight();
}

document.getElementById('nextEvent').addEventListener('click', function() {
  if (nextJoinLink) window.electronAPI.openExternalUrl(nextJoinLink);
  else window.electronAPI.openCalendar();
});
document.getElementById('tasksLeft').addEventListener('click', function() {
  window.electronAPI.openTasks();
});

window.electronAPI.getCalendarEvents().then(function(events) {
  todayEvents = events || [];
  renderToday();
});

window.electronAPI.onCalendarUpdate(function(events) {
  todayEvents = events || [];
  renderToday();
});

// "in 12m" and "Now" go stale without any new data arriving.
setInterval(function() { if (!document.hidden) renderToday(); }, 30000);

// --- Maps ---
window.electronAPI.getMapsState().then(function(state) {
  document.getElementById('mapsBtn').hidden = !(state && state.available);
  if (typeof reportMinHeight === 'function') reportMinHeight();
});
document.getElementById('mapsBtn').addEventListener('click', function() {
  window.electronAPI.openMaps();
});

// --- Responsive scaling — glass panels adapt to widget size ---
function applyResponsiveScaling() {
  var widget = document.querySelector('.widget');
  if (!widget) return;
  var rect = widget.getBoundingClientRect();
  var h = rect.height;
  var w = rect.width;
  if (h === 0 || w === 0) return;
  // Sizing is fully CSS-driven via breakpoint classes.
  widget.classList.toggle('tight', h < 400);
  widget.classList.toggle('very-tight', h < 300);
  widget.classList.toggle('narrow', w < 320);
  reportMinHeight();
}

/* The window's minimum height tracks the content's natural height, so nothing
   can ever be clipped off the bottom — main grows the window if it's short. */
var minHeightTimer = null;
function reportMinHeight() {
  if (minHeightTimer) clearTimeout(minHeightTimer);
  minHeightTimer = setTimeout(function() {
    minHeightTimer = null;
    var widget = document.querySelector('.widget');
    if (!widget || !window.electronAPI.setMinContentHeight) return;
    // Measure the true natural height, then restore. Both happen in the same JS turn, so nothing
    // flashes. The widget must not shrink while measured: as a flex item it would report the
    // window's current height, and a too-short window could never grow.
    var prevHeight = widget.style.height;
    var prevShrink = widget.style.flexShrink;
    widget.style.height = 'max-content';
    widget.style.flexShrink = '0';
    var needed = Math.ceil(widget.getBoundingClientRect().height);
    widget.style.height = prevHeight;
    widget.style.flexShrink = prevShrink;
    if (needed > 40) window.electronAPI.setMinContentHeight(needed);
  }, 150);
}

// Set up ResizeObserver to call it on resize
(function() {
  var widget = document.querySelector('.widget');
  if (!widget || typeof ResizeObserver === 'undefined') return;
  var ro = new ResizeObserver(function() { applyResponsiveScaling(); });
  ro.observe(widget);
})();

// --- Habits in widget ---
(function() {
  if (!window.electronAPI || !window.electronAPI.getHabits) return;

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function ymd(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function parseYmd(s) {
    if (!s || typeof s !== 'string') return null;
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  }
  function daysBetween(a, b) {
    var aMid = new Date(a.getFullYear(), a.getMonth(), a.getDate());
    var bMid = new Date(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.round((bMid.getTime() - aMid.getTime()) / 86400000);
  }

  var HABIT_BADGES = [
    { kind: 'training', label: 'Train' },
    { kind: 'reading', label: 'Read/Write' },
    // Never pressed: it ticks itself when the day's last Relax break completes.
    { kind: 'relax', label: 'Relax', auto: true },
  ];
  var lastHabits = null;
  var relaxCount = null; // { done, total } from the Relax meter

  function tick() {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '13');
    svg.setAttribute('height', '13');
    svg.setAttribute('aria-hidden', 'true');
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'm6 12.5 4 4 8-9');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.8');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    return svg;
  }

  // Relax: a ring filling with the day's breaks and "Relax 2/4". It ticks itself, so a click does
  // nothing.
  function makeAutoBadge(label, on) {
    var el = document.createElement('span');
    el.className = 'widget-habits-badge auto' + (on ? ' on' : '');
    el.setAttribute('data-kind', 'relax');
    var done = relaxCount ? relaxCount.done : 0;
    var total = relaxCount ? relaxCount.total : 0;
    el.setAttribute('aria-label', label + (relaxCount ? ', ' + done + ' of ' + total + ' breaks today' : '')
      + (on ? ', done' : ''));
    el.title = on
      ? 'Relax done today'
      : 'Relax ticks itself when today\'s ' + (total || 'last') + ' breaks are done' + (relaxCount ? ' (' + done + ' so far)' : '');

    if (on) {
      el.appendChild(tick());
    } else {
      var ring = document.createElement('span');
      ring.className = 'widget-habits-ring';
      ring.style.setProperty('--p', (total > 0 ? Math.min(100, Math.round(done / total * 100)) : 0) + '%');
      el.appendChild(ring);
    }

    var text = document.createElement('span');
    text.textContent = label + (relaxCount && !on ? ' ' + done + '/' + total : '');
    el.appendChild(text);

    el.addEventListener('click', function(e) { e.stopPropagation(); });
    return el;
  }

  function makeBadge(kind, label, on) {
    var el = document.createElement('button');
    el.className = 'widget-habits-badge' + (on ? ' on' : '');
    el.setAttribute('data-kind', kind);
    el.setAttribute('aria-pressed', on ? 'true' : 'false');
    el.title = (on ? 'Unmark' : 'Mark') + ' today as ' + label.toLowerCase();

    if (on) el.appendChild(tick());
    var text = document.createElement('span');
    text.textContent = label;
    el.appendChild(text);

    el.addEventListener('click', function(e) {
      e.stopPropagation(); // don't trigger the parent open-dashboard
      var todayStr = ymd(new Date());
      if (window.electronAPI && window.electronAPI.toggleHabitDay) {
        window.electronAPI.toggleHabitDay(kind, todayStr).then(function(h) {
          if (h) render(h);
        });
      }
    });
    return el;
  }

  function render(habits) {
    var box = document.getElementById('widgetHabits');
    var todayBadges = document.getElementById('widgetHabitsTodayBadges');
    if (!box) return;
    lastHabits = habits;

    var todayStr = ymd(new Date());
    if (todayBadges) {
      while (todayBadges.firstChild) todayBadges.removeChild(todayBadges.firstChild);
      // `learning` stays in the file for its history but is no longer shown.
      HABIT_BADGES.forEach(function(b) {
        var on = (habits[b.kind] || []).indexOf(todayStr) !== -1;
        todayBadges.appendChild(b.auto ? makeAutoBadge(b.label, on) : makeBadge(b.kind, b.label, on));
      });
    }
    if (typeof reportMinHeight === 'function') reportMinHeight();
  }

  var habitsBox = document.getElementById('widgetHabits');
  if (habitsBox) {
    habitsBox.addEventListener('click', function(e) {
      // Only the empty part of the row opens the dashboard: everything else in it has its own job.
      if (e.target !== habitsBox) return;
      if (window.electronAPI && window.electronAPI.openDashboard) {
        // Clicking the streak area opens the Habits tab directly
        window.electronAPI.openDashboard('habits');
      }
    });
  }

  window.electronAPI.getHabits().then(function(data) {
    if (data) render(data);
  });
  if (window.electronAPI.onHabitsUpdate) {
    window.electronAPI.onHabitsUpdate(function(data) { render(data); });
  }
  function takeRelax(v) {
    if (!v) return;
    if (relaxCount && relaxCount.done === v.done && relaxCount.total === v.total) return;
    relaxCount = { done: v.done, total: v.total };
    if (lastHabits) render(lastHabits);
  }
  if (window.electronAPI.onRelaxUpdate) window.electronAPI.onRelaxUpdate(takeRelax);
  if (window.electronAPI.getRelax) window.electronAPI.getRelax().then(takeRelax);

  // Re-fetch and re-render once per minute so the day count auto-ticks past midnight
  setInterval(function() {
    if (!window.electronAPI || !window.electronAPI.getHabits) return;
    window.electronAPI.getHabits().then(function(data) { if (data) render(data); });
  }, 60 * 1000);
})();

// --- Relax meter (the schedule and the breaks live in main) ---
(function() {
  if (!window.electronAPI || !window.electronAPI.getRelax) return;
  var metaEl = document.getElementById('relaxMeta');
  var btn = document.getElementById('relaxNowBtn');
  if (!metaEl || !btn) return;
  var view = null;
  var clock = null;

  function mmss(ms) {
    var secs = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');
  }

  // Only a running countdown takes room on the row. The rest lives in the tooltip.
  function liveText(v) {
    if (v.phase === 'active') return 'Relaxing ' + mmss(v.endsAt - Date.now());
    if (v.phase === 'headsup') return 'Starts in ' + mmss(v.startsAt - Date.now());
    return '';
  }

  function nextText(v) {
    var count = v.total > 0 ? v.done + '/' + v.total : v.done + ' today';
    if (!v.enabled) return count + ', schedule off';
    if (!v.next) return count;
    if (v.next.tomorrow) {
      return count + (v.total > 0 && v.done >= v.total ? ', done for today' : ', next tomorrow at ' + v.next.time);
    }
    return count + ', next at ' + v.next.time + (v.next.retry ? ' (retry)' : '');
  }

  function render() {
    if (!view) return;
    metaEl.textContent = liveText(view);
    btn.hidden = view.phase === 'active';
    btn.textContent = view.phase === 'headsup' ? 'Start now' : 'Relax now';
    btn.title = 'Relax: ' + nextText(view)
      + (view.total > 0 ? '. ' + view.total + ' breaks a day, ' + view.minutes + ' min each.' : '');
    var ticking = view.phase === 'active' || view.phase === 'headsup';
    if (ticking && !clock) clock = setInterval(function() { if (view) metaEl.textContent = liveText(view); }, 1000);
    if (!ticking && clock) { clearInterval(clock); clock = null; }
    if (typeof reportMinHeight === 'function') reportMinHeight();
  }

  btn.addEventListener('click', function(e) {
    e.stopPropagation(); // the row itself opens the Habits tab
    window.electronAPI.relaxNow();
  });

  window.electronAPI.onRelaxUpdate(function(v) { if (v) { view = v; render(); } });
  window.electronAPI.getRelax().then(function(v) { if (v) { view = v; render(); } });
})();
