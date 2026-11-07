// The only thing the Maps page can reach in this app: its list of maps, requests to open one, and
// which theme the app is in.
const { contextBridge, ipcRenderer } = require('electron');

let openListener = null;
const waiting = [];
let themeListener = null;
let lastTheme = null;

// A request can arrive before the page has finished starting, so it waits here.
ipcRenderer.on('maps-open-request', (_event, request) => {
  if (openListener) openListener(request);
  else waiting.push(request);
});

ipcRenderer.on('maps-theme', (_event, theme) => {
  lastTheme = theme;
  if (themeListener) themeListener(theme);
});

contextBridge.exposeInMainWorld('meterMaps', {
  reportMaps: (maps) => ipcRenderer.send('maps-report', maps),
  onOpen: (callback) => {
    openListener = callback;
    waiting.splice(0).forEach((request) => callback(request));
  },
  onTheme: (callback) => {
    themeListener = callback;
    if (lastTheme) callback(lastTheme);
  },
});
