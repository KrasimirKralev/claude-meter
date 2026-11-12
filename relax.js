// Relax breaks: the day's schedule, the "is he free right now" checks and the
// saved state. Plain Node - main.js owns the windows, the timers and the IPC,
// so everything here can be tested without Electron (test/relax.test.js).

const fs = require('fs');
const { execFile, execFileSync } = require('child_process');

const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  times: Object.freeze(['11:00', '13:00', '15:00', '17:00']),
  minutes: 4,
  music: true,
  breathing: true,
  // Where the music comes from: "auto" plays his own tracks from ~/Music/relax
  // whenever there are any, else the generated lo-fi; "generated" and
  // "folder" force one (an empty folder still falls back). relax-music.js.
  musicSource: 'auto',
});
const MUSIC_SOURCES = ['auto', 'generated', 'folder'];

const HEADS_UP_MS = 30 * 1000;
const RETRY_MS = 10 * 60 * 1000;
const GIVE_UP_MS = 60 * 60 * 1000;
const IDLE_LIMIT_MS = 5 * 60 * 1000;
const EVENT_MARGIN_MS = 5 * 60 * 1000;
// A calendar event saved without a length still means "busy" for a while.
const UNTIMED_EVENT_MS = 30 * 60 * 1000;
// A break finished this recently makes the next slot unnecessary: never two back to back.
const RECENT_BREAK_MS = 60 * 60 * 1000;
const FADE_MS = 3000;
const MIN_MINUTES = 1;
const MAX_MINUTES = 30;

// A slot in one of these states is settled for the day.
const FINAL = new Set(['done', 'covered', 'skipped', 'missed', 'ended']);

const TIME_RE = /^(\d{1,2}):(\d{2})$/;

function pad2(n) { return String(n).padStart(2, '0'); }

function localDateStr(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

// "9:5" is rejected, "9:05" becomes "09:05".
function normalizeTime(t) {
  if (typeof t !== 'string') return null;
  const m = t.trim().match(TIME_RE);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return pad2(h) + ':' + pad2(min);
}

// Local wall-clock ms of HH:MM on YYYY-MM-DD.
function atTime(dateStr, hhmm) {
  return new Date(dateStr + 'T' + hhmm + ':00').getTime();
}

function normalizeConfig(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  let times = DEFAULT_CONFIG.times.slice();
  if (Array.isArray(src.times)) {
    // An empty list is a real choice ("only when I press Relax now"), not a typo.
    times = Array.from(new Set(src.times.map(normalizeTime).filter(Boolean))).sort();
  }
  const minutes = typeof src.minutes === 'number' && Number.isFinite(src.minutes)
    && src.minutes >= MIN_MINUTES && src.minutes <= MAX_MINUTES ? src.minutes : DEFAULT_CONFIG.minutes;
  return {
    enabled: src.enabled !== false,
    times,
    minutes,
    music: src.music !== false,
    breathing: src.breathing !== false,
    musicSource: MUSIC_SOURCES.includes(src.musicSource) ? src.musicSource : DEFAULT_CONFIG.musicSource,
  };
}

// -> { config, error }. A missing file is created with the defaults so there is
// something to edit; a broken one is left alone (he may be mid-edit) and the
// defaults are used until it parses again.
function loadConfig(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf-8');
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      const config = normalizeConfig(null);
      try {
        fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
      } catch (werr) {
        return { config, error: 'could not create ' + file + ': ' + werr.message };
      }
      return { config, error: null };
    }
    return { config: normalizeConfig(null), error: 'could not read ' + file + ': ' + (err && err.message) };
  }
  try {
    return { config: normalizeConfig(JSON.parse(text)), error: null };
  } catch (err) {
    return { config: normalizeConfig(null), error: file + ' is not valid JSON (' + err.message + '); using the defaults' };
  }
}

function freshDay(today, prev) {
  return {
    v: 1,
    date: today,
    done: 0,
    // Carried over: yesterday's evening break still covers nothing today, but
    // the banner value to restore must never be forgotten.
    lastDoneAt: prev && typeof prev.lastDoneAt === 'number' ? prev.lastDoneAt : 0,
    slots: {},
    bannersRestore: prev && typeof prev.bannersRestore === 'boolean' ? prev.bannersRestore : null,
  };
}

// Anything unreadable becomes a fresh day; a new date starts a new day.
function normalizeState(raw, today) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return freshDay(today, null);
  if (raw.date !== today) return freshDay(today, raw);
  const slots = {};
  if (raw.slots && typeof raw.slots === 'object') {
    for (const key of Object.keys(raw.slots)) {
      const e = raw.slots[key];
      if (normalizeTime(key) === key && e && typeof e === 'object') slots[key] = e;
    }
  }
  return {
    v: 1,
    date: today,
    done: Number.isInteger(raw.done) && raw.done >= 0 ? raw.done : 0,
    lastDoneAt: typeof raw.lastDoneAt === 'number' ? raw.lastDoneAt : 0,
    slots,
    bannersRestore: typeof raw.bannersRestore === 'boolean' ? raw.bannersRestore : null,
  };
}

