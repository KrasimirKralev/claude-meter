// node --test test/relax-lofi.test.js - the lo-fi engine's theory, the pocket,
// the theme and the arrangement (relax-biomes/_lofi.js, top half), the 15
// tracks' specs and the loudness meter.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const L = require('../relax-biomes/_lofi.js');

const DIR = path.join(__dirname, '..', 'relax-biomes');
const mod = (n, m) => ((n % m) + m) % m;

// Every biome's registration, read in a sandbox (scenes and sounds are not run).
function biomeSpecs() {
  const out = {};
  for (const f of fs.readdirSync(DIR)) {
    if (!f.endsWith('.js') || f.startsWith('_') || f === 'index.js') continue;
    const ctx = { window: { RelaxKit: {} }, RelaxBiomes: { register: (b) => { out[b.id] = b; } } };
    vm.runInNewContext(fs.readFileSync(path.join(DIR, f), 'utf-8'), ctx);
  }
  return out;
}

test('chord symbols: numerals, accidentals and qualities', () => {
  const C = L.keyPc('C');
  assert.deepStrictEqual(L.parseChord('bVIImaj7', C), { root: 10, q: 'maj7', sym: 'bVIImaj7' });
  assert.strictEqual(L.parseChord('iiø7', C).q, 'm7b5');
  assert.strictEqual(L.parseChord('vi9', L.keyPc('Eb')).root, 0); // C minor in E-flat
  assert.strictEqual(L.parseChord('V13sus', L.keyPc('D')).root, 9);
  assert.strictEqual(L.parseChord('iv', C).q, 'min');
  assert.throws(() => L.parseChord('VIII7', C));
  assert.throws(() => L.parseChord('Imaj8', C));
  assert.throws(() => L.keyPc('H'));
  const bars = L.parseProg('Imaj9 ii9,V7b9', C, 4);
  assert.strictEqual(bars.length, 2);
  assert.deepStrictEqual(bars[1].map((s) => [s.at, s.beats, s.chord.q]), [[0, 2, 'm9'], [2, 2, '7b9']]);
});

test('voicings: in range, keep the guide tones, not muddy, and move smoothly', () => {
  const rnd = L.rng(7);
  const keys = ['C', 'Eb', 'F#', 'A', 'Bb'];
  const progs = ['Imaj9 vi9 ii9 V13sus', 'ii9 V7b9 Imaj9 VI7b9', 'iiø7 V7b9 i9 iv9', 'Imaj7#11 II vi9 iii7'];
  let moves = 0, count = 0;
  for (let round = 0; round < 40; round++) {
    const k = L.keyPc(keys[round % keys.length]);
    let prev = null;
    for (const bar of L.parseProg(progs[round % progs.length], k, 4)) {
      const ch = L.vary(bar[0].chord, rnd, 0.4);
      const v = L.voice(ch, [50, 74], prev, rnd);
      assert.ok(v.length >= 2 && v.length <= 5, 'size ' + v.length);
      assert.ok(v[0] >= 50 && v[v.length - 1] <= 74, 'range ' + v);
      for (let i = 1; i < v.length; i++) assert.ok(v[i] > v[i - 1], 'sorted, no doubled notes ' + v);
      const pcs = v.map((n) => mod(n - ch.root, 12));
      for (const g of L.QUAL[ch.q].g) assert.ok(pcs.includes(g % 12), ch.sym + ' ' + ch.q + ' keeps its guide tone ' + g + ': ' + v);
      for (let i = 1; i < v.length; i++) if (v[i - 1] < 52) assert.ok(v[i] - v[i - 1] >= 3, 'muddy low cluster ' + v);
      if (prev) {
        let m = 0;
        for (const n of v) m += Math.min(...prev.map((p) => Math.abs(n - p)));
        moves += m / v.length; count += 1;
      }
      prev = v;
    }
  }
  assert.ok(moves / count < 3.5, 'voices move ' + (moves / count).toFixed(2) + ' semitones on average');
});

