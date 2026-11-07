// node --test test/maps-view.test.js - the real Maps view code against a fake server, view and window.
// No Electron and no ports, so a crash at any moment can be staged exactly.
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const BOX = { x: 180, y: 70, width: 900, height: 690 };

function makeWorld(t, theme = { name: 'brutal', winBg: '#f0ede4' }) {
  const world = { children: [], views: [], dashboards: [], handlers: {}, statuses: [], tabs: [], theme };

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

  class FakeView {
    constructor(options) {
      this.options = options;
      this.loads = [];
      this.delivered = [];
      this.themes = [];
      this.visible = true;
      this.focused = 0;
      this.closed = null;
      const contents = new EventEmitter();
      contents.isDestroyed = () => this.closed !== null;
      contents.focus = () => { this.focused += 1; };
      contents.close = (closeOptions) => { this.closed = closeOptions || {}; };
      contents.setWindowOpenHandler = () => {};
      contents.send = (channel, data) => {
        if (channel === 'maps-open-request') this.delivered.push(data);
        if (channel === 'maps-theme') this.themes.push(data);
      };
      contents.loadURL = (url) => {
        this.loads.push(url);
        contents.emit('did-finish-load');
        return Promise.resolve();
      };
      this.webContents = contents;
      world.views.push(this);
    }
    setVisible(value) { this.visible = value; }
    setBorderRadius(value) { this.radius = value; }
    setBackgroundColor(value) { this.background = value; }
    setBounds(value) { this.bounds = value; }
  }

  const newDashboard = () => {
    const dashboard = new EventEmitter();
    dashboard.destroyed = false;
    dashboard.size = [1100, 780];
    dashboard.isDestroyed = () => dashboard.destroyed;
    dashboard.getContentSize = () => dashboard.size;
    dashboard.children = [];
    dashboard.contentView = {
      addChildView: (view) => dashboard.children.push(view),
      removeChildView: (view) => { dashboard.children = dashboard.children.filter((v) => v !== view); },
    };
    dashboard.webContents = {
      focused: 0,
      focus() { this.focused += 1; },
      send: (channel, data) => { if (channel === 'maps-status') world.statuses.push(data); },
    };
    world.dashboards.push(dashboard);
    return dashboard;
  };
  world.dashboard = newDashboard();
  world.newDashboard = () => { world.dashboard = newDashboard(); return world.dashboard; };

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
    world.onBeforeRequest({ url: 'http://127.0.0.1:3418/x' }, (answer) => { cancel = answer.cancel; });
    return cancel;
  };
  world.outsideBlocked = () => {
    let cancel;
    world.onBeforeRequest({ url: 'https://evil.example/x' }, (answer) => { cancel = answer.cancel; });
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
  world.lastStatus = () => world.statuses.at(-1);
  world.show = (bounds = BOX) => world.handlers['maps-show']({ sender: world.dashboard.webContents }, bounds);
  world.hide = () => world.handlers['maps-hide']({ sender: world.dashboard.webContents });

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maps-view-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  // The server files only exist in a build that bundled the Maps app.
  const realSpawn = childProcess.spawn;
  const realExists = fs.existsSync;
  childProcess.spawn = spawn;
  fs.existsSync = () => true;
  delete require.cache[require.resolve('../maps-view')];
  const { createMapsFeature } = require('../maps-view');
  world.feature = createMapsFeature({
    WebContentsView: FakeView,
    ipcMain: {
      on: (name, handler) => { world.handlers[name] = handler; },
      handle: (name, handler) => { world.handlers[name] = handler; },
    },
    session,
    isLocalSender: () => true,
    dataDir,
    getDashboard: () => world.dashboard,
    openDashboard: (tab) => world.tabs.push(tab),
    getTheme: () => world.theme,
    getTargets: () => [],
    getAccounts: () => world.accounts || [],
  });
  fs.existsSync = realExists;
  t.after(() => { childProcess.spawn = realSpawn; });
  return world;
}

// Shows the Maps section and lets its server report ready.
async function opened(world) {
  world.show();
  await tick();
  world.children.at(-1).listen();
  await tick();
  return world.views.at(-1);
}

test('the page loads only after our own server says it is listening', async (t) => {
  const world = makeWorld(t);
  world.show();
  await tick();
  const view = world.views[0];
  assert.deepStrictEqual(view.loads, []);
  assert.strictEqual(world.requestBlocked(), true);
  assert.strictEqual(world.lastStatus().state, 'opening');
  world.children[0].listen();
  await tick();
  assert.strictEqual(view.loads.length, 1);
  assert.strictEqual(world.requestBlocked(), false);
  assert.strictEqual(world.lastStatus().state, 'ready');
});

test('the page reaches its own server and nothing else', async (t) => {
  const world = makeWorld(t);
  await opened(world);
  assert.strictEqual(world.requestBlocked(), false);
  assert.strictEqual(world.outsideBlocked(), true);
});

