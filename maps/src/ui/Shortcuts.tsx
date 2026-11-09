import { useEffect } from 'react';
import { camera } from '../canvas/camera.ts';
import { changeView, deleteSelected, fitView, groupSelection, setTool } from '../canvas/actions.ts';
import { digitize } from '../digitize/run.ts';
import { acceptAll, acceptProposal, currentProposal, rejectProposal } from '../doc/proposals.ts';
import { isGestureActive } from '../canvas/interaction.ts';
import { newId } from '../doc/ops.ts';
import { store, useStore } from '../state/store.ts';
import { IconButton } from './primitives.tsx';
import { startPresenting, stepPresenting, stopPresenting } from './present.ts';

const LIST: [string, string][] = [
  ['V  P  E  T  A  L', 'Select, pen, eraser, text, arrow, lasso'],
  ['H', 'Hand: drag to move around, and the wheel scrolls'],
  ['Arrow keys', 'Move around, a screenful with Shift'],
  ['Enter', 'Type where the pointer is'],
  ['D', 'Digitize'],
  ['1  2  3', 'Sketch, Both, Map'],
  ['Y  N', 'Accept or reject the next proposal'],
  ['Shift + Enter', 'Accept all and see the map'],
  ['G', 'Group what is selected'],
  ['F', 'Present. Arrow keys walk the map, Esc leaves'],
  ['Ctrl + Z', 'Undo, with Shift to redo'],
  ['Wheel', 'Zoom. Space, the middle or right button drags the canvas'],
  ['Ctrl + 1', 'Fit to screen'],
];

let pointer = { x: 0, y: 0 };

/** Holding one of these keeps repeating. Everything else acts once per press. */
const REPEATS = new Set([
  'Equal',
  'Minus',
  'NumpadAdd',
  'NumpadSubtract',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'KeyZ',
]);

/** Shortcuts use physical keys, so they work the same on the Bulgarian keyboard layout. */
const handleKey = (e: KeyboardEvent): void => {
  const { target } = e;
  if (target instanceof Element && target.closest('input, textarea, [contenteditable]')) return;
  if (isGestureActive()) return;
  if (e.repeat && !REPEATS.has(e.code)) return;
  const { present, view, menu } = store.ui;

  if (present) {
    if (e.code === 'ArrowRight' || e.code === 'Space' || e.code === 'ArrowDown') {
      e.preventDefault();
      stepPresenting(1);
    } else if (e.code === 'ArrowLeft' || e.code === 'ArrowUp') {
      e.preventDefault();
      stepPresenting(-1);
    } else if (e.code === 'Escape' || e.code === 'KeyF') {
      stopPresenting();
    }
    return;
  }

  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.code === 'KeyZ') {
    e.preventDefault();
    if (e.shiftKey) store.redo();
    else store.undo();
    return;
  }
  if (mod && e.code === 'KeyY') {
    e.preventDefault();
    store.redo();
    return;
  }
  if (mod && e.code === 'Digit1') {
    e.preventDefault();
    fitView();
    return;
  }
  if (mod || e.altKey) return;

  switch (e.code) {
    case 'KeyV':
      setTool('select');
      break;
    case 'KeyH':
      setTool('hand');
      break;
    case 'ArrowLeft':
    case 'ArrowRight':
    case 'ArrowUp':
    case 'ArrowDown': {
      // Arrow keys move the view, a screenful at a time with Shift.
      e.preventDefault();
      const step = e.shiftKey ? Math.min(innerWidth, innerHeight) * 0.8 : 120;
      const dx = e.code === 'ArrowLeft' ? step : e.code === 'ArrowRight' ? -step : 0;
      const dy = e.code === 'ArrowUp' ? step : e.code === 'ArrowDown' ? -step : 0;
      camera.panBy(dx, dy);
      break;
    }
    case 'KeyP':
      setTool('pen');
      break;
    case 'KeyE':
      setTool('eraser');
      break;
    case 'KeyT':
      setTool('text');
      break;
    case 'KeyA':
      setTool('arrow');
      break;
    case 'KeyL':
      setTool('lasso');
      break;
    case 'KeyD':
      if (view !== 'map' && store.ui.digitize.state !== 'streaming') void digitize();
      break;
    case 'KeyG':
      groupSelection();
      break;
    case 'KeyF':
      if (view === 'map') startPresenting();
      break;
    case 'Digit1':
      changeView('sketch');
      break;
    case 'Digit2':
      changeView('both');
      break;
    case 'Digit3':
      changeView('map');
      break;
    case 'KeyY': {
      const next = currentProposal(store.doc, store.ui.focusedProposal);
      if (next) store.commit((doc) => acceptProposal(doc, next.id));
      break;
    }
    case 'KeyN': {
      const next = currentProposal(store.doc, store.ui.focusedProposal);
      if (next) store.commit((doc) => rejectProposal(doc, next.id));
      break;
    }
    case 'Enter':
    case 'NumpadEnter': {
      // On a focused button, Enter belongs to that button.
      if (target instanceof Element && target.closest('button, a, [role=menuitem]')) break;
      e.preventDefault();
      if (e.shiftKey) {
        store.commit(acceptAll);
        changeView('map');
      } else if (view !== 'map') {
        const { x, y } = camera.toWorld(pointer.x, pointer.y);
        store.setUi({ draftText: { id: newId(), x, y }, selection: [] });
      }
      break;
    }
    case 'Delete':
    case 'Backspace':
      deleteSelected();
      break;
    case 'Escape':
      store.setUi({ selection: [], selectedBubble: null, selectedLink: null, menu: null });
      break;
    case 'Equal':
    case 'NumpadAdd':
      camera.zoomAt(innerWidth / 2, innerHeight / 2, 1.25);
      break;
    case 'Minus':
    case 'NumpadSubtract':
      camera.zoomAt(innerWidth / 2, innerHeight / 2, 0.8);
      break;
    case 'Slash':
      if (e.shiftKey) store.setUi({ menu: menu === 'help' ? null : 'help' });
      break;
  }
};

export const useShortcuts = (): void => {
  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      pointer = { x: e.clientX, y: e.clientY };
    };
    pointer = { x: innerWidth / 2, y: innerHeight / 2 };
    window.addEventListener('keydown', handleKey);
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('pointermove', onMove);
    };
  }, []);
};

export const ShortcutsPanel = () => {
  const open = useStore((s) => s.ui.menu === 'help');
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-label="Keyboard shortcuts"
      className="absolute top-20 right-4 z-30 w-[390px] rounded-xl border border-line bg-surface p-4 shadow-float"
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 className="m-0 text-[20px] font-semibold tracking-[-0.01em]">Keyboard</h2>
        <IconButton
          icon="close"
          label="Close keyboard shortcuts"
          onClick={() => store.setUi({ menu: null })}
        />
      </div>
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        {LIST.map(([keys, description]) => (
          <div key={keys} className="contents">
            <dt className="font-semibold whitespace-pre tabular-nums">{keys}</dt>
            <dd className="m-0 text-mute">{description}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
};
