const {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  Tray,
  Menu,
  ipcMain,
  nativeImage,
  screen,
  powerMonitor,
  shell,
  clipboard,
  Notification,
} = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const url = require('url');
const { spawn } = require('child_process');
const crypto = require('crypto');

// --- HTML entity escaping (prevent injection in OAuth callback responses) ---
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- App version (read from package.json, reliable even with asar repack) ---
let APP_VERSION;
try {
  APP_VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8')).version;
} catch { /* ignore */ }

// --- Constants ---
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
const BOUNDS_FILE = path.join(CLAUDE_DIR, 'usage-widget-bounds.json');
const SETTINGS_FILE = path.join(CLAUDE_DIR, 'usage-widget-settings.json');
const TASKS_FILE = path.join(CLAUDE_DIR, 'usage-widget-tasks.json');
const TASKS_BOUNDS_FILE = path.join(CLAUDE_DIR, 'usage-widget-tasks-bounds.json');
const CALENDAR_FILE = path.join(CLAUDE_DIR, 'usage-widget-calendar.json');
const NOTES_FILE = path.join(CLAUDE_DIR, 'usage-widget-notes.txt');
const STICKY_NOTES_FILE = path.join(CLAUDE_DIR, 'usage-widget-sticky-notes.json');
const NOTES_APP_BOUNDS_FILE = path.join(CLAUDE_DIR, 'usage-widget-notes-app-bounds.json');
const NOTES_ARCHIVE_FILE = path.join(CLAUDE_DIR, 'usage-widget-notes-archive.json');
const POMO_FILE = path.join(CLAUDE_DIR, 'usage-widget-pomo.json');
const HABITS_FILE = path.join(CLAUDE_DIR, 'usage-widget-habits.json');
const HISTORY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const USAGE_API = 'https://api.anthropic.com/api/oauth/usage';
const BETA_HEADER = 'oauth-2025-04-20';
const CLAUDE_STATUS_HOST = 'status.claude.com';
const CLAUDE_STATUS_POLL_MS = 5 * 60 * 1000; // every 5 minutes
const DEFAULT_HOTKEY = 'Ctrl+\\';
let currentHotkey = DEFAULT_HOTKEY;

let win = null;
let tray = null;
let fileWatcher = null;
let fileChangeTimer = null;
let dashWin = null;
let lastAutoSync = 0;
const MIN_SYNC_INTERVAL = 60000; // don't hit API more than once per minute (was 5min)
// Track all intervals/timers that need cleanup on quit
const cleanupTimers = [];
let credsWatchers = [];
let alertPopup = null;

// --- Multi-account state ---
// accountList holds the persisted descriptors; accountCtx holds the live
// per-account runtime (token cache, sync state, backoff) so one account's
// rate limit or expired session can never stall the others.
let accountList = [];
const accountCtx = Object.create(null);
let activeAccountId = null;
// Optional settings.primaryAccount — the account NAME to start on.
let primaryAccountName = null;
// Contents of ~/.claude/active-account.json, written by the CLI launcher so
// the widget can flag which account Claude Code is currently running on.
// Read-only: the widget never writes this file.
let cliActiveAccount = null;
let cliMarkerWatcher = null;
let cliMarkerDebounce = null;
const ALERT_THRESHOLDS = { session: 80, weekAll: 90, weekSonnet: 90 };
let trayHasAlert = false;
let tasksWin = null;
let tasks = [];
let habits = { training: [], reading: [], learning: [] };
let tasksSnapped = 'left';
let calendarSnapped = 'right';
let tasksUserHidden = false; // true when user manually closed/hid the tasks window
let calWasVisible = false;   // remember calendar state across hide/show
let tasksWasVisible = false; // remember tasks state across hide/show
let notesWasVisible = false;
let savedTasksBounds = null;
let savedCalBounds = null;
let savedNotesBounds = null;
let tasksMovedTimer = null;  // debounced snap timer — cleared on hide to prevent stale setBounds
let claudeStatus = null; // { indicator, description, updatedAt }
let calWin = null;
let notesWin = null;
let notesAppWin = null; // standalone Notes app window (own taskbar identity)
let addEventWin = null;
let calendarEvents = [];
let reminderTimers = {};
let streakData = { current: 0, lastDate: null }; // task completion streak

// --- Pomodoro timer (main process — persists across restarts) ---
const POMO_WORK_SECS = 25 * 60; // 25 minutes
const POMO_BREAK_SECS = 5 * 60; // 5 minutes
let pomoState = 'idle'; // idle, running, paused, break
let pomoSeconds = POMO_WORK_SECS;
let pomoTotal = POMO_WORK_SECS;
let pomoInterval = null;

function savePomoState() {
  try {
    fs.writeFileSync(POMO_FILE, JSON.stringify({
      state: pomoState, seconds: pomoSeconds, total: pomoTotal,
      savedAt: Date.now(),
    }));
  } catch { /* ignore */ }
}

function loadPomoState() {
  try {
    if (!fs.existsSync(POMO_FILE)) return;
    const d = JSON.parse(fs.readFileSync(POMO_FILE, 'utf-8'));
    if (d.state === 'running' || d.state === 'paused' || d.state === 'break') {
      const elapsed = Math.round((Date.now() - d.savedAt) / 1000);
      if (d.state === 'running' || d.state === 'break') {
        // Subtract time elapsed while app was closed
        const remaining = d.seconds - elapsed;
        if (remaining > 0) {
          pomoState = d.state;
          pomoSeconds = remaining;
          pomoTotal = d.total;
        }
        // If time ran out while closed, just reset to idle
      } else if (d.state === 'paused') {
        pomoState = 'paused';
        pomoSeconds = d.seconds;
        pomoTotal = d.total;
      }
    }
  } catch { /* ignore */ }
}

function pomoTick() {
  if (pomoSeconds <= 0) {
    clearInterval(pomoInterval);
    pomoInterval = null;
    if (pomoState === 'running') {
      pomoState = 'break_pending';
      pomoSeconds = POMO_BREAK_SECS;
      pomoTotal = POMO_BREAK_SECS;
      broadcastPomo(true);
      if (win && !win.isDestroyed()) win.webContents.send('pomo-complete', 'work');
      showPomoPopup('work');
      return;
    } else if (pomoState === 'break') {
      pomoState = 'idle';
      pomoSeconds = POMO_WORK_SECS;
      pomoTotal = POMO_WORK_SECS;
      if (win && !win.isDestroyed()) win.webContents.send('pomo-complete', 'break');
      showPomoPopup('break');
      broadcastPomo(true);
      return;
    }
  } else {
    pomoSeconds--;
  }
  broadcastPomo(false); // throttled tick save
}

let pomoSaveDebounce = null;
function savePomoStateDebounced() {
  // Throttle disk writes: skip if one is already scheduled within 30s
  if (pomoSaveDebounce) return;
  pomoSaveDebounce = setTimeout(() => {
    pomoSaveDebounce = null;
    savePomoState();
  }, 30000);
}

function broadcastPomo(persistNow) {
  const payload = { state: pomoState, seconds: pomoSeconds, total: pomoTotal };
  if (win && !win.isDestroyed()) win.webContents.send('pomo-update', payload);
  if (pomoPopupWin && !pomoPopupWin.isDestroyed()) {
    if (pomoState === 'break') {
      pomoPopupWin.webContents.send('pomo-popup-break-tick', {
        seconds: pomoSeconds, total: pomoTotal
      });
    } else if (pomoState === 'idle') {
      pomoPopupWin.webContents.send('pomo-popup-break-done');
    }
  }
  // Only persist immediately on state transitions (start/stop/pause); during ticks throttle
  if (persistNow) {
    if (pomoSaveDebounce) { clearTimeout(pomoSaveDebounce); pomoSaveDebounce = null; }
    savePomoState();
  } else {
    savePomoStateDebounced();
  }
}
const STREAK_FILE = path.join(CLAUDE_DIR, 'usage-widget-streak.json'); // id → setTimeout handle
let firedReminders = new Set(); // event IDs whose reminder already fired this session

// --- Secondary account state ---
// --- Pomodoro popup ---
let pomoPopupWin = null;

function showPomoPopup(type) {
  // Close existing popup
  if (pomoPopupWin && !pomoPopupWin.isDestroyed()) {
    pomoPopupWin.close();
    pomoPopupWin = null;
  }

  const display = getWidgetDisplay();
  const wa = display.workArea;
  const popW = 300;
  const popH = 280;

  pomoPopupWin = new BrowserWindow({
    width: popW,
    height: popH,
    x: wa.x + wa.width - popW - 20,
    y: wa.y + wa.height - popH - 20,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    ...POPUP_GLASS_OPTS_FN(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'pomo-popup-preload.js'),
    },
  });
  applyLinuxPopupTransparency(pomoPopupWin);

  pomoPopupWin.on('closed', () => { pomoPopupWin = null; });
  pomoPopupWin.once('ready-to-show', () => {
    if (pomoPopupWin && !pomoPopupWin.isDestroyed()) pomoPopupWin.show();
  });
  pomoPopupWin.loadFile(path.join(__dirname, 'pomo-popup.html'));

  pomoPopupWin.webContents.once('did-finish-load', () => {
    if (!pomoPopupWin || pomoPopupWin.isDestroyed()) return;
    pomoPopupWin.webContents.send('pomo-popup-data', { type });
    sendCurrentTheme(pomoPopupWin);
  });
}

const SYNC_TIMEOUT_MS = 15000; // force-reset syncing flag after 15s

// --- Google Calendar sync ---
const GCAL_CONFIG_FILE = path.join(CLAUDE_DIR, 'usage-widget-gcal.json');
// Google OAuth client credentials — bring your own (Calendar sync is optional).
// Priority: env vars → ~/.claude/usage-widget-google.json → unset (sync stays disabled).
// See the README ("Google Calendar setup") for how to create your own OAuth client.
function loadGoogleCreds() {
  let id = process.env.GCAL_CLIENT_ID || '';
  let secret = process.env.GCAL_CLIENT_SECRET || '';
  if (!id || !secret) {
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(CLAUDE_DIR, 'usage-widget-google.json'), 'utf8'));
      id = id || cfg.client_id || cfg.clientId || '';
      secret = secret || cfg.client_secret || cfg.clientSecret || '';
    } catch { /* no config file — Calendar sync simply stays optional */ }
  }
  return { id, secret };
}
const _googleCreds = loadGoogleCreds();
const GCAL_CLIENT_ID = _googleCreds.id;
const GCAL_CLIENT_SECRET = _googleCreds.secret;
const GCAL_CONFIGURED = !!(GCAL_CLIENT_ID && GCAL_CLIENT_SECRET);
const GCAL_SCOPES = 'https://www.googleapis.com/auth/calendar.readonly';
const GCAL_REDIRECT_PORT = 48271;
const GCAL_SYNC_INTERVAL = 15 * 60 * 1000; // 15 minutes
let gcalAccounts = [];   // [{ email, accessToken, refreshToken, expiresAt }]
let gcalSyncTimer = null;
let gcalLastSync = 0;
let gcalAuthServer = null; // temp HTTP server during OAuth flow

// --- Paths (asar-safe) ---

function getAssetPath(filename) {
  // In production (asar), __dirname is inside the asar archive
  // Assets are unpacked, so use app.getAppPath() for packaged builds
  const assetDir = path.join(__dirname, 'assets');
  if (fs.existsSync(assetDir)) return path.join(assetDir, filename);
  return path.join(app.getAppPath(), 'assets', filename);
}

// The Windows shell (taskbar/setAppDetails) can NOT read icons from inside an
// asar archive — it needs a real file on disk. Copy the icon out once per run.
function getRealIconPath(filename) {
  try {
    const dir = path.join(CLAUDE_DIR, 'usage-widget-icons');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, filename);
    const data = fs.readFileSync(getAssetPath(filename)); // fs is asar-aware
    // Rewrite each launch so icon updates ship with app updates
    fs.writeFileSync(dest, data);
    return dest;
  } catch {
    return getAssetPath(filename); // fallback: better than nothing
  }
}

// Get the display where the widget currently is (fallback to primary)
function getWidgetDisplay() {
  if (win && !win.isDestroyed()) {
    return screen.getDisplayMatching(win.getBounds());
  }
  return screen.getPrimaryDisplay();
}

function getWindowIcon() {
  // Windows taskbar needs .ico; macOS/Linux use .png
  if (process.platform === 'win32') {
    const ico = getAssetPath('icon.ico');
    if (fs.existsSync(ico)) return ico;
  }
  const png = getAssetPath('icon.png');
  return fs.existsSync(png) ? png : undefined;
}

// --- Window bounds persistence ---

function loadBounds() {
  try {
    if (fs.existsSync(BOUNDS_FILE)) {
      const bounds = JSON.parse(fs.readFileSync(BOUNDS_FILE, 'utf-8'));
      // Validate bounds are on a visible screen
      const displays = screen.getAllDisplays();
      const bw = bounds.width || 480;
      const bh = bounds.height || 450;
      const visible = displays.some((d) => {
        const { x, y, width, height } = d.bounds;
        return bounds.x + bw > x + 50 && bounds.x < x + width - 50
          && bounds.y + bh > y + 50 && bounds.y < y + height - 50;
      });
      return visible ? bounds : null;
    }
  } catch { /* ignore */ }
  return null;
}

let boundsDebounce = null;
function getClampedWidgetBounds() {
  if (!win || win.isDestroyed()) return null;
  const b = win.getBounds();
  return {
    x: b.x,
    y: b.y,
    width: Math.min(b.width, 600),
    height: Math.min(b.height, 800),
  };
}
function saveBounds() {
  if (!win) return;
  if (boundsDebounce) clearTimeout(boundsDebounce);
  boundsDebounce = setTimeout(() => {
    const b = getClampedWidgetBounds();
    if (!b) return;
    try {
      fs.writeFileSync(BOUNDS_FILE, JSON.stringify(b));
    } catch { /* ignore */ }
  }, 500);
}
function saveBoundsNow() {
  if (boundsDebounce) { clearTimeout(boundsDebounce); boundsDebounce = null; }
  const b = getClampedWidgetBounds();
  if (!b) return;
  try {
    fs.writeFileSync(BOUNDS_FILE, JSON.stringify(b));
  } catch { /* ignore */ }
}

// --- Accounts: discovery, naming, runtime contexts ---

const HOME_DIR = os.homedir();
const DEFAULT_ACCOUNT_DIR = CLAUDE_DIR;
const DEFAULT_ACCOUNT_ID = path.basename(DEFAULT_ACCOUNT_DIR);
const ACCOUNT_DIR_PREFIX = '.claude-';

function capitalizeWord(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// The signed-in email for a config dir. The default dir keeps it in the sibling
// ~/.claude.json; every named dir keeps its own copy inside the dir.
function readAccountEmail(dir) {
  const file = (dir === DEFAULT_ACCOUNT_DIR)
    ? path.join(HOME_DIR, '.claude.json')
    : path.join(dir, '.claude.json');
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const email = data && data.oauthAccount && data.oauthAccount.emailAddress;
    return (typeof email === 'string' && email.indexOf('@') > 0) ? email : null;
  } catch { return null; }
}

// Generic label: `.claude-<suffix>` -> capitalized suffix; the default dir uses
// the local part of the signed-in email (nothing user-specific is hardcoded).
function accountDisplayName(dir) {
  const base = path.basename(dir);
  if (base === DEFAULT_ACCOUNT_ID) {
    const email = readAccountEmail(dir);
    return email ? capitalizeWord(email.split('@')[0]) : 'Default';
  }
  if (base.indexOf(ACCOUNT_DIR_PREFIX) === 0) {
    return capitalizeWord(base.slice(ACCOUNT_DIR_PREFIX.length)) || base;
  }
  return base;
}

function normalizeEmail(email) {
  return (typeof email === 'string' && email) ? email.trim().toLowerCase() : '';
}

function dirHasCredentials(dir) {
  try { return fs.existsSync(path.join(dir, '.credentials.json')); } catch { return false; }
}

// Discovery re-runs every minute, so a duplicate would otherwise log every
// minute forever. Log each kept/dropped pairing once.
const loggedDuplicates = new Set();

function logDuplicateOnce(email, keptId, droppedId) {
  const key = email + '|' + keptId + '|' + droppedId;
  if (loggedDuplicates.has(key)) return;
  loggedDuplicates.add(key);
  console.log('[accounts] duplicate email - keeping', keptId, ', dropping', droppedId);
}

// Every Claude Code config dir holding credentials: ~/.claude plus ~/.claude-*
function discoverAccountDirs() {
  const dirs = [];
  if (dirHasCredentials(DEFAULT_ACCOUNT_DIR)) dirs.push(DEFAULT_ACCOUNT_DIR);
  try {
    const names = fs.readdirSync(HOME_DIR).sort();
    for (const name of names) {
      if (name.indexOf(ACCOUNT_DIR_PREFIX) !== 0) continue;
      const full = path.join(HOME_DIR, name);
      try { if (!fs.statSync(full).isDirectory()) continue; } catch { continue; }
      if (dirHasCredentials(full)) dirs.push(full);
    }
  } catch { /* ignore */ }
  return dirs;
}

// The default account keeps the original single-account file names so existing
// cached usage and history survive the upgrade untouched.
function accountFileSuffix(id) {
  if (id === DEFAULT_ACCOUNT_ID) return '';
  return '-' + String(id).replace(/[^A-Za-z0-9_-]/g, '_');
}

function makeAccountCtx(acc) {
  const suffix = accountFileSuffix(acc.id);
  return {
    id: acc.id,
    dir: acc.dir,
    name: acc.name,
    email: readAccountEmail(acc.dir),
    credsFile: path.join(acc.dir, '.credentials.json'),
    dataFile: path.join(CLAUDE_DIR, 'usage-widget-data' + suffix + '.json'),
    historyFile: path.join(CLAUDE_DIR, 'usage-widget-history' + suffix + '.json'),
    cachedToken: null,
    tokenLastRead: 0,
    signedOut: false,
    isRefreshing: false,
    refreshRetryTimer: null,
    refreshRetryCount: 0,
    cachedUsage: null,
    history: [],
    lastSuccessfulSync: 0,
    rateLimitUntil: 0,
    retryTimer: null,
    retryCount: 0,
    staggerTimer: null,
    syncing: false,
    syncStartedAt: 0,
    activeRequest: null,
    lastError: null,
    needsLogin: false,
    lastAlertedStep: { session: -1, weekAll: -1, weekSonnet: -1 },
  };
}

function destroyAccountCtx(id) {
  const ctx = accountCtx[id];
  if (!ctx) return;
  if (ctx.retryTimer) { clearTimeout(ctx.retryTimer); ctx.retryTimer = null; }
  if (ctx.refreshRetryTimer) { clearTimeout(ctx.refreshRetryTimer); ctx.refreshRetryTimer = null; }
  if (ctx.staggerTimer) { clearTimeout(ctx.staggerTimer); ctx.staggerTimer = null; }
  if (ctx.activeRequest) { try { ctx.activeRequest.destroy(); } catch { /* ignore */ } ctx.activeRequest = null; }
  delete accountCtx[id];
}

// Merge persisted accounts with a fresh discovery pass: new dirs are added,
// user-edited names/enabled flags are kept.
function initAccounts() {
  const byId = Object.create(null);
  const merged = [];
  for (const acc of accountList) {
    if (!acc || typeof acc.dir !== 'string') continue;
    const id = (typeof acc.id === 'string' && acc.id) ? acc.id : path.basename(acc.dir);
    if (byId[id]) continue;
    // `autoName` is the label we derived last time. If the stored name still
    // equals it, the label is ours to refresh (a dir can be re-authenticated to
    // a different account); if it differs, the user renamed it — leave it.
    const derived = accountDisplayName(acc.dir);
    const stored = (typeof acc.name === 'string' && acc.name) ? acc.name : derived;
    const userRenamed = typeof acc.autoName === 'string' && acc.autoName !== stored;
    const entry = {
      id,
      dir: acc.dir,
      name: userRenamed ? stored : derived,
      autoName: derived,
      enabled: acc.enabled !== false,
    };
    byId[id] = entry;
    merged.push(entry);
  }
  for (const dir of discoverAccountDirs()) {
    const id = path.basename(dir);
    if (byId[id]) continue;
    const derived = accountDisplayName(dir);
    const entry = { id, dir, name: derived, autoName: derived, enabled: true };
    byId[id] = entry;
    merged.push(entry);
  }
  // One account per signed-in email. `/login` in the default dir can point
  // ~/.claude at an account that already has its own ~/.claude-<name> dir; the
  // named dir wins because it is the stable one. Entries with no readable email
  // are always kept — we cannot prove they are duplicates.
  const byEmail = Object.create(null);
  const deduped = [];
  for (const entry of merged) {
    const email = normalizeEmail(readAccountEmail(entry.dir));
    if (!email) { deduped.push(entry); continue; }
    const seen = byEmail[email];
    if (!seen) { byEmail[email] = entry; deduped.push(entry); continue; }
    // Prefer the named dir over the default one.
    const seenIsDefault = seen.id === DEFAULT_ACCOUNT_ID;
    const entryIsDefault = entry.id === DEFAULT_ACCOUNT_ID;
    if (seenIsDefault && !entryIsDefault) {
      logDuplicateOnce(email, entry.id, seen.id);
      deduped[deduped.indexOf(seen)] = entry;
      byEmail[email] = entry;
      if (accountCtx[seen.id]) destroyAccountCtx(seen.id);
    } else {
      logDuplicateOnce(email, seen.id, entry.id);
      if (accountCtx[entry.id]) destroyAccountCtx(entry.id);
    }
  }
  for (const id of Object.keys(byId)) {
    if (!deduped.some((e) => e.id === id)) delete byId[id];
  }
  accountList = deduped;

  for (const acc of accountList) {
    const existing = accountCtx[acc.id];
    if (!existing) {
      accountCtx[acc.id] = makeAccountCtx(acc);
    } else {
      existing.name = acc.name;
      existing.dir = acc.dir;
      existing.credsFile = path.join(acc.dir, '.credentials.json');
      // Re-read: a dir can be re-authenticated to a different account.
      existing.email = readAccountEmail(acc.dir);
    }
  }
  for (const id of Object.keys(accountCtx)) {
    if (!byId[id]) destroyAccountCtx(id);
  }

  // Default active account: settings.primaryAccount by name, else the default
  // dir's account when it survived dedupe, else the first enabled one.
  const activeEntry = activeAccountId ? byId[activeAccountId] : null;
  if (!activeEntry || activeEntry.enabled === false) {
    const usable = (e) => e && e.enabled !== false;
    const wanted = primaryAccountName
      ? accountList.find((a) => usable(a) && a.name.toLowerCase() === primaryAccountName.toLowerCase())
      : null;
    const preferred = wanted
      || (usable(byId[DEFAULT_ACCOUNT_ID]) ? byId[DEFAULT_ACCOUNT_ID] : null)
      || accountList.find(usable)
      || accountList[0];
    activeAccountId = preferred ? preferred.id : null;
  }
}

// --- Live account discovery ---
// A `claude auth login` into a brand new ~/.claude-<name> dir must show up
// without restarting the app, and a dir whose credentials are deleted must drop
// out. Both are a cheap directory scan, so re-run it on a timer and on the
// widget's manual refresh.
const ACCOUNT_DISCOVERY_INTERVAL_MS = 60 * 1000;

function accountsSignature() {
  return accountList
    .map((a) => a.id + ':' + a.name + ':' + (a.enabled !== false ? '1' : '0'))
    .join('|') + '>' + activeAccountId;
}

function rediscoverAccounts(reason) {
  const beforeSig = accountsSignature();
  const beforeIds = Object.keys(accountCtx);

  // Drop accounts whose credentials file is gone (logged out, dir deleted).
  // The default dir always stays listed so a fresh install can show sign-in.
  accountList = accountList.filter(
    (a) => a.id === DEFAULT_ACCOUNT_ID || dirHasCredentials(a.dir)
  );

  initAccounts(); // re-scans ~/.claude-*, merges names, applies email dedupe

  if (accountsSignature() === beforeSig) return;

  // Hydrate anything new, then give it exactly one sync of its own.
  const added = [];
  for (const id of Object.keys(accountCtx)) {
    if (beforeIds.indexOf(id) >= 0) continue;
    const ctx = accountCtx[id];
    loadAccountState(ctx);
    ctx.history = loadHistory(ctx);
    added.push(ctx);
  }

  console.log('[accounts] re-discovery (' + reason + '):',
    accountList.map((a) => a.id).join(', ') || '(none)');
  saveSettings();
  updateTrayTooltip();
  broadcastUsage();
  // A manual refresh syncs every account straight after this call, so leave the
  // new ones to it rather than spending a second request on them.
  if (reason === 'manual') return;
  added.forEach((ctx, i) => {
    if (ctx.staggerTimer) { clearTimeout(ctx.staggerTimer); ctx.staggerTimer = null; }
    ctx.staggerTimer = setTimeout(() => {
      ctx.staggerTimer = null;
      doSync(ctx);
    }, i * ACCOUNT_SYNC_STAGGER_MS);
  });
}

// --- CLI marker: which account Claude Code itself is running on ---
//
// ~/.claude/active-account.json is OWNED by the CLI launcher. The widget is a
// strictly READ-ONLY consumer: it never creates, writes or deletes this file.
// Canonical schema {id, name, email, dir, chosenAt (seconds), reason,
// five_hour, seven_day, next, launcher} — every field is optional here; only
// `email` is used for matching, so a schema change cannot break the widget.
const ACTIVE_ACCOUNT_FILE = path.join(CLAUDE_DIR, 'active-account.json');
const CLI_MARKER_POLL_MS = 60 * 1000;
const CLI_MARKER_DEBOUNCE_MS = 500;
const DEFAULT_LAUNCHER_NAME = 'Claude Code';

function readCliActiveAccount() {
  try {
    const data = JSON.parse(fs.readFileSync(ACTIVE_ACCOUNT_FILE, 'utf-8'));
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
  } catch { /* missing or unreadable — no tag */ }
  return null;
}

// The launcher is being renamed (cc -> clx/ccl), so never hardcode it: take the
// name it reports, fall back to the product name.
function cliLauncherName() {
  const raw = cliActiveAccount && cliActiveAccount.launcher;
  if (typeof raw !== 'string') return DEFAULT_LAUNCHER_NAME;
  const clean = raw.trim().slice(0, 24);
  return /^[\w .+-]+$/.test(clean) ? clean : DEFAULT_LAUNCHER_NAME;
}

// Re-read the marker; broadcast only when what we display actually changed.
function refreshCliActiveAccount() {
  const next = readCliActiveAccount();
  const beforeEmail = normalizeEmail(cliActiveAccount && cliActiveAccount.email);
  const beforeLauncher = cliLauncherName();
  const afterEmail = normalizeEmail(next && next.email);
  cliActiveAccount = next;
  if (beforeEmail !== afterEmail || beforeLauncher !== cliLauncherName()) {
    updateTrayTooltip();
    broadcastUsage();
  }
}

function startCliMarkerWatcher() {
  refreshCliActiveAccount();
  // Watch the directory, not the file: the launcher replaces it by rename.
  try {
    fs.mkdirSync(CLAUDE_DIR, { recursive: true });
    cliMarkerWatcher = fs.watch(CLAUDE_DIR, (_, filename) => {
      if (filename && filename !== 'active-account.json') return;
      if (cliMarkerDebounce) clearTimeout(cliMarkerDebounce);
      cliMarkerDebounce = setTimeout(() => {
        cliMarkerDebounce = null;
        refreshCliActiveAccount();
      }, CLI_MARKER_DEBOUNCE_MS);
    });
  } catch { /* watch unavailable — the poll below still catches changes */ }
  const poll = setInterval(refreshCliActiveAccount, CLI_MARKER_POLL_MS);
  cleanupTimers.push(poll);
}

function isCliActive(ctx) {
  const marker = normalizeEmail(cliActiveAccount && cliActiveAccount.email);
  if (!marker) return false;
  return normalizeEmail(ctx.email) === marker;
}

function enabledAccounts() {
  const out = [];
  for (const acc of accountList) {
    if (acc.enabled === false) continue;
    const ctx = accountCtx[acc.id];
    if (ctx) out.push(ctx);
  }
  return out;
}

function getActiveCtx() {
  if (activeAccountId && accountCtx[activeAccountId]) return accountCtx[activeAccountId];
  const list = enabledAccounts();
  return list.length > 0 ? list[0] : null;
}

function activeUsage() {
  const ctx = getActiveCtx();
  return ctx ? ctx.cachedUsage : null;
}

function activeHistory() {
  const ctx = getActiveCtx();
  return ctx ? ctx.history : [];
}

// --- Load/save cached data (per account) ---

// Restores this account's last usage AND any unexpired rate-limit backoff — the
// API's token bucket does not reset because the app restarted, so neither should
// our backoff, or every launch would spend a request on a throttled token.
function loadAccountState(ctx) {
  try {
    if (fs.existsSync(ctx.dataFile)) {
      const data = JSON.parse(fs.readFileSync(ctx.dataFile, 'utf-8'));
      ctx.cachedUsage = data.usage || null;
      const until = Number(data.rateLimitUntil);
      if (Number.isFinite(until) && until > Date.now()) ctx.rateLimitUntil = until;
    }
  } catch { /* ignore */ }
}

function saveCachedUsage(ctx) {
  try {
    fs.writeFileSync(ctx.dataFile, JSON.stringify({
      lastSync: Date.now(),
      usage: ctx.cachedUsage,
      rateLimitUntil: ctx.rateLimitUntil || 0,
    }, null, 2));
  } catch { /* ignore */ }
}

