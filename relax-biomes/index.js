// Relax biomes, the Node side: which places exist (one file each in this
// folder, see _kit.js) and which one the next break shows - picked at random,
// never one of the last few shown, remembered in a small JSON file so the
// rule survives restarts. Plain Node, tested in test/relax-biomes.test.js.

const fs = require('fs');

const RECENT = 5;
const ID_RE = /^[a-z0-9-]+$/;
const FALLBACK = 'dusk-lake';

// Every biome file in `dir`: "<id>.js", except the kit ("_...") and this file.
function listBiomes(dir) {
  let names;
  try {
    names = fs.readdirSync(dir || __dirname);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith('.js') && !n.startsWith('_') && n !== 'index.js')
    .map((n) => n.slice(0, -3))
    .filter((id) => ID_RE.test(id))
    .sort();
}

// The ids shown last, oldest first. A missing or broken file is an empty history.
function loadRecent(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (raw && Array.isArray(raw.recent)) return raw.recent.filter((id) => typeof id === 'string' && ID_RE.test(id));
  } catch {
    // start afresh
  }
  return [];
}

// Random among the biomes not shown in the last RECENT breaks. With only a
// handful of biomes, as many as possible are held back, but never all of them.
function pickBiome(ids, recent, rnd) {
  if (!ids.length) return null;
  const hold = Math.min(RECENT, ids.length - 1);
  const blocked = new Set(hold > 0 ? recent.slice(-hold) : []);
  const pool = ids.filter((id) => !blocked.has(id));
  const r = typeof rnd === 'function' ? rnd() : Math.random();
  return pool[Math.min(pool.length - 1, Math.floor(r * pool.length))];
}

// Written to a temp file and renamed, so a crash never leaves half a file.
function saveRecent(file, recent) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ recent }, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

// The biome for the break that is starting now. Always returns an id (the lake
// if the folder cannot be read); `log` hears about anything that went wrong.
function nextBiome(file, opts) {
  const o = opts || {};
  const log = typeof o.log === 'function' ? o.log : () => {};
  const ids = listBiomes(o.dir);
  if (!ids.length) {
    log('no biomes found; showing ' + FALLBACK);
    return FALLBACK;
  }
  const recent = loadRecent(file);
  const id = pickBiome(ids, recent, o.rnd);
  const next = recent.filter((r) => r !== id && ids.includes(r)).concat(id).slice(-RECENT);
  try {
    saveRecent(file, next);
  } catch (err) {
    log('could not remember the biome in ' + file + ': ' + err.message);
  }
  return id;
}

module.exports = { RECENT, FALLBACK, listBiomes, loadRecent, pickBiome, saveRecent, nextBiome };
