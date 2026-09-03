/* Dashboard renderer — safe DOM only (no innerHTML) */

var usageData = null;      // the ACTIVE account's usage — drives planner + chart
var accountsData = [];     // every enabled account, from the usage-update payload
var activeAccountId = null;
var cliLauncherName = 'Claude Code';
var historyData = [];
var chartDays = 7;
var alertThresholds = { session: 80, weekAll: 90, weekSonnet: 90 };
var claudeStatusData = null;

// --- Helpers ---

function el(tag, cls, text) {
  var node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function getBarClass(pct) {
  if (pct >= 85) return 'danger';
  if (pct >= 60) return 'warning';
  return '';
}

function formatCountdown(ts) {
  if (!ts) return '';
  var d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  var diff = d.getTime() - Date.now();
  if (diff <= 0) return 'Resetting...';
  if (diff > 86400000) {
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var h = d.getHours();
    var ampm = h >= 12 ? 'pm' : 'am';
    var h12 = h % 12 || 12;
    var min = d.getMinutes();
    var minStr = min > 0 ? ':' + (min < 10 ? '0' : '') + min : '';
    return 'Resets ' + months[d.getMonth()] + ' ' + d.getDate() + ', ' + h12 + minStr + ampm;
  }
  var hours = Math.floor(diff / 3600000);
  var mins = Math.floor((diff % 3600000) / 60000);
  if (hours > 0) return 'Resets in ' + hours + 'h ' + mins + 'm';
  if (mins > 0) return 'Resets in ' + mins + 'm';
  return 'Resets in ' + Math.max(1, Math.floor(diff / 1000)) + 's';
}

// --- Tab navigation ---

var navItems = document.querySelectorAll('.sidebar-nav li');
var tabPanels = document.querySelectorAll('.tab-content');

for (var i = 0; i < navItems.length; i++) {
  (function(item) {
    item.addEventListener('click', function() {
      for (var j = 0; j < navItems.length; j++) {
        navItems[j].classList.remove('active');
      }
      for (var k = 0; k < tabPanels.length; k++) {
        tabPanels[k].classList.remove('active');
      }
      item.classList.add('active');
      var tabId = 'tab-' + item.getAttribute('data-tab');
      var panel = document.getElementById(tabId);
      if (panel) panel.classList.add('active');

      // Redraw chart and fix pill slider when history tab becomes visible
      if (item.getAttribute('data-tab') === 'history') {
        requestAnimationFrame(function() { updateSlider(); });
        drawChart();
      }
      // Render analytics tab on click
      if (item.getAttribute('data-tab') === 'analytics') {
        renderAnalytics();
      }
      // Render calendar tab on click
      if (item.getAttribute('data-tab') === 'calendar') {
        renderCalendar();
      }
      // Render habits tab on click
      if (item.getAttribute('data-tab') === 'habits') {
        renderHabits();
      }
      // Render status tab on click
      if (item.getAttribute('data-tab') === 'status') {
        if (!claudeStatusData) {
          window.dashboardAPI.getClaudeStatus().then(function(data) {
            if (data) { claudeStatusData = data; renderStatusTab(); }
          });
        }
        renderStatusTab();
      }
    });
  })(navItems[i]);
}

// --- Overview ---

function buildUsageCard(label, data) {
  var card = el('div', 'usage-card');
  card.appendChild(el('div', 'card-label', label));

  var track = el('div', 'bar-track');
  var fill = el('div', 'bar-fill ' + getBarClass(data.pct));
  fill.style.width = Math.max(1, data.pct) + '%';
  track.appendChild(fill);
  card.appendChild(track);

  var meta = el('div', 'card-meta');
  meta.appendChild(el('span', null, data.pct + '% used'));
  meta.appendChild(el('span', null, formatCountdown(data.resetsAt)));
  card.appendChild(meta);

  return card;
}

// The four usage cards for one account's usage object, appended to `target`.
function appendUsageCards(target, usage) {
  target.appendChild(buildUsageCard('Session (5h window)', usage.session));
  target.appendChild(buildUsageCard('Weekly — All Models', usage.weekAll));
  target.appendChild(buildUsageCard('Weekly — Sonnet', usage.weekSonnet));

  // Extra usage card — same bar style as other metrics
  if (usage.extraUsage) {
    if (usage.extraUsage.enabled) {
      var util = Number(usage.extraUsage.utilization);
      var extraPct = Number.isFinite(util) ? Math.min(100, Math.max(0, Math.round(util))) : 0;
      target.appendChild(buildUsageCard('Extra Usage', { pct: extraPct, resetsAt: null }));
    } else {
      var extraCard = el('div', 'usage-card');
      extraCard.appendChild(el('div', 'card-label', 'Extra Usage'));
      extraCard.appendChild(el('div', 'card-meta', 'Not enabled'));
      target.appendChild(extraCard);
    }
  }
}

function buildAccountGroup(acc) {
  var group = el('div', 'account-group' + (acc.id === activeAccountId ? ' active' : ''));

  var head = el('div', 'account-group-head');
  var nameRow = el('div', 'account-group-name', acc.name || acc.id);
  if (acc.cliActive) {
    var cliTag = el('span', 'account-group-cli', 'CLI');
    cliTag.title = cliLauncherName + ' is running on this account';
    nameRow.appendChild(document.createTextNode(' '));
    nameRow.appendChild(cliTag);
  }
  head.appendChild(nameRow);
  if (acc.email) head.appendChild(el('div', 'account-group-email', acc.email));
  group.appendChild(head);

  var limitedMs = acc.rateLimitedUntil ? acc.rateLimitedUntil - Date.now() : 0;
  var limitedMins = limitedMs > 0 ? Math.max(1, Math.round(limitedMs / 60000)) : 0;

  if (acc.needsLogin) {
    group.appendChild(el('div', 'account-group-warn',
      'Sign-in needed — run: CLAUDE_CONFIG_DIR=' + (acc.dir || '') + ' claude auth login'));
  } else if (acc.error) {
    group.appendChild(el('div', 'account-group-warn', acc.error));
  } else if (limitedMins) {
    // Throttled, not broken — the cards below still show the last good numbers.
    group.appendChild(el('div', 'account-group-note',
      'Rate limited · retrying in ' + limitedMins + 'm'));
  }

  var cards = el('div', 'account-group-cards');
  if (acc.usage) {
    appendUsageCards(cards, acc.usage);
  } else {
    var empty = el('div', 'usage-card');
    empty.appendChild(el('div', 'card-label', 'Usage'));
    empty.appendChild(el('div', 'card-meta', limitedMins ? 'Rate limited — no data yet' : 'No data yet'));
    cards.appendChild(empty);
  }
  group.appendChild(cards);
  return group;
}

function renderOverview() {
  var container = document.getElementById('overviewCards');
  while (container.firstChild) container.removeChild(container.firstChild);

  // Two or more accounts: one titled card group each, laid out in a grid.
  if (accountsData.length > 1) {
    container.classList.add('multi');
    for (var i = 0; i < accountsData.length; i++) {
      container.appendChild(buildAccountGroup(accountsData[i]));
    }
    renderPlanner();
    return;
  }

  // Single account: exactly the layout it has always had.
  container.classList.remove('multi');
  if (!usageData) {
    container.appendChild(el('div', 'usage-card', 'Waiting for data...'));
    return;
  }
  appendUsageCards(container, usageData);

  // Session planner
  renderPlanner();
}

function getPlannerStatus(pct, hoursToLimit, remainingHours) {
  // "At Risk" if burn rate will hit limit before reset
  // "Watch" if above 60% usage
  // "On Track" otherwise
  if (hoursToLimit !== null && hoursToLimit < remainingHours) return 'at-risk';
  if (pct >= 60) return 'watch';
  return 'on-track';
}

function getPlannerStatusLabel(status) {
  if (status === 'at-risk') return 'At Risk';
  if (status === 'watch') return 'Watch';
  return 'On Track';
}

function getStatDotColor(pct) {
  if (pct >= 85) return 'var(--red)';
  if (pct >= 60) return 'var(--yellow)';
  return 'var(--green)';
}

function renderPlanner() {
  var container = document.getElementById('plannerText');
  while (container.firstChild) container.removeChild(container.firstChild);

  if (!usageData || !usageData.session) {
    container.textContent = 'Waiting for data...';
    return;
  }

  var pct = usageData.session.pct;
  var resetsAt = usageData.session.resetsAt;

  if (pct === 0) {
    // Simple state — show badge + message
    var header0 = el('div', 'planner-header');
    var badge0 = el('div', 'planner-badge on-track');
    badge0.appendChild(el('span', 'planner-badge-dot'));
    badge0.appendChild(document.createTextNode('On Track'));
    header0.appendChild(badge0);
    container.appendChild(header0);
    container.appendChild(el('div', 'planner-recommendation', 'No session usage yet. You have a full 5-hour window available.'));
    return;
  }

  var resetTime = resetsAt ? new Date(resetsAt).getTime() : 0;
  var now = Date.now();
  var remainingMs = resetTime > 0 ? resetTime - now : 0;

  if (resetsAt && remainingMs <= 0) {
    var header1 = el('div', 'planner-header');
    var badge1 = el('div', 'planner-badge on-track');
    badge1.appendChild(el('span', 'planner-badge-dot'));
    badge1.appendChild(document.createTextNode('On Track'));
    header1.appendChild(badge1);
    container.appendChild(header1);
    container.appendChild(el('div', 'planner-recommendation', 'Session is resetting now.'));
    return;
  }

  var sessionWindowMs = 5 * 60 * 60 * 1000;
  var elapsedMs = remainingMs > 0 ? sessionWindowMs - remainingMs : 1;
  if (elapsedMs <= 0) elapsedMs = 1;

  var ratePerHour = pct / (elapsedMs / 3600000);
  var remainingPct = 100 - pct;
  var hoursToLimit = ratePerHour > 0 ? remainingPct / ratePerHour : null;
  var remainingHoursDecimal = remainingMs > 0 ? remainingMs / 3600000 : 0;

  var status = getPlannerStatus(pct, hoursToLimit, remainingHoursDecimal);

  // Header with badge
  var header = el('div', 'planner-header');
  var badge = el('div', 'planner-badge ' + status);
  badge.appendChild(el('span', 'planner-badge-dot'));
  badge.appendChild(document.createTextNode(getPlannerStatusLabel(status)));
  header.appendChild(badge);
  container.appendChild(header);

  // Stat grid
  var stats = el('div', 'planner-stats');

  // Stat 1: Session usage
  var stat1 = el('div', 'planner-stat');
  stat1.appendChild(el('div', 'planner-stat-label', 'Session'));
  var val1 = el('div', 'planner-stat-value');
  var dot1 = el('span', 'planner-stat-dot');
  dot1.style.background = getStatDotColor(pct);
  val1.appendChild(dot1);
  val1.appendChild(document.createTextNode(pct + '%'));
  stat1.appendChild(val1);
  stats.appendChild(stat1);

  // Stat 2: Burn rate
  var stat2 = el('div', 'planner-stat');
  stat2.appendChild(el('div', 'planner-stat-label', 'Burn Rate'));
  var val2 = el('div', 'planner-stat-value');
  val2.appendChild(document.createTextNode('~' + ratePerHour.toFixed(1) + '%/hr'));
  stat2.appendChild(val2);
  stats.appendChild(stat2);

  // Stat 3: Time to limit
  var stat3 = el('div', 'planner-stat');
  stat3.appendChild(el('div', 'planner-stat-label', 'Time to Limit'));
  var val3 = el('div', 'planner-stat-value');
  if (hoursToLimit !== null && hoursToLimit < remainingHoursDecimal) {
    var limitH = Math.floor(hoursToLimit);
    var limitM = Math.round((hoursToLimit - limitH) * 60);
    val3.style.color = 'var(--red)';
    val3.appendChild(document.createTextNode(limitH + 'h ' + limitM + 'm'));
  } else {
    val3.style.color = 'var(--green)';
    val3.appendChild(document.createTextNode('Safe'));
  }
  stat3.appendChild(val3);
  stats.appendChild(stat3);

  container.appendChild(stats);

  // Recommendation
  var rec = el('div', 'planner-recommendation');
  if (hoursToLimit !== null && hoursToLimit < remainingHoursDecimal) {
    var lH = Math.floor(hoursToLimit);
    var lM = Math.round((hoursToLimit - lH) * 60);
    rec.textContent = 'Slow down \u2014 limit in ' + lH + 'h ' + lM + 'm. ';
    if (remainingMs > 0) {
      var rH = Math.floor(remainingMs / 3600000);
      var rM = Math.floor((remainingMs % 3600000) / 60000);
      rec.textContent += 'Resets in ' + rH + 'h ' + rM + 'm.';
    }
  } else {
    rec.textContent = 'You can sustain this pace until reset. ~' + Math.round(remainingPct) + '% headroom remaining.';
  }
  container.appendChild(rec);
}

// --- History chart (Chart.js) ---

var usageChart = null;

var chartSeriesDefs = [
  { key: 'session', color: '#d4845a', label: 'Session' },
  { key: 'weekAll', color: '#7c7cba', label: 'Weekly (all)' },
  { key: 'weekSonnet', color: '#4ade80', label: 'Weekly (Fable)' },
];


function formatChartDate(ts) {
  var d = new Date(ts);
  var dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (chartDays <= 7) {
    var h = d.getHours();
    var ampm = h >= 12 ? 'pm' : 'am';
    var h12 = h % 12 || 12;
    return dayNames[d.getDay()] + ' ' + h12 + ampm;
  }
  return monthNames[d.getMonth()] + ' ' + d.getDate();
}

function formatTooltipTitle(ts) {
  var d = new Date(ts);
  var monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var h = d.getHours();
  var ampm = h >= 12 ? 'pm' : 'am';
  var h12 = h % 12 || 12;
  var min = d.getMinutes();
  return monthNames[d.getMonth()] + ' ' + d.getDate() + ', ' + h12 + ':' + (min < 10 ? '0' : '') + min + ampm;
}


function drawChart() {
  var canvas = document.getElementById('historyCanvas');
  if (!canvas) return;

  // Filter data by chartDays
  var cutoff = Date.now() - chartDays * 24 * 60 * 60 * 1000;
  var points = [];
  for (var i = 0; i < historyData.length; i++) {
    if (historyData[i].ts > cutoff) {
      points.push(historyData[i]);
    }
  }

  // Build labels and datasets
  var labels = [];
  var datasets = [];
  for (var s = 0; s < chartSeriesDefs.length; s++) {
    datasets.push([]);
  }
  for (var p = 0; p < points.length; p++) {
    labels.push(points[p].ts);
    for (var s2 = 0; s2 < chartSeriesDefs.length; s2++) {
      datasets[s2].push(points[p][chartSeriesDefs[s2].key]);
    }
  }

  var chartDatasets = [];
  for (var d = 0; d < chartSeriesDefs.length; d++) {
    var def = chartSeriesDefs[d];
    chartDatasets.push({
      label: def.label,
      data: datasets[d],
      borderColor: def.color,
      backgroundColor: def.color,
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 5,
      pointHoverBackgroundColor: def.color,
      pointHoverBorderColor: '#fff',
      pointHoverBorderWidth: 2,
      tension: 0.35,
      fill: false,
    });
  }

  // Destroy old chart if exists
  if (usageChart) {
    usageChart.destroy();
    usageChart = null;
  }

  if (points.length < 2) {
    var ctx2d = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = 320 * dpr;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = '320px';
    ctx2d.scale(dpr, dpr);
    ctx2d.clearRect(0, 0, rect.width, 320);
    ctx2d.fillStyle = '#7e7e98';
    ctx2d.font = '14px sans-serif';
    ctx2d.textAlign = 'center';
    ctx2d.fillText('Not enough data yet', rect.width / 2, 160);
    return;
  }

  usageChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: labels,
      datasets: chartDatasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 600,
        easing: 'easeOutCubic',
      },
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#e2e2f0',
            font: { size: 12, weight: '500' },
            usePointStyle: true,
            pointStyle: 'circle',
            padding: 20,
          },
        },
        tooltip: {
          backgroundColor: '#1b1b28',
          borderColor: '#2a2a3d',
          borderWidth: 1,
          titleColor: '#7e7e98',
          bodyColor: '#e2e2f0',
          titleFont: { size: 11, family: 'monospace' },
          bodyFont: { size: 12 },
          padding: 12,
          cornerRadius: 8,
          displayColors: true,
          usePointStyle: true,
          callbacks: {
            title: function(items) {
              if (items.length > 0) {
                return formatTooltipTitle(items[0].label);
              }
              return '';
            },
            label: function(item) {
              return ' ' + item.dataset.label + ': ' + item.parsed.y + '%';
            },
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: '#7e7e98',
            font: { size: 10, family: 'monospace' },
            maxTicksLimit: chartDays <= 7 ? 8 : (chartDays <= 14 ? 8 : 6),
            callback: function(val, idx) {
              return formatChartDate(this.getLabelForValue(val));
            },
          },
          grid: {
            color: '#2a2a3d',
            drawTicks: true,
            tickLength: 4,
          },
          border: {
            color: '#2a2a3d',
          },
        },
        y: {
          min: 0,
          max: 100,
          ticks: {
            color: '#7e7e98',
            font: { size: 11, family: 'monospace' },
            stepSize: 25,
            callback: function(val) {
              return val + '%';
            },
          },
          grid: {
            color: '#2a2a3d',
          },
          border: {
            display: false,
          },
        },
      },
    },
  });
}

