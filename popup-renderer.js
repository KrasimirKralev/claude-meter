/* Popup renderer — unified custom layout for all alerts */

function hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return '0,0,0';
  // Accept rgba(...) too — pass through r,g,b only
  var m = hex.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) return m[1] + ',' + m[2] + ',' + m[3];
  var c = hex.replace('#', '');
  if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
  if (c.length !== 6) return '0,0,0';
  var r = parseInt(c.substring(0, 2), 16);
  var g = parseInt(c.substring(2, 4), 16);
  var b = parseInt(c.substring(4, 6), 16);
  return r + ',' + g + ',' + b;
}

window.popupAPI.onThemeUpdate(function(t) {
  var r = document.documentElement;
  // Popups are opaque cards — prefer the solid window bg over translucent theme bg
  r.style.setProperty('--bg', t.winBg || t.bg);
  r.style.setProperty('--surface', t.surface);
  r.style.setProperty('--border', t.border);
  r.style.setProperty('--text', t.text);
  r.style.setProperty('--text-dim', t.textDim);
  if (t.barBg) r.style.setProperty('--bar-bg', t.barBg);

  // Severity color map follows the theme: semantic where possible, accent for generic.
  if (t.accent) {
    COLOR_MAP.blue = t.accent;   RGB_MAP.blue = hexToRgb(t.accent);
    COLOR_MAP.purple = t.accent; RGB_MAP.purple = hexToRgb(t.accent);
  }
  if (t.red) {
    COLOR_MAP.red = t.red;       RGB_MAP.red = hexToRgb(t.red);
  }
  if (t.yellow) {
    COLOR_MAP.yellow = t.yellow; RGB_MAP.yellow = hexToRgb(t.yellow);
    COLOR_MAP.orange = t.yellow; RGB_MAP.orange = hexToRgb(t.yellow);
  }
  if (t.green) {
    COLOR_MAP.green = t.green;   RGB_MAP.green = hexToRgb(t.green);
  }
  // popup-data can arrive before the theme does — re-apply the accent so the
  // stripe/button pick up the themed color instead of the CSS defaults.
  if (lastAccent) setAccent(lastAccent);
});

document.getElementById('popupDismiss').addEventListener('click', function() {
  window.popupAPI.dismiss();
});

var dismissTimeout = setTimeout(function() {
  window.popupAPI.dismiss();
}, 8000);

var countdownInterval = null;

/* karchx palette — muted, paper-friendly tones */
var COLOR_MAP = { blue: '#3e5577', green: '#4a7a4a', orange: '#a25a32', red: '#a83b3b', purple: '#3b2a3a', yellow: '#b88a2e' };
var RGB_MAP = {
  blue: '62,85,119', green: '74,122,74', orange: '162,90,50',
  red: '168,59,59', purple: '59,42,58', yellow: '184,138,46',
};

var lastAccent = null;

// Sprite switcher — all SVGs live in the DOM; data-icon picks the visible one
function setIcon(iconEl, name) {
  iconEl.setAttribute('data-icon', name);
}

function setAccent(color) {
  lastAccent = color;
  var hex = COLOR_MAP[color] || COLOR_MAP.blue;
  var rgb = RGB_MAP[color] || RGB_MAP.blue;
  document.documentElement.style.setProperty('--accent-color', hex);
  document.documentElement.style.setProperty('--accent-rgb', rgb);
  document.getElementById('accentStripe').style.background =
    'linear-gradient(90deg, ' + hex + ', transparent)';
}