function loadState(file, today) {
  try {
    return normalizeState(JSON.parse(fs.readFileSync(file, 'utf-8')), today);
  } catch {
    return freshDay(today, null);
  }
}

function saveState(file, state) {
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

// Walk today's slots: settle the ones whose chance has passed (missed) or that
// a recent break already served (covered), and find the first one to try now.
// Mutates state.slots; `changed` says whether it needs saving.
// -> { due, next: {time, at, retry} | null, changed }
function planSlots(config, state, now) {
  let changed = false;
  let due = null;
  let next = null;
  const total = config.times.length;
  for (const t of config.times) {
    const entry = state.slots[t] || {};
    if (FINAL.has(entry.status)) continue;
    const start = atTime(state.date, t);
    if (!Number.isFinite(start)) continue;
    const until = Math.max(start + GIVE_UP_MS, typeof entry.laterUntil === 'number' ? entry.laterUntil : 0);
    if (now >= until) {
      state.slots[t] = { status: 'missed', at: now, reason: entry.reason || null };
      changed = true;
      continue;
    }
    if (now < start - HEADS_UP_MS) {
      if (!next) next = { time: t, at: start, retry: false };
      continue;
    }
    if (state.done >= total || (state.lastDoneAt && state.lastDoneAt > start - RECENT_BREAK_MS)) {
      state.slots[t] = { status: 'covered', at: now };
      changed = true;
      continue;
    }
    const at = typeof entry.nextAt === 'number' && entry.nextAt > now ? entry.nextAt : now;
    if (!next) next = { time: t, at, retry: at > now };
    if (!due && at <= now) due = t;
  }
  return { due, next, changed };
}

// The event that makes now a bad moment: one running, or starting before the
// break (and a little margin) would be over. Done and all-day events never block.
function busyEvent(events, now, breakMs) {
  const margin = Math.max(EVENT_MARGIN_MS, (breakMs || 0) + HEADS_UP_MS + 60 * 1000);
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || e.done || typeof e.date !== 'string' || typeof e.time !== 'string') continue;
    const hhmm = normalizeTime(e.time);
    if (!hhmm) continue;
    const start = atTime(e.date, hhmm);
    if (!Number.isFinite(start)) continue;
    const len = typeof e.duration === 'number' && e.duration > 0 ? e.duration * 60 * 1000 : UNTIMED_EVENT_MS;
    if (start - now <= margin && start + len > now) return e;
  }
  return null;
}

// pw-dump JSON -> the capture streams that are actually recording. A level
// meter watching an output (stream.monitor / capture.sink) is not a call.
function micCaptures(dump) {
  const out = [];
  for (const o of Array.isArray(dump) ? dump : []) {
    if (!o || o.type !== 'PipeWire:Interface:Node') continue;
    const info = o.info || {};
    const props = info.props || {};
    if (props['media.class'] !== 'Stream/Input/Audio') continue;
    if (info.state !== 'running') continue;
    if (props['stream.monitor'] === true || props['stream.capture.sink'] === true) continue;
    out.push({
      id: o.id,
      app: props['application.name'] || props['application.process.binary'] || props['node.name'] || 'unknown',
    });
  }
  return out;
}

function run(cmd, args, timeoutMs, maxBuffer) {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout: timeoutMs || 3000, maxBuffer: maxBuffer || 1024 * 1024 }, (err, stdout) => {
        resolve(err ? { ok: false, error: err.message } : { ok: true, out: String(stdout) });
      });
    } catch (err) {
      resolve({ ok: false, error: err.message });
    }
  });
}

// Mutter's own idle clock. Electron's powerMonitor.getSystemIdleTime() reads the
// X screensaver extension, which under XWayland only sees input sent to X
// windows: on this desktop it said 0 s while Mutter said 95 s.
async function probeIdleMs() {
  const r = await run('gdbus', ['call', '--session', '--dest', 'org.gnome.Mutter.IdleMonitor',
    '--object-path', '/org/gnome/Mutter/IdleMonitor/Core',
    '--method', 'org.gnome.Mutter.IdleMonitor.GetIdletime']);
  const m = r.ok && r.out.match(/uint64\s+(\d+)/);
  return m ? Number(m[1]) : null;
}

async function probeLocked() {
  const r = await run('gdbus', ['call', '--session', '--dest', 'org.gnome.ScreenSaver',
    '--object-path', '/org/gnome/ScreenSaver', '--method', 'org.gnome.ScreenSaver.GetActive']);
  const m = r.ok && r.out.match(/\((true|false),?\)/);
  return m ? m[1] === 'true' : null;
}

