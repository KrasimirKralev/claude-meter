// The Relax break: a slowly moving place (one of the biomes in relax-biomes/),
// a breathing cue, a quiet countdown and, on the primary screen, the place's
// sounds and its lo-fi track, played here from recorded instruments
// (relax-biomes/_lofi.js) - or one of his own tracks from ~/Music/relax.
// Everything moves from one ~15 fps loop: an infinite CSS animation would keep
// the compositor presenting 60 frames a second on every screen for the whole
// break, and this PC runs hot.

(function () {
  var FRAME_MS = 66; // ~15 fps: the slowest things on screen move a few pixels a second
  var BREATH_IN_MS = 4000;
  var BREATH_OUT_MS = 6000;
  var ESC_WINDOW_MS = 2000;

  var stage = document.getElementById('stage');
  var canvas = document.getElementById('scene');
  var breath = document.getElementById('breath');
  var breathWord = document.getElementById('breathWord');
  var ringFg = document.getElementById('ringFg');
  var ringTime = document.getElementById('ringTime');
  var hint = document.getElementById('hint');
  var RING_CIRC = 2 * Math.PI * 39;
  ringFg.setAttribute('stroke-dasharray', RING_CIRC.toFixed(2));

  var session = null;       // what main sent: endsAt, durationMs, fadeMs, primary, music, breathing
  var fadeInAt = 0;
  var fadeOut = null;       // { at, ms }
  var loopTimer = null;
  var lastSecond = -1;
  var lastEsc = 0;
  var hintTimer = null;
  var music = null;
  var ended = false;

  // ---------------------------------------------------------------- biome
  // The place is one of the biomes in relax-biomes/ (main picks it, the same
  // on every screen); each brings its own scene and music (relax-biomes/_kit.js).
  var K = window.RelaxKit;
  var FALLBACK_BIOME = 'dusk-lake';
  var scene = null;

  function loadBiome(id, done) {
    if (!/^[a-z0-9-]+$/.test(id || '')) id = FALLBACK_BIOME;
    if (window.RelaxBiomes.get(id)) { done(window.RelaxBiomes.get(id)); return; }
    var el = document.createElement('script');
    el.src = 'relax-biomes/' + id + '.js';
    function fallBack(why) {
      console.error('[relax] biome ' + id + ' ' + why + '; showing ' + FALLBACK_BIOME);
      if (id !== FALLBACK_BIOME) loadBiome(FALLBACK_BIOME, done);
    }
    el.onload = function () {
      var b = window.RelaxBiomes.get(id);
      if (b) done(b); else fallBack('did not register');
    };
    el.onerror = function () { fallBack('could not be loaded'); };
    document.head.appendChild(el);
  }

  function mount(b, display) {
    K.applyUi(b, document.documentElement);
    document.getElementById('biomeName').textContent = b.name;
    // Seeded by the screen's position: two screens never twinkle or drift in step.
    var seed = Math.abs(display.x) * 31 + Math.abs(display.y) * 17;
    try {
      scene = K.mountScene(b, {
        canvas: canvas, front: document.getElementById('grain'), spriteRoot: document.getElementById('sprites'),
        SW: display.width, SH: display.height, frontScale: 1, seed: seed,
        role: session.primary ? 'main' : 'side', displayX: display.x,
      });
      return true;
    } catch (e) {
      console.error('[relax] biome ' + b.id + ' failed: ' + (e && e.message));
      scene = null;
      return false;
    }
  }

  // ---------------------------------------------------------------- breathing + countdown
  function easeInOut(x) { return 0.5 - 0.5 * Math.cos(Math.PI * x); }

  function breathe(now) {
    var cycle = BREATH_IN_MS + BREATH_OUT_MS;
    var p = (now - fadeInAt) % cycle;
    var inhale = p < BREATH_IN_MS;
    var into = inhale ? p : p - BREATH_IN_MS;
    var len = inhale ? BREATH_IN_MS : BREATH_OUT_MS;
    var k = easeInOut(into / len);
    var scale = inhale ? 0.64 + 0.36 * k : 1 - 0.36 * k;
    breath.style.transform = 'scale(' + scale.toFixed(4) + ')';
    var word = inhale ? 'breathe in' : 'breathe out';
    if (breathWord.textContent !== word) breathWord.textContent = word;
    breathWord.style.opacity = Math.max(0, Math.min(1, into / 900, (len - into) / 900)).toFixed(3);
  }

  function countdown() {
    var left = Math.max(0, session.endsAt - Date.now());
    var secs = Math.ceil(left / 1000);
    if (secs === lastSecond) return;
    lastSecond = secs;
    ringTime.textContent = Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');
    var frac = session.durationMs > 0 ? left / session.durationMs : 0;
    ringFg.setAttribute('stroke-dashoffset', (RING_CIRC * (1 - frac)).toFixed(2));
  }

  function frame() {
    loopTimer = null;
    if (!session) return;
    var now = performance.now();
    var elapsed = session.durationMs - Math.max(0, session.endsAt - Date.now());
    var progress = session.durationMs > 0 ? Math.min(1, Math.max(0, elapsed / session.durationMs)) : 0;
    var opacity = Math.min(1, (now - fadeInAt) / session.fadeMs);
    if (fadeOut) opacity = Math.min(opacity, Math.max(0, 1 - (now - fadeOut.at) / fadeOut.ms));
    stage.style.opacity = opacity.toFixed(3);
    if (scene) scene.paint((now - fadeInAt) / 1000, progress);
    if (session.breathing) breathe(now);
    countdown();
    if (fadeOut && now - fadeOut.at >= fadeOut.ms) return; // main closes the window now
    loopTimer = setTimeout(frame, FRAME_MS);
  }

  // ---------------------------------------------------------------- lifecycle
  function requestEnd() {
    if (ended) return;
    ended = true;
    window.relaxAPI.end();
  }

  document.getElementById('endBtn').addEventListener('click', requestEnd);

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    var now = Date.now();
    if (now - lastEsc <= ESC_WINDOW_MS) { requestEnd(); return; }
    lastEsc = now;
    hint.classList.add('show');
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(function () { hint.classList.remove('show'); }, ESC_WINDOW_MS);
  });

  window.relaxAPI.onStart(function (data) {
    if (session) return;
    session = data;
    if (!session.breathing) document.body.classList.add('no-breath');
    loadBiome(data.biome, function begin(b) {
      if (fadeOut || scene) return;
      if (!mount(b, data.display)) {
        if (b.id !== FALLBACK_BIOME) loadBiome(FALLBACK_BIOME, begin);
        return;
      }
      fadeInAt = performance.now();
      lastSecond = -1;
      if (data.primary && data.music) {
        var log = function (msg) { try { window.relaxAPI.log(msg); } catch (e) { /* the break goes on */ } };
        try {
          music = K.startMusic(b, data.fadeMs, null, {
            nextTrack: data.musicSource === 'folder' ? function () { return window.relaxAPI.track(); } : null,
            endsAt: data.endsAt,
            log: log,
          });
          if (music && music.ready) music.ready.then(function (what) { log('music: ' + what); });
        } catch (e) {
          music = null;
          log('music failed: ' + (e && e.message));
        }
      }
      frame();
    });
  });

  window.relaxAPI.onFadeOut(function (data) {
    if (!session || fadeOut) return;
    fadeOut = { at: performance.now(), ms: data && data.ms ? data.ms : session.fadeMs };
    if (music) music.stop(fadeOut.ms);
    if (!loopTimer) frame();
  });
})();
