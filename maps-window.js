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
  let starting = null;
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
    if (server) {
      server.kill();
      server = null;
    }
  };

  // Ready means our own child says it holds the port. Asking the port itself would prove nothing:
  // any local program could be listening there and answer, and that page would then get the window.
  const launchServer = async () => {
    await serverExit; // a server stopped a moment ago may still hold the port
    serverToken = crypto.randomBytes(32).toString('hex');
    const child = spawn(process.execPath, [entry], {
      env: { ...childEnv(process.env, os.homedir()), BALONCHE_TOKEN: serverToken },
      cwd: path.dirname(entry),
      // The IPC channel carries the ready message, and it closes when this app dies, even from
      // SIGKILL, which makes the server exit too.
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    server = child;
    const log = (chunk) => console.log(`[maps] ${String(chunk).trimEnd()}`);
    child.stdout.on('data', log);
    child.stderr.on('data', log);
    serverExit = new Promise((resolve) => {
      child.once('exit', resolve);
      child.once('error', resolve);
    });
    await new Promise((resolve, reject) => {
      const fail = () => reject(new Error(`Port ${MAPS_PORT} may be in use by another program.`));
      const timer = setTimeout(fail, START_TIMEOUT_MS);
      child.on('message', (message) => {
        if (message && message.type === 'listening') {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once('error', (error) => {
        clearTimeout(timer);
        console.error('[maps] the server could not start:', error.message);
        fail();
      });
      child.once('exit', () => {
        clearTimeout(timer);
        if (server === child) server = null;
        fail();
      });
    }).catch((error) => {
      if (server === child) stopServer();
      throw error;
    });
  };

  const startServer = () => {
    if (server && !starting) return Promise.resolve();
    starting = starting || launchServer().finally(() => { starting = null; });
    return starting;
  };

  // The page never sees the secret, so nothing it loads could leak it. It is added on the way out.
  const prepareSession = (() => {
    let prepared = false;
    return () => {
      if (prepared) return;
      prepared = true;
      session.fromPartition(PARTITION).webRequest.onBeforeSendHeaders(
        { urls: [`${MAPS_ORIGIN}/api/*`] },
        (details, callback) => {
          callback({ requestHeaders: { ...details.requestHeaders, 'X-Balonche-Token': serverToken } });
        },
      );
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
    created.webContents.on('did-finish-load', sendPending);
    created.on('moved', saveBoundsSoon);
    created.on('resized', saveBoundsSoon);
    trackWindow(created);
    created.on('closed', () => {
      if (mapsWin === created) mapsWin = null;
      pending = null;
      stopServer();
    });
    return created;
  };

  const open = async (rawRequest) => {
    const request = cleanOpenRequest(rawRequest);
    if (!entry) return;
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
      dialog.showErrorBox('Maps could not open', `${error.message} Close it and try again.`);
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
