'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const {
  MAPS_ORIGIN,
  childEnv, cleanBounds, mapsThemeFor, mapsTokens, roomiestDir,
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
  assert.strictEqual(found, path.join('/app/resources/app.asar.unpacked', 'maps', 'build', 'server', 'index.mjs'));
  assert.strictEqual(seen.length, 1);
});

test('serverEntry works from a source checkout, and reports a build without Balonche', () => {
  assert.strictEqual(serverEntry('/src/meter', () => true), path.join('/src/meter', 'maps', 'build', 'server', 'index.mjs'));
  assert.strictEqual(serverEntry('/src/meter', () => false), null);
});

test('serverEntry leaves a folder that merely starts with app.asar alone', () => {
  assert.strictEqual(serverEntry('/x/app.asarfoo', () => true), path.join('/x/app.asarfoo', 'maps', 'build', 'server', 'index.mjs'));
});

test('cleanMapsReport keeps a good map', () => {
  const preview = [{ x: 0, y: 1.5, w: 40, h: 18, color: '#FFE14D' }];
  assert.deepStrictEqual(
    cleanMapsReport([{ id: 'a', title: 'Plan', updatedAt: 5, preview }]),
    [{ id: 'a', title: 'Plan', updatedAt: 5, preview, links: [] }],
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

test('cleanMapsReport keeps only links between bubbles in the preview', () => {
  const preview = [{ x: 0, y: 0, w: 1, h: 1, color: '#000' }, { x: 2, y: 0, w: 1, h: 1, color: '#000' }];
  const [map] = cleanMapsReport([{ id: 'a', preview, links: [[0, 1], [1, 5], [0, 'x'], 'bad', [-1, 0], [0.5, 1]] }]);
  assert.deepStrictEqual(map.links, [[0, 1]]);
});

test('bounds for the view are whole pixels, and nonsense is refused', () => {
  assert.deepStrictEqual(cleanBounds({ x: 10.4, y: 20.6, width: 300.2, height: 200.5 }), { x: 10, y: 21, width: 300, height: 201 });
  for (const bad of [null, 'x', {}, { x: 1, y: 1, width: 0, height: 5 }, { x: -1, y: 0, width: 5, height: 5 }, { x: NaN, y: 0, width: 5, height: 5 }]) {
    assert.strictEqual(cleanBounds(bad), null);
  }
});

test('every app theme maps to one the map page draws', () => {
  assert.strictEqual(mapsThemeFor('brutal'), 'brutal');
  assert.strictEqual(mapsThemeFor('karchx'), 'light');
  assert.strictEqual(mapsThemeFor('nord'), 'dark');
  assert.strictEqual(mapsThemeFor('dracula'), 'dark');
  assert.strictEqual(mapsThemeFor('unknown'), 'brutal');
});

test('the account with the most room lends its login, never one that is logged out', () => {
  assert.strictEqual(roomiestDir([{ dir: '/a', usage: { weekAll: { pct: 50 } } }, { dir: '/b', usage: { weekAll: { pct: 5 } } }]), '/b');
  assert.strictEqual(roomiestDir([{ dir: '/a', needsLogin: true, usage: { weekAll: { pct: 1 } } }, { dir: '/b', usage: { weekAll: { pct: 80 } } }]), '/b');
  assert.strictEqual(roomiestDir([{ dir: '/a', usage: null }]), '/a');
  assert.strictEqual(roomiestDir([{ needsLogin: true, dir: '/a' }]), null);
  assert.strictEqual(roomiestDir([]), null);
  assert.strictEqual(roomiestDir(null), null);
});

test('the page gets the app theme\'s real colours', () => {
  const tokens = mapsTokens({ name: 'nord', winBg: '#2e3440', surface: '#3b4252', surface2: '#434c5e', line: '#a3adc2', shadow: '#20252f', text: '#eceff4', textDim: '#c0c8d6', accent: '#88c0d0', onAccent: '#111111', yellow: '#ebcb8b', green: '#a3be8c', critText: '#f2a7ae' });
  assert.strictEqual(tokens.bg, '#2e3440');
  assert.strictEqual(tokens.blue, '#88c0d0');
  assert.strictEqual(tokens['on-accent'], '#111111');
  assert.strictEqual(tokens['elev-float'], '3px 3px 0 #20252f');
  assert.match(tokens.hover, /255/);
});
