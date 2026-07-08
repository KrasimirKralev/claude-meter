/* Calendar renderer — Week Strip + Agenda design */

var calEvents = [];
var selectedDate = null;
var weekOffset = 0; // 0 = current week, -1 = last week, etc.
var monthGridOpen = false;
var monthViewYear = new Date().getFullYear();
var monthViewMonth = new Date().getMonth();

var COLOR_MAP = {
  blue: '#60a5fa', green: '#4ade80', orange: '#fb923c',
  red: '#f87171', purple: '#c084fc',
};
var MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
var MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
var DAY_NAMES = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
var DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// --- Utilities ---

function getToday() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function formatDateStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function parseDate(str) {
  var p = str.split('-');
  return new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
}

function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function getWeekStart(offset) {
  var d = new Date();
  var day = d.getDay();
  var diff = day === 0 ? 6 : day - 1; // Monday = start
  d.setDate(d.getDate() - diff + (offset * 7));
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatTime12(time24) {
  if (!time24) return 'All day';
  var parts = time24.split(':');
  var h = parseInt(parts[0], 10);
  var m = parts[1];
  var period = h >= 12 ? 'pm' : 'am';
  var h12 = h === 0 ? 12 : (h > 12 ? h - 12 : h);
  return h12 + ':' + m + period;
}

// Quick-add parser
function parseQuickAdd(input) {
  var title = input;
  var time = null;
  var duration = null;

  var timeMatch = input.match(/\b(\d{1,2})(:\d{2})?\s*(am|pm)\b/i);
  if (timeMatch) {
    var h = parseInt(timeMatch[1], 10);
    var m = timeMatch[2] ? parseInt(timeMatch[2].slice(1), 10) : 0;
    var period = timeMatch[3].toLowerCase();
    if (period === 'pm' && h !== 12) h += 12;
    if (period === 'am' && h === 12) h = 0;
    time = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    title = title.replace(timeMatch[0], '').trim();
  } else {
    var t24 = input.match(/\b(\d{1,2}):(\d{2})\b/);
    if (t24) {
      var hh = parseInt(t24[1], 10);
      if (hh >= 0 && hh <= 23) {
        time = String(hh).padStart(2, '0') + ':' + t24[2];
        title = title.replace(t24[0], '').trim();
      }
    }
  }

  var durMatch = title.match(/\b(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins)\b/i);
  if (durMatch) {
    var val = parseFloat(durMatch[1]);
    var unit = durMatch[2].toLowerCase();
    if (unit.charAt(0) === 'h') duration = Math.round(val * 60);
    else duration = Math.round(val);
    title = title.replace(durMatch[0], '').trim();
  }

  title = title.replace(/^[\s,\-]+|[\s,\-]+$/g, '');
  return { title: title || input, time: time, duration: duration };
}

// --- Init ---
if (!selectedDate) selectedDate = getToday();

// Month headers (static)
var mHeaders = document.getElementById('calMonthHeaders');
var DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
for (var i = 0; i < 7; i++) {
  mHeaders.appendChild(el('div', 'cal-month-header', DAY_LETTERS[i]));
}

// --- Render ---
function render() {
  renderHeader();
  renderWeekStrip();
  renderEvents();
  renderMonthGrid();
  updateTodayBtn();
}

function renderHeader() {
  var d = parseDate(selectedDate);
  var dayName = DAY_FULL[d.getDay()];
  var shortDay = dayName.slice(0, 3);
  var monthName = MONTH_SHORT[d.getMonth()];
  document.getElementById('calDateTitle').textContent = shortDay + ', ' + monthName + ' ' + d.getDate();

  var badge = document.getElementById('calTodayBadge');
  if (selectedDate === getToday()) {
    badge.classList.add('visible');
  } else {
    badge.classList.remove('visible');
  }

  // Week nav label
  var ws = getWeekStart(weekOffset);
  var we = new Date(ws);
  we.setDate(we.getDate() + 6);
  var label = MONTH_SHORT[ws.getMonth()] + ' ' + ws.getDate() + ' – ' + MONTH_SHORT[we.getMonth()] + ' ' + we.getDate();
  document.getElementById('calWeekLabel').textContent = label;
}

function renderWeekStrip() {
  var strip = document.getElementById('calWeekStrip');
  while (strip.firstChild) strip.removeChild(strip.firstChild);

  var ws = getWeekStart(weekOffset);
  var today = getToday();

  for (var i = 0; i < 7; i++) {
    var d = new Date(ws);
    d.setDate(ws.getDate() + i);
    var ds = formatDateStr(d);

    var cell = el('div', 'cal-week-day');
    if (ds === today) cell.classList.add('today');
    if (ds === selectedDate) cell.classList.add('selected');

    // Check if this day is in a different month than the selected date
    var selMonth = parseInt(selectedDate.split('-')[1], 10) - 1;
    if (d.getMonth() !== selMonth && weekOffset === 0) {
      // Don't mark other-month for navigated weeks
    }

    cell.appendChild(el('div', 'cal-week-day-name', DAY_NAMES[i]));
    cell.appendChild(el('div', 'cal-week-day-num', String(d.getDate())));

    // Event dots
    var dayEvts = calEvents.filter(function(ev) { return ev.date === ds && !ev.done; });
    var dotRow = el('div', 'cal-week-dots');
    var maxDots = Math.min(3, dayEvts.length);
    for (var di = 0; di < maxDots; di++) {
      var dot = el('div', 'cal-week-dot');
      dot.style.background = COLOR_MAP[dayEvts[di].color] || COLOR_MAP.blue;
      dotRow.appendChild(dot);
    }
    cell.appendChild(dotRow);

    (function(dateStr) {
      cell.addEventListener('click', function() {
        selectedDate = dateStr;
        render();
      });
      // Drop zone for drag-reschedule
      cell.addEventListener('dragover', function(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        cell.style.background = 'rgba(212, 132, 90, 0.15)';
      });
      cell.addEventListener('dragleave', function() {
        cell.style.background = '';
      });
      cell.addEventListener('drop', function(e) {
        e.preventDefault();
        cell.style.background = '';
        var eventId = e.dataTransfer.getData('text/plain');
        if (eventId) {
          window.calendarAPI.moveEvent(eventId, dateStr);
          selectedDate = dateStr;
        }
      });
    })(ds);

    strip.appendChild(cell);
  }
}

function renderEvents() {
  var container = document.getElementById('calEvents');
  while (container.firstChild) container.removeChild(container.firstChild);

  var dayEvts = calEvents.filter(function(ev) { return ev.date === selectedDate; });
  dayEvts.sort(function(a, b) {
    if (a.done && !b.done) return 1;
    if (!a.done && b.done) return -1;
    if (!a.time && b.time) return -1;
    if (a.time && !b.time) return 1;
    return (a.time || '').localeCompare(b.time || '');
  });

  if (dayEvts.length === 0) {
    var noEvt = el('div', 'cal-no-events', 'No events');
    container.appendChild(noEvt);
    return;
  }

  var now = Date.now();

  for (var i = 0; i < dayEvts.length; i++) {
    var ev = dayEvts[i];
    var row = el('div', 'cal-event');
    row.style.borderLeftColor = ev.color && ev.color.charAt(0) === '#' ? ev.color : (COLOR_MAP[ev.color] || COLOR_MAP.blue);

    // Check overdue
    var isOverdue = false;
    if (!ev.done) {
      var evMs = ev.time ? new Date(ev.date + 'T' + ev.time).getTime() : new Date(ev.date + 'T23:59').getTime();
      if (evMs < now) isOverdue = true;
    }
    if (isOverdue) row.classList.add('overdue');
    if (ev.done) row.classList.add('done');

    // Checkbox — all events can be checked off
    var checkBtn = el('button', 'cal-event-check' + (ev.done ? ' checked' : ''));
    checkBtn.textContent = ev.done ? '\u2713' : '';
    (function(evId) {
      checkBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        window.calendarAPI.toggleEvent(evId);
      });
    })(ev.id);
    row.appendChild(checkBtn);

    // Time
    var timeEl = el('div', 'cal-event-time');
    if (ev.done) {
      timeEl.textContent = ev.time ? ev.time : 'All day';
    } else if (isOverdue && ev.time) {
      timeEl.textContent = 'LATE';
    } else {
      timeEl.textContent = ev.time ? ev.time : 'All day';
    }
    row.appendChild(timeEl);

    // Google icon
    if (ev.isGoogleEvent) {
      var gBadge = el('div');
      gBadge.style.cssText = 'width:12px;height:12px;border-radius:50%;background:linear-gradient(135deg,#4285f4,#34a853);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:7px;color:#fff;font-weight:700;';
      gBadge.textContent = 'G';
      row.appendChild(gBadge);
    }

    // Title
    var titleEl = el('div', 'cal-event-title', ev.title);
    row.appendChild(titleEl);

    // Meta (duration, recurrence)
    var meta = [];
    if (ev.duration) {
      meta.push(ev.duration >= 60 ? (ev.duration / 60) + 'h' : ev.duration + 'm');
    }
    if (ev.recurrence || ev.recurringParentId) {
      meta.push('\u21BB');
    }
    if (ev.reminder != null) {
      meta.push('\uD83D\uDD14');
    }
    if (meta.length > 0) {
      var metaEl = el('div', 'cal-event-meta', meta.join(' '));
      row.appendChild(metaEl);
    }

    if (ev.isGoogleEvent) {
      // Google events are read-only — click opens in Google Calendar
      if (ev.googleLink) {
        row.style.cursor = 'pointer';
        (function(link) {
          row.addEventListener('click', function() {
            window.calendarAPI.openExternal(link);
          });
        })(ev.googleLink);
      }
    } else {
      // Delete button (appears on hover via CSS)
      var delBtn = el('button', 'cal-event-del', '\u2715');
      (function(evId) {
        delBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          window.calendarAPI.deleteEvent(evId);
        });
      })(ev.id);
      row.appendChild(delBtn);
    }

    // Draggable
    row.draggable = true;
    (function(evId) {
      row.addEventListener('dragstart', function(e) {
        e.dataTransfer.setData('text/plain', evId);
        e.dataTransfer.effectAllowed = 'move';
        row.style.opacity = '0.4';
      });
      row.addEventListener('dragend', function() {
        row.style.opacity = '1';
      });
    })(ev.id);

    container.appendChild(row);
  }
}