test('chords are re-coloured now and then, never re-rooted, and a biome can limit it', () => {
  const rnd = L.rng(3);
  const ch = L.parseChord('ii9', L.keyPc('C'));
  const seen = new Set();
  for (let i = 0; i < 300; i++) {
    const v = L.vary(ch, rnd, 0.5);
    assert.strictEqual(v.root, ch.root);
    seen.add(v.q);
  }
  assert.ok(seen.size >= 3, [...seen].join(','));
  for (let i = 0; i < 100; i++) assert.strictEqual(L.vary(L.parseChord('i7', 4), rnd, 1, { m7: ['m11'] }).q, 'm11');
  assert.strictEqual(L.vary(ch, () => 0.99, 0.3), ch); // most of the time it stays
});

test('swing moves only the off-beats, monotonically, within bounds', () => {
  for (let s = 0; s <= 16; s++) assert.strictEqual(L.swingStep(s, 0.5, false), s); // straight
  assert.ok(Math.abs(L.swingStep(1, 0.6, false) - 1.2) < 1e-9);   // the 16th after the beat lands late
  assert.strictEqual(L.swingStep(2, 0.6, false), 2);               // eighths stay put
  assert.ok(Math.abs(L.swingStep(2, 0.6, true) - 2.4) < 1e-9);    // swung eighths
  assert.strictEqual(L.swingStep(4, 0.66, true), 4);
  assert.ok(Math.abs(L.swingStep(1, 0.9, false) - 1.5) < 1e-9);   // clamped to 0.75
  let last = -1;
  for (let x = 0; x < 16; x += 0.05) { const y = L.swingStep(x, 0.62, true); assert.ok(y >= last); last = y; }
});

test('humanising stays within its bounds, and the band is tight', () => {
  const rnd = L.rng(99);
  let lo = 0, hi = 0;
  for (let i = 0; i < 20000; i++) {
    const j = L.jitter(rnd, 12);
    assert.ok(Math.abs(j) <= 0.012 + 1e-12);
    lo = Math.min(lo, j); hi = Math.max(hi, j);
    const v = L.vel(rnd, 0.5, 0.2);
    assert.ok(v >= 0.3 - 1e-9 && v <= 0.7 + 1e-9);
    assert.ok(L.vel(rnd, 0.05, 0.2) >= 0.03 && L.vel(rnd, 0.95, 0.2) <= 1);
  }
  assert.ok(lo < -0.009 && hi > 0.009, 'it does move');
  for (const [late, loose] of Object.values(L.FEEL)) assert.ok(late >= 0 && late <= 25 && loose >= 0 && loose <= 10);
  assert.ok(L.FEEL.kick[1] <= 5, 'the kick is on it');
  for (const k of ['snare', 'rim']) assert.ok(L.FEEL[k][0] >= 10 && L.FEEL[k][0] <= 18 && L.FEEL[k][1] <= 5, 'a steady backbeat drag');
});

test('voicings per instrument: vibraphone two or three notes, guitar one note per string', () => {
  const rnd = L.rng(13);
  const C = L.keyPc('C');
  for (let i = 0; i < 200; i++) {
    const ch = L.parseChord(L.pick(rnd, ['Imaj9', 'ii9', 'V13sus', 'vi9']), C);
    const vb = L.voice(ch, [57, 79], null, rnd, L.voiceSize('vibes', rnd), 'vibes');
    assert.ok(vb.length >= 2 && vb.length <= 3, 'vibes ' + vb);
    const g = L.voice(ch, [52, 76], null, rnd, 4, 'guitar');
    for (let k = 1; k < g.length; k++) assert.ok(g[k] - g[k - 1] >= 2, 'guitar shape ' + g);
  }
});

