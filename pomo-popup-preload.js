const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pomoPopupAPI', {
  onPomoPopupData: (cb) => ipcRenderer.on('pomo-popup-data', (_e, data) => cb(data)),
  dismiss: () => ipcRenderer.send('pomo-popup-dismiss'),
  startNext: () => ipcRenderer.send('pomo-popup-start-next'),
  onThemeUpdate: (cb) => ipcRenderer.on('theme-update', (_e, data) => cb(data)),
  onBreakTick: (cb) => ipcRenderer.on('pomo-popup-break-tick', (_e, data) => cb(data)),
  onBreakDone: (cb) => ipcRenderer.on('pomo-popup-break-done', (_e) => cb()),
});