function renderMonthGrid() {
  var cells = document.getElementById('calMonthCells');
  while (cells.firstChild) cells.removeChild(cells.firstChild);

  document.getElementById('calMonthTitle').textContent = MONTH_NAMES[monthViewMonth] + ' ' + monthViewYear;

  var firstDay = new Date(monthViewYear, monthViewMonth, 1).getDay();
  var startOffset = firstDay === 0 ? 6 : firstDay - 1;
  var daysInMonth = new Date(monthViewYear, monthViewMonth + 1, 0).getDate();
  var today = getToday();

  // Previous month fill
  var prevDays = new Date(monthViewYear, monthViewMonth, 0).getDate();
  for (var p = startOffset - 1; p >= 0; p--) {
    var pc = el('div', 'cal-month-cell other', String(prevDays - p));
    cells.appendChild(pc);
  }

  // Current month
  for (var d = 1; d <= daysInMonth; d++) {
    var date = new Date(monthViewYear, monthViewMonth, d);
    var ds = formatDateStr(date);
    var cell = el('div', 'cal-month-cell', String(d));
    if (ds === today) cell.classList.add('today');
    if (ds === selectedDate) cell.classList.add('selected');

    // Event dot
    var hasEvents = calEvents.some(function(ev) { return ev.date === ds && !ev.done; });
    if (hasEvents) {
      var dot = el('div', 'cal-month-cell-dot');
      dot.style.background = COLOR_MAP.blue;
      cell.appendChild(dot);
    }

    (function(dateStr, dateObj) {
      cell.addEventListener('click', function() {
        selectedDate = dateStr;
        // Navigate week strip to this date's week
        var now = new Date();
        var currentMonday = getWeekStart(0);
        var targetMonday = new Date(dateObj);
        var dayOfWeek = targetMonday.getDay();
        var mondayDiff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        targetMonday.setDate(targetMonday.getDate() - mondayDiff);
        var diffWeeks = Math.round((targetMonday.getTime() - currentMonday.getTime()) / (7 * 24 * 60 * 60 * 1000));
        weekOffset = diffWeeks;
        // Collapse month grid
        monthGridOpen = false;
        document.getElementById('calMonthWrap').classList.remove('open');
        document.getElementById('calExpandBtn').classList.remove('open');
        render();
      });
    })(ds, date);

    cells.appendChild(cell);
  }

  // Next month fill
  var totalCells = startOffset + daysInMonth;
  var remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
  for (var n = 1; n <= remaining; n++) {
    var nc = el('div', 'cal-month-cell other', String(n));
    cells.appendChild(nc);
  }
}

