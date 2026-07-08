const { contextBridge, ipcRenderer } = require('electron');

let usageHandler = null;
let historyHandler = null;
let updateHandler = null;
let progressHandler = null;
let syncStartHandler = null;
let syncErrorHandler = null;
let tasksUpdateHandler = null;
let claudeStatusHandler = null;
let authStatusHandler = null;
let calendarUpdateHandler = null;
let habitsUpdateHandler = null;
let navigateTabHandler = null;

contextBridge.exposeInMainWorld('dashboardAPI', {
  minimize: () => ipcRenderer.send('dash-minimize'),
  maximize: () => ipcRenderer.send('dash-maximize'),
  close: () => ipcRenderer.send('dash-close'),
  requestData: () => ipcRenderer.send('dashboard-request-data'),
  saveSettings: (settings) => ipcRenderer.send('dashboard-save-settings', settings),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('download-and-install-update'),
  changeHotkey: (hotkey) => ipcRenderer.invoke('change-hotkey', hotkey),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  signOut: () => ipcRenderer.invoke('sign-out'),
  checkAuthStatus: () => ipcRenderer.invoke('check-auth-status'),
  launchAuthLogin: () => ipcRenderer.invoke('launch-auth-login'),
  onAuthStatusChanged: (cb) => {
    if (authStatusHandler) ipcRenderer.removeListener('auth-status-changed', authStatusHandler);
    authStatusHandler = (_e, data) => cb(data);
    ipcRenderer.on('auth-status-changed', authStatusHandler);
  },
  getAutostart: () => ipcRenderer.invoke('get-autostart'),
  setAutostart: (enabled) => ipcRenderer.invoke('set-autostart', enabled),
  getTasks: () => ipcRenderer.invoke('tasks-get'),
  addTask: (text) => ipcRenderer.send('tasks-add', text),
  toggleTask: (id) => ipcRenderer.send('tasks-toggle', id),
  deleteTask: (id) => ipcRenderer.send('tasks-delete', id),
  clearCompleted: () => ipcRenderer.send('tasks-clear-completed'),
  onTasksUpdate: (cb) => {
    if (tasksUpdateHandler) ipcRenderer.removeListener('tasks-update', tasksUpdateHandler);
    tasksUpdateHandler = (_e, data) => cb(data);
    ipcRenderer.on('tasks-update', tasksUpdateHandler);
  },
  onUsageUpdate: (cb) => {
    if (usageHandler) ipcRenderer.removeListener('usage-update', usageHandler);
    usageHandler = (_e, data) => cb(data);
    ipcRenderer.on('usage-update', usageHandler);
  },
  onHistoryUpdate: (cb) => {
    if (historyHandler) ipcRenderer.removeListener('history-update', historyHandler);
    historyHandler = (_e, data) => cb(data);
    ipcRenderer.on('history-update', historyHandler);
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
  onSyncStart: (cb) => {
    if (syncStartHandler) ipcRenderer.removeListener('sync-start', syncStartHandler);
    syncStartHandler = (_e) => cb();
    ipcRenderer.on('sync-start', syncStartHandler);
  },
  onSyncError: (cb) => {
    if (syncErrorHandler) ipcRenderer.removeListener('sync-error', syncErrorHandler);
    syncErrorHandler = (_e, msg) => cb(msg);
    ipcRenderer.on('sync-error', syncErrorHandler);
  },
  getTheme: () => ipcRenderer.invoke('get-theme'),
  setTheme: (name) => ipcRenderer.invoke('set-theme', name),
  onThemeUpdate: (cb) => ipcRenderer.on('theme-update', (_e, data) => cb(data)),
  getCalendarEvents: () => ipcRenderer.invoke('calendar-get-events'),
  addCalendarEvent: (data) => ipcRenderer.invoke('calendar-add-event', data),
  updateCalendarEvent: (data) => ipcRenderer.invoke('calendar-update-event', data),
  toggleCalendarEvent: (id) => ipcRenderer.invoke('calendar-toggle-event', { id }),
  deleteCalendarEvent: (id) => ipcRenderer.invoke('calendar-delete-event', { id }),
  onCalendarUpdate: (cb) => {
    if (calendarUpdateHandler) ipcRenderer.removeListener('calendar-update', calendarUpdateHandler);
    calendarUpdateHandler = (_e, data) => cb(data);
    ipcRenderer.on('calendar-update', calendarUpdateHandler);
  },
  gcalGetAccounts: () => ipcRenderer.invoke('gcal-get-accounts'),
  gcalAddAccount: () => ipcRenderer.invoke('gcal-add-account'),
  gcalRemoveAccount: (email) => ipcRenderer.invoke('gcal-remove-account', email),
  gcalSyncNow: () => ipcRenderer.invoke('gcal-sync-now'),
  gcalGetStatus: () => ipcRenderer.invoke('gcal-get-status'),
  onGcalSyncStatus: (cb) => ipcRenderer.on('gcal-sync-status', (_e, data) => cb(data)),
  getHabits: () => ipcRenderer.invoke('habits-get'),
  toggleHabitDay: (kind, dateStr) => ipcRenderer.invoke('habits-toggle-day', kind, dateStr),
  onHabitsUpdate: (cb) => {
    if (habitsUpdateHandler) ipcRenderer.removeListener('habits-update', habitsUpdateHandler);
    habitsUpdateHandler = (_e, data) => cb(data);
    ipcRenderer.on('habits-update', habitsUpdateHandler);
  },
  openExternal: (url) => ipcRenderer.send('open-external-url', url),
  getClaudeStatus: () => ipcRenderer.invoke('get-claude-status'),
  onClaudeStatusUpdate: (cb) => {
    if (claudeStatusHandler) ipcRenderer.removeListener('claude-status-update', claudeStatusHandler);
    claudeStatusHandler = (_e, data) => cb(data);
    ipcRenderer.on('claude-status-update', claudeStatusHandler);
  },
  onNavigateTab: (cb) => {
    if (navigateTabHandler) ipcRenderer.removeListener('navigate-tab', navigateTabHandler);
    navigateTabHandler = (_e, tab) => cb(tab);
    ipcRenderer.on('navigate-tab', navigateTabHandler);
  },
});