test('drums: a two-bar pocket, kept 80-90 %, ghosts well under the backbeat, small fills', () => {
  const rnd = L.rng(5);
  const styles = ['boom', 'brush', 'half', 'bossa', 'waltz', 'sparse'];
  for (const style of styles) {
    for (const kit of [undefined, 'brushes']) {
      const meter = style === 'waltz' ? 3 : 4;
      const tpl = L.groove({ style, snare: 'rim', hat: 'hat', kit }, meter, rnd);
      assert.strictEqual(tpl.length, 2);
      for (const bar of tpl) {
        assert.ok(bar.some((h) => h.kind === 'kick' && h.step === 0 && !h.opt && h.lvl === 1), style + ' kick on one, always');
        for (const h of bar) assert.ok(h.step >= 0 && h.step < meter * 4 && h.vel > 0 && h.vel <= 1, style + ' inside the bar');
      }
      if (style === 'boom') {
        const sn = kit ? 'snare' : 'rim';
        for (const bar of tpl) assert.ok([4, 12].every((s) => bar.some((h) => h.kind === sn && h.step === s && !h.opt)), 'backbeat');
        const back = tpl[0].find((h) => h.kind === sn).vel;
        for (const g of tpl.flat().filter((h) => h.kind === 'tap')) {
          const db = 20 * Math.log10(Math.pow(g.vel / back, 1.4));
          assert.ok(db <= -12 && db >= -20, 'ghost ' + db.toFixed(1) + ' dB under the backbeat');
        }
      }
      if (style === 'brush' || kit) assert.ok(tpl.flat().some((h) => h.kind === 'stir') || style === 'bossa', style + ' brushes stir');
      // how much of the pocket comes round again, bar after bar, at the groove level
      let kept = 0, total = 0;
      for (let b = 0; b < 400; b++) {
        const inBar = tpl[b % 2].filter((h) => h.lvl <= 2).length;
        kept += L.grooveBar(tpl, b, 2, rnd).length; total += inBar;
      }
      assert.ok(kept / total >= 0.78 && kept / total <= 0.97, style + ' keeps ' + (kept / total).toFixed(2));
      assert.ok(L.grooveBar(tpl, 0, 1, rnd).length <= L.grooveBar(tpl, 0, 3, rnd).length + 2, 'a thin bar is thinner');
    }
  }
  const hits = L.grooveBar(L.groove({ style: 'boom', snare: 'rim', hat: 'hat' }, 4, rnd), 0, 2, rnd);
  assert.ok(L.fill(hits, 'stop', 4, false, rnd).every((h) => h.step < 13 || h.kind === 'tap'), 'a stop leaves the last beat empty');
  const pickup = L.fill(hits, 'pickup', 4, false, rnd);
  assert.strictEqual(pickup.length, hits.length + 2);
  assert.ok(pickup.slice(-2).every((h) => h.step >= 12 && h.step < 16 && h.vel < 0.35), 'two soft taps at the end');
});

test('bass: root on one, mostly A1-C3, a four-bar figure, approaches only when asked and softer', () => {
  const rnd = L.rng(11);
  const keyPc = L.keyPc('Eb');
  const bars = L.parseProg('Imaj9 vi9 ii9 V13sus ii9,V7b9', keyPc, 4);
  for (const style of ['lofi', 'bossa', 'long', 'waltz']) {
    const meter = style === 'waltz' ? 3 : 4;
    const fig = L.bassFigure(style, meter, rnd);
    assert.strictEqual(fig.length, 4);
    let prev = null, low = 0, all = 0;
    for (let i = 0; i < 200; i++) {
      const slots = L.parseProg(['Imaj9', 'vi9', 'ii9', 'V13sus'][i % 4], keyPc, meter)[0];
      const next = bars[(i + 1) % 4][0].chord.root;
      for (const mode of ['main', 'simple', 'walk', 'alone']) {
        const approach = mode === 'main' && i % 4 === 1;
        const notes = L.bassBar({ meter, slots, nextRoot: next, prev, rnd, mode, cell: fig[i % 4], approach });
        assert.strictEqual(notes[0].step, 0);
        assert.strictEqual(mod(notes[0].midi, 12), slots[0].chord.root, 'root on one');
        for (const n of notes) {
          assert.ok(n.midi >= 28 && n.midi <= 52, 'range ' + n.midi);
          assert.ok(n.len > 0 && n.step + n.len <= meter * 4 + 1e-9, 'inside the bar');
          all += 1; if (n.midi >= 33 && n.midi <= 48) low += 1;
        }
        const last = notes[notes.length - 1];
        if (approach && style === 'lofi') {
          assert.strictEqual(last.step, meter * 4 - 2, 'the approach on the last eighth');
          assert.ok(last.vel < notes[0].vel, 'softer than the downbeat');
        }
        if (!approach && mode === 'simple') assert.strictEqual(notes.length, 1);
        prev = last.midi;
      }
    }
    assert.ok(low / all > 0.8, style + ' mostly A1-C3: ' + (low / all).toFixed(2));
  }
  const ped = L.bassBar({ meter: 4, slots: bars[1], nextRoot: 0, prev: null, rnd, mode: 'main', cell: [[0, 14, 'R']], pedal: 4 });
  assert.strictEqual(mod(ped[0].midi, 12), 4, 'a pedal stays on its note');
});

