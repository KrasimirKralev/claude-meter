/* Meeting reminder popup renderer: safe DOM only */

var countdownSecs = 30;
var countdownInterval = null;
var liveInterval = null;

/* Meeting alert sound (Web Audio API, Pop Brutalist set) */

function brutTone(ctx, masterNode, opts) {
  var osc = ctx.createOscillator();
  var gain = ctx.createGain();
  osc.type = opts.type || 'sine';
  var t0 = ctx.currentTime + (opts.at || 0);
  osc.frequency.setValueAtTime(opts.f, t0);
  if (opts.glideTo) osc.frequency.exponentialRampToValueAtTime(opts.glideTo, t0 + (opts.glideDur || opts.dur));
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(opts.v || 0.5, t0 + (opts.a || 0.015));
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + opts.dur);
  if (opts.lp) {
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = opts.lp;
    osc.connect(lp); lp.connect(gain);
  } else {
    osc.connect(gain);
  }
  gain.connect(masterNode);
  osc.start(t0); osc.stop(t0 + opts.dur + 0.1);
}

function brutKnock(ctx, masterNode, at, fStart, fEnd, v, dur) {
  // pitch-dropping thump + filtered noise tick — a "wooden knock"
  var t0 = ctx.currentTime + at;
  var osc = ctx.createOscillator();
  var gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(fStart, t0);
  osc.frequency.exponentialRampToValueAtTime(fEnd, t0 + dur);
  gain.gain.setValueAtTime(v, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(gain); gain.connect(masterNode);
  osc.start(t0); osc.stop(t0 + dur + 0.05);

  var len = Math.floor(ctx.sampleRate * 0.03);
  var buf = ctx.createBuffer(1, len, ctx.sampleRate);
  var data = buf.getChannelData(0);
  for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  var noise = ctx.createBufferSource(); noise.buffer = buf;
  var bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 1.2;
  var ng = ctx.createGain();
  ng.gain.setValueAtTime(v * 0.5, t0);
  ng.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05);
  noise.connect(bp); bp.connect(ng); ng.connect(masterNode);
  noise.start(t0);
}

function playMeetingChime(urgent) {
  try {
    var ctx = new (window.AudioContext || window.webkitAudioContext)();
    var master = ctx.createGain();
    master.connect(ctx.destination);

    if (urgent) {
      // "Alarm Stomp" — three chunky square stabs + bass thumps, bright ping out
      master.gain.value = 0.42;
      var stabs = [440, 440, 587.33];
      stabs.forEach(function(f, i) {
        var at = i * 0.115;
        brutTone(ctx, master, { f: f, at: at, dur: 0.1, v: 0.5, a: 0.006, type: 'square', lp: 1400 });
        brutKnock(ctx, master, at, 160, 70, 0.7, 0.08);
      });
      stabs.forEach(function(f, i) {
        var at = 0.5 + i * 0.115;
        brutTone(ctx, master, { f: f, at: at, dur: 0.1, v: 0.45, a: 0.006, type: 'square', lp: 1400 });
        brutKnock(ctx, master, at, 160, 70, 0.6, 0.08);
      });
      brutTone(ctx, master, { f: 1174.66, at: 0.86, dur: 0.3, v: 0.3, a: 0.005, type: 'triangle' });
    } else {
      // "Knock-Knock" — woody double knock + friendly two-note bell
      master.gain.value = 0.5;
      brutKnock(ctx, master, 0.00, 220, 90, 0.8, 0.09);
      brutKnock(ctx, master, 0.14, 220, 90, 0.7, 0.09);
      brutTone(ctx, master, { f: 659.25, at: 0.34, dur: 0.28, v: 0.4, a: 0.008, type: 'triangle' });
      brutTone(ctx, master, { f: 659.25 * 1.005, at: 0.34, dur: 0.28, v: 0.2, a: 0.008, type: 'triangle' });
      brutTone(ctx, master, { f: 783.99, at: 0.46, dur: 0.4, v: 0.42, a: 0.008, type: 'triangle' });
      brutTone(ctx, master, { f: 783.99 * 0.996, at: 0.46, dur: 0.4, v: 0.2, a: 0.008, type: 'triangle' });
    }
  } catch (e) {
    // Audio not available — silent fallback
  }
}

