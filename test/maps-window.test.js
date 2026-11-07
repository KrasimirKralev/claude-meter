// node --test test/maps-window.test.js - the real Maps window code against a fake server and window.
// No Electron and no ports, so a crash at any moment can be staged exactly.
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function makeWorld(t) {
  const world = { children: [], windows: [], dialogs: [], handlers: {} };

  const spawn = (_command, _args, options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.connected = true;
    child.sent = [];
    child.env = options.env;
    child.send = (message) => child.sent.push(message);
    child.die = () => {
      if (child.exited) return;
      child.exited = true;
      child.emit('exit', 1);
    };
    child.listen = () => child.emit('message', { type: 'listening' });
    child.kill = () => setTimeout(child.die, 1);
    world.children.push(child);
    return child;
  };

  class FakeWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.destroyed = false;
      this.loads = [];
      this.delivered = [];
      this.webContents = new EventEmitter();
      this.webContents.isLoading = () => false;
      this.webContents.send = (_channel, request) => this.delivered.push(request);
      this.webContents.setWindowOpenHandler = () => {};
      world.windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    isMinimized() { return false; }
    restore() {}
    show() {}
    focus() {}
    setMenu(menu) { this.menu = menu; }
    getBounds() { return { x: 0, y: 0, width: 800, height: 600 }; }
    close() {
      if (this.closing) return;
      this.closing = true;
      setTimeout(() => {
        this.destroyed = true;
        this.emit('closed');
      }, 0);
    }
    loadURL(url) {
      this.loads.push(url);
      this.webContents.emit('did-finish-load');
      return Promise.resolve();
    }
  }

  const session = {
    fromPartition: () => ({
      webRequest: {
        onBeforeRequest: (_filter, handler) => { world.onBeforeRequest = handler; },
        onBeforeSendHeaders: (_filter, handler) => { world.onBeforeSendHeaders = handler; },
      },
      setPermissionRequestHandler: (handler) => { world.permission = handler; },
    }),
  };

  world.requestBlocked = () => {
    let cancel;
    world.onBeforeRequest({}, (answer) => { cancel = answer.cancel; });
    return cancel;
  };
  world.headerToken = () => {
    let token;
    world.onBeforeSendHeaders({ requestHeaders: {} }, (answer) => { token = answer.requestHeaders['X-Balonche-Token']; });
    return token;
  };
  world.allowed = (permission) => {
    let allowed;
    world.permission(null, permission, (answer) => { allowed = answer; });
    return allowed;
  };
  world.openWindows = () => world.windows.filter((w) => !w.destroyed && !w.closing);

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maps-window-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  // The server files only exist in a build that bundled Balonche.
  const realSpawn = childProcess.spawn;
  const realExists = fs.existsSync;
  childProcess.spawn = spawn;
  fs.existsSync = () => true;
  delete require.cache[require.resolve('../maps-window')];
  const { createMapsFeature } = require('../maps-window');
  world.feature = createMapsFeature({
    BrowserWindow: FakeWindow,
    dialog: { showErrorBox: (title, message) => world.dialogs.push(`${title}: ${message}`) },
    ipcMain: {
      on: (name, handler) => { world.handlers[name] = handler; },
      handle: (name, handler) => { world.handlers[name] = handler; },
    },
    session,
    isLocalSender: () => true,
    dataDir,
    clampBounds: (bounds) => bounds,
    trackWindow: () => {},
    iconPath: undefined,
    getTargets: () => [],
  });
  fs.existsSync = realExists;
  t.after(() => { childProcess.spawn = realSpawn; });
  return world;
}

// Opens the window and lets its server report ready.
async function opened(world) {
  const opening = world.feature.open();
  await tick();
  world.children.at(-1).listen();
  await opening;
  return world.windows.at(-1);
}

test('the page loads only after our own server says it is listening', async (t) => {
  const world = makeWorld(t);
  const opening = world.feature.open();
  await tick();
  const win = world.windows[0];
  assert.deepStrictEqual(win.loads, []);
  assert.strictEqual(world.requestBlocked(), true);
  world.children[0].listen();
  await opening;
  assert.strictEqual(win.loads.length, 1);
  assert.strictEqual(world.requestBlocked(), false);
});

