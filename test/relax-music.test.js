// node --test test/relax-music.test.js - his own tracks from ~/Music/relax:
// which files count, when they play, and the shuffle that never repeats early.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const music = require('../relax-music');
const relax = require('../relax');

const tmpDir = (files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relax-music-'));
  for (const f of files || []) fs.writeFileSync(path.join(dir, f), 'x');
  return dir;
};
// A seeded random, so a failure can be replayed.
const rng = (seed) => { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; };

test('only audio files directly in the folder count', () => {
  const dir = tmpDir(['b.mp3', 'a.FLAC', 'c.ogg', 'd.opus', 'e.wav', 'f.m4a', 'g.oga', 'README.md', 'cover.jpg', '.hidden.mp3', 'notes.txt']);
  fs.mkdirSync(path.join(dir, 'sub.mp3'));
  assert.deepStrictEqual(music.listTracks(dir), ['a.FLAC', 'b.mp3', 'c.ogg', 'd.opus', 'e.wav', 'f.m4a', 'g.oga']);
  assert.deepStrictEqual(music.listTracks(path.join(dir, 'missing')), []);
});

test('the source: generated, or his tracks whenever there are any', () => {
  assert.strictEqual(music.chooseSource('auto', ['a.mp3']), 'folder');
  assert.strictEqual(music.chooseSource('auto', []), 'generated');
  assert.strictEqual(music.chooseSource('folder', ['a.mp3']), 'folder');
  assert.strictEqual(music.chooseSource('folder', []), 'generated'); // an empty folder never means silence
  assert.strictEqual(music.chooseSource('generated', ['a.mp3']), 'generated');
  assert.strictEqual(music.chooseSource('nonsense', ['a.mp3']), 'folder');
  assert.strictEqual(relax.normalizeConfig({}).musicSource, 'auto');
  assert.strictEqual(relax.normalizeConfig({ musicSource: 'folder' }).musicSource, 'folder');
  assert.strictEqual(relax.normalizeConfig({ musicSource: 'generated' }).musicSource, 'generated');
  assert.strictEqual(relax.normalizeConfig({ musicSource: 'spotify' }).musicSource, 'auto');
});

test('shuffle: every track once per round, and never the same one twice in a row', () => {
  const tracks = ['a.mp3', 'b.mp3', 'c.mp3', 'd.mp3', 'e.mp3'];
  for (let seed = 1; seed < 60; seed++) {
    const rnd = rng(seed);
    let state = {};
    const played = [];
    for (let i = 0; i < 40; i++) {
      const r = music.nextTrack(tracks, state, rnd);
      played.push(r.track);
      state = r.state;
    }
    for (let round = 0; round < 8; round++) {
      assert.deepStrictEqual(played.slice(round * 5, round * 5 + 5).sort(), tracks, 'round ' + round + ' plays each once');
    }
    for (let i = 1; i < played.length; i++) assert.notStrictEqual(played[i], played[i - 1], 'seed ' + seed + ' repeated at ' + i);
  }
  // the rounds are not all in the same order
  const orders = new Set();
  for (let seed = 1; seed < 30; seed++) {
    let state = {}; const o = [];
    for (let i = 0; i < 5; i++) { const r = music.nextTrack(tracks, state, rng(seed)); o.push(r.track); state = r.state; }
    orders.add(o.join());
  }
  assert.ok(orders.size > 5);
});

test('shuffle: one track, no tracks, files added and removed mid-round', () => {
  assert.strictEqual(music.nextTrack(['only.mp3'], { last: 'only.mp3', bag: [], played: ['only.mp3'] }, Math.random).track, 'only.mp3');
  assert.strictEqual(music.nextTrack([], {}, Math.random).track, null);
  const rnd = rng(9);
  let st = {};
  const first = [];
  for (let i = 0; i < 2; i++) { const r = music.nextTrack(['a', 'b', 'c', 'd'], st, rnd); first.push(r.track); st = r.state; }
  // c is deleted, e is added: the round finishes with the rest, e among them, c never
  const now = ['a', 'b', 'd', 'e'];
  const remaining = now.filter((t) => !first.includes(t));
  const rest = [];
  for (let i = 0; i < remaining.length; i++) { const r = music.nextTrack(now, st, rnd); rest.push(r.track); st = r.state; }
  assert.deepStrictEqual(rest.slice().sort(), remaining.slice().sort());
  assert.ok(rest.includes('e') && !rest.includes('c'));
  // a broken state is a fresh start
  assert.ok(['x', 'y'].includes(music.nextTrack(['x', 'y'], { bag: 'junk', played: 5, last: 7 }, rnd).track));
});

test('the shuffle survives restarts, and a broken state file is a fresh start', () => {
  const dir = tmpDir(['1.mp3', '2.mp3', '3.mp3']);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'relax-music-state-')), 'usage-widget-relax-music.json');
  const seen = [];
  for (let i = 0; i < 3; i++) {
    const p = music.pickTrack(dir, file);
    seen.push(p.name);
    assert.strictEqual(p.file, path.join(dir, p.name));
  }
  assert.deepStrictEqual(seen.slice().sort(), ['1.mp3', '2.mp3', '3.mp3']);
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf-8')).last, seen[2]);
  fs.writeFileSync(file, '{ not json');
  assert.ok(music.pickTrack(dir, file).name.endsWith('.mp3'));
  assert.strictEqual(music.pickTrack(tmpDir([]), file), null);
  const logs = [];
  const p = music.pickTrack(dir, path.join(dir, 'no-such-dir', 'state.json'), { log: (m) => logs.push(m) });
  assert.ok(p && logs.length === 1, 'an unsaved shuffle is logged, the track still plays');
});

test('a track too big to decode in memory is refused', async () => {
  const dir = tmpDir(['small.mp3']);
  const big = path.join(dir, 'huge.wav');
  fs.closeSync(fs.openSync(big, 'w'));
  fs.truncateSync(big, music.MAX_BYTES + 1); // sparse: takes no disk space
  await assert.rejects(music.readTrack({ name: 'huge.wav', file: big }), /skipped/);
  const data = await music.readTrack({ name: 'small.mp3', file: path.join(dir, 'small.mp3') });
  assert.strictEqual(data.toString(), 'x');
});
