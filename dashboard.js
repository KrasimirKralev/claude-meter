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

// --- Navigation: four sections, each with its own tabs ---

var SECTIONS = [
  { id: 'usage', title: 'Usage', tabs: [['overview', 'Overview'], ['history', 'History'], ['alerts', 'Alerts'], ['status', 'Status']] },
  { id: 'plan', title: 'Plan', tabs: [['calendar', 'Calendar'], ['tasks', 'Tasks'], ['habits', 'Habits']], notes: true },
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
  if (section.notes) {
    var notes = el('button', '', 'Notes');
    notes.addEventListener('click', function() { window.dashboardAPI.openNotes(); });
    holder.appendChild(notes);
  }
}

function afterTabShown(tab) {
  if (tab === 'overview') renderOverview();
  // Redraw chart and fix pill slider when history tab becomes visible
  if (tab === 'history') {
    requestAnimationFrame(function() { updateSlider(); });
    drawChart();
    renderAnalytics();
  }
  if (tab === 'calendar') renderCalendar();
  if (tab === 'habits') renderHabits();
  if (tab === 'maps') window.dashboardAPI.showMaps(mapsHostBounds());
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
  currentTab = tab;
  lastTabOf[section.id] = tab;
  document.querySelector('.main').classList.toggle('flush', tab === 'maps');
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
    addRow(WL.eventTimeText(next, now), next.title, function() { showTab('calendar'); });
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

// The map page lies over #mapsHost in its own view, so main needs to know where that box is.
function mapsHostBounds() {
  var box = document.getElementById('mapsHost').getBoundingClientRect();
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
  if (currentTab === 'maps') window.dashboardAPI.placeMaps(mapsHostBounds());
}).observe(document.getElementById('mapsHost'));
window.dashboardAPI.onMapsStatus(renderMapsStatus);
document.getElementById('mapsRetry').addEventListener('click', function() {
  window.dashboardAPI.showMaps(mapsHostBounds());
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

  if (!usageData) {
    container.textContent = 'Waiting for data...';
    return;
  }
  if (!usageData.session) {
    // The plan reports no 5-hour window (Ultra): nothing to pace within it.
    var headerNs = el('div', 'planner-header');
    var badgeNs = el('div', 'planner-badge on-track');
    badgeNs.appendChild(el('span', 'planner-badge-dot'));
    badgeNs.appendChild(document.createTextNode('No session limit'));
    headerNs.appendChild(badgeNs);
    container.appendChild(headerNs);
    container.appendChild(el('div', 'planner-recommendation',
      'This plan has no 5-hour session limit. Only the weekly limits apply.'));
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
    container.appendChild(el('div', 'setting-value', 'Not enough data yet. Usage history builds over time.'));
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

  // Stats cards
  var grid = el('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:16px;';

  function statCard(label, value, sub) {
    var card = el('div');
    card.style.cssText = 'padding:14px;background:var(--surface);border:1px solid var(--border);border-radius:10px;';
    var valEl = el('div');
    valEl.style.cssText = 'font-size:24px;font-weight:700;color:var(--ink);font-family:"JetBrains Mono",monospace;';
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

  grid.appendChild(statCard('Avg ' + statName + ' (7d)', avgSession7 + '%', 'Average ' + statName.toLowerCase() + ' utilization'));
  grid.appendChild(statCard('Peak ' + statName, peakSession + '%', 'All-time highest'));
  grid.appendChild(statCard('Peak Hour', peakHour + ':00', Math.round(peakHourAvg) + '% avg ' + statName.toLowerCase() + ' at this hour'));
  grid.appendChild(statCard('Limit Days', limitDays.size, 'Days ' + statName.toLowerCase() + ' hit \u226595%'));
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
    root.style.setProperty('--ink', theme.text);
    root.style.setProperty('--crit-text', theme.name === 'brutal' ? '#c8232b' : (theme.red || '#e5484d'));
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
    usageData = active ? active.usage : null;
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