test('the secret travels by message, never through the environment', async (t) => {
  const world = makeWorld(t);
  await opened(world);
  const child = world.children[0];
  assert.strictEqual(child.sent[0].token, world.headerToken());
  assert.ok(child.sent[0].token.length >= 32);
  assert.ok(!JSON.stringify(child.env).includes(child.sent[0].token));
});

test('a crash blocks requests until a new server is ready, with a new secret', async (t) => {
  const world = makeWorld(t);
  await opened(world);
  const firstToken = world.headerToken();
  world.children[0].die();
  assert.strictEqual(world.requestBlocked(), true);
  await tick();
  assert.strictEqual(world.children.length, 2);
  world.children[1].listen();
  await tick();
  assert.strictEqual(world.requestBlocked(), false);
  assert.notStrictEqual(world.headerToken(), firstToken);
  assert.strictEqual(world.openWindows().length, 1);
  assert.deepStrictEqual(world.dialogs, []);
});

test('if the port is taken during a restart, the window closes and says why', async (t) => {
  const world = makeWorld(t);
  await opened(world);
  world.children[0].die();
  await tick();
  world.children[1].stderr.emit('data', 'Balonche could not start on port 3418: EADDRINUSE');
  world.children[1].die();
  await tick(5);
  assert.strictEqual(world.openWindows().length, 0);
  assert.match(world.dialogs[0], /Port 3418 is in use/);
});

test('a server that keeps dying is not restarted forever', async (t) => {
  const world = makeWorld(t);
  await opened(world);
  for (let i = 0; i < 3; i += 1) {
    world.children.at(-1).die();
    await tick();
    world.children.at(-1).listen();
    await tick();
  }
  assert.strictEqual(world.openWindows().length, 1);
  world.children.at(-1).die();
  await tick(5);
  assert.strictEqual(world.openWindows().length, 0);
  assert.match(world.dialogs[0], /keeps stopping/);
});

test('a crash followed by close and reopen leaves the new window alone', async (t) => {
  const world = makeWorld(t);
  const first = await opened(world);
  world.children[0].die();
  await tick();
  first.close();
  await tick();
  const reopening = world.feature.open();
  await tick(5);
  world.children.at(-1).listen();
  await reopening;
  await tick(5);
  assert.strictEqual(world.openWindows().length, 1);
  assert.deepStrictEqual(world.dialogs, []);
});

test('closing the window while the server starts shows no error', async (t) => {
  const world = makeWorld(t);
  const opening = world.feature.open();
  await tick();
  world.windows[0].close();
  await opening;
  await tick(5);
  assert.deepStrictEqual(world.dialogs, []);
  assert.strictEqual(world.children[0].exited, true);
});

test('a reload that keeps failing gives up, even though Chromium reports each one as finished', async (t) => {
  const world = makeWorld(t);
  const win = await opened(world);
  win.loadURL = () => Promise.resolve(); // every retry fails too, so none reports a clean finish
  for (let i = 0; i < 4 && !win.closing; i += 1) {
    win.webContents.emit('did-fail-load', {}, -20, 'blocked', 'x', true);
    win.webContents.emit('did-finish-load');
    await tick();
  }
  assert.strictEqual(win.closing, true);
  assert.match(world.dialogs[0], /could not load/);
});

test('a load that was only replaced by another one is no failure', async (t) => {
  const world = makeWorld(t);
  const win = await opened(world);
  const loads = win.loads.length;
  win.webContents.emit('did-fail-load', {}, -3, 'aborted', 'x', true);
  await tick();
  assert.strictEqual(win.loads.length, loads);
});

test('the page may copy and go full screen, and nothing else', async (t) => {
  const world = makeWorld(t);
  await opened(world);
  assert.strictEqual(world.allowed('clipboard-sanitized-write'), true);
  assert.strictEqual(world.allowed('fullscreen'), true);
  for (const permission of ['media', 'geolocation', 'notifications', 'openExternal']) {
    assert.strictEqual(world.allowed(permission), false, permission);
  }
});

test('a double click on New map makes one map', async (t) => {
  const world = makeWorld(t);
  const win = await opened(world);
  world.handlers['maps-open']({}, { new: true });
  world.handlers['maps-open']({}, { new: true });
  await tick();
  assert.deepStrictEqual(win.delivered, [{ new: true }]);
});

test('the window has no app menu, whose Ctrl+Q would quit the widget too', async (t) => {
  const world = makeWorld(t);
  const win = await opened(world);
  assert.strictEqual(win.menu, null);
});