// Pill slider position — hoisted to module scope so tab-switch handler can call it
function updateSlider() {
  var pillBtns = document.querySelectorAll('.pill-btn');
  var slider = document.getElementById('pillSlider');
  if (!slider || pillBtns.length === 0) return;
  var activeBtn = null;
  for (var i = 0; i < pillBtns.length; i++) {
    if (pillBtns[i].classList.contains('active')) {
      activeBtn = pillBtns[i];
      break;
    }
  }
  if (activeBtn) {
    slider.style.left = activeBtn.offsetLeft + 'px';
    slider.style.width = activeBtn.offsetWidth + 'px';
  }
}

// Pill toggle controls
function initPillToggle() {
  var pillBtns = document.querySelectorAll('.pill-btn');
  var slider = document.getElementById('pillSlider');
  if (!slider || pillBtns.length === 0) return;

  for (var i = 0; i < pillBtns.length; i++) {
    (function(btn) {
      btn.addEventListener('click', function() {
        for (var j = 0; j < pillBtns.length; j++) {
          pillBtns[j].classList.remove('active');
        }
        btn.classList.add('active');
        chartDays = parseInt(btn.getAttribute('data-days'), 10);
        updateSlider();
        drawChart();
      });
    })(pillBtns[i]);
  }

  // Initial slider position (defer to next frame so layout is ready)
  requestAnimationFrame(updateSlider);
}
initPillToggle();

// --- Alerts ---

