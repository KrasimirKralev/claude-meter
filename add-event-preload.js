const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eventAPI', {
  parseText: (text) => ipcRenderer.invoke('smart-parse', text),
  createEvent: (data) => ipcRenderer.invoke('calendar-add-event', data),
  close: () => ipcRenderer.send('close-add-event'),
  onThemeUpdate: (cb) => ipcRenderer.on('theme-update', (_e, data) => cb(data)),
  onSetDate: (cb) => ipcRenderer.on('set-date', (_e, date) => cb(date)),
});
