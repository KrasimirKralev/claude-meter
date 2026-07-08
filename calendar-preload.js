const { contextBridge, ipcRenderer } = require('electron');

let calendarUpdateHandler = null;

contextBridge.exposeInMainWorld('calendarAPI', {
  getEvents: () => ipcRenderer.invoke('calendar-get-events'),
  addEvent: (data) => ipcRenderer.invoke('calendar-add-event', data),
  updateEvent: (data) => ipcRenderer.invoke('calendar-update-event', data),
  toggleEvent: (id) => ipcRenderer.invoke('calendar-toggle-event', { id }),
  deleteEvent: (id) => ipcRenderer.invoke('calendar-delete-event', { id }),
  moveEvent: (id, newDate) => ipcRenderer.invoke('calendar-move-event', id, newDate),
  onCalendarUpdate: (cb) => {
    if (calendarUpdateHandler) ipcRenderer.removeListener('calendar-update', calendarUpdateHandler);
    calendarUpdateHandler = (_e, data) => cb(data);
    ipcRenderer.on('calendar-update', calendarUpdateHandler);
  },
  openExternal: (url) => ipcRenderer.send('open-external-url', url),
  openDashboard: () => ipcRenderer.send('open-dashboard'),
  openAddEvent: (date) => ipcRenderer.send('open-add-event', date),
  onSnapGlow: (cb) => ipcRenderer.on('snap-glow', () => cb()),
  onThemeUpdate: (cb) => ipcRenderer.on('theme-update', (_e, data) => cb(data)),
});