test('theme: a four-bar tune composed once - motif, answer, a stable landing - inside a sixth or so', () => {
  const rnd = L.rng(21);
  const specs = [
    { key: 'D', mode: 'major', progs: ['Imaj9 vi9 ii9 V13sus'], lead: { range: [64, 84], motif: '4.2.3 6.2.2 8.8.1 |' } },
    { key: 'B', mode: 'minor', progs: ['i9 iv9 bVII13 bIIImaj7'], lead: { range: [66, 86] } },
    { key: 'Db', mode: 'lydian', progs: ['Imaj7#11 II Imaj7#11 II'], lead: { range: [58, 82], motif: '0.6.3+5 8.6.5+7 | 0.6.4+6 8.8.2+4' } },
    { key: 'Ab', mode: 'major', meter: 3, progs: ['Imaj7 vi7 ii7 V7sus'], lead: { range: [65, 86] } },
  ];
  for (let i = 0; i < 200; i++) {
    const spec = specs[i % specs.length];
    const meter = spec.meter || 4, keyPc = L.keyPc(spec.key), scale = L.scale(spec);
    const bars = L.parseProg(spec.progs[0], keyPc, meter);
    const th = L.theme(spec, bars, scale, rnd);
    assert.strictEqual(th.length, 4);
    const notes = th.flat();
    assert.ok(notes.length >= 3 && notes.length <= 10, 'principal notes ' + notes.length);
    const pitches = notes.map((n) => n.midi);
    assert.ok(Math.max(...pitches) - Math.min(...pitches) <= 12, 'span ' + (Math.max(...pitches) - Math.min(...pitches)));
    for (const n of notes) assert.ok(n.step >= -2 && n.step < meter * 4 && n.step + n.len <= meter * 4 + 1e-9, 'inside its bar');
    for (const b of [2, 3]) for (const n of th[b]) {
      if (n.step % 4 !== 0 && n.len < 4) continue;
      const ch = L.chordAt(bars[b], Math.max(0, n.step)), pc = mod(n.midi, 12);
      const ok = L.chordTones(ch, true).includes(pc) || (scale.includes(pc) && !L.chordTones(ch, false).includes(mod(pc - 1, 12)));
      assert.ok(ok, 'answer on chord tones, tensions or safe scale notes');
    }
    const landing = th[3][th[3].length - 1];
    const t3 = L.chordTones(L.chordAt(bars[3], landing.step), false);
    assert.ok([t3[0], t3[1], t3[2]].includes(mod(landing.midi, 12)), 'lands on a root, third or fifth');
    const fin = L.themeVariant(th, 'final', spec, scale, bars[3], spec.lead.range[1]);
    const fl = fin[3][fin[3].length - 1];
    assert.ok(mod(fl.midi, 12) === scale[0] || t3.includes(mod(fl.midi, 12)), 'the last answer lands home');
    const oct = L.themeVariant(th, 'octave', spec, scale, bars[3], spec.lead.range[1]);
    assert.ok(oct[0].concat(oct[1]).every((n, k) => n.midi - th[0].concat(th[1])[k].midi === 12 || n.midi === th[0].concat(th[1])[k].midi));
  }
  // a motif is kept literally
  const d = specs[0], th = L.theme(d, L.parseProg(d.progs[0], L.keyPc('D'), 4), L.scale(d), rnd);
  assert.deepStrictEqual(th[0].map((n) => [n.step, n.midi]), [[4, 78], [6, 76], [8, 74]]);
  assert.deepStrictEqual(L.parseMotif('0.6.3+5 8.4.2? | 2.12.1')[0][1], { step: 8, len: 4, deg: 2, deg2: null, opt: true });
  assert.throws(() => L.parseMotif('0.6'));
});