window.meetingPopupAPI.onThemeUpdate(UI.applyTheme);

window.meetingPopupAPI.onData(function(data) {
  var popup = document.getElementById('popup');
  var ringIcon = document.getElementById('ringIcon');
  var title = document.getElementById('title');
  var eventName = document.getElementById('eventName');
  var subtitle = document.getElementById('subtitle');
  var okBtn = document.getElementById('okBtn');
  var progressBar = document.getElementById('progressBar');
  var countdown = document.getElementById('countdown');

  eventName.textContent = data.label || 'Meeting';
  eventName.title = data.label || '';

  // Join button: shown only when the event carries a meeting link
  var joinBtn = document.getElementById('joinBtn');
  if (data.meetLink) {
    joinBtn.hidden = false;
    // One primary action: with a link, joining is the one he reaches for.
    okBtn.classList.remove('primary');
    joinBtn.onclick = function() {
      window.meetingPopupAPI.openUrl(data.meetLink);
      window.meetingPopupAPI.dismiss();
    };
  } else {
    joinBtn.hidden = true;
    okBtn.classList.add('primary');
    joinBtn.onclick = null;
  }

  var isCritical = data.stage === '0m' || data.stage === '10m' || data.stage === '5m';

  UI.clear(ringIcon);
  if (data.stage === '0m') {
    ringIcon.appendChild(UI.icon('alarm'));
    ringIcon.classList.add('pulse');
    title.textContent = 'Starting now';
    popup.classList.add('crit');
    subtitle.textContent = timeText(data.resetText) || 'Your meeting is starting';
  } else if (data.stage === '10m' || data.stage === '5m') {
    ringIcon.appendChild(UI.icon('warning'));
    title.textContent = 'Starting soon';
    popup.classList.add('warn');
    subtitle.textContent = timeText(data.resetText) || 'In 5 minutes';
  } else {
    ringIcon.appendChild(UI.icon('calendar'));
    title.textContent = 'Upcoming meeting';
    subtitle.textContent = timeText(data.resetText);
  }

  // Ring fill based on urgency
  if (data.eventTime) {
    updateRing(data.eventTime);
    liveInterval = setInterval(function() { updateRing(data.eventTime); }, 5000);
  }

  // Play sound
  playMeetingChime(isCritical);

  // Auto-dismiss countdown
  countdownSecs = isCritical ? 0 : 30; // critical stays until dismissed
  if (countdownSecs > 0) {
    progressBar.hidden = false;
    progressBar.style.animation = 'progressShrink ' + countdownSecs + 's linear forwards';
    updateCountdownText();
    countdownInterval = setInterval(function() {
      countdownSecs--;
      updateCountdownText();
      if (countdownSecs <= 0) {
        clearInterval(countdownInterval);
        window.meetingPopupAPI.dismiss();
      }
    }, 1000);
  } else {
    progressBar.hidden = true;
    countdown.textContent = 'Stays open until you dismiss it';
  }
});

// main.js writes "In 5 min, em dash, 14:30"; the rest of the app separates with a middle dot.
function timeText(text) {
  return String(text || '').replace(/\s*\u2014\s*/g, ' \u00b7 ');
}

function updateRing(eventTime) {
  var ringFill = document.getElementById('ringFill');
  var now = Date.now();
  var diff = eventTime - now;
  // 15 minutes away or more: empty. At the start: full.
  var maxMs = 15 * 60 * 1000;
  var pct = Math.max(0, Math.min(1, diff / maxMs));
  ringFill.style.strokeDashoffset = 100 * pct;
}

function updateCountdownText() {
  var el = document.getElementById('countdown');
  if (countdownSecs > 0) {
    el.textContent = 'Closes in ' + countdownSecs + 's';
  }
}

// Buttons
document.getElementById('joinBtn').insertBefore(UI.icon('video'), document.getElementById('joinBtn').firstChild);

document.getElementById('okBtn').addEventListener('click', function() {
  clearInterval(countdownInterval);
  clearInterval(liveInterval);
  window.meetingPopupAPI.dismiss();
});

document.getElementById('dismissBtn').addEventListener('click', function() {
  clearInterval(countdownInterval);
  clearInterval(liveInterval);
  window.meetingPopupAPI.dismiss();
});