// --- Usage history (per account) ---

function loadHistory(ctx) {
  try {
    if (fs.existsSync(ctx.historyFile)) {
      const data = JSON.parse(fs.readFileSync(ctx.historyFile, 'utf-8'));
      if (data.version === 1 && Array.isArray(data.points)) {
        return data.points;
      }
    }
  } catch { /* ignore */ }
  return [];
}

function saveHistory(ctx) {
  try {
    fs.writeFileSync(ctx.historyFile, JSON.stringify({
      version: 1,
      points: ctx.history,
    }, null, 2));
  } catch { /* ignore */ }
}

function appendHistory(ctx) {
  const usage = ctx.cachedUsage;
  if (!usage) return;
  const point = {
    ts: Date.now(),
    session: usage.session.pct,
    weekAll: usage.weekAll.pct,
    weekSonnet: usage.weekSonnet.pct,
  };

  // Deduplicate: skip if values unchanged from last point
  const last = ctx.history[ctx.history.length - 1];
  if (last
    && last.session === point.session
    && last.weekAll === point.weekAll
    && last.weekSonnet === point.weekSonnet) {
    return;
  }

  ctx.history.push(point);

  // Prune points older than 30 days
  const cutoff = Date.now() - HISTORY_MAX_AGE_MS;
  ctx.history = ctx.history.filter((p) => p.ts > cutoff);

  saveHistory(ctx);
}

// --- Settings persistence ---

// Validate hotkey accelerator format before passing to globalShortcut
const SAFE_HOTKEY_RE = /^(Ctrl|Alt|Shift|Super|Cmd|Command)(\+(Ctrl|Alt|Shift|Super|Cmd|Command))*\+[A-Za-z0-9\\[\];',./`\-=F]$/;

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      if (data.hotkey && typeof data.hotkey === 'string'
        && data.hotkey.length <= 50 && SAFE_HOTKEY_RE.test(data.hotkey)) {
        currentHotkey = data.hotkey;
      }
      if (data.alertThresholds) {
        if (typeof data.alertThresholds.session === 'number') {
          ALERT_THRESHOLDS.session = data.alertThresholds.session;
        }
        if (typeof data.alertThresholds.weekAll === 'number') {
          ALERT_THRESHOLDS.weekAll = data.alertThresholds.weekAll;
        }
        if (typeof data.alertThresholds.weekSonnet === 'number') {
          ALERT_THRESHOLDS.weekSonnet = data.alertThresholds.weekSonnet;
        }
      }
      if (data.theme && THEMES[data.theme]) {
        currentTheme = data.theme;
      }
      if (Array.isArray(data.accounts)) {
        accountList = data.accounts
          .filter((a) => a && typeof a.dir === 'string'
            && path.basename(a.dir).indexOf(DEFAULT_ACCOUNT_ID) === 0)
          .map((a) => ({
            id: (typeof a.id === 'string' && a.id) ? a.id : path.basename(a.dir),
            dir: a.dir,
            name: (typeof a.name === 'string' && a.name) ? a.name.slice(0, 40) : accountDisplayName(a.dir),
            autoName: typeof a.autoName === 'string' ? a.autoName.slice(0, 40) : null,
            enabled: a.enabled !== false,
          }));
      }
      if (typeof data.activeAccountId === 'string') {
        activeAccountId = data.activeAccountId;
      }
      if (typeof data.primaryAccount === 'string' && data.primaryAccount) {
        primaryAccountName = data.primaryAccount.slice(0, 40);
      }
    }
  } catch { /* ignore */ }
}

function saveSettings() {
  try {
    const obj = {
      hotkey: currentHotkey,
      alertThresholds: {
        session: ALERT_THRESHOLDS.session,
        weekAll: ALERT_THRESHOLDS.weekAll,
        weekSonnet: ALERT_THRESHOLDS.weekSonnet,
      },
    };
    if (currentTheme && currentTheme !== 'dark') {
      obj.theme = currentTheme;
    }
    if (accountList.length > 0) {
      obj.accounts = accountList.map((a) => ({
        id: a.id, name: a.name, autoName: a.autoName, dir: a.dir, enabled: a.enabled !== false,
      }));
      obj.activeAccountId = activeAccountId;
    }
    if (primaryAccountName) obj.primaryAccount = primaryAccountName;
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(obj, null, 2));
  } catch (err) { console.error('[settings] Save failed:', err.message); }
}

// --- Task persistence ---

function loadTasks() {
  try {
    if (fs.existsSync(TASKS_FILE)) {
      const data = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf-8'));
      return Array.isArray(data.tasks) ? data.tasks : [];
    }
  } catch { /* ignore */ }
  return [];
}

function saveTasks() {
  try {
    fs.writeFileSync(TASKS_FILE, JSON.stringify({ tasks }, null, 2));
  } catch { /* ignore */ }
}

// --- Habits persistence ---

function loadHabits() {
  try {
    if (fs.existsSync(HABITS_FILE)) {
      const data = JSON.parse(fs.readFileSync(HABITS_FILE, 'utf-8'));
      return {
        training: Array.isArray(data.training) ? data.training : [],
        reading: Array.isArray(data.reading) ? data.reading : [],
        learning: Array.isArray(data.learning) ? data.learning : [],
      };
    }
  } catch { /* ignore */ }
  return { training: [], reading: [], learning: [] };
}

function saveHabits() {
  try {
    fs.writeFileSync(HABITS_FILE, JSON.stringify(habits, null, 2));
  } catch { /* ignore */ }
}

function broadcastHabits() {
  if (dashWin && !dashWin.isDestroyed()) {
    dashWin.webContents.send('habits-update', habits);
  }
  if (win && !win.isDestroyed()) {
    win.webContents.send('habits-update', habits);
  }
}

function isValidDateStr(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function broadcastTasks() {
  // Enrich tasks with linked calendar event dates
  const payload = tasks.map((t) => {
    const linked = calendarEvents.find((e) => e.linkedTaskId === t.id);
    if (linked) {
      return Object.assign({}, t, { dueDate: linked.date, dueTime: linked.time || null });
    }
    return t;
  });
  if (tasksWin && !tasksWin.isDestroyed()) {
    tasksWin.webContents.send('tasks-update', payload);
  }
  if (dashWin && !dashWin.isDestroyed()) {
    dashWin.webContents.send('tasks-update', payload);
  }
  // Update badges on widget
  const pendingCount = tasks.filter((t) => !t.done).length;
  if (win && !win.isDestroyed()) {
    win.webContents.send('badge-update', { tasks: pendingCount });
  }
  updateStreak();
}

// --- Calendar persistence ---

function loadCalendarEvents() {
  try {
    if (fs.existsSync(CALENDAR_FILE)) {
      const data = JSON.parse(fs.readFileSync(CALENDAR_FILE, 'utf-8'));
      if (data.version === 1 && Array.isArray(data.events)) {
        return data.events;
      }
    }
  } catch { /* ignore */ }
  return [];
}

function saveCalendarEvents() {
  try {
    fs.writeFileSync(CALENDAR_FILE, JSON.stringify({
      version: 1,
      events: calendarEvents,
    }, null, 2));
  } catch { /* ignore */ }
}

// --- Google Calendar: config persistence ---

function loadGcalConfig() {
  try {
    if (fs.existsSync(GCAL_CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(GCAL_CONFIG_FILE, 'utf-8'));
      if (Array.isArray(data.accounts)) return data.accounts;
    }
  } catch { /* ignore */ }
  return [];
}

function saveGcalConfig() {
  try {
    fs.writeFileSync(GCAL_CONFIG_FILE, JSON.stringify({
      accounts: gcalAccounts.map((a) => ({
        email: a.email,
        accessToken: a.accessToken,
        refreshToken: a.refreshToken,
        expiresAt: a.expiresAt,
      })),
    }, null, 2));
  } catch { /* ignore */ }
}

// --- Google Calendar: OAuth2 flow ---

function startGoogleAuth() {
  return new Promise((resolve, reject) => {
    if (!GCAL_CONFIGURED) {
      reject(new Error('Google Calendar isn’t configured. Add your own OAuth client credentials to ~/.claude/usage-widget-google.json — see the README ("Google Calendar setup").'));
      return;
    }
    // Generate state param for CSRF protection
    const state = crypto.randomBytes(16).toString('hex');

    // Start loopback HTTP server to receive callback
    if (gcalAuthServer) { try { gcalAuthServer.close(); } catch { /* */ } }
    gcalAuthServer = http.createServer((req, res) => {
      const parsed = url.parse(req.url, true);
      if (parsed.pathname !== '/callback') {
        res.writeHead(404); res.end(); return;
      }
      const code = parsed.query.code;
      const returnedState = parsed.query.state;
      const error = parsed.query.error;

      if (error || !code || returnedState !== state) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body style="font-family:system-ui;text-align:center;padding:60px;background:#1a1a2e;color:#e0e0e0"><h2>Authorization failed</h2><p>You can close this tab.</p></body></html>');
        gcalAuthServer.close(); gcalAuthServer = null;
        reject(new Error(error || 'No authorization code'));
        return;
      }

      // Exchange code for tokens
      exchangeGcalCode(code).then((account) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body style="font-family:system-ui;text-align:center;padding:60px;background:#1a1a2e;color:#e0e0e0"><h2>Connected!</h2><p>Google Calendar linked to Claude Meter. You can close this tab.</p></body></html>');
        gcalAuthServer.close(); gcalAuthServer = null;
        resolve(account);
      }).catch((err) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body style="font-family:system-ui;text-align:center;padding:60px;background:#1a1a2e;color:#e0e0e0"><h2>Error</h2><p>' + escapeHtml(err.message || 'Token exchange failed') + '</p></body></html>');
        gcalAuthServer.close(); gcalAuthServer = null;
        reject(err);
      });
    });

    gcalAuthServer.listen(GCAL_REDIRECT_PORT, '127.0.0.1', () => {
      const redirectUri = `http://127.0.0.1:${GCAL_REDIRECT_PORT}/callback`;
      const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth'
        + '?client_id=' + encodeURIComponent(GCAL_CLIENT_ID)
        + '&redirect_uri=' + encodeURIComponent(redirectUri)
        + '&response_type=code'
        + '&scope=' + encodeURIComponent(GCAL_SCOPES)
        + '&access_type=offline'
        + '&prompt=consent'
        + '&state=' + state;
      shell.openExternal(authUrl);
    });

    gcalAuthServer.on('error', (err) => {
      gcalAuthServer = null;
      reject(err);
    });

    // Timeout after 2 minutes
    setTimeout(() => {
      if (gcalAuthServer) {
        gcalAuthServer.close(); gcalAuthServer = null;
        reject(new Error('Authorization timed out'));
      }
    }, 120000);
  });
}

function exchangeGcalCode(code) {
  return new Promise((resolve, reject) => {
    const redirectUri = `http://127.0.0.1:${GCAL_REDIRECT_PORT}/callback`;
    const postData = JSON.stringify({
      code,
      client_id: GCAL_CLIENT_ID,
      client_secret: GCAL_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });

    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error('Token exchange failed: ' + res.statusCode));
          return;
        }
        try {
          const data = JSON.parse(body);
          if (!data.access_token) { reject(new Error('No access token')); return; }
          // Get user email
          fetchGcalUserEmail(data.access_token).then((email) => {
            const account = {
              email,
              accessToken: data.access_token,
              refreshToken: data.refresh_token || null,
              expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : 0,
            };
            // Replace existing account with same email or add new
            const idx = gcalAccounts.findIndex((a) => a.email === email);
            if (idx >= 0) {
              gcalAccounts[idx] = account;
            } else {
              gcalAccounts.push(account);
            }
            saveGcalConfig();
            resolve(account);
          }).catch(() => {
            // Can't get email — use placeholder
            const account = {
              email: 'Account ' + (gcalAccounts.length + 1),
              accessToken: data.access_token,
              refreshToken: data.refresh_token || null,
              expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : 0,
            };
            gcalAccounts.push(account);
            saveGcalConfig();
            resolve(account);
          });
        } catch { reject(new Error('Invalid token response')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(postData);
    req.end();
  });
}

