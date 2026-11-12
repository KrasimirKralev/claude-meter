// Present: full screen, no toolbars, and the arrow keys walk through the map along its arrows.

import { boxOfBubble, fitView, focusBox } from '../canvas/actions.ts';
import { walkOrder } from '../map/walk.ts';
import { showToast, store } from '../state/store.ts';

const focusStep = (): void => {
  const present = store.ui.present;
  if (!present) return;
  const bubble = walkOrder(store.doc)[present.index];
  if (!bubble) return;
  const margin = 24;
  const box = boxOfBubble(bubble, 'map');
  focusBox(
    { x: box.x - margin, y: box.y - margin, w: box.w + margin * 2, h: box.h + margin * 2 },
    1.9,
  );
};

/**
 * The page takes a moment to reach its new size after asking for or leaving full screen, and a fit
 * done before that lands off-centre. So it fits again on the resize, with a timer in case none comes.
 */
const fitAfterResize = (): void => {
  fitView();
  const again = (): void => {
    window.removeEventListener('resize', again);
    clearTimeout(timer);
    fitView();
  };
  const timer = setTimeout(again, 400);
  window.addEventListener('resize', again);
};

/** Leaving full screen by any other route, like Esc handled by the browser, also ends presenting. */
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && store.ui.present) stopPresenting();
});

export const startPresenting = (): void => {
  if (store.ui.view !== 'map' || walkOrder(store.doc).length === 0) {
    showToast('The finished map has nothing to present yet.');
    return;
  }
  store.setUi({ present: { index: -1, bubble: null }, selectedBubble: null, editing: null });
  // Full screen can be refused. Presenting still works inside the window.
  void document.documentElement.requestFullscreen?.().catch(() => undefined);
  fitAfterResize();
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
  fitAfterResize();
};
