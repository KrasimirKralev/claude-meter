'use strict';
// Maps: Balonche, the sketch-to-map app, in its own window. Its server runs as a child process only
// while that window is open, so a closed window costs no memory.

const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  MAPS_ORIGIN,
  MAPS_PORT,
  childEnv,
  cleanMapsReport,
  cleanOpenRequest,
  isMapsUrl,
  serverEntry,
} = require('./maps-lib');

const START_TIMEOUT_MS = 8000;
const NEW_MAP_GUARD_MS = 1500;
// A server that keeps dying won't be fixed by restarting it forever.
const MAX_RESTARTS = 3;
const RESTART_WINDOW_MS = 60000;
const MAX_RELOADS = 3;
const ABORTED = -3; // Chromium's code for a load replaced by another one, which is no failure
const DEFAULT_BOUNDS = { x: 120, y: 80, width: 1280, height: 800 };
// Maps get their own storage, and the only requests that carry the server's secret come from here.
const PARTITION = 'persist:maps';

function createMapsFeature({ BrowserWindow, dialog, ipcMain, session, isLocalSender, dataDir, clampBounds, trackWindow, iconPath, getTargets }) {
  const entry = serverEntry(__dirname, fs.existsSync);
  const listFile = path.join(dataDir, 'usage-widget-maps.json');
  const boundsFile = path.join(dataDir, 'usage-widget-maps-bounds.json');

  let mapsWin = null;
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
  let boundsTimer = null;
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
      // The list is only a shortcut: the maps themselves live in the Maps window's own storage.
      console.error('[maps] could not save the map list:', error.message);
    }
  };

  const stateForRenderers = () => ({ available: Boolean(entry), maps });

  const broadcast = () => {
    for (const target of getTargets()) {
      if (target && !target.isDestroyed()) target.webContents.send('maps-update', stateForRenderers());
    }
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
  // any local program could be listening there and answer, and that page would then get the window.
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

  const closeWithError = (message) => {
    console.error('[maps] closing:', message);
    if (mapsWin && !mapsWin.isDestroyed()) mapsWin.close();
    dialog.showErrorBox('Maps had to close', `${message} Your maps are saved. Try opening Maps again.`);
  };

  // The server died under an open window. The page keeps working on the next request once a new one
  // is up. If the port has gone to some other program, the window closes rather than talk to it.
  async function onServerLost() {
    const lostFor = mapsWin;
    if (!lostFor || lostFor.isDestroyed()) return;
    const now = Date.now();
    restarts = restarts.filter((at) => now - at < RESTART_WINDOW_MS);
    restarts.push(now);
    if (restarts.length > MAX_RESTARTS) {
      closeWithError('The map server keeps stopping.');
      return;
    }
    console.error('[maps] the server stopped unexpectedly, restarting');
    try {
      await startServer();
    } catch (error) {
      // By now the person may have closed that window and opened another. That one is fine.
      if (mapsWin === lostFor && !lostFor.isDestroyed()) closeWithError(error.message);
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

  const loadBounds = () => {
    try {
      const bounds = JSON.parse(fs.readFileSync(boundsFile, 'utf8'));
      if (bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.width)) return clampBounds(bounds);
    } catch { /* first run, or a damaged file: use the default */ }
    return clampBounds(DEFAULT_BOUNDS);
  };

  const saveBoundsSoon = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (!mapsWin || mapsWin.isDestroyed()) return;
      try {
        fs.writeFileSync(boundsFile, JSON.stringify(mapsWin.getBounds()));
      } catch { /* the window simply reopens where it was before */ }
    }, 400);
  };

  const sendPending = () => {
    if (!pending || !mapsWin || mapsWin.isDestroyed()) return;
    mapsWin.webContents.send('maps-open-request', pending);
    pending = null;
  };

  const createWindow = () => {
    prepareSession();
    const created = new BrowserWindow({
      ...loadBounds(),
      minWidth: 720,
      minHeight: 480,
      title: 'Balonche',
      // Balonche's own ground colour, so the window never flashes white while it loads.
      backgroundColor: '#111318',
      autoHideMenuBar: true,
      icon: iconPath,
      webPreferences: {
        preload: path.join(__dirname, 'maps-preload.js'),
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    created.webContents.on('will-navigate', (event, url) => {
      if (!isMapsUrl(url)) event.preventDefault();
    });
    created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    // The app's default menu would let Ctrl+Q here quit the widget too.
    created.setMenu(null);
    // Chromium also reports a failed load as finished, right after the failure.
    let lastLoadFailed = false;
    created.webContents.on('did-finish-load', () => {
      if (!lastLoadFailed) reloads = 0;
      lastLoadFailed = false;
      sendPending();
    });
    // A reload that found no server, which can happen right after it stopped.
    created.webContents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
      if (!isMainFrame || code === ABORTED) return;
      lastLoadFailed = true;
      reloads += 1;
      if (reloads > MAX_RELOADS) {
        closeWithError('The map page could not load.');
        return;
      }
      startServer()
        .then(() => {
          if (!created.isDestroyed()) created.loadURL(`${MAPS_ORIGIN}/`);
        })
        .catch((error) => {
          if (!created.isDestroyed()) closeWithError(error.message);
        });
    });
    created.on('moved', saveBoundsSoon);
    created.on('resized', saveBoundsSoon);
    trackWindow(created);
    created.on('closed', () => {
      if (mapsWin === created) {
        mapsWin = null;
        pending = null;
        stopServer();
      }
    });
    return created;
  };

  const open = async (rawRequest) => {
    const request = cleanOpenRequest(rawRequest);
    if (!entry) return;
    // A double click on "New map" means one new map.
    if (request && request.new) {
      if (Date.now() - lastNewMapAt < NEW_MAP_GUARD_MS) return;
      lastNewMapAt = Date.now();
    }
    if (mapsWin && !mapsWin.isDestroyed()) {
      if (mapsWin.isMinimized()) mapsWin.restore();
      mapsWin.show();
      mapsWin.focus();
      if (request) {
        pending = request;
        // Still loading: did-finish-load delivers it instead.
        if (!mapsWin.webContents.isLoading()) sendPending();
      }
      return;
    }
    pending = request;
    const created = createWindow();
    mapsWin = created;
    try {
      await startServer();
      if (created.isDestroyed()) return;
      await created.loadURL(`${MAPS_ORIGIN}/`);
    } catch (error) {
      console.error('[maps] opening failed:', error.message);
      if (created.isDestroyed()) return;
      created.close();
      dialog.showErrorBox('Maps could not open', `${error.message} Try again in a moment.`);
    }
  };

  ipcMain.on('maps-open', (event, request) => {
    if (isLocalSender(event)) open(request);
  });
  ipcMain.handle('maps-state', (event) => (isLocalSender(event) ? stateForRenderers() : { available: false, maps: [] }));
  // Only the Maps window may report maps, and only from its own page.
  ipcMain.on('maps-report', (event, list) => {
    if (!mapsWin || event.sender !== mapsWin.webContents || !isMapsUrl(event.senderFrame.url)) return;
    const clean = cleanMapsReport(list);
    if (!clean) return;
    maps = clean;
    saveList();
    broadcast();
  });

  return { open, stopServer };
}

module.exports = { createMapsFeature };
