// Relax music from his own folder (~/Music/relax): whether a break plays one of
// his tracks or the generated lo-fi, and which track. Shuffled, nothing plays
// again until every track has played, remembered across restarts in a small
// JSON file. Plain Node, tested in test/relax-music.test.js. The page decodes
// and loudness-matches the track (relax-biomes/_kit.js, playFolder).

const fs = require('fs');
const path = require('path');

const AUDIO_RE = /\.(mp3|ogg|oga|opus|flac|wav|m4a)$/i;
const SOURCES = ['auto', 'generated', 'folder'];
// A track is read whole and decoded in memory: anything bigger is skipped.
const MAX_BYTES = 150 * 1024 * 1024;

// The audio files directly in `dir` (not hidden, not in sub-folders), sorted.
function listTracks(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => (e.isFile() || e.isSymbolicLink()) && !e.name.startsWith('.') && AUDIO_RE.test(e.name))
    .map((e) => e.name)
    .sort();
}

// "generated" always plays the lo-fi; "auto" and "folder" play his tracks
// whenever the folder has any (an empty folder falls back to the lo-fi).
function chooseSource(setting, tracks) {
  const s = SOURCES.includes(setting) ? setting : 'auto';
  if (s === 'generated') return 'generated';
  return tracks.length > 0 ? 'folder' : 'generated';
}

function shuffle(list, rnd) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rnd() * (i + 1)));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// The next track and the new state. state: { bag: names still to play this
// round, played: names played this round, last }. A new round is a fresh
// shuffle that never starts with the track that just played; files added
// mid-round join the bag at a random place, removed ones drop out.
function nextTrack(tracks, state, rnd) {
  const r = typeof rnd === 'function' ? rnd : Math.random;
  const st = state && typeof state === 'object' ? state : {};
  const last = typeof st.last === 'string' ? st.last : null;
  if (!tracks.length) return { track: null, state: { bag: [], played: [], last } };
  let played = (Array.isArray(st.played) ? st.played : []).filter((t) => tracks.includes(t));
  let bag = (Array.isArray(st.bag) ? st.bag : []).filter((t) => tracks.includes(t) && !played.includes(t));
  bag = Array.from(new Set(bag));
  for (const t of tracks) {
    if (!bag.includes(t) && !played.includes(t)) bag.splice(Math.floor(r() * (bag.length + 1)), 0, t);
  }
  if (!bag.length) {
    played = [];
    bag = shuffle(tracks, r);
    if (bag.length > 1 && bag[0] === last) {
      const k = 1 + Math.min(bag.length - 2, Math.floor(r() * (bag.length - 1)));
      [bag[0], bag[k]] = [bag[k], bag[0]];
    }
  }
  const track = bag.shift();
  played.push(track);
  return { track, state: { bag, played, last: track } };
}

function loadState(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

// Written to a temp file and renamed, so a crash never leaves half a file.
function saveState(file, state) {
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

// The track for a break that wants one: -> { name, file } or null when the
// folder has none. A state that cannot be saved is logged; the track still plays.
function pickTrack(dir, stateFile, opts) {
  const log = opts && typeof opts.log === 'function' ? opts.log : () => {};
  const tracks = listTracks(dir);
  const { track, state } = nextTrack(tracks, loadState(stateFile), opts && opts.rnd);
  if (!track) return null;
  try {
    saveState(stateFile, state);
  } catch (err) {
    log('could not remember the music shuffle in ' + stateFile + ': ' + err.message);
  }
  return { name: track, file: path.join(dir, track), left: state.bag.length };
}

// The bytes of a picked track, refusing anything too big to decode in memory.
async function readTrack(pick) {
  const st = await fs.promises.stat(pick.file);
  if (st.size > MAX_BYTES) throw new Error(pick.name + ' is ' + Math.round(st.size / 1048576) + ' MB; tracks over '
    + Math.round(MAX_BYTES / 1048576) + ' MB are skipped');
  return fs.promises.readFile(pick.file);
}

module.exports = { AUDIO_RE, SOURCES, MAX_BYTES, listTracks, chooseSource, nextTrack, loadState, saveState, pickTrack, readTrack };