function fetchGcalUserEmail(accessToken) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'www.googleapis.com',
      path: '/oauth2/v2/userinfo?fields=email',
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + accessToken },
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve(data.email || 'Unknown');
        } catch { reject(new Error('Failed to get email')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// --- Google Calendar: token refresh ---

function refreshGcalToken(account) {
  return new Promise((resolve, reject) => {
    if (!account.refreshToken) { reject(new Error('No refresh token')); return; }
    const postData = JSON.stringify({
      client_id: GCAL_CLIENT_ID,
      client_secret: GCAL_CLIENT_SECRET,
      refresh_token: account.refreshToken,
      grant_type: 'refresh_token',
    });
    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error('Refresh failed: ' + res.statusCode));
          return;
        }
        try {
          const data = JSON.parse(body);
          account.accessToken = data.access_token;
          if (data.refresh_token) account.refreshToken = data.refresh_token;
          account.expiresAt = data.expires_in ? Date.now() + data.expires_in * 1000 : 0;
          saveGcalConfig();
          resolve(account);
        } catch { reject(new Error('Invalid refresh response')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(postData);
    req.end();
  });
}

async function getValidGcalToken(account) {
  if (account.expiresAt && account.expiresAt < Date.now() + 60000) {
    await refreshGcalToken(account);
  }
  return account.accessToken;
}

// --- Google Calendar: fetch events ---

async function fetchGcalEvents(account, retryCount) {
  if (retryCount === undefined) retryCount = 0;
  var token = await getValidGcalToken(account);

  // Fetch events from 7 days ago to 30 days ahead
  var now = new Date();
  var timeMin = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  var timeMax = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

  var params = '?timeMin=' + encodeURIComponent(timeMin)
    + '&timeMax=' + encodeURIComponent(timeMax)
    + '&singleEvents=true&orderBy=startTime&maxResults=250';

  return new Promise(function (resolve, reject) {
    var req = https.request({
      hostname: 'www.googleapis.com',
      path: '/calendar/v3/calendars/primary/events' + params,
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token },
    }, function (res) {
      var body = '';
      res.on('data', function (c) { body += c; });
      res.on('end', function () {
        if (res.statusCode === 401) {
          // Token invalid — retry once after refresh
          if (retryCount > 1) {
            reject(new Error('Google Calendar API: 401 after retry'));
            return;
          }
          refreshGcalToken(account).then(function () {
            return fetchGcalEvents(account, retryCount + 1);
          }).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error('Google Calendar API: ' + res.statusCode));
          return;
        }
        try {
          var data = JSON.parse(body);
          var events = (data.items || []).map(function (item) {
            var startDate, startTime = null, duration = null;
            if (item.start.dateTime) {
              // Convert to local time using Date object (handles timezone offsets)
              var localStart = new Date(item.start.dateTime);
              startDate = localStart.getFullYear() + '-'
                + String(localStart.getMonth() + 1).padStart(2, '0') + '-'
                + String(localStart.getDate()).padStart(2, '0');
              startTime = String(localStart.getHours()).padStart(2, '0') + ':'
                + String(localStart.getMinutes()).padStart(2, '0');
              if (item.end && item.end.dateTime) {
                var localEnd = new Date(item.end.dateTime);
                duration = Math.round((localEnd.getTime() - localStart.getTime()) / 60000);
              }
            } else {
              // All-day event — date only
              startDate = (item.start.date || '').slice(0, 10);
            }
            return {
              id: 'gcal:' + account.email + ':' + item.id,
              title: item.summary || '(No title)',
              date: startDate,
              time: startTime,
              duration: duration,
              color: item.colorId ? googleColorMap(item.colorId) : '#4285f4',
              reminder: true,
              recurrence: null,
              recurringParentId: null,
              googleEventId: item.id,
              googleAccount: account.email,
              googleLink: item.htmlLink || null,
              meetLink: extractMeetLink(item),
              createdAt: Date.now(),
              isGoogleEvent: true,
            };
          });
          resolve(events);
        } catch (_e) { reject(new Error('Invalid Calendar response')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, function () { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// Extract the joinable meeting URL from a Google Calendar event:
// Meet's hangoutLink → conferenceData video entry point → known-provider URL in location/description
function extractMeetLink(item) {
  if (item.hangoutLink) return item.hangoutLink;
  const eps = item.conferenceData && item.conferenceData.entryPoints;
  if (Array.isArray(eps)) {
    const video = eps.find((e) => e && e.entryPointType === 'video' && e.uri);
    if (video) return video.uri;
  }
  const RX = /https:\/\/[^\s<>"']*(?:meet\.google\.com|zoom\.us|teams\.microsoft\.com|teams\.live\.com|webex\.com|whereby\.com|meet\.jit\.si)[^\s<>"']*/i;
  for (const field of [item.location, item.description]) {
    if (typeof field === 'string') {
      const m = field.match(RX);
      if (m) return m[0];
    }
  }
  return null;
}

// Any https URL in free text (lets local events carry a pasted meeting link in the title)
function firstUrlInText(s) {
  const m = typeof s === 'string' && s.match(/https:\/\/[^\s<>"']+/);
  return m ? m[0] : null;
}

function eventJoinLink(evt) {
  return (evt && (evt.meetLink || firstUrlInText(evt.title))) || null;
}

function googleColorMap(colorId) {
  // Google Calendar event color IDs → hex
  const colors = {
    '1': '#7986cb', '2': '#33b679', '3': '#8e24aa', '4': '#e67c73',
    '5': '#f6bf26', '6': '#f4511e', '7': '#039be5', '8': '#616161',
    '9': '#3f51b5', '10': '#0b8043', '11': '#d50000',
  };
  return colors[colorId] || '#4285f4';
}

// --- Google Calendar: sync logic ---

async function syncGoogleCalendars() {
  if (gcalAccounts.length === 0) return;

  let allGoogleEvents = [];
  const errors = [];

  for (const account of gcalAccounts) {
    try {
      const events = await fetchGcalEvents(account);
      allGoogleEvents = allGoogleEvents.concat(events);
    } catch (err) {
      errors.push({ email: account.email, error: err.message });
    }
  }

  // Remove old Google events from local calendar
  calendarEvents = calendarEvents.filter((e) => !e.isGoogleEvent);

  // Add fresh Google events
  calendarEvents = calendarEvents.concat(allGoogleEvents);

  saveCalendarEvents();
  gcalLastSync = Date.now();
  broadcastCalendar();
  scheduleReminders();

  // Broadcast sync status to dashboard
  if (dashWin && !dashWin.isDestroyed()) {
    dashWin.webContents.send('gcal-sync-status', {
      accounts: gcalAccounts.map((a) => ({ email: a.email })),
      lastSync: gcalLastSync,
      errors,
    });
  }
}

function startGcalSyncTimer() {
  if (gcalSyncTimer) clearInterval(gcalSyncTimer);
  if (gcalAccounts.length > 0) {
    gcalSyncTimer = setInterval(() => syncGoogleCalendars(), GCAL_SYNC_INTERVAL);
  }
}

// --- Streak tracking ---
function loadStreak() {
  try {
    if (fs.existsSync(STREAK_FILE)) {
      return JSON.parse(fs.readFileSync(STREAK_FILE, 'utf-8'));
    }
  } catch { /* ignore */ }
  return { current: 0, lastDate: null };
}

function saveStreak() {
  try {
    fs.writeFileSync(STREAK_FILE, JSON.stringify(streakData, null, 2));
  } catch { /* ignore */ }
}

function updateStreak() {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  // Check if all active tasks were completed today
  const activeTasks = tasks.filter((t) => !t.done);
  const completedToday = tasks.filter((t) => t.done && t.completedAt
    && new Date(t.completedAt).toISOString().slice(0, 10) === today);

  if (completedToday.length > 0 && activeTasks.length === 0) {
    // All tasks done today
    if (streakData.lastDate === yesterday || streakData.lastDate === today) {
      if (streakData.lastDate !== today) streakData.current++;
    } else {
      streakData.current = 1;
    }
    streakData.lastDate = today;
  } else if (streakData.lastDate && streakData.lastDate !== today && streakData.lastDate !== yesterday) {
    // Streak broken
    streakData.current = 0;
  }

  saveStreak();
  broadcastStreak();
}

function broadcastStreak() {
  const payload = streakData;
  if (win && !win.isDestroyed()) {
    win.webContents.send('streak-update', payload);
  }
}

// --- Daily digest ---
let digestTimer = null;
let digestShownToday = null; // date string of last shown digest

function scheduleDailyDigest() {
  // Show 5 minutes after system wake from sleep
  powerMonitor.on('resume', () => {
    const today = new Date().toISOString().slice(0, 10);
    if (digestShownToday !== today) {
      if (digestTimer) clearTimeout(digestTimer);
      digestTimer = setTimeout(() => {
        digestShownToday = today;
        showDailyDigest();
      }, 5 * 60 * 1000); // 5 minutes after wake
    }
  });
}

// Called when widget is first shown each day
function tryShowDigestOnOpen() {
  const today = new Date().toISOString().slice(0, 10);
  if (digestShownToday !== today) {
    digestShownToday = today;
    // Small delay so the widget finishes rendering first
    setTimeout(showDailyDigest, 3000);
  }
}

function showDailyDigest() {
  const today = new Date().toISOString().slice(0, 10);
  const todayEvents = calendarEvents.filter((e) => e.date === today);
  const pendingTasks = tasks.filter((t) => !t.done);
  const highPriority = pendingTasks.filter((t) => t.priority === 'high');

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : (hour < 17 ? 'Good afternoon' : 'Good evening');
  // Structured line-per-fact body; the popup renders it with white-space: pre-line
  const lines = [];
  if (todayEvents.length > 0) {
    lines.push(todayEvents.length + ' event' + (todayEvents.length > 1 ? 's' : '') + ' today');
    for (const e of todayEvents) {
      lines.push('\u2022 ' + (e.time || 'All day') + ' \u2014 ' + e.title);
    }
  } else {
    lines.push('No events today');
  }
  let taskLine = pendingTasks.length + ' pending task' + (pendingTasks.length !== 1 ? 's' : '');
  if (highPriority.length > 0) {
    taskLine += ' (' + highPriority.length + ' high priority)';
  }
  lines.push(taskLine);
  const digestUsage = activeUsage();
  if (digestUsage) {
    lines.push('Session ' + digestUsage.session.pct + '% \u00b7 Week ' + digestUsage.weekAll.pct + '%');
  }
  const summary = lines.join('\n');

  // Show as a popup
  if (alertPopup && !alertPopup.isDestroyed()) { alertPopup.close(); alertPopup = null; }
  const display = getWidgetDisplay();
  const wa = display.workArea; const sw = wa.x + wa.width; const sh = wa.y + wa.height;
  // Height adapts to the number of digest lines so nothing clips and no dead space
  const popH = Math.min(380, 168 + lines.length * 20);
  alertPopup = new BrowserWindow({
    width: 340, height: popH, x: sw - 360, y: sh - popH - 20,
    frame: false, resizable: false, skipTaskbar: true, alwaysOnTop: true, show: false,
    ...POPUP_GLASS_OPTS_FN(),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true,
      preload: path.join(__dirname, 'popup-preload.js') },
  });
  applyLinuxPopupTransparency(alertPopup);
  { const ref = alertPopup; alertPopup.on('closed', () => { if (alertPopup === ref) alertPopup = null; }); }
  alertPopup.once('ready-to-show', () => { if (alertPopup && !alertPopup.isDestroyed()) alertPopup.showInactive(); });
  alertPopup.loadFile(path.join(__dirname, 'popup.html'));
  alertPopup.webContents.once('did-finish-load', () => {
    if (!alertPopup || alertPopup.isDestroyed()) return;
    alertPopup.webContents.send('popup-data', {
      type: 'reminder', severity: 'reminder', digest: true,
      label: greeting,
      pct: 0, resetText: summary, color: 'purple',
    });
    sendCurrentTheme(alertPopup);
  });
}

// --- Theme system ---
let currentTheme = 'brutal'; // 'brutal', 'karchx', 'dark', 'light', 'nord', 'dracula'
const THEMES = {
  // brutal — pop brutalism: bone paper, ink borders, candy pink/teal/yellow
  brutal: { bg: '#f0ede4', winBg: '#f0ede4', surface: '#ffffff', surface2: '#f7f3ea', border: '#111111', text: '#111111', textDim: '#6f6a5e', accent: '#ff90e8', green: '#23a094', red: '#e5484d', yellow: '#ffc900', barBg: '#ffffff' },
  // karchx — warm cream paper, deep aubergine accent (based on karchx.com)
  karchx: { bg: '#ece4d6', winBg: '#ece4d6', surface: '#f3ecde', surface2: '#ebe2cf', border: '#d4c8b3', text: '#1f1c18', textDim: '#6b5f54', accent: '#3b2a3a', green: '#4a7a4a', red: '#a83b3b', yellow: '#b88a2e', barBg: '#d9ccb3' },
  dark: { bg: 'rgba(12,12,18,0.85)', winBg: '#0c0c12', surface: '#13131d', surface2: '#1b1b28', border: '#2a2a3d', text: '#e2e2f0', textDim: '#7e7e98', accent: '#d4845a', green: '#4ade80', red: '#f87171', yellow: '#facc15', barBg: '#252538' },
  light: { bg: 'rgba(250,250,252,0.94)', winBg: '#fafafc', surface: '#ffffff', surface2: '#f3f4f6', border: '#d1d5db', text: '#111827', textDim: '#6b7280', accent: '#b45e35', green: '#16a34a', red: '#dc2626', yellow: '#ca8a04', barBg: '#e5e7eb' },
  nord: { bg: 'rgba(46,52,64,0.88)', winBg: '#2e3440', surface: '#3b4252', surface2: '#434c5e', border: '#4c566a', text: '#eceff4', textDim: '#8892a8', accent: '#88c0d0', green: '#a3be8c', red: '#bf616a', yellow: '#ebcb8b', barBg: '#2e3440' },
  dracula: { bg: 'rgba(40,42,54,0.88)', winBg: '#282a36', surface: '#44475a', surface2: '#50526a', border: '#6272a4', text: '#f8f8f2', textDim: '#9898b0', accent: '#bd93f9', green: '#50fa7b', red: '#ff5555', yellow: '#f1fa8c', barBg: '#282a36' },
};

// Send the currently-selected theme to a single window. Use on did-finish-load
// of any window that should reflect the user's theme (popups, dashboards, etc.).
function sendCurrentTheme(targetWin) {
  if (!targetWin || targetWin.isDestroyed()) return;
  const theme = THEMES[currentTheme] || THEMES.dark;
  try {
    targetWin.webContents.send('theme-update', { name: currentTheme, ...theme });
  } catch { /* ignore */ }
}

function broadcastTheme() {
  const theme = THEMES[currentTheme] || THEMES.dark;
  const payload = { name: currentTheme, ...theme };
  const allWins = [win, tasksWin, calWin, notesWin, notesAppWin, dashWin, alertPopup, pomoPopupWin, addEventWin];
  for (const w of allWins) {
    if (w && !w.isDestroyed()) {
      try { w.webContents.send('theme-update', payload); } catch { /* ignore */ }
    }
  }
}

// --- Smart text parser: "Meeting with John tomorrow 3pm 1h" → { title, date, time, duration, priority } ---
function parseSmartText(input) {
  let text = input;
  let date = null;
  let time = null;
  let duration = null;
  let priority = 'medium';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  function fmtDate(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // Priority keywords
  if (/\b(urgent|important|asap|critical|!{2,})\b/i.test(text)) {
    priority = 'high';
    text = text.replace(/\b(urgent|important|asap|critical)\b/gi, '').replace(/!{2,}/g, '');
  }

  // Relative dates: today, tomorrow, day after tomorrow
  if (/\btoday\b/i.test(text)) {
    date = fmtDate(today);
    text = text.replace(/\btoday\b/gi, '');
  } else if (/\btomorrow\b/i.test(text)) {
    const d = new Date(today); d.setDate(d.getDate() + 1);
    date = fmtDate(d);
    text = text.replace(/\btomorrow\b/gi, '');
  } else if (/\bday after tomorrow\b/i.test(text)) {
    const d = new Date(today); d.setDate(d.getDate() + 2);
    date = fmtDate(d);
    text = text.replace(/\bday after tomorrow\b/gi, '');
  }

  // Bulgarian relative dates (no \b — doesn't work with Cyrillic)
  if (!date && /(?:^|\s)днес(?:\s|$|,)/i.test(text)) {
    date = fmtDate(today);
    text = text.replace(/днес/gi, '');
  } else if (!date && /(?:^|\s)утре(?:\s|$|,)/i.test(text)) {
    const d = new Date(today); d.setDate(d.getDate() + 1);
    date = fmtDate(d);
    text = text.replace(/утре/gi, '');
  } else if (!date && /(?:^|\s)вдругиден(?:\s|$|,)/i.test(text)) {
    const d = new Date(today); d.setDate(d.getDate() + 2);
    date = fmtDate(d);
    text = text.replace(/вдругиден/gi, '');
  }

  // Day names: monday, tuesday... / понеделник, вторник...
  const dayNamesEN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayNamesBG = ['неделя', 'понеделник', 'вторник', 'сряда', 'четвъртък', 'петък', 'събота'];

  if (!date) {
    for (let di = 0; di < 7; di++) {
      const reEN = new RegExp('\\b(next\\s+)?' + dayNamesEN[di] + '\\b', 'i');
      const reBG = new RegExp('(?:^|\\s)(следващ[а-яА-Я]*\\s+)?' + dayNamesBG[di] + '(?:\\s|$|,)', 'i');
      const matchEN = text.match(reEN);
      const matchBG = text.match(reBG);
      if (matchEN || matchBG) {
        const isNext = (matchEN && matchEN[1]) || (matchBG && matchBG[1]);
        const d = new Date(today);
        let daysAhead = (di - d.getDay() + 7) % 7;
        if (daysAhead === 0) daysAhead = 7;
        if (isNext && daysAhead <= 7) daysAhead += 7;
        d.setDate(d.getDate() + daysAhead);
        date = fmtDate(d);
        text = text.replace(matchEN ? matchEN[0] : matchBG[0], ' ');
        break;
      }
    }
  }

  // "in X days/weeks"
  if (!date) {
    const inMatch = text.match(/\bin\s+(\d+)\s+(day|days|week|weeks)\b/i);
    if (inMatch) {
      const d = new Date(today);
      const n = parseInt(inMatch[1], 10);
      if (/week/i.test(inMatch[2])) d.setDate(d.getDate() + n * 7);
      else d.setDate(d.getDate() + n);
      date = fmtDate(d);
      text = text.replace(inMatch[0], '');
    }
  }

  // Explicit date: "March 25", "25 March", "3/25", "25.03", "2026-03-25"
  if (!date) {
    const monthNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    const monthMatch = text.match(new RegExp('\\b(' + monthNames.join('|') + ')\\s+(\\d{1,2})\\b', 'i'));
    const monthMatch2 = text.match(new RegExp('\\b(\\d{1,2})\\s+(' + monthNames.join('|') + ')\\b', 'i'));
    const slashMatch = text.match(/\b(\d{1,2})[\/\.](\d{1,2})(?:[\/\.](\d{2,4}))?\b/);
    const isoMatch = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);

    if (isoMatch) {
      date = isoMatch[0];
      text = text.replace(isoMatch[0], '');
    } else if (monthMatch) {
      const mi = monthNames.indexOf(monthMatch[1].toLowerCase());
      const d = new Date(now.getFullYear(), mi, parseInt(monthMatch[2], 10));
      if (d < today) d.setFullYear(d.getFullYear() + 1);
      date = fmtDate(d);
      text = text.replace(monthMatch[0], '');
    } else if (monthMatch2) {
      const mi = monthNames.indexOf(monthMatch2[2].toLowerCase());
      const d = new Date(now.getFullYear(), mi, parseInt(monthMatch2[1], 10));
      if (d < today) d.setFullYear(d.getFullYear() + 1);
      date = fmtDate(d);
      text = text.replace(monthMatch2[0], '');
    } else if (slashMatch) {
      const a = parseInt(slashMatch[1], 10);
      const b = parseInt(slashMatch[2], 10);
      const y = slashMatch[3] ? (slashMatch[3].length === 2 ? 2000 + parseInt(slashMatch[3], 10) : parseInt(slashMatch[3], 10)) : now.getFullYear();
      // Detect DD/MM vs MM/DD: if first > 12, it's DD/MM
      const d = a > 12 ? new Date(y, b - 1, a) : new Date(y, a - 1, b);
      date = fmtDate(d);
      text = text.replace(slashMatch[0], '');
    }
  }

  // Time: "3pm", "3:30pm", "15:00", "at 3", "в 15:00", "в 10:00"
  // Try explicit HH:MM first (most reliable)
  const time24Match = text.match(/(?:^|\s)(?:at\s+|[вВ]\s+)?(\d{1,2}):(\d{2})(?:\s*(am|pm))?(?:\s|$|,)/i);
  const time12Match = !time24Match ? text.match(/(?:^|\s)(?:at\s+|[вВ]\s+)?(\d{1,2})\s*(am|pm)(?:\s|$|,)/i) : null;
  const timeM = time24Match || time12Match;
  if (timeM) {
    let h = parseInt(timeM[1], 10);
    const m = time24Match ? parseInt(timeM[2], 10) : 0;
    const ampm = time24Match ? (timeM[3] || '').toLowerCase() : timeM[2].toLowerCase();
    if (ampm === 'pm' && h !== 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    if (h >= 0 && h <= 23) {
      time = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
      text = text.replace(timeM[0], ' ');
    }
  }

  // Duration: "1h", "30m", "2 hours", "1.5h"
  const durMatch = text.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minutes|час[а]?|мин)(?:\s|$|,)/i);
  if (durMatch) {
    const val = parseFloat(durMatch[1]);
    const unit = durMatch[2].toLowerCase();
    if (unit.charAt(0) === 'h' || unit.startsWith('час')) duration = Math.round(val * 60);
    else duration = Math.round(val);
    text = text.replace(durMatch[0], '');
  }

  // Clean up title — remove leftover prepositions
  text = text.replace(/\bat\b/gi, '').replace(/\bon\b/gi, '');
  text = text.replace(/(?:^|\s)в(?:\s|$)/gi, ' '); // Bulgarian "в" only as standalone word
  text = text.replace(/^[\s,\-:]+|[\s,\-:]+$/g, '').replace(/\s{2,}/g, ' ').trim();

  return { title: text || input.trim(), date, time, duration, priority };
}

function generateRecurringEvents(baseEvt) {
  // Generate instances for the next 90 days
  const startDate = new Date(baseEvt.date + 'T12:00');
  const endDate = new Date(startDate.getTime() + 90 * 24 * 60 * 60 * 1000);
  let current = new Date(startDate);
  const increment = { daily: 1, weekly: 7, biweekly: 14, monthly: 0 };

  while (true) {
    if (baseEvt.recurrence === 'monthly') {
      current.setMonth(current.getMonth() + 1);
    } else {
      current.setDate(current.getDate() + (increment[baseEvt.recurrence] || 7));
    }
    if (current > endDate) break;

    const dateStr = current.getFullYear() + '-'
      + String(current.getMonth() + 1).padStart(2, '0') + '-'
      + String(current.getDate()).padStart(2, '0');
    calendarEvents.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: baseEvt.title,
      date: dateStr,
      time: baseEvt.time,
      duration: baseEvt.duration,
      color: baseEvt.color,
      reminder: baseEvt.reminder,
      recurrence: null, // instances don't recurse
      recurringParentId: baseEvt.id,
      googleEventId: null,
      createdAt: Date.now(),
    });
  }
}

// Prune recurring instances older than 30 days to prevent unbounded growth
function pruneOldRecurringEvents() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const before = calendarEvents.length;
  calendarEvents = calendarEvents.filter((e) =>
    !(e.recurringParentId && e.date < cutoffStr && !e.done)
  );
  if (calendarEvents.length < before) saveCalendarEvents();
}

function broadcastCalendar() {
  pruneOldRecurringEvents();
  const payload = calendarEvents;
  if (win && !win.isDestroyed()) {
    win.webContents.send('calendar-update', payload);
  }
  if (dashWin && !dashWin.isDestroyed()) {
    dashWin.webContents.send('calendar-update', payload);
  }
  if (calWin && !calWin.isDestroyed()) {
    calWin.webContents.send('calendar-update', payload);
  }
  // Calendar badge: events today
  const today = new Date().toISOString().slice(0, 10);
  const todayCount = calendarEvents.filter((e) => e.date === today).length;
  if (win && !win.isDestroyed()) {
    win.webContents.send('badge-update', { calendar: todayCount });
  }
}

function clearReminderTimers() {
  for (const id of Object.keys(reminderTimers)) {
    clearTimeout(reminderTimers[id]);
  }
  reminderTimers = {};
}

// Track which reminder stages have fired: { eventId: Set('15m', '5m', '0m', 'overdue') }
let firedStages = {};

function scheduleReminders() {
  clearReminderTimers();
  const now = Date.now();

  // Prune fired reminders/stages for past events
  for (const id of firedReminders) {
    const evt = calendarEvents.find((e) => e.id === id);
    if (!evt || new Date(evt.date + 'T23:59').getTime() < now) {
      firedReminders.delete(id);
      delete firedStages[id];
    }
  }
  const maxAhead = 24 * 60 * 60 * 1000;

  for (const evt of calendarEvents) {
    if (evt.done) continue;
    if (!evt.date) continue;

    let eventTime;
    if (evt.time) {
      eventTime = new Date(evt.date + 'T' + evt.time).getTime();
    } else {
      eventTime = new Date(evt.date + 'T09:00').getTime();
    }
    if (isNaN(eventTime)) continue;
    if (eventTime - now > maxAhead) continue;

    // Escalating reminder stages (minutes before event)
    const stages = [
      { key: '15m', minsBefore: 15, body: 'In 15 minutes', silent: false, autoDismiss: 8000 },
      { key: '10m', minsBefore: 10, body: 'In 10 minutes', silent: false, autoDismiss: 0 },  // stays open with countdown
      { key: '0m',  minsBefore: 0,  body: 'Starting NOW', silent: false, autoDismiss: 0 },  // 0 = no auto-dismiss
    ];

    if (!firedStages[evt.id]) firedStages[evt.id] = new Set();
    const fired = firedStages[evt.id];

    for (const stage of stages) {
      if (fired.has(stage.key)) continue;
      const fireAt = eventTime - (stage.minsBefore * 60 * 1000);
      const delay = fireAt - now;

      if (delay < 0) {
        // Should have fired already — fire now if event is within 30 min
        if (now - eventTime < 30 * 60 * 1000) {
          fired.add(stage.key);
          fireReminder(evt, stage);
        }
        continue;
      }

      reminderTimers[evt.id + ':' + stage.key] = setTimeout(() => {
        fired.add(stage.key);
        delete reminderTimers[evt.id + ':' + stage.key];
        fireReminder(evt, stage);
      }, delay);
    }

    // Overdue stage: fires 5 min after event time, sends banner to widget
    if (!fired.has('overdue') && now > eventTime + 5 * 60 * 1000 && now - eventTime < 60 * 60 * 1000) {
      fired.add('overdue');
      // Send overdue banner to widget (even if hidden — it shows when opened)
      if (win && !win.isDestroyed()) {
        win.webContents.send('event-overdue', { id: evt.id, title: evt.title, time: evt.time });
      }
      new Notification({
        title: '\u26A0 OVERDUE: ' + evt.title,
        body: 'Event was at ' + (evt.time || 'today') + ' — don\'t forget!',
        silent: false,
        urgency: 'critical',
      }).show();
    }
  }
}

function fireReminder(evt, stage) {
  // 1. System notification — sound on for urgent stages
  const isUrgent = stage.key === '0m' || stage.key === '5m';
  new Notification({
    title: evt.title,
    body: stage.body + (evt.time ? ' \u2014 ' + evt.time : ''),
    silent: !isUrgent,
    urgency: stage.key === '0m' ? 'critical' : 'normal',
  }).show();

  // 1b. Play alert tone for urgent reminders (cross-platform)
  if (isUrgent) {
    try {
      const { execFile } = require('child_process');
      if (process.platform === 'win32') {
        execFile('powershell', ['-c', '[console]::beep(880,800)'], { windowsHide: true });
      } else if (process.platform === 'darwin') {
        execFile('osascript', ['-e', 'beep 2']);
      }
      // Linux: the popup's Web Audio chime already covers the alert
    } catch { /* ignore */ }
  }

  // 2. Popup window
  showReminderPopup(evt, stage.autoDismiss, stage);

  // 3. Flash tray icon
  if (tray) {
    try {
      const alertIcon = getAlertTrayIcon();
      const normalIcon = getTrayIcon();
      let flashes = 0;
      const flasher = setInterval(() => {
        if (!tray || flashes >= 10) { clearInterval(flasher); if (tray) tray.setImage(normalIcon); return; }
        tray.setImage(flashes % 2 === 0 ? alertIcon : normalIcon);
        flashes++;
      }, 500);
    } catch { /* ignore */ }
  }

  // 4. Send to widget for countdown display
  if (win && !win.isDestroyed()) {
    win.webContents.send('event-reminder', {
      id: evt.id, title: evt.title, time: evt.time, stage: stage.key,
    });
  }
}

function showReminderPopup(evt, autoDismissMs, stage) {
  if (alertPopup && !alertPopup.isDestroyed()) {
    alertPopup.close();
    alertPopup = null;
  }

  const display = getWidgetDisplay();
  const wa = display.workArea;
  const popW = 300;
  const popH = 300;

  alertPopup = new BrowserWindow({
    width: popW,
    height: popH,
    x: wa.x + wa.width - popW - 20,
    y: wa.y + wa.height - popH - 20,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    ...POPUP_GLASS_OPTS_FN(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'meeting-popup-preload.js'),
    },
  });
  applyLinuxPopupTransparency(alertPopup);

  { const ref = alertPopup; alertPopup.on('closed', () => { if (alertPopup === ref) alertPopup = null; }); }
  alertPopup.once('ready-to-show', () => {
    if (alertPopup && !alertPopup.isDestroyed()) alertPopup.show();
  });
  alertPopup.loadFile(path.join(__dirname, 'meeting-popup.html'));

  alertPopup.webContents.once('did-finish-load', () => {
    if (!alertPopup || alertPopup.isDestroyed()) return;

    let timeText = '';
    if (evt.time) {
      const evtMs = new Date(evt.date + 'T' + evt.time).getTime();
      const diff = evtMs - Date.now();
      if (diff <= 60000) {
        timeText = 'Now \u2014 ' + evt.time;
      } else {
        const mins = Math.round(diff / 60000);
        timeText = 'In ' + mins + ' min \u2014 ' + evt.time;
      }
    } else {
      timeText = 'Today (all day)';
    }

    alertPopup.webContents.send('meeting-popup-data', {
      label: evt.title,
      resetText: timeText,
      color: evt.color || 'blue',
      stage: stage ? stage.key : '15m',
      eventTime: evt.time ? new Date(evt.date + 'T' + evt.time).getTime() : null,
      meetLink: eventJoinLink(evt),
    });
    sendCurrentTheme(alertPopup);
  });
}

function addTask(text, priority) {
  if (typeof text !== 'string') return;
  const clean = text.trim().slice(0, 200);
  if (!clean) return;
  const validPriority = ['high', 'medium', 'low'].indexOf(priority) >= 0 ? priority : 'medium';
  tasks.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    text: clean,
    done: false,
    priority: validPriority,
    order: tasks.length,
    createdAt: Date.now(),
    completedAt: null,
  });
  saveTasks();
  broadcastTasks();
}

function toggleTask(id) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  task.done = !task.done;
  task.completedAt = task.done ? Date.now() : null;
  saveTasks();
  broadcastTasks();
}

function deleteTask(id) {
  tasks = tasks.filter((t) => t.id !== id);
  saveTasks();
  broadcastTasks();
}

function clearCompletedTasks() {
  tasks = tasks.filter((t) => !t.done);
  saveTasks();
  broadcastTasks();
}

// --- Alert popup ---

function getAlertStep(pct, threshold) {
  // Returns which 10% step above threshold we're at (0 = at threshold, 1 = +10%, etc.)
  if (pct < threshold) return -1;
  return Math.floor((pct - threshold) / 10);
}

function showAlertPopup(label, pct, resetsAt, accountLabel) {
  if (alertPopup && !alertPopup.isDestroyed()) {
    alertPopup.close();
    alertPopup = null;
  }

  const display = getWidgetDisplay();
  const wa = display.workArea; const sw = wa.x + wa.width; const sh = wa.y + wa.height;
  const popW = 320;
  const popH = 200;
  const severity = pct >= 85 ? 'danger' : 'warning';

  alertPopup = new BrowserWindow({
    width: popW,
    height: popH,
    x: sw - popW - 20,
    y: sh - popH - 20,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    ...POPUP_GLASS_OPTS_FN(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'popup-preload.js'),
    },
  });
  applyLinuxPopupTransparency(alertPopup);

  { const ref = alertPopup; alertPopup.on('closed', () => { if (alertPopup === ref) alertPopup = null; }); }

  alertPopup.once('ready-to-show', () => {
    if (alertPopup && !alertPopup.isDestroyed()) {
      alertPopup.showInactive();
    }
  });

  alertPopup.loadFile(path.join(__dirname, 'popup.html'));

  alertPopup.webContents.once('did-finish-load', () => {
    if (!alertPopup || alertPopup.isDestroyed()) return;

    let resetText = '';
    if (resetsAt) {
      const diff = new Date(resetsAt).getTime() - Date.now();
      if (diff > 0) {
        const hours = Math.floor(diff / 3600000);
        const mins = Math.floor((diff % 3600000) / 60000);
        resetText = hours > 0 ? `Resets in ${hours}h ${mins}m` : `Resets in ${mins}m`;
      }
    }

    alertPopup.webContents.send('popup-data', { severity, label, pct, resetText, accountLabel: accountLabel || 'Me' });
    sendCurrentTheme(alertPopup);
  });
}

function checkAndNotify(ctx) {
  const usage = ctx && ctx.cachedUsage;
  if (!usage) return;
  const checks = [
    { key: 'session', pct: usage.session.pct, label: 'Session', resetsAt: usage.session.resetsAt },
    { key: 'weekAll', pct: usage.weekAll.pct, label: 'Weekly (all)', resetsAt: usage.weekAll.resetsAt },
    { key: 'weekSonnet', pct: usage.weekSonnet.pct, label: 'Weekly (Fable)', resetsAt: usage.weekSonnet.resetsAt },
  ];

  for (const check of checks) {
    const step = getAlertStep(check.pct, ALERT_THRESHOLDS[check.key]);
    if (step >= 0 && step !== ctx.lastAlertedStep[check.key]) {
      ctx.lastAlertedStep[check.key] = step;
      showAlertPopup(check.label, check.pct, check.resetsAt, ctx.name || 'Me');
    }
    // Reset tracking when usage drops below threshold
    if (step < 0) ctx.lastAlertedStep[check.key] = -1;
  }
}

function getAlertTrayIcon() {
  // Generate gauge icon with a red alert dot overlay
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
    <rect width="16" height="16" rx="3.5" fill="#0a0a14"/>
    <path d="M 3 10 A 5 5 0 0 1 13 10" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round"/>
    <path d="M 7 10 A 1.5 1.5 0 0 1 13 10" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round"/>
    <line x1="8" y1="10" x2="5.5" y2="6" stroke="white" stroke-width="1" stroke-linecap="round"/>
    <circle cx="8" cy="10" r="1" fill="#d4845a"/>
    <circle cx="13" cy="3" r="3" fill="#f87171"/>
  </svg>`;
  return nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  );
}

function updateTrayBadge(usage) {
  if (!tray) return;
  const hasAlert = usage.session.pct >= ALERT_THRESHOLDS.session
    || usage.weekAll.pct >= ALERT_THRESHOLDS.weekAll
    || usage.weekSonnet.pct >= ALERT_THRESHOLDS.weekSonnet;

  if (hasAlert !== trayHasAlert) {
    trayHasAlert = hasAlert;
    if (process.platform === 'win32') {
      // Windows: use overlay icon on taskbar
      if (hasAlert) {
        const dotSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">
          <circle cx="12" cy="4" r="3.5" fill="#f87171"/>
        </svg>`;
        const dotImage = nativeImage.createFromDataURL(
          'data:image/svg+xml;base64,' + Buffer.from(dotSvg).toString('base64')
        );
        if (win) win.setOverlayIcon(dotImage, 'Usage alert');
      } else {
        if (win) win.setOverlayIcon(null, '');
      }
    } else {
      // Linux & macOS: swap the tray icon itself
      tray.setImage(hasAlert ? getAlertTrayIcon() : getTrayIcon());
    }
  }
}

// --- Auto-update check ---

let lastUpdateCheck = 0;
let lastUpdateResult = null;
const UPDATE_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

function isNewerVersion(latest, current) {
  const a = latest.split('.').map(Number);
  const b = current.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return false;
}

