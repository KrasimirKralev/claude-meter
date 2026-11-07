const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('captureAPI', {
  submit: (text) => ipcRenderer.send('quick-task-submit', text),
  close: () => ipcRenderer.send('quick-task-close'),
  onThemeUpdate: (cb) => ipcRenderer.on('theme-update', (_e, data) => cb(data)),
});
