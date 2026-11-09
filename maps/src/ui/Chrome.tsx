import { useEffect, useRef, useState } from 'react';
import { camera } from '../canvas/camera.ts';
import { changeView, deleteSelected, fitView, groupSelection, setTool, toggleTheme } from '../canvas/actions.ts';
import { insideApp } from '../desktop/bridge.ts';
import { digitize } from '../digitize/run.ts';
import { startPresenting } from './present.ts';
import type { InkColor, Tool, View } from '../doc/types.ts';
import { INK_PALETTES } from '../canvas/ink.ts';
import { store, useStore } from '../state/store.ts';
import { ExportMenu } from './ExportMenu.tsx';
import { MapsMenu } from './MapsMenu.tsx';
import { Button, IconButton, Pill } from './primitives.tsx';
import type { IconName } from './primitives.tsx';

const VIEWS: { id: View; label: string }[] = [
  { id: 'sketch', label: 'Sketch' },
  { id: 'both', label: 'Both' },
  { id: 'map', label: 'Map' },
];

const TOOLS: { id: Tool; label: string; icon: IconName; key: string; inMap: boolean }[] = [
  { id: 'select', label: 'Select', icon: 'select', key: 'V', inMap: true },
  { id: 'hand', label: 'Hand: drag to move around', icon: 'hand', key: 'H', inMap: true },
  { id: 'pen', label: 'Pen', icon: 'pen', key: 'P', inMap: false },
  { id: 'eraser', label: 'Eraser', icon: 'eraser', key: 'E', inMap: false },
  { id: 'text', label: 'Text', icon: 'text', key: 'T', inMap: true },
  { id: 'arrow', label: 'Arrow', icon: 'arrow', key: 'A', inMap: true },
  { id: 'lasso', label: 'Lasso', icon: 'lasso', key: 'L', inMap: false },
];

const PEN_COLORS: { id: InkColor; label: string }[] = [
  { id: 'ink', label: 'Ink' },
  { id: 'yellow', label: 'Yellow' },
  { id: 'pink', label: 'Pink' },
  { id: 'aqua', label: 'Aqua' },
  { id: 'peach', label: 'Peach' },
  { id: 'periwinkle', label: 'Periwinkle' },
];

const TitleEditor = () => {
  const title = useStore((s) => s.doc.title);
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (draft !== null) inputRef.current?.select();
    // Selects once when editing starts, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft === null]);

  const finish = (): void => {
    if (draft !== null && draft.trim() && draft.trim() !== title) {
      const next = draft.trim();
      store.commit((doc) => ({ ...doc, title: next }));
    }
    setDraft(null);
  };

  if (draft !== null) {
    return (
      <input
        ref={inputRef}
        className="map-title w-[calc(50vw-286px)] max-w-[420px] rounded-md bg-hover px-2.5 py-0.5 text-[20px] font-semibold tracking-[-0.01em] outline-none"
        aria-label="Map name"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={finish}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') finish();
          if (e.key === 'Escape') setDraft(null);
        }}
      />
    );
  }
  return (
    <button
      type="button"
      className="map-title max-w-[calc(50vw-286px)] truncate rounded-md px-2.5 py-0.5 text-[20px] font-semibold tracking-[-0.01em] hover:bg-hover"
      title="Rename this map"
      onClick={() => setDraft(title)}
    >
      {title}
    </button>
  );
};

const ZoomPill = () => {
  const [zoom, setZoom] = useState(100);
  useEffect(
    () =>
      camera.subscribe((state) => {
        setZoom((current) => {
          const next = Math.round(state.z * 100);
          return current === next ? current : next;
        });
      }),
    [],
  );
  const centre = (factor: number) => camera.zoomAt(innerWidth / 2, innerHeight / 2, factor);
  return (
    <Pill className="bottom-4 left-4">
      <IconButton icon="minus" label="Zoom out" hint="-" onClick={() => centre(1 / 1.25)} />
      <button
        type="button"
        className="w-12 rounded-md py-1 text-center font-medium tabular-nums hover:bg-hover"
        title="Reset to 100%"
        onClick={() => centre(1 / camera.state.z)}
      >
        {zoom}%
      </button>
      <IconButton icon="plus" label="Zoom in" hint="+" onClick={() => centre(1.25)} />
      <IconButton icon="fit" label="Fit to screen" hint="Ctrl+1" onClick={() => fitView()} />
    </Pill>
  );
};

const SelectionBar = () => {
  const count = useStore((s) => s.ui.selection.length);
  const view = useStore((s) => s.ui.view);
  if (count === 0 || view === 'map') return null;
  return (
    <Pill className="bottom-4 left-1/2 -translate-x-1/2" role="toolbar" aria-label="Selection">
      <span className="px-2 text-mute tabular-nums">
        {count} selected
      </span>
      <Button small variant="primary" onClick={groupSelection}>
        Make a group
      </Button>
      <Button small onClick={() => void digitize()}>
        Digitize these
      </Button>
      <Button small onClick={deleteSelected}>
        Delete
      </Button>
    </Pill>
  );
};

