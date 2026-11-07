'use strict';
// Maps: the sketch-to-map app, shown inside the dashboard's Maps section. It is its own web page in a
// view laid over that section, with its own storage and no access to the app's own bridge. Its server
// runs as a child process only from the first time Maps opens until the dashboard closes.

const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  MAPS_ORIGIN,
  MAPS_PORT,
  childEnv,
  cleanBounds,
  cleanMapsReport,
  cleanOpenRequest,
  isMapsUrl,
  mapsThemeFor,
  serverEntry,
} = require('./maps-lib');

const START_TIMEOUT_MS = 8000;
const NEW_MAP_GUARD_MS = 1500;
// A server that keeps dying won't be fixed by restarting it forever.
const MAX_RESTARTS = 3;
const RESTART_WINDOW_MS = 60000;
const MAX_RELOADS = 3;
const ABORTED = -3; // Chromium's code for a load replaced by another one, which is no failure
// Maps get their own storage, and the only requests that carry the server's secret come from here.
const PARTITION = 'persist:maps';
// The dashboard's corner, so the page doesn't poke out of the rounded window.
const CORNER_RADIUS = 12;

function createMapsFeature({ WebContentsView, ipcMain, session, isLocalSender, dataDir, getDashboard, openDashboard, getTheme, getTargets }) {
  const entry = serverEntry(__dirname, fs.existsSync);
  const listFile = path.join(dataDir, 'usage-widget-maps.json');

  let view = null;
  let owner = null;
  let bounds = null;
  // The Maps section is on screen, and the page inside the view has drawn at least once.
  let wanted = false;
  let pageReady = false;
  let fullScreen = false;
  let resizeWatched = null;
  let status = { state: 'idle' };
  let server = null;
  let serverExit = Promise.resolve();
  let serverToken = '';
  // Nothing goes to the port unless our own server holds it right now.
  let serverReady = false;
  let starting = null;
  let startingGeneration = -1;
  // Moves on every stop, so a launch still in flight can tell it is no longer wanted.
  let generation = 0;
  let restarts = [];
  let lastNewMapAt = 0;
  let reloads = 0;
  let pending = null;

  const readList = () => {
    try {
      return cleanMapsReport(JSON.parse(fs.readFileSync(listFile, 'utf8'))) || [];
    } catch {
      return [];
    }
  };
  let maps = readList();

  const saveList = () => {
    const temp = `${listFile}.tmp`;
    try {
      fs.writeFileSync(temp, JSON.stringify(maps));
      fs.renameSync(temp, listFile);
    } catch (error) {
      // The list is only a shortcut: the maps themselves live in the view's own storage.
      console.error('[maps] could not save the map list:', error.message);
    }
  };

  const stateForRenderers = () => ({ available: Boolean(entry), maps, status });

  const broadcast = () => {
    for (const target of getTargets()) {
      if (target && !target.isDestroyed()) target.webContents.send('maps-update', stateForRenderers());
    }
  };

  const setStatus = (state, message) => {
    status = message ? { state, message } : { state };
    const dashboard = getDashboard();
    if (dashboard && !dashboard.isDestroyed()) dashboard.webContents.send('maps-status', status);
  };

  const stopServer = () => {
    generation += 1;
    serverReady = false;
    if (server) {
      server.kill();
      server = null;
    }
  };

  // Ready means our own child says it holds the port. Asking the port itself would prove nothing:
  // any local program could be listening there and answer, and that page would then get the view.
  const launchServer = async () => {
    const mine = generation;
    await serverExit; // a server stopped a moment ago may still hold the port
    if (mine !== generation) throw new Error('Opening was cancelled.');
    const token = crypto.randomBytes(32).toString('hex');
    const child = spawn(process.execPath, [entry], {
      env: childEnv(process.env, os.homedir()),
      cwd: path.dirname(entry),
      // The IPC channel carries the secret and the ready message, and it closes when this app dies,
      // even from SIGKILL, which makes the server exit too.
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    server = child;
    let lastError = '';
    child.stdout.on('data', (chunk) => console.log(`[maps] ${String(chunk).trimEnd()}`));
    child.stderr.on('data', (chunk) => {
      lastError = String(chunk).trim();
      console.error(`[maps] ${lastError}`);
    });
    serverExit = new Promise((resolve) => {
      child.once('exit', resolve);
      child.once('error', resolve);
    });
    if (child.connected) child.send({ token });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The map server took too long to start.')), START_TIMEOUT_MS);
      const failed = () => {
        clearTimeout(timer);
        reject(new Error(/could not start on port|EADDRINUSE/.test(lastError)
          ? `Port ${MAPS_PORT} is in use by another program.`
          : 'The map server stopped while starting.'));
      };
      child.on('message', (message) => {
        if (!message || message.type !== 'listening' || server !== child) return;
        clearTimeout(timer);
        serverToken = token;
        serverReady = true;
        resolve();
      });
      child.once('error', (error) => {
        console.error('[maps] the server could not start:', error.message);
        failed();
      });
      child.once('exit', () => {
        const wasReady = server === child && serverReady;
        if (server === child) {
          server = null;
          serverReady = false;
        }
        if (wasReady) onServerLost();
        else failed();
      });
    }).catch((error) => {
      if (server === child) stopServer();
      throw error;
    });
  };

  const startServer = () => {
    if (server && serverReady) return Promise.resolve();
    if (starting && startingGeneration === generation) return starting;
    startingGeneration = generation;
    const attempt = launchServer().finally(() => {
      if (starting === attempt) starting = null;
    });
    starting = attempt;
    return attempt;
  };

  const destroyView = () => {
    const closing = view;
    const from = owner;
    view = null;
    owner = null;
    wanted = false;
    pageReady = false;
    fullScreen = false;
    reloads = 0;
    stopServer();
    if (!closing) return;
    if (from && !from.isDestroyed()) from.contentView.removeChildView(closing);
    // Giving the page its unload events is what saves the last strokes.
    if (!closing.webContents.isDestroyed()) closing.webContents.close({ waitForBeforeUnload: true });
  };

  const fail = (message) => {
    console.error('[maps] giving up:', message);
    const wasWanted = wanted;
    destroyView();
    // The section keeps showing the error, with a button to try again.
    wanted = wasWanted;
    setStatus('error', message);
  };

  // The server died under an open page. The page keeps working on its next request once a new server
  // is up. If the port has gone to some other program, the page goes away rather than talk to it.
  async function onServerLost() {
    const lostFor = view;
    if (!lostFor) return;
    const now = Date.now();
    restarts = restarts.filter((at) => now - at < RESTART_WINDOW_MS);
    restarts.push(now);
    if (restarts.length > MAX_RESTARTS) {
      fail('The map server keeps stopping.');
      return;
    }
    console.error('[maps] the server stopped unexpectedly, restarting');
    try {
      await startServer();
    } catch (error) {
      // By now the dashboard may have closed and opened again. That new view is fine.
      if (view === lostFor) fail(error.message);
    }
  }

  // The page never sees the secret, so nothing it loads could leak it. It is added on the way out,
  // and only while our own server holds the port.
  const prepareSession = (() => {
    let prepared = false;
    return () => {
      if (prepared) return;
      prepared = true;
      const mapsSession = session.fromPartition(PARTITION);
      mapsSession.webRequest.onBeforeRequest({ urls: [`${MAPS_ORIGIN}/*`] }, (_details, callback) => {
        callback({ cancel: !serverReady });
      });
      mapsSession.webRequest.onBeforeSendHeaders(
        { urls: [`${MAPS_ORIGIN}/api/*`] },
        (details, callback) => {
          callback({ requestHeaders: { ...details.requestHeaders, 'X-Balonche-Token': serverToken } });
        },
      );
      // "Copy plan" needs the clipboard and Present goes full screen. A map needs nothing else.
      mapsSession.setPermissionRequestHandler((_contents, permission, callback) => {
        callback(permission === 'clipboard-sanitized-write' || permission === 'fullscreen');
      });
    };
  })();

  const placeView = () => {
    if (!view || !owner || owner.isDestroyed()) return;
    if (fullScreen) {
      const [width, height] = owner.getContentSize();
      view.setBounds({ x: 0, y: 0, width, height });
    } else if (bounds) {
      view.setBounds(bounds);
    }
  };

  const reveal = () => {
    if (!view) return;
    view.setVisible(wanted && pageReady);
    if (wanted && pageReady) view.webContents.focus();
  };

  const sendPending = () => {
    if (!pending || !view || !pageReady) return;
    view.webContents.send('maps-open-request', pending);
    pending = null;
  };

  // The theme in the address lets the page draw its first frame in the right colours.
  const pageUrl = () => `${MAPS_ORIGIN}/?theme=${mapsThemeFor(getTheme().name)}`;

  const sendTheme = () => {
    if (!view) return;
    const theme = getTheme();
    view.setBackgroundColor(theme.winBg);
    view.webContents.send('maps-theme', mapsThemeFor(theme.name));
  };

  const createView = (dashboard) => {
    prepareSession();
    const created = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, 'maps-preload.js'),
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    created.setVisible(false);
    created.setBorderRadius(CORNER_RADIUS);
    const contents = created.webContents;
    contents.on('will-navigate', (event, url) => {
      if (!isMapsUrl(url)) event.preventDefault();
    });
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    // Chromium also reports a failed load as finished, right after the failure.
    let lastLoadFailed = false;
    contents.on('did-finish-load', () => {
      if (view !== created) return;
      const failed = lastLoadFailed;
      lastLoadFailed = false;
      if (failed) return;
      reloads = 0;
      pageReady = true;
      sendTheme();
      setStatus('ready');
      reveal();
      sendPending();
    });
    const reloadOrFail = (message) => {
      if (view !== created) return;
      reloads += 1;
      if (reloads > MAX_RELOADS) {
        fail(message);
        return;
      }
      startServer()
        .then(() => {
          if (view === created) contents.loadURL(pageUrl());
        })
        .catch((error) => {
          if (view === created) fail(error.message);
        });
    };
    // A reload that found no server, which can happen right after it stopped.
    contents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
      if (!isMainFrame || code === ABORTED) return;
      lastLoadFailed = true;
      reloadOrFail('The map page could not load.');
    });
    // The page itself crashed. Maps are saved as they change, so a reload brings them back.
    contents.on('render-process-gone', (_event, details) => {
      if (details.reason === 'clean-exit') return;
      console.error('[maps] the page stopped:', details.reason);
      pageReady = false;
      reveal();
      reloadOrFail('The map page keeps stopping.');
    });
    // Present asks the page for full screen. The window follows, and the view takes all of it.
    contents.on('enter-html-full-screen', () => {
      if (view !== created) return;
      fullScreen = true;
      created.setBorderRadius(0);
      placeView();
    });
    contents.on('leave-html-full-screen', () => {
      if (view !== created) return;
      fullScreen = false;
      created.setBorderRadius(CORNER_RADIUS);
      placeView();
    });
    dashboard.contentView.addChildView(created);
    if (resizeWatched !== dashboard) {
      resizeWatched = dashboard;
      dashboard.on('resize', placeView);
    }
    return created;
  };

  const loadPage = async (created) => {
    setStatus('opening');
    try {
      await startServer();
      if (view === created) await created.webContents.loadURL(pageUrl());
    } catch (error) {
      console.error('[maps] opening failed:', error.message);
      if (view === created) fail(error.message);
    }
  };

  // The dashboard's Maps section came on screen, at this place in the window.
  const show = (rawBounds) => {
    const dashboard = getDashboard();
    if (!entry || !dashboard || dashboard.isDestroyed()) return;
    const clean = cleanBounds(rawBounds);
    if (clean) bounds = clean;
    wanted = true;
    if (view && owner !== dashboard) destroyView();
    if (view) {
      placeView();
      reveal();
      sendPending();
      return;
    }
    owner = dashboard;
    view = createView(dashboard);
    placeView();
    loadPage(view);
  };

  const hide = () => {
    wanted = false;
    if (view) view.setVisible(false);
    const dashboard = getDashboard();
    if (dashboard && !dashboard.isDestroyed()) dashboard.webContents.focus();
  };

  const open = (rawRequest) => {
    const request = cleanOpenRequest(rawRequest);
    if (!entry) return;
    // A double click on "New map" means one new map.
    if (request && request.new) {
      if (Date.now() - lastNewMapAt < NEW_MAP_GUARD_MS) return;
      lastNewMapAt = Date.now();
    }
    if (request) pending = request;
    openDashboard('maps');
    sendPending();
  };

  const fromDashboard = (event) => {
    const dashboard = getDashboard();
    return Boolean(dashboard) && !dashboard.isDestroyed() && event.sender === dashboard.webContents;
  };

  ipcMain.on('maps-open', (event, request) => {
    if (isLocalSender(event)) open(request);
  });
  ipcMain.handle('maps-state', (event) => (isLocalSender(event) ? stateForRenderers() : { available: false, maps: [], status: { state: 'idle' } }));
  ipcMain.on('maps-show', (event, rawBounds) => {
    if (fromDashboard(event)) show(rawBounds);
  });
  ipcMain.on('maps-bounds', (event, rawBounds) => {
    if (!fromDashboard(event)) return;
    const clean = cleanBounds(rawBounds);
    if (clean) bounds = clean;
    placeView();
  });
  ipcMain.on('maps-hide', (event) => {
    if (fromDashboard(event)) hide();
  });
  // Only the view may report maps, and only from its own page.
  ipcMain.on('maps-report', (event, list) => {
    if (!view || event.sender !== view.webContents || !isMapsUrl(event.senderFrame.url)) return;
    const clean = cleanMapsReport(list);
    if (!clean) return;
    maps = clean;
    saveList();
    broadcast();
  });

  return {
    open,
    stopServer,
    themeChanged: sendTheme,
    dashboardClosed: () => {
      pending = null;
      status = { state: 'idle' };
      destroyView();
    },
  };
}

module.exports = { createMapsFeature };
