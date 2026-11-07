/* Dashboard renderer — safe DOM only (no innerHTML) */

var WL = window.WidgetLib;
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

// The server's severity when it graded the limit, else the pct thresholds.
function getMeterClass(meter) {
  if (meter.severity === 'critical') return 'danger';
  if (meter.severity === 'warning') return 'warning';
  if (meter.severity === 'normal') return '';
  return getBarClass(meter.pct);
}

// The first theme message comes as the page finishes loading, so this can't wait for anything.
window.dashboardAPI.onThemeUpdate(function(theme) {
  UI.applyTheme(theme);
  var chips = document.querySelectorAll('.theme-chip');
  for (var i = 0; i < chips.length; i++) {
    chips[i].setAttribute('aria-pressed', chips[i].getAttribute('data-theme-name') === theme.name ? 'true' : 'false');
  }
  if (currentTab === 'history') drawChart();
});

// --- Navigation: four sections, each with its own tabs ---

var SECTIONS = [
  { id: 'usage', title: 'Usage', tabs: [['overview', 'Overview'], ['history', 'History'], ['alerts', 'Alerts'], ['status', 'Status']] },
  { id: 'plan', title: 'Plan', tabs: [['calendar', 'Calendar'], ['tasks', 'Tasks'], ['habits', 'Habits'], ['notes', 'Notes']] },
  { id: 'maps', title: 'Maps', tabs: [['maps', 'Maps']] },
  { id: 'settings', title: 'Settings', tabs: [['settings', 'Settings']] },
];
// A name other windows may still ask for.
var TAB_ALIASES = { analytics: 'history' };
var currentTab = 'overview';
var lastTabOf = {};

function sectionOfTab(tab) {
  for (var i = 0; i < SECTIONS.length; i++) {
    for (var j = 0; j < SECTIONS[i].tabs.length; j++) {
      if (SECTIONS[i].tabs[j][0] === tab) return SECTIONS[i];
    }
  }
  return null;
}

function renderSectionTabs(section, tab) {
  var holder = document.getElementById('sectionTabs');
  while (holder.firstChild) holder.removeChild(holder.firstChild);
  document.getElementById('sectionTitle').textContent = section.title;
  if (section.tabs.length < 2) return;
  section.tabs.forEach(function(entry) {
    var button = el('button', entry[0] === tab ? 'active' : '', entry[1]);
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', entry[0] === tab ? 'true' : 'false');
    button.addEventListener('click', function() { showTab(entry[0]); });
    holder.appendChild(button);
  });
}

function afterTabShown(tab) {
  if (tab === 'overview') renderOverview();
  // Redraw chart and fix pill slider when history tab becomes visible
  if (tab === 'history') {
    drawChart();
    renderAnalytics();
  }
  if (tab === 'calendar') renderCalendar();
  if (tab === 'habits') renderHabits();
  if (tab === 'maps') window.dashboardAPI.showMaps(hostBounds('mapsHost'));
  if (tab === 'notes') window.dashboardAPI.showNotes(hostBounds('notesHost'));
  if (tab === 'alerts') renderAlerts();
  if (tab === 'settings') renderSettingsAccounts();
  if (tab === 'status') {
    if (!claudeStatusData) {
      window.dashboardAPI.getClaudeStatus().then(function(data) {
        if (data) { claudeStatusData = data; renderStatusTab(); }
      });
    }
    renderStatusTab();
  }
}

function showTab(requested) {
  var tab = TAB_ALIASES[requested] || requested;
  var section = sectionOfTab(tab);
  if (!section) return;
  if (currentTab === 'maps' && tab !== 'maps') window.dashboardAPI.hideMaps();
  if (currentTab === 'notes' && tab !== 'notes') window.dashboardAPI.hideNotes();
  currentTab = tab;
  lastTabOf[section.id] = tab;
  document.querySelector('.main').classList.toggle('flush', tab === 'maps' || tab === 'notes');
  var panels = document.querySelectorAll('.tab-content');
  for (var i = 0; i < panels.length; i++) {
    panels[i].classList.toggle('active', panels[i].id === 'tab-' + tab);
  }
  var rail = document.querySelectorAll('.sidebar-nav button');
  for (var j = 0; j < rail.length; j++) {
    rail[j].classList.toggle('active', rail[j].getAttribute('data-section') === section.id);
  }
  renderSectionTabs(section, tab);
  afterTabShown(tab);
}

(function() {
  var rail = document.querySelectorAll('.sidebar-nav button');
  for (var i = 0; i < rail.length; i++) {
    (function(button) {
      button.addEventListener('click', function() {
        var id = button.getAttribute('data-section');
        var section = SECTIONS.filter(function(s) { return s.id === id; })[0];
        showTab(lastTabOf[id] || section.tabs[0][0]);
      });
    })(rail[i]);
  }
  renderSectionTabs(SECTIONS[0], 'overview');
})();

// --- Overview ---

function meterCells(meter, small) {
  var grade = WL.meterClass(meter);
  var cells = el('span', 'cells' + (small ? ' s' : '') + (grade === 'danger' ? ' hot' : (grade === 'warning' ? ' warm' : '')));
  cells.setAttribute('role', 'img');
  cells.setAttribute('aria-label', WL.shortLabel(meter) + ', ' + meter.pct + '% used');
  var filled = WL.filledCells(meter.pct);
  for (var i = 0; i < WL.CELLS; i++) cells.appendChild(el('u', i < filled ? 'on' : null));
  return cells;
}

function setRefillText(cell, state) {
  // The column is headed "Refills", so the word isn't repeated in each row.
  var detail = state.detail.replace(/^Refills /, '');
  var key = state.alert + '|' + detail;
  if (cell.getAttribute('data-text') === key) return;
  cell.setAttribute('data-text', key);
  // Past this length it would widen the whole table. The two pieces break between them, not inside.
  cell.classList.toggle('long', (state.alert + ' ' + detail).length > 26);
  while (cell.firstChild) cell.removeChild(cell.firstChild);
  if (state.alert) cell.appendChild(el('strong', null, state.alert));
  if (state.alert && detail) cell.appendChild(document.createTextNode(' '));
  if (detail) cell.appendChild(el('span', null, detail));
}

// Copied rather than run: a login has to land in this account's own folder.
function buildLoginButton(acc) {
  var command = (acc.login && acc.login.command) || 'CLAUDE_CONFIG_DIR=' + (acc.dir || '') + ' claude auth login';
  var button = el('button', 'login-btn', 'Copy login command');
  button.title = command;
  button.addEventListener('click', function(e) {
    e.stopPropagation();
    navigator.clipboard.writeText(command).then(function() {
      button.textContent = 'Copied, paste it in a terminal';
    }, function() {
      button.textContent = command;
    });
  });
  return button;
}

var boardCells = [];

