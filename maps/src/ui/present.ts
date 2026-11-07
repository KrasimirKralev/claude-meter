// Present: full screen, no toolbars, and the arrow keys walk through the map along its arrows.

import { fitView, focusBox, heightOf } from '../canvas/actions.ts';
import { walkOrder } from '../map/walk.ts';
import { showToast, store } from '../state/store.ts';

const focusStep = (): void => {
  const present = store.ui.present;
  if (!present) return;
  const bubble = walkOrder(store.doc)[present.index];
  if (!bubble) return;
  const margin = 24;
  focusBox(
    {
      x: bubble.map.x - margin,
      y: bubble.map.y - margin,
      w: bubble.map.w + margin * 2,
      h: heightOf(bubble, bubble.map.w) + margin * 2,
    },
    1.9,
  );
};

export const startPresenting = (): void => {
  if (store.ui.view !== 'map' || walkOrder(store.doc).length === 0) {
    showToast('The finished map has nothing to present yet.');
    return;
  }
  store.setUi({ present: { index: -1, bubble: null }, selectedBubble: null, editing: null });
  // Full screen can be refused. Presenting still works inside the window.
  void document.documentElement.requestFullscreen?.().catch(() => undefined);
  setTimeout(() => fitView(), 120);
};

export const stepPresenting = (delta: number): void => {
  const present = store.ui.present;
  if (!present) return;
  const order = walkOrder(store.doc);
  const index = Math.max(-1, Math.min(order.length - 1, present.index + delta));
  store.setUi({ present: { index, bubble: order[index]?.id ?? null } });
  if (index === -1) fitView();
  else focusStep();
};

export const stopPresenting = (): void => {
  if (!store.ui.present) return;
  store.setUi({ present: null });
  if (document.fullscreenElement) void document.exitFullscreen();
  fitView();
};
