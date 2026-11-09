// Where a bubble or one of its lines is on the canvas, in either view. A bubble drawn inside another
// one has no position of its own: it sits where the page put it inside the outermost bubble.

import { isShownIn, shownParent, shownRoot } from '../doc/ops.ts';
import type { Box, Bubble, Id } from '../doc/types.ts';
import type { Anchor } from '../state/store.ts';
import { estimateHeight } from './layout.ts';

export type ShownView = 'map' | 'both';

export interface Measured {
  heights: Record<Id, number>;
  anchors: Record<Id, Anchor>;
}

export const childrenIn =
  (bubbles: readonly Bubble[], view: ShownView) =>
  (parent: Bubble): Bubble[] => {
    const shown = isShownIn(view);
    return bubbles.filter((b) => shown(b) && shownParent(bubbles, b, shown)?.id === parent.id);
  };

const rootBox = (bubbles: readonly Bubble[], root: Bubble, view: ShownView, measured: Measured): Box => {
  const place = view === 'map' ? root.map : root.sketch;
  const h =
    measured.heights[root.id] ??
    (view === 'map' ? estimateHeight(root, place.w, childrenIn(bubbles, view)) : (place.h ?? 120));
  return { x: place.x, y: place.y, w: place.w, h };
};

export const bubbleBox = (
  bubbles: readonly Bubble[],
  bubble: Bubble,
  view: ShownView,
  measured: Measured,
): Box => {
  const root = shownRoot(bubbles, bubble, isShownIn(view));
  const outer = rootBox(bubbles, root, view, measured);
  if (root === bubble) return outer;
  const anchor = measured.anchors[bubble.id];
  if (!anchor || anchor.root !== root.id) return outer;
  return { x: outer.x + anchor.x, y: outer.y + anchor.y, w: anchor.w, h: anchor.h };
};

/** The band of one line: as wide as its bubble, as tall as the line. Null before it is measured. */
export const lineBox = (
  bubbles: readonly Bubble[],
  bubble: Bubble,
  item: Id,
  view: ShownView,
  measured: Measured,
): Box | null => {
  const anchor = measured.anchors[item];
  const root = shownRoot(bubbles, bubble, isShownIn(view));
  if (!anchor || anchor.root !== root.id) return null;
  const own = bubbleBox(bubbles, bubble, view, measured);
  const outer = rootBox(bubbles, root, view, measured);
  return { x: own.x, y: outer.y + anchor.y, w: own.w, h: anchor.h };
};
