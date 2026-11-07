const { contextBridge, ipcRenderer } = require('electron');

// Shared by the break window (relax.html) and the heads-up toast (relax-toast.html).
contextBridge.exposeInMainWorld('relaxAPI', {
  onStart: (cb) => ipcRenderer.on('relax-start', (_e, data) => cb(data)),
  onFadeOut: (cb) => ipcRenderer.on('relax-fade-out', (_e, data) => cb(data)),
  end: () => ipcRenderer.send('relax-end'),
  // His next track from ~/Music/relax: { name, data } or { error }.
  track: () => ipcRenderer.invoke('relax-track'),
  log: (msg) => ipcRenderer.send('relax-log', String(msg)),
  onToast: (cb) => ipcRenderer.on('relax-toast-data', (_e, data) => cb(data)),
  skip: () => ipcRenderer.send('relax-toast-skip'),
  later: () => ipcRenderer.send('relax-toast-later'),
  startNow: () => ipcRenderer.send('relax-toast-start'),
  onThemeUpdate: (cb) => ipcRenderer.on('theme-update', (_e, data) => cb(data)),
});