function buildBoardRow(acc, index) {
  var state = WL.rowState(acc, Date.now());
  var chosen = acc.id === activeAccountId && accountsData.length > 1;
  var row = el('tr', (chosen ? 'active' : '')
    + (state.main && WL.meterClass(state.main) === 'danger' ? ' crit' : '')
    + (state.status === 'limited' || state.status === 'error' || state.status === 'out' ? ' stale-row' : ''));
  var name = acc.name || acc.id;
  row.title = name + (acc.email ? ' · ' + acc.email : '') + (acc.error ? '\n' + acc.error : '');
  row.setAttribute('tabindex', '0');
  row.setAttribute('aria-pressed', chosen ? 'true' : 'false');
  row.setAttribute('data-id', acc.id);

  var who = el('th');
  who.setAttribute('scope', 'row');
  var cell = el('div', 'account-cell');
  var bullet = el('span', 'bullet b-' + (index % 4), name.charAt(0).toUpperCase());
  bullet.setAttribute('aria-hidden', 'true');
  cell.appendChild(bullet);
  var label = el('div', 'who');
  var nameEl = el('div', 'name', name);
  if (chosen) nameEl.appendChild(el('em', null, 'Active'));
  if (acc.cliActive) {
    var cli = el('em', 'cli', 'CLI');
    cli.title = cliLauncherName + ' is running on this account';
    nameEl.appendChild(cli);
  }
  label.appendChild(nameEl);
  var login = acc.login;
  // The short form only: the long one can carry a whole shell command. Skipped when the Refills
  // column already gives this date.
  if (state.status !== 'out' && login && login.short && state.alert.indexOf('Login ends') !== 0) {
    var line = el('div', 'login-line' + (login.state === 'warn' ? ' warn' : ''), 'Login until ' + login.short);
    line.title = login.detail || login.text || '';
    label.appendChild(line);
  } else if (login && (login.detail || login.text)) {
    row.title += '\n' + (login.detail || login.text);
  }
  cell.appendChild(label);
  who.appendChild(cell);
  row.appendChild(who);

  var meterCell = el('td', 'tmeter');
  var pctCell = el('td', 'tpct');
  var fableCell = el('td', 'tfable');
  if (state.status === 'out') {
    meterCell.appendChild(buildLoginButton(acc));
    if (state.main) {
      pctCell.appendChild(el('b', null, String(state.main.pct)));
      pctCell.appendChild(el('small', null, '%'));
    }
  } else if (state.main) {
    var heads = WL.boardHeads(accountsData);
    meterCell.appendChild(meterCells(state.main, false));
    if (heads.labelMain) meterCell.appendChild(el('span', 'limit', WL.shortLabel(state.main)));
    pctCell.appendChild(el('b', null, String(state.main.pct)));
    pctCell.appendChild(el('small', null, '%'));
    state.subs.forEach(function(meter) {
      fableCell.appendChild(meterCells(meter, true));
      // A limit on its own clock says so: nothing else on screen gives that time.
      var refill = WL.refillDiffers(meter, state.main) ? ' · ' + WL.refillText(meter.resetsAt, Date.now()) : '';
      fableCell.appendChild(el('span', 'limit', (heads.labelSub ? WL.shortLabel(meter) + ' ' : '') + meter.pct + '%' + refill));
    });
  }
  row.appendChild(meterCell);
  row.appendChild(pctCell);
  row.appendChild(fableCell);

  var refill = el('td', 'trefill');
  setRefillText(refill, state);
  row.appendChild(refill);
  boardCells.push({ acc: acc, cell: refill });

  var choose = function() {
    if (acc.id === activeAccountId || !window.dashboardAPI.setActiveAccount) return;
    window.dashboardAPI.setActiveAccount(acc.id);
  };
  row.addEventListener('click', choose);
  row.addEventListener('keydown', function(e) {
    if (e.target !== row || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    choose();
  });
  return row;
}

function renderBoardHeads() {
  var heads = WL.boardHeads(accountsData);
  document.getElementById('boardMainHead').textContent = heads.main;
  document.getElementById('boardSubHead').textContent = heads.sub;
}

function renderTimeline() {
  var holder = document.getElementById('refillTimeline');
  while (holder.firstChild) holder.removeChild(holder.firstChild);
  var now = Date.now();
  var marks = WL.timelineMarks(accountsData, now);
  if (marks.length === 0) {
    holder.style.height = 'auto';
    holder.appendChild(el('div', 'tl-empty', 'No refills in the coming week.'));
    return;
  }
  holder.style.height = '';
  holder.appendChild(el('div', 'tl-line'));
  var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var today = new Date(now).getDay();
  for (var d = 0; d <= 7; d++) {
    var tick = document.createElement('i');
    tick.style.left = (d / 7 * 100).toFixed(2) + '%';
    tick.appendChild(el('span', null, DAY_NAMES[(today + d) % 7]));
    holder.appendChild(tick);
  }
  marks.forEach(function(mark) {
    var item = el('div', 'tl-m ' + mark.lane + (mark.flip ? ' flip' : ''));
    item.style.left = mark.x.toFixed(1) + '%';
    var bullet = el('span', 'bullet b-' + (mark.index % 4), mark.name.charAt(0).toUpperCase());
    bullet.setAttribute('aria-hidden', 'true');
    item.appendChild(bullet);
    var text = el('span');
    text.appendChild(el('b', null, mark.name));
    text.appendChild(document.createTextNode(mark.text));
    item.appendChild(text);
    holder.appendChild(item);
  });
}

function svgNode(tag, attrs, text) {
  var node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.keys(attrs).forEach(function(key) { node.setAttribute(key, attrs[key]); });
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderWeekChart() {
  var holder = document.getElementById('weekChart');
  var active = accountsData.filter(function(acc) { return acc.id === activeAccountId; })[0] || accountsData[0];
  var week = active && active.usage && active.usage.weekAll;
  while (holder.firstChild) holder.removeChild(holder.firstChild);
  document.getElementById('weekPanel').hidden = !week;
  if (!week) return;
  document.getElementById('weekTitle').textContent = (active.name || 'This account') + ' this week';
  var scoped = active.usage.weekSonnet;
  document.getElementById('weekScopedKey').textContent = (scoped && scoped.model) || 'Scoped';
  var series = WL.weekSeries(historyData, week.resetsAt);
  if (series.length < 2) {
    holder.appendChild(el('div', 'chart-empty', 'The chart fills in as this week goes on.'));
    return;
  }
  var W = 520;
  var H = 96;
  var line = function(key) {
    var d = '';
    series.forEach(function(point) {
      if (point[key] === null) return;
      d += (d ? 'L' : 'M') + (point.x / 100 * W).toFixed(1) + ' ' + (H - point[key] / 100 * H).toFixed(1);
    });
    return d;
  };
  var svg = svgNode('svg', { viewBox: '-2 -2 ' + (W + 34) + ' ' + (H + 20), role: 'img',
    'aria-label': (active.name || 'This account') + ' used ' + week.pct + ' percent of the week so far' });
  svg.appendChild(svgNode('path', { 'class': 'grid', d: 'M0 0H' + W + 'M0 ' + (H / 2) + 'H' + W + 'M0 ' + H + 'H' + W }));
  svg.appendChild(svgNode('path', { 'class': 'pace', d: 'M0 ' + H + 'L' + W + ' 0' }));
  svg.appendChild(svgNode('path', { 'class': 's2', d: line('scoped') }));
  svg.appendChild(svgNode('path', { 'class': 's1', d: line('all') }));
  var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var startDay = new Date(new Date(week.resetsAt).getTime() - 7 * 24 * 3600000).getDay();
  for (var d = 0; d < 7; d++) {
    svg.appendChild(svgNode('text', { x: (d / 7 * W).toFixed(1), y: H + 15 }, DAY_NAMES[(startDay + d) % 7]));
  }
  svg.appendChild(svgNode('text', { x: W + 4, y: 4 }, '100%'));
  svg.appendChild(svgNode('text', { x: W + 4, y: H / 2 + 4 }, '50%'));
  holder.appendChild(svg);
}

function renderOverviewToday() {
  var list = document.getElementById('overviewToday');
  if (!list) return;
  // The timer redraws this list, which must not pull keyboard focus out of it.
  if (list.contains(document.activeElement)) return;
  while (list.firstChild) list.removeChild(list.firstChild);
  var now = Date.now();
  var next = WL.upcomingEvents(typeof calEvents === 'undefined' ? [] : calEvents, now)[0];
  var addRow = function(strong, rest, action) {
    var li = el('li');
    var button = el('button');
    button.appendChild(el('b', null, strong));
    button.appendChild(document.createTextNode(' ' + rest));
    button.addEventListener('click', action);
    li.appendChild(button);
    list.appendChild(li);
  };
  if (next) {
    addRow(WL.eventTimeText(next, now), PlanLib.eventTitle(next), function() { showTab('calendar'); });
  } else {
    addRow('Nothing', 'coming up', function() { showTab('calendar'); });
  }
  var tasks = typeof dashTasks === 'undefined' || !dashTasks ? [] : dashTasks;
  var left = tasks.filter(function(task) { return !task.done; }).length;
  addRow(String(left), left === 1 ? 'task left' : 'tasks left', function() { showTab('tasks'); });
  if (typeof habitsData !== 'undefined' && habitsData) {
    var day = WL.localDay(now);
    var kinds = ['training', 'reading', 'relax'];
    var done = kinds.filter(function(kind) { return (habitsData[kind] || []).indexOf(day) !== -1; }).length;
    addRow(done + ' of ' + kinds.length, 'habits done', function() { showTab('habits'); });
  }
}

// --- Maps ---
var mapsState = { available: false, maps: [] };

// Drawn from the map's own bubbles and colours.
function mapThumb(map) {
  var svg = svgNode('svg', { 'class': 'thumb', viewBox: '0 0 120 72', 'aria-hidden': 'true' });
  svg.appendChild(svgNode('rect', { width: 120, height: 72, rx: 8, fill: '#111318' }));
  var bubbles = map.preview || [];
  if (bubbles.length === 0) {
    // Still a sketch, with no bubbles yet.
    svg.appendChild(svgNode('path', { d: 'M24 44c10-16 18-16 26-6s16 10 24-2 14-10 22-4', fill: 'none', stroke: '#a8aebb', 'stroke-width': 2, 'stroke-linecap': 'round' }));
    return svg;
  }
  var height = Math.max.apply(null, bubbles.map(function(b) { return b.y + b.h; }));
  var scale = Math.min(104 / 100, 56 / Math.max(height, 1));
  var left = (120 - 100 * scale) / 2;
  var top = (72 - height * scale) / 2;
  var centre = function(b) {
    return [left + (b.x + b.w / 2) * scale, top + (b.y + b.h / 2) * scale];
  };
  (map.links || []).forEach(function(link) {
    var from = centre(bubbles[link[0]]);
    var to = centre(bubbles[link[1]]);
    svg.appendChild(svgNode('path', { d: 'M' + from[0].toFixed(1) + ' ' + from[1].toFixed(1) + 'L' + to[0].toFixed(1) + ' ' + to[1].toFixed(1), stroke: '#e5e7eb', 'stroke-width': 1.5, fill: 'none' }));
  });
  bubbles.forEach(function(b) {
    svg.appendChild(svgNode('rect', {
      x: (left + b.x * scale).toFixed(1), y: (top + b.y * scale).toFixed(1),
      width: Math.max(4, b.w * scale).toFixed(1), height: Math.max(3, b.h * scale).toFixed(1),
      rx: Math.max(2, b.h * scale / 2).toFixed(1), fill: b.color,
    }));
  });
  return svg;
}

function mapButton(map, extraClass) {
  var button = el('button', 'mapitem' + (extraClass ? ' ' + extraClass : ''));
  button.title = 'Open ' + map.title;
  button.appendChild(mapThumb(map));
  var text = el('span');
  text.appendChild(el('b', null, map.title));
  text.appendChild(document.createTextNode(WL.editedText(map.updatedAt, Date.now())));
  button.appendChild(text);
  button.addEventListener('click', function() { window.dashboardAPI.openMaps({ id: map.id }); });
  return button;
}

function renderMaps() {
  document.getElementById('railMaps').hidden = !mapsState.available;
  document.getElementById('overviewMapsPanel').hidden = !mapsState.available;
  var overview = document.getElementById('overviewMaps');
  while (overview.firstChild) overview.removeChild(overview.firstChild);
  if (mapsState.maps.length === 0) {
    overview.appendChild(el('div', 'maps-empty', 'No maps yet.'));
    return;
  }
  mapsState.maps.slice(0, 2).forEach(function(map) { overview.appendChild(mapButton(map)); });
}

// The map and notes pages lie over these boxes in their own views, so main needs to know where they are.
function hostBounds(id) {
  var box = document.getElementById(id).getBoundingClientRect();
  return { x: box.left, y: box.top, width: box.width, height: box.height };
}

function renderMapsStatus(status) {
  var failed = status && status.state === 'error';
  document.getElementById('mapsStatusText').textContent = failed
    ? status.message + ' Your maps are saved.'
    : 'Opening Maps...';
  document.getElementById('mapsRetry').hidden = !failed;
}

new ResizeObserver(function() {
  if (currentTab === 'maps') window.dashboardAPI.placeMaps(hostBounds('mapsHost'));
}).observe(document.getElementById('mapsHost'));
new ResizeObserver(function() {
  if (currentTab === 'notes') window.dashboardAPI.placeNotes(hostBounds('notesHost'));
}).observe(document.getElementById('notesHost'));
window.dashboardAPI.onMapsStatus(renderMapsStatus);
document.getElementById('mapsRetry').addEventListener('click', function() {
  window.dashboardAPI.showMaps(hostBounds('mapsHost'));
});

function takeMapsState(state) {
  if (!state) return;
  mapsState = state;
  renderMaps();
}
window.dashboardAPI.getMapsState().then(takeMapsState);
window.dashboardAPI.onMapsUpdate(takeMapsState);
document.getElementById('overviewNewMap').addEventListener('click', function() { window.dashboardAPI.openMaps({ new: true }); });

function renderSyncText() {
  var sync = document.getElementById('dashSync');
  if (!usageData || !usageData.syncTime) { sync.textContent = ''; return; }
  var ago = Math.round((Date.now() - usageData.syncTime) / 60000);
  sync.textContent = ago < 1 ? 'Synced just now' : 'Synced ' + ago + 'm ago';
}

function renderOverview() {
  var body = document.getElementById('overviewRows');
  var focused = document.activeElement && document.activeElement.getAttribute('data-id');
  while (body.firstChild) body.removeChild(body.firstChild);
  boardCells = [];
  accountsData.forEach(function(acc, index) {
    var row = buildBoardRow(acc, index);
    body.appendChild(row);
    if (acc.id === focused) row.focus();
  });
  if (accountsData.length === 0) {
    var waiting = el('tr');
    var cell = el('td', null, 'Waiting for data...');
    cell.setAttribute('colspan', '5');
    waiting.appendChild(cell);
    body.appendChild(waiting);
  }
  renderBoardHeads();
  document.getElementById('overviewFoot').textContent = WL.extraSummary(accountsData);
  renderTimeline();
  renderWeekChart();
  renderOverviewToday();
  renderSyncText();
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
  if (status === 'at-risk') return 'At risk';
  if (status === 'watch') return 'Watch';
  return 'On track';
}

function getStatDotColor(pct) {
  if (pct >= 85) return 'var(--red)';
  if (pct >= 60) return 'var(--yellow)';
  return 'var(--green)';
}

function plannerBadge(status, text) {
  var header = el('div', 'planner-header');
  header.appendChild(el('div', 'planner-badge ' + status, text));
  return header;
}

function renderPlanner() {
  var container = document.getElementById('plannerText');
  while (container.firstChild) container.removeChild(container.firstChild);

  if (!usageData) {
    container.textContent = 'Waiting for data...';
    return;
  }
  if (!usageData.session) {
    // The plan reports no 5-hour window (Ultra): nothing to pace within it.
    container.appendChild(plannerBadge('on-track', 'No session limit'));
    container.appendChild(el('div', 'planner-recommendation',
      'This plan has no 5-hour session limit. Only the weekly limits apply.'));
    return;
  }

  var pct = usageData.session.pct;
  var resetsAt = usageData.session.resetsAt;

  if (pct === 0) {
    // Simple state — show badge + message
    container.appendChild(plannerBadge('on-track', 'On track'));
    container.appendChild(el('div', 'planner-recommendation', 'No session usage yet. You have a full 5-hour window available.'));
    return;
  }

  var resetTime = resetsAt ? new Date(resetsAt).getTime() : 0;
  var now = Date.now();
  var remainingMs = resetTime > 0 ? resetTime - now : 0;

  if (resetsAt && remainingMs <= 0) {
    container.appendChild(plannerBadge('on-track', 'On track'));
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
  container.appendChild(plannerBadge(status, getPlannerStatusLabel(status)));

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
  stat2.appendChild(el('div', 'planner-stat-label', 'Burn rate'));
  var val2 = el('div', 'planner-stat-value');
  val2.appendChild(document.createTextNode('~' + ratePerHour.toFixed(1) + '%/hr'));
  stat2.appendChild(val2);
  stats.appendChild(stat2);

  // Stat 3: Time to limit
  var stat3 = el('div', 'planner-stat');
  stat3.appendChild(el('div', 'planner-stat-label', 'Time to limit'));
  var val3 = el('div', 'planner-stat-value');
  if (hoursToLimit !== null && hoursToLimit < remainingHoursDecimal) {
    var limitH = Math.floor(hoursToLimit);
    var limitM = Math.round((hoursToLimit - limitH) * 60);
    val3.classList.add('bad');
    val3.appendChild(document.createTextNode(limitH + 'h ' + limitM + 'm'));
  } else {
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
    rec.textContent = 'Slow down: the limit is ' + lH + 'h ' + lM + 'm away. ';
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

// True when the active account's current usage says its plan has no such
// meter (Ultra: no 5-hour session). Only current data can say so - history
// written before 2.15 holds 0 where the meter was missing.
function planLacksMeter(key) {
  return !!(usageData && typeof usageData === 'object' && !usageData[key]);
}

function cssVar(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

var chartSeriesDefs = [
  { key: 'session', color: '#d4845a', label: 'Session' },
  { key: 'weekAll', color: '#111111', label: 'Weekly (all)' },
  { key: 'weekSonnet', color: '#23a094', label: 'Weekly (Fable)' },
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
  chartSeriesDefs[1].color = cssVar('--text', '#111111');
  chartSeriesDefs[2].color = cssVar('--green', '#23a094');
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
    // A limit the plan never reported in this range (null points) is no line.
    if (!datasets[d].some(function(v) { return typeof v === 'number'; })) continue;
    // Nor one the plan has dropped: builds before 2.15 stored 0 for "no
    // 5-hour limit", so old points alone would draw a fake flat 0 % line.
    if (planLacksMeter(def.key)) continue;
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
            color: cssVar('--text', '#111111'),
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
            color: cssVar('--text-dim', '#5f5a4f'),
            font: { size: 10, family: 'monospace' },
            maxTicksLimit: chartDays <= 7 ? 8 : (chartDays <= 14 ? 8 : 6),
            callback: function(val, idx) {
              return formatChartDate(this.getLabelForValue(val));
            },
          },
          grid: {
            color: 'rgba(127, 127, 127, 0.25)',
            drawTicks: true,
            tickLength: 4,
          },
          border: {
            color: 'rgba(127, 127, 127, 0.25)',
          },
        },
        y: {
          min: 0,
          max: 100,
          ticks: {
            color: cssVar('--text-dim', '#5f5a4f'),
            font: { size: 11, family: 'monospace' },
            stepSize: 25,
            callback: function(val) {
              return val + '%';
            },
          },
          grid: {
            color: 'rgba(127, 127, 127, 0.25)',
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
(function() {
  var buttons = document.querySelectorAll('.pill-btn');
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].addEventListener('click', function() {
      for (var j = 0; j < buttons.length; j++) {
        buttons[j].classList.toggle('active', buttons[j] === this);
        buttons[j].setAttribute('aria-pressed', buttons[j] === this ? 'true' : 'false');
      }
      chartDays = parseInt(this.getAttribute('data-days'), 10);
      drawChart();
    });
  }
})();

// --- Alerts ---

var ALERT_PRESETS = [
  { label: 'Relaxed', session: 60, weekAll: 60, weekSonnet: 60 },
  { label: 'Standard', session: 80, weekAll: 90, weekSonnet: 90 },
  { label: 'Late', session: 95, weekAll: 95, weekSonnet: 95 },
];

function presetIsActive(preset) {
  return alertThresholds.session === preset.session
    && alertThresholds.weekAll === preset.weekAll
    && alertThresholds.weekSonnet === preset.weekSonnet;
}

function updatePresetHighlights() {
  var chips = document.querySelectorAll('.alert-presets button');
  for (var i = 0; i < chips.length; i++) {
    var on = presetIsActive(ALERT_PRESETS[i]);
    chips[i].classList.toggle('active', on);
    chips[i].setAttribute('aria-pressed', on ? 'true' : 'false');
  }
}

function alertRow(key, label) {
  var row = el('div', 'alert-row');
  var labelEl = el('label', 'alert-label', label);
  labelEl.htmlFor = 'alert-' + key;
  row.appendChild(labelEl);
  var range = document.createElement('input');
  range.type = 'range';
  range.className = 'alert-range';
  range.id = 'alert-' + key;
  range.min = '5';
  range.max = '100';
  range.step = '5';
  range.value = String(alertThresholds[key]);
  var value = el('div', 'alert-value', alertThresholds[key] + '%');
  var paint = function() {
    range.style.setProperty('--pct', ((Number(range.value) - 5) / 95 * 100) + '%');
    value.textContent = range.value + '%';
  };
  paint();
  range.addEventListener('input', function() {
    alertThresholds[key] = Number(range.value);
    paint();
    updatePresetHighlights();
  });
  range.addEventListener('change', saveAlertThresholds);
  row.appendChild(range);
  row.appendChild(value);
  return row;
}

function renderAlerts() {
  var container = document.getElementById('alertRows');
  UI.clear(container);

  var presets = el('div', 'seg alert-presets');
  presets.setAttribute('role', 'group');
  presets.setAttribute('aria-label', 'Presets');
  ALERT_PRESETS.forEach(function(preset) {
    var chip = el('button', null, preset.label);
    chip.type = 'button';
    chip.addEventListener('click', function() {
      alertThresholds.session = preset.session;
      alertThresholds.weekAll = preset.weekAll;
      alertThresholds.weekSonnet = preset.weekSonnet;
      saveAlertThresholds();
      renderAlerts();
    });
    presets.appendChild(chip);
  });
  container.appendChild(presets);

  var card = el('div', 'alert-card card raised');
  // A plan with no session limit has no use for that level. It stays saved for one that does.
  if (!planLacksMeter('session')) card.appendChild(alertRow('session', 'Session'));
  card.appendChild(alertRow('weekAll', 'Weekly, all models'));
  var scoped = usageData && usageData.weekSonnet && usageData.weekSonnet.model;
  card.appendChild(alertRow('weekSonnet', 'Weekly, ' + (scoped || 'one model')));
  container.appendChild(card);
  updatePresetHighlights();
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
var planCalendar = PlanCalendar.mount(document.getElementById('calendarRoot'), {
  addEvent: window.dashboardAPI.addCalendarEvent,
  updateEvent: window.dashboardAPI.updateCalendarEvent,
  toggleEvent: window.dashboardAPI.toggleCalendarEvent,
  deleteEvent: window.dashboardAPI.deleteCalendarEvent,
  moveEvent: window.dashboardAPI.moveCalendarEvent,
  openExternal: window.dashboardAPI.openExternal,
});

function renderCalendar() {
  planCalendar.update(calEvents);
}

function takeCalendarEvents(events) {
  calEvents = events || [];
  renderCalendar();
  renderOverviewToday();
}
window.dashboardAPI.onCalendarUpdate(takeCalendarEvents);
window.dashboardAPI.getCalendarEvents().then(takeCalendarEvents);

// --- Analytics tab ---
function renderAnalytics() {
  var container = document.getElementById('analyticsContent');
  while (container.firstChild) container.removeChild(container.firstChild);

  if (!historyData || historyData.length < 2) {
    container.appendChild(el('p', 'page-note', 'Not enough data yet. Usage history builds over time.'));
    return;
  }

  // Compute stats
  var now = Date.now();
  var day7 = now - 7 * 86400000;
  var day30 = now - 30 * 86400000;
  var last7 = historyData.filter(function(p) { return p.ts > day7; });
  var last30 = historyData.filter(function(p) { return p.ts > day30; });

  // The stats follow the 5-hour session while the plan reports one; a plan
  // without it (Ultra: its points carry session null) uses the weekly limit.
  var hasNum = function(p, key) { return typeof p[key] === 'number'; };
  var statKey = !planLacksMeter('session') && last7.some(function(p) { return hasNum(p, 'session'); })
    ? 'session' : 'weekAll';
  var statName = statKey === 'session' ? 'Session' : 'Weekly';

  // Peak usage
  var peakSession = 0;
  for (var i = 0; i < historyData.length; i++) {
    if (hasNum(historyData[i], statKey) && historyData[i][statKey] > peakSession) {
      peakSession = historyData[i][statKey];
    }
  }

  // Average usage over the points that carry the series
  var avgSession7 = 0;
  var last7Stat = last7.filter(function(p) { return hasNum(p, statKey); });
  if (last7Stat.length > 0) {
    for (var j = 0; j < last7Stat.length; j++) avgSession7 += last7Stat[j][statKey];
    avgSession7 = Math.round(avgSession7 / last7Stat.length);
  }

  // Days hit limit (>= 95%)
  var limitDays = new Set();
  for (var k = 0; k < historyData.length; k++) {
    if (hasNum(historyData[k], statKey) && historyData[k][statKey] >= 95) {
      limitDays.add(new Date(historyData[k].ts).toDateString());
    }
  }

  // Peak hours
  var hourBuckets = new Array(24).fill(0);
  var hourCounts = new Array(24).fill(0);
  for (var h = 0; h < historyData.length; h++) {
    if (!hasNum(historyData[h], statKey)) continue;
    var hr = new Date(historyData[h].ts).getHours();
    hourBuckets[hr] += historyData[h][statKey];
    hourCounts[hr]++;
  }
  var peakHour = 0, peakHourAvg = 0;
  for (var hh = 0; hh < 24; hh++) {
    var avg = hourCounts[hh] > 0 ? hourBuckets[hh] / hourCounts[hh] : 0;
    if (avg > peakHourAvg) { peakHourAvg = avg; peakHour = hh; }
  }

  var grid = el('div', 'stat-grid card');
  function stat(value, label, sub) {
    var box = el('div', 'stat');
    box.appendChild(el('b', null, String(value)));
    box.appendChild(el('span', null, label));
    box.appendChild(el('small', null, sub));
    grid.appendChild(box);
  }
  var lower = statName.toLowerCase();
  stat(avgSession7 + '%', 'Average, ' + lower, 'Last 7 days');
  stat(peakSession + '%', 'Highest, ' + lower, 'All the history here');
  stat(peakHour + ':00', 'Busiest hour', Math.round(peakHourAvg) + '% on average at this hour');
  stat(limitDays.size, 'Days at the limit', 'Days ' + lower + ' reached 95%');
  stat(historyData.length, 'Readings', last30.length + ' in the last 30 days');
  stat(streakData.current || 0, 'Task streak', 'Days in a row with a task done');
  container.appendChild(grid);

  var hours = el('div', 'hours card');
  hours.appendChild(el('h3', null, 'Usage by hour'));
  var bars = el('div', 'hour-bars');
  var maxAvg = 1;
  for (var ha = 0; ha < 24; ha++) {
    var a = hourCounts[ha] > 0 ? hourBuckets[ha] / hourCounts[ha] : 0;
    if (a > maxAvg) maxAvg = a;
  }
  for (var hb = 0; hb < 24; hb++) {
    var average = hourCounts[hb] > 0 ? hourBuckets[hb] / hourCounts[hb] : 0;
    var pct = average / maxAvg * 100;
    // Colour says how high that hour really runs. Height only compares the hours with each other.
    var bar = el('i', average >= 85 ? 'hot' : (average >= 60 ? 'warm' : null));
    bar.style.height = Math.max(4, pct) + '%';
    bar.title = hb + ':00, ' + Math.round(average) + '% on average';
    bars.appendChild(bar);
  }
  hours.appendChild(bars);
  var labels = el('div', 'hour-labels');
  for (var hl = 0; hl < 24; hl += 3) labels.appendChild(el('span', null, hl + ':00'));
  hours.appendChild(labels);
  container.appendChild(hours);
}

var streakData = {};
window.dashboardAPI.getStreak().then(function(data) { streakData = data || {}; });

var THEME_CHOICES = [
  ['brutal', 'Brutal', '#f0ede4', '#ff90e8'],
  ['karchx', 'Karchx', '#ece4d6', '#3b2a3a'],
  ['light', 'Light', '#fafafc', '#b45e35'],
  ['dark', 'Dark', '#0c0c12', '#d4845a'],
  ['nord', 'Nord', '#2e3440', '#88c0d0'],
  ['dracula', 'Dracula', '#282a36', '#bd93f9'],
];

function setRow(title, description, control) {
  var row = el('div', 'set-row');
  var info = el('div', 'set-info');
  info.appendChild(el('div', 'set-title', title));
  var desc = el('div', 'set-desc', description || '');
  if (description !== null) info.appendChild(desc);
  row.appendChild(info);
  if (control) row.appendChild(control);
  row.desc = desc;
  return row;
}

function setGroup(title, rows) {
  var group = el('section', 'set-group');
  group.appendChild(el('h2', null, title));
  var card = el('div', 'set-card card raised');
  rows.forEach(function(row) { card.appendChild(row); });
  group.appendChild(card);
  return group;
}

function setDesc(node, text, tone) {
  node.textContent = text;
  node.className = 'set-desc' + (tone ? ' ' + tone : '');
}

function themeRow() {
  var picker = el('div', 'theme-picker');
  picker.setAttribute('role', 'group');
  picker.setAttribute('aria-label', 'Theme');
  var chips = [];
  THEME_CHOICES.forEach(function(choice) {
    var chip = el('button', 'theme-chip');
    chip.type = 'button';
    chip.setAttribute('data-theme-name', choice[0]);
    var swatch = el('i');
    swatch.style.setProperty('--a', choice[2]);
    swatch.style.setProperty('--b', choice[3]);
    chip.appendChild(swatch);
    chip.appendChild(document.createTextNode(choice[1]));
    chip.addEventListener('click', function() {
      window.dashboardAPI.setTheme(choice[0]);
      mark(choice[0]);
    });
    chips.push(chip);
    picker.appendChild(chip);
  });
  function mark(name) {
    chips.forEach(function(chip) {
      chip.setAttribute('aria-pressed', chip.getAttribute('data-theme-name') === name ? 'true' : 'false');
    });
  }
  window.dashboardAPI.getTheme().then(function(name) { mark(name || 'brutal'); });
  return setRow('Theme', null, picker);
}

function hotkeyRow() {
  var box = el('div', 'set-actions');
  var cap = el('span', 'key-cap', currentDisplayHotkey);
  var change = el('button', 'btn small', 'Change');
  change.type = 'button';
  box.appendChild(cap);
  box.appendChild(change);
  var row = setRow('Show and hide the widget', 'A shortcut that works from anywhere.', box);
  var listener = null;

  function stopRecording() {
    isRecordingHotkey = false;
    cap.classList.remove('recording');
    change.textContent = 'Change';
    if (listener) document.removeEventListener('keydown', listener, true);
    listener = null;
  }

  change.addEventListener('click', function() {
    if (isRecordingHotkey) {
      stopRecording();
      cap.textContent = currentDisplayHotkey;
      return;
    }
    isRecordingHotkey = true;
    cap.classList.add('recording');
    cap.textContent = 'Press keys...';
    change.textContent = 'Cancel';
    setDesc(row.desc, 'Press the new shortcut, with Ctrl, Alt or Shift. Esc cancels.');
    listener = function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        stopRecording();
        cap.textContent = currentDisplayHotkey;
        setDesc(row.desc, 'A shortcut that works from anywhere.');
        return;
      }
      var accelerator = formatElectronAccelerator(e);
      if (!accelerator) return; // modifier-only press, wait for the whole combination
      stopRecording();
      cap.textContent = accelerator;
      setDesc(row.desc, 'Saving...');
      window.dashboardAPI.changeHotkey(accelerator).then(function(result) {
        if (result.success) {
          currentDisplayHotkey = accelerator;
          setDesc(row.desc, 'Shortcut changed.', 'ok');
        } else {
          cap.textContent = currentDisplayHotkey;
          setDesc(row.desc, result.error || 'That shortcut could not be set.', 'bad');
        }
      });
    };
    document.addEventListener('keydown', listener, true);
  });
  return row;
}

function autostartRow() {
  var toggle = el('label', 'toggle');
  var input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('aria-label', 'Start on login');
  toggle.appendChild(input);
  toggle.appendChild(el('span'));
  window.dashboardAPI.getAutostart().then(function(result) { input.checked = result.enabled; });
  input.addEventListener('change', function() { window.dashboardAPI.setAutostart(input.checked); });
  return setRow('Start on login', 'Open the widget when you log in.', toggle);
}

// One update, whichever button started it: the Settings row and the rail's button both show it.
var updateRowButton = null;
var updateRunning = false;

function setUpdateButtons(text, disabled) {
  var rail = document.getElementById('updateNowBtn');
  rail.textContent = text;
  rail.disabled = disabled;
  if (updateRowButton) {
    updateRowButton.textContent = text;
    updateRowButton.disabled = disabled;
  }
}

function showUpdateFound(result) {
  pendingUpdate = result;
  setUpdateButtons('Update to v' + result.latestVersion, false);
  document.getElementById('updateNowBtn').classList.add('visible');
  document.getElementById('sidebarVersion').textContent = 'v' + currentAppVersion + ' to v' + result.latestVersion;
  var banner = document.getElementById('updateBanner');
  UI.clear(banner);
  banner.appendChild(el('span', null, 'Version ' + result.latestVersion + ' is ready to install.'));
  var install = el('button', 'btn small', 'Update');
  install.type = 'button';
  install.addEventListener('click', startUpdate);
  banner.appendChild(install);
  banner.classList.add('visible');
}

function startUpdate() {
  if (!pendingUpdate || updateRunning) return;
  if (!pendingUpdate.downloadUrl) {
    setUpdateButtons('No installer found', true);
    setTimeout(function() { setUpdateButtons('Update to v' + pendingUpdate.latestVersion, false); }, 3000);
    return;
  }
  updateRunning = true;
  setUpdateButtons('Downloading...', true);
  document.getElementById('updateProgress').classList.add('visible');
  var failed = function() {
    updateRunning = false;
    document.getElementById('updateProgress').classList.remove('visible');
    setUpdateButtons('Failed. Try again', false);
  };
  window.dashboardAPI.installUpdate().then(function(result) {
    if (result && result.success) setUpdateButtons('Installing...', true);
    else failed();
  }, failed);
}

function updateRow() {
  var button = el('button', 'btn small', 'Check for updates');
  button.type = 'button';
  updateRowButton = button;
  var row = setRow('Updates', 'This is version ' + currentAppVersion + '.', button);
  button.addEventListener('click', function() {
    if (pendingUpdate) {
      startUpdate();
      return;
    }
    button.textContent = 'Checking...';
    button.disabled = true;
    window.dashboardAPI.checkForUpdates().then(function(result) {
      if (result && result.hasUpdate) {
        showUpdateFound(result);
        return;
      }
      setDesc(row.desc, 'Version ' + currentAppVersion + ' is the newest.', 'ok');
      button.textContent = 'Check for updates';
      button.disabled = false;
    }, function() {
      setDesc(row.desc, 'The check failed. Are you online?', 'bad');
      button.textContent = 'Check for updates';
      button.disabled = false;
    });
  });
  return row;
}

// With several accounts each has its own login folder, so the rows say where each stands.
// With one, the sign-in buttons act on it directly.
var settingsAccountsBox = null;
var settingsAccountsKey = null;

function singleAccountRow() {
  var box = el('div', 'set-actions');
  var signIn = el('button', 'btn small', 'Sign in');
  var signOut = el('button', 'btn small danger', 'Sign out');
  signIn.type = 'button';
  signOut.type = 'button';
  box.appendChild(signIn);
  box.appendChild(signOut);
  var row = setRow('Account', 'Checking...', box);
  function show(authenticated) {
    setDesc(row.desc, authenticated ? 'Signed in.' : 'Not signed in.', authenticated ? 'ok' : 'bad');
    signIn.textContent = authenticated ? 'Sign in again' : 'Sign in';
    signIn.disabled = false;
    signOut.disabled = !authenticated;
  }
  window.dashboardAPI.checkAuthStatus().then(function(result) { show(result && result.authenticated); });
  signIn.addEventListener('click', function() {
    window.dashboardAPI.launchAuthLogin().then(function(result) {
      if (result && result.success) {
        signIn.disabled = true;
        setDesc(row.desc, 'Finish signing in in your browser.');
      } else {
        setDesc(row.desc, (result && result.error) || 'Sign-in could not start.', 'bad');
      }
    });
  });
  signOut.addEventListener('click', function() {
    signOut.disabled = true;
    setDesc(row.desc, 'Signing out...');
    window.dashboardAPI.signOut().then(function() { show(false); });
  });
  row.showAuth = show;
  return row;
}

var singleAccount = null;
window.dashboardAPI.onAuthStatusChanged(function(data) {
  if (singleAccount) singleAccount.showAuth(Boolean(data && data.authenticated));
});

function renderSettingsAccounts() {
  var box = settingsAccountsBox;
  if (!box) return;
  var several = accountsData.length > 1;
  var key = several ? JSON.stringify(accountsData.map(function(acc) { return [acc.id, acc.name, acc.needsLogin, acc.login && acc.login.text]; })) : 'one';
  if (key === settingsAccountsKey) return;
  settingsAccountsKey = key;
  UI.clear(box);
  singleAccount = null;
  if (!several) {
    singleAccount = singleAccountRow();
    box.appendChild(singleAccount);
    return;
  }
  accountsData.forEach(function(acc) {
    var login = acc.login || {};
    var out = acc.needsLogin || login.state === 'out';
    var row = setRow(acc.name, login.text || (out ? 'Logged out.' : 'Signed in.'), out || login.state === 'warn' ? buildLoginButton(acc) : null);
    if (out || login.state === 'warn') setDesc(row.desc, login.text || 'Logged out.', 'bad');
    box.appendChild(row);
  });
}

function googleRows() {
  var list = el('div');
  var add = el('button', 'btn small', 'Add a Google account');
  var sync = el('button', 'btn small', 'Sync now');
  add.type = 'button';
  sync.type = 'button';
  var box = el('div', 'set-actions');
  box.appendChild(add);
  box.appendChild(sync);
  var main = setRow('Google Calendar', 'Show events from your Google accounts.', box);

  function formatRelativeTime(ts) {
    var diff = Date.now() - ts;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return new Date(ts).toLocaleString();
  }

  function showAccounts(accounts, lastSync) {
    UI.clear(list);
    (accounts || []).forEach(function(account) {
      var remove = el('button', 'btn small danger', 'Remove');
      remove.type = 'button';
      remove.addEventListener('click', function() {
        remove.disabled = true;
        remove.textContent = 'Removing...';
        window.dashboardAPI.gcalRemoveAccount(account.email).then(refresh);
      });
      list.appendChild(setRow(account.email, null, remove));
    });
    sync.disabled = !accounts || accounts.length === 0;
    if (lastSync) setDesc(main.desc, 'Last synced ' + formatRelativeTime(lastSync) + '.');
  }

  function refresh() {
    window.dashboardAPI.gcalGetStatus().then(function(status) { showAccounts(status.accounts, status.lastSync); });
  }
  refresh();

  window.dashboardAPI.onGcalSyncStatus(function(data) {
    showAccounts(data.accounts, data.lastSync);
    if (data.errors && data.errors.length > 0) setDesc(main.desc, data.errors[0].error, 'bad');
  });

  add.addEventListener('click', function() {
    add.disabled = true;
    add.textContent = 'Waiting for Google...';
    setDesc(main.desc, 'Finish signing in in your browser.');
    window.dashboardAPI.gcalAddAccount().then(function(result) {
      add.disabled = false;
      add.textContent = 'Add a Google account';
      if (result.success) {
        setDesc(main.desc, 'Connected ' + result.email + '.', 'ok');
        refresh();
      } else {
        setDesc(main.desc, result.error || 'That did not work.', 'bad');
      }
    });
  });

  sync.addEventListener('click', function() {
    sync.disabled = true;
    sync.textContent = 'Syncing...';
    window.dashboardAPI.gcalSyncNow().then(function(result) {
      sync.disabled = false;
      sync.textContent = 'Sync now';
      if (result.success) setDesc(main.desc, 'Last synced just now.', 'ok');
      else setDesc(main.desc, result.error || 'The sync failed.', 'bad');
    });
  });

  return [main, list];
}

// Built once. Each listener above belongs to these rows for the life of the window.
function renderSettings() {
  var container = document.getElementById('settingRows');
  UI.clear(container);
  container.appendChild(setGroup('Look', [themeRow()]));
  container.appendChild(setGroup('Behaviour', [hotkeyRow(), autostartRow()]));
  settingsAccountsBox = el('div');
  container.appendChild(setGroup('Accounts', [settingsAccountsBox]));
  renderSettingsAccounts();
  container.appendChild(setGroup('Calendar', googleRows()));
  container.appendChild(setGroup('App', [updateRow()]));
}

// --- Status tab ---

var statusOpenDays = {};

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
  var card = el('div', 'status-card card');
  var top = el('div', 'status-card-top');
  top.appendChild(el('b', null, inc.name));
  top.appendChild(el('span', inc.resolvedAt ? 'tag' : 'tag late', inc.resolvedAt ? 'Resolved' : 'Ongoing'));
  card.appendChild(top);
  var meta = [];
  if (inc.impact) meta.push(inc.impact.charAt(0).toUpperCase() + inc.impact.slice(1));
  if (inc.components && inc.components.length) meta.push(inc.components.join(', '));
  if (inc.startedAt) {
    var started = new Date(inc.startedAt);
    meta.push(String(started.getHours()).padStart(2, '0') + ':' + String(started.getMinutes()).padStart(2, '0'));
  }
  if (inc.startedAt && inc.resolvedAt) {
    var minutes = Math.round((new Date(inc.resolvedAt) - new Date(inc.startedAt)) / 60000);
    meta.push(minutes < 60 ? minutes + 'm' : Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm');
  }
  if (meta.length) card.appendChild(el('p', null, meta.join(' · ')));
  if (inc.latestUpdate) card.appendChild(el('p', null, inc.latestUpdate));
  return card;
}

function renderStatusHealth(card) {
  var cs = claudeStatusData;
  var indicator = (cs && cs.indicator) || 'none';
  var grade = { none: 'healthy', minor: 'intermittent', major: 'degraded', critical: 'degraded' };
  var words = { none: 'All systems working', minor: 'Minor outage', major: 'Major outage', critical: 'Critical outage' };
  var health = el('div', 'status-health card raised');
  health.appendChild(el('div', 'status-dot ' + (cs ? (grade[indicator] || 'intermittent') : '')));
  var text = el('div');
  text.appendChild(el('h2', null, cs ? (words[indicator] || indicator) : 'Checking...'));
  var current = (cs && cs.incidents) || [];
  if (current.length) {
    current.forEach(function(inc) {
      text.appendChild(el('p', 'status-incident-now', inc.name));
      if (inc.components && inc.components.length) text.appendChild(el('p', null, inc.components.join(', ')));
    });
  } else if (cs) {
    text.appendChild(el('p', null, 'No current incidents.'));
  }
  health.appendChild(text);
  var link = el('button', 'btn small');
  link.type = 'button';
  link.appendChild(document.createTextNode('status.claude.com'));
  link.appendChild(UI.icon('link'));
  link.querySelector('svg').style.cssText = 'width:14px;height:14px;';
  link.addEventListener('click', function() { window.dashboardAPI.openExternal('https://status.claude.com'); });
  health.appendChild(link);
  card.appendChild(health);
}

function renderStatusTab() {
  var healthCard = document.getElementById('statusHealthCard');
  var groupsContainer = document.getElementById('statusIncidentGroups');
  UI.clear(healthCard);
  UI.clear(groupsContainer);
  renderStatusHealth(healthCard);

  var cs = claudeStatusData;
  var all = [].concat((cs && cs.incidents) || [], (cs && cs.pastIncidents) || []);
  if (all.length === 0) {
    if (cs) groupsContainer.appendChild(el('div', 'status-empty', 'No incidents in the last 10 days.'));
    return;
  }

  var groups = {};
  all.forEach(function(inc) {
    var key = inc.startedAt ? dateKey(inc.startedAt) : dateKey(new Date().toISOString());
    (groups[key] = groups[key] || []).push(inc);
  });
  var todayKey = dateKey(new Date().toISOString());
  Object.keys(groups).sort(function(a, b) { return b.localeCompare(a); }).forEach(function(key) {
    var list = groups[key];
    var open = statusOpenDays[key] !== undefined ? statusOpenDays[key] : key === todayKey;
    var group = el('section');
    var head = el('button', 'status-day');
    head.type = 'button';
    head.setAttribute('aria-expanded', open ? 'true' : 'false');
    head.appendChild(UI.icon(open ? 'down' : 'next'));
    head.appendChild(document.createTextNode(dateLabel(key)));
    head.appendChild(el('small', null, PlanLib.countText(list.length, 'incident', 'incidents')));
    head.addEventListener('click', function() {
      statusOpenDays[key] = !open;
      renderStatusTab();
    });
    group.appendChild(head);
    if (open) {
      var cards = el('div', 'status-cards');
      list.forEach(function(inc) { cards.appendChild(buildIncidentCard(inc)); });
      group.appendChild(cards);
    }
    groupsContainer.appendChild(group);
  });
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
    usageData = active ? active.usage : null;
  } else if (payload && payload.session) {
    // Defensive: a bare usage object (pre-multi-account payload)
    accountsData = [];
    usageData = payload;
  } else {
    return;
  }
  renderOverview();
  if (currentTab === 'settings') renderSettingsAccounts();
});

window.dashboardAPI.onHistoryUpdate(function(data) {
  historyData = data;
  renderWeekChart();
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

window.dashboardAPI.onUpdateAvailable(showUpdateFound);

window.dashboardAPI.onUpdateProgress(function(pct) {
  document.getElementById('updateProgress').classList.add('visible');
  document.getElementById('updateProgressFill').style.width = pct + '%';
  setUpdateButtons(pct + '% downloaded', true);
});

document.getElementById('updateNowBtn').addEventListener('click', startUpdate);

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

function updateDashboardTimers() {
  var now = Date.now();
  boardCells.forEach(function(entry) { setRefillText(entry.cell, WL.rowState(entry.acc, now)); });
  renderSyncText();
  if (currentTab === 'overview') {
    renderTimeline();
    renderOverviewToday();
  }
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
var planTasks = PlanTasks.mount(document.getElementById('tasksRoot'), {
  smartAdd: window.dashboardAPI.smartAddTask,
  addTask: window.dashboardAPI.addTask,
  toggleTask: window.dashboardAPI.toggleTask,
  deleteTask: window.dashboardAPI.deleteTask,
  setPriority: window.dashboardAPI.setTaskPriority,
  reorder: window.dashboardAPI.reorderTasks,
  scheduleTask: window.dashboardAPI.scheduleTask,
  openTaskNote: window.dashboardAPI.openTaskNote,
  clearCompleted: window.dashboardAPI.clearCompleted,
}, { doneOpen: true });

function takeTasks(data) {
  dashTasks = data || [];
  planTasks.update(dashTasks);
  renderOverviewToday();
}
window.dashboardAPI.onTasksUpdate(takeTasks);
window.dashboardAPI.getTasks().then(takeTasks);

// --- Habits tab ---

// The old `learning` history stays in the file, unshown. Relax is never toggled here: it ticks itself
// when the day's last break completes, and shows today's count from the Relax meter instead.
var HABITS = [
  { kind: 'training', name: 'Training' },
  { kind: 'reading', name: 'Read/Write' },
  { kind: 'relax', name: 'Relax', auto: true },
];
var habitsData = { training: [], reading: [], relax: [] };
var habitsYear = new Date().getFullYear();
var habitsMonth = new Date().getMonth();
var relaxToday = null; // { done, total }

function habitNote(habit, days, todayStr) {
  var note = el('div', 'habit-note');
  var streak = PlanLib.habitStreak(habitsData[habit.kind], todayStr);
  var count = days.filter(function(day) { return day.done; }).length;
  note.appendChild(el('b', null, String(count)));
  note.appendChild(document.createTextNode(' this month'));
  note.appendChild(el('br'));
  note.appendChild(document.createTextNode(habit.auto && relaxToday
    ? 'today ' + relaxToday.done + '/' + relaxToday.total
    : PlanLib.countText(streak, 'day', 'days') + ' in a row'));
  return note;
}

function habitDayCell(habit, day) {
  var cls = 'habit-day' + (day.done ? ' done' : '') + (day.today ? ' today' : '') + (day.future ? ' future' : '');
  var label = PlanLib.dayTitle(day.date) + (day.done ? ', done' : ', not done');
  // Relax's days can't be changed, so they aren't buttons.
  if (habit.auto) {
    var mark = el('span', cls + ' as-text', String(day.day));
    mark.style.display = 'grid';
    mark.style.placeItems = 'center';
    mark.title = label;
    return mark;
  }
  var cell = el('button', cls, String(day.day));
  cell.type = 'button';
  cell.disabled = day.future;
  cell.setAttribute('aria-label', habit.name + ', ' + label);
  cell.setAttribute('aria-pressed', day.done ? 'true' : 'false');
  cell.addEventListener('click', function() {
    window.dashboardAPI.toggleHabitDay(habit.kind, day.date).then(function(data) {
      if (data) habitsData = data;
      renderHabits();
      var again = document.querySelector('.habit-row[data-kind="' + habit.kind + '"] .habit-days').children[day.day - 1];
      if (again) again.focus();
      renderOverviewToday();
    });
  });
  return cell;
}

function renderHabits() {
  var todayStr = PlanLib.dayString(new Date());
  var now = new Date();
  document.getElementById('habitsMonth').textContent = PlanLib.monthTitle(habitsYear, habitsMonth);
  var isThisMonth = habitsYear === now.getFullYear() && habitsMonth === now.getMonth();
  document.getElementById('habitsToday').hidden = isThisMonth;
  document.getElementById('habitsNext').disabled = isThisMonth;
  var board = document.getElementById('habitsBoard');
  UI.clear(board);
  HABITS.forEach(function(habit) {
    var row = el('div', 'habit-row');
    row.setAttribute('data-kind', habit.kind);
    row.appendChild(el('div', 'habit-name', habit.name));
    var days = PlanLib.habitDays(habitsData[habit.kind], habitsYear, habitsMonth, todayStr);
    var strip = el('div', 'habit-days');
    days.forEach(function(day) { strip.appendChild(habitDayCell(habit, day)); });
    row.appendChild(strip);
    row.appendChild(habitNote(habit, days, todayStr));
    board.appendChild(row);
  });
}

function moveHabitsMonth(delta) {
  habitsMonth += delta;
  if (habitsMonth < 0) { habitsMonth = 11; habitsYear -= 1; }
  if (habitsMonth > 11) { habitsMonth = 0; habitsYear += 1; }
  renderHabits();
}
document.getElementById('habitsPrev').addEventListener('click', function() { moveHabitsMonth(-1); });
document.getElementById('habitsNext').addEventListener('click', function() { moveHabitsMonth(1); });
document.getElementById('habitsToday').addEventListener('click', function() {
  habitsYear = new Date().getFullYear();
  habitsMonth = new Date().getMonth();
  renderHabits();
});

window.dashboardAPI.onHabitsUpdate(function(data) {
  habitsData = data || habitsData;
  renderOverviewToday();
  if (currentTab === 'habits') renderHabits();
});

function takeRelaxToday(v) {
  if (!v) return;
  if (relaxToday && relaxToday.done === v.done && relaxToday.total === v.total) return;
  relaxToday = { done: v.done, total: v.total };
  if (currentTab === 'habits') renderHabits();
}
if (window.dashboardAPI.onRelaxUpdate) window.dashboardAPI.onRelaxUpdate(takeRelaxToday);
if (window.dashboardAPI.getRelax) window.dashboardAPI.getRelax().then(takeRelaxToday);

// Prime the data so the Today panel and the habits board are ready
if (window.dashboardAPI && window.dashboardAPI.getHabits) {
  window.dashboardAPI.getHabits().then(function(data) {
    if (data) { habitsData = data; renderOverviewToday(); }
  });
}

// Programmatic tab navigation from the widget (e.g., clicking the habits banner)
if (window.dashboardAPI && window.dashboardAPI.onNavigateTab) {
  window.dashboardAPI.onNavigateTab(function(tab) {
    if (!tab) return;
    showTab(tab);
  });
}