function updateTodayBtn() {
  var today = getToday();
  var ws = getWeekStart(weekOffset);
  var we = new Date(ws);
  we.setDate(we.getDate() + 6);
  var todayDate = parseDate(today);
  var isCurrentWeek = todayDate >= ws && todayDate <= we;
  var btn = document.getElementById('calTodayBtn');
  if (isCurrentWeek && selectedDate === today) {
    btn.classList.remove('visible');
  } else {
    btn.classList.add('visible');
  }
}

// --- Navigation ---
document.getElementById('calWeekPrev').addEventListener('click', function() {
  weekOffset--;
  // Update selected date to same day-of-week in new week
  var ws = getWeekStart(weekOffset);
  var sd = parseDate(selectedDate);
  var dayIdx = sd.getDay() === 0 ? 6 : sd.getDay() - 1;
  var newDate = new Date(ws);
  newDate.setDate(ws.getDate() + dayIdx);
  selectedDate = formatDateStr(newDate);
  render();
});

document.getElementById('calWeekNext').addEventListener('click', function() {
  weekOffset++;
  var ws = getWeekStart(weekOffset);
  var sd = parseDate(selectedDate);
  var dayIdx = sd.getDay() === 0 ? 6 : sd.getDay() - 1;
  var newDate = new Date(ws);
  newDate.setDate(ws.getDate() + dayIdx);
  selectedDate = formatDateStr(newDate);
  render();
});

