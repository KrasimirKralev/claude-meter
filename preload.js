const { contextBridge, ipcRenderer } = require('electron');

let usageHandler = null;
let syncStartHandler = null;
let syncErrorHandler = null;
let updateHandler = null;
let progressHandler = null;
let authStatusHandler = null;
let claudeStatusHandler = null;
let calendarUpdateHandler = null;

contextBridge.exposeInMainWorld('electronAPI', {
  requestSync: () => ipcRenderer.send('request-sync'),
  minimize: () => ipcRenderer.send('minimize-to-tray'),
  quit: () => ipcRenderer.send('quit-app'),
  onUsageUpdate: (cb) => {
    if (usageHandler) ipcRenderer.removeListener('usage-update', usageHandler);
    usageHandler = (_e, data) => cb(data);
    ipcRenderer.on('usage-update', usageHandler);
  },
  onSyncStart: (cb) => {
    if (syncStartHandler) ipcRenderer.removeListener('sync-start', syncStartHandler);
    syncStartHandler = () => cb();
    ipcRenderer.on('sync-start', syncStartHandler);
  },
  onSyncError: (cb) => {
    if (syncErrorHandler) ipcRenderer.removeListener('sync-error', syncErrorHandler);
    syncErrorHandler = (_e, msg) => cb(msg);
    ipcRenderer.on('sync-error', syncErrorHandler);
  },
  onUpdateAvailable: (cb) => {
    if (updateHandler) ipcRenderer.removeListener('update-available', updateHandler);
    updateHandler = (_e, data) => cb(data);
    ipcRenderer.on('update-available', updateHandler);
  },
  onUpdateProgress: (cb) => {
    if (progressHandler) ipcRenderer.removeListener('update-progress', progressHandler);
    progressHandler = (_e, pct) => cb(pct);
    ipcRenderer.on('update-progress', progressHandler);
  },
  installUpdate: () => ipcRenderer.invoke('download-and-install-update'),
  toggleCompact: (isCompact) => ipcRenderer.send('toggle-compact', isCompact),
  moveBy: (dx, dy) => ipcRenderer.send('widget-move-by', dx, dy),
  openDashboard: (tab) => ipcRenderer.send('open-dashboard', tab),
  openTasks: () => ipcRenderer.send('open-tasks-window'),
  openCalendar: () => ipcRenderer.send('open-calendar-window'),
  openNotes: () => ipcRenderer.send('open-notes-window'),
  checkAuthStatus: () => ipcRenderer.invoke('check-auth-status'),
  launchAuthLogin: () => ipcRenderer.invoke('launch-auth-login'),
  openExternalUrl: (url) => ipcRenderer.send('open-external-url', url),
  onAuthStatusChanged: (cb) => {
    if (authStatusHandler) ipcRenderer.removeListener('auth-status-changed', authStatusHandler);
    authStatusHandler = (_e, data) => cb(data);
    ipcRenderer.on('auth-status-changed', authStatusHandler);
  },
  onSnapGlow: (cb) => ipcRenderer.on('snap-glow', () => cb()),
  onEventReminder: (cb) => ipcRenderer.on('event-reminder', (_e, data) => cb(data)),
  onEventOverdue: (cb) => ipcRenderer.on('event-overdue', (_e, data) => cb(data)),
  onToggleAnimate: (cb) => ipcRenderer.on('toggle-animate', (_e, dir) => cb(dir)),
  pomoStart: () => ipcRenderer.send('pomo-start'),
  pomoReset: () => ipcRenderer.send('pomo-reset'),
  pomoGet: () => ipcRenderer.invoke('pomo-get'),
  onPomoUpdate: (cb) => ipcRenderer.on('pomo-update', (_e, data) => cb(data)),
  onPomoComplete: (cb) => ipcRenderer.on('pomo-complete', (_e, type) => cb(type)),
  onBadgeUpdate: (cb) => ipcRenderer.on('badge-update', (_e, data) => cb(data)),
  onStreakUpdate: (cb) => ipcRenderer.on('streak-update', (_e, data) => cb(data)),
  onThemeUpdate: (cb) => ipcRenderer.on('theme-update', (_e, data) => cb(data)),
  getCalendarEvents: () => ipcRenderer.invoke('calendar-get-events'),
  onCalendarUpdate: (cb) => {
    if (calendarUpdateHandler) ipcRenderer.removeListener('calendar-update', calendarUpdateHandler);
    calendarUpdateHandler = (_e, data) => cb(data);
    ipcRenderer.on('calendar-update', calendarUpdateHandler);
  },
  getHabits: () => ipcRenderer.invoke('habits-get'),
  toggleHabitDay: (kind, dateStr) => ipcRenderer.invoke('habits-toggle-day', kind, dateStr),
  onHabitsUpdate: (cb) => ipcRenderer.on('habits-update', (_e, data) => cb(data)),
  getClaudeStatus: () => ipcRenderer.invoke('get-claude-status'),
  onClaudeStatusUpdate: (cb) => {
    if (claudeStatusHandler) ipcRenderer.removeListener('claude-status-update', claudeStatusHandler);
    claudeStatusHandler = (_e, data) => cb(data);
    ipcRenderer.on('claude-status-update', claudeStatusHandler);
  },
});
