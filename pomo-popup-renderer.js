/* Pomodoro popup renderer — safe DOM only */

var dismissTimer = null;
var countdownSecs = 15;
var countdownInterval = null;
var inBreakMode = false;

/* ── Sound synthesis (Web Audio API, Pop Brutalist set — no files needed) ── */

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

function playChime(type) {
  try {
    var ctx = new (window.AudioContext || window.webkitAudioContext)();
    var master = ctx.createGain();
    master.connect(ctx.destination);

    if (type === 'work') {
      // "Level Up!" — arcade arpeggio with echo + sparkle finish
      master.gain.value = 0.38;
      var echoDelay = ctx.createDelay(1);
      echoDelay.delayTime.value = 0.16;
      var fb = ctx.createGain(); fb.gain.value = 0.3;
      var wet = ctx.createGain(); wet.gain.value = 0.4;
      echoDelay.connect(fb); fb.connect(echoDelay);
      echoDelay.connect(wet); wet.connect(master);

      var arp = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
      arp.forEach(function(f, i) {
        var t0 = ctx.currentTime + i * 0.07;
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = f;
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(0.28, t0 + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
        var lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 2600;
        osc.connect(lp); lp.connect(gain);
        gain.connect(master); gain.connect(echoDelay);
        osc.start(t0); osc.stop(t0 + 0.25);
      });
      brutTone(ctx, master, { f: 2093, at: 0.34, dur: 0.5, v: 0.16, a: 0.01, type: 'triangle' });
      brutTone(ctx, master, { f: 1046.5, at: 0.34, dur: 0.45, v: 0.3, a: 0.01, type: 'triangle' });
    } else {
      // "Boing & Go" — rubber-band bounce, then two firm knocks
      master.gain.value = 0.45;
      brutTone(ctx, master, { f: 784, glideTo: 392, glideDur: 0.13, dur: 0.16, v: 0.4, a: 0.008, type: 'triangle' });
      brutTone(ctx, master, { f: 392, glideTo: 587, glideDur: 0.12, dur: 0.2, at: 0.13, v: 0.35, a: 0.008, type: 'triangle' });
      [0.45, 0.58].forEach(function(at, i) {
        brutKnock(ctx, master, at, 200, 85, 0.75, 0.09);
        brutTone(ctx, master, { f: i === 0 ? 523.25 : 698.46, at: at, dur: 0.12, v: 0.3, a: 0.006, type: 'square', lp: 1600 });
      });
    }
  } catch (e) {
    // Audio not available — silent fallback
  }
}

function formatTime(secs) {
  var m = Math.floor(secs / 60);
  var s = secs % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}

window.pomoPopupAPI.onPomoPopupData(function(data) {
  var isBreak = data.type === 'break';
  var ringFill = document.getElementById('ringFill');
  var ringIcon = document.getElementById('ringIcon');
  var title = document.getElementById('title');
  var subtitle = document.getElementById('subtitle');
  var primaryBtn = document.getElementById('primaryBtn');
  var progressBar = document.getElementById('progressBar');
  var countdown = document.getElementById('countdown');

  inBreakMode = false;

  if (isBreak) {
    // Break finished — ready for work
    ringFill.classList.remove('work');
    ringFill.classList.add('break');
    ringIcon.textContent = '\uD83D\uDCAA'; // 💪
    title.textContent = 'Break over!';
    title.classList.remove('work');
    title.classList.add('break');
    subtitle.textContent = 'Ready for another focus session?';
    primaryBtn.textContent = 'Start Focus';
    primaryBtn.classList.remove('work');
    primaryBtn.classList.add('break');
    progressBar.classList.remove('work');
    progressBar.classList.add('break');
    playChime('break');
  } else {
    // Work finished — time for break
    ringIcon.textContent = '\uD83C\uDF89'; // 🎉
    title.textContent = 'Focus session complete!';
    subtitle.textContent = 'Great work! Time for a break.';
    primaryBtn.textContent = 'Start Break';
    spawnConfetti();
    playChime('work');
  }

  // Auto-dismiss countdown
  countdownSecs = 15;
  updateCountdown();
  countdownInterval = setInterval(function() {
    countdownSecs--;
    updateCountdown();
    if (countdownSecs <= 0) {
      clearInterval(countdownInterval);
      window.pomoPopupAPI.dismiss();
    }
  }, 1000);
});

function updateCountdown() {
  var el = document.getElementById('countdown');
  if (!inBreakMode) {
    el.textContent = 'Auto-dismiss in ' + countdownSecs + 's';
  }
}

// Transition popup into break countdown mode
function enterBreakMode(seconds, total) {
  inBreakMode = true;
  clearInterval(countdownInterval);

  var ringFill = document.getElementById('ringFill');
  var ringIcon = document.getElementById('ringIcon');
  var title = document.getElementById('title');
  var subtitle = document.getElementById('subtitle');
  var primaryBtn = document.getElementById('primaryBtn');
  var dismissBtn = document.getElementById('dismissBtn');
  var progressBar = document.getElementById('progressBar');
  var countdown = document.getElementById('countdown');

  // Switch to break style
  ringFill.classList.remove('work');
  ringFill.classList.add('break');
  title.classList.remove('work');
  title.classList.add('break');
  progressBar.classList.remove('work');
  progressBar.classList.add('break');
  progressBar.style.animation = 'none';

  ringIcon.textContent = '\u2615'; // ☕
  title.textContent = 'Break time';
  primaryBtn.textContent = 'Skip Break';
  primaryBtn.classList.remove('work');
  primaryBtn.classList.add('break');

  // Clear confetti
  var confetti = document.getElementById('confetti');
  while (confetti.firstChild) confetti.removeChild(confetti.firstChild);

  updateBreakDisplay(seconds, total);
}

function updateBreakDisplay(seconds, total) {
  if (!inBreakMode) return;
  var subtitle = document.getElementById('subtitle');
  var countdown = document.getElementById('countdown');
  var ringFill = document.getElementById('ringFill');
  var progressBar = document.getElementById('progressBar');

  subtitle.textContent = formatTime(seconds) + ' remaining';

  // Update ring gauge (251.3 = circumference)
  var progress = total > 0 ? (total - seconds) / total : 0;
  var offset = 251.3 * (1 - progress);
  ringFill.style.strokeDashoffset = offset;

  // Update progress bar width
  var pct = total > 0 ? (seconds / total) * 100 : 0;
  progressBar.style.width = pct + '%';

  countdown.textContent = 'Enjoy your break';
}

// Primary button — start next phase or skip break
document.getElementById('primaryBtn').addEventListener('click', function() {
  clearInterval(countdownInterval);
  if (inBreakMode) {
    // Skip break — dismiss and let main process handle it
    inBreakMode = false;
    window.pomoPopupAPI.dismiss();
  } else {
    // "Start Break" clicked — tell main, then transition to break countdown
    window.pomoPopupAPI.startNext();
    // enterBreakMode will be called when first tick arrives
  }
});

// Dismiss button
document.getElementById('dismissBtn').addEventListener('click', function() {
  clearInterval(countdownInterval);
  inBreakMode = false;
  window.pomoPopupAPI.dismiss();
});

// Receive break timer ticks from main process
window.pomoPopupAPI.onBreakTick(function(data) {
  if (!inBreakMode) {
    enterBreakMode(data.seconds, data.total);
  } else {
    updateBreakDisplay(data.seconds, data.total);
  }
});

// Break finished
window.pomoPopupAPI.onBreakDone(function() {
  inBreakMode = false;
  // The main process will show a new popup for break-complete
  window.pomoPopupAPI.dismiss();
});

function spawnConfetti() {
  var container = document.getElementById('confetti');
  while (container.firstChild) container.removeChild(container.firstChild);
  var colors = ['#facc15', '#f87171', '#60a5fa', '#4ade80', '#c084fc', '#fb923c', '#f472b6', '#34d399'];
  for (var i = 0; i < 40; i++) {
    var piece = document.createElement('div');
    piece.className = 'confetti';
    piece.style.left = Math.random() * 100 + '%';
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDelay = (Math.random() * 1) + 's';
    piece.style.animationDuration = (1.8 + Math.random() * 1.2) + 's';
    piece.style.width = (4 + Math.random() * 5) + 'px';
    piece.style.height = (4 + Math.random() * 5) + 'px';
    piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '1px';
    container.appendChild(piece);
  }
}

window.pomoPopupAPI.onThemeUpdate(function(t) {
  var r = document.documentElement;
  // Popups are opaque cards — prefer the solid window bg over translucent theme bg
  r.style.setProperty('--bg', t.winBg || t.bg);
  r.style.setProperty('--surface', t.surface);
  r.style.setProperty('--border', t.border);
  r.style.setProperty('--text', t.text);
  r.style.setProperty('--text-dim', t.textDim);
  if (t.green) r.style.setProperty('--green', t.green);
  if (t.red) r.style.setProperty('--red', t.red);
  if (t.yellow) r.style.setProperty('--yellow', t.yellow);
  if (t.accent) r.style.setProperty('--accent', t.accent);
  if (t.barBg) r.style.setProperty('--bar-bg', t.barBg);
});
