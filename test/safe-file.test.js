// node --test test/safe-file.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readJsonOr, writeJsonAtomic } = require('../safe-file');

function folder(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-file-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('what is written reads back, and only its owner can read it', (t) => {
  const file = path.join(folder(t), 'a.json');
  writeJsonAtomic(file, { tasks: [1, 2] });
  assert.deepStrictEqual(readJsonOr(file, null), { tasks: [1, 2] });
  assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
});

test('a missing file gives the fallback and leaves nothing behind', (t) => {
  const dir = folder(t);
  assert.deepStrictEqual(readJsonOr(path.join(dir, 'nope.json'), []), []);
  assert.deepStrictEqual(fs.readdirSync(dir), []);
});

test('a damaged file is kept aside, so the next save cannot destroy it', (t) => {
  const dir = folder(t);
  const file = path.join(dir, 'tasks.json');
  fs.writeFileSync(file, '{"tasks": [{"text": "important"');
  assert.deepStrictEqual(readJsonOr(file, { tasks: [] }), { tasks: [] });
  const aside = fs.readdirSync(dir).filter((name) => name.startsWith('tasks.json.bad-'));
  assert.strictEqual(aside.length, 1);
  assert.match(fs.readFileSync(path.join(dir, aside[0]), 'utf8'), /important/);
  writeJsonAtomic(file, { tasks: [] });
  assert.match(fs.readFileSync(path.join(dir, aside[0]), 'utf8'), /important/);
});

test('a file emptied by a crash counts as damaged', (t) => {
  const dir = folder(t);
  const file = path.join(dir, 'x.json');
  fs.writeFileSync(file, '');
  assert.strictEqual(readJsonOr(file, 'fallback'), 'fallback');
  assert.strictEqual(fs.existsSync(file), false);
});

test('a failed save leaves the old file whole', (t) => {
  const dir = folder(t);
  const file = path.join(dir, 'x.json');
  writeJsonAtomic(file, { keep: true });
  const circular = {};
  circular.self = circular;
  assert.throws(() => writeJsonAtomic(file, circular));
  assert.deepStrictEqual(readJsonOr(file, null), { keep: true });
});