test('arrangement: one arc that lands on a settled last chord before the fade', () => {
  const full = { key: 'D', mode: 'major', bpm: 72, progs: ['Imaj9 vi9 ii9 V13sus', 'Imaj9 iii7 vi9 V9sus'], keys: {}, lead: { range: [64, 84] },
    bass: { style: 'lofi' }, drums: { style: 'boom' }, pad: { inst: 'cello' } };
  const quiet = { key: 'A', mode: 'minor', bpm: 58, progs: ['i9 bVImaj7 iv9 v7'], keys: {}, lead: { range: [64, 86] }, bass: null, drums: null };
  const order = ['intro', 'settle', 'lift', 'release', 'return', 'thin', 'outro', 'final'];
  for (const spec of [full, quiet]) {
    for (const [bpm, meter] of [[58, 4], [64, 4], [72, 4], [84, 3]]) {
      for (const secs of [240, 239, 180, 60, 30, 12, 5]) {
        const barLen = 60 / bpm * meter;
        const a = L.arrange(Object.assign({}, spec, { bpm, meter }), secs, barLen, L.rng(secs + bpm));
        const bars = a.bars;
        const last = bars[bars.length - 1];
        assert.strictEqual(last.sec, 'final'); assert.strictEqual(last.pi, -2);
        // a break that starts late (only seconds left) still gets a short, whole plan
        if (secs < 30) { assert.ok(bars.length <= 4 && bars[0].sec === 'intro'); continue; }
        // the last chord 10-12 s before the 3 s fade has finished, whatever the tempo; nothing new in the last 25 s
        const end = secs + 3, before = end - last.t;
        assert.ok(before >= 10 - 1e-9 && before <= 12 + 1e-9, bpm + ' bpm, ' + secs + ' s: last chord ' + before.toFixed(2) + ' s before the end');
        assert.ok(bars.every((b) => !(b.stretch > 1.25)), 'only a gentle ritardando');
        for (const b of bars) if (b.lead || (b.reply && b.reply.k === 0)) assert.ok(b.t < end - 25 || (b.lead && bars[bars.indexOf(b) - 1].lead), 'no new phrase in the last 25 s');
        if (secs >= 180) { const o = bars.filter((b) => b.sec === 'outro').length * barLen; assert.ok(o >= 8 && o <= 18, 'outro ' + o.toFixed(1) + ' s'); }
        let k = -1;
        for (const b of bars) { const j = order.indexOf(b.sec); assert.ok(j >= k, 'sections in order'); k = j; }
        assert.strictEqual(bars[0].sec, 'intro');
        for (const b of bars) {
          if (b.sec === 'intro') assert.ok(!b.drums && !b.lead, 'keys alone first');
          if (b.sec === 'outro' || b.sec === 'final') assert.ok(!b.lead && !b.fill && (!b.drums || (b.drums === 1 && b.noKick)) && !(b.sec === 'final' && b.drums), 'no new phrases at the end');
          if (!spec.drums) assert.ok(!b.drums && !b.fill);
          if (!spec.bass) assert.strictEqual(b.bass, null);
        }
        if (secs < 180) continue;
        // breathing: drums and bass out for part of the release, a bar of just bass
        const rel = bars.filter((b) => b.sec === 'release');
        assert.ok(rel.some((b) => !b.drums && !b.bass), 'a release without drums and bass');
        if (spec.bass) assert.ok(rel.some((b) => b.bass === 'alone' && !b.drums), 'a bar of just bass');
        if (spec.progs.length > 1) assert.ok(rel.every((b) => b.alt), 'the second progression in the middle');
        // the theme: whole four-bar statements with at least two empty bars between them
        let run = 0, gap = 99;
        for (const b of bars) {
          if (b.lead) { if (run === 0 && b.lead.tb === 0) assert.ok(gap >= 2, 'rest between statements: ' + gap); run += 1; gap = 0; } else { run = 0; gap += 1; }
        }
        assert.ok(bars.some((b) => b.lead && b.lead.v !== 'lit'), 'it comes back varied');
        // fills are rare
        const fills = bars.filter((b) => b.fill).length;
        assert.ok(fills <= Math.ceil(bars.length / 8), 'fills ' + fills + ' in ' + bars.length + ' bars');
        // the bar of bass alone has the last chord under it, softly
        if (spec.bass) assert.ok(rel.some((b) => b.bass === 'alone' && b.keys === 'tail'));
        // the drums build and fall
        const lv = (s) => Math.max(...bars.filter((b) => b.sec === s).map((b) => b.drums));
        if (spec.drums) assert.ok(lv('lift') > lv('settle') - 1 && lv('lift') >= lv('return') && lv('return') > lv('thin'));
      }
    }
  }
});