const EmptyHint = () => {
  const empty = useStore(
    (s) =>
      s.doc.strokes.length === 0 &&
      s.doc.texts.length === 0 &&
      s.doc.bubbles.length === 0 &&
      s.ui.draftText === null,
  );
  const view = useStore((s) => s.ui.view);
  if (!empty || view === 'map') return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-[5] grid place-items-center text-center">
      <div>
        <p className="m-0 text-[22px] font-semibold tracking-[-0.01em]">Draw anything.</p>
        <p className="mt-1 mb-0 text-mute">
          Press Enter to type. Press D when you want it turned into a map.
        </p>
      </div>
    </div>
  );
};

/** Points a first-time visitor at the one button that shows what this app is for. */
const ExampleHint = () => {
  const show = useStore((s) => s.doc.isExample === true && s.ui.view === 'sketch');
  if (!show) return null;
  return (
    <div className="absolute top-[76px] right-4 z-10 max-w-[260px] rounded-xl bg-blue px-3.5 py-2.5 font-medium text-white shadow-float">
      This is an example sketch. Press Digitize to turn it into a map.
    </div>
  );
};

export const Chrome = () => {
  const view = useStore((s) => s.ui.view);
  const tool = useStore((s) => s.ui.tool);
  const theme = useStore((s) => s.ui.theme);
  const penColor = useStore((s) => s.ui.penColor);
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);
  const streaming = useStore((s) => s.ui.digitize.state === 'streaming');
  const palette = INK_PALETTES[theme];
  useStore((s) => s.doc);

  return (
    <>
      <EmptyHint />
      <ExampleHint />
      <header>
        <Pill className="top-4 left-4 !z-30">
          <MapsMenu />
          <TitleEditor />
          <IconButton
            icon="undo"
            label="Undo"
            hint="Ctrl+Z"
            disabled={!canUndo}
            onClick={() => store.undo()}
          />
          <IconButton
            icon="redo"
            label="Redo"
            hint="Ctrl+Shift+Z"
            disabled={!canRedo}
            onClick={() => store.redo()}
          />
        </Pill>

        <Pill className="view-switch top-4 left-1/2 -translate-x-1/2" role="group" aria-label="View">
          {VIEWS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-pressed={view === id}
              onClick={() => changeView(id)}
              className={`rounded-lg px-3.5 py-[7px] font-medium ${
                view === id ? 'bg-soft text-accent-ink' : 'hover:bg-hover'
              }`}
            >
              {label}
            </button>
          ))}
        </Pill>

        <Pill className="top-4 right-4 !z-30">
          {!insideApp() && (
            <IconButton
              icon={theme === 'dark' ? 'sun' : 'moon'}
              label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              onClick={toggleTheme}
            />
          )}
          <IconButton
            icon="help"
            label="Keyboard shortcuts"
            hint="?"
            onClick={() => store.setUi({ menu: store.ui.menu === 'help' ? null : 'help' })}
          />
          {view === 'map' && (
            <IconButton icon="play" label="Present" hint="F" onClick={startPresenting} />
          )}
          <ExportMenu primary={view === 'map'} />
          {view !== 'map' && (
            <Button
              variant="primary"
              disabled={streaming}
              onClick={(e) => void digitize({ x: e.clientX, y: e.clientY })}
            >
              Digitize
            </Button>
          )}
        </Pill>
      </header>

      <nav aria-label="Tools">
        <Pill className="tool-rail top-1/2 left-4 -translate-y-1/2 flex-col">
          {TOOLS.filter((t) => view !== 'map' || t.inMap).map(({ id, label, icon, key }) => (
            <IconButton
              key={id}
              icon={icon}
              label={label}
              hint={key}
              pressed={tool === id}
              onClick={() => setTool(id)}
            />
          ))}
          {view !== 'map' && (tool === 'pen' || tool === 'arrow') && (
            <div
              className="pen-colors mt-1 grid gap-1.5 border-t border-line pt-2 pb-1"
              role="group"
              aria-label="Pen colour"
            >
              {PEN_COLORS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  aria-label={label}
                  aria-pressed={penColor === id}
                  title={id === 'ink' ? label : `${label}: a box drawn in this colour becomes a ${label.toLowerCase()} bubble`}
                  onClick={() => store.setUi({ penColor: id })}
                  className={`mx-auto size-[18px] rounded-full ${
                    penColor === id ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface' : ''
                  }`}
                  style={{ background: palette[id], boxShadow: 'inset 0 0 0 1px var(--line)' }}
                />
              ))}
            </div>
          )}
        </Pill>
      </nav>

      <ZoomPill />
      <SelectionBar />
    </>
  );
};
