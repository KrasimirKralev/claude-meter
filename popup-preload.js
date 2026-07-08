const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('popupAPI', {
  onPopupData: (cb) => ipcRenderer.on('popup-data', (_event, data) => cb(data)),
  dismiss: () => ipcRenderer.send('popup-dismiss'),
  onThemeUpdate: (cb) => ipcRenderer.on('theme-update', (_e, data) => cb(data)),
});