function renderAlerts() {
  var container = document.getElementById('alertRows');
  while (container.firstChild) container.removeChild(container.firstChild);

  var presets = [
    { icon: '\uD83D\uDEE1', label: 'Relaxed', session: 60, weekAll: 60, weekSonnet: 60 },
    { icon: '\u2696', label: 'Standard', session: 80, weekAll: 90, weekSonnet: 90 },
    { icon: '\u26A1', label: 'Aggressive', session: 95, weekAll: 95, weekSonnet: 95 },
  ];

  function isPresetActive(preset) {
    return alertThresholds.session === preset.session
      && alertThresholds.weekAll === preset.weekAll
      && alertThresholds.weekSonnet === preset.weekSonnet;
  }

  var presetsRow = el('div', 'alert-presets');
  for (var p = 0; p < presets.length; p++) {
    (function(preset) {
      var chip = el('button', 'preset-chip');
      var iconSpan = el('span', 'preset-icon', preset.icon);
      chip.appendChild(iconSpan);
      chip.appendChild(document.createTextNode(preset.label));
      if (isPresetActive(preset)) chip.classList.add('active');
      chip.addEventListener('click', function() {
        alertThresholds.session = preset.session;
        alertThresholds.weekAll = preset.weekAll;
        alertThresholds.weekSonnet = preset.weekSonnet;
        saveAlertThresholds();
        renderAlerts();
      });
      presetsRow.appendChild(chip);
    })(presets[p]);
  }
  container.appendChild(presetsRow);

  var alerts = [
    { key: 'session', label: 'Session' },
    { key: 'weekAll', label: 'Weekly (all)' },
    { key: 'weekSonnet', label: 'Weekly (Fable)' },
  ];

  for (var i = 0; i < alerts.length; i++) {
    (function(alert) {
      var row = el('div', 'alert-row');
      var header = el('div', 'alert-row-header');
      header.appendChild(el('div', 'alert-label', alert.label));
      var valueEl = el('div', 'alert-value', alertThresholds[alert.key] + '%');
      header.appendChild(valueEl);
      row.appendChild(header);

      // Slider
      var track = el('div', 'alert-slider-track');
      var fill = el('div', 'alert-slider-fill');
      var thumb = el('div', 'alert-slider-thumb');
      var pct = alertThresholds[alert.key];
      fill.style.width = pct + '%';
      thumb.style.left = pct + '%';
      track.appendChild(fill);
      track.appendChild(thumb);

      function updateFromX(clientX) {
        var rect = track.getBoundingClientRect();
        var raw = (clientX - rect.left) / rect.width;
        var val = Math.round(Math.min(100, Math.max(5, raw * 100)) / 5) * 5;
        alertThresholds[alert.key] = val;
        fill.style.width = val + '%';
        thumb.style.left = val + '%';
        valueEl.textContent = val + '%';
      }

      track.addEventListener('mousedown', function(e) {
        e.preventDefault();
        updateFromX(e.clientX);
        function onMove(ev) { updateFromX(ev.clientX); }
        function onUp() {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          saveAlertThresholds();
          updatePresetHighlights();
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });

      row.appendChild(track);

      // Tick marks
      var ticks = el('div', 'alert-ticks');
      var tickValues = [0, 25, 50, 75, 100];
      for (var t = 0; t < tickValues.length; t++) {
        ticks.appendChild(el('span', 'alert-tick', tickValues[t] + '%'));
      }
      row.appendChild(ticks);

      container.appendChild(row);
    })(alerts[i]);
  }
}

function updatePresetHighlights() {
  var presets = [
    { session: 60, weekAll: 60, weekSonnet: 60 },
    { session: 80, weekAll: 90, weekSonnet: 90 },
    { session: 95, weekAll: 95, weekSonnet: 95 },
  ];
  var chips = document.querySelectorAll('.preset-chip');
  for (var i = 0; i < chips.length; i++) {
    if (i < presets.length) {
      var p = presets[i];
      var match = alertThresholds.session === p.session
        && alertThresholds.weekAll === p.weekAll
        && alertThresholds.weekSonnet === p.weekSonnet;
      if (match) chips[i].classList.add('active');
      else chips[i].classList.remove('active');
    }
  }
}

function saveAlertThresholds() {
  window.dashboardAPI.saveSettings({
    alertThresholds: {
      session: alertThresholds.session,
      weekAll: alertThresholds.weekAll,
      weekSonnet: alertThresholds.weekSonnet,
    },
  });
}

// --- Settings ---

var currentDisplayHotkey = 'Ctrl+\\';
var isRecordingHotkey = false;
var currentAppVersion = '...';

function formatElectronAccelerator(e) {
  var parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push(navigator.platform.indexOf('Mac') >= 0 ? 'Cmd' : 'Super');

  // Map key to Electron accelerator format
  var key = e.key;
  if (key === ' ') key = 'Space';
  else if (key === 'Escape') return null; // cancel
  else if (key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta') return null; // modifier only
  else if (key === '\\') key = '\\';
  else if (key === 'ArrowUp') key = 'Up';
  else if (key === 'ArrowDown') key = 'Down';
  else if (key === 'ArrowLeft') key = 'Left';
  else if (key === 'ArrowRight') key = 'Right';
  else if (key === 'Delete') key = 'Delete';
  else if (key === 'Backspace') key = 'Backspace';
  else if (key === 'Enter') key = 'Return';
  else if (key === 'Tab') key = 'Tab';
  else if (key.length === 1) key = key.toUpperCase();

  if (parts.length === 0) return null; // require at least one modifier
  parts.push(key);
  return parts.join('+');
}

// --- Calendar tab ---
var calEvents = [];
var calSelectedDate = null;
var calWeekOffset = 0;
var calMonthGridOpen = false;
var calMonthViewYear = new Date().getFullYear();
var calMonthViewMonth = new Date().getMonth();
var calEditingId = null;

var CAL_COLORS = ['blue', 'green', 'orange', 'red', 'purple'];
var CAL_COLOR_MAP = { blue: '#60a5fa', green: '#4ade80', orange: '#fb923c', red: '#f87171', purple: '#c084fc' };
var CAL_DAY_NAMES = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
var CAL_DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
var CAL_MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function calToday() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function calFormatDate(y, m, d) {
  return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

function calFormatDateObj(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function calParseDate(str) {
  var p = str.split('-');
  return new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
}

function calDayName(dateStr) {
  return CAL_DAY_FULL[new Date(dateStr + 'T12:00').getDay()];
}

function calMonthName(m) {
  return ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'][m];
}

function calGetWeekStart(offset) {
  var d = new Date();
  var day = d.getDay();
  var diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff + (offset * 7));
  d.setHours(0, 0, 0, 0);
  return d;
}

function renderCalendar() {
  if (!calSelectedDate) calSelectedDate = calToday();
  renderCalendarGrid();
  renderCalendarAgenda();
}

function renderCalendarGrid() {
  var grid = document.getElementById('calendarGrid');
  while (grid.firstChild) grid.removeChild(grid.firstChild);

  var today = calToday();
  var sd = calParseDate(calSelectedDate);

  // --- Header: date title + expand chevron + add button ---
  var header = el('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;';

  var headerLeft = el('div');
  headerLeft.style.cssText = 'display:flex;align-items:center;gap:10px;';
  var dateTitle = el('div');
  dateTitle.style.cssText = 'font-size:16px;font-weight:700;color:var(--text);letter-spacing:-0.3px;';
  var shortDay = calDayName(calSelectedDate).slice(0, 3);
  dateTitle.textContent = shortDay + ', ' + CAL_MONTH_SHORT[sd.getMonth()] + ' ' + sd.getDate();
  headerLeft.appendChild(dateTitle);

  if (calSelectedDate === today) {
    var badge = el('span');
    badge.style.cssText = 'font-size:9px;font-weight:700;color:#fff;background:var(--accent);padding:2px 8px;border-radius:4px;letter-spacing:0.5px;';
    badge.textContent = 'TODAY';
    headerLeft.appendChild(badge);
  }
  header.appendChild(headerLeft);

  var headerRight = el('div');
  headerRight.style.cssText = 'display:flex;align-items:center;gap:6px;';

  var expandBtn = el('button');
  expandBtn.style.cssText = 'width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--text-dim);background:none;border:none;cursor:pointer;border-radius:5px;transition:all 0.12s;' + (calMonthGridOpen ? 'transform:rotate(180deg);' : '');
  expandBtn.textContent = '\u25BE';
  expandBtn.title = 'Show month';
  expandBtn.addEventListener('click', function() {
    calMonthGridOpen = !calMonthGridOpen;
    calMonthViewYear = sd.getFullYear();
    calMonthViewMonth = sd.getMonth();
    renderCalendarGrid();
  });
  headerRight.appendChild(expandBtn);

  var addBtn = el('button');
  addBtn.style.cssText = 'padding:5px 14px;font-size:11px;font-weight:600;background:linear-gradient(135deg,var(--accent),#c06a3a);border:none;border-radius:6px;color:#fff;cursor:pointer;transition:all 0.15s;';
  addBtn.textContent = '+ Add';
  addBtn.addEventListener('click', function() {
    calEditingId = null;
    renderCalendarAgenda();
    var formEl = document.getElementById('calEventForm');
    if (formEl) formEl.style.display = 'flex';
  });
  headerRight.appendChild(addBtn);
  header.appendChild(headerRight);
  grid.appendChild(header);

  // --- Expandable month grid ---
  if (calMonthGridOpen) {
    var monthWrap = el('div');
    monthWrap.style.cssText = 'margin-bottom:12px;padding:12px;background:var(--surface);border:1px solid var(--border);border-radius:10px;';

    var monthNav = el('div');
    monthNav.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:8px;';
    var mpBtn = el('button');
    mpBtn.style.cssText = 'width:24px;height:24px;background:var(--surface2);border:none;border-radius:6px;color:var(--text-dim);font-size:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;';
    mpBtn.textContent = '\u25C0';
    mpBtn.addEventListener('click', function() {
      calMonthViewMonth--;
      if (calMonthViewMonth < 0) { calMonthViewMonth = 11; calMonthViewYear--; }
      renderCalendarGrid();
    });
    var mTitle = el('div');
    mTitle.style.cssText = 'font-size:13px;font-weight:700;min-width:110px;text-align:center;';
    mTitle.textContent = calMonthName(calMonthViewMonth) + ' ' + calMonthViewYear;
    var mnBtn = el('button');
    mnBtn.style.cssText = mpBtn.style.cssText;
    mnBtn.textContent = '\u25B6';
    mnBtn.addEventListener('click', function() {
      calMonthViewMonth++;
      if (calMonthViewMonth > 11) { calMonthViewMonth = 0; calMonthViewYear++; }
      renderCalendarGrid();
    });
    monthNav.appendChild(mpBtn);
    monthNav.appendChild(mTitle);
    monthNav.appendChild(mnBtn);
    monthWrap.appendChild(monthNav);

    // Day letter headers
    var mhRow = el('div');
    mhRow.style.cssText = 'display:grid;grid-template-columns:repeat(7,1fr);margin-bottom:2px;';
    var letters = ['M','T','W','T','F','S','S'];
    for (var li = 0; li < 7; li++) {
      var lh = el('div');
      lh.style.cssText = 'text-align:center;font-size:9px;font-weight:600;color:var(--text-dim);opacity:0.5;letter-spacing:0.5px;';
      lh.textContent = letters[li];
      mhRow.appendChild(lh);
    }
    monthWrap.appendChild(mhRow);

    // Month cells
    var mGrid = el('div');
    mGrid.style.cssText = 'display:grid;grid-template-columns:repeat(7,1fr);gap:2px;';
    var mFirst = new Date(calMonthViewYear, calMonthViewMonth, 1).getDay();
    var mOffset = mFirst === 0 ? 6 : mFirst - 1;
    var mDays = new Date(calMonthViewYear, calMonthViewMonth + 1, 0).getDate();
    var mPrevDays = new Date(calMonthViewYear, calMonthViewMonth, 0).getDate();

    for (var mp = mOffset - 1; mp >= 0; mp--) {
      var mpc = el('div');
      mpc.style.cssText = 'text-align:center;font-size:10px;padding:4px 0;color:var(--border);';
      mpc.textContent = String(mPrevDays - mp);
      mGrid.appendChild(mpc);
    }
    for (var md = 1; md <= mDays; md++) {
      var mds = calFormatDate(calMonthViewYear, calMonthViewMonth, md);
      var mc = el('div');
      mc.style.cssText = 'text-align:center;font-size:10px;padding:4px 0;border-radius:5px;cursor:pointer;color:var(--text-dim);transition:all 0.1s;position:relative;';
      if (mds === today) { mc.style.color = 'var(--accent)'; mc.style.fontWeight = '700'; }
      if (mds === calSelectedDate) { mc.style.background = 'var(--accent)'; mc.style.color = '#fff'; mc.style.fontWeight = '700'; }
      mc.textContent = String(md);

      var mEvts = calEvents.filter(function(ev) { return ev.date === mds && !ev.done; });
      if (mEvts.length > 0) {
        var mDot = el('div');
        mDot.style.cssText = 'position:absolute;bottom:1px;left:50%;transform:translateX(-50%);width:3px;height:3px;border-radius:50%;background:#60a5fa;';
        mc.appendChild(mDot);
      }

      (function(dateStr, dateObj) {
        mc.addEventListener('click', function() {
          calSelectedDate = dateStr;
          calEditingId = null;
          // Navigate week to this date
          var currentMonday = calGetWeekStart(0);
          var targetMonday = new Date(dateObj);
          var dow = targetMonday.getDay();
          var mondayDiff = dow === 0 ? 6 : dow - 1;
          targetMonday.setDate(targetMonday.getDate() - mondayDiff);
          calWeekOffset = Math.round((targetMonday.getTime() - currentMonday.getTime()) / (7 * 24 * 60 * 60 * 1000));
          calMonthGridOpen = false;
          renderCalendar();
        });
      })(mds, new Date(calMonthViewYear, calMonthViewMonth, md));

      mGrid.appendChild(mc);
    }
    var mTotal = mOffset + mDays;
    var mRem = mTotal % 7 === 0 ? 0 : 7 - (mTotal % 7);
    for (var mn = 1; mn <= mRem; mn++) {
      var mnc = el('div');
      mnc.style.cssText = 'text-align:center;font-size:10px;padding:4px 0;color:var(--border);';
      mnc.textContent = String(mn);
      mGrid.appendChild(mnc);
    }
    monthWrap.appendChild(mGrid);
    grid.appendChild(monthWrap);
  }

  // --- Week navigation ---
  var weekNav = el('div');
  weekNav.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:8px;';

  var wpBtn = el('button');
  wpBtn.style.cssText = 'width:22px;height:22px;background:none;border:none;border-radius:5px;color:var(--text-dim);font-size:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.12s;';
  wpBtn.textContent = '\u25C0';
  wpBtn.addEventListener('click', function() {
    calWeekOffset--;
    var ws = calGetWeekStart(calWeekOffset);
    var sdd = calParseDate(calSelectedDate);
    var dayIdx = sdd.getDay() === 0 ? 6 : sdd.getDay() - 1;
    var nd = new Date(ws); nd.setDate(ws.getDate() + dayIdx);
    calSelectedDate = calFormatDateObj(nd);
    renderCalendar();
  });

  var ws = calGetWeekStart(calWeekOffset);
  var we = new Date(ws); we.setDate(we.getDate() + 6);
  var weekLabel = el('span');
  weekLabel.style.cssText = 'font-size:10px;color:var(--text-dim);font-weight:600;min-width:100px;text-align:center;';
  weekLabel.textContent = CAL_MONTH_SHORT[ws.getMonth()] + ' ' + ws.getDate() + ' \u2013 ' + CAL_MONTH_SHORT[we.getMonth()] + ' ' + we.getDate();

  var wnBtn = el('button');
  wnBtn.style.cssText = wpBtn.style.cssText;
  wnBtn.textContent = '\u25B6';
  wnBtn.addEventListener('click', function() {
    calWeekOffset++;
    var ws = calGetWeekStart(calWeekOffset);
    var sdd = calParseDate(calSelectedDate);
    var dayIdx = sdd.getDay() === 0 ? 6 : sdd.getDay() - 1;
    var nd = new Date(ws); nd.setDate(ws.getDate() + dayIdx);
    calSelectedDate = calFormatDateObj(nd);
    renderCalendar();
  });

  weekNav.appendChild(wpBtn);
  weekNav.appendChild(weekLabel);
  weekNav.appendChild(wnBtn);

  // Today button
  var todayInWeek = calParseDate(today) >= ws && calParseDate(today) <= we;
  if (!(todayInWeek && calSelectedDate === today)) {
    var todayBtn = el('button');
    todayBtn.style.cssText = 'font-size:9px;font-weight:700;color:var(--accent);background:none;border:1px solid rgba(212,132,90,0.3);border-radius:4px;padding:3px 8px;cursor:pointer;letter-spacing:0.3px;transition:all 0.12s;';
    todayBtn.textContent = 'TODAY';
    todayBtn.addEventListener('click', function() {
      calWeekOffset = 0;
      calSelectedDate = calToday();
      renderCalendar();
    });
    weekNav.appendChild(todayBtn);
  }
  grid.appendChild(weekNav);

  // --- Week strip ---
  var strip = el('div');
  strip.style.cssText = 'display:flex;gap:6px;margin-bottom:14px;';

  for (var wi = 0; wi < 7; wi++) {
    var wd = new Date(ws);
    wd.setDate(ws.getDate() + wi);
    var wds = calFormatDateObj(wd);

    var cell = el('div');
    cell.style.cssText = 'flex:1;text-align:center;padding:8px 0 6px;border-radius:10px;background:var(--surface);cursor:pointer;transition:all 0.12s;border:1.5px solid transparent;';

    if (wds === today) {
      cell.style.borderColor = 'rgba(212,132,90,0.5)';
      cell.style.background = 'rgba(212,132,90,0.08)';
    }
    if (wds === calSelectedDate) {
      cell.style.background = 'var(--accent)';
      cell.style.borderColor = 'var(--accent)';
    }

    var dayName = el('div');
    dayName.style.cssText = 'font-size:9px;font-weight:600;color:var(--text-dim);letter-spacing:0.5px;';
    if (wds === today) { dayName.style.color = 'var(--accent)'; dayName.style.fontWeight = '700'; }
    if (wds === calSelectedDate) { dayName.style.color = '#fff'; }
    dayName.textContent = CAL_DAY_NAMES[wi];

    var dayNum = el('div');
    dayNum.style.cssText = 'font-size:14px;color:var(--text-dim);margin-top:2px;font-weight:500;';
    if (wds === today) { dayNum.style.color = 'var(--accent)'; dayNum.style.fontWeight = '700'; }
    if (wds === calSelectedDate) { dayNum.style.color = '#fff'; dayNum.style.fontWeight = '700'; }
    dayNum.textContent = String(wd.getDate());

    cell.appendChild(dayName);
    cell.appendChild(dayNum);

    // Event dots
    var wEvts = calEvents.filter(function(ev) { return ev.date === wds && !ev.done; });
    var dotRow = el('div');
    dotRow.style.cssText = 'display:flex;justify-content:center;gap:2px;margin-top:3px;min-height:4px;';
    for (var di = 0; di < Math.min(3, wEvts.length); di++) {
      var dot = el('div');
      var dotColor = wEvts[di].color && wEvts[di].color.charAt(0) === '#' ? wEvts[di].color : (CAL_COLOR_MAP[wEvts[di].color] || CAL_COLOR_MAP.blue);
      dot.style.cssText = 'width:4px;height:4px;border-radius:50%;background:' + dotColor + ';';
      if (wds === calSelectedDate) dot.style.opacity = '0.7';
      dotRow.appendChild(dot);
    }
    cell.appendChild(dotRow);

    (function(dateStr) {
      cell.addEventListener('click', function() {
        calSelectedDate = dateStr;
        calEditingId = null;
        renderCalendar();
      });
    })(wds);

    strip.appendChild(cell);
  }
  grid.appendChild(strip);
}

function renderCalendarAgenda() {
  var agenda = document.getElementById('calendarAgenda');
  while (agenda.firstChild) agenda.removeChild(agenda.firstChild);

  // Divider
  var divider = el('div');
  divider.style.cssText = 'height:1px;background:linear-gradient(90deg,transparent,var(--border),transparent);margin-bottom:14px;';
  agenda.appendChild(divider);

  // Events for selected day
  var dayEvents = calEvents.filter(function(ev) { return ev.date === calSelectedDate; });
  dayEvents.sort(function(a, b) {
    if (a.done && !b.done) return 1;
    if (!a.done && b.done) return -1;
    if (!a.time && b.time) return -1;
    if (a.time && !b.time) return 1;
    return (a.time || '').localeCompare(b.time || '');
  });

  if (dayEvents.length === 0 && calEditingId === null) {
    var noEvents = el('div');
    noEvents.style.cssText = 'color:var(--text-dim);font-size:12px;text-align:center;padding:20px 0;opacity:0.5;';
    noEvents.textContent = 'No events';
    agenda.appendChild(noEvents);
  }

  var now = Date.now();

  for (var i = 0; i < dayEvents.length; i++) {
    var ev = dayEvents[i];
    var row = el('div');
    var evColor = ev.color && ev.color.charAt(0) === '#' ? ev.color : (CAL_COLOR_MAP[ev.color] || CAL_COLOR_MAP.blue);
    row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--surface);border-radius:8px;margin-bottom:4px;border-left:3px solid ' + evColor + ';transition:all 0.12s;cursor:default;';

    // Overdue check
    var isOverdue = false;
    if (!ev.done) {
      var evMs = ev.time ? new Date(ev.date + 'T' + ev.time).getTime() : new Date(ev.date + 'T23:59').getTime();
      if (evMs < now) isOverdue = true;
    }
    if (isOverdue) row.style.background = 'rgba(251,113,133,0.04)';

    var timeEl = el('div');
    timeEl.style.cssText = 'font-size:10px;color:var(--text-dim);width:42px;flex-shrink:0;font-family:"JetBrains Mono","Cascadia Code","Fira Code","Consolas",monospace;';
    if (isOverdue && ev.time) {
      timeEl.textContent = 'LATE';
      timeEl.style.color = 'var(--red)';
      timeEl.style.fontWeight = '700';
    } else {
      timeEl.textContent = ev.time || 'All day';
    }
    row.appendChild(timeEl);

    // Google Calendar indicator
    if (ev.isGoogleEvent) {
      var gIcon = el('div');
      gIcon.style.cssText = 'width:14px;height:14px;border-radius:50%;background:linear-gradient(135deg,#4285f4,#34a853);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:8px;color:#fff;font-weight:700;';
      gIcon.textContent = 'G';
      gIcon.title = ev.googleAccount || 'Google Calendar';
      row.appendChild(gIcon);
    }

    var titleEl = el('div');
    titleEl.style.cssText = 'flex:1;font-size:12px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    titleEl.textContent = ev.title;
    if (ev.done) { titleEl.style.textDecoration = 'line-through'; titleEl.style.opacity = '0.4'; }
    if (isOverdue) titleEl.style.color = 'var(--red)';
    row.appendChild(titleEl);

    // Meta
    var meta = [];
    if (ev.duration) meta.push(ev.duration >= 60 ? (ev.duration / 60) + 'h' : ev.duration + 'm');
    if (ev.recurrence) meta.push('\u21BB');
    if (ev.reminder != null) meta.push('\uD83D\uDD14');
    if (ev.isGoogleEvent && ev.googleAccount) {
      // Show short email label
      var shortEmail = ev.googleAccount.split('@')[0];
      if (shortEmail.length > 10) shortEmail = shortEmail.slice(0, 10) + '\u2026';
      meta.push(shortEmail);
    }
    if (meta.length > 0) {
      var metaEl = el('div');
      metaEl.style.cssText = 'font-size:9px;color:var(--text-dim);flex-shrink:0;';
      metaEl.textContent = meta.join(' ');
      row.appendChild(metaEl);
    }

    if (ev.isGoogleEvent) {
      // Google events: open in Google Calendar on click, no local edit/delete
      if (ev.googleLink) {
        row.style.cursor = 'pointer';
        (function(link) {
          row.addEventListener('click', function() {
            window.dashboardAPI.openExternal(link);
          });
        })(ev.googleLink);
      }
    } else {
      var editBtn = el('button', 'update-btn', 'Edit');
      editBtn.style.cssText = 'padding:3px 10px;font-size:10px;min-width:auto;opacity:0;transition:opacity 0.12s;';
      row.addEventListener('mouseenter', (function(btn) { return function() { btn.style.opacity = '1'; }; })(editBtn));
      row.addEventListener('mouseleave', (function(btn) { return function() { btn.style.opacity = '0'; }; })(editBtn));
      (function(evId) {
        editBtn.addEventListener('click', function() {
          calEditingId = evId;
          renderCalendarAgenda();
        });
      })(ev.id);
      row.appendChild(editBtn);

      var delBtn = el('button', 'update-btn', '\u2715');
      delBtn.style.cssText = 'padding:3px 8px;font-size:10px;min-width:auto;background:rgba(239,68,68,0.15);border-color:rgba(239,68,68,0.3);color:#ef4444;opacity:0;transition:opacity 0.12s;';
      row.addEventListener('mouseenter', (function(btn) { return function() { btn.style.opacity = '1'; }; })(delBtn));
      row.addEventListener('mouseleave', (function(btn) { return function() { btn.style.opacity = '0'; }; })(delBtn));
      (function(evId) {
        delBtn.addEventListener('click', function() {
          window.dashboardAPI.deleteCalendarEvent(evId);
        });
      })(ev.id);
      row.appendChild(delBtn);
    }

    agenda.appendChild(row);
  }

  // Add/Edit form
  var isEditing = calEditingId && calEvents.find(function(e) { return e.id === calEditingId; });
  var editEvt = isEditing ? calEvents.find(function(e) { return e.id === calEditingId; }) : null;

  var form = el('div');
  form.id = 'calEventForm';
  form.style.cssText = 'display:none;flex-direction:column;gap:8px;margin-top:12px;padding:12px;background:var(--surface);border:1px solid var(--border);border-radius:8px;';

  var formTitle = el('div');
  formTitle.style.cssText = 'font-size:12px;font-weight:600;color:var(--text);margin-bottom:4px;';
  formTitle.textContent = isEditing ? 'Edit Event' : 'Add Event';
  form.appendChild(formTitle);

  var inputStyle = 'padding:8px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;font-size:12px;color:var(--text);font-family:inherit;outline:none;';

  var titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.maxLength = 100;
  titleInput.placeholder = 'Event title';
  titleInput.style.cssText = inputStyle;
  if (editEvt) titleInput.value = editEvt.title;
  form.appendChild(titleInput);

  var row2 = el('div');
  row2.style.cssText = 'display:flex;gap:8px;align-items:center;';

  var dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.value = (editEvt ? editEvt.date : calSelectedDate);
  dateInput.style.cssText = inputStyle + 'flex:1;color-scheme:dark;';
  row2.appendChild(dateInput);

  // Custom time picker
  var timePickerWrap = el('div');
  timePickerWrap.style.cssText = 'display:flex;align-items:center;gap:4px;position:relative;';

  var initTime = editEvt && editEvt.time ? editEvt.time : '';
  var initH = initTime ? parseInt(initTime.split(':')[0], 10) : 12;
  var initM = initTime ? parseInt(initTime.split(':')[1], 10) : 0;
  var initPeriod = initH >= 12 ? 'PM' : 'AM';
  var initH12 = initH === 0 ? 12 : (initH > 12 ? initH - 12 : initH);
  var selectedHour = initH12;
  var selectedMinute = initM;
  var selectedPeriod = initTime ? initPeriod : 'PM';
  var hasTime = !!initTime;

  var tpBtnStyle = 'padding:6px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;font-size:13px;font-weight:600;color:var(--text);cursor:pointer;font-family:"JetBrains Mono","Cascadia Code","Fira Code","Consolas",monospace;min-width:38px;text-align:center;transition:all 0.15s;';
  var tpBtnActiveStyle = 'background:var(--accent);border-color:var(--accent);color:#fff;';

  var hourBtn = el('button');
  hourBtn.style.cssText = tpBtnStyle;
  hourBtn.textContent = hasTime ? String(selectedHour).padStart(2, '0') : '--';

  var colonEl = el('span');
  colonEl.style.cssText = 'font-size:14px;font-weight:700;color:var(--text-dim);';
  colonEl.textContent = ':';

  var minBtn = el('button');
  minBtn.style.cssText = tpBtnStyle;
  minBtn.textContent = hasTime ? String(selectedMinute).padStart(2, '0') : '--';

  var periodBtn = el('button');
  periodBtn.style.cssText = tpBtnStyle + 'font-size:10px;padding:6px 8px;';
  periodBtn.textContent = selectedPeriod;

  var clearTimeBtn = el('button');
  clearTimeBtn.style.cssText = 'padding:4px 8px;background:none;border:1px solid var(--border);border-radius:4px;font-size:9px;color:var(--text-dim);cursor:pointer;font-family:inherit;';
  clearTimeBtn.textContent = hasTime ? '\u2715' : 'All day';

  // Dropdown for picking values
  var dropdown = el('div');
  dropdown.style.cssText = 'display:none;position:absolute;top:100%;left:0;margin-top:4px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:6px;z-index:100;max-height:180px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,0.4);';

  function showDropdown(items, onSelect) {
    while (dropdown.firstChild) dropdown.removeChild(dropdown.firstChild);
    dropdown.style.display = 'block';
    var grid = el('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:3px;';
    for (var di = 0; di < items.length; di++) {
      var item = el('button');
      item.style.cssText = 'padding:6px 8px;background:var(--surface2);border:1px solid var(--border);border-radius:4px;font-size:12px;font-weight:600;color:var(--text);cursor:pointer;font-family:"JetBrains Mono","Cascadia Code","Fira Code","Consolas",monospace;text-align:center;transition:all 0.1s;';
      item.textContent = items[di];
      (function(val) {
        item.addEventListener('click', function(e) {
          e.stopPropagation();
          onSelect(val);
          dropdown.style.display = 'none';
        });
        item.addEventListener('mouseenter', function() {
          item.style.background = 'var(--accent)';
          item.style.borderColor = 'var(--accent)';
          item.style.color = '#fff';
        });
        item.addEventListener('mouseleave', function() {
          item.style.background = 'var(--surface2)';
          item.style.borderColor = 'var(--border)';
          item.style.color = 'var(--text)';
        });
      })(items[di]);
      grid.appendChild(item);
    }
    dropdown.appendChild(grid);
  }

  function updateTimeDisplay() {
    hourBtn.textContent = String(selectedHour).padStart(2, '0');
    minBtn.textContent = String(selectedMinute).padStart(2, '0');
    periodBtn.textContent = selectedPeriod;
    clearTimeBtn.textContent = '\u2715';
    hasTime = true;
  }

  var hours = [];
  for (var h = 1; h <= 12; h++) hours.push(String(h).padStart(2, '0'));

  var minutes = [];
  for (var m = 0; m < 60; m += 5) minutes.push(String(m).padStart(2, '0'));

  hourBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    showDropdown(hours, function(val) {
      selectedHour = parseInt(val, 10);
      updateTimeDisplay();
    });
  });

  minBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    showDropdown(minutes, function(val) {
      selectedMinute = parseInt(val, 10);
      updateTimeDisplay();
    });
  });

  periodBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    selectedPeriod = selectedPeriod === 'AM' ? 'PM' : 'AM';
    periodBtn.textContent = selectedPeriod;
    if (!hasTime) updateTimeDisplay();
  });

  clearTimeBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    hasTime = false;
    hourBtn.textContent = '--';
    minBtn.textContent = '--';
    clearTimeBtn.textContent = 'All day';
    dropdown.style.display = 'none';
  });

  // Close dropdown on outside click
  document.addEventListener('click', function() {
    dropdown.style.display = 'none';
  });

  // Helper to get 24h time string
  function getTimeValue() {
    if (!hasTime) return null;
    var h24 = selectedHour;
    if (selectedPeriod === 'PM' && h24 !== 12) h24 += 12;
    if (selectedPeriod === 'AM' && h24 === 12) h24 = 0;
    return String(h24).padStart(2, '0') + ':' + String(selectedMinute).padStart(2, '0');
  }

  timePickerWrap.appendChild(hourBtn);
  timePickerWrap.appendChild(colonEl);
  timePickerWrap.appendChild(minBtn);
  timePickerWrap.appendChild(periodBtn);
  timePickerWrap.appendChild(clearTimeBtn);
  timePickerWrap.appendChild(dropdown);
  row2.appendChild(timePickerWrap);
  form.appendChild(row2);

  var row3 = el('div');
  row3.style.cssText = 'display:flex;gap:8px;align-items:center;';

  // Color picker
  var colorLabel = el('span');
  colorLabel.style.cssText = 'font-size:11px;color:var(--text-dim);margin-right:4px;';
  colorLabel.textContent = 'Color:';
  row3.appendChild(colorLabel);

  var selectedColor = editEvt ? editEvt.color : 'blue';
  var colorDots = [];
  for (var c = 0; c < CAL_COLORS.length; c++) {
    var cd = el('div');
    cd.style.cssText = 'width:16px;height:16px;border-radius:50%;cursor:pointer;border:2px solid transparent;transition:border-color 0.15s;background:' + CAL_COLOR_MAP[CAL_COLORS[c]] + ';';
    if (CAL_COLORS[c] === selectedColor) cd.style.borderColor = '#fff';
    cd.setAttribute('data-color', CAL_COLORS[c]);
    (function(color, dotEl) {
      dotEl.addEventListener('click', function() {
        selectedColor = color;
        for (var x = 0; x < colorDots.length; x++) {
          colorDots[x].style.borderColor = colorDots[x].getAttribute('data-color') === color ? '#fff' : 'transparent';
        }
      });
    })(CAL_COLORS[c], cd);
    colorDots.push(cd);
    row3.appendChild(cd);
  }

  // Reminder dropdown
  var reminderLabel = el('span');
  reminderLabel.style.cssText = 'font-size:11px;color:var(--text-dim);margin-left:12px;';
  reminderLabel.textContent = 'Reminder:';
  row3.appendChild(reminderLabel);

  var reminderSelect = document.createElement('select');
  reminderSelect.style.cssText = inputStyle + 'padding:4px 8px;font-size:11px;';
  var opts = [
    { v: '', l: 'None' }, { v: '0', l: 'At time' }, { v: '5', l: '5 min' },
    { v: '15', l: '15 min' }, { v: '30', l: '30 min' }, { v: '60', l: '1 hour' },
  ];
  for (var o = 0; o < opts.length; o++) {
    var opt = document.createElement('option');
    opt.value = opts[o].v;
    opt.textContent = opts[o].l;
    reminderSelect.appendChild(opt);
  }
  if (editEvt && editEvt.reminder != null) reminderSelect.value = String(editEvt.reminder);
  row3.appendChild(reminderSelect);
  form.appendChild(row3);

  // Buttons
  var btnRow = el('div');
  btnRow.style.cssText = 'display:flex;gap:8px;margin-top:4px;';

  var saveBtn = el('button', 'update-btn', isEditing ? 'Save' : 'Add Event');
  saveBtn.style.cssText = 'padding:6px 16px;font-size:11px;font-weight:600;background:linear-gradient(135deg,var(--accent),#c06a3a);border:none;border-radius:6px;color:#fff;cursor:pointer;';
  saveBtn.addEventListener('click', function() {
    var t = titleInput.value.trim();
    if (!t) return;
    var data = {
      title: t,
      date: dateInput.value,
      time: getTimeValue(),
      color: selectedColor,
      reminder: reminderSelect.value !== '' ? parseInt(reminderSelect.value, 10) : null,
    };
    if (isEditing) {
      data.id = calEditingId;
      window.dashboardAPI.updateCalendarEvent(data);
    } else {
      window.dashboardAPI.addCalendarEvent(data);
    }
    calEditingId = null;
  });
  btnRow.appendChild(saveBtn);

  var cancelBtn = el('button', 'update-btn', 'Cancel');
  cancelBtn.style.cssText = 'padding:6px 16px;font-size:11px;';
  cancelBtn.addEventListener('click', function() {
    calEditingId = null;
    renderCalendarAgenda();
  });
  btnRow.appendChild(cancelBtn);

  form.appendChild(btnRow);
  agenda.appendChild(form);

  // Only show form when explicitly editing
  if (isEditing) {
    form.style.display = 'flex';
  }
}

