'use strict';
// The Maps feature's pure logic: no Electron, so it can be tested on its own.

const path = require('path');

const MAPS_PORT = 3418;
const MAPS_ORIGIN = `http://127.0.0.1:${MAPS_PORT}`;
const MAX_MAPS = 100;
const MAX_PREVIEW = 12;
const MAX_LINKS = 24;
const MAX_TITLE = 200;
const MAX_ID = 64;

// Set by the AppImage runtime. Harmless to this app, but they point at its own libraries and mount,
// which breaks the `claude` command the map server runs.
const APPIMAGE_VARS = ['LD_LIBRARY_PATH', 'LD_PRELOAD', 'APPDIR', 'APPIMAGE', 'ARGV0', 'OWD', 'GSETTINGS_SCHEMA_DIR'];

const withoutMounts = (value) => (value || '').split(':').filter((p) => p && !p.includes('/.mount_'));

function childEnv(env, home) {
  const clean = { ...env };
  for (const key of APPIMAGE_VARS) delete clean[key];
  const dirs = withoutMounts(env.PATH);
  // An autostarted app gets a minimal PATH, and this is where Claude Code installs itself.
  const localBin = path.join(home, '.local', 'bin');
  if (!dirs.includes(localBin)) dirs.push(localBin);
  clean.PATH = dirs.join(':');
  if (env.XDG_DATA_DIRS !== undefined) clean.XDG_DATA_DIRS = withoutMounts(env.XDG_DATA_DIRS).join(':');
  clean.ELECTRON_RUN_AS_NODE = '1';
  clean.PORT = String(MAPS_PORT);
  return clean;
}

// electron-builder unpacks the server beside the asar, because Node's ES module loader can't read
// from inside one. Null means this build skipped the bundle step, so the Maps button stays hidden.
function serverEntry(dirname, exists) {
  const base = dirname.replace(/app\.asar(?=$|[/\\])/, 'app.asar.unpacked');
  const entry = path.join(base, 'maps', 'build', 'server', 'index.mjs');
  return exists(entry) ? entry : null;
}

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

function cleanPreview(bubble) {
  if (!bubble || typeof bubble !== 'object') return null;
  const { x, y, w, h, color } = bubble;
  if (![x, y, w, h].every(finite)) return null;
  if (typeof color !== 'string' || !/^#[0-9a-f]{3,8}$/i.test(color)) return null;
  return { x, y, w, h, color };
}

// The list comes from a web page, so nothing in it is trusted.
function cleanMapsReport(list) {
  if (!Array.isArray(list)) return null;
  const maps = [];
  for (const entry of list) {
    if (maps.length >= MAX_MAPS) break;
    if (!entry || typeof entry.id !== 'string' || !entry.id || entry.id.length > MAX_ID) continue;
    const title = typeof entry.title === 'string' && entry.title.trim()
      ? entry.title.slice(0, MAX_TITLE)
      : 'Untitled map';
    const preview = Array.isArray(entry.preview)
      ? entry.preview.map(cleanPreview).filter(Boolean).slice(0, MAX_PREVIEW)
      : [];
    const links = Array.isArray(entry.links)
      ? entry.links
        .filter((link) => Array.isArray(link) && link.length === 2 && link.every((end) => Number.isInteger(end) && end >= 0 && end < preview.length))
        .slice(0, MAX_LINKS)
      : [];
    maps.push({ id: entry.id, title, updatedAt: finite(entry.updatedAt) ? entry.updatedAt : 0, preview, links });
  }
  return maps;
}

function cleanOpenRequest(request) {
  if (!request || typeof request !== 'object') return null;
  if (request.new === true) return { new: true };
  if (typeof request.id === 'string' && request.id && request.id.length <= MAX_ID) return { id: request.id };
  return null;
}

function isMapsUrl(url) {
  try {
    return new URL(url).origin === MAPS_ORIGIN;
  } catch {
    return false;
  }
}

module.exports = { MAPS_ORIGIN, MAPS_PORT, childEnv, cleanMapsReport, cleanOpenRequest, isMapsUrl, serverEntry };
