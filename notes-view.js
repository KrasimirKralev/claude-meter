'use strict';
// Notes inside the dashboard's Plan section: the same page as the Notes window, in a view laid over
// that section. It loads on first use and closes with the dashboard.

const path = require('path');
const { cleanBounds } = require('./maps-lib');

const CORNER_RADIUS = 12;

function createNotesView({ WebContentsView, ipcMain, getDashboard, getTheme, dirname }) {
  let view = null;
  let owner = null;
  let bounds = null;
  let wanted = false;
  let ready = false;

  const sendTheme = () => {
    if (!view) return;
    const theme = getTheme();
    view.setBackgroundColor(theme.winBg);
    view.webContents.send('theme-update', theme);
  };

  const reveal = () => {
    if (!view) return;
    view.setVisible(wanted && ready);
    if (wanted && ready) view.webContents.focus();
  };

  const place = () => {
    if (view && bounds) view.setBounds(bounds);
  };

  const close = () => {
    const closing = view;
    const from = owner;
    view = null;
    owner = null;
    ready = false;
    wanted = false;
    if (!closing) return;
    if (from && !from.isDestroyed()) from.contentView.removeChildView(closing);
    // Giving the page its unload events is what saves words still being typed.
    if (!closing.webContents.isDestroyed()) closing.webContents.close({ waitForBeforeUnload: true });
  };

  const show = (rawBounds) => {
    const dashboard = getDashboard();
    if (!dashboard || dashboard.isDestroyed()) return;
    bounds = cleanBounds(rawBounds) || bounds;
    wanted = true;
    if (view && owner !== dashboard) close();
    if (!view) {
      wanted = true;
      owner = dashboard;
      view = new WebContentsView({
        webPreferences: {
          preload: path.join(dirname, 'notes-preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          spellcheck: true,
        },
      });
      view.setVisible(false);
      view.setBorderRadius(CORNER_RADIUS);
      const contents = view.webContents;
      const mine = view;
      // This page has no reason to go anywhere else, not even to another file.
      contents.on('will-navigate', (event) => event.preventDefault());
      contents.setWindowOpenHandler(() => ({ action: 'deny' }));
      contents.on('did-finish-load', () => {
        if (view !== mine) return;
        ready = true;
        sendTheme();
        reveal();
      });
      contents.on('render-process-gone', (_event, details) => {
        if (view !== mine || details.reason === 'clean-exit') return;
        console.error('[notes] the page stopped:', details.reason);
        ready = false;
        reveal();
        contents.loadFile(path.join(dirname, 'notes.html'), { query: { mode: 'embed' } });
      });
      dashboard.contentView.addChildView(view);
      place();
      contents.loadFile(path.join(dirname, 'notes.html'), { query: { mode: 'embed' } });
      return;
    }
    place();
    reveal();
  };

  const hide = () => {
    wanted = false;
    if (view) view.setVisible(false);
    const dashboard = getDashboard();
    if (dashboard && !dashboard.isDestroyed()) dashboard.webContents.focus();
  };

  const fromDashboard = (event) => {
    const dashboard = getDashboard();
    return Boolean(dashboard) && !dashboard.isDestroyed() && event.sender === dashboard.webContents;
  };

  ipcMain.on('notes-view-show', (event, rawBounds) => {
    if (fromDashboard(event)) show(rawBounds);
  });
  ipcMain.on('notes-view-bounds', (event, rawBounds) => {
    if (!fromDashboard(event)) return;
    bounds = cleanBounds(rawBounds) || bounds;
    place();
  });
  ipcMain.on('notes-view-hide', (event) => {
    if (fromDashboard(event)) hide();
  });

  return {
    dashboardClosed: close,
    themeChanged: sendTheme,
    contents: () => (view ? view.webContents : null),
  };
}

module.exports = { createNotesView };