// Listen for calendar updates from main
window.dashboardAPI.onCalendarUpdate(function(events) {
  calEvents = events || [];
  renderCalendar();
});

// Load events on init
window.dashboardAPI.getCalendarEvents().then(function(events) {
  calEvents = events || [];
});

// --- Analytics tab ---
function renderAnalytics() {
  var container = document.getElementById('analyticsContent');
  while (container.firstChild) container.removeChild(container.firstChild);

  if (!historyData || historyData.length < 2) {
    container.appendChild(el('div', 'setting-value', 'Not enough data yet. Usage history builds over time.'));
    return;
  }

  // Compute stats
  var now = Date.now();
  var day7 = now - 7 * 86400000;
  var day30 = now - 30 * 86400000;
  var last7 = historyData.filter(function(p) { return p.ts > day7; });
  var last30 = historyData.filter(function(p) { return p.ts > day30; });

  // Peak usage
  var peakSession = 0, peakWeekAll = 0;
  for (var i = 0; i < historyData.length; i++) {
    if (historyData[i].session > peakSession) peakSession = historyData[i].session;
    if (historyData[i].weekAll > peakWeekAll) peakWeekAll = historyData[i].weekAll;
  }

  // Average session usage
  var avgSession7 = 0;
  if (last7.length > 0) {
    for (var j = 0; j < last7.length; j++) avgSession7 += last7[j].session;
    avgSession7 = Math.round(avgSession7 / last7.length);
  }

  // Days hit limit (session >= 95%)
  var limitDays = new Set();
  for (var k = 0; k < historyData.length; k++) {
    if (historyData[k].session >= 95) {
      limitDays.add(new Date(historyData[k].ts).toDateString());
    }
  }

  // Peak hours
  var hourBuckets = new Array(24).fill(0);
  var hourCounts = new Array(24).fill(0);
  for (var h = 0; h < historyData.length; h++) {
    var hr = new Date(historyData[h].ts).getHours();
    hourBuckets[hr] += historyData[h].session;
    hourCounts[hr]++;
  }
  var peakHour = 0, peakHourAvg = 0;
  for (var hh = 0; hh < 24; hh++) {
    var avg = hourCounts[hh] > 0 ? hourBuckets[hh] / hourCounts[hh] : 0;
    if (avg > peakHourAvg) { peakHourAvg = avg; peakHour = hh; }
  }

  // Stats cards
  var grid = el('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:16px;';

  function statCard(label, value, sub) {
    var card = el('div');
    card.style.cssText = 'padding:14px;background:var(--surface);border:1px solid var(--border);border-radius:10px;';
    var valEl = el('div');
    valEl.style.cssText = 'font-size:24px;font-weight:700;color:var(--accent);font-family:"JetBrains Mono",monospace;';
    valEl.textContent = value;
    card.appendChild(valEl);
    var labelEl = el('div');
    labelEl.style.cssText = 'font-size:11px;color:var(--text-dim);margin-top:4px;';
    labelEl.textContent = label;
    card.appendChild(labelEl);
    if (sub) {
      var subEl = el('div');
      subEl.style.cssText = 'font-size:9px;color:var(--text-dim);margin-top:2px;';
      subEl.textContent = sub;
      card.appendChild(subEl);
    }
    return card;
  }

  grid.appendChild(statCard('Avg Session (7d)', avgSession7 + '%', 'Average session utilization'));
  grid.appendChild(statCard('Peak Session', peakSession + '%', 'All-time highest'));
  grid.appendChild(statCard('Peak Hour', peakHour + ':00', Math.round(peakHourAvg) + '% avg session at this hour'));
  grid.appendChild(statCard('Limit Days', limitDays.size, 'Days session hit \u226595%'));
  grid.appendChild(statCard('Data Points', historyData.length, last30.length + ' in last 30 days'));
  grid.appendChild(statCard('Streak', (typeof streakData !== 'undefined' && streakData.current) || 0, 'Consecutive task-complete days'));

  container.appendChild(grid);

  // Hourly usage heatmap
  var heatTitle = el('div');
  heatTitle.style.cssText = 'font-size:13px;font-weight:600;color:var(--text);margin-bottom:8px;';
  heatTitle.textContent = 'Usage by Hour';
  container.appendChild(heatTitle);

  var heatGrid = el('div');
  heatGrid.style.cssText = 'display:flex;gap:2px;height:40px;align-items:flex-end;';
  var maxAvg = 1;
  for (var ha = 0; ha < 24; ha++) {
    var a = hourCounts[ha] > 0 ? hourBuckets[ha] / hourCounts[ha] : 0;
    if (a > maxAvg) maxAvg = a;
  }
  for (var hb = 0; hb < 24; hb++) {
    var bar = el('div');
    var pct = hourCounts[hb] > 0 ? (hourBuckets[hb] / hourCounts[hb]) / maxAvg * 100 : 0;
    var color = pct > 75 ? '#f87171' : (pct > 50 ? '#fb923c' : (pct > 25 ? '#facc15' : '#4ade80'));
    bar.style.cssText = 'flex:1;border-radius:2px 2px 0 0;min-height:2px;background:' + color + ';height:' + Math.max(2, pct) + '%;';
    bar.title = hb + ':00 - ' + Math.round(hourCounts[hb] > 0 ? hourBuckets[hb] / hourCounts[hb] : 0) + '% avg';
    heatGrid.appendChild(bar);
  }
  container.appendChild(heatGrid);

  var hourLabels = el('div');
  hourLabels.style.cssText = 'display:flex;gap:2px;font-size:7px;color:var(--text-dim);margin-top:2px;';
  for (var hl = 0; hl < 24; hl += 3) {
    var lbl = el('span');
    lbl.style.cssText = 'flex:3;text-align:center;';
    lbl.textContent = hl + 'h';
    hourLabels.appendChild(lbl);
  }
  container.appendChild(hourLabels);
}

// Render analytics on tab click
var streakData = {};

function renderSettings() {
  var container = document.getElementById('settingRows');
  while (container.firstChild) container.removeChild(container.firstChild);

  // Theme setting
  var themeRow = el('div', 'setting-row');
  var themeInfo = el('div', 'setting-info');
  themeInfo.appendChild(el('div', 'setting-label', 'Theme'));
  themeInfo.appendChild(el('div', 'setting-value', 'Choose your visual theme'));
  themeRow.appendChild(themeInfo);
  var themeSelect = document.createElement('select');
  themeSelect.style.cssText = 'padding:6px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;font-size:12px;color:var(--text);font-family:inherit;outline:none;';
  var themeOpts = [['brutal', 'Brutal'], ['karchx', 'Karchx'], ['dark', 'Dark'], ['light', 'Light'], ['nord', 'Nord'], ['dracula', 'Dracula']];
  for (var ti = 0; ti < themeOpts.length; ti++) {
    var to = document.createElement('option');
    to.value = themeOpts[ti][0];
    to.textContent = themeOpts[ti][1];
    themeSelect.appendChild(to);
  }
  window.dashboardAPI.getTheme().then(function(name) { themeSelect.value = name || 'dark'; });
  themeSelect.addEventListener('change', function() { window.dashboardAPI.setTheme(themeSelect.value); });
  themeRow.appendChild(themeSelect);
  container.appendChild(themeRow);

  // Add theme listener for dashboard itself
  window.dashboardAPI.onThemeUpdate(function(theme) {
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

  // Hotkey setting
  var hotkeyRow = el('div', 'setting-row');
  var hotkeyInfo = el('div', 'setting-info');
  hotkeyInfo.appendChild(el('div', 'setting-label', 'Toggle widget'));
  hotkeyRow.appendChild(hotkeyInfo);

  var hotkeyContainer = el('div', 'hotkey-container');
  var hotkeyDisplay = el('div', 'hotkey-display', currentDisplayHotkey);
  var changeBtn = el('button', 'hotkey-change-btn', 'Change');
  var statusEl = el('div', 'hotkey-status');

  var keydownHandler = null;

  changeBtn.addEventListener('click', function() {
    if (isRecordingHotkey) {
      // Cancel
      isRecordingHotkey = false;
      hotkeyDisplay.classList.remove('recording');
      hotkeyDisplay.textContent = currentDisplayHotkey;
      changeBtn.textContent = 'Change';
      if (keydownHandler) {
        document.removeEventListener('keydown', keydownHandler, true);
        keydownHandler = null;
      }
      return;
    }

    isRecordingHotkey = true;
    hotkeyDisplay.classList.add('recording');
    hotkeyDisplay.textContent = 'Press shortcut...';
    changeBtn.textContent = 'Cancel';
    statusEl.textContent = '';
    statusEl.className = 'hotkey-status';

    keydownHandler = function(e) {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        // Cancel recording
        isRecordingHotkey = false;
        hotkeyDisplay.classList.remove('recording');
        hotkeyDisplay.textContent = currentDisplayHotkey;
        changeBtn.textContent = 'Change';
        document.removeEventListener('keydown', keydownHandler, true);
        keydownHandler = null;
        return;
      }

      var accelerator = formatElectronAccelerator(e);
      if (!accelerator) return; // modifier-only press, wait for full combo

      isRecordingHotkey = false;
      hotkeyDisplay.classList.remove('recording');
      hotkeyDisplay.textContent = accelerator;
      changeBtn.textContent = 'Change';
      document.removeEventListener('keydown', keydownHandler, true);
      keydownHandler = null;

      // Send to main process
      statusEl.textContent = 'Registering...';
      statusEl.className = 'hotkey-status';

      window.dashboardAPI.changeHotkey(accelerator).then(function(result) {
        if (result.success) {
          currentDisplayHotkey = accelerator;
          statusEl.textContent = 'Hotkey updated!';
          statusEl.className = 'hotkey-status success';
        } else {
          hotkeyDisplay.textContent = currentDisplayHotkey;
          statusEl.textContent = result.error || 'Failed to register';
          statusEl.className = 'hotkey-status error';
        }
        setTimeout(function() {
          statusEl.textContent = '';
          statusEl.className = 'hotkey-status';
        }, 3000);
      });
    };

    document.addEventListener('keydown', keydownHandler, true);
  });

  hotkeyContainer.appendChild(hotkeyDisplay);
  hotkeyContainer.appendChild(changeBtn);
  hotkeyRow.appendChild(hotkeyContainer);
  hotkeyRow.appendChild(statusEl);
  container.appendChild(hotkeyRow);

  // Auto-start setting
  var autoRow = el('div', 'setting-row');
  var autoInfo = el('div', 'setting-info');
  autoInfo.appendChild(el('div', 'setting-label', 'Start on login'));
  autoInfo.appendChild(el('div', 'setting-value', 'Launch automatically when you log in'));
  autoRow.appendChild(autoInfo);
  var toggleWrap = el('label', 'toggle');
  var toggleInput = document.createElement('input');
  toggleInput.type = 'checkbox';
  toggleInput.className = 'toggle-input';
  var toggleSlider = el('span', 'toggle-slider');
  toggleWrap.appendChild(toggleInput);
  toggleWrap.appendChild(toggleSlider);
  autoRow.appendChild(toggleWrap);
  container.appendChild(autoRow);
  // Load current state
  window.dashboardAPI.getAutostart().then(function(result) {
    toggleInput.checked = result.enabled;
  });
  toggleInput.addEventListener('change', function() {
    window.dashboardAPI.setAutostart(toggleInput.checked);
  });

  // Check for updates
  var updateRow = el('div', 'setting-row');
  var updateInfo = el('div', 'setting-info');
  updateInfo.appendChild(el('div', 'setting-label', 'Updates'));
  var updateMeta = el('div', 'setting-value', 'Current version: v' + currentAppVersion);
  updateInfo.appendChild(updateMeta);
  updateRow.appendChild(updateInfo);
  var updateBtn = el('button', 'update-btn', 'Check for Updates');
  var updateCheckResult = null;
  updateBtn.addEventListener('click', function() {
    // If we already found an update, trigger download
    if (updateCheckResult && updateCheckResult.hasUpdate) {
      if (!updateCheckResult.downloadUrl) {
        updateBtn.textContent = 'No installer found';
        setTimeout(function() {
          updateBtn.textContent = 'Update to v' + updateCheckResult.latestVersion;
        }, 3000);
        return;
      }
      updateBtn.textContent = 'Downloading...';
      updateBtn.disabled = true;
      updateBtn.classList.add('downloading');
      document.getElementById('updateProgress').classList.add('visible');
      window.dashboardAPI.installUpdate().then(function(result) {
        if (result.success) {
          updateBtn.textContent = 'Installing...';
          updateBtn.classList.remove('downloading');
        } else {
          updateBtn.textContent = 'Failed — retry';
          updateBtn.classList.remove('downloading');
          document.getElementById('updateProgress').classList.remove('visible');
          setTimeout(function() {
            updateBtn.textContent = 'Update to v' + updateCheckResult.latestVersion;
            updateBtn.disabled = false;
          }, 3000);
        }
      }).catch(function() {
        updateBtn.textContent = 'Failed — retry';
        updateBtn.classList.remove('downloading');
        document.getElementById('updateProgress').classList.remove('visible');
        updateBtn.disabled = false;
      });
      return;
    }

    // First click — check for updates
    updateBtn.textContent = 'Checking...';
    updateBtn.disabled = true;
    updateBtn.style.background = '';
    updateBtn.style.borderColor = '';
    window.dashboardAPI.checkForUpdates().then(function(result) {
      var banner = document.getElementById('updateBanner');
      if (result && result.hasUpdate) {
        updateCheckResult = result;
        while (banner.firstChild) banner.removeChild(banner.firstChild);
        var icon = document.createElement('div');
        icon.className = 'update-banner-icon';
        icon.textContent = '\u2B06';
        banner.appendChild(icon);
        var txt = document.createElement('div');
        txt.className = 'update-banner-text';
        txt.appendChild(document.createTextNode('v' + result.latestVersion + ' available'));
        var sub = document.createElement('span');
        sub.textContent = 'New version ready to install';
        txt.appendChild(sub);
        banner.appendChild(txt);
        banner.classList.add('visible');
        updateBtn.textContent = 'Update to v' + result.latestVersion;
        updateBtn.disabled = false;
      } else {
        updateBtn.textContent = '\u2713 Up to date';
        updateBtn.style.background = 'rgba(74, 222, 128, 0.12)';
        updateBtn.style.borderColor = 'rgba(74, 222, 128, 0.25)';
        updateBtn.style.color = '#4ade80';
        updateBtn.disabled = true;
        setTimeout(function() {
          updateBtn.textContent = 'Check for Updates';
          updateBtn.style.background = '';
          updateBtn.style.borderColor = '';
          updateBtn.style.color = '';
          updateBtn.disabled = false;
        }, 5000);
      }
    }).catch(function() {
      updateBtn.textContent = 'Check failed';
      setTimeout(function() {
        updateBtn.textContent = 'Check for Updates';
        updateBtn.disabled = false;
      }, 3000);
    });
  });
  updateRow.appendChild(updateBtn);
  container.appendChild(updateRow);

  // --- Main Account ---
  var mainAcctRow = el('div', 'setting-row');
  mainAcctRow.style.flexDirection = 'column';
  mainAcctRow.style.alignItems = 'stretch';

  var mainAcctHeader = el('div', 'setting-info');
  mainAcctHeader.appendChild(el('div', 'setting-label', 'Main Account'));
  mainAcctHeader.appendChild(el('div', 'setting-value', 'Your Claude subscription'));
  mainAcctRow.appendChild(mainAcctHeader);

  var mainAcctBtnRow = el('div');
  mainAcctBtnRow.style.cssText = 'display:flex;gap:8px;align-items:center;margin-top:12px;';

  var mainSignInBtn = el('button', 'update-btn', 'Re-Sign In');
  var mainSignOutBtn = el('button', 'update-btn', 'Sign Out');
  mainSignOutBtn.style.cssText = 'background:rgba(239,68,68,0.15);border-color:rgba(239,68,68,0.3);color:#ef4444;';

  var mainAcctStatus = el('div');
  mainAcctStatus.style.cssText = 'font-size:11px;flex:1;color:var(--text-dim);';

  mainAcctBtnRow.appendChild(mainSignInBtn);
  mainAcctBtnRow.appendChild(mainSignOutBtn);
  mainAcctBtnRow.appendChild(mainAcctStatus);
  mainAcctRow.appendChild(mainAcctBtnRow);
  container.appendChild(mainAcctRow);

  window.dashboardAPI.checkAuthStatus().then(function(result) {
    if (result && result.authenticated) {
      mainAcctStatus.textContent = 'Connected';
      mainAcctStatus.style.color = '#4ade80';
    } else {
      mainAcctStatus.textContent = 'Not signed in';
      mainAcctStatus.style.color = '#ef4444';
      mainSignInBtn.textContent = 'Sign In';
    }
  });

  mainSignInBtn.addEventListener('click', function() {
    window.dashboardAPI.launchAuthLogin().then(function(result) {
      if (result && result.success) {
        mainSignInBtn.disabled = true;
        mainAcctStatus.textContent = 'Sign in with Claude in the browser\u2026';
        mainAcctStatus.style.color = 'var(--text-dim)';
      } else {
        mainAcctStatus.textContent = (result && result.error) || 'Failed to launch sign-in';
        mainAcctStatus.style.color = '#ef4444';
      }
    });
  });

  window.dashboardAPI.onAuthStatusChanged(function(data) {
    if (data && data.authenticated) {
      mainSignInBtn.disabled = false;
      mainSignInBtn.textContent = 'Re-Sign In';
      mainAcctStatus.textContent = 'Connected';
      mainAcctStatus.style.color = '#4ade80';
    } else {
      mainSignInBtn.textContent = 'Sign In';
      mainAcctStatus.textContent = 'Not signed in';
      mainAcctStatus.style.color = '#ef4444';
    }
  });

  mainSignOutBtn.addEventListener('click', function() {
    mainSignOutBtn.disabled = true;
    mainAcctStatus.textContent = 'Signing out\u2026';
    mainAcctStatus.style.color = 'var(--text-dim)';
    window.dashboardAPI.signOut().then(function() {
      mainSignOutBtn.disabled = false;
      mainSignInBtn.textContent = 'Sign In';
      mainAcctStatus.textContent = 'Signed out';
      mainAcctStatus.style.color = 'var(--text-dim)';
    });
  });

  // --- Google Calendar ---
  var gcalSection = el('div', 'setting-row');
  gcalSection.style.flexDirection = 'column';
  gcalSection.style.alignItems = 'stretch';

  var gcalHeader = el('div', 'setting-info');
  gcalHeader.appendChild(el('div', 'setting-label', 'Google Calendar'));
  gcalHeader.appendChild(el('div', 'setting-value', 'Sync events from your Google accounts'));
  gcalSection.appendChild(gcalHeader);

  var gcalAccountsList = el('div');
  gcalAccountsList.style.cssText = 'margin-top:10px;';

  var gcalBtnRow = el('div');
  gcalBtnRow.style.cssText = 'display:flex;gap:8px;align-items:center;margin-top:12px;';

  var gcalAddBtn = el('button', 'update-btn', '+ Add Google Account');
  gcalAddBtn.style.cssText += 'background:linear-gradient(135deg,#4285f4,#34a853);border:none;color:#fff;';
  var gcalSyncBtn = el('button', 'update-btn', 'Sync Now');
  var gcalStatus = el('div');
  gcalStatus.style.cssText = 'font-size:11px;flex:1;color:var(--text-dim);';

  gcalBtnRow.appendChild(gcalAddBtn);
  gcalBtnRow.appendChild(gcalSyncBtn);
  gcalBtnRow.appendChild(gcalStatus);
  gcalSection.appendChild(gcalAccountsList);
  gcalSection.appendChild(gcalBtnRow);
  container.appendChild(gcalSection);

  function renderGcalAccounts(accounts, lastSync) {
    while (gcalAccountsList.firstChild) gcalAccountsList.removeChild(gcalAccountsList.firstChild);
    if (!accounts || accounts.length === 0) {
      var empty = el('div');
      empty.style.cssText = 'font-size:11px;color:var(--text-dim);padding:4px 0;';
      empty.textContent = 'No Google accounts connected';
      gcalAccountsList.appendChild(empty);
      return;
    }
    for (var i = 0; i < accounts.length; i++) {
      (function(acct) {
        var row = el('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;margin-bottom:4px;background:var(--surface);border:1px solid var(--border);border-radius:6px;';

        var icon = el('span');
        icon.textContent = '\uD83D\uDCC5';
        icon.style.cssText = 'font-size:14px;';
        row.appendChild(icon);

        var emailEl = el('span');
        emailEl.textContent = acct.email;
        emailEl.style.cssText = 'flex:1;font-size:12px;color:var(--text);';
        row.appendChild(emailEl);

        var removeBtn = el('button');
        removeBtn.textContent = 'Remove';
        removeBtn.style.cssText = 'padding:3px 10px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.25);border-radius:4px;font-size:10px;color:#ef4444;cursor:pointer;font-family:inherit;';
        removeBtn.addEventListener('click', function() {
          removeBtn.disabled = true;
          removeBtn.textContent = 'Removing\u2026';
          window.dashboardAPI.gcalRemoveAccount(acct.email).then(function() {
            window.dashboardAPI.gcalGetStatus().then(function(s) {
              renderGcalAccounts(s.accounts, s.lastSync);
            });
          });
        });
        row.appendChild(removeBtn);
        gcalAccountsList.appendChild(row);
      })(accounts[i]);
    }
    if (lastSync) {
      gcalStatus.textContent = 'Last sync: ' + formatRelativeTime(lastSync);
    }
  }

  function formatRelativeTime(ts) {
    var diff = Date.now() - ts;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return new Date(ts).toLocaleString();
  }

  // Load initial state
  window.dashboardAPI.gcalGetStatus().then(function(s) {
    renderGcalAccounts(s.accounts, s.lastSync);
  });

  // Listen for sync updates
  window.dashboardAPI.onGcalSyncStatus(function(data) {
    renderGcalAccounts(data.accounts, data.lastSync);
    if (data.errors && data.errors.length > 0) {
      gcalStatus.textContent = 'Error: ' + data.errors[0].error;
      gcalStatus.style.color = '#ef4444';
    } else {
      gcalStatus.style.color = 'var(--text-dim)';
    }
  });

  gcalAddBtn.addEventListener('click', function() {
    gcalAddBtn.disabled = true;
    gcalAddBtn.textContent = 'Waiting for Google\u2026';
    gcalStatus.textContent = 'Complete sign-in in your browser';
    gcalStatus.style.color = '#4285f4';
    window.dashboardAPI.gcalAddAccount().then(function(result) {
      gcalAddBtn.disabled = false;
      gcalAddBtn.textContent = '+ Add Google Account';
      if (result.success) {
        gcalStatus.textContent = 'Connected: ' + result.email;
        gcalStatus.style.color = '#4ade80';
        window.dashboardAPI.gcalGetStatus().then(function(s) {
          renderGcalAccounts(s.accounts, s.lastSync);
        });
      } else {
        gcalStatus.textContent = result.error || 'Failed';
        gcalStatus.style.color = '#ef4444';
      }
    });
  });

  gcalSyncBtn.addEventListener('click', function() {
    gcalSyncBtn.disabled = true;
    gcalSyncBtn.textContent = 'Syncing\u2026';
    gcalStatus.textContent = 'Syncing calendars\u2026';
    gcalStatus.style.color = 'var(--text-dim)';
    window.dashboardAPI.gcalSyncNow().then(function(result) {
      gcalSyncBtn.disabled = false;
      gcalSyncBtn.textContent = 'Sync Now';
      if (result.success) {
        gcalStatus.textContent = 'Last sync: just now';
        gcalStatus.style.color = '#4ade80';
      } else {
        gcalStatus.textContent = result.error || 'Sync failed';
        gcalStatus.style.color = '#ef4444';
      }
    });
  });

  // Version info
  var versionEl = document.getElementById('versionInfo');
  if (versionEl) versionEl.textContent = 'Claude Meter v' + currentAppVersion;
}

// --- Status tab ---

function formatStatusTime(ts) {
  if (!ts) return '';
  var d = new Date(ts);
  var now = Date.now();
  var diff = now - ts;
  var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ' ' + d.toLocaleDateString();
}

function dateKey(isoStr) {
  var d = new Date(isoStr);
  return d.getFullYear() + '-' + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1)
    + '-' + (d.getDate() < 10 ? '0' : '') + d.getDate();
}

function dateLabel(key) {
  var today = dateKey(new Date().toISOString());
  if (key === today) return 'Today';
  var yesterday = new Date(Date.now() - 86400000);
  if (key === dateKey(yesterday.toISOString())) return 'Yesterday';
  var d = new Date(key + 'T12:00:00');
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  return days[d.getDay()] + ', ' + months[d.getMonth()] + ' ' + d.getDate();
}

function buildIncidentCard(inc) {
  var impactColors = { minor: 'var(--yellow)', major: 'var(--red)', critical: 'var(--red)' };
  var card = el('div', 'status-incident-card');

  var row1 = el('div', 'status-inc-row1');
  var dot = el('div', 'status-inc-dot');
  dot.style.background = inc.resolvedAt ? 'var(--text-dim)' : (impactColors[inc.impact] || 'var(--yellow)');
  row1.appendChild(dot);
  row1.appendChild(el('div', 'status-inc-name', inc.name));

  var badge = el('div', 'status-inc-badge', inc.impact || 'incident');
  if (inc.impact === 'minor') {
    badge.style.cssText = 'background:rgba(250,204,21,0.1);color:var(--yellow);';
  } else {
    badge.style.cssText = 'background:rgba(248,113,113,0.1);color:var(--red);';
  }
  row1.appendChild(badge);
  card.appendChild(row1);

  // Meta line: components · time · duration
  var meta = [];
  if (inc.components && inc.components.length) meta.push(inc.components.join(', '));
  var startTs = inc.startedAt ? new Date(inc.startedAt).getTime() : 0;
  if (inc.startedAt) {
    var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
    var sd = new Date(inc.startedAt);
    meta.push(pad(sd.getHours()) + ':' + pad(sd.getMinutes()));
  }
  if (inc.startedAt && inc.resolvedAt) {
    var dur = Math.round((new Date(inc.resolvedAt) - new Date(inc.startedAt)) / 60000);
    meta.push(dur < 60 ? dur + 'm' : Math.floor(dur / 60) + 'h ' + (dur % 60) + 'm');
  } else if (!inc.resolvedAt) {
    meta.push('ongoing');
  }
  if (meta.length) card.appendChild(el('div', 'status-inc-meta', meta.join(' \u00B7 ')));

  if (inc.latestUpdate) {
    card.appendChild(el('div', 'status-inc-update', inc.latestUpdate));
  }
  return card;
}

function renderStatusTab() {
  var healthCard = document.getElementById('statusHealthCard');
  var groupsContainer = document.getElementById('statusIncidentGroups');
  if (!healthCard || !groupsContainer) return;

  while (healthCard.firstChild) healthCard.removeChild(healthCard.firstChild);
  while (groupsContainer.firstChild) groupsContainer.removeChild(groupsContainer.firstChild);

  // --- Current status card ---
  var officialCard = el('div', 'status-health-card');
  var cs = claudeStatusData;
  var csIndicator = (cs && cs.indicator) || 'none';
  var csStatusMap = { none: 'healthy', minor: 'intermittent', major: 'degraded', critical: 'degraded' };
  var csDotClass = cs ? (csStatusMap[csIndicator] || 'intermittent') : 'unknown';
  var csLabels = { none: 'Operational', minor: 'Minor outage', major: 'Major outage', critical: 'Critical' };

  var csIndicatorEl = el('div', 'status-health-indicator');
  var csDot = el('div', 'status-health-dot ' + csDotClass);
  csDot.appendChild(el('div', 'status-health-dot-inner'));
  csIndicatorEl.appendChild(csDot);
  csIndicatorEl.appendChild(el('div', 'status-health-label ' + csDotClass, csLabels[csIndicator] || csIndicator));
  officialCard.appendChild(csIndicatorEl);

  var csInfo = el('div', 'status-stat');
  csInfo.style.flex = '1';

  if (!cs) {
    csInfo.appendChild(el('div', 'status-stat-sub', 'Fetching...'));
  } else if ((cs.incidents || []).length === 0) {
    var okEl = el('div', null, 'All Systems Operational');
    okEl.style.cssText = 'font-size:13px;font-weight:500;color:var(--green);';
    csInfo.appendChild(okEl);
  } else {
    for (var ii = 0; ii < cs.incidents.length; ii++) {
      var cinc = cs.incidents[ii];
      var incName = el('div', null, cinc.name);
      incName.style.cssText = 'font-size:13px;font-weight:600;margin-bottom:2px;';
      csInfo.appendChild(incName);
      if (cinc.components && cinc.components.length) {
        csInfo.appendChild(el('div', 'status-stat-sub', cinc.components.join(', ')));
      }
    }
  }

  var csLink = el('button', null, 'status.claude.com \u2197');
  csLink.style.cssText = 'background:none;border:none;color:var(--accent);font-size:10px;cursor:pointer;padding:0;font-family:inherit;margin-top:6px;';
  csLink.addEventListener('click', function() {
    window.dashboardAPI.openExternal('https://status.claude.com');
  });
  csInfo.appendChild(csLink);
  officialCard.appendChild(csInfo);
  healthCard.appendChild(officialCard);

  // --- Incidents grouped by date ---
  var allInc = [].concat(
    (cs && cs.incidents) || [],
    (cs && cs.pastIncidents) || []
  );

  if (allInc.length === 0) {
    groupsContainer.appendChild(el('div', 'status-empty', 'No incidents in the last 10 days'));
    return;
  }

  // Group by date (using startedAt)
  var groups = {};
  var groupOrder = [];
  for (var gi = 0; gi < allInc.length; gi++) {
    var inc = allInc[gi];
    var key = inc.startedAt ? dateKey(inc.startedAt) : dateKey(new Date().toISOString());
    if (!groups[key]) { groups[key] = []; groupOrder.push(key); }
    groups[key].push(inc);
  }
  // Sort groups newest first
  groupOrder.sort(function(a, b) { return b.localeCompare(a); });

  var todayKey = dateKey(new Date().toISOString());

  for (var di = 0; di < groupOrder.length; di++) {
    (function(dayKey, dayInc) {
      var isToday = dayKey === todayKey;
      var group = el('div', 'status-date-group');

      var header = el('div', 'status-date-header' + (isToday ? ' today' : ''));
      if (!isToday) header.classList.add('collapsed');
      var chevron = el('span', 'chevron', '\u25BC');
      header.appendChild(chevron);
      header.appendChild(el('span', 'date-label', dateLabel(dayKey)));
      header.appendChild(el('span', 'date-count', dayInc.length + ' incident' + (dayInc.length > 1 ? 's' : '')));
      group.appendChild(header);

      var body = el('div', 'status-date-body');
      if (!isToday) body.classList.add('collapsed');
      for (var ci = 0; ci < dayInc.length; ci++) {
        body.appendChild(buildIncidentCard(dayInc[ci]));
      }
      group.appendChild(body);

      if (!isToday) {
        header.addEventListener('click', function() {
          header.classList.toggle('collapsed');
          body.classList.toggle('collapsed');
        });
      }

      groupsContainer.appendChild(group);
    })(groupOrder[di], groups[groupOrder[di]]);
  }
}

// --- IPC handlers ---

window.dashboardAPI.onUsageUpdate(function(payload) {
  if (payload && Array.isArray(payload.accounts)) {
    accountsData = payload.accounts;
    if (typeof payload.cliLauncher === 'string' && payload.cliLauncher) {
      cliLauncherName = payload.cliLauncher;
    }
    activeAccountId = payload.activeAccountId
      || (accountsData[0] ? accountsData[0].id : null);
    var active = null;
    for (var i = 0; i < accountsData.length; i++) {
      if (accountsData[i].id === activeAccountId) active = accountsData[i];
    }
    if (!active && accountsData.length > 0) active = accountsData[0];
    if (active && active.usage) usageData = active.usage;
  } else if (payload && payload.session) {
    // Defensive: a bare usage object (pre-multi-account payload)
    accountsData = [];
    usageData = payload;
  } else {
    return;
  }
  renderOverview();
});

window.dashboardAPI.onHistoryUpdate(function(data) {
  historyData = data;
  // Redraw chart if history tab is visible
  var historyTab = document.getElementById('tab-history');
  if (historyTab && historyTab.classList.contains('active')) {
    drawChart();
  }
});

window.dashboardAPI.onClaudeStatusUpdate(function(data) {
  claudeStatusData = data;
  var statusTab = document.getElementById('tab-status');
  if (statusTab && statusTab.classList.contains('active')) {
    renderStatusTab();
  }
});

// --- Title bar controls ---

document.getElementById('tbMinimize').addEventListener('click', function() {
  window.dashboardAPI.minimize();
});
document.getElementById('tbMaximize').addEventListener('click', function() {
  window.dashboardAPI.maximize();
});
document.getElementById('tbClose').addEventListener('click', function() {
  window.dashboardAPI.close();
});

// --- Update ---

var pendingUpdate = null;

window.dashboardAPI.onUpdateAvailable(function(data) {
  pendingUpdate = data;
  var btn = document.getElementById('updateNowBtn');
  btn.textContent = 'Update to v' + data.latestVersion;
  btn.classList.add('visible');
  var ver = document.getElementById('sidebarVersion');
  ver.textContent = 'v' + currentAppVersion + ' \u2192 v' + data.latestVersion;
  // Populate overview banner
  var banner = document.getElementById('updateBanner');
  while (banner.firstChild) banner.removeChild(banner.firstChild);
  var icon = document.createElement('div');
  icon.className = 'update-banner-icon';
  icon.textContent = '\u2B06';
  banner.appendChild(icon);
  var txt = document.createElement('div');
  txt.className = 'update-banner-text';
  txt.appendChild(document.createTextNode('v' + data.latestVersion + ' available'));
  var sub = document.createElement('span');
  sub.textContent = 'New version ready to install';
  txt.appendChild(sub);
  banner.appendChild(txt);
  banner.classList.add('visible');
});

window.dashboardAPI.onUpdateProgress(function(pct) {
  var bar = document.getElementById('updateProgress');
  var fill = document.getElementById('updateProgressFill');
  var btn = document.getElementById('updateNowBtn');
  bar.classList.add('visible');
  fill.style.width = pct + '%';
  btn.textContent = pct + '% downloaded';
  btn.style.backgroundSize = pct + '% 100%, 100% 100%';
});

document.getElementById('updateNowBtn').addEventListener('click', function() {
  if (!pendingUpdate) return;
  var btn = document.getElementById('updateNowBtn');

  if (!pendingUpdate.downloadUrl) {
    btn.textContent = 'No installer found';
    setTimeout(function() {
      btn.textContent = 'Update to v' + pendingUpdate.latestVersion;
    }, 3000);
    return;
  }

  btn.textContent = 'Downloading...';
  btn.disabled = true;
  btn.classList.add('downloading');
  document.getElementById('updateProgress').classList.add('visible');

  window.dashboardAPI.installUpdate().then(function(result) {
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
      document.getElementById('updateProgress').classList.remove('visible');
      setTimeout(function() {
        btn.textContent = 'Update to v' + pendingUpdate.latestVersion;
        btn.disabled = false;
      }, 3000);
    }
  }).catch(function() {
    btn.textContent = 'Failed — retry';
    btn.classList.remove('downloading');
    btn.style.backgroundSize = '';
    btn.style.background = '';
    document.getElementById('updateProgress').classList.remove('visible');
    btn.disabled = false;
  });
});

// --- Init ---

// Load persisted settings before rendering
window.dashboardAPI.getSettings().then(function(settings) {
  if (settings) {
    if (settings.hotkey) currentDisplayHotkey = settings.hotkey;
    if (settings.version) {
      currentAppVersion = settings.version;
      var sidebarVer = document.getElementById('sidebarVersion');
      if (sidebarVer) sidebarVer.textContent = 'v' + currentAppVersion;
    }
    if (settings.alertThresholds) {
      if (typeof settings.alertThresholds.session === 'number') {
        alertThresholds.session = settings.alertThresholds.session;
      }
      if (typeof settings.alertThresholds.weekAll === 'number') {
        alertThresholds.weekAll = settings.alertThresholds.weekAll;
      }
      if (typeof settings.alertThresholds.weekSonnet === 'number') {
        alertThresholds.weekSonnet = settings.alertThresholds.weekSonnet;
      }
    }
  }
  renderAlerts();
  renderSettings();
}).catch(function() {
  renderAlerts();
  renderSettings();
});
window.dashboardAPI.requestData();
window.dashboardAPI.getClaudeStatus().then(function(data) {
  if (data) claudeStatusData = data;
});

// Sync status indicators
window.dashboardAPI.onSyncError(function(msg) {
  // If we have cached data, keep showing it — don't clear to 0
  if (usageData) renderOverview();
});

// Update countdowns every 10 seconds (lightweight text patch, no DOM rebuild)
setInterval(function() {
  if (!usageData && accountsData.length === 0) return;
  updateDashboardTimers();
}, 10000);

function patchCardCountdowns(metaSpans, sources) {
  for (var i = 0; i < metaSpans.length && i < sources.length; i++) {
    var spans = metaSpans[i].querySelectorAll('span');
    if (spans.length >= 2 && sources[i]) {
      spans[1].textContent = formatCountdown(sources[i].resetsAt);
    }
  }
}

function updateDashboardTimers() {
  // Patch countdown text in overview cards — per account group when there is
  // more than one, so a group never shows another account's reset time.
  var groups = document.querySelectorAll('#overviewCards .account-group');
  if (groups.length > 0) {
    for (var g = 0; g < groups.length && g < accountsData.length; g++) {
      var u = accountsData[g].usage;
      if (!u) continue;
      patchCardCountdowns(groups[g].querySelectorAll('.card-meta'), [u.session, u.weekAll, u.weekSonnet]);
    }
    return;
  }
  if (!usageData) return;
  patchCardCountdowns(
    document.querySelectorAll('#overviewCards .card-meta'),
    [usageData.session, usageData.weekAll, usageData.weekSonnet]
  );
}

// Redraw chart on window resize (debounced to avoid flicker)
var resizeDebounce = null;
window.addEventListener('resize', function() {
  if (resizeDebounce) clearTimeout(resizeDebounce);
  resizeDebounce = setTimeout(function() {
    var historyTab = document.getElementById('tab-history');
    if (historyTab && historyTab.classList.contains('active')) {
      drawChart();
    }
  }, 150);
});

// --- Tasks tab ---

var dashTasks = [];

function renderDashTasks() {
  var activeContainer = document.getElementById('dashTasksActive');
  var completedContainer = document.getElementById('dashTasksCompleted');
  var clearRow = document.getElementById('dashTasksClearRow');
  var counter = document.getElementById('tasksCounter');

  while (activeContainer.firstChild) activeContainer.removeChild(activeContainer.firstChild);
  while (completedContainer.firstChild) completedContainer.removeChild(completedContainer.firstChild);

  var active = [];
  var completed = [];
  for (var i = 0; i < dashTasks.length; i++) {
    if (dashTasks[i].done) completed.push(dashTasks[i]);
    else active.push(dashTasks[i]);
  }

  var doneCount = completed.length;
  counter.textContent = dashTasks.length === 0 ? '0 tasks'
    : doneCount + ' of ' + dashTasks.length + ' completed';

  if (active.length > 0) {
    var label = el('div', '', 'Active');
    label.style.cssText = 'font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:8px;font-weight:600;';
    activeContainer.appendChild(label);
    for (var a = 0; a < active.length; a++) {
      activeContainer.appendChild(buildDashTaskItem(active[a]));
    }
  }

  if (completed.length > 0) {
    var cLabel = el('div', '', 'Completed');
    cLabel.style.cssText = 'font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin:16px 0 8px;font-weight:600;';
    completedContainer.appendChild(cLabel);
    for (var c = 0; c < completed.length; c++) {
      completedContainer.appendChild(buildDashTaskItem(completed[c]));
    }
    clearRow.style.display = '';
  } else {
    clearRow.style.display = 'none';
  }
}

function buildDashTaskItem(task) {
  var row = el('div', '');
  row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--surface);border-radius:6px;border:1px solid var(--border);margin-bottom:4px;' + (task.done ? 'opacity:0.6;' : '');

  var cb = el('button', '');
  cb.style.cssText = 'width:16px;height:16px;border-radius:4px;border:1.5px solid ' + (task.done ? 'var(--green)' : 'var(--border)') + ';background:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:10px;color:' + (task.done ? 'var(--green)' : 'transparent') + ';flex-shrink:0;';
  cb.textContent = task.done ? '\u2713' : '';
  cb.addEventListener('click', function() {
    window.dashboardAPI.toggleTask(task.id);
  });

  var text = el('span', '', task.text);
  text.style.cssText = 'font-size:12px;flex:1;' + (task.done ? 'text-decoration:line-through;color:var(--text-dim);' : '');

  var del = el('button', '', '\u00D7');
  del.style.cssText = 'font-size:12px;color:var(--red);background:none;border:none;cursor:pointer;padding:2px 6px;opacity:0.5;';
  del.addEventListener('click', function() {
    window.dashboardAPI.deleteTask(task.id);
  });

  row.appendChild(cb);
  row.appendChild(text);
  row.appendChild(del);
  return row;
}

