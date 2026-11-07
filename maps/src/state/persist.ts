// Maps live in the browser's database on this computer. Saving waits for an idle moment so it can
// never land in the middle of a stroke.

import { listenForOpen, reportMapsSoon } from '../desktop/bridge.ts';
import { createExampleDoc } from '../doc/example.ts';
import { createDoc } from '../doc/ops.ts';
import type { MapDoc, Tool } from '../doc/types.ts';
import { validateDoc } from '../doc/validate.ts';
import { showToast, store } from './store.ts';

const DB_NAME = 'balonche';
const STORE = 'maps';
const LAST_OPEN = 'balonche-last-map';
const RESCUE_PREFIX = 'balonche-rescue-';
/** Set by the crash screen, so the next start opens a clean map instead of the one that crashed. */
export const START_BLANK = 'balonche-start-blank';
const TAB_ID = Math.random().toString(36).slice(2);
const MAP_TOOLS: Tool[] = ['select', 'text', 'arrow'];

export interface MapSummary {
  id: string;
  title: string;
  updatedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

const openDb = (): Promise<IDBDatabase> => {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
};

const run = async <T,>(
  mode: IDBTransactionMode,
  action: (maps: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = action(transaction.objectStore(STORE));
    // A write is only safe once its transaction commits. A full disk fails at this last step.
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('The save was aborted.'));
  });
};

export const saveMap = (doc: MapDoc): Promise<IDBValidKey> => run('readwrite', (m) => m.put(doc));

/** What this tab last saw in the database for the open map. Anything else came from another tab. */
let knownStamp: { id: string; updatedAt: number } | null = null;

const remember = (doc: MapDoc): void => {
  knownStamp = { id: doc.id, updatedAt: doc.updatedAt };
};

/**
 * Saves only if the stored map is still the one this tab knows. Otherwise another tab changed it,
 * and writing here would destroy that work, so the caller keeps this version as a copy instead.
 */
const saveIfUnchanged = async (doc: MapDoc): Promise<'saved' | 'conflict'> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    const maps = transaction.objectStore(STORE);
    let outcome: 'saved' | 'conflict' = 'saved';
    const read = maps.get(doc.id);
    read.onsuccess = () => {
      const stored = read.result as MapDoc | undefined;
      const known = knownStamp?.id === doc.id ? knownStamp.updatedAt : null;
      if (stored && known !== null && stored.updatedAt !== known) outcome = 'conflict';
      else maps.put(doc);
    };
    transaction.oncomplete = () => resolve(outcome);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('The save was aborted.'));
  });
};

/** Throws if the stored map is damaged, so nothing tries to draw it. */
export const loadMap = async (id: string): Promise<MapDoc | undefined> => {
  const stored = await run<unknown>('readonly', (m) => m.get(id));
  return stored === undefined ? undefined : validateDoc(stored);
};

const allDocs = (): Promise<MapDoc[]> => run<MapDoc[]>('readonly', (m) => m.getAll());

export const deleteMap = async (id: string): Promise<void> => {
  await run('readwrite', (m) => m.delete(id));
  reportMapsSoon(allDocs);
};

export const listMaps = async (): Promise<MapSummary[]> => {
  const all = await run<MapDoc[]>('readonly', (m) => m.getAll());
  return all
    .map(({ id, title, updatedAt }) => ({ id, title, updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
};

const rememberOpen = (id: string): void => {
  try {
    localStorage.setItem(LAST_OPEN, id);
  } catch {
    // Storage blocked: the app simply opens the newest map next time.
  }
};

export const openMap = (doc: MapDoc): void => {
  store.load(doc);
  const view = doc.bubbles.some((b) => b.status === 'accepted') ? 'map' : 'sketch';
  // The pen does not exist on the finished map, so a map opening there must not leave it active.
  const tool = view === 'map' && !MAP_TOOLS.includes(store.ui.tool) ? 'select' : store.ui.tool;
  store.setUi({ view, tool });
  remember(doc);
  rememberOpen(doc.id);
};

export const openNewMap = (doc: MapDoc = createDoc()): void => {
  openMap(doc);
  void saveMap(doc);
};

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let lastSaved: MapDoc | null = null;
let saving: MapDoc | null = null;
let warned = false;

const tabs = 'BroadcastChannel' in globalThis ? new BroadcastChannel('balonche') : null;
tabs?.addEventListener('message', (event: MessageEvent<{ id: string; tab: string }>) => {
  if (event.data.id === store.doc.id && event.data.tab !== TAB_ID) {
    showToast('This map is also open in another tab. If both change it, each keeps its own copy.');
  }
});

/** Another tab changed this map, so this tab carries on with its own version as a separate map. */
const keepAsCopy = async (doc: MapDoc): Promise<void> => {
  const copy: MapDoc = { ...doc, id: createDoc().id, title: `${doc.title} (other tab)` };
  await saveMap(copy);
  openMap(copy);
  lastSaved = copy;
  showToast(`This map changed in another tab, so your version is kept as "${copy.title}".`);
};

/** Saves the open map now, for moments like switching to another one. */
export const saveOpenMap = async (): Promise<void> => {
  const doc = store.doc;
  if (doc === lastSaved) return;
  const outcome = await saveIfUnchanged(doc);
  if (outcome === 'conflict') {
    await keepAsCopy(doc);
    return;
  }
  remember(doc);
  lastSaved = doc;
};

const flush = (): void => {
  const doc = store.doc;
  if (doc === lastSaved || doc === saving) return;
  saving = doc;
  saveIfUnchanged(doc)
    .then(async (outcome) => {
      if (outcome === 'conflict') {
        await keepAsCopy(doc);
        return;
      }
      // Counted as saved only now, so a page closing during the write still leaves a rescue copy.
      remember(doc);
      lastSaved = doc;
      warned = false;
      reportMapsSoon(allDocs);
      tabs?.postMessage({ id: doc.id, tab: TAB_ID });
    })
    .catch((error: unknown) => {
      console.error('Saving the map failed', error);
      if (!warned) {
        warned = true;
        showToast('Saving failed. Your map is still open. Use Export > JSON to keep a copy.');
      }
    })
    .finally(() => {
      if (saving === doc) saving = null;
    });
};

const scheduleSave = (): void => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if ('requestIdleCallback' in window) requestIdleCallback(flush, { timeout: 400 });
    else flush();
  }, 150);
};