test('arrangement: a six-bar phrase with two bars of rest, and real silence after later statements', () => {
  const base = { key: 'Ab', mode: 'major', bpm: 84, meter: 3, progs: ['Imaj7 vi7 ii7 V7sus', 'Imaj9 IVmaj7 ii9 V9sus'], keys: {},
    bass: { style: 'waltz' }, drums: { style: 'waltz' } };
  const six = L.arrange(Object.assign({}, base, { lead: { range: [65, 86], phrase: 6 } }), 240, 60 / 84 * 3, L.rng(4));
  for (const sec of ['lift', 'return']) {
    const bars = six.bars.filter((b) => b.sec === sec);
    for (let u = 0; u + 8 <= bars.length; u += 8) {
      const run = bars.slice(u, u + 8).map((b) => (b.lead ? 1 : 0)).join('');
      assert.strictEqual(run, '11111100', sec + ' unit ' + u);
      assert.ok(bars.slice(u, u + 8).every((b) => !b.reply), 'no reply in the six-bar phrase scenes');
    }
  }
  const spaced = L.arrange({ key: 'G', mode: 'major', bpm: 66, progs: ['Imaj9 iii7 IVmaj9 Imaj9'], keys: {}, lead: { range: [62, 83], space: true },
    bass: { style: 'lofi' }, drums: { style: 'sparse' } }, 240, 60 / 66 * 4, L.rng(4));
  for (const sec of ['lift', 'return']) {
    const bars = spaced.bars.filter((b) => b.sec === sec);
    assert.ok(bars.slice(8).every((b) => !b.reply), sec + ': after the first statement, the gaps stay empty');
  }
});

