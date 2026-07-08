/* Meeting reminder popup renderer — safe DOM only */

var countdownSecs = 30;
var countdownInterval = null;
var liveInterval = null;

/* ── Meeting alert sound (Web Audio API, Pop Brutalist set) ── */

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

window.meetingPopupAPI.onData(function(data) {
  var ringFill = document.getElementById('ringFill');
  var ringIcon = document.getElementById('ringIcon');
  var title = document.getElementById('title');
  var eventName = document.getElementById('eventName');
  var subtitle = document.getElementById('subtitle');
  var progressBar = document.getElementById('progressBar');
  var countdown = document.getElementById('countdown');

  eventName.textContent = data.label || 'Meeting';

  var isCritical = data.stage === '0m' || data.stage === '5m';

  if (data.stage === '0m') {
    ringIcon.textContent = '\uD83D\uDD34'; // red circle
    title.textContent = 'Starting now!';
    title.classList.add('critical');
    ringFill.classList.add('critical');
    progressBar.classList.add('critical');
    ringIcon.classList.add('pulse');
    subtitle.textContent = data.resetText || 'Your meeting is starting';
  } else if (data.stage === '5m') {
    ringIcon.textContent = '\u26A0\uFE0F'; // warning
    title.textContent = 'Starting soon';
    title.classList.add('critical');
    ringFill.classList.add('critical');
    progressBar.classList.add('critical');
    subtitle.textContent = data.resetText || 'In 5 minutes';
  } else {
    ringIcon.textContent = '\uD83D\uDCC5'; // calendar
    title.textContent = 'Upcoming meeting';
    subtitle.textContent = data.resetText || '';
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
    progressBar.style.width = '100%';
    countdown.textContent = 'Dismiss manually';
  }
});

function updateRing(eventTime) {
  var ringFill = document.getElementById('ringFill');
  var now = Date.now();
  var diff = eventTime - now;
  // Map 15 minutes → full ring, 0 → empty
  var maxMs = 15 * 60 * 1000;
  var pct = Math.max(0, Math.min(1, diff / maxMs));
  var offset = 251.3 * pct;
  ringFill.style.strokeDashoffset = offset;
}

function updateCountdownText() {
  var el = document.getElementById('countdown');
  if (countdownSecs > 0) {
    el.textContent = 'Auto-dismiss in ' + countdownSecs + 's';
  }
}

// Buttons
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

window.meetingPopupAPI.onThemeUpdate(function(t) {
  var r = document.documentElement;
  // Popups are opaque cards — prefer the solid window bg over translucent theme bg
  r.style.setProperty('--bg', t.winBg || t.bg);
  r.style.setProperty('--surface', t.surface);
  r.style.setProperty('--border', t.border);
  r.style.setProperty('--text', t.text);
  r.style.setProperty('--text-dim', t.textDim);
  if (t.accent) {
    r.style.setProperty('--accent', t.accent);
    r.style.setProperty('--accent-grad-start', t.accent);
    r.style.setProperty('--accent-grad-end', t.accent);
    // Soft glow approximation
    var c = (t.accent || '').replace('#', '');
    if (c.length === 6) {
      var rr = parseInt(c.substring(0, 2), 16);
      var gg = parseInt(c.substring(2, 4), 16);
      var bb = parseInt(c.substring(4, 6), 16);
      r.style.setProperty('--accent-glow', 'rgba(' + rr + ',' + gg + ',' + bb + ',0.3)');
    }
  }
});