document.getElementById('dashTaskAddBtn').addEventListener('click', function() {
  var input = document.getElementById('dashTaskInput');
  var text = input.value.trim();
  if (text) {
    window.dashboardAPI.addTask(text);
    input.value = '';
  }
});

document.getElementById('dashTaskInput').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') {
    var text = this.value.trim();
    if (text) {
      window.dashboardAPI.addTask(text);
      this.value = '';
    }
  }
});

document.getElementById('dashClearCompleted').addEventListener('click', function() {
  window.dashboardAPI.clearCompleted();
});

window.dashboardAPI.onTasksUpdate(function(data) {
  dashTasks = data;
  renderDashTasks();
});

window.dashboardAPI.getTasks().then(function(data) {
  dashTasks = data;
  renderDashTasks();
});

// --- Habits tab ---

var habitsData = { training: [], reading: [], learning: [] };
var habitsView = {
  training: { year: null, month: null }, // 0-indexed month
  reading: { year: null, month: null },
  learning: { year: null, month: null },
};
var habitsInited = false;

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
  // Calendar days between midnight-aligned dates (b - a).
  var aMid = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  var bMid = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((bMid.getTime() - aMid.getTime()) / 86400000);
}

function monthLabel(year, month) {
  var names = ['January', 'February', 'March', 'April', 'May', 'June',
               'July', 'August', 'September', 'October', 'November', 'December'];
  return names[month] + ' ' + year;
}