/**
 * The browser may abort a database write while a page closes, but a write to local storage is
 * synchronous. So the last unsaved state goes there, and the next start picks it up.
 */
const writeRescue = (): void => {
  if (store.doc === lastSaved) return;
  try {
    const known = knownStamp?.id === store.doc.id ? knownStamp.updatedAt : null;
    localStorage.setItem(
      `${RESCUE_PREFIX}${store.doc.id}`,
      JSON.stringify({ known, json: docToJson(store.doc) }),
    );
  } catch (error) {
    console.warn('The rescue copy did not fit in local storage', error);
  }
};

const restoreRescue = async (key: string): Promise<void> => {
  const raw = localStorage.getItem(key);
  if (!raw) return;
  const { known, json } = JSON.parse(raw) as { known: number | null; json: string };
  const rescued = validateDoc(JSON.parse(json));
  const saved = await run<MapDoc | undefined>('readonly', (m) => m.get(rescued.id));
  if (saved && known !== null && saved.updatedAt !== known) {
    // Another tab saved after this copy began, so both versions are kept.
    await saveMap({ ...rescued, id: createDoc().id, title: `${rescued.title} (other tab)` });
  } else {
    await saveMap({ ...rescued, updatedAt: Date.now() });
  }
  // Removed only after it is safely stored, because this copy may be the only one left.
  localStorage.removeItem(key);
};

const takeRescues = async (): Promise<void> => {
  let keys: string[] = [];
  try {
    keys = Object.keys(localStorage).filter((key) => key.startsWith(RESCUE_PREFIX));
  } catch {
    return;
  }
  for (const key of keys) {
    try {
      await restoreRescue(key);
    } catch (error) {
      console.error('A rescue copy could not be restored', key, error);
    }
  }
};

let started = false;

export const startPersistence = async (): Promise<void> => {
  if (started) return;
  started = true;
  try {
    await takeRescues();
    let lastId: string | null = null;
    try {
      lastId = localStorage.getItem(LAST_OPEN);
    } catch {
      lastId = null;
    }
    const maps = await listMaps();
    let startBlank = false;
    try {
      startBlank = localStorage.getItem(START_BLANK) !== null;
      localStorage.removeItem(START_BLANK);
    } catch {
      startBlank = false;
    }
    // The last map first, then the rest, skipping any that are damaged.
    const candidates = [lastId, ...maps.map((m) => m.id)].filter(
      (id, index, all): id is string =>
        id !== null && maps.some((m) => m.id === id) && all.indexOf(id) === index,
    );
    let opened = false;
    if (startBlank) {
      openNewMap(createDoc());
      opened = true;
    }
    for (const id of candidates) {
      if (opened) break;
      try {
        const doc = await loadMap(id);
        if (doc) {
          openMap(doc);
          opened = true;
        }
      } catch (error) {
        console.error('A saved map is damaged and was skipped', id, error);
        showToast('One saved map is damaged and could not be opened. The others are safe.');
      }
    }
    if (!opened) openNewMap(createExampleDoc());
  } catch (error) {
    console.error('Opening saved maps failed', error);
    openMap(createExampleDoc());
    showToast('Saved maps could not be opened. This map may not be kept. Export it to be safe.');
  }

  lastSaved = store.doc;
  let current = store.doc;
  store.subscribe(() => {
    if (store.doc !== current) {
      current = store.doc;
      scheduleSave();
    }
  });
  // Leaving the page must never lose the last strokes.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', () => {
    // Words still being typed are saved when their editor loses focus.
    const active = document.activeElement;
    if (active instanceof HTMLElement && (active.isContentEditable || active.matches('input'))) {
      active.blur();
    }
    writeRescue();
  });
  reportMapsSoon(allDocs);
  listenForOpen((request) => {
    void saveOpenMap()
      .then(async () => {
        if (request.new) {
          openNewMap();
          return;
        }
        const doc = request.id ? await loadMap(request.id) : undefined;
        if (doc) openMap(doc);
        else showToast('That map no longer exists.');
      })
      .catch((error: unknown) => {
        console.error('Opening a map from the app failed', request, error);
        showToast('That map could not be opened. Your other maps are safe.');
      });
  });
};

// JSON export and import: the backup format.

const rounded = (value: number): number => Math.round(value * 100) / 100;

/**
 * Compact, with rounded points. A rescue copy fits about 250,000 points. A larger map relies on the
 * database save alone, so it could lose only what was drawn in the last half second before a crash.
 */
export const docToJson = (doc: MapDoc): string =>
  JSON.stringify({
    ...doc,
    strokes: doc.strokes.map((s) => ({ ...s, points: Array.from(s.points, rounded) })),
  });

/** Opening a backup makes a new map, so it can never overwrite the one it was saved from. */
export const docFromJson = (json: string): MapDoc => ({
  ...validateDoc(JSON.parse(json)),
  id: createDoc().id,
  updatedAt: Date.now(),
});