document.getElementById('calTodayBtn').addEventListener('click', function() {
  weekOffset = 0;
  selectedDate = getToday();
  render();
});

// Month grid toggle
document.getElementById('calExpandBtn').addEventListener('click', function() {
  monthGridOpen = !monthGridOpen;
  var wrap = document.getElementById('calMonthWrap');
  var btn = document.getElementById('calExpandBtn');
  if (monthGridOpen) {
    // Sync month view to selected date
    var sd = parseDate(selectedDate);
    monthViewYear = sd.getFullYear();
    monthViewMonth = sd.getMonth();
    renderMonthGrid();
    wrap.classList.add('open');
    btn.classList.add('open');
  } else {
    wrap.classList.remove('open');
    btn.classList.remove('open');
  }
});

document.getElementById('calMonthPrev').addEventListener('click', function() {
  monthViewMonth--;
  if (monthViewMonth < 0) { monthViewMonth = 11; monthViewYear--; }
  renderMonthGrid();
});

document.getElementById('calMonthNext').addEventListener('click', function() {
  monthViewMonth++;
  if (monthViewMonth > 11) { monthViewMonth = 0; monthViewYear++; }
  renderMonthGrid();
});

// + Add button — focus the quick add input
document.getElementById('calAddBtn').addEventListener('click', function() {
  var input = document.getElementById('calQuickInput');
  input.focus();
});

// Quick add — Enter to save
document.getElementById('calQuickInput').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') {
    var raw = this.value.trim();
    if (!raw) return;
    var parsed = parseQuickAdd(raw);
    window.calendarAPI.addEvent({
      title: parsed.title,
      date: selectedDate,
      time: parsed.time,
      duration: parsed.duration,
      color: 'blue',
      reminder: 15,
      recurrence: null,
    });
    this.value = '';
  }
});

// --- Data ---
window.calendarAPI.getEvents().then(function(events) {
  calEvents = events || [];
  render();
});

window.calendarAPI.onCalendarUpdate(function(events) {
  calEvents = events || [];
  render();
});

window.calendarAPI.onThemeUpdate(function(t) {
  var r = document.documentElement;
  r.style.setProperty('--bg', t.bg);
  r.style.setProperty('--surface', t.surface);
  if (t.surface2) r.style.setProperty('--surface2', t.surface2);
  r.style.setProperty('--border', t.border);
  r.style.setProperty('--text', t.text);
  r.style.setProperty('--text-dim', t.textDim);
  if (t.accent) r.style.setProperty('--accent', t.accent);
  if (t.green) r.style.setProperty('--green', t.green);
  if (t.red) r.style.setProperty('--red', t.red);
});

window.calendarAPI.onSnapGlow(function() {
  var body = document.body;
  body.classList.remove('snap-glow');
  void body.offsetWidth;
  body.classList.add('snap-glow');
});
