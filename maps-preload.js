// The only thing the Maps page can reach in this app: its list of maps, and requests to open one.
const { contextBridge, ipcRenderer } = require('electron');

let listener = null;
const waiting = [];

// A request can arrive before the page has finished starting, so it waits here.
ipcRenderer.on('maps-open-request', (_event, request) => {
  if (listener) listener(request);
  else waiting.push(request);
});

contextBridge.exposeInMainWorld('meterMaps', {
  reportMaps: (maps) => ipcRenderer.send('maps-report', maps),
  onOpen: (callback) => {
    listener = callback;
    waiting.splice(0).forEach((request) => callback(request));
  },
});
