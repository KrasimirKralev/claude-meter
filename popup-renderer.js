/* Alert popup: usage alerts, the daily digest and event reminders.
   Tone is a class, never a colour written here: the theme arrives after the data. */

var popupEl = document.getElementById('popup');
var iconEl = document.getElementById('popupIcon');
var labelEl = document.getElementById('popupLabel');
var titleEl = document.getElementById('popupTitle');
var subtitleEl = document.getElementById('popupSubtitle');
var pctEl = document.getElementById('popupPct');
var digestEl = document.getElementById('popupDigest');
var timerEl = document.getElementById('popupTimer');
var timerValue = document.getElementById('popupTimerValue');
var cellsEl = document.getElementById('popupCells');
var dismissBtn = document.getElementById('popupDismiss');
var countdownEl = document.getElementById('popupCountdown');
var countdownFill = document.getElementById('popupCountdownFill');

// An event's colour, in the tones that can carry text in every theme.
var COLOR_TONES = { red: 'crit', orange: 'warn', yellow: 'warn' };
var EVENT_WINDOW_MS = 10 * 60 * 1000;

var dismissTimeout = setTimeout(function() {
  window.popupAPI.dismiss();
}, 8000);
var countdownInterval = null;

window.popupAPI.onThemeUpdate(UI.applyTheme);

dismissBtn.addEventListener('click', function() {
  window.popupAPI.dismiss();
});

function setIcon(name, urgent) {
  UI.clear(iconEl);
  iconEl.appendChild(UI.icon(name));
  iconEl.classList.toggle('urgent', !!urgent);
}

function setTone(tone) {
  popupEl.classList.toggle('warn', tone === 'warn');
  popupEl.classList.toggle('crit', tone === 'crit');
}

function setCells(pct, grade) {
  var filled = WidgetLib.filledCells(pct);
  UI.clear(cellsEl);
  cellsEl.className = 'cells' + (grade ? ' ' + grade : '');
  cellsEl.setAttribute('aria-label', Math.round(pct) + '% used');
  for (var i = 0; i < WidgetLib.CELLS; i++) {
    cellsEl.appendChild(UI.el('u', i < filled ? 'on' : undefined));
  }
  cellsEl.hidden = false;
}

// main.js writes an event as "bullet, time, em dash, title". Laid out in two columns
// they need neither glyph, and any other line stays as it came.
function renderDigest(text) {
  UI.clear(digestEl);
  String(text || '').split('\n').forEach(function(line) {
    if (!line) return;
    var event = /^•\s*(.+?)\s+—\s+(.*)$/.exec(line);
    if (!event) {
      digestEl.appendChild(UI.el('li', 'digest-fact', line));
      return;
    }
    var row = UI.el('li', 'digest-event');
    row.appendChild(UI.el('span', 'digest-time', event[1]));
    row.appendChild(UI.el('span', 'digest-what', event[2]));
    digestEl.appendChild(row);
  });
  digestEl.hidden = false;
  allowDigestKeyboardScroll();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(allowDigestKeyboardScroll);
}

// A long day scrolls inside the fixed window, and the keyboard has to reach it too.
function allowDigestKeyboardScroll() {
  if (digestEl.scrollHeight > digestEl.clientHeight) digestEl.setAttribute('tabindex', '0');
  else digestEl.removeAttribute('tabindex');
}

function startEventCountdown(eventMs) {
  function update() {
    var remaining = Math.max(0, eventMs - Date.now());
    var totalSecs = Math.ceil(remaining / 1000);
    var mins = Math.floor(totalSecs / 60);
    var secs = totalSecs % 60;
    timerValue.textContent = mins + ':' + String(secs).padStart(2, '0');
    timerValue.className = 'timer-value' + (totalSecs <= 30 ? ' now' : (totalSecs <= 60 ? ' soon' : ''));
    // The cells show the time gone, so they fill up as the event comes closer.
    var elapsed = EVENT_WINDOW_MS - remaining;
    setCells(Math.min(100, Math.max(0, (elapsed / EVENT_WINDOW_MS) * 100)));
    if (remaining <= 0) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
  }
  timerEl.hidden = false;
  update();
  countdownInterval = setInterval(update, 1000);
}

function showDigest(p) {
  var hour = new Date().getHours();
  popupEl.classList.add('digest-mode');
  setTone('');
  setIcon(hour < 12 ? 'sun' : (hour < 17 ? 'clipboard' : 'moon'));
  labelEl.textContent = 'Daily digest';
  titleEl.textContent = p.label;
  subtitleEl.hidden = true;
  renderDigest(p.resetText);
}

function showReminder(p, autoMs) {
  setTone(COLOR_TONES[p.color] || '');
  if (autoMs === 0) {
    setIcon('alarm', true);
    labelEl.textContent = 'Right now';
  } else if (p.resetText && p.resetText.indexOf('5 min') >= 0) {
    setIcon('bolt');
    labelEl.textContent = 'Starting soon';
  } else {
    setIcon('calendar');
    labelEl.textContent = 'Upcoming';
  }
  titleEl.textContent = p.label;
  titleEl.title = p.label || '';
  subtitleEl.textContent = p.resetText;
  // Without an event time the cells would carry no information.
  if (p.eventTime && p.eventTime > Date.now()) startEventCountdown(p.eventTime);
}

function showUsageAlert(p) {
  var danger = (p.severity || 'warning') === 'danger';
  var named = p.accountLabel && p.accountLabel !== 'Me';
  setTone(danger ? 'crit' : 'warn');
  setIcon(danger ? 'warning' : 'bolt', danger);
  labelEl.textContent = danger ? 'Critical usage' : 'Usage warning';
  titleEl.textContent = named ? p.accountLabel : p.label;
  titleEl.title = titleEl.textContent;
  subtitleEl.textContent = (named ? p.label + ' · ' : '') + (p.resetText || 'Past your alert level');
  document.getElementById('popupPctValue').textContent = p.pct;
  pctEl.hidden = false;
  setCells(p.pct, danger ? 'hot' : 'warm');
}

window.popupAPI.onPopupData(function(p) {
  clearTimeout(dismissTimeout);
  if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }

  var autoMs = p.autoDismissMs || 0;
  if (p.type !== 'reminder') {
    showUsageAlert(p);
    autoMs = 8000;
  } else if (p.digest) {
    showDigest(p);
  } else {
    showReminder(p, autoMs);
  }

  if (autoMs > 0) {
    dismissBtn.textContent = 'Dismiss';
    dismissBtn.classList.remove('primary');
    countdownEl.hidden = false;
    countdownFill.style.animation = 'none';
    void countdownFill.offsetWidth;
    countdownFill.style.animation = 'cd ' + (autoMs / 1000) + 's linear forwards';
    dismissTimeout = setTimeout(function() { window.popupAPI.dismiss(); }, autoMs);
  } else {
    dismissBtn.textContent = 'Got it';
    dismissBtn.classList.add('primary');
    countdownEl.hidden = true;
  }
});
