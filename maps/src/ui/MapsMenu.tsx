import { useEffect, useRef, useState } from 'react';
import { fitView } from '../canvas/actions.ts';
import { stopDigitize } from '../digitize/run.ts';
import { createExampleDoc } from '../doc/example.ts';
import { createDoc, newId } from '../doc/ops.ts';
import { deleteMap, listMaps, loadMap, openMap, openNewMap, saveOpenMap } from '../state/persist.ts';
import { showToast, store, useStore } from '../state/store.ts';
import { filterMaps, sizeLabel } from '../state/summary.ts';
import type { MapSummary } from '../state/summary.ts';
import { MapThumb } from './MapThumb.tsx';
import { Button, Icon, IconButton } from './primitives.tsx';

const afterOpen = (): void => {
  stopDigitize();
  requestAnimationFrame(() => fitView(false));
};

const age = (time: number): string => {
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
};

export const MapsMenu = () => {
  const open = useStore((s) => s.ui.menu === 'maps');
  const current = useStore((s) => s.doc.id);
  const [maps, setMaps] = useState<MapSummary[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  /** The row the arrow keys are on. Enter opens it. */
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const shown = filterMaps(maps, query);

  useEffect(() => {
    if (!open) {
      setConfirming(null);
      setQuery('');
      return;
    }
    // Typing starts a search at once, so finding a map never needs the mouse.
    inputRef.current?.focus();
    // The open map may hold changes the idle save has not written yet.
    void saveOpenMap()
      .then(listMaps)
      .then((all) => {
        setMaps(all);
        setActive(Math.max(0, all.findIndex((map) => map.id === store.doc.id)));
      })
      .catch((error: unknown) => {
        console.error('Listing maps failed', error);
        showToast('Your saved maps could not be listed. Try again.');
      });
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }, [active, shown.length]);

  const onSearchKey = (e: React.KeyboardEvent): void => {
    // Letters typed here are a search, never a canvas shortcut.
    e.stopPropagation();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((index) => Math.max(0, Math.min(shown.length - 1, index + step)));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = shown[Math.min(active, shown.length - 1)];
      if (target) void switchTo(target.id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (query) setQuery('');
      else close();
    }
  };

  const close = (): void => store.setUi({ menu: null });

  const switchTo = async (id: string): Promise<void> => {
    close();
    if (id === current) return;
    try {
      await saveOpenMap();
      const doc = await loadMap(id);
      if (doc) {
        openMap(doc);
        afterOpen();
      }
    } catch (error) {
      console.error('Opening a saved map failed', id, error);
      showToast('That map is damaged and could not be opened. Your other maps are safe.');
    }
  };

  const remove = async (id: string): Promise<void> => {
    await deleteMap(id);
    const rest = await listMaps();
    setMaps(rest);
    setConfirming(null);
    if (id !== current) return;
    // The next map in the list may be damaged, and the deleted one must not stay open.
    for (const candidate of rest) {
      try {
        const next = await loadMap(candidate.id);
        if (next) {
          openMap(next);
          afterOpen();
          return;
        }
      } catch (error) {
        console.error('A saved map is damaged and was skipped', candidate.id, error);
      }
    }
    openNewMap(createDoc());
    afterOpen();
  };

  const startNew = (): void => {
    close();
    void saveOpenMap().then(() => {
      openNewMap(createDoc());
      store.setUi({ tool: 'pen' });
      afterOpen();
    });
  };

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Your maps"
        title="Your maps (M)"
        className="flex h-9 items-center gap-1.5 rounded-lg px-1.5 hover:bg-hover"
        onClick={() => store.setUi({ menu: open ? null : 'maps' })}
      >
        <img src="/favicon.svg" alt="" className="size-6" />
        <span className="text-[14px] font-semibold">Maps</span>
        <Icon name="chevron" size={14} />
      </button>
      {open && (
        <div
          data-menu-panel
          role="dialog"
          aria-label="Your maps"
          className="absolute top-[46px] -left-[7px] z-20 flex max-h-[min(76vh,640px)] w-[400px] max-w-[calc(100vw-32px)] flex-col rounded-xl border border-line bg-surface shadow-float"
        >
          <div className="flex items-center gap-2 p-2">
            <label className="relative min-w-0 flex-1">
              <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-mute">
                <Icon name="search" size={16} />
              </span>
              <input
                ref={inputRef}
                type="text"
                role="searchbox"
                enterKeyHint="go"
                autoComplete="off"
                spellCheck={false}
                aria-label="Find a map"
                placeholder="Find a map"
                className="maps-search h-9 w-full rounded-lg border border-line bg-raised pr-2.5 pl-8 placeholder:text-mute"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onSearchKey}
              />
            </label>
            <Button variant="primary" onClick={startNew}>
              New map
            </Button>
          </div>
          <ul
            ref={listRef}
            role="menu"
            aria-label="Maps, newest first"
            className="scroll-thin m-0 grid min-h-0 list-none grid-cols-[minmax(0,1fr)] gap-0.5 overflow-y-auto border-t border-line p-2"
          >
            {shown.map((map, index) => (
              <li
                key={map.id}
                className={`map-row flex items-center gap-1 rounded-lg ${index === active ? 'is-active' : ''}`}
              >
                <button
                  type="button"
                  role="menuitem"
                  aria-current={map.id === current}
                  onClick={() => void switchTo(map.id)}
                  className={`flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1.5 text-left ${
                    map.id === current ? 'bg-soft' : 'hover:bg-hover'
                  }`}
                >
                  <MapThumb thumb={map.thumb} style={map.style} />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 leading-snug font-medium">{map.title}</span>
                    <span className="block truncate text-[12px] text-mute">
                      {age(map.updatedAt)} · {sizeLabel(map)}
                      {map.id === current ? ' · open now' : ''}
                    </span>
                  </span>
                </button>
                {confirming === map.id ? (
                  <Button small className="!text-danger" onClick={() => void remove(map.id)}>
                    Delete for good
                  </Button>
                ) : (
                  <IconButton
                    icon="trash"
                    label={`Delete ${map.title}`}
                    className="map-row-delete text-mute"
                    onClick={() => setConfirming(map.id)}
                  />
                )}
              </li>
            ))}
            {shown.length === 0 && (
              <li className="px-2 py-6 text-center text-mute" role="none">
                {maps.length === 0 ? 'No maps yet.' : `No map has “${query.trim()}” in its name.`}
              </li>
            )}
          </ul>
          <div className="flex gap-2 border-t border-line p-2">
            <Button
              small
              className="flex-1"
              onClick={() => {
                close();
                stopDigitize();
                void saveOpenMap().then(() => {
                  openNewMap({ ...store.doc, id: newId(), title: `${store.doc.title} (copy)` });
                  afterOpen();
                });
              }}
            >
              Duplicate this map
            </Button>
            <Button
              small
              className="flex-1"
              onClick={() => {
                close();
                void saveOpenMap().then(() => {
                  openNewMap(createExampleDoc());
                  afterOpen();
                });
              }}
            >
              Open the example
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
