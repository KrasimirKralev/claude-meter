import { useEffect, useState } from 'react';
import { fitView } from '../canvas/actions.ts';
import { stopDigitize } from '../digitize/run.ts';
import { createExampleDoc } from '../doc/example.ts';
import { createDoc, newId } from '../doc/ops.ts';
import { deleteMap, listMaps, loadMap, openMap, openNewMap, saveOpenMap } from '../state/persist.ts';
import type { MapSummary } from '../state/persist.ts';
import { showToast, store, useStore } from '../state/store.ts';
import { Button, Icon } from './primitives.tsx';

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

  useEffect(() => {
    if (!open) {
      setConfirming(null);
      return;
    }
    // The open map may hold changes the idle save has not written yet.
    void saveOpenMap()
      .then(listMaps)
      .then(setMaps)
      .catch((error: unknown) => {
        console.error('Listing maps failed', error);
        showToast('Your saved maps could not be listed. Try again.');
      });
  }, [open]);

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

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Your maps"
        title="Your maps"
        className="flex h-9 items-center gap-1 rounded-lg px-1.5 hover:bg-hover"
        onClick={() => store.setUi({ menu: open ? null : 'maps' })}
      >
        <img src="/favicon.svg" alt="" className="size-6" />
        <Icon name="chevron" size={14} />
      </button>
      {open && (
        <div
          role="menu"
          className="scroll-thin absolute top-11 left-0 z-20 max-h-[70vh] w-[320px] overflow-y-auto rounded-xl border border-line bg-surface p-2 shadow-float"
        >
          <div className="grid gap-1 pb-2">
            <Button
              variant="primary"
              onClick={() => {
                close();
                void saveOpenMap().then(() => {
                  openNewMap(createDoc());
                  store.setUi({ tool: 'pen' });
                  afterOpen();
                });
              }}
            >
              New map
            </Button>
            <Button
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
          <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-0.5 border-t border-line p-0 pt-2">
            {maps.map((map) => (
              <li key={map.id} className="flex items-center gap-1">
                <button
                  type="button"
                  role="menuitem"
                  aria-current={map.id === current}
                  onClick={() => void switchTo(map.id)}
                  className={`min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-left hover:bg-hover ${
                    map.id === current ? 'bg-soft' : ''
                  }`}
                >
                  <span className="block truncate font-medium">{map.title}</span>
                  <span className="block text-[12px] text-mute">{age(map.updatedAt)}</span>
                </button>
                {confirming === map.id ? (
                  <Button small className="!text-danger" onClick={() => void remove(map.id)}>
                    Delete for good
                  </Button>
                ) : (
                  <Button
                    small
                    variant="plain"
                    className="!text-mute"
                    aria-label={`Delete ${map.title}`}
                    onClick={() => setConfirming(map.id)}
                  >
                    Delete
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