// -> { captures: [...] } or { captures: null, error } when PipeWire cannot be asked.
async function probeMic() {
  const r = await run('pw-dump', [], 5000, 64 * 1024 * 1024);
  if (!r.ok) return { captures: null, error: r.error };
  try {
    return { captures: micCaptures(JSON.parse(r.out)) };
  } catch (err) {
    return { captures: null, error: 'pw-dump output unreadable: ' + err.message };
  }
}

// ddterm (the drop-down terminal extension) hides itself whenever it loses
// focus, and a break has to take the keyboard - otherwise typing would land in
// a window he cannot see. Its own D-Bus API tells whether it is open and
// brings it back. `null` = no ddterm here.
const DDTERM = ['--session', '--dest', 'org.gnome.Shell', '--object-path', '/org/gnome/Shell/Extensions/ddterm'];

async function ddtermOpen() {
  const r = await run('gdbus', ['call'].concat(DDTERM, ['--method', 'org.freedesktop.DBus.Properties.Get',
    'com.github.amezin.ddterm.Extension', 'HasWindow']));
  const m = r.ok && r.out.match(/<(true|false)>/);
  return m ? m[1] === 'true' : null;
}

async function ddtermActivate() {
  const r = await run('gdbus', ['call'].concat(DDTERM, ['--method', 'com.github.amezin.ddterm.Extension.Activate']));
  return r.ok;
}

// GNOME notification banners. `null` = could not be read (not GNOME, no gsettings).
const BANNERS = ['org.gnome.desktop.notifications', 'show-banners'];

async function getBanners() {
  const r = await run('gsettings', ['get'].concat(BANNERS));
  if (!r.ok) return null;
  const v = r.out.trim();
  return v === 'true' ? true : (v === 'false' ? false : null);
}

// Set, then read back: only a value GNOME reports afterwards counts as done.
async function setBanners(value) {
  const r = await run('gsettings', ['set'].concat(BANNERS, [value ? 'true' : 'false']));
  if (!r.ok) return false;
  return (await getBanners()) === value;
}

// For the quit path, where an async child would be killed with the app.
function setBannersSync(value) {
  try {
    execFileSync('gsettings', ['set'].concat(BANNERS, [value ? 'true' : 'false']), { timeout: 2000 });
    const v = String(execFileSync('gsettings', ['get'].concat(BANNERS), { timeout: 2000 })).trim();
    return v === (value ? 'true' : 'false');
  } catch {
    return false;
  }
}

// How many completed breaks tick the day's Relax habit: one per scheduled slot,
// or the default four when the schedule is only "Relax now" (times: []).
function dailyTarget(config) {
  return config.times.length > 0 ? config.times.length : DEFAULT_CONFIG.times.length;
}

// Whether the Relax habit should be ticked now: the day's count has reached its
// target and the day is not ticked yet. Never the other way round - a ticked
// day stays ticked (a lost state file must not wipe a real record).
function habitDue(config, state, tickedToday) {
  return !tickedToday && state.done >= dailyTarget(config);
}

// What the widget's Relax line shows.
function relaxView(config, state, now, extra) {
  const plan = planSlots(config, JSON.parse(JSON.stringify(state)), now);
  // Once the day's target is reached the planner covers every slot left, so
  // the next break is tomorrow's first ("done for today"), not a later slot.
  const finished = state.done >= dailyTarget(config);
  let next = null;
  if (config.enabled && plan.next && !finished) {
    next = { time: plan.next.time, tomorrow: false, retry: !!plan.next.retry };
  } else if (config.enabled && config.times.length > 0) {
    next = { time: config.times[0], tomorrow: true, retry: false };
  }
  return Object.assign({
    enabled: config.enabled,
    done: state.done,
    total: dailyTarget(config),
    minutes: config.minutes,
    next,
    phase: 'idle', // idle | headsup | active
    endsAt: null,
    startsAt: null,
  }, extra || {});
}

module.exports = {
  DEFAULT_CONFIG,
  HEADS_UP_MS,
  RETRY_MS,
  GIVE_UP_MS,
  IDLE_LIMIT_MS,
  EVENT_MARGIN_MS,
  RECENT_BREAK_MS,
  FADE_MS,
  FINAL,
  localDateStr,
  normalizeTime,
  atTime,
  normalizeConfig,
  loadConfig,
  normalizeState,
  loadState,
  saveState,
  planSlots,
  dailyTarget,
  habitDue,
  busyEvent,
  micCaptures,
  probeIdleMs,
  probeLocked,
  probeMic,
  ddtermOpen,
  ddtermActivate,
  getBanners,
  setBanners,
  setBannersSync,
  relaxView,
};
