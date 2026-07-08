const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('meetingPopupAPI', {
  onData: (cb) => ipcRenderer.on('meeting-popup-data', (_e, data) => cb(data)),
  dismiss: () => ipcRenderer.send('meeting-popup-dismiss'),
  onThemeUpdate: (cb) => ipcRenderer.on('theme-update', (_e, data) => cb(data)),
});