test('the 15 tracks: valid specs, real instruments, each its own key, tempo and feel', () => {
  const specs = biomeSpecs();
  assert.strictEqual(Object.keys(specs).length, 15);
  const samples = new Set(fs.readdirSync(path.join(DIR, 'samples')).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3)));
  const signatures = new Set();
  for (const [id, b] of Object.entries(specs)) {
    const s = b.lofi;
    assert.ok(s, id + ' has a lofi track');
    assert.strictEqual(typeof b.ambience, 'function', id + ' keeps its ambience');
    assert.ok(b.level > 0 && b.level < 4 && b.ambienceLevel > 0, id + ' levels');
    assert.ok(L.scale(s).length === 7, id + ' mode');
    assert.ok(s.bpm >= 56 && s.bpm <= 85, id + ' tempo ' + s.bpm);
    if (s.drums) assert.ok(s.bpm >= 60, id + ' drums need 60-85 bpm');
    for (const p of s.progs) assert.ok(L.parseProg(p, L.keyPc(s.key), s.meter || 4).length >= 2, id + ' progression ' + p);
    for (const part of [s.keys, s.lead, s.reply, s.pad]) {
      if (!part) continue;
      assert.ok(samples.has(part.inst), id + ' plays a recorded ' + part.inst);
      if (part.range) assert.ok(part.range[1] - part.range[0] >= 12, id + ' range');
    }
    if (s.lead && s.lead.motif) assert.ok(L.parseMotif(s.lead.motif).length >= 1, id + ' motif');
    if (s.pad) assert.ok(['cello', 'bowed'].includes(s.pad.inst) && (s.pad.in || []).every((x) => ['intro', 'settle', 'lift', 'release', 'return', 'thin', 'outro', 'final'].includes(x)), id + ' pad');
    assert.ok(L.finalChord(s).root === L.keyPc(s.key), id + ' ends on its tonic');
    if (s.drums && s.drums.kit) assert.ok(s.drums.kit === 'brushes' && samples.has('brushes'), id + ' brushes');
    if (s.bass) assert.ok(['lofi', 'bossa', 'waltz', 'long', 'pedal'].includes(s.bass.style), id + ' bass style');
    assert.ok(s.keys, id + ' has keys');
    if (s.bass) assert.ok(samples.has('bass'));
    if (s.drums) assert.ok(samples.has('drums') && ['boom', 'brush', 'half', 'bossa', 'waltz', 'sparse'].includes(s.drums.style));
    assert.ok(s.fx && s.fx.tone >= 2500 && s.fx.tone <= 8000, id + ' rolls off');
    assert.ok(s.fx.duck === undefined || s.fx.duck <= 0.15, id + ' a light side-chain');
    const sig = [s.key, s.mode, s.bpm, s.keys.inst, s.keys.style, s.lead && s.lead.inst, s.drums && s.drums.style].join('/');
    assert.ok(!signatures.has(sig), id + ' is not a copy of another track');
    signatures.add(sig);
  }
  assert.strictEqual(specs['deep-space'].lofi.drums, null, 'deep space: no drums');
  assert.strictEqual(specs['zen-garden'].lofi.drums, null, 'zen garden: very sparse');
});

test('loudness meter (ITU-R BS.1770): a -20 dBFS 1 kHz tone reads -20 LUFS', () => {
  const ctx = { window: {}, Math, Float32Array, Float64Array };
  vm.runInNewContext(fs.readFileSync(path.join(DIR, '_kit.js'), 'utf-8'), ctx);
  const K = ctx.window.RelaxKit;
  const sr = 48000, n = sr * 5;
  const tone = new Float32Array(n);
  for (let i = 0; i < n; i++) tone[i] = 0.1 * Math.sin(2 * Math.PI * 997 * i / sr);
  const buf = (chs) => ({ sampleRate: sr, length: n, numberOfChannels: chs.length, getChannelData: (c) => chs[c] });
  assert.ok(Math.abs(K.loudness(buf([tone, tone])) - -20) < 0.15, 'stereo ' + K.loudness(buf([tone, tone])));
  assert.ok(Math.abs(K.loudness(buf([tone])) - -20) < 0.15, 'mono plays from both speakers');
  const half = tone.map((v, i) => (i < n / 2 ? v : 0));
  assert.ok(Math.abs(K.loudness(buf([half, half])) - -20) < 0.3, 'silence is gated out');
  assert.strictEqual(K.loudness(buf([new Float32Array(n), new Float32Array(n)])), -Infinity);
});
