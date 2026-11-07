// node --test test/notes-view.test.js - the real Notes view code against a fake view and window.
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { createNotesView } = require('../notes-view');

const BOX = { x: 180, y: 70, width: 900, height: 690 };

function makeWorld() {
  const world = { views: [], handlers: {}, theme: { name: 'brutal', winBg: '#f0ede4' } };

  class FakeView {
    constructor(options) {
      this.options = options;
      this.visible = true;
      this.loads = [];
      this.sent = [];
      this.closed = null;
      this.focused = 0;
      const contents = new EventEmitter();
      contents.isDestroyed = () => this.closed !== null;
      contents.focus = () => { this.focused += 1; };
      contents.close = (closeOptions) => { this.closed = closeOptions; };
      contents.setWindowOpenHandler = (handler) => { this.openHandler = handler; };
      contents.send = (channel, data) => this.sent.push([channel, data]);
      contents.loadFile = (file, options) => {
        this.loads.push({ file, options });
        contents.emit('did-finish-load');
      };
      this.webContents = contents;
      world.views.push(this);
    }
    setVisible(value) { this.visible = value; }
    setBorderRadius() {}
    setBackgroundColor(value) { this.background = value; }
    setBounds(value) { this.bounds = value; }
  }

  world.dashboard = {
    isDestroyed: () => false,
    children: [],
    contentView: {
      addChildView(view) { world.dashboard.children.push(view); },
      removeChildView(view) { world.dashboard.children = world.dashboard.children.filter((v) => v !== view); },
    },
    webContents: { focused: 0, focus() { this.focused += 1; } },
  };
  world.feature = createNotesView({
    WebContentsView: FakeView,
    ipcMain: { on: (name, handler) => { world.handlers[name] = handler; } },
    getDashboard: () => world.dashboard,
    getTheme: () => world.theme,
    dirname: '/app',
  });
  world.from = { sender: world.dashboard.webContents };
  return world;
}

test('the notes page opens in its embedded mode, in the dashboard, where the tab says', () => {
  const world = makeWorld();
  world.handlers['notes-view-show'](world.from, BOX);
  const view = world.views[0];
  assert.strictEqual(view.loads[0].file, '/app/notes.html');
  assert.deepStrictEqual(view.loads[0].options, { query: { mode: 'embed' } });
  assert.deepStrictEqual(world.dashboard.children, [view]);
  assert.deepStrictEqual(view.bounds, BOX);
  assert.strictEqual(view.visible, true);
  assert.ok(view.focused > 0);
  assert.strictEqual(view.options.webPreferences.sandbox, true);
});

test('leaving the tab hides the page and keeps it, and coming back reuses it', () => {
  const world = makeWorld();
  world.handlers['notes-view-show'](world.from, BOX);
  world.handlers['notes-view-hide'](world.from);
  assert.strictEqual(world.views[0].visible, false);
  assert.strictEqual(world.views[0].closed, null);
  world.handlers['notes-view-show'](world.from, BOX);
  assert.strictEqual(world.views.length, 1);
  assert.strictEqual(world.views[0].visible, true);
  assert.strictEqual(world.views[0].loads.length, 1);
});

test('only the dashboard may place or hide the page', () => {
  const world = makeWorld();
  world.handlers['notes-view-show'](world.from, BOX);
  world.handlers['notes-view-bounds']({ sender: {} }, { x: 0, y: 0, width: 1, height: 1 });
  world.handlers['notes-view-hide']({ sender: {} });
  assert.deepStrictEqual(world.views[0].bounds, BOX);
  assert.strictEqual(world.views[0].visible, true);
  world.handlers['notes-view-show']({ sender: {} }, BOX);
  assert.strictEqual(world.views.length, 1);
});

test('the page can go nowhere and open nothing', () => {
  const world = makeWorld();
  world.handlers['notes-view-show'](world.from, BOX);
  const view = world.views[0];
  let stopped = false;
  view.webContents.emit('will-navigate', { preventDefault() { stopped = true; } }, 'file:///etc/passwd');
  assert.strictEqual(stopped, true);
  assert.deepStrictEqual(view.openHandler(), { action: 'deny' });
});

test('closing the dashboard closes the page with its unload events, and a later one gets a new page', () => {
  const world = makeWorld();
  world.handlers['notes-view-show'](world.from, BOX);
  world.feature.dashboardClosed();
  assert.deepStrictEqual(world.views[0].closed, { waitForBeforeUnload: true });
  assert.strictEqual(world.feature.contents(), null);
  world.handlers['notes-view-show'](world.from, BOX);
  assert.strictEqual(world.views.length, 2);
  assert.strictEqual(world.feature.contents(), world.views[1].webContents);
});

test('the page gets the theme, and later changes', () => {
  const world = makeWorld();
  world.handlers['notes-view-show'](world.from, BOX);
  const view = world.views[0];
  assert.deepStrictEqual(view.sent[0], ['theme-update', world.theme]);
  world.theme = { name: 'nord', winBg: '#2e3440' };
  world.feature.themeChanged();
  assert.deepStrictEqual(view.sent.at(-1), ['theme-update', world.theme]);
  assert.strictEqual(view.background, '#2e3440');
});

test('a page that crashes is loaded again', () => {
  const world = makeWorld();
  world.handlers['notes-view-show'](world.from, BOX);
  world.views[0].webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.strictEqual(world.views[0].loads.length, 2);
  assert.strictEqual(world.views[0].visible, true);
});
