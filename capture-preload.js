const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('captureAPI', {
  submit: (text) => ipcRenderer.send('quick-capture-submit', text),
  close: () => ipcRenderer.send('quick-capture-close'),
});