test('the view sits in the dashboard, where the section says, shown only once the page drew', async (t) => {
  const world = makeWorld(t);
  world.show();
  await tick();
  const view = world.views[0];
  assert.deepStrictEqual(world.dashboard.children, [view]);
  assert.deepStrictEqual(view.bounds, BOX);
  assert.strictEqual(view.visible, false);
  world.children[0].listen();
  await tick();
  assert.strictEqual(view.visible, true);
  assert.ok(view.focused > 0);
  world.handlers['maps-bounds']({ sender: world.dashboard.webContents }, { x: 180, y: 70, width: 700, height: 500 });
  assert.deepStrictEqual(view.bounds, { x: 180, y: 70, width: 700, height: 500 });
});

test('leaving the section hides the view and keeps the page, and coming back reuses it', async (t) => {
  const world = makeWorld(t);
  const view = await opened(world);
  world.hide();
  assert.strictEqual(view.visible, false);
  assert.ok(world.dashboard.webContents.focused > 0);
  assert.strictEqual(view.closed, null);
  world.show();
  assert.strictEqual(view.visible, true);
  assert.strictEqual(world.views.length, 1);
  assert.strictEqual(world.children.length, 1);
  assert.strictEqual(view.loads.length, 1);
});

test('only the dashboard may place the view', async (t) => {
  const world = makeWorld(t);
  const view = await opened(world);
  const outsider = { sender: {} };
  world.handlers['maps-bounds'](outsider, { x: 0, y: 0, width: 1, height: 1 });
  world.handlers['maps-hide'](outsider);
  assert.deepStrictEqual(view.bounds, BOX);
  assert.strictEqual(view.visible, true);
});

test('closing the dashboard closes the page with its unload events, and stops the server', async (t) => {
  const world = makeWorld(t);
  const view = await opened(world);
  world.feature.dashboardClosed();
  assert.deepStrictEqual(view.closed, { waitForBeforeUnload: true });
  await tick(5);
  assert.strictEqual(world.children[0].exited, true);
});

test('a dashboard opened later gets a fresh view and server', async (t) => {
  const world = makeWorld(t);
  await opened(world);
  world.feature.dashboardClosed();
  await tick(5);
  world.newDashboard();
  const second = await opened(world);
  assert.strictEqual(world.views.length, 2);
  assert.strictEqual(world.children.length, 2);
  assert.deepStrictEqual(world.dashboard.children, [second]);
  assert.strictEqual(second.visible, true);
});

test('Digitize can use the account with the most room when there is no default login', async (t) => {
  const world = makeWorld(t);
  world.accounts = [
    { dir: '/a', usage: { weekAll: { pct: 90 } } },
    { dir: '/b', usage: { weekAll: { pct: 10 } } },
  ];
  await opened(world);
  assert.strictEqual(world.children[0].env.BALONCHE_FALLBACK_CONFIG_DIR, '/b');
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
  const view = await opened(world);
  const firstToken = world.headerToken();
  world.children[0].die();
  assert.strictEqual(world.requestBlocked(), true);
  await tick();
  assert.strictEqual(world.children.length, 2);
  world.children[1].listen();
  await tick();
  assert.strictEqual(world.requestBlocked(), false);
  assert.notStrictEqual(world.headerToken(), firstToken);
  assert.strictEqual(view.closed, null);
  assert.strictEqual(world.lastStatus().state, 'ready');
});

test('if the port is taken during a restart, the page goes away and the section says why', async (t) => {
  const world = makeWorld(t);
  const view = await opened(world);
  world.children[0].die();
  await tick();
  world.children[1].stderr.emit('data', 'Balonche could not start on port 3418: EADDRINUSE');
  world.children[1].die();
  await tick(5);
  assert.notStrictEqual(view.closed, null);
  assert.deepStrictEqual(world.dashboard.children, []);
  assert.strictEqual(world.lastStatus().state, 'error');
  assert.match(world.lastStatus().message, /Port 3418 is in use/);
});

test('Try again after an error opens a new page', async (t) => {
  const world = makeWorld(t);
  world.show();
  await tick();
  world.children[0].stderr.emit('data', 'Balonche could not start on port 3418: EADDRINUSE');
  world.children[0].die();
  await tick(5);
  assert.strictEqual(world.lastStatus().state, 'error');
  const second = await opened(world);
  assert.strictEqual(world.views.length, 2);
  assert.strictEqual(second.visible, true);
  assert.strictEqual(world.lastStatus().state, 'ready');
});

test('a server that keeps dying is not restarted forever', async (t) => {
  const world = makeWorld(t);
  const view = await opened(world);
  for (let i = 0; i < 3; i += 1) {
    world.children.at(-1).die();
    await tick();
    world.children.at(-1).listen();
    await tick();
  }
  assert.strictEqual(view.closed, null);
  world.children.at(-1).die();
  await tick(5);
  assert.notStrictEqual(view.closed, null);
  assert.match(world.lastStatus().message, /keeps stopping/);
});

