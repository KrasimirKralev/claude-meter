var usageData = null;
var calendarOpen = false;
var animatingPcts = { session: 0, weekAll: 0, weekSonnet: 0 };
var lastSyncError = null; // persists error message until next successful sync

function createElement(tag, cls, text) {
  var el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

// --- Setup overlay (first-launch onboarding) ---
function showSetupOverlay() {
  var overlay = document.getElementById('setupOverlay');
  var rows = document.getElementById('usageRows');
  var footer = document.querySelector('.footer');
  overlay.classList.add('visible');
  rows.style.display = 'none';
  if (footer) footer.style.display = 'none';
}

function hideSetupOverlay() {
  var overlay = document.getElementById('setupOverlay');
  var rows = document.getElementById('usageRows');
  var footer = document.querySelector('.footer');
  overlay.classList.remove('visible');
  rows.style.display = '';
  if (footer) footer.style.display = '';
}

function formatResetTime(ts) {
  if (!ts) return '';
  var d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  var diff = d.getTime() - Date.now();
  if (diff <= 0) return 'Resetting...';
  // If more than 24h, show date
  if (diff > 86400000) {
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var h = d.getHours();
    var ampm = h >= 12 ? 'pm' : 'am';
    var h12 = h % 12 || 12;
    var min = d.getMinutes();
    var minStr = min > 0 ? ':' + (min < 10 ? '0' : '') + min : '';
    return 'Resets ' + months[d.getMonth()] + ' ' + d.getDate() + ', ' + h12 + minStr + ampm;
  }
  // Under 24h: live countdown
  var hours = Math.floor(diff / 3600000);
  var mins = Math.floor((diff % 3600000) / 60000);
  if (hours > 0) return 'Resets in ' + hours + 'h ' + mins + 'm';
  if (mins > 0) return 'Resets in ' + mins + 'm';
  return 'Resets in ' + Math.max(1, Math.floor(diff / 1000)) + 's';
}

function getBarClass(pct) {
  if (pct >= 85) return 'danger';
  if (pct >= 60) return 'warning';
  return '';
}

function animateNumbers(from, to, key, duration) {
  var start = performance.now();
  function step(now) {
    var elapsed = now - start;
    var progress = Math.min(elapsed / duration, 1);
    // Ease out cubic
    var eased = 1 - Math.pow(1 - progress, 3);
    animatingPcts[key] = Math.round(from + (to - from) * eased);
    var el = document.getElementById(key + 'Pct');
    if (el) el.textContent = animatingPcts[key] + '%';
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

var SEG_COUNT = 12;

function renderUsageRow(container, data, key) {
  while (container.firstChild) container.removeChild(container.firstChild);
  if (!data) return;

  // Card tint follows usage level
  container.classList.remove('state-warning', 'state-danger');
  var barClass = getBarClass(data.pct);
  if (barClass === 'warning') container.classList.add('state-warning');
  else if (barClass === 'danger') container.classList.add('state-danger');

  // Label row with pct
  var labelRow = createElement('div', 'usage-label');
  var labelText = createElement('span', 'usage-label-text', data.label);
  var pctEl = createElement('span', 'bar-pct', data.pct + '%');
  if (key) pctEl.id = key + 'Pct';
  labelRow.appendChild(labelText);
  labelRow.appendChild(pctEl);
  container.appendChild(labelRow);

  // Block-segment meter: N chunky cells, filled count = pct
  var barContainer = createElement('div', 'bar-container');
  var segs = createElement('div', 'segs');
  var pct = Math.max(0, Math.min(100, data.pct || 0));
  var filled = Math.round(pct / 100 * SEG_COUNT);
  if (pct > 0 && filled === 0) filled = 1; // never show 0 blocks for non-zero usage
  var fillCls = barClass === 'danger' ? 'fr' : (barClass === 'warning' ? 'fy' : 'f');
  for (var s = 0; s < SEG_COUNT; s++) {
    segs.appendChild(createElement('div', 'seg' + (s < filled ? ' ' + fillCls : '')));
  }
  barContainer.appendChild(segs);
  container.appendChild(barContainer);

  if (data.resetsAt) {
    container.appendChild(createElement('div', 'reset-info', formatResetTime(data.resetsAt)));
  }
}

function fmtMoney(minor, decimals, currency) {
  var d = (typeof decimals === 'number' && decimals >= 0) ? decimals : 2;
  var v = (Number(minor || 0) / Math.pow(10, d)).toFixed(d);
  if (currency === 'BGN') return v + ' лв';
  var sym = { EUR: '€', USD: '$', GBP: '£', JPY: '¥' }[currency] || ((currency || '') + ' ');
  return sym + v;
}

// Extra usage inline strip — spend this month toward the monthly limit
function renderExtraUsage(eu) {
  var section = document.getElementById('extraSection');
  if (!section) return;
  if (!eu || !eu.enabled) { section.style.display = 'none'; return; }
  section.style.display = '';

  var strip = document.getElementById('extraStrip');
  var amtEl = document.getElementById('extraAmt');
  var fillEl = document.getElementById('extraFill');
  var pctEl = document.getElementById('extraPct');

  var used = eu.usedMinor, limit = eu.limitMinor, dec = eu.decimals;
  var pct;
  if (typeof eu.percent === 'number') pct = eu.percent;
  else if (limit) pct = Math.round(used / limit * 100);
  else if (typeof eu.utilization === 'number') pct = Math.round(eu.utilization);
  else pct = 0;
  var clamped = Math.max(0, Math.min(100, pct));

  amtEl.textContent = (used != null) ? fmtMoney(used, dec, eu.currency) : '—';
  fillEl.style.width = clamped + '%';
  fillEl.className = 'es-fill' + ((pct >= 100 || eu.severity === 'critical') ? ' crit'
    : ((pct >= 80 || eu.severity === 'warning') ? ' warn' : ''));
  pctEl.textContent = pct + '%';

  var usedStr = (used != null) ? fmtMoney(used, dec, eu.currency) : '—';
  var limStr = (limit != null) ? fmtMoney(limit, dec, eu.currency) : null;
  if (strip) strip.title = 'Extra usage this month: ' + usedStr + (limStr ? ' of ' + limStr : '') + ' (' + pct + '%)';
}

function renderAll() {
  var data = usageData;
  if (!data) {
    // Clear bars so stale data doesn't show
    ['sessionRow', 'weekAllRow', 'weekSonnetRow'].forEach(function(id) {
      var row = document.getElementById(id);
      if (row) { while (row.firstChild) row.removeChild(row.firstChild); }
    });
    renderExtraUsage(null);
    updateFooter();
    return;
  }
  renderUsageRow(document.getElementById('sessionRow'), data.session, 'session');
  renderUsageRow(document.getElementById('weekAllRow'), data.weekAll, 'weekAll');
  renderUsageRow(document.getElementById('weekSonnetRow'), data.weekSonnet, 'weekSonnet');

  renderExtraUsage(data.extraUsage);

  updateTimers();
  if (typeof applyResponsiveScaling === 'function') applyResponsiveScaling();
}

// Update footer to reflect sync state
function updateFooter() {
  var footer = document.getElementById('footerHint');
  if (lastSyncError) {
    footer.textContent = lastSyncError;
    footer.className = 'footer-hint error';
  } else if (usageData && usageData.syncTime) {
    var ago = Math.round((Date.now() - usageData.syncTime) / 60000);
    footer.textContent = ago < 1 ? 'Synced just now' : 'Synced ' + ago + 'm ago';
    footer.className = ago >= 5 ? 'footer-hint stale' : 'footer-hint';
  } else {
    footer.textContent = 'Syncing...';
    footer.className = 'footer-hint';
  }
}

// Lightweight timer update — only changes text, no DOM rebuild
function updateTimers() {
  var data = usageData;
  if (!data) return;

  // Update countdown text for each row
  var rows = [
    { id: 'sessionRow', data: data.session },
    { id: 'weekAllRow', data: data.weekAll },
    { id: 'weekSonnetRow', data: data.weekSonnet },
  ];
  for (var i = 0; i < rows.length; i++) {
    var rowEl = document.getElementById(rows[i].id);
    if (!rowEl) continue;
    var resetEl = rowEl.querySelector('.reset-info');
    if (resetEl && rows[i].data && rows[i].data.resetsAt) {
      resetEl.textContent = formatResetTime(rows[i].data.resetsAt);
    }
  }

  updateFooter();
}

function setSyncStatus(status) {
  var dot = document.getElementById('statusDot');
  var badge = document.getElementById('syncStatus');

  if (status === 'syncing') {
    dot.className = 'dot syncing';
    badge.className = 'sync-status syncing';
    badge.textContent = '';
    badge.appendChild(createElement('span', 'mini-dot'));
    badge.appendChild(document.createTextNode(' SYNCING'));
  } else if (status === 'live') {
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

// Listen for usage updates from main process
window.electronAPI.onUsageUpdate(function(data) {
  var oldData = usageData;
  usageData = data;
  lastSyncError = null; // clear error on successful sync
  hideSetupOverlay();
  renderAll();
  setSyncStatus('live');

  // Animate percentage changes
  if (oldData) {
    var keys = ['session', 'weekAll', 'weekSonnet'];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var oldPct = oldData[k] ? oldData[k].pct : 0;
      var newPct = data[k] ? data[k].pct : 0;
      if (oldPct !== newPct) {
        animateNumbers(oldPct, newPct, k, 600);
        var rowId = k === 'session' ? 'sessionRow' : (k === 'weekAll' ? 'weekAllRow' : 'weekSonnetRow');
        var barEl = document.getElementById(rowId);
        if (barEl) {
          var meter = barEl.querySelector('.segs') || barEl.querySelector('.bar-fill');
          if (meter) { meter.classList.remove('bar-pulse'); void meter.offsetWidth; meter.classList.add('bar-pulse'); }
        }
      }
    }
  }
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

// Usage rows open the dashboard on its usage overview
['sessionRow', 'weekAllRow', 'weekSonnetRow', 'extraRow'].forEach(function(id) {
  var rowEl = document.getElementById(id);
  if (!rowEl) return;
  rowEl.style.cursor = 'pointer';
  rowEl.title = 'Open usage overview';
  rowEl.addEventListener('click', function() {
    window.electronAPI.openDashboard('overview');
  });
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
    return;
  }

  var inc = status.incidents[0];
  nameEl.textContent = inc.name;
  var components = (inc.components || []).map(shortComponentName).join(', ');
  var started = inc.startedAt ? 'Started ' + relativeTime(inc.startedAt) : '';
  metaEl.textContent = [components, started].filter(Boolean).join(' \u00B7 ');
  banner.className = 'claude-status-banner ' + status.indicator + ' visible';
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
    if (!usageData) return;
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
    var badge = document.getElementById('tasksBadge');
    if (data.tasks > 0) {
      badge.textContent = data.tasks;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }
  if (data.calendar !== undefined) {
    var calBadge = document.getElementById('calBadge');
    if (data.calendar > 0) {
      calBadge.textContent = data.calendar;
      calBadge.classList.remove('hidden');
    } else {
      calBadge.classList.add('hidden');
    }
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
});

document.getElementById('overdueBannerClose').addEventListener('click', function(e) {
  e.stopPropagation();
  document.getElementById('overdueBanner').classList.remove('visible');
});

// Clicking the overdue banner itself opens the Calendar (where the event lives)
document.getElementById('overdueBanner').addEventListener('click', function() {
  window.electronAPI.openCalendar();
});

// --- Theme system ---
window.electronAPI.onThemeUpdate(function(theme) {
  var root = document.documentElement;
  root.style.setProperty('--bg', theme.bg);
  root.style.setProperty('--surface', theme.surface);
  root.style.setProperty('--surface2', theme.surface2);
  root.style.setProperty('--border', theme.border);
  root.style.setProperty('--text', theme.text);
  root.style.setProperty('--text-dim', theme.textDim);
  root.style.setProperty('--accent', theme.accent);
  if (theme.green) root.style.setProperty('--green', theme.green);
  if (theme.red) root.style.setProperty('--red', theme.red);
  if (theme.yellow) root.style.setProperty('--yellow', theme.yellow);
  if (theme.barBg) root.style.setProperty('--bar-bg', theme.barBg);
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
  ringText.className = 'pomo-ring-text' + (state === 'running' ? ' active' : (state === 'break' ? ' break' : ''));

  // Ring text
  ringText.textContent = state === 'idle' ? String(mins) : String(mins).padStart(2, '0');

  // Tooltip
  tooltipTime.textContent = String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
  tooltipTime.className = 'pomo-tooltip-time' + (state === 'running' ? ' active' : (state === 'break' ? ' break' : ''));
  tooltipLabel.textContent = state === 'break' ? 'Break' : (state === 'running' ? 'Focus' : (state === 'paused' ? 'Paused' : 'Pomodoro'));

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

// --- Widget Calendar ---
var widgetCalColorMap = { blue: '#60a5fa', green: '#4ade80', orange: '#fb923c', red: '#f87171', purple: '#c084fc' };

function widgetCalToday() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function renderWidgetCalendar(events, forceShow) {
  var container = document.getElementById('widgetCalendar');
  var todayEl = document.getElementById('widgetCalEvents');
  var upcomingEl = document.getElementById('widgetCalUpcomingEvents');
  var todayHeader = document.getElementById('widgetCalToday');
  var upcomingHeader = document.getElementById('widgetCalUpcoming');

  while (todayEl.firstChild) todayEl.removeChild(todayEl.firstChild);
  while (upcomingEl.firstChild) upcomingEl.removeChild(upcomingEl.firstChild);

  var today = widgetCalToday();
  var todayEvents = (events || []).filter(function(e) { return e.date === today; });
  var futureEvents = (events || []).filter(function(e) { return e.date > today; });

  todayEvents.sort(function(a, b) {
    if (!a.time && b.time) return -1;
    if (a.time && !b.time) return 1;
    return (a.time || '').localeCompare(b.time || '');
  });
  futureEvents.sort(function(a, b) {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return (a.time || '').localeCompare(b.time || '');
  });

  // Always show if there are today events — user shouldn't miss them
  var hasTodayEvents = todayEvents.length > 0;
  if (!forceShow && !calendarOpen && !hasTodayEvents && futureEvents.length === 0) {
    container.classList.remove('visible');
    return;
  }

  container.classList.add('visible');

  // Today events
  todayHeader.style.display = '';
  if (todayEvents.length > 0) {
    for (var i = 0; i < todayEvents.length; i++) {
      todayEl.appendChild(buildWidgetCalEvent(todayEvents[i], false));
    }
  } else {
    var noToday = createElement('div', 'widget-cal-event');
    noToday.style.color = 'var(--text-dim)';
    noToday.style.fontSize = '10px';
    noToday.textContent = 'No events today';
    todayEl.appendChild(noToday);
  }

  // Upcoming (next 3)
  if (futureEvents.length > 0) {
    upcomingHeader.style.display = '';
    var max = Math.min(3, futureEvents.length);
    for (var j = 0; j < max; j++) {
      upcomingEl.appendChild(buildWidgetCalEvent(futureEvents[j], true));
    }
  } else {
    upcomingHeader.style.display = 'none';
  }
}

function buildWidgetCalEvent(evt, showDate) {
  var row = createElement('div', 'widget-cal-event');

  var dot = createElement('div', 'widget-cal-dot');
  var dotColor = widgetCalColorMap[evt.color] || widgetCalColorMap.blue;
  dot.style.background = dotColor;
  row.appendChild(dot);

  var timeEl = createElement('div', 'widget-cal-time');
  if (showDate) {
    var parts = evt.date.split('-');
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    timeEl.textContent = months[parseInt(parts[1], 10) - 1] + ' ' + parseInt(parts[2], 10);
  } else if (evt.time) {
    // Show relative time for today's events
    var now = Date.now();
    var evtMs = new Date(evt.date + 'T' + evt.time).getTime();
    var diff = evtMs - now;
    if (diff > 0 && diff < 60 * 60 * 1000) {
      var mins = Math.round(diff / 60000);
      timeEl.textContent = 'in ' + mins + 'm';
      timeEl.style.color = dotColor;
      timeEl.style.fontWeight = '700';
    } else if (diff >= -30 * 60 * 1000 && diff <= 0) {
      timeEl.textContent = 'NOW';
      timeEl.style.color = 'var(--red)';
      timeEl.style.fontWeight = '700';
      dot.style.boxShadow = '0 0 6px ' + dotColor;
    } else {
      timeEl.textContent = evt.time;
    }
  } else {
    timeEl.textContent = 'All day';
  }
  row.appendChild(timeEl);

  var titleEl = createElement('div', 'widget-cal-title');
  titleEl.textContent = evt.title;
  row.appendChild(titleEl);

  row.style.cursor = 'pointer';
  row.title = evt.title;
  row.addEventListener('click', function() {
    // Calendar events open the Calendar window, not the generic dashboard
    window.electronAPI.openCalendar();
  });

  return row;
}

window.electronAPI.getCalendarEvents().then(function(events) {
  renderWidgetCalendar(events);
});

window.electronAPI.onCalendarUpdate(function(events) {
  renderWidgetCalendar(events);
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

  function makeBadge(kind, label, on) {
    var el = document.createElement('span');
    el.className = 'widget-habits-badge' + (on ? ' on' : '');
    el.setAttribute('data-kind', kind);
    el.setAttribute('role', 'button');
    el.setAttribute('aria-pressed', on ? 'true' : 'false');
    el.title = (on ? 'Unmark' : 'Mark') + ' today as ' + label.toLowerCase();

    var box = document.createElement('span');
    box.className = 'widget-habits-checkbox';
    box.textContent = on ? '✓' : '';
    el.appendChild(box);

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

    // Always show the widget once habits are present in the system
    box.style.display = 'block';

    var todayStr = ymd(new Date());
    var t = (habits.training || []).indexOf(todayStr) !== -1;
    var r = (habits.reading || []).indexOf(todayStr) !== -1;
    var l = (habits.learning || []).indexOf(todayStr) !== -1;
    if (todayBadges) {
      while (todayBadges.firstChild) todayBadges.removeChild(todayBadges.firstChild);
      todayBadges.appendChild(makeBadge('training', 'Train', t));
      todayBadges.appendChild(makeBadge('reading', 'Read', r));
      todayBadges.appendChild(makeBadge('learning', 'Learn', l));
    }
  }

  var habitsBox = document.getElementById('widgetHabits');
  if (habitsBox) {
    habitsBox.addEventListener('click', function(e) {
      // Only open dashboard when the click isn't on a badge
      var t = e.target;
      while (t && t !== habitsBox) {
        if (t.classList && t.classList.contains('widget-habits-badge')) return;
        t = t.parentNode;
      }
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

  // Re-fetch and re-render once per minute so the day count auto-ticks past midnight
  setInterval(function() {
    if (!window.electronAPI || !window.electronAPI.getHabits) return;
    window.electronAPI.getHabits().then(function(data) { if (data) render(data); });
  }, 60 * 1000);
})();
