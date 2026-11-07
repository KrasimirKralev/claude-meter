// Relax lo-fi: the music every biome plays, from real recorded instruments.
//
// A biome describes its track in `lofi` (key, tempo, chords, who plays what,
// how it feels - the fields are listed below) and this file plays it as one
// short record that lasts exactly the break: composed once when the break
// starts, then performed. A four-bar theme (the scene's own opening phrase,
// answered), one home progression with a second one in the middle, a two-bar
// drum pocket and a four-bar bass figure, arranged as an arc that lands before
// the fade: keys alone, the groove settles in, the theme lifts, a release with
// the drums and bass out, the theme returns, the parts thin out, and a last
// settled chord rings out while the place's own sounds carry on.
//
// The instruments are recordings (samples/NOTICE.md): a handful of notes per
// instrument, pitch-shifted between, loaded per break with <script> tags.
// Then the mix: tape wow on the chords only, a soft saturation, a low-pass per
// scene, a small plate with pre-delay, a quiet echo on the lead, a light
// side-chain on the chords, a faint record surface.
//
// The top half (theory, patterns, the arrangement) is plain JS without Web
// Audio: Node tests it (test/relax-lofi.test.js). The bottom half needs a browser.
//
// lofi: {
//   key 'D', mode 'major' | 'minor' | 'dorian' | 'lydian' | 'phrygian' | 'mixolydian'
//   bpm 56-85, meter 4 | 3, swing 0.5 (straight) .. 0.66, swing8 true = swing the eighths
//   progs  ['Imaj9 vi9 ii9 V13sus', ...] one token per bar, 'ii9,V7b9' = two chords in a bar; the
//          first is home, another one plays in the middle of the break
//   final  'Imaj9' the chord it ends on, cadence 'IVmaj9' the one before it (defaults per mode)
//   vary   0..1 how colourful the home progression's chords get (default 0.35), variants { m7: ['m11'] }
//   keys   { inst, style: 'hold' | 'comp' | 'arp' | 'bossa' | 'waltz' | 'sparse', range: [lo, hi], size, level, ep, tone }
//          size: notes per chord (default by instrument); ep: true = the Rhodes-like treatment (low-passed at
//          epTone, default 2500 Hz, with a +-trem tremolo, default 0.04); tone: a low-pass on this part (Hz)
//   lead   { inst, range: [lo, hi], level, motif, vary: 'ending' | 'octave', tone, phrase: 6, space: true } or null
//          phrase 6: in every eight bars the theme and its answer again (six bars), then two bars of rest;
//          space: after the first statement of a section no reply either, so the gaps are silent
//          motif: the scene's opening phrase, 'step.len.degree' per note, bars split by '|', e.g.
//          '4.2.3 6.2.2 8.8.1 | 2.12.5': scale degrees from the tonic (1, 2 ... 8 the octave, 0 the
//          seventh below), '3+5' a two-note dyad, a '?' suffix = a note that is sometimes left out
//   reply  { inst, shift: semitones, kind: 'echo' | 'descend', harm: true (a parallel third below), level }
//          a second voice answering the theme in the gaps (default: the keys, an octave lower); when it
//          is the keys' own instrument, the comping steps aside to one soft chord for those bars
//   pad    { inst: 'cello' | 'bowed', range: [lo, hi], fifth: true, level, in: ['release', 'outro', ...] }
//          long bowed notes under the sparse parts
//   bass   { style: 'lofi' | 'bossa' | 'waltz' | 'long' | 'pedal', walk: true (walks in the lift), level } or null
//   drums  { style: 'boom' | 'brush' | 'half' | 'bossa' | 'waltz' | 'sparse', kit: 'brushes', snare: 'rim' | 'snare' | 'tap',
//            hat: 'hat' | 'shaker' | 'both' | 'none', level } or null
//   fx     { tone Hz (the instruments' low-pass), drumTone Hz, crackle 0..1, hiss 0..1, wow 0..2, room 0..1,
//            verb s (the plate's decay, default 1.1), predelay s, echo beats (the lead's delay, 0 = none), duck 0..0.3, sat 0..1 }
// }
(function () {
  'use strict';

  var L = {};

  // ================================================================ theory
  var PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
  var MODES = {
    major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10],
    lydian: [0, 2, 4, 6, 7, 9, 11], phrygian: [0, 1, 3, 5, 7, 8, 10], mixolydian: [0, 2, 4, 5, 7, 9, 10],
  };
  // Chord qualities, as intervals over the root: g = the guide tones (third or
  // sus fourth, and seventh or sixth) every voicing keeps; must = the colour
  // that names the chord; t = tensions a voicing may add; f = the fifth.
  var QUAL = {
    maj: { g: [4], f: 7, t: [14], must: [] },
    min: { g: [3], f: 7, t: [14], must: [] },
    maj7: { g: [4, 11], f: 7, t: [14, 21], must: [] },
    maj9: { g: [4, 11], f: 7, t: [21], must: [14] },
    'maj7#11': { g: [4, 11], f: 7, t: [14], must: [18] },
    '6/9': { g: [4, 9], f: 7, t: [], must: [14] },
    m7: { g: [3, 10], f: 7, t: [14, 17], must: [] },
    m9: { g: [3, 10], f: 7, t: [17], must: [14] },
    m11: { g: [3, 10], f: 7, t: [14], must: [17] },
    m6: { g: [3, 9], f: 7, t: [14], must: [] },
    '7': { g: [4, 10], f: 7, t: [14, 21], must: [] },
    '9': { g: [4, 10], f: 7, t: [21], must: [14] },
    '13': { g: [4, 10], f: 7, t: [14], must: [21] },
    '7sus': { g: [5, 10], f: 7, t: [14, 21], must: [] },
    '9sus': { g: [5, 10], f: 7, t: [21], must: [14] },
    '13sus': { g: [5, 10], f: 7, t: [14], must: [21] },
    '7b9': { g: [4, 10], f: 7, t: [21], must: [13] },
    m7b5: { g: [3, 10], f: 6, t: [17], must: [] },
  };
  L.QUAL = QUAL;
  // Richer or plainer versions of a quality: the home progression gets its
  // colours once per break, and one chord changes colour now and then.
  var VARIANTS = {
    maj7: ['maj9', '6/9'], maj9: ['maj7', '6/9'], '6/9': ['maj9'], m7: ['m9', 'm11'], m9: ['m7', 'm11'], m11: ['m9'],
    '7': ['9', '13'], '9': ['13', '7'], '13': ['9'], '7sus': ['9sus', '13sus'], '9sus': ['13sus', '7sus'], '13sus': ['9sus'],
    '7b9': ['7b9'], m7b5: ['m7b5'], maj: ['maj7'], min: ['m7'], m6: ['m9'], 'maj7#11': ['maj9'],
  };

  // Seeded random: every break is a new seed, a test can fix one.
  L.rng = function (seed) {
    var s = Math.floor(Math.abs(seed)) % 2147483647;
    if (s <= 0) s += 2147483646;
    return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  };
  function pick(rnd, arr) { return arr[Math.floor(rnd() * arr.length) % arr.length]; }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function mod(n, m) { return ((n % m) + m) % m; }
  L.pick = pick;

  L.keyPc = function (key) {
    if (!Object.prototype.hasOwnProperty.call(PC, key)) throw new Error('unknown key ' + key);
    return PC[key];
  };
  L.scale = function (spec) {
    var root = L.keyPc(spec.key);
    return (MODES[spec.mode] || MODES.major).map(function (i) { return (root + i) % 12; });
  };

  // 'bVIImaj7' -> { root: pitch class, q: 'maj7', sym }. Upper-case numerals
  // are major-family chords, lower-case minor; the suffix names the quality.
  var ROMAN = { I: 0, II: 2, III: 4, IV: 5, V: 7, VI: 9, VII: 11 };
  var UPPER_Q = { '': 'maj', maj7: 'maj7', maj9: 'maj9', 'maj7#11': 'maj7#11', '6/9': '6/9', '6': '6/9', '7': '7', '9': '9',
    '13': '13', '7sus': '7sus', '9sus': '9sus', '13sus': '13sus', '7b9': '7b9' };
  var LOWER_Q = { '': 'min', '7': 'm7', '9': 'm9', '11': 'm11', '6': 'm6', 'ø7': 'm7b5', 'ø': 'm7b5', '7b5': 'm7b5' };
  L.parseChord = function (sym, keyPc) {
    var m = /^(b|#)?(VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i)(.*)$/.exec(sym);
    if (!m) throw new Error('bad chord ' + sym);
    var upper = m[2] === m[2].toUpperCase();
    var deg = ROMAN[m[2].toUpperCase()] + (m[1] === 'b' ? -1 : m[1] === '#' ? 1 : 0);
    var q = (upper ? UPPER_Q : LOWER_Q)[m[3]];
    if (!q) throw new Error('bad chord quality ' + sym);
    return { root: mod(keyPc + deg, 12), q: q, sym: sym };
  };
  // A progression string -> bars, each a list of { chord, at (beats into the bar), beats }.
  L.parseProg = function (str, keyPc, meter) {
    return str.trim().split(/\s+/).map(function (tok) {
      var parts = tok.split(',');
      var each = meter / parts.length;
      return parts.map(function (p, i) { return { chord: L.parseChord(p, keyPc), at: i * each, beats: each }; });
    });
  };
  // Where a break ends, by mode: a settled tonic, and the chord that leads to it.
  var FINAL = { major: 'Imaj9', minor: 'i9', dorian: 'i9', phrygian: 'i7', lydian: 'Imaj7#11', mixolydian: 'I9' };
  var CADENCE = { major: 'IVmaj9', minor: 'iv9', dorian: 'IV9', phrygian: 'bIImaj7', lydian: 'II', mixolydian: 'bVIImaj7' };
  L.finalChord = function (spec) { return L.parseChord(spec.final || FINAL[spec.mode] || 'Imaj9', L.keyPc(spec.key)); };
  L.cadenceChord = function (spec) { return L.parseChord(spec.cadence || CADENCE[spec.mode] || 'IVmaj9', L.keyPc(spec.key)); };

  // The pitch classes of a chord a melody may sit on: its tones and tensions.
  L.chordTones = function (ch, withTensions) {
    var Q = QUAL[ch.q];
    var iv = [0, Q.f].concat(Q.g, Q.must, withTensions ? Q.t : []);
    return iv.map(function (i) { return mod(ch.root + i, 12); });
  };

  // Pitch classes a voicing of `ch` uses: the guide tones, the named colour,
  // and (by chance) a tension or the fifth, up to `size` notes. No root: the
  // bass plays it. A two-note voicing is the guide tones alone.
  L.chordPcs = function (ch, size, rnd) {
    var Q = QUAL[ch.q];
    if (size <= 2) return Q.g.concat(Q.g.length < 2 ? [Q.f] : []).map(function (i) { return mod(ch.root + i, 12); });
    var iv = Q.g.concat(Q.must);
    var extra = Q.t.slice();
    while (iv.length < size && extra.length) {
      var k = Math.floor(rnd() * extra.length) % extra.length;
      iv.push(extra.splice(k, 1)[0]);
    }
    if (iv.length < size) iv.push(Q.f);
    if (iv.length < size) iv.push(12); // the root on top, as a last resort
    var pcs = [];
    iv.forEach(function (i) { var pc = mod(ch.root + i, 12); if (pcs.indexOf(pc) < 0) pcs.push(pc); });
    return pcs;
  };

  // Every close, drop-2 and drop-3 arrangement of the pitch classes inside [lo, hi].
  function candidates(pcs, lo, hi) {
    var out = [];
    for (var r = 0; r < pcs.length; r++) {
      var order = pcs.slice(r).concat(pcs.slice(0, r));
      for (var base = lo - 12; base <= hi; base++) {
        if (mod(base, 12) !== order[0]) continue;
        var v = [base];
        for (var i = 1; i < order.length; i++) {
          var n = v[i - 1] + 1;
          while (mod(n, 12) !== order[i]) n++;
          v.push(n);
        }
        var shapes = [v];
        if (v.length >= 4) { // drop 2 and drop 3: the second or third voice from the top down an octave
          [2, 3].forEach(function (k) { var d = v.slice(); d[d.length - k] -= 12; d.sort(function (a, b) { return a - b; }); shapes.push(d); });
        }
        shapes.forEach(function (s) { if (s[0] >= lo && s[s.length - 1] <= hi) out.push(s); });
      }
    }
    return out;
  }
  function voiceCost(v, prev, lo, hi, inst) {
    var c = 0;
    for (var i = 1; i < v.length; i++) {
      var gap = v[i] - v[i - 1];
      if (v[i - 1] < 52 && gap < 3) c += 6;       // muddy: close intervals low down
      if (v[i - 1] < 48 && gap < 5) c += 6;
      if (gap === 1) c += v[i - 1] < 60 ? 4 : i === v.length - 1 ? 2.5 : 1; // a little crunch is jazz, a lot is mud
      if (gap > 9) c += 2;                        // holes in the middle
      if (inst === 'guitar') { if (gap < 3) c += 4; if (gap > 10) c += 3; } // one note per string, a hand's span
    }
    var mid = (lo + hi) / 2, centre = (v[0] + v[v.length - 1]) / 2;
    c += Math.abs(centre - mid) * 0.12;
    if (prev && prev.length) {
      var move = 0;
      v.forEach(function (n) { var b = 99; prev.forEach(function (p) { b = Math.min(b, Math.abs(n - p)); }); move += b; });
      c += move / v.length;
      c += Math.abs(v[v.length - 1] - prev[prev.length - 1]) * 0.35; // the top line sings
    }
    return c;
  }
  // How many notes a chord gets on each instrument: a piano three or four, a
  // vibraphone two or three (its notes ring on), a guitar four strings.
  L.voiceSize = function (inst, rnd, broad) {
    if (inst === 'vibes') return broad ? 3 : rnd() < 0.55 ? 3 : 2;
    if (inst === 'guitar') return 4;
    if (inst === 'kalimba') return 3;
    return broad ? (rnd() < 0.6 ? 4 : 5) : rnd() < 0.6 ? 4 : 3;
  };
  // A voicing of `ch` in [lo, hi] that moves smoothly from `prev`; chosen
  // among the few best, so it is not always the same one.
  L.voice = function (ch, range, prev, rnd, size, inst) {
    var lo = range[0], hi = range[1];
    var n = size || L.voiceSize(inst, rnd);
    for (var tries = 0; tries < 4; tries++) {
      var pcs = L.chordPcs(ch, n, rnd);
      var cands = candidates(pcs, lo, hi);
      var clear = cands.filter(function (v) { // no seconds or thirds-and-less down in the mud, if it can be helped
        for (var i = 1; i < v.length; i++) if (v[i - 1] < 52 && v[i] - v[i - 1] < 3) return false;
        return true;
      });
      if (clear.length) cands = clear;
      if (cands.length) {
        cands.sort(function (a, b) { return voiceCost(a, prev, lo, hi, inst) - voiceCost(b, prev, lo, hi, inst); });
        var r = rnd();
        return cands[Math.min(cands.length - 1, r < 0.62 ? 0 : r < 0.9 ? 1 : 2)];
      }
      n = Math.max(2, n - 1);
    }
    return [lo + mod(ch.root - lo, 12)];
  };
  // A chord now and then gets a richer or plainer colour.
  L.vary = function (ch, rnd, amount, variants) {
    if (rnd() >= (amount === undefined ? 0.3 : amount)) return ch;
    var alts = (variants && variants[ch.q]) || VARIANTS[ch.q] || [ch.q];
    return { root: ch.root, q: pick(rnd, alts), sym: ch.sym };
  };

  // The bass note for a root: mostly between A1 and C3, close to the last one.
  L.bassNote = function (pc, prev) {
    var best = null;
    for (var n = 28; n <= 50; n++) {
      if (mod(n, 12) !== pc) continue;
      var cost = Math.abs(n - (prev || 40)) + (n > 48 ? 3 : 0) + (n < 33 ? 3 : 0); // round, not rumbling
      if (best === null || cost < best.cost) best = { n: n, cost: cost };
    }
    return best.n;
  };

  // ---------------------------------------------------------------- time
  // Where a 16th-note step lands, in 16ths: swing pushes the off-beat of each
  // pair (16ths, or eighths with swing8) late, `swing` = where it lands within
  // the pair (0.5 straight, 0.66 a triplet feel). Fractional steps are warped too.
  L.swingStep = function (step, swing, swing8) {
    var u = swing8 ? 4 : 2;
    var r = clamp(swing === undefined ? 0.5 : swing, 0.5, 0.75);
    var cell = Math.floor(step / u), p = (step - cell * u) / u;
    var w = p < 0.5 ? (p / 0.5) * r : r + ((p - 0.5) / 0.5) * (1 - r);
    return (cell + w) * u;
  };
  // A small human error, triangular in [-ms, ms], in seconds.
  L.jitter = function (rnd, ms) { return (rnd() + rnd() - 1) * ms / 1000; };
  // A velocity around `base`, never silent, never full.
  L.vel = function (rnd, base, spread) { return clamp(base + (rnd() * 2 - 1) * spread, 0.03, 1); };
  // How late each player sits behind the grid (ms) and how loose (ms): the
  // kick on it, the backbeat a steady drag, the lead floating. Small numbers:
  // a band shares one push and pull per phrase (see `drift` below) far more
  // than each player wanders on his own.
  L.FEEL = {
    kick: [0, 4], snare: [14, 4], rim: [13, 4], tap: [11, 6], ghost: [11, 6], hat: [4, 5], bhat: [5, 5], pedal: [6, 5],
    shaker: [3, 5], ride: [6, 4], stir: [0, 3], swish: [0, 3], keys: [8, 6], bass: [6, 5], lead: [14, 8], pad: [0, 0],
  };

  // ---------------------------------------------------------------- drums
  // A two-bar pocket, decided once per break: [[hits of bar A], [hits of bar B]],
  // each { kind, step, vel, lvl, opt, p, dur }. lvl = the lightest arrangement level
  // it plays at (1 thin, 2 the groove, 3 the fullest passage); opt hits are left
  // out p of the time (default a quarter), so 80-90 % of the pocket repeats.
  var KICKS4 = [[0, 10], [0, 7, 10], [0, 10, 13], [0, 3, 10], [0, 8, 10], [0, 6, 10], [0, 10]];
  L.groove = function (d, meter, rnd) {
    var bars = [[], []];
    var steps = meter * 4;
    var brushes = d.kit === 'brushes';
    var sn = brushes ? 'snare' : d.snare || 'rim';
    var hk = d.hat || 'hat';
    var hatKind = hk === 'shaker' ? 'shaker' : brushes ? 'bhat' : 'hat';
    function add(b, kind, step, vel, lvl, opt, p, dur) {
      bars[b].push({ kind: kind, step: step, vel: vel, lvl: lvl || 1, opt: !!opt, p: p === undefined ? 0.25 : p, dur: dur || 0 });
    }
    function both(kind, step, vel, lvl, opt, p, dur) { add(0, kind, step, vel, lvl, opt, p, dur); add(1, kind, step, vel, lvl, opt, p, dur); }
    // eighths, alternating strong and soft; a few 16ths between them carry the swing
    function hats(on, off, extra) {
      if (hk === 'none') return;
      for (var s = 0; s < steps; s += 2) {
        both(hatKind, s, s % 4 === 0 ? on : off, 1, s % 4 !== 0, 0.08);
        if (hk === 'both') both('shaker', s, (s % 4 === 0 ? on : off) * 0.8, 2, true, 0.3);
      }
      var sixteenths = meter === 3 ? [3, 7, 11] : [3, 7, 11, 15];
      for (var b = 0; b < 2; b++) {
        var mine = sixteenths.filter(function () { return rnd() < 0.5; }).slice(0, extra);
        mine.forEach(function (s) { add(b, hatKind, s, off * 0.55, 2, true, 0.3); });
      }
    }
    var style = d.style;
    if (meter === 3 && style !== 'sparse') style = 'waltz';
    if (style === 'boom' || style === 'half') {
      if (brushes) both('stir', 0, 0.45, 1, false, 0, meter); // one slow circle of the brush a bar
      var kA = style === 'half' ? [0] : pick(rnd, KICKS4);
      var kB = style === 'half' ? (rnd() < 0.5 ? [0, 10] : [0, 11]) : pick(rnd, [kA.concat([13]), kA.concat([7]), [0, 10], kA]);
      kA.forEach(function (s, i) { add(0, 'kick', s, i === 0 ? 0.8 : 0.6, 1); });
      kB.forEach(function (s, i) { if (kB.indexOf(s) === i) add(1, 'kick', s, i === 0 ? 0.78 : 0.56, s === 13 || s === 7 ? 2 : 1); });
      var back = style === 'half' ? [8] : [4, 12];
      // a steady backbeat; only now and then a firmer one
      back.forEach(function (s, i) { add(0, sn, s, i ? 0.7 : 0.66, 1); add(1, sn, s, i ? 0.72 : 0.66, 1); });
      hats(style === 'half' ? 0.36 : 0.42, style === 'half' ? 0.24 : 0.28, style === 'half' ? 1 : 2);
      // ghost notes as pickups into the backbeat or the next bar, 14-18 dB under it
      var gh = brushes ? 'ghost' : 'tap';
      add(0, gh, pick(rnd, style === 'half' ? [6, 14] : [3, 11, 7]), 0.2, 2, true, 0.35);
      add(1, gh, pick(rnd, [14, 15]), 0.22, 2, true, 0.3);
    } else if (style === 'brush') {
      // the left hand stirs a circle every two beats; the right taps two and four
      both('stir', 0, 0.55, 1, false, 0, 2); both('stir', 8, 0.5, 1, false, 0, 2);
      both('kick', 0, 0.42, 1); add(1, 'kick', 8, 0.32, 2, true, 0.4);
      both(sn, 4, 0.5, 1); both(sn, 12, 0.54, 1);
      add(0, 'ghost', pick(rnd, [10, 14]), 0.3, 2, true, 0.35); add(1, 'ghost', pick(rnd, [7, 15]), 0.3, 2, true, 0.35);
      both('pedal', 4, 0.22, 2, true, 0.2); both('pedal', 12, 0.22, 2, true, 0.2);
      // the fullest passage adds a soft ride: ding, ding-a ding
      [0, 4, 6, 8, 12, 14].forEach(function (s) { both('ride', s, s % 4 === 0 ? 0.44 : 0.32, 3, s % 4 !== 0, 0.2); });
    } else if (style === 'bossa') {
      [[0, 0.6], [6, 0.34], [8, 0.55], [14, 0.34]].forEach(function (k) { both('kick', k[0], k[1], 1); });
      [0, 6, 12].forEach(function (s) { add(0, 'rim', s, 0.46, 1); });
      [4, 10].forEach(function (s) { add(1, 'rim', s, 0.46, 1); });
      for (var s = 0; s < steps; s++) {
        if (s % 2 === 0) both('shaker', s, s % 4 === 0 ? 0.34 : 0.26, 1, s % 4 !== 0, 0.1);
        else both('shaker', s, 0.16, 2, true, 0.35);
      }
      both('pedal', 4, 0.28, 2, true, 0.3); both('pedal', 12, 0.28, 2, true, 0.3);
    } else if (style === 'waltz') {
      both('kick', 0, 0.62, 1);
      if (brushes) both('stir', 0, 0.5, 1, false, 0, 3);
      both(sn, 4, 0.42, 1);
      both(sn, 8, 0.34, 1, true, 0.5); // beat three, often left out
      add(1, brushes ? 'ghost' : 'tap', 10, 0.24, 2, true, 0.4);
      if (!brushes) hats(0.34, 0.24, 1);
      else both('ride', 0, 0.36, 3, true, 0.2);
    } else { // sparse
      if (brushes) both('stir', 0, 0.4, 1, false, 0, meter);
      both('kick', 0, 0.52, 1);
      add(1, sn === 'snare' && !brushes ? 'tap' : sn, 8, 0.36, 1);
      add(0, 'kick', 10, 0.32, 2, true, 0.4);
      if (hk !== 'none') for (var e = 2; e < steps; e += 4) both(hatKind, e, 0.22, 1, true, 0.15);
    }
    bars.brushes = brushes;
    return bars;
  };
  // One bar of the pocket at an arrangement level (1-3): the optional hits
  // thinned out, the dynamics breathing a little.
  L.grooveBar = function (tpl, bar, level, rnd) {
    var lift = level >= 3 ? 1.06 : level <= 1 ? 0.9 : 1;
    var out = [];
    tpl[bar % 2].forEach(function (h) {
      if (h.lvl > level) return;
      if (h.opt && rnd() < h.p) return;
      var accent = (h.kind === 'rim' || h.kind === 'snare') && h.step % 4 === 0 && rnd() < 0.12 ? 1.15 : 1; // a firmer backbeat, now and then
      out.push({ kind: h.kind, step: h.step, vel: clamp(h.vel * lift * accent * (0.95 + rnd() * 0.1), 0.03, 1), dur: h.dur });
    });
    return out;
  };
  // The little things at the end of a bar, rare and small: two ghost taps, a
  // skipped kick, a brush swish, or the drums stopping for the last beat.
  L.fill = function (hits, kind, meter, brushes, rnd) {
    var steps = meter * 4, tail = steps - 4;
    var ghost = brushes ? 'ghost' : 'tap';
    if (kind === 'stop') return hits.filter(function (h) { return h.step < tail + 1 || h.kind === ghost; });
    var out = hits.slice();
    if (kind === 'pickup') { out.push({ kind: ghost, step: tail + 2, vel: 0.18 + rnd() * 0.04 }); out.push({ kind: ghost, step: tail + 3, vel: 0.26 + rnd() * 0.04 }); }
    else if (kind === 'skip') { out.push({ kind: 'kick', step: tail + 1, vel: 0.42 }); out.push({ kind: 'kick', step: tail + 3, vel: 0.36 }); }
    else if (kind === 'swish') out.push({ kind: brushes ? 'swish' : ghost, step: tail, vel: 0.42, dur: 1 });
    return out;
  };

  // ---------------------------------------------------------------- bass
  // A four-bar figure, decided once per break: per bar a rhythm of
  // [step, length (16ths), role]: R the root, C a note that connects to the
  // next chord (its fifth, third or octave, whichever lies closest to where
  // the line goes), G a soft dead note. Played again every four bars.
  var BASS_RHYTHMS = [
    [[0, 10, 'R'], [10, 6, 'C']], [[0, 6, 'R'], [6, 2, 'G'], [8, 8, 'C']], [[0, 14, 'R']],
    [[0, 7, 'R'], [10, 5, 'C']], [[0, 12, 'R'], [12, 4, 'C']],
  ];
  L.bassFigure = function (style, meter, rnd) {
    if (meter === 3 || style === 'waltz') return [[[0, 7, 'R'], [8, 4, 'C']], [[0, 11, 'R']], [[0, 7, 'R'], [8, 4, 'C']], [[0, 7, 'R'], [8, 3, 'C']]];
    if (style === 'bossa') return [0, 1, 2, 3].map(function () { return [[0, 6, 'R'], [6, 2, 'F'], [8, 6, 'F']]; });
    if (style === 'long') return [0, 1, 2, 3].map(function () { return [[0, 16, 'R']]; });
    var a = pick(rnd, BASS_RHYTHMS), b = pick(rnd, BASS_RHYTHMS);
    return [a, b, a, pick(rnd, [[[0, 14, 'R']], b])];
  };
  // One bar of bass for the bar's chord changes: [{ step, midi, len, vel }].
  // mode: 'main' plays the figure's bar, 'simple' a long root, 'walk' four
  // quarters, 'alone' a line climbing towards the next root (the bar where
  // the bass plays by itself); approach = lead into the next root from a
  // step away on the last eighth, softer than where it lands.
  L.bassBar = function (o) {
    var notes = [];
    var steps = o.meter * 4;
    var prev = o.prev;
    o.slots.forEach(function (sl, si) {
      var rootPc = o.pedal !== undefined ? o.pedal : sl.chord.root;
      var root = L.bassNote(rootPc, prev);
      var Q = QUAL[sl.chord.q];
      var fifth = root + Q.f > 50 ? root + Q.f - 12 : root + Q.f;
      var start = sl.at * 4, len = sl.beats * 4;
      var last = si === o.slots.length - 1;
      var nextBass = o.nextRoot === null || o.nextRoot === undefined ? null : L.bassNote(o.nextRoot, root);
      function n(step, midi, l, v) { notes.push({ step: start + step, midi: midi, len: l, vel: v }); }
      function connect() { // the chord tone closest to where the line is going
        var opts = [fifth, root + Q.g[0], root + 12 <= 50 ? root + 12 : fifth].filter(function (x) { return x >= 28 && x <= 52; });
        var target = nextBass === null ? root : nextBass;
        opts.sort(function (a, b) { return Math.abs(a - target) - Math.abs(b - target); });
        return opts[0] === undefined ? root : opts[0];
      }
      var mode = o.mode;
      if (len < steps) { n(0, root, len - 1, L.vel(o.rnd, 0.7, 0.05)); prev = root; return; } // half-bar chords: their roots
      if (mode === 'simple' || mode === 'intro') {
        n(0, root, steps, L.vel(o.rnd, mode === 'intro' ? 0.58 : 0.66, 0.05));
      } else if (mode === 'alone') {
        var to = nextBass === null ? root : nextBass;
        var line = [root, root + (to > root ? 2 : -2), to + (to > root ? -1 : 1)];
        var at = o.meter === 3 ? [0, 6, 9] : [0, 8, 12];
        n(at[0], line[0], at[1] - 0.5, L.vel(o.rnd, 0.72, 0.04)); n(at[1], line[1], at[2] - at[1] - 0.5, L.vel(o.rnd, 0.6, 0.04)); n(at[2], line[2], Math.min(3.5, steps - at[2]), L.vel(o.rnd, 0.54, 0.04));
      } else if (mode === 'walk' && o.meter === 4) {
        var third = root + Q.g[0];
        var appr = nextBass === null ? fifth : nextBass + (nextBass > fifth ? -1 : 1);
        [[0, root, 0.72], [4, o.rnd() < 0.5 ? third : fifth, 0.6], [8, o.rnd() < 0.5 ? fifth : third, 0.6], [12, appr, 0.52]]
          .forEach(function (w) { n(w[0], clamp(w[1], 28, 52), 3.6, L.vel(o.rnd, w[2], 0.04)); });
      } else {
        o.cell.forEach(function (c) {
          if (c[0] >= steps) return;
          var l = Math.min(c[1], steps - c[0]);
          if (c[2] === 'R') n(c[0], root, l, L.vel(o.rnd, 0.74, 0.05));
          else if (c[2] === 'F') n(c[0], fifth, l, L.vel(o.rnd, 0.56, 0.05));
          else if (c[2] === 'G') n(c[0], root, Math.min(l, 1.5), L.vel(o.rnd, 0.3, 0.04));
          else n(c[0], connect(), l, L.vel(o.rnd, 0.58, 0.05));
        });
      }
      if (last && o.approach && nextBass !== null && mode !== 'alone' && mode !== 'walk') {
        var ap = o.rnd() < 0.6 ? nextBass + (o.rnd() < 0.5 ? -1 : 1) : nextBass + (nextBass > root ? -2 : 2);
        notes.forEach(function (x) { if (x.step + x.len > start + steps - 2) x.len = Math.max(1, start + steps - 2 - x.step); });
        n(steps - 2, clamp(ap, 28, 52), 2, L.vel(o.rnd, 0.48, 0.04));
      }
      prev = root;
    });
    return notes;
  };

  // ---------------------------------------------------------------- melody
  // The theme: four bars composed once per break - a two-bar statement (the
  // scene's own motif, or one made up) and a two-bar answer that rhymes with
  // its rhythm and comes to rest on a stable note. It returns literally over
  // the home chords; elsewhere its strong notes bend to the chord.
  var RHYTHMS = [
    [[0, 3], [3, 3], [6, 6]], [[2, 2], [4, 2], [6, 8]], [[0, 2], [2, 2], [4, 8]], [[4, 2], [6, 2], [8, 8]],
    [[0, 6], [6, 2], [8, 8]], [[2, 4], [6, 4], [10, 6]], [[0, 4], [6, 2], [8, 4], [12, 4]], [[8, 2], [10, 2], [12, 4]],
    [[0, 8], [10, 2], [12, 4]], [[3, 3], [6, 2], [8, 6]],
  ];
  var CONTOURS = [[0, 1, -1], [0, -1, -2], [0, 2, 1], [0, -1, 1], [0, 1, 2], [0, -2, -1], [0, 0, -1], [0, 1, 0, -1], [0, -1, -2, -3]];
  function nearestIn(n, pcs) {
    for (var d = 0; d < 12; d++) {
      if (pcs.indexOf(mod(n + d, 12)) >= 0) return n + d;
      if (pcs.indexOf(mod(n - d, 12)) >= 0) return n - d;
    }
    return n;
  }
  L.nearestIn = nearestIn;
  function stepScale(n, steps, scale) {
    var x = nearestIn(n, scale);
    var dir = steps > 0 ? 1 : -1;
    for (var k = 0; k < Math.abs(steps); k++) { x += dir; while (scale.indexOf(mod(x, 12)) < 0) x += dir; }
    return x;
  }
  L.stepScale = stepScale;
  function strongStep(step, len) { return step % 4 === 0 || len >= 4; }
  function chordAt(bar, step) {
    var c = bar[0].chord;
    bar.forEach(function (sl) { if (sl.at * 4 <= step) c = sl.chord; });
    return c;
  }
  L.chordAt = chordAt;
  // A note on a strong beat that is neither a chord tone nor a tension moves
  // to the nearest chord tone. With the scale given, any other scale note may
  // stay too unless it sits a half step above a chord tone (the avoid notes):
  // a sixth over a minor ninth chord is colour, a fourth over a major one is not.
  L.fitNote = function (midi, ch, strong, scale) {
    if (!strong) return midi;
    var pc = mod(midi, 12), tones = L.chordTones(ch, false);
    if (L.chordTones(ch, true).indexOf(pc) >= 0) return midi;
    if (scale && scale.indexOf(pc) >= 0 && tones.indexOf(mod(pc - 1, 12)) < 0) return midi;
    return nearestIn(midi, tones);
  };
  // 'step.len.degree' tokens, bars split by '|' -> [[{ step, len, deg, deg2, opt }]].
  L.parseMotif = function (str) {
    return str.split('|').map(function (bar) {
      return bar.trim() ? bar.trim().split(/\s+/).map(function (tok) {
        var m = /^(-?\d+(?:\.\d+)?)\.(\d+(?:\.\d+)?)\.(-?\d+)(?:\+(-?\d+))?(\?)?$/.exec(tok);
        if (!m) throw new Error('bad motif note ' + tok);
        return { step: +m[1], len: +m[2], deg: +m[3], deg2: m[4] === undefined ? null : +m[4], opt: !!m[5] };
      }) : [];
    });
  };
  // A scale degree (1 = the tonic nearest the bottom of the range) as a MIDI note.
  L.degree = function (deg, scale, base) {
    var i = deg - 1, oct = Math.floor(i / 7), k = mod(i, 7);
    var n = base + mod(scale[k] - scale[0], 12) + 12 * oct;
    return n;
  };
  L.theme = function (spec, bars, scale, rnd) {
    var meter = spec.meter || 4, steps = meter * 4;
    var range = spec.lead.range;
    var base = range[0] + mod(scale[0] - range[0], 12); // the tonic in the lowest octave of the range
    var out = [[], [], [], []];
    function note(b, step, len, midi, vel, opt, dy) { out[b].push({ step: step, len: len, midi: midi, vel: vel, opt: !!opt, dy: dy === undefined ? null : dy }); }
    var last = Math.round((range[0] + range[1]) / 2);
    if (spec.lead.motif) {
      L.parseMotif(spec.lead.motif).slice(0, 2).forEach(function (bar, b) {
        bar.forEach(function (t) {
          var m = L.degree(t.deg, scale, base);
          note(b, t.step, Math.min(t.len, steps - Math.max(0, t.step)), m, 0.56, t.opt, t.deg2 === null ? null : L.degree(t.deg2, scale, base));
          last = m;
        });
      });
    } else {
      var r0 = pick(rnd, RHYTHMS).filter(function (n) { return n[0] < steps; }).map(function (n) { return [n[0], Math.min(n[1], steps - n[0])]; });
      var c0 = pick(rnd, CONTOURS);
      var n0 = nearestIn(last + Math.round((rnd() - 0.5) * 6), L.chordTones(chordAt(bars[0], 0), false));
      r0.forEach(function (rh, i) {
        if (i > 0) n0 = stepScale(n0, c0[i % c0.length] - c0[(i - 1) % c0.length], scale);
        n0 = L.fitNote(n0, chordAt(bars[0], rh[0]), strongStep(rh[0], rh[1]), scale);
        note(0, rh[0], rh[1], n0, 0.56); last = n0;
      });
      var r1 = pick(rnd, [[[0, 8]], [[2, 2], [4, 10]], [[0, 4], [6, 8]], [[4, 10]]]);
      r1.forEach(function (rh, i) {
        last = L.fitNote(stepScale(last, i === 0 ? pick(rnd, [-1, 1, 2]) : -1, scale), chordAt(bars[1 % bars.length], rh[0]), true, scale);
        note(1, rh[0], Math.min(rh[1], steps - rh[0]), last, 0.52);
      });
    }
    // the answer: bar 0's rhythm again a step or two away, then a long stable note
    // five to nine notes in all: the answer rhymes with fewer notes if the statement was busy
    var used = out[0].length + out[1].length;
    var pickup = rnd() < 0.45 && used <= 5;
    var head = (out[0].length ? out[0] : out[1]).slice(0, Math.max(1, 8 - used - (pickup ? 1 : 0)));
    var shift = pick(rnd, [-1, -2, 1]);
    var b2 = bars[2 % bars.length], b3 = bars[3 % bars.length];
    head.forEach(function (h, i) {
      var m = L.fitNote(stepScale(h.midi, shift, scale), chordAt(b2, h.step), strongStep(h.step, h.len), scale);
      note(2, h.step, h.len, m, i === 0 ? 0.56 : 0.5, h.opt && i > 0, h.dy === null ? null : L.fitNote(stepScale(h.dy, shift, scale), chordAt(b2, h.step), false));
      last = m;
    });
    var t3 = L.chordTones(chordAt(b3, 0), false), stable = [t3[0], t3[2], t3[1]]; // root, third, fifth
    var endStep = rnd() < 0.5 ? 0 : 2;
    if (pickup) { // a pickup before the landing
      var pk = stepScale(last, rnd() < 0.5 ? 1 : -1, scale);
      if (endStep !== 0) pk = L.fitNote(pk, chordAt(b3, 0), true, scale);
      note(3, endStep === 0 ? -2 : 0, 2, pk, 0.46); // step -2: the last eighth of bar 2, tied over the bar line
    }
    note(3, endStep, Math.min(12, steps - endStep), nearestIn(last, stable), 0.5);
    // keep it inside the range and within about a sixth
    var all = [].concat(out[0], out[1], out[2], out[3]);
    var hi = Math.max.apply(null, all.map(function (n) { return n.midi; })), lo = Math.min.apply(null, all.map(function (n) { return n.midi; }));
    var sh = hi > range[1] ? -12 : lo < range[0] ? 12 : 0;
    if (sh && (hi + sh <= range[1] + 2) && (lo + sh >= range[0] - 2)) all.forEach(function (n) { n.midi += sh; if (n.dy !== null) n.dy += sh; });
    // the loudest note is the highest one of the statement: an accent (the piano plays it from its louder recording)
    var top = out[0].concat(out[1]).sort(function (a, b) { return b.midi - a.midi; })[0];
    if (top) { top.vel += 0.06; top.accent = true; }
    return out;
  };
  // The theme for one appearance: 'lit' as composed, 'ending' with another
  // landing note, 'octave' an octave up (if it fits), 'final' landing on the
  // tonic (or the chord's third, where the tonic would clash).
  L.themeVariant = function (theme, kind, spec, scale, bars3, rangeHi) {
    var t = theme.map(function (bar) { return bar.map(function (n) { return Object.assign({}, n); }); });
    var lastBar = t[3], landing = lastBar[lastBar.length - 1];
    if (!landing) return t;
    var ch = chordAt(bars3, landing.step);
    if (kind === 'octave') {
      var hi = Math.max.apply(null, [].concat(t[0], t[1], t[2], t[3]).map(function (n) { return n.midi; }));
      if (hi + 12 <= rangeHi + 5) { t.forEach(function (bar) { bar.forEach(function (n) { n.midi += 12; if (n.dy !== null) n.dy += 12; }); }); return t; }
      kind = 'ending';
    }
    if (kind === 'ending') {
      var tones = L.chordTones(ch, false).filter(function (pc) { return pc !== mod(landing.midi, 12); });
      landing.midi = nearestIn(landing.midi + 1, tones.slice(0, 3));
    } else if (kind === 'final') {
      var tonic = scale[0];
      landing.midi = L.chordTones(ch, true).indexOf(tonic) >= 0 ? nearestIn(landing.midi, [tonic]) : nearestIn(landing.midi, [L.chordTones(ch, false)[2]]);
      landing.len = Math.max(landing.len, 8);
    }
    return t;
  };

  // ---------------------------------------------------------------- the arrangement
  // The break as bars, decided once: what each part does in every bar. The
  // last chord is anchored to the break's deadline - it starts L.LAST (±1)
  // seconds before the fade has finished (the fade starts `secs` from now and
  // lasts `fade`) - and no new melodic phrase starts in the last L.QUIET seconds.
  // The shares follow a 4-minute record (Astra's table in relax-report.md):
  // intro ~20 s, settle, the lift, the release, the return, thinning, ~13 s of outro.
  L.LAST = 11;
  L.QUIET = 26;
  L.OUTRO = 13;
  var SECTIONS = ['settle', 'lift', 'release', 'return', 'thin', 'outro'];
  var WEIGHT = { settle: 0.235, lift: 0.205, release: 0.15, return: 0.255, thin: 0.155 };
  var PRIORITY = ['settle', 'outro', 'return', 'lift', 'release', 'thin'];
  L.arrange = function (spec, secs, barLen, rnd, fade) {
    var hasDrums = !!spec.drums, hasBass = !!spec.bass, hasLead = !!spec.lead;
    fade = fade === undefined ? 3 : fade;
    // the last chord starts within a second of `target`: the bars before it
    // slow down just enough to get there when a whole bar would overshoot
    var target = Math.max(2 * barLen, secs + fade - L.LAST);
    var nf = Math.max(2, Math.floor((target + 1) / barLen)); // bars before it
    var slack = Math.max(0, target - 1 - nf * barLen);
    var u = nf >= 24 ? 4 : 2;
    var intro = Math.min(nf, u + nf % u);
    var units = (nf - intro) / u;
    var count = {};
    SECTIONS.forEach(function (s) { count[s] = 0; });
    if (units <= 6) {
      for (var k = 0; k < units; k++) count[PRIORITY[k]] += 1;
    } else {
      count.outro = Math.max(1, Math.round(L.OUTRO / (u * barLen)));
      var left = units - count.outro, used = 0, rest = [];
      Object.keys(WEIGHT).forEach(function (s) {
        var x = left * WEIGHT[s];
        count[s] = Math.max(s === 'thin' ? 0 : 1, Math.floor(x));
        used += count[s]; rest.push([x - Math.floor(x), s]);
      });
      rest.sort(function (a, b) { return b[0] - a[0]; });
      for (var r = 0; used < left; r++, used++) count[rest[r % rest.length][1]] += 1;
      for (var q = 0; used > left && q < 64; q++) { var s2 = ['thin', 'release', 'lift', 'settle'][q % 4]; if (count[s2] > 1 || s2 === 'thin' && count[s2] > 0) { count[s2] -= 1; used -= 1; } }
    }
    var bars = [];
    var walk = hasBass && spec.bass.walk;
    var pad = spec.pad ? spec.pad.in || ['release', 'outro'] : [];
    var six = hasLead && spec.lead.phrase === 6; // a six-bar melody and two bars of rest in every eight
    var space = hasLead && spec.lead.space;      // later statements are followed by real silence, no reply
    function bar(sec, i, n, o) {
      var b = { sec: sec, i: i, n: n, keys: 'main', drums: 0, fill: null, bass: hasBass ? 'main' : null, lead: null, reply: null,
        pad: pad.indexOf(sec) >= 0, dyn: 1, alt: false, approach: false, recolour: false, noKick: false };
      for (var key in o) b[key] = o[key];
      if (!hasDrums) { b.drums = 0; b.fill = null; }
      if (!hasLead) { b.lead = null; b.reply = null; }
      if (!hasBass) b.bass = null;
      bars.push(b);
    }
    function lit(tb, v) { return { tb: tb, v: v || 'lit' }; }
    var style = spec.drums ? spec.drums.style : null;
    var i;
    for (i = 0; i < intro; i++) {
      bar('intro', i, intro, { keys: 'intro', bass: i >= intro - 2 && intro >= 3 ? 'intro' : null, dyn: 0.9,
        fill: i === intro - 1 && style !== 'sparse' && rnd() < 0.6 ? 'pickup' : null });
    }
    var n = count.settle * u;
    for (i = 0; i < n; i++) {
      var sl = null;
      if (six && n >= 12) sl = i >= 4 && i < 10 ? (i < 8 ? lit(i - 4) : lit(i - 6, 'ending')) : null;
      else if (n >= 8) sl = i >= 4 && i < 8 ? lit(i - 4) : null;
      else sl = i < 2 ? lit(i) : null;
      bar('settle', i, n, { drums: i < 4 && n >= 8 ? 1 : 2, dyn: 0.95, lead: sl,
        reply: !six && n >= 12 && (i === 9 || i === 10) ? { k: i - 9 } : null,
        approach: i < n - 1 && rnd() < 0.25,
        fill: i === n - 1 ? (rnd() < 0.5 ? pick(rnd, ['pickup', 'skip']) : null) : null });
    }
    // the theme in the lift and the return: four bars on, four off (an
    // answer in the gap), the later statements varied; a short section
    // states it and gives the answer alone after two bars of rest. A six-bar
    // phrase is the theme and its answer once more, landing elsewhere.
    function themeAt(i, n, vary) {
      var k = Math.floor(i / 8), j = i % 8;
      if (six) {
        if (i - j + 5 >= n) return n === 8 && i >= 6 ? lit(i - 4, vary) : null;
        return j < 4 ? lit(j, k % 2 ? vary : 'lit') : j < 6 ? lit(j - 2, 'ending') : null;
      }
      if (j < 4 && i - j + 3 < n) return lit(j, k % 2 ? vary : 'lit');
      if (n === 8 && i >= 6) return lit(i - 4, vary);
      return null;
    }
    function replyAt(i, n) {
      var j = i % 8;
      if (six || (space && i >= 8)) return null;
      return (j === 5 || j === 6) && i + 1 < n && !(n === 8 && i >= 6) ? { k: j - 5 } : null;
    }
    n = count.lift * u;
    for (i = 0; i < n; i++) {
      bar('lift', i, n, { drums: 3, keys: 'broad', bass: walk ? 'walk' : 'main', dyn: 1.04, lead: themeAt(i, n, 'ending'),
        reply: replyAt(i, n),
        approach: i < n - 1 && rnd() < 0.25,
        fill: i === 7 && n > 8 && rnd() < 0.3 ? 'pickup' : i === n - 1 && rnd() < 0.4 ? 'stop' : null });
    }
    n = count.release * u;
    var h = Math.max(1, Math.floor(n / 2));
    for (i = 0; i < n; i++) {
      // the last bar is the bass alone climbing back; the chord before it is
      // touched again softly so the bar is not empty underneath
      var alone = n >= 4 && i === n - 1;
      bar('release', i, n, { alt: spec.progs.length > 1, dyn: 0.95, keys: alone ? (hasBass ? 'tail' : 'intro') : 'hold',
        drums: i < h || alone ? 0 : 1, noKick: true, bass: i < h ? null : alone ? 'alone' : 'simple',
        reply: i === 1 || i === 2 ? { k: i - 1 } : null });
    }
    n = count['return'] * u;
    for (i = 0; i < n; i++) {
      bar('return', i, n, { drums: 2, lead: themeAt(i, n, (spec.lead && spec.lead.vary) || 'ending'), reply: replyAt(i, n),
        recolour: i % 8 === 0, approach: i < n - 1 && rnd() < 0.25,
        fill: i === 7 && rnd() < 0.35 ? pick(rnd, ['pickup', 'swish']) : null });
    }
    n = count.thin * u;
    for (i = 0; i < n; i++) {
      // the answer lands home; four bars before the outro a soft echo of the head keeps the accompaniment moving
      bar('thin', i, n, { drums: 1, keys: 'soft', bass: 'simple', dyn: 0.94, lead: i === 2 || i === 3 ? lit(i, 'final') : null,
        reply: n >= 6 && i === n - 3 ? { k: 0, soft: true } : null });
    }
    n = count.outro * u;
    for (i = 0; i < n; i++) {
      // the brushes or hats carry on, softly and without the kick, for the outro's first two bars
      bar('outro', i, n, { keys: 'hold', bass: 'simple', drums: i < 2 && n >= 4 ? 1 : 0, noKick: true,
        dyn: 0.92 - 0.1 * (i / Math.max(1, n - 1)) });
    }
    bar('final', 0, 1, { keys: 'final', bass: null, dyn: 0.85, pad: pad.indexOf('outro') >= 0 || pad.indexOf('final') >= 0 });
    // progression bars: the intro's extra bars sit on the tonic, then the home progression from its first bar
    var pre = intro - Math.min(intro, u);
    bars.forEach(function (b, k) { b.pi = k < pre ? -1 : k - pre; });
    bars[bars.length - 1].pi = -2; // the last chord
    if (bars.length >= 2) bars[bars.length - 2].cadence = true;
    // land on the deadline: a ritardando over the last four bars takes up the slack
    var rit = Math.min(4, bars.length - 1), wsum = rit * (rit + 1) / 2;
    for (i = 0; i < rit; i++) bars[bars.length - 2 - i].stretch = 1 + slack * ((rit - i) / wsum) / barLen;
    // when each bar starts; nothing melodic begins in the last L.QUIET seconds
    var t = 0, cut = secs + fade - L.QUIET;
    bars.forEach(function (b) { b.t = t; t += barLen * (b.stretch || 1); });
    for (i = 0; i < bars.length; i++) {
      var bi = bars[i];
      if (bi.reply && bi.t >= cut) bi.reply = null;
      if (bi.lead && (i === 0 || !bars[i - 1].lead) && bi.t >= cut) {
        for (var j2 = i; j2 < bars.length && bars[j2].lead; j2++) bars[j2].lead = null;
      }
    }
    return { bars: bars, nf: nf, count: count, intro: intro, slack: slack, target: target };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = L;
  if (typeof window === 'undefined') return;

  // ================================================================ audio (browser only)
  window.RelaxLofi = L;

  // ---------------------------------------------------------------- samples
  // samples/<name>.js calls RelaxSamples.add(name, data). Loaded on demand,
  // decoded once per AudioContext.
  var raw = {};
  window.RelaxSamples = { add: function (name, data) { raw[name] = data; } };
  var me = document.currentScript && document.currentScript.src;
  var BASE = me ? me.replace(/[^/]*$/, '') + 'samples/' : 'relax-biomes/samples/';

  function loadScript(name) {
    return new Promise(function (resolve, reject) {
      if (raw[name]) { resolve(); return; }
      var el = document.createElement('script');
      el.src = BASE + name + '.js';
      el.onload = function () { if (raw[name]) resolve(); else reject(new Error(name + ' did not register')); };
      el.onerror = function () { reject(new Error('could not load samples/' + name + '.js')); };
      document.head.appendChild(el);
    });
  }
  function b64(s) {
    var bin = atob(s); var u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }
  function decode(ac, s) {
    return new Promise(function (resolve, reject) { ac.decodeAudioData(b64(s), resolve, reject); });
  }
  // The instruments a spec needs: pitched ones decode to [{ midi, tune, buf }],
  // kits (drums, brushes) to { kick: [buf, ...], ... }.
  L.instruments = function (spec) {
    var names = [];
    function add(n) { if (n && names.indexOf(n) < 0) names.push(n); }
    [spec.keys, spec.lead, spec.reply, spec.pad].forEach(function (p) { if (p) add(p.inst); });
    if (names.indexOf('piano') >= 0) add('piano2'); // the louder layer for accents
    if (spec.bass) add('bass');
    if (spec.drums) { add('drums'); if (spec.drums.kit === 'brushes') add('brushes'); }
    return names;
  };
  L.loadBanks = function (ac, spec) {
    if (!ac.__lofiBanks) ac.__lofiBanks = {};
    var banks = ac.__lofiBanks;
    return Promise.all(L.instruments(spec).map(function (name) {
      if (banks[name]) return banks[name];
      return loadScript(name).then(function () {
        var d = raw[name];
        if (!d.notes) {
          var kinds = Object.keys(d);
          return Promise.all(kinds.map(function (k) { return Promise.all(d[k].map(function (s) { return decode(ac, s); })); }))
            .then(function (lists) { var o = {}; kinds.forEach(function (k, i) { o[k] = lists[i]; }); banks[name] = o; });
        }
        return Promise.all(d.notes.map(function (n) { return decode(ac, n[2]).then(function (buf) { return { midi: n[0], tune: n[1], buf: buf }; }); }))
          .then(function (list) { banks[name] = list.sort(function (a, b) { return a.midi - b.midi; }); });
      });
    })).then(function () { return banks; });
  };

  // ---------------------------------------------------------------- the sound of the room
  // A biquad (RBJ cookbook) run over a buffer once, when it is built: filters
  // baked in cost nothing while the music plays.
  function bake(d, type, f, q, sr) {
    var w = 2 * Math.PI * f / sr, al = Math.sin(w) / (2 * q), c = Math.cos(w);
    var a0 = 1 + al, a1 = -2 * c / a0, a2 = (1 - al) / a0;
    var b0 = (type === 'lowpass' ? (1 - c) / 2 : (1 + c) / 2) / a0, b1 = (type === 'lowpass' ? 1 - c : -(1 + c)) / a0, b2 = b0;
    var x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (var i = 0; i < d.length; i++) {
      var y = b0 * d[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = d[i]; y2 = y1; y1 = y; d[i] = y;
    }
  }
  // The record and the tape, one stereo loop: a faint surface with small
  // ticks (no loud pops: a pop that comes round every 11 s sounds like a fault),
  // band-limited like an old needle, and a soft tape hiss above it.
  // The surface and hiss loop every 11 s (noise has no pattern to recognise);
  // the ticks are spread over three loops of 7.3, 11.1 and 13.7 s, so their
  // pattern never comes round whole within a break (a single 11 s loop of
  // ticks measured an autocorrelation of 0.88 at 11 s).
  function vinylBuffer(ac, crackle, hiss, ticks) {
    var key = crackle.toFixed(2) + '/' + hiss.toFixed(2) + '/' + (ticks || 0);
    if (ac.__lofiVinyl && ac.__lofiVinyl[key]) return ac.__lofiVinyl[key];
    var sr = ac.sampleRate, len = Math.floor(sr * (ticks || 11));
    var buf = ac.createBuffer(2, len, sr);
    var rnd = Math.random, h = new Float32Array(len), i;
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      for (i = 0; i < len; i++) d[i] = ticks ? 0 : (rnd() * 2 - 1) * 0.0035;
      var t = 0;
      while (ticks && t < len) {
        t += Math.floor(-Math.log(1 - rnd()) * sr / (14 / 3)); // ~14 ticks a second over the three loops
        if (t >= len) break;
        var a = Math.pow(rnd(), 3) * 0.16 * (rnd() < 0.5 ? -1 : 1);
        var ring = 6 + rnd() * 14, f = 0.6 + rnd() * 0.8;
        for (var k = 0; k < ring * 4 && t + k < len; k++) d[t + k] += a * Math.exp(-k / ring) * Math.cos(k * f);
      }
      bake(d, 'highpass', 250, 0.5, sr); bake(d, 'lowpass', 5200, 0.5, sr);
      for (i = 0; i < len; i++) h[i] = ticks ? 0 : rnd() * 2 - 1;
      if (!ticks) { bake(h, 'highpass', 3500, 0.5, sr); bake(h, 'lowpass', 9000, 0.5, sr); }
      for (i = 0; i < len; i++) d[i] = d[i] * 1.25 * crackle + h[i] * 0.017 * hiss;
      var fade = Math.floor(sr * 0.08); // seamless loop
      for (var j = 0; j < fade; j++) { var x = j / fade; d[len - fade + j] = d[len - fade + j] * (1 - x) + d[j] * x; }
    }
    if (!ac.__lofiVinyl) ac.__lofiVinyl = {};
    ac.__lofiVinyl[key] = buf;
    return buf;
  }
  function curve(drive) { // a soft tanh saturation
    var n = 2048, c = new Float32Array(n), k = 1 + drive * 3, norm = Math.tanh(k);
    for (var i = 0; i < n; i++) { var x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * x) / norm; }
    return c;
  }

  // Per instrument, so a note of each sounds about as loud as a piano note
  // (measured on the pack: the vibes ring far longer, the kalimba dies fast,
  // a bowed note never decays at all).
  // piano2 (the louder recording) is level-matched to the soft one, -1.8 dB as measured note by note: it brings
  // the harder attack, not a jump in loudness
  var INST_GAIN = { piano: 0.5, piano2: 0.375, vibes: 0.17, guitar: 0.52, kalimba: 0.9, bass: 0.45, cello: 0.18, bowed: 0.14 };
  var LEAD_GAIN = 1.65; // one line against a chord of three or four: lifted to sit just under the keys
  var DRUM_GAIN = { kick: 0.75, rim: 0.94, snare: 0.7, tap: 0.8, hat: 0.9, pedal: 0.7, shaker: 2 };
  var BRUSH_GAIN = { snare: 0.9, ghost: 1.1, stir: 0.32, swish: 0.5, ride: 0.42, bhat: 0.8 };
  var RELEASE = { piano: 0.16, piano2: 0.16, vibes: 0.22, guitar: 0.12, kalimba: 0.5, bass: 0.07, cello: 0.4, bowed: 0.6 };
  var PLATE_GAIN = 0.8;
  // A crossfade between the two piano recordings was measured and dropped: the
  // two strikes are not phase-aligned, so a mix of them swung -6.5..+4.6 dB
  // mid-fade. The louder one plays authored accents only, level-matched.

  // The track: builds the mix into `out`, composes the break and returns
  // schedule(until). opts: length (seconds until the fade; default 240), rnd
  // (seeded random), mute: { keys, lead, reply, pad, bass, drums, vinyl, kinds: ['hat', ...] }
  // for measuring stems, trace: an array that receives every bar and note.
  L.track = function (ac, out, spec, banks, opts) {
    opts = opts || {};
    var K = window.RelaxKit;
    var rnd = opts.rnd || L.rng(Math.random() * 2147483646 + 1);
    var mute = opts.mute || {};
    var trace = opts.trace || null;
    var fx = spec.fx || {};
    var meter = spec.meter || 4, steps = meter * 4;
    var beat0 = 60 / spec.bpm, six0 = beat0 / 4, barLen0 = beat0 * meter;
    var beat = beat0, six = six0, barLen = barLen0; // one bar's own lengths (the last bars slow down)
    var keyPc = L.keyPc(spec.key);
    var scale = L.scale(spec);
    var t0 = ac.currentTime + 0.25;
    var room = fx.room === undefined ? 0.4 : fx.room;

    // ---- the mix: chords through the tape's wow, lead and bass through the
    // same delay without it (so all stay in time), then saturation and the roll-off
    var master = K.filter(ac, 'highpass', 30, 0.5, out);
    var tone = K.filter(ac, 'lowpass', fx.tone || 5500, 0.5, master);
    var sat = ac.createWaveShaper(); sat.curve = curve(fx.sat === undefined ? 0.35 : fx.sat); sat.connect(tone);
    var WOW_LAT = 0.03;
    var wow = ac.createDelay(0.1); wow.delayTime.value = WOW_LAT; wow.connect(sat);
    var depth = fx.wow === undefined ? 1 : fx.wow;
    K.lfo(ac, 0.35 + rnd() * 0.2, 0.0006 * depth, wow.delayTime, 'sine', t0);  // wow: about 3 cents
    K.lfo(ac, 0.071, 0.0004 * depth, wow.delayTime, 'triangle', t0);           // a slower drift
    K.lfo(ac, 6.1, 0.000015 * depth, wow.delayTime, 'sine', t0);               // flutter, barely there
    var still = ac.createDelay(0.1); still.delayTime.value = WOW_LAT; still.connect(sat);
    // the plate, its own here: high-passed send, 18 ms pre-delay, three
    // allpasses to diffuse it (a quarter of their output is the early sound),
    // then six detuned, slowly wobbling, damped combs of 23-35 ms for the tail.
    // K.reverb's shortest comb (37 ms x its size) put the first reflection
    // 76 ms after the note, and its resonant damping filter rang at 3.6-4.1 kHz.
    var verbIn = K.filter(ac, 'highpass', 260, 0.5);
    verbIn.channelCount = 1; verbIn.channelCountMode = 'explicit';
    var pre = ac.createDelay(0.2); pre.delayTime.value = fx.predelay || 0.018; verbIn.connect(pre);
    plate(pre, wow, fx.verb || 1.1);
    function send(node, amount) { if (amount > 0) node.connect(K.gain(ac, amount, verbIn)); }
    function allpass(input, d, g) { // Schroeder: w = x + g w(t-d), y = -g w + w(t-d)
      var w = K.gain(ac, 1); input.connect(w);
      var dl = ac.createDelay(0.1); dl.delayTime.value = d; w.connect(dl); dl.connect(K.gain(ac, g, w));
      var y = K.gain(ac, 1); w.connect(K.gain(ac, -g, y)); dl.connect(y);
      return y;
    }
    function plate(input, dest, rt) {
      var size = 0.85 + 0.12 * Math.min(rt, 2.6); // longer rooms are a little larger too
      var d = allpass(allpass(allpass(input, 0.00477, 0.62), 0.00359, 0.6), 0.00297, 0.55);
      var delays = [0.0233, 0.0253, 0.0269, 0.0293, 0.0317, 0.0353];
      var fbs = delays.map(function (d0) { return Math.pow(10, -3 * d0 * size / rt); }); // 60 dB down after rt seconds
      // about the same wet level for a held note whatever the decay: scaled by the combs' steady-state gain
      var norm = fbs.reduce(function (a, f) { return a + 1 - f; }, 0) / fbs.length;
      var out = K.gain(ac, PLATE_GAIN * norm, dest);
      d.connect(K.gain(ac, 0.25, out));
      // two slow wobbles on the comb lengths keep any one resonance from ringing on
      var lfos = [0.31, 0.47].map(function (r) { var o = ac.createOscillator(); o.frequency.value = r; o.start(t0); return o; });
      delays.forEach(function (d0, i) {
        var dl = ac.createDelay(0.2); dl.delayTime.value = d0 * size;
        lfos[i % 2].connect(K.gain(ac, (i % 3 ? 1 : -1) * 0.00025 * (1 + i * 0.15), dl.delayTime));
        var lp = K.filter(ac, 'lowpass', 4800 - i * 250, -3); // no resonant peak: inside the loop it would ring and grow
        d.connect(dl); dl.connect(lp); lp.connect(K.gain(ac, fbs[i], dl));
        lp.connect(K.panner(ac, i % 2 ? 0.6 : -0.6, out));
      });
    }
    var duck = K.gain(ac, 1, wow); // the chords breathe a little with the kick

    var keysIn = null;
    if (spec.keys && !mute.keys) {
      var kl = spec.keys.level === undefined ? 1 : spec.keys.level;
      var kPan = K.panner(ac, -0.18, duck);
      // with a bass under them the chords leave it the low end
      var kHp = K.filter(ac, 'highpass', spec.bass ? 110 : 60, 0.5, spec.keys.tone ? K.filter(ac, 'lowpass', spec.keys.tone, 0.5, kPan) : kPan);
      send(kPan, 0.3 * room);
      if (spec.keys.ep) { // the Rhodes-like treatment: dulled, with a gentle tremolo
        var trem = K.gain(ac, 0.9, kHp);
        // 2.5 kHz keeps the tine-like attack (+3.5 dB at 1.5-4 kHz against 1.5 kHz) without the hammer's top end
        var dull = K.filter(ac, 'lowpass', spec.keys.epTone || 2500, 0.9, trem);
        var lfo = ac.createOscillator(); lfo.frequency.value = 2.8 + rnd() * 0.8; lfo.start(t0);
        lfo.connect(K.gain(ac, 0.9 * (spec.keys.trem === undefined ? 0.04 : spec.keys.trem))).connect(trem.gain); // +-4 %
        keysIn = K.gain(ac, kl * 1.25, dull);
      } else keysIn = K.gain(ac, kl, kHp);
    }
    var leadIn = null, echoIn = null;
    if (spec.lead && !mute.lead) {
      var lPan = K.panner(ac, 0.2, still);
      var lHp = K.filter(ac, 'highpass', 140, 0.5, spec.lead.tone ? K.filter(ac, 'lowpass', spec.lead.tone, 0.5, lPan) : lPan);
      leadIn = K.gain(ac, LEAD_GAIN * (spec.lead.level === undefined ? 1 : spec.lead.level), lHp);
      send(lPan, 0.42 * room);
      if (fx.echo !== 0) { // a quiet echo, darker each time round, on the other side
        var ed = ac.createDelay(3); ed.delayTime.value = beat * (fx.echo || 0.75);
        var elp = K.filter(ac, 'lowpass', fx.echoTone || 3000, 0.5);
        ed.connect(elp); elp.connect(K.gain(ac, fx.echoFb || 0.15, ed));
        elp.connect(K.panner(ac, -0.3, still));
        lPan.connect(K.gain(ac, fx.echoSend || 0.14, ed));
      }
    }
    var reply = spec.reply || (spec.keys ? { inst: spec.keys.inst, shift: -12 } : null);
    var replyIn = null;
    if (reply && !mute.reply && spec.lead) {
      var rPan = K.panner(ac, -0.28, wow);
      replyIn = K.gain(ac, (reply.level === undefined ? 0.6 : reply.level) * 1.5, K.filter(ac, 'highpass', 120, 0.5, rPan));
      send(rPan, 0.5 * room);
    }
    var padIn = null;
    if (spec.pad && !mute.pad) {
      var pPan = K.panner(ac, 0, wow);
      padIn = K.gain(ac, spec.pad.level === undefined ? 1 : spec.pad.level, K.filter(ac, 'highpass', 50, 0.5, pPan));
      send(pPan, 0.7 * room);
    }
    var bassIn = null;
    if (spec.bass && !mute.bass) {
      var bl = K.filter(ac, 'lowpass', 1100, 0.5, K.filter(ac, 'highpass', 35, 0.5, still));
      bassIn = K.gain(ac, spec.bass.level === undefined ? 1 : spec.bass.level, bl);
    }
    var drumIn = null, hatPan = null, ridePan = null;
    if (spec.drums && !mute.drums) {
      var drumSat = ac.createWaveShaper(); drumSat.curve = curve(0.25);
      drumSat.connect(K.filter(ac, 'lowpass', fx.drumTone || 6500, 0.5, master));
      drumIn = K.gain(ac, 0.75 * (spec.drums.level === undefined ? 1 : spec.drums.level), drumSat);
      send(drumIn, 0.12 * room);
      hatPan = K.panner(ac, 0.15, drumIn); ridePan = K.panner(ac, -0.15, drumIn);
    }
    if (!mute.vinyl) {
      var vin = K.gain(ac, 0, out);
      vin.gain.setValueAtTime(0, ac.currentTime); vin.gain.linearRampToValueAtTime(1, ac.currentTime + 1.5);
      var cr = fx.crackle === undefined ? 0.4 : fx.crackle, hs = fx.hiss === undefined ? 0.4 : fx.hiss;
      [0, 7.3, 11.1, 13.7].forEach(function (len) { K.loop(ac, vinylBuffer(ac, cr, hs, len), vin, ac.currentTime); });
    }

    // ---- players
    function sampleFor(bank, midi) {
      var best = bank[0];
      for (var i = 1; i < bank.length; i++) {
        var d = Math.abs(bank[i].midi - midi), b = Math.abs(best.midi - midi);
        if (d < b || (d === b && bank[i].midi > best.midi)) best = bank[i]; // ties: shift down, darker
      }
      return best;
    }
    function play(inst, midi, at, vel, len, dest, release, accent) {
      if (inst === 'piano' && accent && banks.piano2) inst = 'piano2';
      if (trace && banks[inst] && dest) trace.push({ t: at, inst: inst, midi: midi, vel: vel, len: len });
      voice(inst, midi, at, vel, len, dest, release, 1);
    }
    function voice(inst, midi, at, vel, len, dest, release, w) {
      var bank = banks[inst];
      at -= WOW_LAT;
      if (!bank || !dest || at < ac.currentTime) return;
      var s = sampleFor(bank, midi);
      var src = ac.createBufferSource(); src.buffer = s.buf;
      src.playbackRate.value = Math.pow(2, (midi - s.midi) / 12 - s.tune / 1200);
      var g = ac.createGain();
      var lv = Math.pow(vel, 1.5) * INST_GAIN[inst] * w;
      g.gain.setValueAtTime(lv, at);
      var rel = release || RELEASE[inst];
      var end = at + Math.min(len, s.buf.duration / src.playbackRate.value);
      if (len !== Infinity) { g.gain.setValueAtTime(lv, end); g.gain.setTargetAtTime(0, end, rel); }
      src.connect(g); g.connect(dest);
      src.start(at);
      src.stop(Math.min(at + s.buf.duration / src.playbackRate.value, end + rel * 7) + 0.02);
    }
    // One stretch of a bowed note: faded in (slowly at its entry, or a short
    // crossfade at a bow change), held, faded out. Long notes are a chain of
    // these, the way a player changes bow.
    function bow(midi, at, dur, fin, fout, vel, skip) {
      var bank = banks[spec.pad.inst];
      if (!bank || !padIn) return;
      if (trace) trace.push({ t: at, inst: spec.pad.inst, midi: midi, vel: vel, len: dur });
      at -= WOW_LAT;
      if (at < ac.currentTime) return;
      var s = sampleFor(bank, midi), rate = Math.pow(2, (midi - s.midi) / 12 - s.tune / 1200);
      var avail = (s.buf.duration - skip - 0.6) / rate; // the recording's own fade-out is not used
      var hold = Math.max(0.2, Math.min(dur, avail) - fout);
      var src = ac.createBufferSource(); src.buffer = s.buf; src.playbackRate.value = rate;
      var g = ac.createGain(), lv = Math.pow(vel, 1.5) * INST_GAIN[spec.pad.inst];
      g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(lv, at + fin);
      g.gain.setValueAtTime(lv, at + Math.max(fin, hold)); g.gain.linearRampToValueAtTime(0, at + Math.max(fin, hold) + fout);
      src.connect(g); g.connect(padIn);
      src.start(at, skip); src.stop(at + Math.max(fin, hold) + fout + 0.05);
    }
    var rr = {};
    var duckFree = 0;
    function hit(kind, at, vel, dur) {
      if (!drumIn || at < ac.currentTime || (mute.kinds && mute.kinds.indexOf(kind) >= 0)) return;
      var useBrush = groove && groove.brushes && banks.brushes && banks.brushes[kind];
      var list = useBrush ? banks.brushes[kind] : banks.drums && banks.drums[kind];
      if (!list || !list.length) return;
      if (trace) trace.push({ t: at, inst: kind, vel: vel });
      rr[kind] = ((rr[kind] || 0) + 1 + Math.floor(rnd() * (list.length - 1))) % list.length; // never the same take twice
      var buf = list[rr[kind]];
      var src = ac.createBufferSource(); src.buffer = buf;
      var gain = Math.pow(vel, 1.4) * (useBrush ? BRUSH_GAIN[kind] : DRUM_GAIN[kind]) * (kind === 'tap' && spec.drums.snare === 'rim' ? 0.8 : 1);
      var g = ac.createGain();
      var dest = kind === 'hat' || kind === 'shaker' || kind === 'pedal' || kind === 'bhat' ? hatPan : kind === 'ride' ? ridePan : drumIn;
      if (kind === 'stir' || kind === 'swish') { // a circle of the brush: rises, then falls away
        // not the same circle every time: placed 30-60 ms early or late (the backbeat
        // taps stay put), its rise and length varied, now and then a short fast stir
        // instead, or two soft taps where the circle would be
        if (kind === 'stir' && useBrush && rnd() < 0.12) { hit('ghost', at + beat * 0.5, vel * 0.55); hit('ghost', at + beat * 1.25, vel * 0.45); return; }
        if (kind === 'stir' && useBrush && banks.brushes.swish && rnd() < 0.25) { // a buffer can be set only once: a new source
          buf = pick(rnd, banks.brushes.swish); gain *= BRUSH_GAIN.swish / BRUSH_GAIN.stir;
          src = ac.createBufferSource(); src.buffer = buf;
        }
        at = Math.max(ac.currentTime + 0.01, at + (rnd() < 0.5 ? -1 : 1) * (0.03 + rnd() * 0.03));
        var len = Math.max(0.3, (dur || 1) * beat * (0.85 + rnd() * 0.3)), rise = 0.3 + rnd() * 0.25;
        var off = rnd() * Math.max(0, buf.duration - len - 0.7);
        g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(gain, at + len * rise); g.gain.linearRampToValueAtTime(0, at + len);
        src.connect(g); g.connect(dest); src.start(at, off); src.stop(at + len + 0.02);
        return;
      }
      src.playbackRate.value = 1 + (rnd() - 0.5) * 0.02;
      g.gain.setValueAtTime(gain, at);
      if (kind === 'kick') { g.gain.setValueAtTime(gain, at + 0.16); g.gain.setTargetAtTime(0, at + 0.16, 0.06); } // a shorter, rounder kick
      src.connect(g); g.connect(dest);
      src.start(at);
      if (kind === 'kick') src.stop(at + 0.6);
      var dd = fx.duck === undefined ? 0.1 : fx.duck;
      if (kind === 'kick' && dd > 0 && at >= duckFree) { // side-chain: about a decibel, back in 150 ms
        // straight ramps that end: a finished automation costs nothing, a
        // setTargetAtTime on this long-lived gain would be computed for every sample after
        duck.gain.setValueAtTime(1, at);
        duck.gain.linearRampToValueAtTime(1 - dd * vel, at + 0.015);
        duck.gain.linearRampToValueAtTime(1, at + 0.165);
        duckFree = at + 0.165;
      }
    }
    var drift = 0; // the band's shared push and pull, a few ms, changing each phrase
    function when(barStart, step, who) {
      var f = L.FEEL[who] || [0, 5];
      return barStart + L.swingStep(step, spec.swing, spec.swing8) * six + f[0] / 1000 + L.jitter(rnd, f[1]) + drift;
    }

    // ---- composing the break
    var plan, home, colours, alt, theme, themeChords, groove, figure, tonic, finalCh, cadenceCh, P;
    function compose(length) {
      var pi = spec.progs.length > 1 && rnd() < 0.25 ? 1 : 0;
      var ai = spec.progs.length > 1 ? (pi === 0 ? 1 + Math.floor(rnd() * (spec.progs.length - 1)) : 0) : pi;
      var amount = (spec.vary === undefined ? 0.35 : spec.vary) * 0.6;
      function coloured(str) {
        return L.parseProg(str, keyPc, meter).map(function (bar) {
          return bar.map(function (sl) { return { chord: L.vary(sl.chord, rnd, amount, spec.variants), at: sl.at, beats: sl.beats }; });
        });
      }
      home = coloured(spec.progs[pi]);
      colours = home.map(function (bar) { return bar.map(function (sl) { return { chord: sl.chord, at: sl.at, beats: sl.beats }; }); });
      alt = coloured(spec.progs[ai]);
      P = home.length;
      finalCh = L.finalChord(spec); cadenceCh = L.cadenceChord(spec);
      tonic = home[0][0].chord.root === keyPc ? home[0][0].chord : finalCh;
      theme = spec.lead ? L.theme(spec, home, scale, rnd) : null;
      themeChords = home.map(function (bar) { return bar.map(function (sl) { return sl.chord.root + sl.chord.q; }).join(); });
      groove = spec.drums ? L.groove(spec.drums, meter, rnd) : null;
      figure = spec.bass ? L.bassFigure(spec.bass.style, meter, rnd) : null;
      plan = L.arrange(spec, length, barLen0, rnd, opts.fade);
      if (trace) trace.push({ t: barT, compose: true, prog: spec.progs[pi], alt: spec.progs[ai], count: plan.count, intro: plan.intro, nf: plan.nf });
    }
    function chordsFor(b) {
      if (b.pi === -2) return [{ chord: finalCh, at: 0, beats: meter }];
      if (b.pi === -1) return [{ chord: tonic, at: 0, beats: meter }];
      var src = b.alt ? alt : b.sec === 'outro' ? home : colours;
      var sl = src[b.pi % src.length];
      if (b.cadence && sl.length === 1 && sl[0].chord.root === keyPc) return [{ chord: cadenceCh, at: 0, beats: meter }];
      return sl;
    }

    var voicing = null, bassPrev = null, padOn = false, pushed = null;
    var keysStyle = spec.keys ? spec.keys.style : null;
    // A chord's notes, together but not as a machine: mostly near-together,
    // sometimes the top note first, now and then a slow spread.
    function rollOffsets(n, slow) {
      var r = rnd(), o = [];
      for (var i = 0; i < n; i++) o.push(0);
      if (slow) { for (i = 0; i < n; i++) o[i] = i * (0.03 + rnd() * 0.025); return o; }
      if (r < 0.55) { for (i = 0; i < n; i++) o[i] = rnd() * 0.006; }
      else if (r < 0.8) { for (i = 0; i < n - 1; i++) o[i] = 0.008 + rnd() * 0.008; }
      else { var spread = 0.01 + rnd() * 0.015, up = rnd() < 0.7; for (i = 0; i < n; i++) o[i] = (up ? i : n - 1 - i) * spread / Math.max(1, n - 1); }
      return o;
    }
    function chord(inst, v, at, vel, len, slow, accent) {
      var off = rollOffsets(v.length, slow);
      v.forEach(function (n, i) {
        var top = i === v.length - 1;
        // the inner voices let go a little before the top one
        play(inst, n, at + off[i] + L.jitter(rnd, 2), L.vel(rnd, vel + (top ? 0.05 : 0), 0.05), top ? len : len * (0.78 + rnd() * 0.14), keysIn, undefined, top && accent);
      });
    }
    function size(broad) {
      return spec.keys.size ? Math.min(5, spec.keys.size + (broad ? 1 : 0)) : L.voiceSize(spec.keys.inst, rnd, broad);
    }
    function keysBar(b, slots, nextSlots, bt) {
      if (!keysIn || b.keys === 'rest') return;
      var inst = spec.keys.inst, range = spec.keys.range;
      var mode = b.keys;
      if (mode === 'tail') { // under the bass alone: the last chord again, slowly and softly
        if (voicing) chord(inst, voicing, when(bt, 0, 'keys'), 0.3, barLen + 0.4, true);
        return;
      }
      if (b.reply && b.reply.k === 0 && reply && reply.inst === inst && mode !== 'final') {
        // the same instrument answers: the comping steps aside for that bar, to a
        // soft chord (struck again half-way on a guitar, whose notes die fast)
        voicing = L.voice(slots[0].chord, range, voicing, rnd, size(false), inst);
        chord(inst, voicing, when(bt, 0, 'keys'), 0.4 * b.dyn, barLen * 0.9);
        if (inst === 'guitar') chord(inst, voicing, when(bt, meter * 2, 'keys'), 0.34 * b.dyn, barLen * 0.45, true);
        return;
      }
      var style = mode === 'intro' ? (inst === 'guitar' ? 'arp' : 'sparse') : mode === 'hold' ? (inst === 'guitar' ? 'arp' : 'hold') : keysStyle;
      if (mode === 'final') style = 'final';
      var broad = mode === 'broad';
      var rng = broad ? [range[0] + 2, range[1] + 3] : range;
      var base = (mode === 'intro' ? 0.48 : mode === 'hold' ? 0.5 : mode === 'soft' ? 0.48 : 0.52) * b.dyn;
      slots.forEach(function (sl, si) {
        var st = bt + sl.at * beat;
        var len = sl.beats * beat;
        var isPushed = pushed && si === 0 && pushed.v;
        voicing = isPushed ? pushed.v : L.voice(sl.chord, rng, voicing, rnd, size(broad), inst);
        var v = voicing;
        if (style === 'final' || (spec.bass && b.bass === null && b.sec === 'release' && si === 0 && rnd() < 0.5)) {
          // no bass under it: the keys take the root, low and soft
          var low = L.bassNote(sl.chord.root, 40) + 12;
          if (low < v[0] - 4) v = [low].concat(v);
        }
        if (style === 'final') { chord(inst, v, when(st, 0, 'keys'), base, barLen * 2.4, true); return; }
        if (style === 'hold' || style === 'sparse') {
          // the fullest passage opens each phrase with a firm chord: its top note is an accent
          if (!isPushed) chord(inst, v, when(st, 0, 'keys'), base, len + (style === 'sparse' ? 0.4 : 0.05), style === 'sparse' && rnd() < 0.5, broad && b.i % 4 === 0 && si === 0);
          if (mode === 'main' && sl.beats >= 4 && rnd() < 0.22) { // a light restrike of the top notes, now and then
            var at2 = when(st, pick(rnd, [6, 10]), 'keys');
            v.slice(-2).forEach(function (n, i) { play(inst, n, at2 + i * 0.01, L.vel(rnd, base - 0.18, 0.05), beat * 0.9, keysIn); });
          }
        } else if (style === 'comp') {
          var stabs = pick(rnd, [[[0, 6], [10, 6]], [[0, 3], [6, 4], [10, 6]], [[0, 8], [14, 2]], [[2, 4], [8, 8]]]);
          stabs.forEach(function (sb) {
            if (sb[0] * six >= len) return;
            chord(inst, v, when(st, sb[0], 'keys'), base - (sb[0] ? 0.06 : 0), Math.min(sb[1] * six, len - sb[0] * six) * 0.9);
          });
        } else if (style === 'arp' || style === 'waltz') {
          var nsteps = Math.round(sl.beats * 4);
          if (style === 'waltz') { // oom: the low notes; pah pah: the upper ones, short, the third beat often left out
            var lo = v.slice(0, 2), hiN = v.slice(2).length ? v.slice(2) : v.slice(-1);
            chord(inst, lo, when(st, 0, 'keys'), base, len * 0.95);
            [4, 8].forEach(function (s) { if (s < nsteps && (s === 4 || rnd() < 0.55)) chord(inst, hiN, when(st, s, 'keys'), base - 0.14, beat * 0.8); });
          } else {
            var order = pick(rnd, [[0, 2, 1, 3, 2, 1], [0, 1, 2, 3, 2, 1], [0, 2, 3, 1, 2, 3], [0, 3, 1, 2, 1, 3]]);
            for (var s = 0, k = 0; s < nsteps; s += 2, k++) {
              if (k > 0 && rnd() < (mode === 'intro' ? 0.25 : mode === 'hold' ? 0.2 : 0.12)) continue;
              var n = v[order[k % order.length] % v.length];
              play(inst, n, when(st, s, 'keys'), L.vel(rnd, base - (k ? 0.08 : 0), 0.06), len - s * six + 0.4, keysIn);
            }
          }
        } else if (style === 'bossa') {
          var patt = (b.i % 2 === 0) ? [0, 3, 6, 10, 13] : [2, 6, 10, 12];
          patt.forEach(function (s) {
            if (s * six >= len) return;
            var at = when(st, s, 'keys');
            v.forEach(function (n, i) { play(inst, n, at + i * 0.006, L.vel(rnd, base - 0.05, 0.05), six * (s === 6 || s === 10 ? 3.5 : 2.5), keysIn, 0.07); });
          });
        }
      });
      pushed = null;
      // now and then the next chord comes in on the last eighth of this bar
      if (style === 'hold' && mode === 'main' && nextSlots && rnd() < 0.18) {
        var nv = L.voice(nextSlots[0].chord, rng, voicing, rnd, size(false), inst);
        chord(inst, nv, when(bt, steps - 2, 'keys'), 0.54 * b.dyn, 2 * six + nextSlots[0].beats * beat);
        pushed = { v: nv }; voicing = nv;
      }
    }
    function leadBar(b, slots, bt) {
      if (!leadIn || !b.lead || !theme) return;
      var t = L.themeVariant(theme, b.lead.v, spec, scale, home[3 % P], spec.lead.range[1]);
      var notes = t[b.lead.tb];
      var literal = !b.alt && b.pi >= 0 && b.pi % P === b.lead.tb &&
        slots.map(function (sl) { return sl.chord.root + sl.chord.q; }).join() === themeChords[b.lead.tb];
      var inst = spec.lead.inst;
      notes.forEach(function (nt) {
        if (nt.opt && rnd() < 0.22) return;
        var ch = L.chordAt(slots, Math.max(0, nt.step));
        var strong = nt.step % 4 === 0 || nt.len >= 4;
        var m = literal ? nt.midi : L.fitNote(nt.midi, ch, strong, scale);
        var at = when(bt, nt.step, 'lead');
        var vel = Math.min(0.9, nt.vel * b.dyn * 1.04);
        var len = nt.len * six * (1 + rnd() * 0.1);
        if ((inst === 'vibes' || inst === 'piano') && nt.len >= 4 && rnd() < 0.06) play(inst, m - (rnd() < 0.5 ? 1 : 2), at - 0.06, vel * 0.5, 0.07, leadIn);
        play(inst, m, at, vel, len, leadIn, undefined, nt.accent);
        if (nt.dy !== null) play(inst, literal ? nt.dy : L.fitNote(nt.dy, ch, strong), at + 0.012, vel * 0.85, len, leadIn);
      });
    }
    var replies = 0;
    function replyBar(b, slots, bt) {
      if (!replyIn || !b.reply || !theme || b.reply.k !== 0) return;
      var inst = reply.inst;
      var sh = reply.shift === undefined ? -12 : reply.shift;
      var range = reply.range || [spec.lead.range[0] + Math.min(0, sh), spec.lead.range[1] + Math.max(0, sh)];
      var notes;
      if (reply.kind === 'descend') { // a short line falling to a chord tone
        var top = L.nearestIn(range[1] - 4, L.chordTones(slots[0].chord, false));
        notes = [[4, 2, top], [6, 2, L.stepScale(top, -1, scale)], [8, 8, L.stepScale(top, -2, scale)]];
      } else {
        // not the same echo every time: every other answer quotes the theme's
        // answer instead of its head, and sits an octave higher where it fits
        var alt = replies % 2 === 1;
        var src = alt && theme[2].length ? theme[2] : theme[0].length ? theme[0] : theme[1];
        var head = src.filter(function (h) { return h.step >= 0; }).slice(0, 3);
        notes = head.map(function (h) { return [h.step, h.len, h.midi + sh]; });
        var lo = Math.min.apply(null, notes.map(function (n) { return n[2]; })), hi = Math.max.apply(null, notes.map(function (n) { return n[2]; }));
        if (lo < range[0] || (alt && hi + 12 <= range[1])) notes.forEach(function (n) { n[2] += 12; });
      }
      replies += 1;
      var barEnd = bt + barLen;
      notes.forEach(function (n, i) {
        var ch = L.chordAt(slots, n[0]);
        var m = L.fitNote(n[2], ch, n[0] % 4 === 0 || n[1] >= 4, scale);
        var at = when(bt, n[0], 'lead') + 0.01;
        var vel = (i === 0 ? 0.52 : 0.46) * b.dyn * (b.reply.soft ? 0.8 : 1);
        var len = Math.max(0.1, Math.min(n[1] * six * 1.1, barEnd - at)); // the answer ends with its bar: the bars after it stay empty
        play(inst, m, at, vel, len, replyIn);
        if (reply.harm) play(inst, L.fitNote(L.stepScale(m, -2, scale), ch, false), at + 0.015, vel * 0.8, len, replyIn);
      });
    }
    // A bowed run: one bow per one or two bars where the recording is long
    // enough (the bowed vibraphone, the cello at quicker tempos), otherwise
    // two per bar; bow changes are 0.8 s crossfades, nothing loops.
    var padNext = 0;
    function padBar(b, bt, idx) {
      if (!padIn) return;
      if (!b.pad) { padOn = false; padNext = 0; return; }
      if (padOn && bt < padNext - 0.05) return; // the last bow is still sounding
      var range = spec.pad.range || (spec.pad.inst === 'cello' ? [38, 55] : [57, 72]);
      var root = range[0] + mod(keyPc - range[0], 12);
      var pitches = spec.pad.fifth ? [root, root + 7] : [root];
      var run = 0;
      for (var k = idx; k < plan.bars.length && plan.bars[k].pad; k++) run += 1;
      var s0 = sampleFor(banks[spec.pad.inst] || [{ midi: root, tune: 0, buf: { duration: 0 } }], root);
      var avail = (s0.buf.duration - 0.85) / Math.pow(2, (root - s0.midi) / 12), xf = 0.8;
      var fits = Math.floor((avail - xf) / barLen);
      var span = fits >= 1 ? Math.min(run, fits >= 2 && rnd() < 0.5 ? 2 : 1) : 0.5;
      var final = b.pi === -2;
      var vel = 0.5 * b.dyn;
      var per = span < 1 ? 2 : 1, seg = span < 1 ? barLen / 2 : span * barLen;
      for (var j = 0; j < per; j++) {
        var first = !padOn && j === 0, lastSeg = j === per - 1 && (span >= run || final);
        var st = bt + j * seg;
        var fin = first ? 1.2 : xf, fout = lastSeg ? (final ? 3.5 : 2.0) : xf;
        var start = first ? st : st - xf / 2;
        var dur = (st + seg - start) + (lastSeg ? (final ? barLen : 0.6) : xf / 2);
        pitches.forEach(function (p, i) { bow(p, start + i * 0.05, dur, fin, fout, vel * (i ? 0.8 : 1), first ? 0 : 0.25); });
        padOn = true;
      }
      padNext = bt + (span < 1 ? barLen : seg);
    }
    function bassBar(b, slots, nextSlots, bt) {
      if (!bassIn || !b.bass) return;
      var mode = b.bass;
      if (spec.bass.style === 'long' && (mode === 'main' || mode === 'walk')) mode = 'simple';
      var notes = L.bassBar({ meter: meter, slots: slots, nextRoot: nextSlots ? nextSlots[0].chord.root : null, prev: bassPrev,
        rnd: rnd, mode: mode, cell: figure[gi % 4], approach: b.approach, pedal: spec.bass.style === 'pedal' ? keyPc : undefined });
      notes.forEach(function (n) {
        play('bass', n.midi, when(bt, n.step, 'bass'), n.vel * (0.94 + 0.06 * b.dyn), n.len * six * 0.96, bassIn);
        bassPrev = n.midi;
      });
    }
    function drumBar(b, bt) {
      if (!drumIn || !groove || !b.drums) return;
      var hits = L.grooveBar(groove, gi, b.drums, rnd);
      if (b.noKick) hits = hits.filter(function (h) { return h.kind !== 'kick'; });
      if (b.fill) hits = L.fill(hits, b.fill, meter, groove.brushes, rnd);
      hits.forEach(function (h) { hit(h.kind, when(bt, h.step, h.kind), h.vel * (0.96 + 0.04 * b.dyn), h.dur); });
    }

    var barT = t0, bi = 0, gi = 0, rest = 0;
    compose((opts.length || 240) - (t0 - ac.currentTime)); // the plan counts from t0, the length from now
    function playBar() {
      if (bi >= plan.bars.length) {
        // past the last chord (the fade should have come by now): a few bars
        // of nothing, then a new performance, as if the record turned over
        rest += 1; barT += barLen0;
        if (rest >= 4) { rest = 0; bi = 0; voicing = null; padOn = false; compose(240); }
        return;
      }
      var b = plan.bars[bi], next = plan.bars[bi + 1];
      var stretch = b.stretch || 1;
      beat = beat0 * stretch; six = six0 * stretch; barLen = barLen0 * stretch;
      if (b.i === 0 && b.sec !== 'final') drift = clamp(drift + (rnd() - 0.5) * 0.006, -0.006, 0.006) + (b.sec === 'release' ? 0.003 : 0);
      else if (b.i % 4 === 0) drift = clamp(drift + (rnd() - 0.5) * 0.004, -0.006, 0.008);
      if (b.recolour) { // one chord of the home progression changes colour
        var k = Math.floor(rnd() * P), sl0 = colours[k][0];
        sl0.chord = L.vary(home[k][0].chord, rnd, 1, spec.variants);
      }
      var slots = chordsFor(b);
      var nextSlots = next ? chordsFor(next) : null;
      if (trace) trace.push({ t: barT, bar: true, sec: b.sec, i: b.i, pi: b.pi, drums: b.drums, bass: b.bass, keys: b.keys, stretch: stretch,
        lead: b.lead ? b.lead.tb + b.lead.v : null, reply: !!b.reply, pad: b.pad, fill: b.fill, chords: slots.map(function (sl) { return sl.chord.root + ':' + sl.chord.q; }) });
      keysBar(b, slots, nextSlots, barT);
      bassBar(b, slots, nextSlots, barT);
      drumBar(b, barT);
      leadBar(b, slots, barT);
      replyBar(b, slots, barT);
      padBar(b, barT, bi);
      bi += 1; gi += 1;
      barT += barLen;
    }

    return function schedule(until) {
      while (barT < until) playBar();
    };
  };
})();
