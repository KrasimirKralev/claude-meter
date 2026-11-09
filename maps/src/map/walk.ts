// The order to read a map in, shared by presenting and by the exported plan: the way a person
// reads, top left first, going into each bubble before what it points to, and following each
// arrow to its end before moving on.

import { isShownIn, shownParent, shownRoot, visibleBubbles } from '../doc/ops.ts';
import type { Bubble, MapDoc } from '../doc/types.ts';
import { childRows } from './layout.ts';

const ROW_HEIGHT = 60;

const centre = (bubble: Bubble): { x: number; y: number } => ({
  x: bubble.map.x + bubble.map.w / 2,
  y: bubble.map.y + 100,
});

export const walkOrder = (doc: MapDoc): Bubble[] => {
  const bubbles = visibleBubbles(doc, 'map');
  const shown = isShownIn('map');
  const rootOf = (bubble: Bubble): Bubble => shownRoot(doc.bubbles, bubble, shown);
  const childrenOf = (parent: Bubble): Bubble[] =>
    childRows(bubbles.filter((b) => shownParent(doc.bubbles, b, shown)?.id === parent.id)).flat();
  const groups = bubbles.filter((b) => b.kind === 'group' && rootOf(b) === b);
  const notes = bubbles.filter((b) => b.kind === 'note' && rootOf(b) === b);
  const ids = new Set(bubbles.map((b) => b.id));
  const links = doc.links.filter(
    (l) => l.status === 'accepted' && ids.has(l.from) && ids.has(l.to),
  );
  const pointedAt = new Set(
    links.map((l) => rootOf(bubbles.find((b) => b.id === l.to) as Bubble).id),
  );
  const reading = [...groups].sort(
    (a, b) =>
      Math.round(a.map.y / ROW_HEIGHT) - Math.round(b.map.y / ROW_HEIGHT) ||
      a.map.x - b.map.x ||
      // When positions cannot decide, a bubble nothing points to comes first.
      Number(pointedAt.has(a.id)) - Number(pointedAt.has(b.id)),
  );

  const seen = new Set<string>();
  const order: Bubble[] = [];
  const visit = (bubble: Bubble): void => {
    if (seen.has(bubble.id)) return;
    seen.add(bubble.id);
    order.push(bubble);
    childrenOf(bubble).forEach(visit);
    for (const link of links.filter((l) => l.from === bubble.id)) {
      const next = bubbles.find((b) => b.id === link.to);
      // A bubble inside another is read with the one around it, so the arrow leads there first.
      if (next) visit(rootOf(next));
    }
  };
  reading.forEach(visit);

  // A note belongs with the group nearest to it, so it follows that group.
  for (const note of notes) {
    const c = centre(note);
    let nearest = -1;
    let best = Infinity;
    order.forEach((bubble, index) => {
      if (bubble.kind !== 'group' || rootOf(bubble) !== bubble) return;
      const g = centre(bubble);
      const d = Math.hypot(g.x - c.x, g.y - c.y);
      if (d < best) {
        best = d;
        nearest = index;
      }
    });
    // After that group and everything read inside it.
    let at = nearest + 1;
    while (nearest >= 0 && at < order.length && rootOf(order[at]) === order[nearest]) at += 1;
    order.splice(at, 0, note);
  }
  return order;
};