test('a crash followed by closing and reopening the dashboard leaves the new view alone', async (t) => {
  const world = makeWorld(t);
  await opened(world);
  world.children[0].die();
  await tick();
  world.feature.dashboardClosed();
  await tick();
  world.newDashboard();
  world.show();
  await tick(5);
  world.children.at(-1).listen();
  await tick(5);
  const fresh = world.views.at(-1);
  assert.strictEqual(fresh.closed, null);
  assert.strictEqual(fresh.visible, true);
  assert.strictEqual(world.lastStatus().state, 'ready');
});

test('closing the dashboard while the server starts shows no error', async (t) => {
  const world = makeWorld(t);
  world.show();
  await tick();
  world.feature.dashboardClosed();
  await tick(5);
  assert.notStrictEqual(world.lastStatus().state, 'error');
  assert.strictEqual(world.children[0].exited, true);
});

test('a reload that keeps failing gives up, even though Chromium reports each one as finished', async (t) => {
  const world = makeWorld(t);
  const view = await opened(world);
  view.webContents.loadURL = () => Promise.resolve(); // every retry fails too, so none reports a clean finish
  for (let i = 0; i < 4 && view.closed === null; i += 1) {
    view.webContents.emit('did-fail-load', {}, -20, 'blocked', 'x', true);
    view.webContents.emit('did-finish-load');
    await tick();
  }
  assert.notStrictEqual(view.closed, null);
  assert.match(world.lastStatus().message, /could not load/);
});

test('a load that was only replaced by another one is no failure', async (t) => {
  const world = makeWorld(t);
  const view = await opened(world);
  const loads = view.loads.length;
  view.webContents.emit('did-fail-load', {}, -3, 'aborted', 'x', true);
  await tick();
  assert.strictEqual(view.loads.length, loads);
});

test('a page that crashes is loaded again', async (t) => {
  const world = makeWorld(t);
  const view = await opened(world);
  view.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  await tick();
  assert.strictEqual(view.loads.length, 2);
  assert.strictEqual(view.visible, true);
});

test('Present takes the whole window, and leaving it goes back to the section', async (t) => {
  const world = makeWorld(t);
  const view = await opened(world);
  view.webContents.emit('enter-html-full-screen');
  assert.strictEqual(view.radius, 0);
  world.dashboard.size = [1800, 1100];
  world.dashboard.emit('resize');
  assert.deepStrictEqual(view.bounds, { x: 0, y: 0, width: 1800, height: 1100 });
  view.webContents.emit('leave-html-full-screen');
  assert.ok(view.radius > 0);
  assert.deepStrictEqual(view.bounds, BOX);
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

test('opening from anywhere goes to the Maps section, and a double click on New map makes one map', async (t) => {
  const world = makeWorld(t);
  const view = await opened(world);
  world.handlers['maps-open']({}, { new: true });
  world.handlers['maps-open']({}, { new: true });
  await tick();
  assert.deepStrictEqual(view.delivered, [{ new: true }]);
  assert.deepStrictEqual(world.tabs, ['maps']);
});

test('a map asked for before the page is ready waits for it', async (t) => {
  const world = makeWorld(t);
  world.handlers['maps-open']({}, { id: 'abc' });
  assert.deepStrictEqual(world.tabs, ['maps']);
  const view = await opened(world);
  assert.deepStrictEqual(view.delivered, [{ id: 'abc' }]);
});

test('the page draws its first frame in the app theme and follows later changes', async (t) => {
  const world = makeWorld(t);
  const view = await opened(world);
  assert.match(view.loads[0], /\?theme=brutal$/);
  assert.deepStrictEqual(view.themes.map((t) => t.base), ['brutal']);
  assert.strictEqual(view.themes[0].tokens.bg, '#f0ede4');
  assert.strictEqual(view.background, '#f0ede4');
  world.theme = { name: 'nord', winBg: '#2e3440' };
  world.feature.themeChanged();
  assert.deepStrictEqual(view.themes.map((t) => t.base), ['brutal', 'dark']);
  assert.strictEqual(view.background, '#2e3440');
});

test('only the view may report maps, and the report reaches the renderers cleaned', async (t) => {
  const world = makeWorld(t);
  const view = await opened(world);
  const list = [{ id: 'a', title: 'One', updatedAt: 5, preview: [], links: [] }];
  world.handlers['maps-report']({ sender: {}, senderFrame: { url: 'http://127.0.0.1:3418/' } }, list);
  assert.deepStrictEqual(world.handlers['maps-state']({}).maps, []);
  world.handlers['maps-report']({ sender: view.webContents, senderFrame: { url: 'https://evil.example/' } }, list);
  assert.deepStrictEqual(world.handlers['maps-state']({}).maps, []);
  world.handlers['maps-report']({ sender: view.webContents, senderFrame: { url: 'http://127.0.0.1:3418/' } }, list);
  assert.strictEqual(world.handlers['maps-state']({}).maps[0].title, 'One');
});