function checkForUpdates() {
  return new Promise((resolve) => {
    const url = new URL('https://api.github.com/repos/SpitOnYourFace/claude-usage-widget/releases/latest');
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'GET',
      headers: {
        'User-Agent': `claude-usage-widget/${(APP_VERSION || app.getVersion())}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    }, (res) => {
      let body = '';
      const MAX_GH_BODY = 512 * 1024;
      res.on('data', (chunk) => {
        body += chunk;
        if (body.length > MAX_GH_BODY) { res.resume(); req.destroy(); resolve({ hasUpdate: false }); return; }
      });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          const latestTag = (data.tag_name || '').replace(/^v/, '');
          const current = (APP_VERSION || app.getVersion());
          if (latestTag && isNewerVersion(latestTag, current)) {
            // Find platform-appropriate installer asset
            let downloadUrl = null;
            if (Array.isArray(data.assets)) {
              let asset = null;
              const isArm = process.arch === 'arm64';
              if (process.platform === 'win32') {
                asset = data.assets.find((a) =>
                  /\.exe$/i.test(a.name) && /setup/i.test(a.name)
                );
              } else if (process.platform === 'darwin') {
                asset = data.assets.find((a) =>
                  /\.dmg$/i.test(a.name) && (isArm ? /arm64/i.test(a.name) : !/arm64/i.test(a.name))
                );
              } else {
                asset = data.assets.find((a) =>
                  /\.AppImage$/i.test(a.name) && (isArm ? /arm64/i.test(a.name) : !/arm64/i.test(a.name))
                );
              }
              if (asset) downloadUrl = asset.browser_download_url;
            }
            resolve({
              hasUpdate: true,
              latestVersion: latestTag,
              url: data.html_url,
              downloadUrl,
            });
          } else {
            resolve({ hasUpdate: false });
          }
        } catch {
          resolve({ hasUpdate: false });
        }
      });
    });
    req.on('error', () => resolve({ hasUpdate: false }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ hasUpdate: false }); });
    req.end();
  });
}

function downloadAndInstallUpdate(downloadUrl) {
  return new Promise((resolve, reject) => {
    if (!downloadUrl) {
      reject(new Error('No download URL'));
      return;
    }

    const ext = path.extname(new URL(downloadUrl).pathname) || '.exe';
    const dest = path.join(os.tmpdir(), 'claude-meter-' + crypto.randomUUID() + ext);

    const sendProgress = (pct) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('update-progress', pct);
      }
      if (dashWin && !dashWin.isDestroyed()) {
        dashWin.webContents.send('update-progress', pct);
      }
    };

    const doDownload = (url, redirects) => {
      if (redirects > 5) {
        reject(new Error('Too many redirects'));
        return;
      }

      const parsed = new URL(url);
      const req = https.request({
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: {
          'User-Agent': `claude-usage-widget/${(APP_VERSION || app.getVersion())}`,
        },
      }, (res) => {
        // Follow redirects (GitHub uses 302)
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume(); // drain the response
          // Validate redirect host
          try {
            const redirectUrl = new URL(res.headers.location);
            const allowedHosts = ['github.com', 'objects.githubusercontent.com',
              'github-releases.githubusercontent.com', 'release-assets.githubusercontent.com',
              'github-production-release-asset-2e65be.s3.amazonaws.com'];
            if (redirectUrl.protocol !== 'https:' || !allowedHosts.some((h) => redirectUrl.hostname === h || redirectUrl.hostname.endsWith('.' + h))) {
              reject(new Error('Redirect to untrusted host: ' + redirectUrl.hostname));
              return;
            }
          } catch {
            reject(new Error('Invalid redirect URL'));
            return;
          }
          doDownload(res.headers.location, redirects + 1);
          return;
        }

        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error('Download failed: HTTP ' + res.statusCode));
          return;
        }

        // Only create file stream once we have a 200
        const file = fs.createWriteStream(dest);
        const totalBytes = parseInt(res.headers['content-length'], 10) || 0;
        let downloaded = 0;
        let lastSentPct = -1;

        res.on('data', (chunk) => {
          downloaded += chunk.length;
          if (totalBytes > 0) {
            const pct = Math.round((downloaded / totalBytes) * 100);
            if (pct !== lastSentPct) {
              lastSentPct = pct;
              sendProgress(pct);
            }
          }
        });

        res.pipe(file);
        file.on('finish', () => {
          file.close();
          // Verify download size matches Content-Length
          if (totalBytes > 0 && downloaded !== totalBytes) {
            fs.unlink(dest, () => {});
            reject(new Error('Download size mismatch: expected ' + totalBytes + ', got ' + downloaded));
            return;
          }
          sendProgress(100);
          resolve(dest);
        });
        file.on('error', (err) => {
          fs.unlink(dest, () => {});
          reject(err);
        });
      });

      req.on('error', (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
      req.setTimeout(120000, () => {
        req.destroy();
        reject(new Error('Download timeout'));
      });
      req.end();
    };

    doDownload(downloadUrl, 0);
  });
}

// --- OAuth token (cached to avoid reading file on every sync) ---

const TOKEN_CACHE_MS = 3 * 60 * 1000; // re-read from disk every 3 minutes
const REFRESH_WINDOW_MS = 60 * 60 * 1000; // refresh when within 1 HOUR of expiry
const MAX_REFRESH_RETRIES = 8;
// Claude Code's public OAuth client id. The refresh endpoint 404s without it,
// which is why the widget's own token refresh never worked before.
const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

// Write refreshed tokens back to a credentials file atomically (tmp + rename,
// 0600) so a crash mid-write can never leave a half-written credential.
function persistRefreshedCreds(credsFile, data) {
  const tmpFile = credsFile + '.tmp';
  const creds = JSON.parse(fs.readFileSync(credsFile, 'utf-8'));
  creds.claudeAiOauth.accessToken = data.access_token;
  if (data.refresh_token) creds.claudeAiOauth.refreshToken = data.refresh_token;
  if (data.expires_in) creds.claudeAiOauth.expiresAt = Date.now() + data.expires_in * 1000;
  fs.writeFileSync(tmpFile, JSON.stringify(creds, null, 2), { mode: 0o600 });
  fs.renameSync(tmpFile, credsFile);
}

function readOauthCreds(ctx) {
  try {
    const creds = JSON.parse(fs.readFileSync(ctx.credsFile, 'utf-8'));
    return creds.claudeAiOauth || null;
  } catch { return null; }
}

function getAccessToken(ctx, forceRefresh) {
  if (!ctx || ctx.signedOut) return null;
  const now = Date.now();
  if (!forceRefresh && ctx.cachedToken && (now - ctx.tokenLastRead) < TOKEN_CACHE_MS) {
    return ctx.cachedToken;
  }
  const oauth = readOauthCreds(ctx);
  if (!oauth) { ctx.cachedToken = null; return null; }

  // Check if token is expired or about to expire
  if (oauth.expiresAt && oauth.expiresAt < now + REFRESH_WINDOW_MS) {
    if (oauth.expiresAt < now) {
      // Token already expired — don't return it, trigger refresh
      if (oauth.refreshToken && !ctx.isRefreshing) {
        refreshAccessToken(ctx, oauth.refreshToken);
      }
      ctx.cachedToken = null;
      return null;
    }
    // Expiring soon — refresh in background but still return current token
    if (oauth.refreshToken && !ctx.isRefreshing) {
      refreshAccessToken(ctx, oauth.refreshToken);
    }
  }

  const token = oauth.accessToken;
  if (typeof token !== 'string' || token.length === 0 || /[\r\n]/.test(token)) {
    ctx.cachedToken = null;
    return null;
  }
  ctx.cachedToken = token;
  ctx.tokenLastRead = now;
  return token;
}

// Only the active account may surface a user-visible re-auth prompt; every
// other account records needsLogin so the accounts strip can flag it quietly.
function reportAuthExpired(ctx) {
  ctx.needsLogin = true;
  ctx.lastError = 'OAuth session expired — please re-authenticate';
  if (ctx.id !== activeAccountId) { broadcastUsage(); return; }
  if (win && !win.isDestroyed()) {
    win.webContents.send('sync-error', ctx.lastError);
  }
  if (dashWin && !dashWin.isDestroyed()) {
    dashWin.webContents.send('sync-error', ctx.lastError);
  }
  broadcastUsage();
}

// Called by doSync on 401/403 — force a refresh and retry.
// Only escalates to a user-visible re-auth prompt when no refresh token is available;
// the refresh endpoint itself will surface a sign-in prompt if the refresh token is rejected.
function handleAuthFailure(ctx) {
  ctx.cachedToken = null;
  ctx.tokenLastRead = 0;
  const oauth = readOauthCreds(ctx);
  if (oauth && oauth.refreshToken) {
    if (!ctx.isRefreshing) {
      refreshAccessToken(ctx, oauth.refreshToken, () => {
        setTimeout(() => doSync(ctx), 500);
      });
    } else {
      // Refresh already in progress — retry sync after it likely completes
      setTimeout(() => doSync(ctx), 5000);
    }
    return;
  }
  // No refresh token available at all — credentials are missing or unusable.
  // This is the only case where we want the setup overlay to show.
  reportAuthExpired(ctx);
}

function refreshAccessToken(ctx, refreshToken, onSuccess) {
  if (!ctx || ctx.isRefreshing) return;
  ctx.isRefreshing = true;
  const credsFile = ctx.credsFile;
  const postData = JSON.stringify({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: OAUTH_CLIENT_ID,
  });

  const MAX_BODY = 1024 * 1024;
  const req = https.request({
    hostname: 'console.anthropic.com',
    path: '/v1/oauth/token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
      'User-Agent': `claude-usage-widget/${(APP_VERSION || app.getVersion())}`,
    },
  }, (res) => {
    let body = '';
    res.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) { req.destroy(); }
    });
    res.on('end', () => {
      ctx.isRefreshing = false;
      if (res.statusCode === 200) {
        try {
          const data = JSON.parse(body);
          if (data.access_token) {
            persistRefreshedCreds(credsFile, data);
            ctx.cachedToken = data.access_token;
            ctx.tokenLastRead = Date.now();
            ctx.refreshRetryCount = 0;
            ctx.needsLogin = false;
            if (ctx.refreshRetryTimer) { clearTimeout(ctx.refreshRetryTimer); ctx.refreshRetryTimer = null; }
            if (typeof onSuccess === 'function') onSuccess();
          }
        } catch (parseErr) { console.error('[token-refresh] Parse error:', parseErr.message); }
      } else if (res.statusCode === 429) {
        // Throttled, not rejected — back off and try the same refresh token again.
        console.error('[token-refresh] Rate limited for account', ctx.id, '— backing off');
        scheduleRefreshRetry(ctx, refreshToken);
      } else if (res.statusCode === 401 || res.statusCode === 403) {
        // Refresh token revoked or expired (they live ~30 days)
        console.error('[token-refresh] Refresh rejected for account', ctx.id, 'status', res.statusCode);
        reportAuthExpired(ctx);
      } else {
        console.error('[token-refresh] Unexpected status', res.statusCode, 'for account', ctx.id);
        scheduleRefreshRetry(ctx, refreshToken);
      }
    });
  });
  req.on('error', (err) => {
    ctx.isRefreshing = false;
    console.error('[token-refresh] Request failed for account', ctx.id + ':', err.message);
    scheduleRefreshRetry(ctx, refreshToken);
  });
  req.setTimeout(10000, () => {
    req.destroy();
    ctx.isRefreshing = false;
    scheduleRefreshRetry(ctx, refreshToken);
  });
  req.write(postData);
  req.end();
}

function scheduleRefreshRetry(ctx, refreshToken) {
  if (ctx.refreshRetryCount >= MAX_REFRESH_RETRIES) return;
  if (ctx.refreshRetryTimer) clearTimeout(ctx.refreshRetryTimer);
  const delay = Math.min(60000, 5000 * Math.pow(2, ctx.refreshRetryCount));
  ctx.refreshRetryCount++;
  ctx.refreshRetryTimer = setTimeout(() => {
    ctx.refreshRetryTimer = null;
    refreshAccessToken(ctx, refreshToken);
  }, delay);
}

// --- Fetch usage from Anthropic API ---

// Rate limits are per access token. A 429 on one account must never shorten
// another's polling, and must never be retried faster than these floors.
const MIN_TOKEN_POLL_MS = 3 * 60 * 1000;
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 5 * 60 * 1000;

function resetSyncIfStale(ctx) {
  if (ctx.syncing && ctx.syncStartedAt > 0 && (Date.now() - ctx.syncStartedAt) > SYNC_TIMEOUT_MS) {
    if (ctx.activeRequest) {
      try { ctx.activeRequest.destroy(); } catch { /* ignore */ }
      ctx.activeRequest = null;
    }
    ctx.syncing = false;
    ctx.syncStartedAt = 0;
  }
}

function anySyncing() {
  return enabledAccounts().some((ctx) => ctx.syncing);
}

function fetchUsage(ctx) {
  return new Promise((resolve, reject) => {
    resetSyncIfStale(ctx);
    if (ctx.syncing) { reject(new Error('Already syncing')); return; }
    if (Date.now() < ctx.rateLimitUntil) {
      reject(new Error('Rate limited — waiting'));
      return;
    }
    ctx.syncing = true;
    ctx.syncStartedAt = Date.now();

    const token = getAccessToken(ctx);
    if (!token) {
      ctx.syncing = false;
      ctx.syncStartedAt = 0;
      reject(new Error('No OAuth token. Log in to Claude Code first.'));
      return;
    }

    const url = new URL(USAGE_API);
    if (url.hostname !== 'api.anthropic.com') {
      ctx.syncing = false;
      ctx.syncStartedAt = 0;
      reject(new Error('Unexpected API hostname'));
      return;
    }

    let settled = false;
    const finish = (err, data) => {
      if (settled) return;
      settled = true;
      ctx.syncing = false;
      ctx.syncStartedAt = 0;
      ctx.activeRequest = null;
      err ? reject(err) : resolve(data);
    };

    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'anthropic-beta': BETA_HEADER,
        'Content-Type': 'application/json',
        'User-Agent': `claude-usage-widget/${(APP_VERSION || app.getVersion())}`,
      },
    }, (res) => {
      // Handle rate limiting — back off using Retry-After or 5 minutes default
      if (res.statusCode === 429) {
        res.resume();
        // Honour Retry-After when the endpoint sends one, but never poll the
        // same token more often than every 3 minutes; 5 minutes with no hint.
        const retryAfter = parseInt(res.headers['retry-after'], 10);
        const backoffMs = retryAfter > 0
          ? Math.max(retryAfter * 1000, MIN_TOKEN_POLL_MS)
          : DEFAULT_RATE_LIMIT_BACKOFF_MS;
        ctx.rateLimitUntil = Date.now() + backoffMs;
        finish(new Error('Rate limited'));
        return;
      }

      // Detect expired/invalid token from HTTP status
      if (res.statusCode === 401 || res.statusCode === 403) {
        res.resume();
        finish(new Error('OAuth session expired — please re-authenticate'));
        return;
      }

      const MAX_BODY = 1024 * 1024; // 1 MB
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
        if (body.length > MAX_BODY) {
          req.destroy();
          finish(new Error('Response body too large'));
        }
      });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.type === 'error') {
            const msg = data.error?.message || 'API error';
            // Detect auth errors in response body too
            const errType = (data.error?.type || '').toLowerCase();
            if (errType.indexOf('auth') >= 0 || errType.indexOf('permission') >= 0) {
              finish(new Error('OAuth session expired — please re-authenticate'));
              return;
            }
            finish(new Error(msg));
            return;
          }
          // Successful response — clear any rate limit backoff
          ctx.rateLimitUntil = 0;
          finish(null, data);
        } catch {
          finish(new Error('Invalid response'));
        }
      });
    });

    ctx.activeRequest = req;
    req.on('error', (err) => finish(err));
    req.setTimeout(10000, () => { req.destroy(); finish(new Error('Timeout')); });
    req.end();
  });
}

function clampPct(val) {
  const n = Number(val) || 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function buildUsage(data) {
  const usage = {
    session: { pct: 0, resetsAt: null, label: 'Current session' },
    weekAll: { pct: 0, resetsAt: null, label: 'Current week (all models)' },
    weekSonnet: { pct: 0, resetsAt: null, label: 'Current week (Fable only)' },
    extraUsage: { enabled: false },
    syncTime: Date.now(),
  };

  if (data.five_hour) {
    usage.session = {
      pct: clampPct(data.five_hour.utilization),
      resetsAt: data.five_hour.resets_at,
      label: 'Current session',
    };
  }
  if (data.seven_day) {
    usage.weekAll = {
      pct: clampPct(data.seven_day.utilization),
      resetsAt: data.seven_day.resets_at,
      label: 'Current week (all models)',
    };
  }
  // Model-scoped weekly limit. The old fixed seven_day_sonnet field is null on
  // current plans; the API now reports per-model caps in the `limits` array as
  // kind "weekly_scoped" with the model name attached (currently Fable).
  // Internal key stays `weekSonnet` for history/settings compatibility.
  const scoped = Array.isArray(data.limits)
    ? data.limits.find((l) => l && l.kind === 'weekly_scoped' && l.scope && l.scope.model)
    : null;
  if (scoped) {
    const modelName = scoped.scope.model.display_name || 'model';
    usage.weekSonnet = {
      pct: clampPct(scoped.percent),
      resetsAt: scoped.resets_at,
      label: 'Current week (' + modelName + ' only)',
    };
  } else if (data.seven_day_sonnet) {
    // Legacy fallback for accounts still reporting the fixed Sonnet bucket
    usage.weekSonnet = {
      pct: clampPct(data.seven_day_sonnet.utilization),
      resetsAt: data.seven_day_sonnet.resets_at,
      label: 'Current week (Sonnet only)',
    };
  }
  if (data.extra_usage) {
    const eu = data.extra_usage;
    const util = Number(eu.utilization);
    const dec = Number.isFinite(Number(eu.decimal_places)) ? Number(eu.decimal_places) : 2;
    usage.extraUsage = {
      enabled: !!eu.is_enabled,
      utilization: Number.isFinite(util) ? util : null,
      usedMinor: Number.isFinite(Number(eu.used_credits)) ? Number(eu.used_credits) : null,
      limitMinor: Number.isFinite(Number(eu.monthly_limit)) ? Number(eu.monthly_limit) : null,
      currency: typeof eu.currency === 'string' ? eu.currency : 'USD',
      decimals: dec,
    };
    // Prefer the precise percent/severity from the spend object when present
    if (data.spend && typeof data.spend.percent === 'number') {
      usage.extraUsage.percent = data.spend.percent;
      usage.extraUsage.severity = data.spend.severity || null;
    }
  }

  return usage;
}

// The usage-update payload every renderer receives: one entry per enabled
// account plus which one is active. Renderers pick the active entry for the
// main meters and may render the rest alongside.
function buildUsagePayload() {
  return {
    accounts: enabledAccounts().map((ctx) => ({
      id: ctx.id,
      name: ctx.name,
      email: ctx.email,
      dir: ctx.dir, // shown in the "run this to sign in again" hint
      usage: ctx.cachedUsage || null,
      lastSuccessfulSync: ctx.lastSuccessfulSync,
      // Non-zero while this account's own token is in 429 backoff. Its cached
      // usage stays on screen; the tab shows when the next attempt is due.
      rateLimitedUntil: ctx.rateLimitUntil > Date.now() ? ctx.rateLimitUntil : 0,
      cliActive: isCliActive(ctx),
      error: ctx.lastError,
      needsLogin: !!ctx.needsLogin,
    })),
    activeAccountId: activeAccountId,
    cliLauncher: cliLauncherName(),
  };
}

function broadcastUsage() {
  const payload = buildUsagePayload();
  if (win && !win.isDestroyed()) {
    win.webContents.send('usage-update', payload);
    // (removed) history-update was sent to the widget renderer, but neither preload.js nor renderer.js listens for it - only the dashboard does. Serialising ~2581 points cost ~1.4ms per send for nothing.
  }
  if (dashWin && !dashWin.isDestroyed()) {
    dashWin.webContents.send('usage-update', payload);
    dashWin.webContents.send('history-update', activeHistory());
  }
}

// --- Claude official status page ---

function broadcastClaudeStatus() {
  if (win && !win.isDestroyed()) win.webContents.send('claude-status-update', claudeStatus);
  if (dashWin && !dashWin.isDestroyed()) dashWin.webContents.send('claude-status-update', claudeStatus);
}

function fetchClaudeStatus() {
  let settled = false;
  let body = '';
  const req = https.request({
    hostname: CLAUDE_STATUS_HOST,
    path: '/api/v2/incidents.json',
    method: 'GET',
    headers: { 'User-Agent': `claude-usage-widget/${APP_VERSION || app.getVersion()}` },
  }, (res) => {
    res.on('data', (chunk) => {
      body += chunk;
      if (body.length > 512 * 1024) { settled = true; req.destroy(); }
    });
    res.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        const data = JSON.parse(body);
        const allInc = data.incidents || [];
        const tenDaysAgo = Date.now() - 10 * 24 * 60 * 60 * 1000;

        const active = allInc.filter((inc) => !inc.resolved_at);
        const past = allInc
          .filter((inc) => inc.resolved_at && new Date(inc.resolved_at).getTime() > tenDaysAgo)
          .sort((a, b) => new Date(b.resolved_at) - new Date(a.resolved_at));

        function mapInc(inc) {
          return {
            name: inc.name,
            status: inc.status,
            impact: inc.impact,
            startedAt: inc.started_at,
            resolvedAt: inc.resolved_at || null,
            components: (inc.components || []).map((c) => c.name),
            latestUpdate: (inc.incident_updates && inc.incident_updates[0])
              ? inc.incident_updates[0].body : null,
          };
        }

        let indicator = 'none';
        for (const inc of active) {
          if (indicator === 'none' || inc.impact === 'critical'
            || (inc.impact === 'major' && indicator !== 'critical')) {
            indicator = inc.impact || 'minor';
          }
        }

        claudeStatus = {
          indicator,
          fetchedAt: Date.now(),
          incidents: active.map(mapInc),
          pastIncidents: past.map(mapInc),
        };
        broadcastClaudeStatus();
      } catch { /* best-effort */ }
    });
  });
  req.on('error', () => { settled = true; });
  req.setTimeout(10000, () => { if (!settled) { settled = true; req.destroy(); } });
  req.end();
}

function startClaudeStatusPoller() {
  fetchClaudeStatus();
  setInterval(fetchClaudeStatus, CLAUDE_STATUS_POLL_MS);
}

// --- Retry logic for failed syncs (per account) ---
const MAX_RETRIES = 5;
// Accounts are polled one after another with a gap, so N accounts never fire N
// simultaneous requests. Rate limits are per access token, so the buckets are
// independent — the stagger just keeps the burst off one network moment.
const ACCOUNT_SYNC_STAGGER_MS = 2500;

function clearRetryTimer(ctx) {
  if (ctx.retryTimer) { clearTimeout(ctx.retryTimer); ctx.retryTimer = null; }
  ctx.retryCount = 0;
}

function scheduleNetworkRetry(ctx) {
  // Network errors after wake: retry 5s, 10s, 20s, 30s, 30s
  if (ctx.retryCount >= MAX_RETRIES) return;
  if (ctx.retryTimer) clearTimeout(ctx.retryTimer);
  const delay = Math.min(30000, 5000 * Math.pow(2, ctx.retryCount));
  ctx.retryCount++;
  ctx.retryTimer = setTimeout(() => {
    ctx.retryTimer = null;
    doSync(ctx);
  }, delay);
}

// Smart sync — only hits API if data is stale
function syncIfStale(ctx) {
  if (!ctx) return;
  if (Date.now() - ctx.lastSuccessfulSync < MIN_SYNC_INTERVAL) {
    // Data is fresh — just broadcast cached data
    broadcastUsage();
    return;
  }
  doSync(ctx);
}

// One scheduler for every enabled account. Each account's request is fired on
// its own timer, so a failure or backoff on one can never delay another.
function syncAllAccounts(force) {
  const list = enabledAccounts();
  if (list.length === 0) return;
  list.forEach((ctx, i) => {
    const run = () => {
      if (!accountCtx[ctx.id]) return; // account removed while waiting
      if (force) {
        // Manual refresh bypasses the freshness check, but NOT a real 429
        // backoff — forcing through that just spends another rejected request.
        doSync(ctx);
      } else {
        syncIfStale(ctx);
      }
    };
    if (ctx.staggerTimer) { clearTimeout(ctx.staggerTimer); ctx.staggerTimer = null; }
    if (i === 0) { run(); return; }
    // One pending stagger timer per account — a new round replaces the old one
    // rather than piling up every three minutes.
    ctx.staggerTimer = setTimeout(() => { ctx.staggerTimer = null; run(); }, i * ACCOUNT_SYNC_STAGGER_MS);
  });
}

async function doSync(ctx) {
  if (!ctx) return;
  // Force-clear stale sync lock
  resetSyncIfStale(ctx);
  const isActive = ctx.id === activeAccountId;
  if (isActive) {
    if (win && !win.isDestroyed()) win.webContents.send('sync-start');
    if (dashWin && !dashWin.isDestroyed()) dashWin.webContents.send('sync-start');
  }
  try {
    const data = await fetchUsage(ctx);
    const newUsage = buildUsage(data);

    // Guard: don't overwrite good cached data with all-zero response (treat as bad response)
    const cached = ctx.cachedUsage;
    const allZero = newUsage.session.pct === 0
      && newUsage.weekAll.pct === 0
      && newUsage.weekSonnet.pct === 0;
    const hasResetTimes = newUsage.session.resetsAt || newUsage.weekAll.resetsAt || newUsage.weekSonnet.resetsAt;
    if (allZero && cached && !hasResetTimes
      && (cached.session.pct > 0 || cached.weekAll.pct > 0 || cached.weekSonnet.pct > 0)) {
      // Bad response — keep cached data, schedule retry, don't mark as successful sync
      broadcastUsage();
      updateTrayTooltip();
      scheduleNetworkRetry(ctx);
      return;
    }

    ctx.cachedUsage = newUsage;
    ctx.lastSuccessfulSync = Date.now();
    ctx.lastError = null;
    ctx.needsLogin = false;
    clearRetryTimer(ctx); // sync succeeded — stop retrying
    saveCachedUsage(ctx);
    appendHistory(ctx);
    // Alerts and the tray badge follow the active account only.
    if (ctx.id === activeAccountId) {
      checkAndNotify(ctx);
      updateTrayBadge(newUsage);
    }
    broadcastUsage();
    updateTrayTooltip();
  } catch (err) {
    const safeMsg = typeof err.message === 'string'
      ? err.message.slice(0, 200)
      : 'Unknown error';

    // Flow-control errors — don't count as failures, don't burn retries
    if (safeMsg.indexOf('Already syncing') >= 0) {
      // Sync in progress — just broadcast cached data, no retry needed
      if (ctx.cachedUsage) broadcastUsage();
      return;
    }
    if (safeMsg.indexOf('Rate limited') >= 0) {
      // This account's token is throttled. Keep its cached usage exactly as it
      // is, publish the backoff so its tab can say so, and retry once when the
      // window expires — the other accounts are untouched.
      if (ctx.rateLimitUntil < Date.now()) {
        ctx.rateLimitUntil = Date.now() + DEFAULT_RATE_LIMIT_BACKOFF_MS;
      }
      saveCachedUsage(ctx); // persist the backoff so a restart respects it
      broadcastUsage();
      updateTrayTooltip();
      if (ctx.retryTimer) clearTimeout(ctx.retryTimer);
      const waitMs = Math.max(1000, ctx.rateLimitUntil - Date.now());
      ctx.retryTimer = setTimeout(() => { ctx.retryTimer = null; doSync(ctx); }, waitMs + 1000);
      return;
    }

    ctx.cachedToken = null;

    // Auth errors: no token, expired session, or API auth rejection
    const isAuthError = safeMsg.indexOf('OAuth') >= 0
      || safeMsg.indexOf('No OAuth') >= 0
      || safeMsg.indexOf('re-authenticate') >= 0;

    if (isAuthError) {
      // Don't surface a sign-in prompt immediately — first try to refresh the token
      // silently. The refresh path (refreshAccessToken / handleAuthFailure) will emit
      // sync-error only if refresh truly fails. This prevents the setup overlay from
      // flashing every time the access token expires while Claude CLI isn't running.
      handleAuthFailure(ctx);
      return;
    }

    ctx.lastError = safeMsg;

    // Genuine API failure — keep cached data, schedule retry
    if (ctx.cachedUsage) {
      broadcastUsage();
      updateTrayTooltip();
      scheduleNetworkRetry(ctx);
    } else {
      broadcastUsage();
      if (ctx.id !== activeAccountId) return;
      if (win && !win.isDestroyed()) win.webContents.send('sync-error', safeMsg);
      if (dashWin && !dashWin.isDestroyed()) dashWin.webContents.send('sync-error', safeMsg);
    }
  }
}

// --- Tray ---

function getTrayIcon() {
  // Use pre-rendered tray PNGs for crisp display at system tray size
  // Windows tray is typically 16px at 100% DPI, 24px at 150%, 32px at 200%
  const sizes = [32, 24, 16];
  for (const s of sizes) {
    const trayPath = getAssetPath(`tray-${s}.png`);
    if (fs.existsSync(trayPath)) {
      return nativeImage.createFromPath(trayPath);
    }
  }
  // Fallback to main icon
  const iconPath = getAssetPath('icon.png');
  if (fs.existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  }
  return nativeImage.createEmpty();
}

function updateTrayTooltip() {
  if (!tray) return;
  // One line per account: "Name 5h 83% · 7d 37%"
  const lines = [];
  for (const ctx of enabledAccounts()) {
    const limitedMin = ctx.rateLimitUntil > Date.now()
      ? Math.max(1, Math.round((ctx.rateLimitUntil - Date.now()) / 60000))
      : 0;
    const cliTag = isCliActive(ctx) ? ' [CLI]' : '';
    if (ctx.needsLogin) {
      lines.push(`${ctx.name}${cliTag} — sign-in needed`);
    } else if (ctx.cachedUsage) {
      let line = `${ctx.name}${cliTag} 5h ${ctx.cachedUsage.session.pct}% · 7d ${ctx.cachedUsage.weekAll.pct}%`;
      if (limitedMin) line += ` (rate limited, retrying in ${limitedMin}m)`;
      lines.push(line);
    } else if (limitedMin) {
      lines.push(`${ctx.name} — rate limited, retrying in ${limitedMin}m`);
    } else {
      lines.push(`${ctx.name} — no data yet`);
    }
  }
  tray.setToolTip(lines.length > 0 ? 'Claude Meter\n' + lines.join('\n') : 'Claude Meter');
}

// --- Linux desktop integration ---

const LINUX_AUTOSTART_DIR = path.join(os.homedir(), '.config', 'autostart');
const LINUX_DESKTOP_FILE = path.join(LINUX_AUTOSTART_DIR, 'claude-meter.desktop');
const LINUX_APPS_DIR = path.join(os.homedir(), '.local', 'share', 'applications');
const LINUX_APPS_DESKTOP = path.join(LINUX_APPS_DIR, 'claude-meter.desktop');
const LINUX_ICON_DIR = path.join(os.homedir(), '.local', 'share', 'icons');
const LINUX_ICON_FILE = path.join(LINUX_ICON_DIR, 'claude-meter.png');

function writeLinuxDesktopFile(filePath, extraLines) {
  const exePath = process.env.APPIMAGE || process.execPath;
  const iconSrc = getAssetPath('icon.png');
  if (fs.existsSync(iconSrc)) {
    fs.mkdirSync(LINUX_ICON_DIR, { recursive: true });
    fs.copyFileSync(iconSrc, LINUX_ICON_FILE);
  }
  const lines = [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Claude Meter',
    'Comment=Desktop meter showing Claude usage',
    'Exec=' + exePath,
    'Icon=' + (fs.existsSync(LINUX_ICON_FILE) ? LINUX_ICON_FILE : 'claude-meter'),
    'Terminal=false',
    'Categories=Utility;',
    'StartupWMClass=claude-usage-widget',
  ];
  if (extraLines) lines.push.apply(lines, extraLines);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, lines.join('\n') + '\n');
}

function ensureLinuxShortcut() {
  if (process.platform !== 'linux') return;
  try {
    // Always write to keep Exec path current after updates
    writeLinuxDesktopFile(LINUX_APPS_DESKTOP);
  } catch { /* ignore */ }
}

function getLinuxAutoStart() {
  if (process.platform !== 'linux') return false;
  return fs.existsSync(LINUX_DESKTOP_FILE);
}

function setLinuxAutoStart(enabled) {
  if (process.platform !== 'linux') return;
  if (enabled) {
    try {
      writeLinuxDesktopFile(LINUX_DESKTOP_FILE, ['X-GNOME-Autostart-enabled=true']);
    } catch { /* ignore */ }
  } else {
    try { fs.unlinkSync(LINUX_DESKTOP_FILE); } catch { /* ignore */ }
  }
}

function getAutoStartEnabled() {
  if (process.platform === 'linux') return getLinuxAutoStart();
  return app.getLoginItemSettings().openAtLogin;
}

function setAutoStartEnabled(enabled) {
  if (process.platform === 'linux') {
    setLinuxAutoStart(enabled);
  } else {
    app.setLoginItemSettings({ openAtLogin: enabled });
  }
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Show  (' + currentHotkey + ')', click: () => toggleWindow() },
    { label: 'Dashboard', click: () => openDashboard() },
    { label: 'Tasks', click: () => openTasksWindow() },
    { type: 'separator' },
    { label: 'Quit', click: () => { if (win && !win.isDestroyed()) win.destroy(); app.quit(); } },
  ]);
}

// --- Window ---

function createWindow() {
  const saved = loadBounds();
  const widgetW = Math.min(saved?.width || 480, 600);
  const widgetH = Math.min(saved?.height || 450, 800);
  win = new BrowserWindow({
    width: widgetW,
    height: widgetH,
    x: saved?.x,
    y: saved?.y,
    frame: false,
    resizable: true,
    minWidth: 280,
    minHeight: 200,
    skipTaskbar: true,
    alwaysOnTop: false,
    ...POPUP_GLASS_OPTS_FN(),
    show: false,
    icon: getWindowIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });
  applyLinuxPopupTransparency(win);

  win.loadFile('index.html');

  // Dynamic z-order: behave like a normal window. Clicking another app lets
  // it fall behind; toggling the widget (hide→show) raises it to the front.
  // Every show() raises momentarily to the top, then releases so it's not pinned.
  win.setAlwaysOnTop(false);
  win.on('show', () => {
    win.moveTop();
    if (process.platform === 'win32') {
      win.setAlwaysOnTop(true);
      setTimeout(() => { if (win && !win.isDestroyed()) win.setAlwaysOnTop(false); }, 60);
    }
  });

  // Navigation guards — block external URLs and new windows
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.on('close', (e) => {
    e.preventDefault();
    saveBoundsNow();
    win.hide();
  });

  win.on('resized', () => {
    saveBounds();
  });

  // Group drag delegated to module-level startGroupDrag/stopGroupDrag

  function startDragTracking() { startGroupDrag(win); }

  function stopDragTracking() { stopGroupDrag(); }

  // Track widget drag — poll-based approach that always works on Windows frameless windows
  let widgetLastX = 0;
  let widgetLastY = 0;
  let widgetDragPoller = null;

  function startWidgetDragPoll() {
    if (widgetDragPoller) return;
    const wb = win.getBounds();
    widgetLastX = wb.x;
    widgetLastY = wb.y;

    // Snapshot only SNAPPED panels
    const peers = [];
    if (tasksWin && !tasksWin.isDestroyed() && tasksWin.isVisible() && tasksSnapped) {
      const tb = tasksWin.getBounds();
      peers.push({ win: tasksWin, offsetX: tb.x - wb.x, offsetY: tb.y - wb.y });
    }
    if (calWin && !calWin.isDestroyed() && calWin.isVisible() && calendarSnapped) {
      const cb = calWin.getBounds();
      peers.push({ win: calWin, offsetX: cb.x - wb.x, offsetY: cb.y - wb.y });
    }
    if (notesWin && !notesWin.isDestroyed() && notesWin.isVisible() && snapLinks.notes) {
      const nb = notesWin.getBounds();
      peers.push({ win: notesWin, offsetX: nb.x - wb.x, offsetY: nb.y - wb.y });
    }
    if (peers.length === 0) return;

    widgetDragPoller = setInterval(() => {
      if (!win || win.isDestroyed()) { stopWidgetDragPoll(); return; }
      const [wx, wy] = win.getPosition();
      if (wx !== widgetLastX || wy !== widgetLastY) {
        for (const p of peers) {
          if (p.win && !p.win.isDestroyed()) {
            p.win.setPosition(wx + p.offsetX, wy + p.offsetY);
          }
        }
        widgetLastX = wx;
        widgetLastY = wy;
      }
    }, 8);
  }

  function stopWidgetDragPoll() {
    if (widgetDragPoller) { clearInterval(widgetDragPoller); widgetDragPoller = null; }
  }

  // Start polling when drag begins (Windows-only WM_ENTERSIZEMOVE/WM_EXITSIZEMOVE)
  if (process.platform === 'win32') {
    try {
      win.hookWindowMessage(0x0231, () => { startWidgetDragPoll(); });
      win.hookWindowMessage(0x0232, () => { stopWidgetDragPoll(); });
    } catch { /* ignore — falls back to will-move */ }
  } else {
    win.on('will-move', () => startWidgetDragPoll());
  }
  // Linux never emits will-move/moved/resized - synthesise them from move/resize.
  enableLinuxWindowEvents(win);

  win.on('moved', () => {
    stopWidgetDragPoll();
    stopDragTracking();

    // Magnetic screen edges — snap to edge if within 15px
    // Use setPosition (not setBounds) to avoid DPI-induced size drift on Windows
    if (win && !win.isDestroyed()) {
      const wb = win.getBounds();
      const display = screen.getDisplayMatching(wb);
      const wa = display.workArea;
      const EDGE_MAGNET = 15;
      let newX = wb.x;
      let newY = wb.y;
      let snapped = false;
      if (Math.abs(newX - wa.x) < EDGE_MAGNET) { newX = wa.x; snapped = true; }
      if (Math.abs(newY - wa.y) < EDGE_MAGNET) { newY = wa.y; snapped = true; }
      if (Math.abs((newX + wb.width) - (wa.x + wa.width)) < EDGE_MAGNET) { newX = wa.x + wa.width - wb.width; snapped = true; }
      if (Math.abs((newY + wb.height) - (wa.y + wa.height)) < EDGE_MAGNET) { newY = wa.y + wa.height - wb.height; snapped = true; }
      if (snapped) win.setPosition(newX, newY);
    }

    saveBounds();
    // Final snap alignment — reposition ALL attached panels to widget
    if (tasksSnapped && tasksWin && !tasksWin.isDestroyed() && win && !win.isDestroyed()) {
      const sb = getSnappedTasksBounds(tasksSnapped);
      if (sb) tasksWin.setBounds(sb);
    }
    if (calendarSnapped && calWin && !calWin.isDestroyed() && calWin.isVisible()) {
      const cb = getSnappedCalendarBounds(calendarSnapped);
      if (cb) calWin.setBounds(cb);
    }
    if (snapLinks.notes && notesWin && !notesWin.isDestroyed() && notesWin.isVisible()) {
      const anchorName = snapLinks.notes.anchor;
      const anchor = getWinByName(anchorName);
      if (anchor && !anchor.isDestroyed()) {
        const side = snapLinks.notes.side;
        const nH = (side === 'left' || side === 'right') ? anchor.getBounds().height : 250;
        const nb = getSnappedBounds(anchor.getBounds(), side, 300, nH);
        if (nb) notesWin.setBounds(nb);
      }
    }
  });

  // Smooth resize sync — when widget is resized, match panel heights
  win.on('resize', () => {
    if (!win || win.isDestroyed()) return;
    const wb = win.getBounds();
    if (tasksSnapped && tasksWin && !tasksWin.isDestroyed() && tasksWin.isVisible()) {
      const side = tasksSnapped;
      if (side === 'left' || side === 'right') {
        const tb = tasksWin.getBounds();
        if (tb.height !== wb.height) {
          tasksWin.setBounds({ x: tb.x, y: wb.y, width: tb.width, height: wb.height });
        }
      }
    }
    if (calendarSnapped && calWin && !calWin.isDestroyed() && calWin.isVisible()) {
      const side = calendarSnapped;
      if (side === 'left' || side === 'right') {
        const cb = calWin.getBounds();
        if (cb.height !== wb.height) {
          calWin.setBounds({ x: cb.x, y: wb.y, width: cb.width, height: wb.height });
        }
      }
    }
  });

  // Widget stays visible until user explicitly hides via hotkey or buttons.
  // No auto-hide on blur — this was causing first-click to be swallowed.
}

let toggleAnimating = false;
let widgetReady = false; // true after did-finish-load

function toggleWindow() {
  if (!win || toggleAnimating) return;
  if (win.isVisible()) {
    saveBoundsNow();
    calWasVisible = calWin && !calWin.isDestroyed() && calWin.isVisible();
    tasksWasVisible = tasksWin && !tasksWin.isDestroyed() && tasksWin.isVisible();
    notesWasVisible = notesWin && !notesWin.isDestroyed() && notesWin.isVisible();
    // Save exact panel bounds so we restore the exact same layout
    savedTasksBounds = tasksWasVisible ? tasksWin.getBounds() : null;
    savedCalBounds = calWasVisible ? calWin.getBounds() : null;
    savedNotesBounds = notesWasVisible ? notesWin.getBounds() : null;

    toggleAnimating = true;
    const panels = [notesWin, calWin, tasksWin].filter(w => w && !w.isDestroyed() && w.isVisible());

    if (widgetReady) {
      // Start the widget fade immediately; panels cascade alongside it rather
      // than before it. Previously the fade only began after the whole cascade,
      // making hide cost 150ms with no panels and 300ms with three - all of it
      // setTimeout, not work. It also kept toggleAnimating true that whole time,
      // which swallowed a quick second Ctrl+\.
      if (win && !win.isDestroyed()) {
        try { win.webContents.send('toggle-animate', 'out'); } catch { /* ignore */ }
      }
      let delay = 0;
      for (const p of panels) {
        setTimeout(() => { if (p && !p.isDestroyed()) p.hide(); }, delay);
        delay += 20;
      }
      setTimeout(() => {
        toggleAnimating = false;
        if (win && !win.isDestroyed()) win.hide();
      }, Math.max(delay, 90));
    } else {
      // Not ready yet — just hide instantly
      for (const p of panels) { if (p && !p.isDestroyed()) p.hide(); }
      if (win && !win.isDestroyed()) win.hide();
      toggleAnimating = false;
    }
  } else {
    const saved = loadBounds();
    if (saved) {
      win.setBounds({
        x: saved.x,
        y: saved.y,
        width: saved.width || 380,
        height: saved.height || 420,
      });
    } else {
      const display = getWidgetDisplay();
      const { width, height } = display.workAreaSize;
      const bounds = win.getBounds();
      win.setPosition(width - bounds.width - 16, height - bounds.height - 16);
    }
    const widgetBounds = win.getBounds();

    // Main widget shows first with slide-in
    // Prevent flash: hide window content until CSS animation starts
    win.setOpacity(0);
    win.show();   // 'show' handler raises to front then releases (dynamic z-order)
    win.focus();
    if (process.platform === 'win32') {
      setTimeout(() => {
        if (win && !win.isDestroyed()) win.webContents.focus();
      }, 60);
    }
    if (widgetReady) {
      try { win.webContents.send('toggle-animate', 'in'); } catch { /* ignore */ }
    }
    // Restore window opacity after one frame — CSS animation handles the visual fade-in
    setTimeout(() => {
      if (win && !win.isDestroyed()) win.setOpacity(1);
    }, 16);

    // Restore panels to their exact saved positions — preserves the chain layout
    let showDelay = 120;
    if (tasksWin && !tasksWin.isDestroyed() && tasksWasVisible && !tasksUserHidden) {
      if (savedTasksBounds) {
        // Offset by widget position delta (in case widget moved)
        const dx = widgetBounds.x - (saved ? saved.x : widgetBounds.x);
        const dy = widgetBounds.y - (saved ? saved.y : widgetBounds.y);
        tasksWin.setBounds({
          x: savedTasksBounds.x + dx,
          y: savedTasksBounds.y + dy,
          width: savedTasksBounds.width,
          height: savedTasksBounds.height,
        });
      } else if (tasksSnapped) {
        const sb = getSnappedTasksBounds(tasksSnapped);
        if (sb) tasksWin.setBounds(sb);
      }
      setTimeout(() => { if (tasksWin && !tasksWin.isDestroyed()) tasksWin.show(); }, showDelay);
      showDelay += 60;
      guardWidgetBounds(widgetBounds);
    }
    if (calWin && !calWin.isDestroyed() && calWasVisible) {
      if (savedCalBounds) {
        const dx = widgetBounds.x - (saved ? saved.x : widgetBounds.x);
        const dy = widgetBounds.y - (saved ? saved.y : widgetBounds.y);
        calWin.setBounds({
          x: savedCalBounds.x + dx,
          y: savedCalBounds.y + dy,
          width: savedCalBounds.width,
          height: savedCalBounds.height,
        });
      } else if (calendarSnapped) {
        const cb = getSnappedCalendarBounds(calendarSnapped);
        if (cb) calWin.setBounds(cb);
      }
      setTimeout(() => { if (calWin && !calWin.isDestroyed()) calWin.show(); }, showDelay);
      showDelay += 60;
    }
    if (notesWin && !notesWin.isDestroyed() && notesWasVisible) {
      if (savedNotesBounds) {
        const dx = widgetBounds.x - (saved ? saved.x : widgetBounds.x);
        const dy = widgetBounds.y - (saved ? saved.y : widgetBounds.y);
        notesWin.setBounds({
          x: savedNotesBounds.x + dx,
          y: savedNotesBounds.y + dy,
          width: savedNotesBounds.width,
          height: savedNotesBounds.height,
        });
      }
      setTimeout(() => { if (notesWin && !notesWin.isDestroyed()) notesWin.show(); }, showDelay);
    }
    setTimeout(resolveOverlaps, 400);
    // Push all cached data so UI is never empty
    if (win && !win.isDestroyed()) {
      win.webContents.send('usage-update', buildUsagePayload());
      // (removed) history-update was sent to the widget renderer, but neither preload.js nor renderer.js listens for it - only the dashboard does. Serialising ~2581 points cost ~1.4ms per send for nothing.
      win.webContents.send('pomo-update', { state: pomoState, seconds: pomoSeconds, total: pomoTotal });
    }
    // Sync on open — hits API if data is >60s old (MIN_SYNC_INTERVAL)
    syncAllAccounts(false);
    tryShowDigestOnOpen();
    if (trayHasAlert) {
      trayHasAlert = false;
      if (process.platform === 'win32') {
        if (win) win.setOverlayIcon(null, '');
      } else if (tray) {
        tray.setImage(getTrayIcon());
      }
    }
  }
}

function openDashboard(tab) {
  if (dashWin && !dashWin.isDestroyed()) {
    if (typeof tab === 'string' && tab) {
      // Section-targeted open: navigate to the requested tab and focus
      try { dashWin.webContents.send('navigate-tab', tab); } catch { /* ignore */ }
      if (dashWin.isMinimized()) dashWin.restore();
      dashWin.focus();
    } else {
      // Generic dashboard button: toggle closed on second click
      dashWin.close();
    }
    return;
  }

  // Position dashboard away from widget
  const wb = win && !win.isDestroyed() ? win.getBounds() : null;
  const display = wb ? screen.getDisplayMatching(wb) : getWidgetDisplay();
  const wa = display.workArea;
  const dW = 900, dH = 650;
  let dX, dY;
  if (wb) {
    // Try to center on screen but shift if it would overlap the widget
    dX = Math.round(wa.x + (wa.width - dW) / 2);
    dY = Math.round(wa.y + (wa.height - dH) / 2);
    // If widget is on the right side, push dashboard left
    if (wb.x > wa.x + wa.width / 2) {
      dX = Math.max(wa.x, wb.x - dW - 20);
    } else {
      dX = Math.min(wa.x + wa.width - dW, wb.x + wb.width + 20);
    }
  }

  dashWin = new BrowserWindow({
    width: dW,
    height: dH,
    x: dX,
    y: dY,
    minWidth: 700,
    minHeight: 500,
    frame: false,
    ...POPUP_GLASS_OPTS_FN(),
    icon: getWindowIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'dashboard-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  applyLinuxPopupTransparency(dashWin);
  dashWin.loadFile('dashboard.html');

  dashWin.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  });
  dashWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  dashWin.webContents.on('did-finish-load', () => {
    dashWin.webContents.send('usage-update', buildUsagePayload());
    const hist = activeHistory();
    if (hist.length > 0) dashWin.webContents.send('history-update', hist);
    if (lastUpdateResult && lastUpdateResult.hasUpdate) {
      dashWin.webContents.send('update-available', lastUpdateResult);
    }
    if (claudeStatus) dashWin.webContents.send('claude-status-update', claudeStatus);
    // Apply current theme
    const theme = THEMES[currentTheme] || THEMES.dark;
    dashWin.webContents.send('theme-update', { name: currentTheme, ...theme });
    // Navigate to a specific tab if requested
    if (typeof tab === 'string' && tab) {
      dashWin.webContents.send('navigate-tab', tab);
    }
  });

  dashWin.on('closed', () => { dashWin = null; });
}

// --- Glass morphism: mica/acrylic on Windows 11 ---
// backgroundColor must stay non-transparent (mouse hit-testing for drag) but has to
// match the active theme, or the native window bg flashes dark behind light themes.
function GLASS_OPTS_FN() {
  const theme = THEMES[currentTheme] || THEMES.dark;
  const winBg = theme.winBg || '#0c0c12';
  return process.platform === 'win32'
    ? { backgroundMaterial: 'mica', backgroundColor: winBg }
    : { backgroundColor: winBg };
}

// Ctrl+\ speed: relaunching the whole Electron binary just to hit the
// 'second-instance' path costs ~1s (new process, V8 boot, socket handshake).
// A tiny unix socket lets the shortcut toggle in single-digit ms instead.
function startToggleSocket() {
  if (process.platform !== 'linux') return;
  try {
    const net = require('net');
    const sockPath = path.join(os.tmpdir(), 'claude-meter-' + (process.getuid ? process.getuid() : 0) + '.sock');
    try { fs.unlinkSync(sockPath); } catch { /* not there */ }
    const server = net.createServer((c) => {
      c.on('data', () => {
        if (win && !win.isDestroyed()) {
          const wasVisible = win.isVisible();
          toggleWindow();
          if (!wasVisible) win.focus();
        }
      });
      c.on('error', () => {});
    });
    server.on('error', (e) => console.log('[toggle-socket] ' + e.message));
    server.listen(sockPath, () => console.log('[toggle-socket] listening on ' + sockPath));
    app.on('will-quit', () => { try { server.close(); fs.unlinkSync(sockPath); } catch { /* ignore */ } });
  } catch (e) { console.log('[toggle-socket] failed ' + e); }
}

// --- Linux window shape ---
// Linux has no Mica, so a frameless window paints an opaque rectangle that
// masks the CSS border-radius: every window reads as a hard square block.
// POPUP_GLASS_OPTS_FN makes the window genuinely transparent; this file's
// companion helper then reshapes the document inside it, because a transparent
// window on its own only exposes whatever the page paints.
const LINUX_WIN_RADIUS = '12px';

// Documents whose own markup already paints a rounded, opaque card (.popup)
// filling the window. Only the body behind it has to be cleared.
const LINUX_CARD_DOCS = new Set(['popup', 'pomo-popup', 'meeting-popup']);

// Documents where BODY itself is the visual surface: there is no outer card,
// every one of them declares `body { background: var(--bg) }`.
const LINUX_SURFACE_DOCS = new Set([
  'index', 'dashboard', 'calendar', 'tasks', 'notes', 'capture', 'add-event',
]);

// Clearing the body background is not enough for the surface documents:
//  - CSS background propagation. With a transparent root the BODY background is
//    painted onto the canvas across the whole viewport, so `border-radius` on
//    body has no visual effect. The surface has to live on a separate layer -
//    a fixed pseudo-element - which does honour its own radius.
//  - Full-bleed children (dashboard's .sidebar/.titlebar, notes' .nbar,
//    capture's .bar) paint their own opaque background right into the corners
//    and would square the window off again. body has to CLIP them, and it only
//    can once html stops propagating body's overflow to the viewport: while the
//    root is `overflow: visible` the used value on body becomes visible too.
//  - Specificity. dashboard/calendar/tasks/add-event carry a late
//    `body { background: var(--bg) !important }` theme override, so `body` on
//    its own is not enough to beat it - `html body` is.
// The fixed pseudo-element escapes body's clip (body is no containing block for
// fixed boxes), so it still covers the whole window and rounds itself.
const LINUX_SURFACE_CSS =
  ':root{background:transparent !important;background-color:transparent !important;' +
  'overflow:hidden !important}' +
  'html body{background:transparent !important;background-color:transparent !important;' +
  'border-radius:' + LINUX_WIN_RADIUS + ';overflow:hidden}' +
  'html body::before{content:"";position:fixed;inset:0;z-index:-1;' +
  'background:var(--bg);border-radius:' + LINUX_WIN_RADIUS + ';}';

// Per-document top-ups for surface documents that draw a hard frame of their
// own. Their border is painted on the element box (background propagation does
// not apply to borders), so it keeps square corners unless it is rounded too.
// capture.html puts that border on body, which LINUX_SURFACE_CSS already
// rounds; notes.html puts it on #app, which fills body exactly.
const LINUX_SURFACE_EXTRA_CSS = {
  notes: 'html body #app{border-radius:' + LINUX_WIN_RADIUS + ';}',
};

function applyLinuxPopupTransparency(win) {
  if (process.platform !== 'linux' || !win || win.isDestroyed()) return;
  win.webContents.on('did-finish-load', () => {
    try {
      const u = win.webContents.getURL() || '';
      console.log('[linux-shape] did-finish-load url=' + u + ' transparent=' + (typeof win.isTransparent === 'function' ? win.isTransparent() : 'n/a'));
      // Match the document name only - some windows load with a query string
      // (notes.html?mode=app).
      const doc = (/([^/\\?#]+)\.html(?:[?#]|$)/.exec(u) || ['', ''])[1].toLowerCase();
      if (LINUX_CARD_DOCS.has(doc)) {
        win.webContents.insertCSS(
          'html,body{background:transparent !important;background-color:transparent !important}'
        ).then(() => console.log('[linux-shape] popup css applied doc=' + doc)).catch((e) => console.log('[linux-shape] popup css FAILED ' + e));
        return;
      }
      if (!LINUX_SURFACE_DOCS.has(doc)) {
        console.log('[linux-shape] no rule for doc=' + doc + ' - left opaque');
        return;
      }
      win.webContents.insertCSS(
        LINUX_SURFACE_CSS + (LINUX_SURFACE_EXTRA_CSS[doc] || '')
      ).then(() => console.log('[linux-shape] main css applied doc=' + doc)).catch((e) => console.log('[linux-shape] main css FAILED ' + e));
    } catch (e) { console.log('[linux-shape] threw ' + e); }
  });
}

function POPUP_GLASS_OPTS_FN() {
  if (process.platform !== 'linux') return GLASS_OPTS_FN();
  return { transparent: true, backgroundColor: '#00000000', hasShadow: false };
}

// --- Note export (Markdown normalize + PDF) ---
function safeFileName(s) {
  return (String(s || 'note').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').slice(0, 60)) || 'note';
}
function mdSplitRow(line) {
  let s = line.trim();
  if (s.charAt(0) === '|') s = s.slice(1);
  if (s.charAt(s.length - 1) === '|') s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}
function mdIsSep(line) {
  const t = line.trim();
  return /^[\s|:\-]+$/.test(t) && t.indexOf('-') >= 0 && t.indexOf('|') >= 0;
}
function formatMdTable(header, rows) {
  const n = header.length;
  const w = [];
  for (let c = 0; c < n; c++) {
    let mx = (header[c] || '').length;
    rows.forEach((r) => { if (c < r.length) mx = Math.max(mx, r[c].length); });
    w[c] = Math.max(3, mx);
  }
  const fmt = (cells) => {
    let s = '|';
    for (let c = 0; c < n; c++) { const v = c < cells.length ? cells[c] : ''; s += ' ' + v + ' '.repeat(w[c] - v.length) + ' |'; }
    return s;
  };
  let sepLine = '|';
  for (let c = 0; c < n; c++) sepLine += ' ' + '-'.repeat(w[c]) + ' |';
  const res = [fmt(header), sepLine];
  rows.forEach((r) => res.push(fmt(r)));
  return res;
}
// Clean up raw markdown so it's send-ready: trim trailing space, unify bullets,
// re-align tables (aligned pipes render everywhere), collapse blank runs.
function normalizeMarkdown(src) {
  let lines = String(src || '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t]+$/, ''));
  lines = lines.map((l) => l.replace(/^(\s*)[*•]\s+/, '$1- '));
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.indexOf('|') >= 0 && i + 1 < lines.length && mdIsSep(lines[i + 1])) {
      const header = mdSplitRow(l);
      const rows = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim() !== '' && lines[j].indexOf('|') >= 0) { rows.push(mdSplitRow(lines[j])); j++; }
      formatMdTable(header, rows).forEach((r) => out.push(r));
      i = j - 1;
    } else {
      out.push(l);
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
// --- Markdown -> HTML string (for PDF). Mirrors the notes renderer output. ---
const PRINT_CSS = [
  '*{margin:0;padding:0;box-sizing:border-box;}',
  "body{font-family:Inter,system-ui,'Segoe UI',sans-serif;color:#111;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;}",
  '.doc{padding:6px 4px;font-size:13px;line-height:1.6;}',
  '.doc h1{font-size:24px;font-weight:900;text-transform:uppercase;letter-spacing:-0.4px;margin:0 0 12px;padding-bottom:7px;border-bottom:3px solid #111;}',
  '.doc h2{font-size:15px;font-weight:900;margin:18px 0 8px;display:inline-block;background:#ffc900;border:2px solid #111;border-radius:5px;padding:2px 10px;}',
  '.doc ul{list-style:none;margin:8px 0 8px 2px;}',
  '.doc li{position:relative;padding:3px 0 3px 22px;font-size:13px;font-weight:500;line-height:1.5;}',
  '.doc li::before{content:"\\25AA";position:absolute;left:2px;top:1px;color:#ff90e8;font-weight:900;font-size:15px;}',
  '.doc li.chk{padding-left:26px;}',
  '.doc li.chk::before{content:"";position:absolute;left:2px;top:3px;width:14px;height:14px;border:2px solid #111;border-radius:3px;background:#fff;}',
  '.doc li.chk.done::before{content:"\\2713";background:#23a094;color:#fff;font-size:10px;display:flex;align-items:center;justify-content:center;}',
  '.doc li.chk.done{text-decoration:line-through;opacity:0.55;}',
  '.doc p{font-size:13px;font-weight:500;line-height:1.6;margin:8px 0;}',
  '.doc blockquote{background:#fff8dd;border:2px solid #111;border-left:6px solid #ffc900;border-radius:6px;padding:9px 12px;margin:10px 0;font-size:12.5px;font-weight:600;}',
  ".doc code{background:#111;color:#23a094;padding:1px 6px;border-radius:4px;font-family:'JetBrains Mono',Consolas,monospace;font-size:12px;}",
  '.doc strong{font-weight:900;}',
  '.doc a{color:#1a7a6e;font-weight:700;}',
  '.doc table.md-table{width:100%;max-width:640px;border-collapse:separate;border-spacing:0;border:2.5px solid #111;border-radius:8px;overflow:hidden;font-size:12.5px;margin:12px 0;}',
  '.doc table.md-table th,.doc table.md-table td{overflow-wrap:anywhere;word-break:break-word;}',
  '.doc table.md-table th{background:#111;color:#fff;font-weight:900;text-transform:uppercase;font-size:10px;letter-spacing:0.5px;padding:8px 10px;text-align:left;}',
  '.doc table.md-table td{padding:0;border-top:2px solid #111;vertical-align:middle;}',
  '.doc table.md-table td:not(:last-child){border-right:2px solid #111;}',
  '.doc table.md-table td.mdt-lbl{padding:8px 10px;font-weight:700;}',
  '.doc .mdt-cell{position:relative;padding:8px 10px;overflow:hidden;min-height:32px;min-width:88px;display:flex;align-items:center;}',
  '.doc .mdt-bar{position:absolute;left:0;top:0;bottom:0;background:#23a094;opacity:0.34;z-index:0;}',
  '.doc .mdt-bar.hatch{background:repeating-linear-gradient(45deg,#9ee7c8,#9ee7c8 5px,#cbf1e0 5px,#cbf1e0 10px);opacity:0.6;}',
  ".doc .mdt-cell .mdt-val{position:relative;z-index:1;font-family:'JetBrains Mono',Consolas,monospace;font-weight:900;font-size:13px;}",
  '.doc .mdt-cell.txt .mdt-val{font-family:Inter,sans-serif;font-size:10.5px;font-weight:800;text-transform:uppercase;}',
  ".doc .copy-card{border:2.5px solid #111;border-radius:9px;background:#f7f3ea;padding:9px 12px;margin:11px 0;font-family:'JetBrains Mono',Consolas,monospace;font-size:11.5px;font-weight:700;white-space:pre-wrap;word-break:break-all;}",
].join('');

function mdEscape(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function mdInline(text) {
  let s = mdEscape(text);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a>$1</a>');
  return s;
}
function mdParseNum(s) {
  const raw = String(s || '').trim();
  if (/^\d{1,4}[/\-]\d{1,2}([/\-]\d{1,4})?$/.test(raw)) return NaN;   // 1/7, 2026-07-04
  if (/^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(raw)) return NaN;            // 18.06.2026
  if (/^(19|20)\d{2}$/.test(raw)) return NaN;                        // bare 4-digit year
  const t = raw.replace(/\s/g, '').replace(/,/g, '');
  if (/^-?\d+(\.\d+)?%?$/.test(t)) return parseFloat(t);
  return NaN;
}
function mdHeaderIsMeta(h) {
  return /дата|date|year|годин|месец|month|day|№|#|link|url|линк/i.test(String(h || ''));
}
function mdTableHtml(header, rows) {
  const n = header.length;
  const colNum = [], colMax = [];
  for (let c = 0; c < n; c++) {
    let nums = 0, mx = 0, tot = 0;
    rows.forEach((r) => { if (c < r.length && r[c] !== '') { tot++; const v = mdParseNum(r[c]); if (!isNaN(v)) { nums++; if (v > mx) mx = v; } } });
    colNum[c] = !mdHeaderIsMeta(header[c]) && tot > 0 && nums > 0 && nums / tot >= 0.5;
    colMax[c] = mx || 1;
  }
  let html = '<table class="md-table"><tr>';
  header.forEach((h) => { html += '<th>' + mdInline(h) + '</th>'; });
  html += '</tr>';
  rows.forEach((r) => {
    html += '<tr>';
    for (let c = 0; c < n; c++) {
      const cell = c < r.length ? r[c] : '';
      if (colNum[c]) {
        const v = mdParseNum(cell);
        const isTxt = isNaN(v);
        const w = isTxt ? 100 : (v / colMax[c] * 100);
        // One consistent colour per column (CSS default); width shows magnitude.
        html += '<td><div class="mdt-cell' + (isTxt ? ' txt' : '') + '"><div class="mdt-bar' + (isTxt ? ' hatch' : '') + '" style="width:' + w + '%;"></div><span class="mdt-val">' + mdInline(cell) + '</span></div></td>';
      } else {
        html += '<td class="mdt-lbl">' + mdInline(cell) + '</td>';
      }
    }
    html += '</tr>';
  });
  return html + '</table>';
}
function mdToHtml(src) {
  const lines = String(src || '').split('\n');
  let html = '', inList = false;
  const endList = () => { if (inList) { html += '</ul>'; inList = false; } };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]; let m;
    // Fenced copy block -> bordered box (selectable text in the PDF)
    if (/^```copy\s*$/i.test(l.trim())) {
      endList();
      const buf = []; let k = i + 1;
      while (k < lines.length && !/^```\s*$/.test(lines[k].trim())) { buf.push(lines[k]); k++; }
      html += '<div class="copy-card">' + mdEscape(buf.join('\n')) + '</div>';
      i = k; continue;
    }
    if ((m = l.match(/^copy:\s?(.*)/i))) { endList(); html += '<div class="copy-card">' + mdEscape(m[1]) + '</div>'; continue; }
    if (l.indexOf('|') >= 0 && i + 1 < lines.length && mdIsSep(lines[i + 1])) {
      endList();
      const header = mdSplitRow(l); const rows = []; let j = i + 2;
      while (j < lines.length && lines[j].trim() !== '' && lines[j].indexOf('|') >= 0) { rows.push(mdSplitRow(lines[j])); j++; }
      html += mdTableHtml(header, rows); i = j - 1; continue;
    }
    if ((m = l.match(/^#\s+(.*)/))) { endList(); html += '<h1>' + mdInline(m[1]) + '</h1>'; }
    else if ((m = l.match(/^##\s+(.*)/))) { endList(); html += '<h2>' + mdInline(m[1]) + '</h2>'; }
    else if ((m = l.match(/^-\s+\[( |x)\]\s+(.*)/))) { if (!inList) { html += '<ul>'; inList = true; } html += '<li class="chk' + (m[1] === 'x' ? ' done' : '') + '">' + mdInline(m[2]) + '</li>'; }
    else if ((m = l.match(/^[-*]\s+(.*)/))) { if (!inList) { html += '<ul>'; inList = true; } html += '<li>' + mdInline(m[1]) + '</li>'; }
    else if ((m = l.match(/^>\s?(.*)/))) { endList(); html += '<blockquote>' + mdInline(m[1]) + '</blockquote>'; }
    else if (l.trim() === '') { endList(); }
    else { endList(); html += '<p>' + mdInline(l) + '</p>'; }
  }
  endList();
  return html;
}
function noteHtmlDoc(title, src) {
  const body = src && src.trim() ? mdToHtml(src) : '<p style="color:#888;font-style:italic">Empty note.</p>';
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + mdEscape(title || 'Note')
    + '</title><style>' + PRINT_CSS + '</style></head><body><main class="doc">' + body + '</main></body></html>';
}

// Render a self-contained HTML doc to PDF via a hidden window (selectable text).
async function exportHtmlToPdf(html) {
  const tmpHtml = path.join(app.getPath('temp'), 'cm-note-' + Date.now() + '.html');
  fs.writeFileSync(tmpHtml, html, 'utf-8');
  const pdfWin = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, javascript: false },
  });
  try {
    await pdfWin.loadFile(tmpHtml);
    return await pdfWin.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { marginType: 'custom', top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 },
    });
  } finally {
    if (pdfWin && !pdfWin.isDestroyed()) pdfWin.close();
    try { fs.unlinkSync(tmpHtml); } catch { /* ignore */ }
  }
}

// --- Tasks Window ---

const SNAP_MAGNET = 60;

// Snap links: peer-based graph { name → { anchor: name, side } | null }
let snapLinks = {
  tasks: { anchor: 'widget', side: 'left' },
  calendar: { anchor: 'widget', side: 'right' },
};

function getWinByName(n) {
  if (n === 'widget') return win;
  if (n === 'tasks') return tasksWin;
  if (n === 'calendar') return calWin;
  if (n === 'notes') return notesWin;
  return null;
}

function getWinName(w) {
  if (w === win) return 'widget';
  if (w === tasksWin) return 'tasks';
  if (w === calWin) return 'calendar';
  if (w === notesWin) return 'notes';
  return null;
}

// Universal snap detection: find nearest anchor among all windows
function detectSnapNear(dragBounds, excludeName) {
  const candidates = [];
  const allWins = [
    { name: 'widget', win: win },
    { name: 'tasks', win: tasksWin },
    { name: 'calendar', win: calWin },
    { name: 'notes', win: notesWin },
  ];
  for (const t of allWins) {
    if (t.name === excludeName || !t.win || t.win.isDestroyed() || !t.win.isVisible()) continue;
    const side = detectSnapSide(dragBounds, t.win.getBounds());
    if (side) {
      const tb = t.win.getBounds();
      const dist = Math.abs(dragBounds.x + dragBounds.width / 2 - tb.x - tb.width / 2)
        + Math.abs(dragBounds.y + dragBounds.height / 2 - tb.y - tb.height / 2);
      candidates.push({ anchor: t.name, side, dist });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.dist - b.dist);
  return candidates[0];
}

// Universal drag-snap handler factory
function createDragSnapHandler(getWin, winName, getW, getH) {
  let poller = null;
  let lastGhost = null;
  let movedTimer = null;

  function updateGhost() {
    const dw = getWin();
    if (!dw || dw.isDestroyed()) return;
    const db = dw.getBounds();

    // Detach check
    if (snapLinks[winName]) {
      const anchor = getWinByName(snapLinks[winName].anchor);
      if (anchor && !anchor.isDestroyed()) {
        const expected = getSnappedBounds(anchor.getBounds(), snapLinks[winName].side, getW(), getH());
        if (expected && (Math.abs(db.x - expected.x) > DETACH_PULL || Math.abs(db.y - expected.y) > DETACH_PULL)) {
          snapLinks[winName] = null;
          if (winName === 'tasks') tasksSnapped = false;
          if (winName === 'calendar') calendarSnapped = false;
        }
      }
    }

    const snap = detectSnapNear(db, winName);
    if (snap) {
      const anchor = getWinByName(snap.anchor);
      if (anchor && !anchor.isDestroyed()) {
        const ab = anchor.getBounds();
        const snapH = (snap.side === 'left' || snap.side === 'right') ? ab.height : getH();
        const ghost = getSnappedBounds(ab, snap.side, getW(), snapH);

        if (ghost && (!lastGhost || ghost.x !== lastGhost.x || ghost.y !== lastGhost.y || ghost.width !== lastGhost.width)) {
          showSnapGhost(ghost);
          lastGhost = ghost;
        }
        return;
      }
    }
    if (lastGhost) { hideSnapGhost(); lastGhost = null; }
  }

  return {
    onWillMove: function() {
      if (poller) return;
      poller = setInterval(updateGhost, 16);
      // Panels move freely — no group drag (only widget drags the group)
    },
    onMoved: function() {
      if (poller) { clearInterval(poller); poller = null; }
      stopGroupDrag();
      lastGhost = null;
      hideSnapGhost();

      const dw = getWin();
      if (!dw || dw.isDestroyed()) return;

      if (movedTimer) clearTimeout(movedTimer);
      movedTimer = setTimeout(() => {
        movedTimer = null;
        const dw2 = getWin();
        if (!dw2 || dw2.isDestroyed()) return;
        const db = dw2.getBounds();

        if (!snapLinks[winName]) {
          const snap = detectSnapNear(db, winName);
          if (snap) {
            // Push aside FIRST (before updating snapLinks so findFreeSide sees old state)
            pushAsideConflicts(winName, snap.anchor, snap.side);
            // Now update snap state
            snapLinks[winName] = { anchor: snap.anchor, side: snap.side };
            if (winName === 'tasks') tasksSnapped = snap.side;
            if (winName === 'calendar') calendarSnapped = snap.side;
            const anchor = getWinByName(snap.anchor);
            if (anchor && !anchor.isDestroyed()) {
              const ab2 = anchor.getBounds();
              const snapH2 = (snap.side === 'left' || snap.side === 'right') ? ab2.height : getH();
              const target = getSnappedBounds(ab2, snap.side, getW(), snapH2);
              if (target) {
                const wbBefore = win && !win.isDestroyed() ? win.getBounds() : null;
                animateWindowTo(dw2, target, 120, () => {
                  guardWidgetBounds(wbBefore);
                  setTimeout(resolveOverlaps, 100);
                  // Snap glow on affected windows
                  if (win && !win.isDestroyed()) win.webContents.send('snap-glow');
                  if (dw2 && !dw2.isDestroyed()) dw2.webContents.send('snap-glow');
                });
              }
            }
          }
        }
      }, 100);
    },
    cleanup: function() {
      if (poller) { clearInterval(poller); poller = null; }
      if (movedTimer) { clearTimeout(movedTimer); movedTimer = null; }
      hideSnapGhost();
    },
  };
}

// Compute snap position relative to any anchor
function getSnappedBounds(anchorBounds, side, snapW, snapH) {
  let b;
  if (side === 'left') b = { x: anchorBounds.x - snapW - SNAP_GAP, y: anchorBounds.y, width: snapW, height: snapH };
  else if (side === 'right') b = { x: anchorBounds.x + anchorBounds.width + SNAP_GAP, y: anchorBounds.y, width: snapW, height: snapH };
  else if (side === 'top') b = { x: anchorBounds.x, y: anchorBounds.y - snapH - SNAP_GAP, width: anchorBounds.width, height: snapH };
  else if (side === 'bottom') b = { x: anchorBounds.x, y: anchorBounds.y + anchorBounds.height + SNAP_GAP, width: anchorBounds.width, height: snapH };
  else return null;
  return clampToWorkArea(b);
}

// --- Linux window-event shim ------------------------------------------------
// Electron emits 'will-move', 'moved' and 'resized' only on Windows and macOS
// (the BrowserWindow docs annotate them _macOS_ _Windows_). On Linux only
// 'move' and 'resize' fire, so every snap handler wired to will-move/moved was
// dead code there - which is why panels never snapped on Linux.
//
// Verified on Electron 33.4.11 / Ubuntu 24.04 / GNOME 46 (XWayland):
//   * a WM-driven drag emits one 'move' per ConfigureNotify (~17ms apart at
//     60Hz) and zero 'will-move' / 'moved';
//   * setPosition/setBounds emit exactly one 'move', SYNCHRONOUSLY inside the
//     call with no async echo - which is what makes the guard below exact.
const DRAG_IDLE_MS = 150; // quiet period that closes a synthesised drag
const linuxEventShimmed = new WeakSet();

function enableLinuxWindowEvents(w) {
  if (process.platform !== 'linux' || !w || w.isDestroyed()) return;
  if (linuxEventShimmed.has(w)) return;
  linuxEventShimmed.add(w);

  // Our own repositioning (group drag, snap animation, edge magnet) also emits
  // 'move'. Without this guard a panel would read being moved BY the widget as
  // the user dragging it, and fight the group drag with its own snap.
  let programmatic = 0;
  for (const method of ['setPosition', 'setBounds', 'setContentBounds', 'setSize', 'setContentSize']) {
    if (typeof w[method] !== 'function') continue;
    const original = w[method].bind(w);
    w[method] = (...args) => {
      programmatic++;
      try { return original(...args); } finally { programmatic--; }
    };
  }

  let dragging = false;
  let moveIdle = null;
  let resizeIdle = null;

  w.on('move', () => {
    if (programmatic > 0) return;
    if (!dragging) {
      dragging = true;
      try { w.emit('will-move', { preventDefault() {} }, w.getBounds()); } catch { /* ignore */ }
    }
    if (moveIdle) clearTimeout(moveIdle);
    moveIdle = setTimeout(() => {
      moveIdle = null;
      dragging = false;
      try { w.emit('moved'); } catch { /* ignore */ }
    }, DRAG_IDLE_MS);
  });

  w.on('resize', () => {
    if (programmatic > 0) return;
    if (resizeIdle) clearTimeout(resizeIdle);
    resizeIdle = setTimeout(() => {
      resizeIdle = null;
      try { w.emit('resized'); } catch { /* ignore */ }
    }, DRAG_IDLE_MS);
  });

  w.on('closed', () => {
    if (moveIdle) { clearTimeout(moveIdle); moveIdle = null; }
    if (resizeIdle) { clearTimeout(resizeIdle); resizeIdle = null; }
  });
}

// Module-level group drag (used by createDragSnapHandler and widget drag)
let groupDragTracker = null;
function startGroupDrag(draggedWin) {
  stopGroupDrag();
  const peers = [];
  // Only move panels that are SNAPPED (have a snapLink or legacy snap state)
  if (tasksWin && !tasksWin.isDestroyed() && tasksWin.isVisible() && tasksSnapped) {
    peers.push({ win: tasksWin, startX: tasksWin.getBounds().x, startY: tasksWin.getBounds().y });
  }
  if (calWin && !calWin.isDestroyed() && calWin.isVisible() && calendarSnapped) {
    peers.push({ win: calWin, startX: calWin.getBounds().x, startY: calWin.getBounds().y });
  }
  if (notesWin && !notesWin.isDestroyed() && notesWin.isVisible() && snapLinks.notes) {
    peers.push({ win: notesWin, startX: notesWin.getBounds().x, startY: notesWin.getBounds().y });
  }
  if (peers.length === 0) return;
  const startX = draggedWin.getBounds().x;
  const startY = draggedWin.getBounds().y;
  groupDragTracker = setInterval(() => {
    if (!draggedWin || draggedWin.isDestroyed()) { stopGroupDrag(); return; }
    const [wx, wy] = draggedWin.getPosition();
    const dx = wx - startX;
    const dy = wy - startY;
    if (dx !== 0 || dy !== 0) {
      for (const p of peers) {
        if (p.win && !p.win.isDestroyed()) p.win.setPosition(p.startX + dx, p.startY + dy);
      }
    }
  }, 8);
}
function stopGroupDrag() {
  if (groupDragTracker) { clearInterval(groupDragTracker); groupDragTracker = null; }
}

// Check if proposed bounds overlap any visible window (excluding the one being dragged)
function ghostOverlapsAny(bounds, excludeName) {
  const all = [
    { name: 'widget', win: win },
    { name: 'tasks', win: tasksWin },
    { name: 'calendar', win: calWin },
    { name: 'notes', win: notesWin },
  ];
  for (const t of all) {
    if (t.name === excludeName || !t.win || t.win.isDestroyed() || !t.win.isVisible()) continue;
    const wb = t.win.getBounds();
    if (bounds.x < wb.x + wb.width && bounds.x + bounds.width > wb.x
      && bounds.y < wb.y + wb.height && bounds.y + bounds.height > wb.y) {
      return true;
    }
  }
  return false;
}

// --- (legacy compat) ---
const DETACH_PULL = 80;   // px — how far to drag before detaching
const TASKS_W = 280;
const TASKS_H = 300;

const SNAP_GAP = 6; // px gap between windows to prevent OS snap assist grouping

// Restore widget bounds after tasks operations (safety net for OS snap assist)
function guardWidgetBounds(savedBounds) {
  if (!savedBounds || !win || win.isDestroyed()) return;
  setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    const cur = win.getBounds();
    if (cur.width !== savedBounds.width || cur.height !== savedBounds.height
      || cur.x !== savedBounds.x || cur.y !== savedBounds.y) {
      win.setBounds(savedBounds);
    }
  }, 100);
}

function clampToWorkArea(bounds) {
  const display = screen.getDisplayMatching(bounds);
  const wa = display.workArea;
  const b = Object.assign({}, bounds);
  if (b.x + b.width > wa.x + wa.width) b.x = wa.x + wa.width - b.width;
  if (b.x < wa.x) b.x = wa.x;
  if (b.y + b.height > wa.y + wa.height) b.y = wa.y + wa.height - b.height;
  if (b.y < wa.y) b.y = wa.y;
  return b;
}

function getSnappedTasksBounds(side) {
  if (!win || win.isDestroyed()) return null;
  const wb = win.getBounds();
  const tw = (side === 'top' || side === 'bottom') ? wb.width : TASKS_W;
  const th = (side === 'top' || side === 'bottom') ? TASKS_H : wb.height;
  let b;
  if (side === 'left')   b = { x: wb.x - tw - SNAP_GAP, y: wb.y, width: tw, height: th };
  else if (side === 'right')  b = { x: wb.x + wb.width + SNAP_GAP, y: wb.y, width: tw, height: th };
  else if (side === 'top')    b = { x: wb.x, y: wb.y - th - SNAP_GAP, width: tw, height: th };
  else if (side === 'bottom') b = { x: wb.x, y: wb.y + wb.height + SNAP_GAP, width: tw, height: th };
  else return null;
  return clampToWorkArea(b);
}

const CAL_W = 300;
const CAL_H = 420;

function getSnappedCalendarBounds(side) {
  const link = snapLinks.calendar;
  const anchorName = (link && link.anchor) ? link.anchor : 'widget';
  const anchor = getWinByName(anchorName);
  if (!anchor || anchor.isDestroyed()) return null;
  const wb = anchor.getBounds();
  // Match anchor height when snapped left/right
  const calH = (side === 'left' || side === 'right') ? wb.height : CAL_H;
  // If tasks is on the same side, stack next to tasks instead
  const tb = (tasksSnapped === side && tasksWin && !tasksWin.isDestroyed() && tasksWin.isVisible())
    ? tasksWin.getBounds() : null;

  let b;
  if (side === 'left') {
    const xRef = tb ? tb.x : wb.x;
    b = { x: xRef - CAL_W - SNAP_GAP, y: wb.y, width: CAL_W, height: calH };
  } else if (side === 'right') {
    const xRef = tb ? tb.x + tb.width : wb.x + wb.width;
    b = { x: xRef + SNAP_GAP, y: wb.y, width: CAL_W, height: calH };
  } else if (side === 'top') {
    b = { x: wb.x, y: wb.y - CAL_H - SNAP_GAP, width: wb.width, height: CAL_H };
  } else {
    b = { x: wb.x, y: wb.y + wb.height + SNAP_GAP, width: wb.width, height: CAL_H };
  }
  return clampToWorkArea(b);
}

// --- Snap ghost preview ---
let snapGhost = null;

function showSnapGhost(bounds) {
  if (!bounds) { hideSnapGhost(); return; }
  if (!snapGhost || snapGhost.isDestroyed()) {
    snapGhost = new BrowserWindow({
      ...bounds,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    snapGhost.setIgnoreMouseEvents(true);
    snapGhost.loadFile(path.join(__dirname, 'snap-ghost.html'));
    snapGhost.showInactive();
  } else {
    snapGhost.setBounds(bounds);
    if (!snapGhost.isVisible()) snapGhost.showInactive();
  }
}

function hideSnapGhost() {
  if (snapGhost && !snapGhost.isDestroyed()) {
    snapGhost.hide();
  }
}

// --- Smooth snap animation ---
function animateWindowTo(targetWin, target, duration, cb) {
  if (!targetWin || targetWin.isDestroyed()) { if (cb) cb(); return; }
  const start = targetWin.getBounds();
  const startTime = Date.now();
  const timer = setInterval(() => {
    if (!targetWin || targetWin.isDestroyed()) { clearInterval(timer); if (cb) cb(); return; }
    const t = Math.min(1, (Date.now() - startTime) / duration);
    const ease = 1 - Math.pow(1 - t, 4); // fast snap easing // ease-out cubic
    targetWin.setBounds({
      x: Math.round(start.x + (target.x - start.x) * ease),
      y: Math.round(start.y + (target.y - start.y) * ease),
      width: Math.round(start.width + (target.width - start.width) * ease),
      height: Math.round(start.height + (target.height - start.height) * ease),
    });
    if (t >= 1) { clearInterval(timer); if (cb) cb(); }
  }, 8);
}

// --- Detect snap for any window against the widget + sibling windows ---

function detectSnapSide(tb, wb) {
  const tcx = tb.x + tb.width / 2;
  const tcy = tb.y + tb.height / 2;
  const wcx = wb.x + wb.width / 2;
  const wcy = wb.y + wb.height / 2;

  // Check if the two windows overlap at all (bounding box intersection)
  const overlapX = tb.x < wb.x + wb.width && tb.x + tb.width > wb.x;
  const overlapY = tb.y < wb.y + wb.height && tb.y + tb.height > wb.y;
  const overlapping = overlapX && overlapY;

  // If overlapping, always snap to the nearest side based on center offset
  if (overlapping) {
    const dx = tcx - wcx; // positive = tasks is to the right
    const dy = tcy - wcy; // positive = tasks is below
    // Pick the axis with larger offset, then the direction
    if (Math.abs(dx) >= Math.abs(dy)) {
      return dx >= 0 ? 'right' : 'left';
    } else {
      return dy >= 0 ? 'bottom' : 'top';
    }
  }

  // Not overlapping — check proximity (magnet pull range)
  const candidates = [];

  // Left: tasks right edge near widget left edge, vertically overlapping
  const leftGap = Math.abs(tb.x + tb.width - wb.x);
  const vOverlap = Math.min(tb.y + tb.height, wb.y + wb.height) - Math.max(tb.y, wb.y);
  if (leftGap < SNAP_MAGNET && (vOverlap > 0 || Math.abs(tcy - wcy) < wb.height)) {
    candidates.push({ side: 'left', dist: leftGap });
  }

  // Right: tasks left edge near widget right edge
  const rightGap = Math.abs(tb.x - (wb.x + wb.width));
  if (rightGap < SNAP_MAGNET && (vOverlap > 0 || Math.abs(tcy - wcy) < wb.height)) {
    candidates.push({ side: 'right', dist: rightGap });
  }

  // Top: tasks bottom edge near widget top edge, horizontally overlapping
  const topGap = Math.abs(tb.y + tb.height - wb.y);
  const hOverlap = Math.min(tb.x + tb.width, wb.x + wb.width) - Math.max(tb.x, wb.x);
  if (topGap < SNAP_MAGNET && (hOverlap > 0 || Math.abs(tcx - wcx) < wb.width)) {
    candidates.push({ side: 'top', dist: topGap });
  }

  // Bottom: tasks top edge near widget bottom edge
  const bottomGap = Math.abs(tb.y - (wb.y + wb.height));
  if (bottomGap < SNAP_MAGNET && (hOverlap > 0 || Math.abs(tcx - wcx) < wb.width)) {
    candidates.push({ side: 'bottom', dist: bottomGap });
  }

  if (candidates.length === 0) return false;
  candidates.sort((a, b) => a.dist - b.dist);
  return candidates[0].side;
}

function loadTasksBounds() {
  try {
    if (fs.existsSync(TASKS_BOUNDS_FILE)) {
      return JSON.parse(fs.readFileSync(TASKS_BOUNDS_FILE, 'utf-8'));
    }
  } catch { /* ignore */ }
  return null;
}

function saveTasksBounds() {
  if (!tasksWin || tasksWin.isDestroyed()) return;
  try {
    fs.writeFileSync(TASKS_BOUNDS_FILE, JSON.stringify(tasksWin.getBounds()));
  } catch { /* ignore */ }
}

// Find a free side on the widget (or any anchor) that no other panel occupies
function findFreeSide(anchorName, excludeName) {
  const sides = ['right', 'left', 'bottom', 'top'];
  const occupied = new Set();
  for (const [name, link] of Object.entries(snapLinks)) {
    if (name === excludeName) continue;
    if (link && link.anchor === anchorName) {
      const w = getWinByName(name);
      if (w && !w.isDestroyed() && w.isVisible()) occupied.add(link.side);
    }
  }
  // Also check screen space availability
  const anchor = getWinByName(anchorName);
  if (anchor && !anchor.isDestroyed()) {
    const ab = anchor.getBounds();
    const display = screen.getDisplayMatching(ab);
    const wa = display.workArea;
    for (const side of sides) {
      if (occupied.has(side)) continue;
      // Check if there's room on this side
      if (side === 'right' && ab.x + ab.width + SNAP_GAP + 260 > wa.x + wa.width) continue;
      if (side === 'left' && ab.x - SNAP_GAP - 260 < wa.x) continue;
      if (side === 'bottom' && ab.y + ab.height + SNAP_GAP + 280 > wa.y + wa.height) continue;
      if (side === 'top' && ab.y - SNAP_GAP - 280 < wa.y) continue;
      return side;
    }
  }
  // Fallback: first unoccupied side even if tight on space
  for (const side of sides) {
    if (!occupied.has(side)) return side;
  }
  return 'right';
}

// Push aside any panel that conflicts with the newly snapped one
function pushAsideConflicts(newName, anchorName, side) {
  for (const [name, link] of Object.entries(snapLinks)) {
    if (name === newName) continue;
    if (!link || link.anchor !== anchorName || link.side !== side) continue;
    const w = getWinByName(name);
    if (!w || w.isDestroyed() || !w.isVisible()) continue;

    // This panel is on the same side — move it to a free side
    const freeSide = findFreeSide(anchorName, name);
    snapLinks[name] = { anchor: anchorName, side: freeSide };
    if (name === 'tasks') tasksSnapped = freeSide;
    if (name === 'calendar') calendarSnapped = freeSide;

    const anchor = getWinByName(anchorName);
    if (anchor && !anchor.isDestroyed()) {
      const sz = name === 'tasks' ? { w: TASKS_W, h: w.getBounds().height } : { w: CAL_W, h: w.getBounds().height };
      const newBounds = getSnappedBounds(anchor.getBounds(), freeSide, sz.w, sz.h);
      if (newBounds) { animateWindowTo(w, newBounds, 120); w.moveTop(); }
    }
  }
}

function autoPickCalendarSide() {
  return findFreeSide('widget', 'calendar');
}

// Ensure no panels overlap — reposition any that do
function resolveOverlaps() {
  const panels = [
    { name: 'tasks', win: tasksWin },
    { name: 'calendar', win: calWin },
    { name: 'notes', win: notesWin },
  ];
  const visible = panels.filter(p => p.win && !p.win.isDestroyed() && p.win.isVisible());
  if (!win || win.isDestroyed()) return;

  const wb = win.getBounds();
  const moved = new Set();

  // Check widget overlap first
  for (const p of visible) {
    const pb = p.win.getBounds();
    if (pb.x < wb.x + wb.width && pb.x + pb.width > wb.x
      && pb.y < wb.y + wb.height && pb.y + pb.height > wb.y) {
      const freeSide = findFreeSide('widget', p.name);
      snapLinks[p.name] = { anchor: 'widget', side: freeSide };
      if (p.name === 'tasks') tasksSnapped = freeSide;
      if (p.name === 'calendar') calendarSnapped = freeSide;
      const sz = p.name === 'tasks' ? { w: TASKS_W, h: pb.height } : { w: CAL_W, h: wb.height };
      const newBounds = getSnappedBounds(wb, freeSide, sz.w, sz.h);
      if (newBounds) { animateWindowTo(p.win, newBounds, 120); p.win.moveTop(); }
      moved.add(p.name);
    }
  }

  // Check panel-to-panel overlap (skip already moved)
  if (visible.length >= 2) {
    for (let i = 0; i < visible.length; i++) {
      for (let j = i + 1; j < visible.length; j++) {
        const b = visible[j];
        if (moved.has(b.name)) continue;
        const ab = visible[i].win.getBounds();
        const bb = b.win.getBounds();
        if (ab.x < bb.x + bb.width && ab.x + ab.width > bb.x
          && ab.y < bb.y + bb.height && ab.y + ab.height > bb.y) {
          const freeSide = findFreeSide('widget', b.name);
          snapLinks[b.name] = { anchor: 'widget', side: freeSide };
          if (b.name === 'tasks') tasksSnapped = freeSide;
          if (b.name === 'calendar') calendarSnapped = freeSide;
          const sz = b.name === 'tasks' ? { w: TASKS_W, h: bb.height } : { w: CAL_W, h: wb.height };
          const newBounds = getSnappedBounds(wb, freeSide, sz.w, sz.h);
          if (newBounds) { animateWindowTo(b.win, newBounds, 120); b.win.moveTop(); }
          moved.add(b.name);
        }
      }
    }
  }
}

let currentNoteTaskId = null; // track which task note is open

function openAddEventWindow(selectedDate) {
  if (addEventWin && !addEventWin.isDestroyed()) {
    addEventWin.focus();
    if (selectedDate) addEventWin.webContents.send('set-date', selectedDate);
    return;
  }

  const display = getWidgetDisplay();
  const wa = display.workArea;
  const eW = 320;
  const eH = 480;

  addEventWin = new BrowserWindow({
    width: eW, height: eH,
    x: Math.round(wa.x + (wa.width - eW) / 2),
    y: Math.round(wa.y + (wa.height - eH) / 2),
    frame: false, resizable: false,
    skipTaskbar: true, alwaysOnTop: true,
    ...POPUP_GLASS_OPTS_FN(),
    show: false, icon: getWindowIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'add-event-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  applyLinuxPopupTransparency(addEventWin);
  addEventWin.loadFile('add-event.html');
  addEventWin.once('ready-to-show', () => {
    if (addEventWin && !addEventWin.isDestroyed()) addEventWin.show();
    const theme = THEMES[currentTheme] || THEMES.dark;
    addEventWin.webContents.send('theme-update', { name: currentTheme, ...theme });
    if (selectedDate) addEventWin.webContents.send('set-date', selectedDate);
  });
  addEventWin.on('closed', () => { addEventWin = null; });
}

function openNotesWindow(taskId, taskText) {
  if (notesWin && !notesWin.isDestroyed()) {
    if (taskId) {
      // Same task note already open and visible — toggle hide
      if (currentNoteTaskId === taskId && notesWin.isVisible()) {
        notesWin.hide();
        return;
      }
      // Different task or hidden — switch to that task's note
      currentNoteTaskId = taskId;
      notesWin.webContents.send('load-task-note', { taskId, taskText });
      if (!notesWin.isVisible()) notesWin.show();
    } else if (notesWin.isVisible()) {
      notesWin.hide();
    } else {
      currentNoteTaskId = null;
      notesWin.webContents.send('load-global-note');
      notesWin.show();
    }
    return;
  }
  // Position: if task note, snap to tasks window; if global, find free side on widget
  currentNoteTaskId = taskId || null;
  // Wider default so the sticky board + markdown split editor have room to breathe
  const nW = 380;
  const nHstandalone = 480;
  let bounds;
  if (taskId && tasksWin && !tasksWin.isDestroyed() && tasksWin.isVisible()) {
    const tb = tasksWin.getBounds();
    const noteSide = findFreeSide('tasks', 'notes');
    // Match anchor height for left/right snaps
    const nH = (noteSide === 'left' || noteSide === 'right') ? tb.height : nHstandalone;
    bounds = getSnappedBounds(tb, noteSide, nW, nH);
    snapLinks.notes = { anchor: 'tasks', side: noteSide };
  } else {
    const noteSide = findFreeSide('widget', 'notes');
    const wb = win && !win.isDestroyed() ? win.getBounds() : null;
    const nH = (wb && (noteSide === 'left' || noteSide === 'right')) ? wb.height : nHstandalone;
    bounds = wb ? getSnappedBounds(wb, noteSide, nW, nH) : clampToWorkArea({ x: 100, y: 100, width: nW, height: nHstandalone });
    snapLinks.notes = { anchor: 'widget', side: noteSide };
  }
  if (!bounds) bounds = { x: 100, y: 100, width: nW, height: nHstandalone };

  notesWin = new BrowserWindow({
    width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y,
    frame: false, resizable: true, minWidth: 200, minHeight: 150,
    skipTaskbar: true, alwaysOnTop: true, ...POPUP_GLASS_OPTS_FN(),
    show: false, icon: getWindowIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'notes-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      spellcheck: true,
    },
  });
  applyLinuxPopupTransparency(notesWin);
  notesWin.webContents.session.setSpellCheckerLanguages(['en-US', 'bg']);
  notesWin.setAlwaysOnTop(false); // dynamic z-order like the widget
  notesWin.on('show', () => {
    notesWin.moveTop();
    if (process.platform === 'win32') {
      notesWin.setAlwaysOnTop(true);
      setTimeout(() => { if (notesWin && !notesWin.isDestroyed()) notesWin.setAlwaysOnTop(false); }, 60);
    }
  });
  notesWin.loadFile('notes.html');
  notesWin.once('ready-to-show', () => {
    if (notesWin && !notesWin.isDestroyed()) notesWin.show();
    const theme = THEMES[currentTheme] || THEMES.dark;
    notesWin.webContents.send('theme-update', { name: currentTheme, ...theme });
    // If opened with a taskId, switch to that task's note after load
    if (taskId) {
      notesWin.webContents.send('load-task-note', { taskId, taskText });
    }
  });

  // Spellcheck context menu
  notesWin.webContents.on('context-menu', (event, params) => {
    if (params.misspelledWord) {
      const menuItems = [];
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        menuItems.push({
          label: suggestion,
          click: () => notesWin.webContents.replaceMisspelling(suggestion),
        });
      }
      if (menuItems.length > 0) menuItems.push({ type: 'separator' });
      menuItems.push({
        label: 'Add to dictionary',
        click: () => notesWin.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      });
      Menu.buildFromTemplate(menuItems).popup({ window: notesWin });
    }
  });
  notesWin.on('closed', () => { notesWin = null; snapLinks.notes = null; currentNoteTaskId = null; });

  // Drag snap for notes
  const notesDragSnap = createDragSnapHandler(
    () => notesWin, 'notes',
    () => 300,
    () => (notesWin && !notesWin.isDestroyed() ? notesWin.getBounds().height : 250)
  );
  notesWin.on('will-move', () => notesDragSnap.onWillMove());
  notesWin.on('moved', () => notesDragSnap.onMoved());
  enableLinuxWindowEvents(notesWin);
}

// --- Standalone Notes app window ---
// A promoted, real-app window: own taskbar button + icon, own bounds memory,
// independent of the widget. Task notes keep the small snapped panel above.
function loadNotesAppBounds() {
  try {
    if (fs.existsSync(NOTES_APP_BOUNDS_FILE)) {
      const b = JSON.parse(fs.readFileSync(NOTES_APP_BOUNDS_FILE, 'utf-8'));
      if (b && Number.isFinite(b.x) && Number.isFinite(b.width)) return clampToWorkArea(b);
    }
  } catch { /* ignore */ }
  return null;
}

let notesAppBoundsTimer = null;
function saveNotesAppBounds() {
  if (notesAppBoundsTimer) clearTimeout(notesAppBoundsTimer);
  notesAppBoundsTimer = setTimeout(() => {
    try {
      if (notesAppWin && !notesAppWin.isDestroyed()) {
        fs.writeFileSync(NOTES_APP_BOUNDS_FILE, JSON.stringify(notesAppWin.getBounds()));
      }
    } catch { /* ignore */ }
  }, 400);
}

function openNotesAppWindow() {
  if (notesAppWin && !notesAppWin.isDestroyed()) {
    // Toggle like the other widget panels: second click closes
    if (notesAppWin.isMinimized()) {
      notesAppWin.restore();
      notesAppWin.focus();
    } else if (notesAppWin.isVisible()) {
      notesAppWin.hide();
    } else {
      notesAppWin.show();
      notesAppWin.focus();
    }
    return;
  }

  const saved = loadNotesAppBounds();
  const bounds = saved || clampToWorkArea({ x: 160, y: 110, width: 760, height: 560 });

  notesAppWin = new BrowserWindow({
    width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y,
    frame: false, resizable: true, minWidth: 420, minHeight: 320,
    skipTaskbar: false, alwaysOnTop: false, ...POPUP_GLASS_OPTS_FN(),
    show: false, icon: getAssetPath('notes-icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'notes-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      spellcheck: true,
    },
  });
  applyLinuxPopupTransparency(notesAppWin);
  notesAppWin.webContents.session.setSpellCheckerLanguages(['en-US', 'bg']);

  // Own taskbar identity on Windows: separate group + custom icon, pinnable.
  // Must be a REAL file path — the shell can't read from inside the asar.
  if (process.platform === 'win32') {
    try {
      notesAppWin.setAppDetails({
        appId: 'claude-meter.notes',
        appIconPath: getRealIconPath('notes-icon.ico'),
        appIconIndex: 0,
      });
    } catch { /* ignore */ }
  }

  notesAppWin.loadFile('notes.html', { query: { mode: 'app' } });
  notesAppWin.once('ready-to-show', () => {
    if (!notesAppWin || notesAppWin.isDestroyed()) return;
    notesAppWin.show();
    const theme = THEMES[currentTheme] || THEMES.dark;
    notesAppWin.webContents.send('theme-update', { name: currentTheme, ...theme });
  });

  // Spellcheck context menu (same UX as the panel)
  notesAppWin.webContents.on('context-menu', (event, params) => {
    if (params.misspelledWord) {
      const menuItems = [];
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        menuItems.push({
          label: suggestion,
          click: () => notesAppWin.webContents.replaceMisspelling(suggestion),
        });
      }
      if (menuItems.length > 0) menuItems.push({ type: 'separator' });
      menuItems.push({
        label: 'Add to dictionary',
        click: () => notesAppWin.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      });
      Menu.buildFromTemplate(menuItems).popup({ window: notesAppWin });
    }
  });

  notesAppWin.on('moved', saveNotesAppBounds);
  notesAppWin.on('resized', saveNotesAppBounds);
  enableLinuxWindowEvents(notesAppWin);
  notesAppWin.on('closed', () => { notesAppWin = null; });
}

// --- Global quick-task capture (Ctrl+] anywhere) ---
let captureWin = null;

function openQuickTaskCapture() {
  if (captureWin && !captureWin.isDestroyed()) { captureWin.focus(); return; }
  const { workArea } = screen.getPrimaryDisplay();
  const cw = 460, ch = 106;
  captureWin = new BrowserWindow({
    width: cw, height: ch,
    x: Math.round(workArea.x + (workArea.width - cw) / 2),
    y: Math.round(workArea.y + workArea.height * 0.18),
    frame: false, resizable: false, skipTaskbar: true, alwaysOnTop: true,
    ...POPUP_GLASS_OPTS_FN(), show: false, icon: getAssetPath('icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'capture-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      spellcheck: true,
    },
  });
  applyLinuxPopupTransparency(captureWin);
  captureWin.loadFile('capture.html');
  captureWin.once('ready-to-show', () => {
    if (captureWin && !captureWin.isDestroyed()) { captureWin.show(); captureWin.focus(); }
  });
  captureWin.on('blur', () => { if (captureWin && !captureWin.isDestroyed()) captureWin.close(); });
  captureWin.on('closed', () => { captureWin = null; });
}

function openCalendarWindow() {
  if (calWin && !calWin.isDestroyed()) {
    if (calWin.isVisible()) {
      calWin.hide();
      calWasVisible = false;
    } else {
      // Keep existing side if set and not conflicting, otherwise auto-pick
      if (!calendarSnapped || calendarSnapped === tasksSnapped) {
        calendarSnapped = autoPickCalendarSide();
        snapLinks.calendar = { anchor: 'widget', side: calendarSnapped };
      }
      calWasVisible = true;
      const b = getSnappedCalendarBounds(calendarSnapped);
      if (b) calWin.setBounds(b);
      calWin.show();
    }
    return;
  }

  calendarSnapped = autoPickCalendarSide();
  snapLinks.calendar = { anchor: 'widget', side: calendarSnapped };
  calWasVisible = true;
  const snapBounds = getSnappedCalendarBounds(calendarSnapped) || { width: CAL_W, height: CAL_H };
  const calX = snapBounds.x;
  const calY = snapBounds.y;
  const calW = snapBounds.width;
  const calH = snapBounds.height;

  calWin = new BrowserWindow({
    width: calW,
    height: calH,
    x: calX,
    y: calY,
    frame: false,
    resizable: true,
    minWidth: 260,
    minHeight: 280,
    skipTaskbar: true,
    alwaysOnTop: true,
    ...POPUP_GLASS_OPTS_FN(),
    show: false,
    icon: getWindowIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'calendar-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  applyLinuxPopupTransparency(calWin);
  calWin.setAlwaysOnTop(false); // dynamic z-order like the widget
  calWin.on('show', () => {
    calWin.moveTop();
    if (process.platform === 'win32') {
      calWin.setAlwaysOnTop(true);
      setTimeout(() => { if (calWin && !calWin.isDestroyed()) calWin.setAlwaysOnTop(false); }, 60);
    }
  });
  calWin.loadFile('calendar.html');

  calWin.once('ready-to-show', () => {
    if (calWin && !calWin.isDestroyed()) calWin.show();
    setTimeout(resolveOverlaps, 300);
    // Apply current theme
    const theme = THEMES[currentTheme] || THEMES.dark;
    calWin.webContents.send('theme-update', { name: currentTheme, ...theme });
  });

  calWin.on('closed', () => { calWin = null; calendarSnapped = 'right'; hideSnapGhost(); });

  // Peer-based drag snap for calendar
  const calDragSnap = createDragSnapHandler(
    () => calWin, 'calendar',
    () => CAL_W,
    () => CAL_H
  );
  calWin.on('will-move', () => calDragSnap.onWillMove());
  calWin.on('moved', () => calDragSnap.onMoved());
  enableLinuxWindowEvents(calWin);
}

function openTasksWindow() {
  if (tasksWin && !tasksWin.isDestroyed()) {
    // Toggle: if visible, hide it; if hidden, show it
    if (tasksWin.isVisible()) {
      if (tasksMovedTimer) { clearTimeout(tasksMovedTimer); tasksMovedTimer = null; }
      tasksUserHidden = true;
      saveTasksBounds();
      tasksWin.hide();
      if (win && !win.isDestroyed()) win.focus();
    } else {
      tasksUserHidden = false;
      tasksSnapped = findFreeSide('widget', 'tasks');
      snapLinks.tasks = { anchor: 'widget', side: tasksSnapped };
      const savedWidgetBounds = win && !win.isDestroyed() ? win.getBounds() : null;
      const sb = getSnappedTasksBounds(tasksSnapped);
      if (sb) tasksWin.setBounds(sb);
      tasksWin.show();
      guardWidgetBounds(savedWidgetBounds);
      setTimeout(resolveOverlaps, 300);
    }
    return;
  }

  // Always pick a free side to avoid overlaps
  tasksSnapped = findFreeSide('widget', 'tasks');
  snapLinks.tasks = { anchor: 'widget', side: tasksSnapped };
  const snapped = getSnappedTasksBounds(tasksSnapped);
  const saved = loadTasksBounds();
  const bounds = tasksSnapped && snapped ? snapped : (saved || snapped || { width: TASKS_W, height: 400 });

  tasksWin = new BrowserWindow({
    width: bounds.width || TASKS_W,
    height: bounds.height || 400,
    x: bounds.x,
    y: bounds.y,
    frame: false,
    resizable: true,
    minWidth: 180,
    minHeight: 200,
    skipTaskbar: true,
    alwaysOnTop: true,
    ...POPUP_GLASS_OPTS_FN(),
    show: false,
    icon: getWindowIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'tasks-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  applyLinuxPopupTransparency(tasksWin);
  tasksWin.setAlwaysOnTop(false); // dynamic z-order like the widget
  tasksWin.on('show', () => {
    tasksWin.moveTop();
    if (process.platform === 'win32') {
      tasksWin.setAlwaysOnTop(true);
      setTimeout(() => { if (tasksWin && !tasksWin.isDestroyed()) tasksWin.setAlwaysOnTop(false); }, 60);
    }
  });
  tasksWin.loadFile('tasks.html');

  tasksWin.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  });
  tasksWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  const initWidgetBounds = win && !win.isDestroyed() ? win.getBounds() : null;
  tasksWin.once('ready-to-show', () => {
    if (tasksWin && !tasksWin.isDestroyed()) tasksWin.show();
    guardWidgetBounds(initWidgetBounds);
    setTimeout(resolveOverlaps, 300);
    const theme = THEMES[currentTheme] || THEMES.dark;
    tasksWin.webContents.send('theme-update', { name: currentTheme, ...theme });
  });

  // Peer-based drag snap for tasks
  const tasksDragSnap = createDragSnapHandler(
    () => tasksWin, 'tasks',
    () => TASKS_W,
    () => (tasksWin && !tasksWin.isDestroyed() ? tasksWin.getBounds().height : TASKS_H)
  );
  tasksWin.on('will-move', () => tasksDragSnap.onWillMove());
  tasksWin.on('moved', () => { tasksDragSnap.onMoved(); saveTasksBounds(); });
  enableLinuxWindowEvents(tasksWin);

  tasksWin.on('closed', () => {
    saveTasksBounds();
    tasksWin = null;
  });
}

ipcMain.on('tasks-window-close', (event) => {
  try { if (!event.senderFrame || !event.senderFrame.url.startsWith('file://')) return; } catch { return; }
  if (tasksMovedTimer) { clearTimeout(tasksMovedTimer); tasksMovedTimer = null; }
  if (tasksWin && !tasksWin.isDestroyed()) {
    tasksUserHidden = true;
    saveTasksBounds();
    tasksWin.hide();
  }
});

// --- File watching ---

let linuxSubWatchers = [];

function onJsonlChange(_, filename) {
  if (!filename || !/\.jsonl$/i.test(filename)) return;
  if (fileChangeTimer) clearTimeout(fileChangeTimer);
  fileChangeTimer = setTimeout(() => {
    // Only broadcast cached data on file changes — don't hit the API
    // The periodic timer handles real syncs
    broadcastUsage();
    updateTrayTooltip();
  }, 3000);
}

function startFileWatcher() {
  try {
    if (!fs.existsSync(PROJECTS_DIR)) return;
    const supportsRecursive = process.platform === 'win32' || process.platform === 'darwin';

    if (supportsRecursive) {
      fileWatcher = fs.watch(PROJECTS_DIR, { recursive: true }, onJsonlChange);
    } else {
      // Linux: fs.watch recursive is unsupported — watch each subdirectory individually
      fileWatcher = fs.watch(PROJECTS_DIR, (eventType, dirname) => {
        // Watch newly created project subdirectories
        if (eventType === 'rename' && dirname) {
          const sub = path.join(PROJECTS_DIR, dirname);
          try {
            if (fs.existsSync(sub) && fs.statSync(sub).isDirectory()) {
              const w = fs.watch(sub, onJsonlChange);
              linuxSubWatchers.push(w);
            }
          } catch { /* ignore */ }
        }
      });
      // Watch existing subdirectories
      try {
        const entries = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const w = fs.watch(path.join(PROJECTS_DIR, entry.name), onJsonlChange);
            linuxSubWatchers.push(w);
          }
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

// --- App lifecycle ---

// Single instance lock - prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // If user tries to open another instance, show the window
    if (win) {
      // On Wayland Electron cannot grab a global hotkey, so Ctrl+\\ is a GNOME
      // custom shortcut that relaunches this app. Treat a second instance as the
      // hotkey press itself, so the same key closes it again.
      const wasVisible = win.isVisible();
      toggleWindow();
      if (!wasVisible) win.focus();
    }
  });
}

app.whenReady().then(() => {
  startToggleSocket();
  // Ensure data directory exists
  try { fs.mkdirSync(CLAUDE_DIR, { recursive: true }); } catch { /* ignore */ }

  loadSettings();
  tasks = loadTasks();
  habits = loadHabits();
  calendarEvents = loadCalendarEvents();
  gcalAccounts = loadGcalConfig();
  streakData = loadStreak();
  // Discover/merge accounts, then hydrate each one's cached usage + history
  initAccounts();
  for (const ctx of Object.values(accountCtx)) {
    loadAccountState(ctx);
    ctx.history = loadHistory(ctx);
  }
  saveSettings();
  loadPomoState();
  // Resume pomo timer if it was running
  if (pomoState === 'running' || pomoState === 'break') {
    pomoInterval = setInterval(pomoTick, 1000);
  }
  startCliMarkerWatcher();
  // Pick up accounts logged in (or out) while the app is running.
  const discoveryTimer = setInterval(
    () => rediscoverAccounts('poll'), ACCOUNT_DISCOVERY_INTERVAL_MS
  );
  cleanupTimers.push(discoveryTimer);
  startClaudeStatusPoller();
  scheduleReminders();
  scheduleDailyDigest();
  // Re-check reminders every 5 minutes (catches missed reminders from sleep/boot)
  setInterval(scheduleReminders, 5 * 60 * 1000);

  // Google Calendar: initial sync + timer
  if (gcalAccounts.length > 0) {
    setTimeout(() => syncGoogleCalendars(), 3000); // 3s after startup
  }
  startGcalSyncTimer();

  ensureLinuxShortcut();
  createWindow();

  // Tray
  tray = new Tray(getTrayIcon());
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => toggleWindow());
  updateTrayTooltip();

  // Global hotkey — retry registration in case system isn't ready yet
  const registerHotkey = () => {
    try {
      if (globalShortcut.isRegistered(currentHotkey)) return true;
      return globalShortcut.register(currentHotkey, () => toggleWindow());
    } catch { return false; }
  };
  if (!registerHotkey()) {
    // Retry after 3 seconds (system might not be ready on boot)
    setTimeout(registerHotkey, 3000);
  }

  // Quick-task hotkey: add a task from anywhere
  try { globalShortcut.register('Control+]', openQuickTaskCapture); } catch { /* ignore */ }

  // IPC sender validation helper
  const isLocalSender = (event) => {
    try {
      return event.senderFrame && event.senderFrame.url.startsWith('file://');
    } catch { return false; }
  };

  // IPC
  ipcMain.on('popup-dismiss', (event) => {
    if (!isLocalSender(event)) return;
    if (alertPopup && !alertPopup.isDestroyed()) alertPopup.close();
  });

  ipcMain.on('request-sync', (event) => {
    if (!isLocalSender(event)) return;
    rediscoverAccounts('manual'); // a manual refresh also picks up new logins
    syncAllAccounts(true); // manual refresh: bypass the freshness check, keep 429 backoffs
  });

  ipcMain.handle('get-accounts', (event) => {
    if (!isLocalSender(event)) return { accounts: [], activeAccountId: null };
    return buildUsagePayload();
  });

  ipcMain.handle('set-active-account', (event, id) => {
    if (!isLocalSender(event)) return { success: false };
    if (typeof id !== 'string' || !accountCtx[id]) return { success: false };
    const entry = accountList.find((a) => a.id === id);
    if (!entry || entry.enabled === false) return { success: false };
    if (activeAccountId !== id) {
      activeAccountId = id;
      saveSettings();
      const ctx = accountCtx[id];
      updateTrayTooltip();
      if (ctx.cachedUsage) updateTrayBadge(ctx.cachedUsage);
      broadcastUsage();
      syncIfStale(ctx);
    }
    return { success: true, activeAccountId };
  });
  ipcMain.on('minimize-to-tray', (event) => {
    if (!isLocalSender(event)) return;
    if (win) { saveBoundsNow(); win.hide(); }
  });
  ipcMain.on('quit-app', (event) => {
    if (!isLocalSender(event)) return;
    if (win && !win.isDestroyed()) win.destroy();
    app.quit();
  });

  ipcMain.on('widget-move-by', (event, dx, dy) => {
    if (!isLocalSender(event)) return;
    if (!win || win.isDestroyed()) return;
    if (typeof dx !== 'number' || typeof dy !== 'number') return;

    // Move widget
    const [x, y] = win.getPosition();
    win.setPosition(x + dx, y + dy);

    // Move only SNAPPED panels with it (consistent with native drag)
    const snappedPanels = [];
    if (tasksSnapped && tasksWin && !tasksWin.isDestroyed() && tasksWin.isVisible()) snappedPanels.push(tasksWin);
    if (calendarSnapped && calWin && !calWin.isDestroyed() && calWin.isVisible()) snappedPanels.push(calWin);
    if (snapLinks.notes && notesWin && !notesWin.isDestroyed() && notesWin.isVisible()) snappedPanels.push(notesWin);
    for (const p of snappedPanels) {
      const [px, py] = p.getPosition();
      p.setPosition(px + dx, py + dy);
    }
  });

  ipcMain.on('toggle-compact', (event, isCompact) => {
    if (!isLocalSender(event)) return;
    // Just let the CSS handle compact styling — no forced height change
  });

  ipcMain.on('open-dashboard', (event, tab) => {
    if (!isLocalSender(event)) return;
    openDashboard(typeof tab === 'string' ? tab : undefined);
  });

  // Auth status check for first-launch onboarding
  ipcMain.handle('check-auth-status', () => {
    // The overlay is about the active account — any other account's expiry is
    // reported on its own tab instead.
    const ctx = getActiveCtx();
    const token = ctx ? getAccessToken(ctx) : null;
    // Check if claude CLI is in PATH
    let cliInstalled = false;
    try {
      const cmd = process.platform === 'win32' ? 'where' : 'which';
      const { execFileSync } = require('child_process');
      execFileSync(cmd, ['claude'], { stdio: 'ignore' });
      cliInstalled = true;
    } catch { /* not found */ }
    return {
      authenticated: !!token,
      claudeCodeInstalled: cliInstalled,
      credentialsExist: !!ctx && fs.existsSync(ctx.credsFile),
    };
  });

  // Launch claude auth login from the app
  let reAuthWatcher = null;
  ipcMain.handle('launch-auth-login', () => {
    try {
      const { execFileSync } = require('child_process');
      const cmd = process.platform === 'win32' ? 'where' : 'which';
      const lines = execFileSync(cmd, ['claude'], { encoding: 'utf-8' })
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      const claudePath = (process.platform === 'win32'
        ? lines.find((l) => /\.cmd$/i.test(l))
        : null) || lines[0];
      if (!claudePath) return { success: false, error: 'Claude CLI not found' };

      const child = spawn(claudePath, ['auth', 'login'], {
        stdio: 'ignore',
        detached: true,
        shell: process.platform === 'win32',
        windowsHide: true,
      });
      child.unref();

      // Watch for credentials change (works for both first sign-in and re-sign-in).
      // `claude auth login` writes to the active account's config dir.
      const authCtx = getActiveCtx();
      if (reAuthWatcher) { reAuthWatcher.close(); reAuthWatcher = null; }
      try {
        const watchDir = authCtx ? authCtx.dir : CLAUDE_DIR;
        fs.mkdirSync(watchDir, { recursive: true });
        reAuthWatcher = fs.watch(watchDir, (_, filename) => {
          if (filename === '.credentials.json' && authCtx) {
            authCtx.cachedToken = null;
            authCtx.tokenLastRead = 0;
            const token = getAccessToken(authCtx, true);
            if (token) {
              authCtx.signedOut = false;
              authCtx.needsLogin = false;
              if (win && !win.isDestroyed()) {
                win.webContents.send('auth-status-changed', { authenticated: true });
              }
              if (dashWin && !dashWin.isDestroyed()) {
                dashWin.webContents.send('auth-status-changed', { authenticated: true });
              }
              doSync(authCtx);
              if (reAuthWatcher) { reAuthWatcher.close(); reAuthWatcher = null; }
            }
          }
        });
        setTimeout(() => { if (reAuthWatcher) { reAuthWatcher.close(); reAuthWatcher = null; } }, 300000);
      } catch { /* ignore */ }

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Open external URL safely (only allow https)
  ipcMain.on('open-external-url', (event, url) => {
    if (!isLocalSender(event)) return;
    if (typeof url === 'string' && url.startsWith('https://')) {
      shell.openExternal(url);
    }
  });

  // Widget reports its natural content height → enforce it as the window minimum
  // so resizing can never clip rows; if currently clipped, grow to fit.
  ipcMain.on('widget-min-height', (event, h) => {
    if (!isLocalSender(event)) return;
    if (!win || win.isDestroyed()) return;
    let needed = Math.round(Number(h));
    if (!Number.isFinite(needed) || needed <= 0) return;
    const wa = screen.getDisplayMatching(win.getBounds()).workArea;
    needed = Math.max(200, Math.min(needed, wa.height));
    const minSize = win.getMinimumSize();
    win.setMinimumSize(minSize[0] || 280, needed);
    const b = win.getBounds();
    // Height auto-fits the content exactly: grow when clipped, shrink when
    // there's dead space (the calendar card stretches, so excess = empty white).
    if (Math.abs(b.height - needed) > 2) {
      const y = Math.max(wa.y, Math.min(b.y, wa.y + wa.height - needed));
      win.setBounds({ x: b.x, y, width: b.width, height: needed });
    }
  });

  // Watch every account whose credentials are missing/unusable, so a sign-in in
  // any config dir is picked up without restarting the app.
  function closeCredsWatchers() {
    for (const w of credsWatchers) { try { w.close(); } catch { /* ignore */ } }
    credsWatchers = [];
  }

  function watchForCredentials() {
    closeCredsWatchers();
    for (const ctx of enabledAccounts()) {
      if (getAccessToken(ctx)) continue;
      try {
        fs.mkdirSync(ctx.dir, { recursive: true });
      } catch { continue; }
      try {
        const watcher = fs.watch(ctx.dir, (_, filename) => {
          if (filename !== '.credentials.json') return;
          const token = getAccessToken(ctx, true);
          if (!token) return;
          ctx.signedOut = false;
          ctx.needsLogin = false;
          ctx.lastError = null;
          if (ctx.id === activeAccountId) {
            if (win && !win.isDestroyed()) {
              win.webContents.send('auth-status-changed', { authenticated: true });
            }
            if (dashWin && !dashWin.isDestroyed()) {
              dashWin.webContents.send('auth-status-changed', { authenticated: true });
            }
          }
          doSync(ctx);
          try { watcher.close(); } catch { /* ignore */ }
          credsWatchers = credsWatchers.filter((w) => w !== watcher);
        });
        credsWatchers.push(watcher);
      } catch { /* ignore watch errors */ }
    }
  }
  watchForCredentials();

  ipcMain.on('dash-minimize', (event) => { if (isLocalSender(event) && dashWin && !dashWin.isDestroyed()) dashWin.minimize(); });
  ipcMain.on('dash-maximize', (event) => {
    if (!isLocalSender(event)) return;
    if (dashWin && !dashWin.isDestroyed()) {
      dashWin.isMaximized() ? dashWin.unmaximize() : dashWin.maximize();
    }
  });
  ipcMain.on('dash-close', (event) => { if (isLocalSender(event) && dashWin && !dashWin.isDestroyed()) dashWin.close(); });

  ipcMain.on('dashboard-request-data', (event) => {
    if (!isLocalSender(event)) return;
    if (dashWin && !dashWin.isDestroyed()) {
      dashWin.webContents.send('usage-update', buildUsagePayload());
      const hist = activeHistory();
      if (hist.length > 0) dashWin.webContents.send('history-update', hist);
      if (claudeStatus) dashWin.webContents.send('claude-status-update', claudeStatus);
    }
    syncAllAccounts(false);
  });

  ipcMain.handle('get-claude-status', (event) => {
    if (!isLocalSender(event)) return null;
    return claudeStatus;
  });

  ipcMain.on('dashboard-save-settings', (event, settings) => {
    if (!isLocalSender(event)) return;
    if (!settings || typeof settings !== 'object') return;
    if (settings.alertThresholds && typeof settings.alertThresholds === 'object') {
      const t = settings.alertThresholds;
      const clampThreshold = (v) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return null;
        return Math.min(100, Math.max(5, Math.round(n)));
      };
      const keys = ['session', 'weekAll', 'weekSonnet'];
      for (const key of keys) {
        if (t[key] != null) {
          const raw = typeof t[key] === 'object' ? t[key].value : t[key];
          const val = clampThreshold(raw);
          if (val !== null) ALERT_THRESHOLDS[key] = val;
        }
      }
    }
    saveSettings();
  });

  ipcMain.handle('change-hotkey', async (event, newHotkey) => {
    if (!isLocalSender(event)) return { success: false, error: 'Unauthorized' };
    if (typeof newHotkey !== 'string' || newHotkey.length === 0
      || newHotkey.length > 50 || !SAFE_HOTKEY_RE.test(newHotkey)) {
      return { success: false, error: 'Invalid hotkey format' };
    }
    try {
      globalShortcut.unregister(currentHotkey);
      const registered = globalShortcut.register(newHotkey, () => toggleWindow());
      if (!registered) {
        // Re-register old hotkey if new one fails
        globalShortcut.register(currentHotkey, () => toggleWindow());
        return { success: false, error: 'Hotkey already in use or invalid' };
      }
      currentHotkey = newHotkey;
      saveSettings();
      // Update tray menu to reflect new hotkey
      if (tray) tray.setContextMenu(buildTrayMenu());
      return { success: true, hotkey: currentHotkey };
    } catch (err) {
      // Try to restore old hotkey
      try { globalShortcut.register(currentHotkey, () => toggleWindow()); } catch { /* ignore */ }
      return { success: false, error: err.message || 'Failed to register hotkey' };
    }
  });

  ipcMain.handle('get-settings', async () => {
    return {
      hotkey: currentHotkey,
      version: (APP_VERSION || app.getVersion()),
      alertThresholds: {
        session: ALERT_THRESHOLDS.session,
        weekAll: ALERT_THRESHOLDS.weekAll,
        weekSonnet: ALERT_THRESHOLDS.weekSonnet,
      },
    };
  });

  // --- Secondary account IPC handlers ---

  ipcMain.handle('sign-out', async (event) => {
    if (!isLocalSender(event)) return { success: false, error: 'Unauthorized' };
    // Signs out the active account only — other accounts keep syncing.
    const ctx = getActiveCtx();
    if (ctx) {
      ctx.cachedToken = null;
      ctx.tokenLastRead = 0;
      ctx.signedOut = true;
      ctx.needsLogin = true;
    }
    // Notify all windows
    if (win && !win.isDestroyed()) {
      win.webContents.send('auth-status-changed', { authenticated: false });
      win.show();
    }
    if (dashWin && !dashWin.isDestroyed()) {
      dashWin.webContents.send('auth-status-changed', { authenticated: false });
    }
    // Watch for re-authentication
    watchForCredentials();
    return { success: true };
  });

  ipcMain.handle('get-autostart', async () => {
    return { enabled: getAutoStartEnabled() };
  });

  ipcMain.handle('set-autostart', async (event, enabled) => {
    if (!isLocalSender(event)) return { success: false };
    setAutoStartEnabled(enabled);
    return { success: true, enabled: getAutoStartEnabled() };
  });

  // --- Tasks IPC ---
  ipcMain.handle('tasks-get', (event) => {
    if (!isLocalSender(event)) return [];
    // Enrich with linked calendar event dates
    return tasks.map((t) => {
      const linked = calendarEvents.find((e) => e.linkedTaskId === t.id);
      if (linked) return Object.assign({}, t, { dueDate: linked.date, dueTime: linked.time || null });
      return t;
    });
  });

  ipcMain.on('tasks-add', (event, text) => {
    if (!isLocalSender(event)) return;
    addTask(text);
  });

  ipcMain.on('tasks-toggle', (event, id) => {
    if (!isLocalSender(event)) return;
    if (typeof id === 'string' && id.length < 20) toggleTask(id);
  });

  ipcMain.on('tasks-delete', (event, id) => {
    if (!isLocalSender(event)) return;
    if (typeof id === 'string' && id.length < 20) deleteTask(id);
  });

  ipcMain.on('tasks-clear-completed', (event) => {
    if (!isLocalSender(event)) return;
    clearCompletedTasks();
  });

  // --- Habits IPC ---
  ipcMain.handle('habits-get', (event) => {
    if (!isLocalSender(event)) return { training: [], reading: [], learning: [] };
    return habits;
  });

  ipcMain.handle('habits-toggle-day', (event, kind, dateStr) => {
    if (!isLocalSender(event)) return habits;
    if (kind !== 'training' && kind !== 'reading' && kind !== 'learning') return habits;
    if (!isValidDateStr(dateStr)) return habits;
    const arr = habits[kind];
    const idx = arr.indexOf(dateStr);
    if (idx === -1) arr.push(dateStr);
    else arr.splice(idx, 1);
    saveHabits();
    broadcastHabits();
    return habits;
  });

  ipcMain.on('tasks-set-priority', (event, id, priority) => {
    if (!isLocalSender(event)) return;
    if (typeof id !== 'string' || id.length >= 20) return;
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    if (['high', 'medium', 'low'].indexOf(priority) >= 0) {
      task.priority = priority;
      saveTasks();
      broadcastTasks();
    }
  });

  ipcMain.on('tasks-reorder', (event, orderedIds) => {
    if (!isLocalSender(event)) return;
    if (!Array.isArray(orderedIds)) return;
    for (let i = 0; i < orderedIds.length; i++) {
      const task = tasks.find((t) => t.id === orderedIds[i]);
      if (task) task.order = i;
    }
    saveTasks();
    broadcastTasks();
  });

  ipcMain.on('tasks-add-with-priority', (event, text, priority) => {
    if (!isLocalSender(event)) return;
    addTask(text, priority);
  });

  ipcMain.handle('tasks-schedule', (event, taskId, date, time) => {
    if (!isLocalSender(event)) return { success: false };
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return { success: false };
    // Check if already linked to a calendar event
    const existing = calendarEvents.find((e) => e.linkedTaskId === taskId);
    if (existing) return { success: true, event: existing, alreadyExists: true };
    // Create a calendar event linked to this task
    const evt = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: task.text,
      date: date,
      time: time || null,
      duration: null,
      color: task.priority === 'high' ? 'red' : (task.priority === 'low' ? 'green' : 'orange'),
      reminder: 15,
      recurrence: null,
      done: false,
      linkedTaskId: task.id,
      googleEventId: null,
      createdAt: Date.now(),
    };
    calendarEvents.push(evt);
    saveCalendarEvents();
    broadcastCalendar();
    scheduleReminders();
    return { success: true, event: evt };
  });

  // Move event to a different date (drag reschedule)
  ipcMain.handle('calendar-move-event', (event, eventId, newDate) => {
    if (!isLocalSender(event)) return { success: false };
    if (typeof newDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return { success: false };
    const evt = calendarEvents.find((e) => e.id === eventId);
    if (!evt) return { success: false };
    evt.date = newDate;
    saveCalendarEvents();
    broadcastCalendar();
    scheduleReminders();
    return { success: true };
  });

  ipcMain.on('open-tasks-window', (event) => {
    if (!isLocalSender(event)) return;
    openTasksWindow();
  });

  ipcMain.on('open-calendar-window', (event) => {
    if (!isLocalSender(event)) return;
    openCalendarWindow();
  });

  // Pomodoro IPC
  ipcMain.on('pomo-start', (event) => {
    if (!isLocalSender(event)) return;
    if (pomoState === 'idle' || pomoState === 'paused') {
      pomoState = 'running';
      if (!pomoInterval) pomoInterval = setInterval(pomoTick, 1000);
    } else if (pomoState === 'running') {
      pomoState = 'paused';
      if (pomoInterval) { clearInterval(pomoInterval); pomoInterval = null; }
    } else if (pomoState === 'break') {
      pomoState = 'idle';
      pomoSeconds = POMO_WORK_SECS;
      pomoTotal = POMO_WORK_SECS;
      if (pomoInterval) { clearInterval(pomoInterval); pomoInterval = null; }
    } else if (pomoState === 'break_pending') {
      // Treat as "start break" — same as pomo-popup-start-next
      pomoState = 'break';
      pomoSeconds = POMO_BREAK_SECS;
      pomoTotal = POMO_BREAK_SECS;
      if (!pomoInterval) pomoInterval = setInterval(pomoTick, 1000);
    }
    broadcastPomo(true);
  });

  ipcMain.on('pomo-reset', (event) => {
    if (!isLocalSender(event)) return;
    pomoState = 'idle';
    pomoSeconds = POMO_WORK_SECS;
    pomoTotal = POMO_WORK_SECS;
    if (pomoInterval) { clearInterval(pomoInterval); pomoInterval = null; }
    broadcastPomo(true);
  });

  ipcMain.handle('pomo-get', () => {
    return { state: pomoState, seconds: pomoSeconds, total: pomoTotal };
  });

  // Meeting popup dismiss
  ipcMain.on('meeting-popup-dismiss', () => {
    if (alertPopup && !alertPopup.isDestroyed()) alertPopup.close();
  });

  // Pomo popup buttons
  ipcMain.on('pomo-popup-dismiss', () => {
    if (pomoPopupWin && !pomoPopupWin.isDestroyed()) pomoPopupWin.close();
  });
  ipcMain.on('pomo-popup-start-next', () => {
    if (pomoState === 'break_pending') {
      pomoState = 'break';
      pomoSeconds = POMO_BREAK_SECS;
      pomoTotal = POMO_BREAK_SECS;
      if (!pomoInterval) pomoInterval = setInterval(pomoTick, 1000);
      broadcastPomo(true);
      if (pomoPopupWin && !pomoPopupWin.isDestroyed()) {
        pomoPopupWin.webContents.send('pomo-popup-break-tick', {
          seconds: pomoSeconds, total: pomoTotal
        });
      }
    } else if (pomoState === 'idle') {
      if (pomoPopupWin && !pomoPopupWin.isDestroyed()) pomoPopupWin.close();
      pomoState = 'running';
      pomoSeconds = POMO_WORK_SECS;
      pomoTotal = POMO_WORK_SECS;
      if (!pomoInterval) pomoInterval = setInterval(pomoTick, 1000);
      broadcastPomo(true);
    } else {
      if (pomoPopupWin && !pomoPopupWin.isDestroyed()) pomoPopupWin.close();
    }
  });

  ipcMain.on('open-notes-window', (event) => {
    if (!isLocalSender(event)) return;
    // Global notes now open the standalone Notes app; task notes keep the snapped panel
    openNotesAppWindow();
  });

  ipcMain.handle('notes-get', () => {
    try { return fs.readFileSync(NOTES_FILE, 'utf-8'); } catch { return ''; }
  });

  ipcMain.on('notes-save', (event, text) => {
    if (!isLocalSender(event)) return;
    var content = typeof text === 'string' ? text : '';
    if (content.length > 500000) content = content.slice(0, 500000);
    try { fs.writeFileSync(NOTES_FILE, content); } catch { /* ignore */ }
  });

  // Multi-note sticky notes
  ipcMain.handle('sticky-notes-get', () => {
    try {
      if (fs.existsSync(STICKY_NOTES_FILE)) {
        return JSON.parse(fs.readFileSync(STICKY_NOTES_FILE, 'utf-8'));
      }
    } catch { /* ignore */ }
    return null;
  });

  ipcMain.on('sticky-notes-save', (event, notes) => {
    if (!isLocalSender(event)) return;
    if (!Array.isArray(notes)) return;
    // Validate and cap each note
    const clean = notes.slice(0, 50).map((n) => ({
      id: typeof n.id === 'string' ? n.id.slice(0, 20) : '',
      title: typeof n.title === 'string' ? n.title.slice(0, 30) : '',
      text: typeof n.text === 'string' ? n.text.slice(0, 100000) : '',
      color: typeof n.color === 'string' ? n.color.slice(0, 10) : 'default',
      createdAt: typeof n.createdAt === 'number' ? n.createdAt : Date.now(),
    }));
    try { fs.writeFileSync(STICKY_NOTES_FILE, JSON.stringify(clean, null, 2)); } catch { /* ignore */ }
    // Keep the other notes window (panel vs app) in sync
    for (const w of [notesWin, notesAppWin]) {
      if (w && !w.isDestroyed() && w.webContents !== event.sender) {
        try { w.webContents.send('sticky-notes-updated', clean); } catch { /* ignore */ }
      }
    }
  });

  // Quick-task popover → task list
  ipcMain.on('quick-task-submit', (event, text) => {
    if (!isLocalSender(event)) return;
    if (typeof text === 'string' && text.trim()) addTask(text.trim(), 'medium');
    if (captureWin && !captureWin.isDestroyed()) captureWin.close();
  });
  ipcMain.on('quick-task-close', (event) => {
    if (!isLocalSender(event)) return;
    if (captureWin && !captureWin.isDestroyed()) captureWin.close();
  });

  // Export a note as clean, send-ready Markdown
  ipcMain.handle('notes-export-md', async (event, note) => {
    if (!isLocalSender(event)) return { ok: false };
    const title = note && typeof note.title === 'string' ? note.title : 'note';
    const text = note && typeof note.text === 'string' ? note.text : '';
    const md = normalizeMarkdown(text);
    const res = await dialog.showSaveDialog(notesWin || win || undefined, {
      title: 'Export note as Markdown',
      defaultPath: safeFileName(title) + '.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    try { fs.writeFileSync(res.filePath, md, 'utf-8'); return { ok: true, path: res.filePath }; }
    catch (e) { return { ok: false, error: e.message }; }
  });

  // Export a note as a rendered PDF (selectable/copyable text)
  ipcMain.handle('notes-export-pdf', async (event, payload) => {
    if (!isLocalSender(event)) return { ok: false };
    const title = payload && typeof payload.title === 'string' ? payload.title : 'note';
    const text = payload && typeof payload.text === 'string' ? payload.text : '';
    const html = noteHtmlDoc(title, text);
    const res = await dialog.showSaveDialog(notesWin || win || undefined, {
      title: 'Export note as PDF',
      defaultPath: safeFileName(title) + '.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    try {
      const data = await exportHtmlToPdf(html);
      fs.writeFileSync(res.filePath, data);
      return { ok: true, path: res.filePath };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // Copy text to the OS clipboard (used by copy-flags in notes)
  ipcMain.on('notes-copy', (event, text) => {
    if (!isLocalSender(event)) return;
    if (typeof text === 'string') clipboard.writeText(text.slice(0, 100000));
  });

  // Notes archive — deleted notes go here for recovery
  ipcMain.handle('notes-archive-get', () => {
    try {
      if (fs.existsSync(NOTES_ARCHIVE_FILE)) {
        return JSON.parse(fs.readFileSync(NOTES_ARCHIVE_FILE, 'utf-8'));
      }
    } catch { /* ignore */ }
    return [];
  });

  ipcMain.on('notes-archive-add', (event, note) => {
    if (!isLocalSender(event)) return;
    if (!note || typeof note.id !== 'string') return;
    try {
      let archive = [];
      if (fs.existsSync(NOTES_ARCHIVE_FILE)) {
        archive = JSON.parse(fs.readFileSync(NOTES_ARCHIVE_FILE, 'utf-8'));
      }
      note.archivedAt = Date.now();
      archive.unshift(note);
      // Keep last 50 archived notes
      if (archive.length > 50) archive = archive.slice(0, 50);
      fs.writeFileSync(NOTES_ARCHIVE_FILE, JSON.stringify(archive, null, 2));
    } catch { /* ignore */ }
  });

  ipcMain.on('notes-archive-restore', (event, noteId) => {
    if (!isLocalSender(event)) return;
    if (typeof noteId !== 'string') return;
    try {
      let archive = [];
      if (fs.existsSync(NOTES_ARCHIVE_FILE)) {
        archive = JSON.parse(fs.readFileSync(NOTES_ARCHIVE_FILE, 'utf-8'));
      }
      archive = archive.filter((n) => n.id !== noteId);
      fs.writeFileSync(NOTES_ARCHIVE_FILE, JSON.stringify(archive, null, 2));
    } catch { /* ignore */ }
  });

  ipcMain.handle('get-theme', () => currentTheme);
  ipcMain.handle('set-theme', (event, themeName) => {
    if (!isLocalSender(event)) return;
    if (THEMES[themeName]) {
      currentTheme = themeName;
      broadcastTheme();
      // Save to settings
      try {
        const settings = fs.existsSync(SETTINGS_FILE)
          ? JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')) : {};
        settings.theme = themeName;
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
      } catch { /* ignore */ }
    }
  });

  // Smart parse (returns parsed result without creating anything)
  ipcMain.handle('smart-parse', (event, text) => {
    if (!isLocalSender(event)) return null;
    if (typeof text !== 'string' || !text.trim()) return null;
    return parseSmartText(text.trim());
  });

  ipcMain.on('close-add-event', (event) => {
    if (!isLocalSender(event)) return;
    if (addEventWin && !addEventWin.isDestroyed()) addEventWin.close();
  });

  ipcMain.on('open-add-event', (event, selectedDate) => {
    if (!isLocalSender(event)) return;
    openAddEventWindow(selectedDate);
  });

  // --- Smart add: parse plain text into task + calendar event ---
  ipcMain.handle('smart-add', (event, rawText) => {
    if (!isLocalSender(event)) return { success: false };
    if (typeof rawText !== 'string' || !rawText.trim()) return { success: false };
    const text = rawText.trim();
    const result = parseSmartText(text);

    // Always create a task
    addTask(result.title, result.priority);

    // If date was detected, also create a calendar event
    if (result.date) {
      const evt = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        title: result.title,
        date: result.date,
        time: result.time || null,
        duration: result.duration || null,
        color: result.priority === 'high' ? 'red' : (result.priority === 'low' ? 'green' : 'blue'),
        reminder: 15,
        recurrence: null,
        done: false,
        linkedTaskId: tasks[tasks.length - 1]?.id || null,
        googleEventId: null,
        createdAt: Date.now(),
      };
      calendarEvents.push(evt);
      saveCalendarEvents();
      broadcastCalendar();
      scheduleReminders();
      return { success: true, task: true, event: true, parsed: result };
    }

    return { success: true, task: true, event: false, parsed: result };
  });

  ipcMain.on('notes-window-close', (event) => {
    if (!isLocalSender(event)) return;
    // App window really closes; the snapped panel just hides
    if (notesAppWin && !notesAppWin.isDestroyed() && event.sender === notesAppWin.webContents) {
      notesAppWin.close();
      return;
    }
    if (notesWin && !notesWin.isDestroyed()) notesWin.hide();
  });

  ipcMain.on('notes-window-minimize', (event) => {
    if (!isLocalSender(event)) return;
    if (notesAppWin && !notesAppWin.isDestroyed() && event.sender === notesAppWin.webContents) {
      notesAppWin.minimize();
    }
  });

  // Task-specific notes
  ipcMain.handle('task-note-get', (event, taskId) => {
    if (!isLocalSender(event)) return '';
    if (typeof taskId !== 'string' || !/^[a-z0-9]{4,20}$/.test(taskId)) return '';
    try {
      const noteFile = path.join(CLAUDE_DIR, 'task-notes', taskId + '.txt');
      if (fs.existsSync(noteFile)) return fs.readFileSync(noteFile, 'utf-8');
    } catch { /* ignore */ }
    return '';
  });

  ipcMain.on('task-note-save', (event, taskId, text) => {
    if (!isLocalSender(event)) return;
    if (typeof taskId !== 'string' || !/^[a-z0-9]{4,20}$/.test(taskId)) return;
    try {
      const dir = path.join(CLAUDE_DIR, 'task-notes');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, taskId + '.txt'), typeof text === 'string' ? text : '');
    } catch { /* ignore */ }
  });

  ipcMain.on('open-task-note', (event, taskId, taskText) => {
    if (!isLocalSender(event)) return;
    openNotesWindow(taskId, taskText);
  });

  // --- Calendar IPC ---
  ipcMain.handle('calendar-get-events', (event) => {
    if (!isLocalSender(event)) return [];
    return calendarEvents;
  });

  ipcMain.handle('calendar-add-event', (event, data) => {
    if (!isLocalSender(event)) return { success: false };
    if (!data || typeof data.title !== 'string' || !data.date) return { success: false };
    const evt = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: data.title.trim().slice(0, 100),
      date: data.date,
      time: data.time || null,
      duration: typeof data.duration === 'number' && data.duration > 0 ? data.duration : null,
      color: ['blue', 'green', 'orange', 'red', 'purple'].indexOf(data.color) >= 0 ? data.color : 'blue',
      reminder: typeof data.reminder === 'number' ? data.reminder : null,
      recurrence: data.recurrence || null,
      done: false,
      googleEventId: null,
      createdAt: Date.now(),
    };
    // Generate recurring instances
    if (evt.recurrence) {
      generateRecurringEvents(evt);
    }
    calendarEvents.push(evt);
    saveCalendarEvents();
    broadcastCalendar();
    scheduleReminders();
    return { success: true, event: evt };
  });

  ipcMain.handle('calendar-update-event', (event, data) => {
    if (!isLocalSender(event)) return { success: false };
    if (!data || !data.id) return { success: false };
    const idx = calendarEvents.findIndex((e) => e.id === data.id);
    if (idx < 0) return { success: false };
    const evt = calendarEvents[idx];
    if (data.title !== undefined) evt.title = String(data.title).trim().slice(0, 100);
    if (data.date !== undefined) evt.date = data.date;
    if (data.time !== undefined) evt.time = data.time || null;
    if (data.color !== undefined && ['blue', 'green', 'orange', 'red', 'purple'].indexOf(data.color) >= 0) evt.color = data.color;
    if (data.reminder !== undefined) evt.reminder = typeof data.reminder === 'number' ? data.reminder : null;
    firedReminders.delete(evt.id); // allow re-fire if time changed
    saveCalendarEvents();
    broadcastCalendar();
    scheduleReminders();
    return { success: true };
  });

  ipcMain.handle('calendar-toggle-event', (event, data) => {
    if (!isLocalSender(event)) return { success: false };
    if (!data || !data.id) return { success: false };
    const evt = calendarEvents.find((e) => e.id === data.id);
    if (!evt) return { success: false };
    evt.done = !evt.done;
    saveCalendarEvents();
    broadcastCalendar();
    return { success: true };
  });

  ipcMain.handle('calendar-delete-event', (event, data) => {
    if (!isLocalSender(event)) return { success: false };
    if (!data || !data.id) return { success: false };
    calendarEvents = calendarEvents.filter((e) => e.id !== data.id);
    firedReminders.delete(data.id);
    // Reminder timers use compound key "id:stage" — clear all matching
    for (const key of Object.keys(reminderTimers)) {
      if (key === data.id || key.startsWith(data.id + ':')) {
        clearTimeout(reminderTimers[key]);
        delete reminderTimers[key];
      }
    }
    delete firedStages[data.id];
    saveCalendarEvents();
    broadcastCalendar();
    scheduleReminders();
    return { success: true };
  });

  // --- Google Calendar IPC ---

  ipcMain.handle('gcal-get-accounts', () => {
    return gcalAccounts.map((a) => ({ email: a.email }));
  });

  ipcMain.handle('gcal-add-account', async (event) => {
    if (!isLocalSender(event)) return { success: false, error: 'Unauthorized' };
    try {
      const account = await startGoogleAuth();
      startGcalSyncTimer();
      syncGoogleCalendars();
      return { success: true, email: account.email };
    } catch (err) {
      return { success: false, error: err.message || 'Auth failed' };
    }
  });

  ipcMain.handle('gcal-remove-account', async (event, email) => {
    if (!isLocalSender(event)) return { success: false };
    gcalAccounts = gcalAccounts.filter((a) => a.email !== email);
    saveGcalConfig();
    // Remove Google events from this account
    calendarEvents = calendarEvents.filter((e) => e.googleAccount !== email);
    saveCalendarEvents();
    broadcastCalendar();
    scheduleReminders();
    startGcalSyncTimer();
    return { success: true };
  });

  ipcMain.handle('gcal-sync-now', async (event) => {
    if (!isLocalSender(event)) return { success: false };
    try {
      await syncGoogleCalendars();
      return { success: true, lastSync: gcalLastSync };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('gcal-get-status', () => {
    return {
      accounts: gcalAccounts.map((a) => ({ email: a.email })),
      lastSync: gcalLastSync,
    };
  });

  ipcMain.handle('check-for-updates', async () => {
    const result = await checkForUpdates();
    if (result.hasUpdate) {
      lastUpdateResult = result;
    }
    return result;
  });

  ipcMain.handle('download-and-install-update', async (event) => {
    if (!isLocalSender(event)) return { success: false, error: 'Unauthorized' };
    // Use the URL from the main-process update check — never trust renderer input
    const downloadUrl = lastUpdateResult?.downloadUrl;
    if (!downloadUrl) {
      return { success: false, error: 'No update URL available' };
    }
    // Validate URL — only allow GitHub releases
    try {
      const parsed = new URL(downloadUrl);
      const allowedHosts = ['github.com', 'objects.githubusercontent.com',
        'github-releases.githubusercontent.com', 'release-assets.githubusercontent.com',
        'github-production-release-asset-2e65be.s3.amazonaws.com'];
      if (!allowedHosts.some((h) => parsed.hostname === h || parsed.hostname.endsWith('.' + h))) {
        return { success: false, error: 'Untrusted download host' };
      }
      if (parsed.protocol !== 'https:') {
        return { success: false, error: 'HTTPS required' };
      }
    } catch {
      return { success: false, error: 'Invalid download URL' };
    }

    try {
      const installerPath = await downloadAndInstallUpdate(downloadUrl);
      // Launch installer detached, then quit
      try {
        if (process.platform === 'darwin' && /\.dmg$/i.test(installerPath)) {
          // macOS: open the .dmg via Finder
          spawn('open', [installerPath], {
            detached: true,
            stdio: 'ignore',
          }).unref();
        } else if (process.platform === 'linux' && /\.AppImage$/i.test(installerPath)) {
          // Linux AppImage: replace the running AppImage, then relaunch
          fs.chmodSync(installerPath, 0o755);
          const currentAppImage = process.env.APPIMAGE;
          if (currentAppImage) {
            // Can't overwrite a running binary — rename old, move new in
            const backupPath = currentAppImage + '.old';
            try { fs.unlinkSync(backupPath); } catch { /* ignore */ }
            fs.renameSync(currentAppImage, backupPath);
            try {
              // rename is atomic but fails across devices; fall back to copy
              fs.renameSync(installerPath, currentAppImage);
            } catch {
              fs.copyFileSync(installerPath, currentAppImage);
              fs.unlinkSync(installerPath);
            }
            fs.chmodSync(currentAppImage, 0o755);
            try { fs.unlinkSync(backupPath); } catch { /* ignore */ }
            spawn(currentAppImage, [], {
              detached: true,
              stdio: 'ignore',
            }).unref();
          } else {
            // Not running as AppImage (dev mode) — just launch from tmp
            spawn(installerPath, [], {
              detached: true,
              stdio: 'ignore',
            }).unref();
          }
        } else {
          // Windows .exe or Linux .deb (deb handled via dpkg/gdebi by user)
          if (process.platform === 'linux' && /\.deb$/i.test(installerPath)) {
            // For .deb, open with default handler (e.g. software center)
            spawn('xdg-open', [installerPath], {
              detached: true,
              stdio: 'ignore',
            }).unref();
          } else {
            spawn(installerPath, [], {
              detached: true,
              stdio: 'ignore',
            }).unref();
          }
        }
      } catch (spawnErr) {
        fs.unlink(installerPath, () => {});
        return { success: false, error: 'Failed to launch installer: ' + spawnErr.message };
      }
      setTimeout(() => {
        if (win && !win.isDestroyed()) win.destroy();
        app.quit();
      }, 500);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Send cached data on load, then sync — but only if authenticated
  win.webContents.on('did-finish-load', () => {
    widgetReady = true;
    // Always send cached data immediately so bars are never empty
    win.webContents.send('usage-update', buildUsagePayload());
    // (removed) history-update was sent to the widget renderer, but neither preload.js nor renderer.js listens for it - only the dashboard does. Serialising ~2581 points cost ~1.4ms per send for nothing.
    // Send badge counts
    const pendingCount = tasks.filter((t) => !t.done).length;
    const today = new Date().toISOString().slice(0, 10);
    const todayCount = calendarEvents.filter((e) => e.date === today).length;
    win.webContents.send('badge-update', { tasks: pendingCount, calendar: todayCount });
    // Send streak
    if (streakData.current > 0) win.webContents.send('streak-update', streakData);
    // Send pomo state
    win.webContents.send('pomo-update', { state: pomoState, seconds: pomoSeconds, total: pomoTotal });
    // Try syncing fresh data — if the active token is null (mid-refresh), retry in 5s
    const activeCtx = getActiveCtx();
    const token = activeCtx ? getAccessToken(activeCtx) : null;
    if (token && !anySyncing()) {
      syncAllAccounts(false);
    } else if (!token) {
      setTimeout(() => {
        const ctx = getActiveCtx();
        const retryToken = ctx ? getAccessToken(ctx) : null;
        if (retryToken && !anySyncing()) syncAllAccounts(false);
      }, 5000);
    }
    // Re-send cached update result so renderer never misses it
    if (lastUpdateResult && lastUpdateResult.hasUpdate) {
      win.webContents.send('update-available', lastUpdateResult);
    }
    if (claudeStatus) win.webContents.send('claude-status-update', claudeStatus);
    tryShowDigestOnOpen();
    // Apply saved theme
    if (currentTheme !== 'dark') {
      const theme = THEMES[currentTheme] || THEMES.dark;
      win.webContents.send('theme-update', { name: currentTheme, ...theme });
    }
  });

  // Auto-refresh usage every 3 minutes — fires even when widget is hidden
  // This keeps cached data fresh so the UI doesn't show stale data on next show
  const autoRefreshInterval = setInterval(() => {
    syncAllAccounts(false);
  }, 3 * 60 * 1000);
  cleanupTimers.push(autoRefreshInterval);

  // Aggressive token refresh: check every 5 min, refresh if within 1 hour of expiry
  const tokenRefreshInterval = setInterval(() => {
    for (const ctx of enabledAccounts()) {
      const oauth = readOauthCreds(ctx);
      if (oauth && oauth.expiresAt && oauth.expiresAt < Date.now() + REFRESH_WINDOW_MS && oauth.refreshToken) {
        refreshAccessToken(ctx, oauth.refreshToken);
      }
    }
  }, 5 * 60 * 1000);
  cleanupTimers.push(tokenRefreshInterval);

  startFileWatcher();

  // --- Power monitor: handle sleep/wake ---
  powerMonitor.on('suspend', () => {
    for (const ctx of Object.values(accountCtx)) {
      if (ctx.activeRequest) {
        try { ctx.activeRequest.destroy(); } catch { /* ignore */ }
        ctx.activeRequest = null;
      }
      ctx.syncing = false;
      ctx.syncStartedAt = 0;
    }
  });

  powerMonitor.on('resume', () => {
    for (const ctx of Object.values(accountCtx)) {
      ctx.syncing = false;
      ctx.syncStartedAt = 0;
      ctx.activeRequest = null;
      ctx.cachedToken = null;
      ctx.tokenLastRead = 0;
      ctx.isRefreshing = false;
      ctx.refreshRetryCount = 0;
      if (ctx.refreshRetryTimer) { clearTimeout(ctx.refreshRetryTimer); ctx.refreshRetryTimer = null; }
      clearRetryTimer(ctx);

      // Proactively refresh token on wake (it may have expired during sleep)
      const oauth = readOauthCreds(ctx);
      if (oauth && oauth.refreshToken) {
        refreshAccessToken(ctx, oauth.refreshToken);
      }
    }

    setTimeout(() => syncAllAccounts(true), 3000);
    setTimeout(() => scheduleReminders(), 5000);
  });

  // Check for updates on start, then every 24h
  const broadcastUpdate = (result) => {
    if (!result.hasUpdate) return;
    lastUpdateResult = result;
    if (win && !win.isDestroyed()) win.webContents.send('update-available', result);
    if (dashWin && !dashWin.isDestroyed()) dashWin.webContents.send('update-available', result);
  };

  setTimeout(async () => broadcastUpdate(await checkForUpdates()), 10000);
  setInterval(async () => broadcastUpdate(await checkForUpdates()), UPDATE_CHECK_INTERVAL);

});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (fileWatcher) { try { fileWatcher.close(); } catch {} }
  for (const w of linuxSubWatchers) { try { w.close(); } catch {} }
  linuxSubWatchers = [];
  for (const w of credsWatchers) { try { w.close(); } catch {} }
  credsWatchers = [];
  if (cliMarkerWatcher) { try { cliMarkerWatcher.close(); } catch {} cliMarkerWatcher = null; }
  if (cliMarkerDebounce) { clearTimeout(cliMarkerDebounce); cliMarkerDebounce = null; }
  if (fileChangeTimer) { clearTimeout(fileChangeTimer); fileChangeTimer = null; }
  for (const id of Object.keys(accountCtx)) destroyAccountCtx(id);
  if (boundsDebounce) { clearTimeout(boundsDebounce); boundsDebounce = null; }
  if (pomoInterval) { clearInterval(pomoInterval); pomoInterval = null; }
  if (pomoSaveDebounce) { clearTimeout(pomoSaveDebounce); pomoSaveDebounce = null; }
  savePomoState();
  if (gcalSyncTimer) { clearInterval(gcalSyncTimer); gcalSyncTimer = null; }
  // Clear reminder timers
  for (const key of Object.keys(reminderTimers)) {
    try { clearTimeout(reminderTimers[key]); } catch {}
  }
  reminderTimers = {};
  // Clean up all registered intervals/timers
  for (const t of cleanupTimers) {
    try { clearInterval(t); clearTimeout(t); } catch {}
  }
  cleanupTimers.length = 0;
});

app.on('window-all-closed', () => {
  // Stay in tray
});