window.popupAPI.onPopupData(function(p) {
  clearTimeout(dismissTimeout);
  var autoMs = p.autoDismissMs || 0;

  if (p.type === 'reminder') {
    // --- Calendar Reminder ---
    setAccent(p.color || 'blue');

    var icon = document.getElementById('popupIcon');
    var label = document.getElementById('popupLabel');
    var subtitleEl = document.getElementById('popupSubtitle');
    var digestEl = document.getElementById('popupDigest');

    if (p.digest) {
      // Daily digest \u2014 calm summary, not an urgent alarm.
      // Body renders full-width below the header instead of beside the icon.
      var h = new Date().getHours();
      setIcon(icon, h < 12 ? 'sun' : (h < 17 ? 'clip' : 'moon'));
      icon.classList.remove('urgent');
      label.textContent = 'DAILY DIGEST';
      document.getElementById('popupTitle').textContent = p.label;
      subtitleEl.textContent = '';
      subtitleEl.style.display = 'none';
      digestEl.textContent = p.resetText;
      digestEl.classList.add('visible');
    } else {
      if (autoMs === 0) {
        setIcon(icon, 'alarm');
        icon.classList.add('urgent');
        label.textContent = 'RIGHT NOW';
      } else if (p.resetText && p.resetText.indexOf('5 min') >= 0) {
        setIcon(icon, 'bolt');
        icon.classList.remove('urgent');
        label.textContent = 'STARTING SOON';
      } else {
        setIcon(icon, 'cal');
        icon.classList.remove('urgent');
        label.textContent = 'UPCOMING';
      }
      document.getElementById('popupTitle').textContent = p.label;
      subtitleEl.style.display = '';
      subtitleEl.textContent = p.resetText;
      digestEl.classList.remove('visible');
    }

    // Live countdown timer for 5-min stage
    if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
    var timerEl = document.getElementById('popupTimer');
    var timerValue = document.getElementById('popupTimerValue');

    if (p.eventTime && p.eventTime > Date.now()) {
      timerEl.classList.add('visible');
      document.querySelector('.popup-rail').style.display = '';
      var evtMs = p.eventTime;

      function updateCountdown() {
        var remaining = Math.max(0, evtMs - Date.now());
        var totalSecs = Math.ceil(remaining / 1000);
        var mins = Math.floor(totalSecs / 60);
        var secs = totalSecs % 60;
        timerValue.textContent = mins + ':' + String(secs).padStart(2, '0');

        // Progress rail shows time elapsed
        var totalTime = 10 * 60 * 1000;
        var elapsed = totalTime - remaining;
        var pct = Math.min(100, Math.max(0, (elapsed / totalTime) * 100));
        document.getElementById('popupRailFill').style.width = pct + '%';

        // Color shift: white → yellow → red as time runs out
        if (totalSecs <= 30) {
          timerValue.style.color = 'var(--red, #fb7185)';
        } else if (totalSecs <= 60) {
          timerValue.style.color = '#fbbf24';
        } else {
          timerValue.style.color = '';
        }

        if (remaining <= 0) {
          timerValue.textContent = '0:00';
          timerValue.style.color = 'var(--red, #fb7185)';
          clearInterval(countdownInterval);
          countdownInterval = null;
        }
      }
      updateCountdown();
      countdownInterval = setInterval(updateCountdown, 1000);
    } else {
      // No countdown (e.g. daily digest) — the progress rail carries no
      // information, so hide it instead of drawing a decorative full bar.
      timerEl.classList.remove('visible');
      document.querySelector('.popup-rail').style.display = 'none';
    }

  } else {
    // --- Usage Alert ---
    var severity = p.severity || 'warning';
    setAccent(severity === 'danger' ? 'red' : 'yellow');
    document.querySelector('.popup-rail').style.display = '';

    var icon = document.getElementById('popupIcon');
    setIcon(icon, severity === 'danger' ? 'warn' : 'bolt');
    if (severity === 'danger') icon.classList.add('urgent');
    else icon.classList.remove('urgent');

    document.getElementById('popupLabel').textContent =
      severity === 'danger' ? 'CRITICAL USAGE' : 'USAGE WARNING';

    var titleText = (p.accountLabel && p.accountLabel !== 'Me')
      ? p.accountLabel + ' \u2014 ' + p.label
      : p.label;
    document.getElementById('popupTitle').textContent = titleText + ' at ' + p.pct + '%';
    var subEl = document.getElementById('popupSubtitle');
    subEl.style.display = '';
    subEl.textContent = p.resetText || 'Threshold exceeded';
    document.getElementById('popupDigest').classList.remove('visible');

    setTimeout(function() {
      document.getElementById('popupRailFill').style.width = p.pct + '%';
    }, 100);
    autoMs = 8000;
  }

  // Dismiss behavior
  var btn = document.getElementById('popupDismiss');
  var cdFill = document.getElementById('popupCountdownFill');

  if (autoMs > 0) {
    btn.textContent = 'DISMISS';
    btn.classList.remove('urgent');
    if (cdFill) {
      cdFill.style.animation = 'none';
      void cdFill.offsetWidth;
      cdFill.style.animation = 'cd ' + (autoMs / 1000) + 's linear forwards';
    }
    dismissTimeout = setTimeout(function() { window.popupAPI.dismiss(); }, autoMs);
  } else {
    btn.textContent = 'GOT IT';
    btn.classList.add('urgent');
    if (cdFill) {
      cdFill.style.animation = 'none';
      cdFill.style.width = '100%';
    }
  }
});