function streakInMonth(kind, year, month) {
  // Count of marked days in the given month.
  var arr = habitsData[kind] || [];
  var prefix = year + '-' + pad2(month + 1) + '-';
  var n = 0;
  for (var i = 0; i < arr.length; i++) {
    if (arr[i].indexOf(prefix) === 0) n++;
  }
  return n;
}

function renderHabitCal(kind) {
  var view = habitsView[kind];
  var year = view.year;
  var month = view.month;
  var labelEl = document.getElementById(kind + 'Month');
  var streakEl = document.getElementById(kind + 'Streak');
  var grid = document.getElementById(kind + 'Grid');
  if (!labelEl || !grid) return;
  labelEl.textContent = monthLabel(year, month);

  var marked = {};
  var arr = habitsData[kind] || [];
  for (var i = 0; i < arr.length; i++) marked[arr[i]] = true;

  var todayStr = ymd(new Date());

  // Clear grid
  while (grid.firstChild) grid.removeChild(grid.firstChild);

  // Day-of-week headers (Mon-first)
  var dows = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  for (var d = 0; d < 7; d++) {
    var dow = document.createElement('div');
    dow.className = 'habit-cal-dow';
    dow.textContent = dows[d];
    grid.appendChild(dow);
  }

  // Compute leading blanks (Mon=0..Sun=6)
  var first = new Date(year, month, 1);
  var firstDow = (first.getDay() + 6) % 7;
  for (var b = 0; b < firstDow; b++) {
    var blank = document.createElement('div');
    blank.className = 'habit-cal-day empty';
    grid.appendChild(blank);
  }

  // Days in month
  var daysInMonth = new Date(year, month + 1, 0).getDate();
  for (var dd = 1; dd <= daysInMonth; dd++) {
    var dateStr = year + '-' + pad2(month + 1) + '-' + pad2(dd);
    var cell = document.createElement('div');
    cell.className = 'habit-cal-day';
    if (dateStr === todayStr) cell.classList.add('today');
    if (marked[dateStr]) {
      cell.classList.add('marked');
      cell.textContent = '✓';
      cell.title = dateStr + ' — done';
    } else {
      cell.textContent = String(dd);
      cell.title = dateStr;
    }
    if (dateStr > todayStr) cell.classList.add('future');
    cell.setAttribute('data-date', dateStr);
    cell.setAttribute('data-kind', kind);
    grid.appendChild(cell);
  }

  if (streakEl) {
    var n = streakInMonth(kind, year, month);
    streakEl.textContent = n + (n === 1 ? ' day this month' : ' days this month');
  }
}

