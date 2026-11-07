'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const {
  MAPS_ORIGIN,
  childEnv,
  cleanMapsReport,
  cleanOpenRequest,
  isMapsUrl,
  serverEntry,
} = require('../maps-lib');

test('childEnv drops the AppImage runtime, which breaks programs outside its mount', () => {
  const env = childEnv({
    HOME: '/home/a',
    LD_LIBRARY_PATH: '/tmp/.mount_x/usr/lib',
    APPDIR: '/tmp/.mount_x',
    APPIMAGE: '/a.AppImage',
    ARGV0: 'x',
    OWD: '/',
    PATH: '/tmp/.mount_x:/tmp/.mount_x/usr/sbin:/usr/bin',
    XDG_DATA_DIRS: '/tmp/.mount_x/usr/share:/usr/share',
  }, '/home/a');
  for (const key of ['LD_LIBRARY_PATH', 'APPDIR', 'APPIMAGE', 'ARGV0', 'OWD']) {
    assert.strictEqual(env[key], undefined, key);
  }
  assert.ok(!env.PATH.includes('.mount_'));
  assert.strictEqual(env.XDG_DATA_DIRS, '/usr/share');
  assert.strictEqual(env.HOME, '/home/a');
});

test('childEnv finds a claude command installed in ~/.local/bin, which autostart PATHs miss', () => {
  const env = childEnv({ PATH: '/usr/bin' }, '/home/a');
  assert.deepStrictEqual(env.PATH.split(':'), ['/usr/bin', path.join('/home/a', '.local', 'bin')]);
  const again = childEnv({ PATH: '/home/a/.local/bin:/usr/bin' }, '/home/a');
  assert.strictEqual(again.PATH, '/home/a/.local/bin:/usr/bin');
});

test('childEnv tells the Electron binary to act as Node on the fixed port', () => {
  const env = childEnv({ PATH: '' }, '/home/a');
  assert.strictEqual(env.ELECTRON_RUN_AS_NODE, '1');
  assert.strictEqual(env.PORT, '3418');
  assert.strictEqual(env.BALONCHE_PROVIDER, undefined);
});

test('serverEntry looks outside the asar, because ESM cannot load from inside one', () => {
  const seen = [];
  const found = serverEntry('/app/resources/app.asar', (p) => { seen.push(p); return true; });
  assert.strictEqual(found, path.join('/app/resources/app.asar.unpacked', 'balonche', 'server', 'index.mjs'));
  assert.strictEqual(seen.length, 1);
});

test('serverEntry works from a source checkout, and reports a build without Balonche', () => {
  assert.strictEqual(serverEntry('/src/meter', () => true), path.join('/src/meter', 'balonche', 'server', 'index.mjs'));
  assert.strictEqual(serverEntry('/src/meter', () => false), null);
});

test('serverEntry leaves a folder that merely starts with app.asar alone', () => {
  assert.strictEqual(serverEntry('/x/app.asarfoo', () => true), path.join('/x/app.asarfoo', 'balonche', 'server', 'index.mjs'));
});

test('cleanMapsReport keeps a good map', () => {
  const preview = [{ x: 0, y: 1.5, w: 40, h: 18, color: '#FFE14D' }];
  assert.deepStrictEqual(
    cleanMapsReport([{ id: 'a', title: 'Plan', updatedAt: 5, preview }]),
    [{ id: 'a', title: 'Plan', updatedAt: 5, preview }],
  );
});

test('cleanMapsReport refuses anything that is not a list', () => {
  for (const bad of [null, undefined, 'x', { length: 1 }, 5]) {
    assert.strictEqual(cleanMapsReport(bad), null);
  }
});

test('cleanMapsReport drops broken entries and never trusts a colour or a size', () => {
  const out = cleanMapsReport([
    null,
    { id: 5, title: 'no id' },
    { id: 'a', title: 'x'.repeat(500), updatedAt: 'soon', preview: [
      { x: 1, y: 1, w: 1, h: 1, color: 'url(http://evil)' },
      { x: Infinity, y: 1, w: 1, h: 1, color: '#fff' },
      { x: 1, y: 1, w: 1, h: 1, color: '#abc' },
    ] },
    { id: 'b' },
  ]);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].title.length, 200);
  assert.strictEqual(out[0].updatedAt, 0);
  assert.deepStrictEqual(out[0].preview, [{ x: 1, y: 1, w: 1, h: 1, color: '#abc' }]);
  assert.strictEqual(out[1].title, 'Untitled map');
  assert.deepStrictEqual(out[1].preview, []);
});

test('cleanMapsReport caps the list and each preview', () => {
  const preview = Array.from({ length: 40 }, () => ({ x: 0, y: 0, w: 1, h: 1, color: '#000' }));
  const list = Array.from({ length: 300 }, (_, i) => ({ id: String(i), title: 't', updatedAt: 1, preview }));
  const out = cleanMapsReport(list);
  assert.strictEqual(out.length, 100);
  assert.strictEqual(out[0].preview.length, 12);
});

test('cleanOpenRequest accepts a new map, a map id, or plain opening', () => {
  assert.deepStrictEqual(cleanOpenRequest({ new: true }), { new: true });
  assert.deepStrictEqual(cleanOpenRequest({ id: 'abc' }), { id: 'abc' });
  assert.strictEqual(cleanOpenRequest(undefined), null);
  assert.strictEqual(cleanOpenRequest({ id: 5 }), null);
  assert.strictEqual(cleanOpenRequest({ id: 'x'.repeat(100) }), null);
  assert.strictEqual(cleanOpenRequest({ new: 'yes' }), null);
});

test('isMapsUrl allows only the local server, not a lookalike', () => {
  assert.strictEqual(isMapsUrl(`${MAPS_ORIGIN}/`), true);
  assert.strictEqual(isMapsUrl(`${MAPS_ORIGIN}/assets/a.js`), true);
  assert.strictEqual(isMapsUrl('http://127.0.0.1:3417/'), false);
  assert.strictEqual(isMapsUrl('http://127.0.0.1:3418.evil.com/'), false);
  assert.strictEqual(isMapsUrl('https://example.com/'), false);
  assert.strictEqual(isMapsUrl('not a url'), false);
});
