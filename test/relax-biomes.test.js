// node --test test/relax-biomes.test.js - which Relax biome the next break shows.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const biomes = require('../relax-biomes');

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'relax-biomes-')), 'usage-widget-relax-biomes.json');

test('the folder lists 15 biomes, one file each; the kit and index are not biomes', () => {
  const ids = biomes.listBiomes();
  assert.strictEqual(ids.length, 15);
  assert.ok(ids.includes('dusk-lake'));
  assert.ok(!ids.includes('_kit') && !ids.includes('index'));
  for (const id of ids) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'relax-biomes', id + '.js'), 'utf-8');
    assert.match(src, new RegExp("id: '" + id + "'"), id + '.js registers itself under its file name');
  }
});

test('a 16th biome is one new file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relax-biome-dir-'));
  for (const f of ['_kit.js', 'index.js', 'a.js', 'b.js', 'notes.txt', 'Bad Name.js']) fs.writeFileSync(path.join(dir, f), '');
  assert.deepStrictEqual(biomes.listBiomes(dir), ['a', 'b']);
  fs.writeFileSync(path.join(dir, 'c.js'), '');
  assert.deepStrictEqual(biomes.listBiomes(dir), ['a', 'b', 'c']);
  assert.deepStrictEqual(biomes.listBiomes(path.join(dir, 'missing')), []);
});

test('never one of the last five', () => {
  const ids = biomes.listBiomes();
  const recent = ids.slice(0, 5);
  for (let i = 0; i < 200; i++) {
    const r = i / 200;
    const id = biomes.pickBiome(ids, recent, () => r);
    assert.ok(!recent.includes(id), id + ' was shown recently');
  }
  // every one of the other ten can come up
  const seen = new Set();
  for (let i = 0; i < 10; i++) seen.add(biomes.pickBiome(ids, recent, () => (i + 0.5) / 10));
  assert.strictEqual(seen.size, 10);
});

test('with only a few biomes, all but one are held back', () => {
  assert.strictEqual(biomes.pickBiome(['a', 'b', 'c'], ['c', 'a', 'b'], () => 0), 'c');
  assert.strictEqual(biomes.pickBiome(['a'], ['a'], () => 0.9), 'a');
  assert.strictEqual(biomes.pickBiome([], [], () => 0), null);
});

test('a hundred breaks in a row: no place comes back within six breaks, history survives restarts', () => {
  const file = tmpFile();
  const shown = [];
  for (let i = 0; i < 100; i++) shown.push(biomes.nextBiome(file));
  for (let i = 0; i < shown.length; i++) {
    const window = shown.slice(Math.max(0, i - 5), i);
    assert.ok(!window.includes(shown[i]), 'break ' + i + ' repeated ' + shown[i]);
  }
  const saved = JSON.parse(fs.readFileSync(file, 'utf-8')).recent;
  assert.deepStrictEqual(saved, shown.slice(-5));
  // a fresh process reads the same file: still no repeat
  const next = biomes.nextBiome(file);
  assert.ok(!shown.slice(-5).includes(next));
  assert.ok(new Set(shown).size >= 12, 'the random pick reaches most of the places');
});

test('a broken or foreign history file is treated as empty and rewritten', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{"recent": ["dusk-lake",');
  const id = biomes.nextBiome(file);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf-8')).recent, [id]);
  fs.writeFileSync(file, JSON.stringify({ recent: ['gone-biome', '../etc', 42, 'rain-window'] }));
  const id2 = biomes.nextBiome(file);
  assert.notStrictEqual(id2, 'rain-window');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf-8')).recent, ['rain-window', id2]);
});

test('a history that cannot be saved still gives a biome, and says so', () => {
  const logs = [];
  const id = biomes.nextBiome(path.join(os.tmpdir(), 'no-such-dir-' + process.pid, 'x.json'), { log: (m) => logs.push(m) });
  assert.ok(biomes.listBiomes().includes(id));
  assert.strictEqual(logs.length, 1);
  assert.match(logs[0], /could not remember/);
});

test('no biome files at all: the lake, and a note in the log', () => {
  const logs = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relax-biome-empty-'));
  assert.strictEqual(biomes.nextBiome(tmpFile(), { dir, log: (m) => logs.push(m) }), 'dusk-lake');
  assert.match(logs[0], /no biomes found/);
});