function renderHabits() {
  if (!habitsInited) initHabitsHandlers();
  // Default views to current month if not yet set
  var now = new Date();
  if (habitsView.training.year === null) {
    habitsView.training.year = now.getFullYear();
    habitsView.training.month = now.getMonth();
  }
  if (habitsView.reading.year === null) {
    habitsView.reading.year = now.getFullYear();
    habitsView.reading.month = now.getMonth();
  }
  if (habitsView.learning.year === null) {
    habitsView.learning.year = now.getFullYear();
    habitsView.learning.month = now.getMonth();
  }
  renderHabitCal('training');
  renderHabitCal('reading');
  renderHabitCal('learning');
}

function initHabitsHandlers() {
  habitsInited = true;

  // Month nav
  var navBtns = document.querySelectorAll('.habit-nav-btn');
  for (var i = 0; i < navBtns.length; i++) {
    (function(btn) {
      btn.addEventListener('click', function() {
        var kind = btn.getAttribute('data-cal');
        var dir = parseInt(btn.getAttribute('data-dir'), 10);
        var v = habitsView[kind];
        v.month += dir;
        if (v.month < 0) { v.month = 11; v.year -= 1; }
        else if (v.month > 11) { v.month = 0; v.year += 1; }
        renderHabitCal(kind);
      });
    })(navBtns[i]);
  }

  // Day toggle (event delegation on each grid)
  var grids = ['trainingGrid', 'readingGrid', 'learningGrid'];
  for (var g = 0; g < grids.length; g++) {
    (function(gridId) {
      var grid = document.getElementById(gridId);
      if (!grid) return;
      grid.addEventListener('click', function(e) {
        var cell = e.target;
        if (!cell || !cell.classList || !cell.classList.contains('habit-cal-day')) return;
        if (cell.classList.contains('empty') || cell.classList.contains('future')) return;
        var date = cell.getAttribute('data-date');
        var kind = cell.getAttribute('data-kind');
        if (!date || !kind) return;
        window.dashboardAPI.toggleHabitDay(kind, date).then(function(h) {
          habitsData = h;
          renderHabitCal(kind);
        });
      });
    })(grids[g]);
  }
}

// Live updates from main process
if (window.dashboardAPI && window.dashboardAPI.onHabitsUpdate) {
  window.dashboardAPI.onHabitsUpdate(function(data) {
    habitsData = data || habitsData;
    var habitsTab = document.getElementById('tab-habits');
    if (habitsTab && habitsTab.classList.contains('active')) {
      renderHabitCal('training');
      renderHabitCal('reading');
      renderHabitCal('learning');
    }
  });
}

// Prime the data so the habit calendars are ready when the tab opens
if (window.dashboardAPI && window.dashboardAPI.getHabits) {
  window.dashboardAPI.getHabits().then(function(data) {
    if (data) habitsData = data;
  });
}

// Programmatic tab navigation from the widget (e.g., clicking the habits banner)
if (window.dashboardAPI && window.dashboardAPI.onNavigateTab) {
  window.dashboardAPI.onNavigateTab(function(tab) {
    if (!tab) return;
    var target = document.querySelector('.sidebar-nav li[data-tab="' + tab + '"]');
    if (target) target.click();
  });
}
