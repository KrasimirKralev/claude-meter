// The order to read a map in, shared by presenting and by the exported plan: the way a person
// reads, top left first, following each arrow to its end before moving on.

import { visibleBubbles } from '../doc/ops.ts';
import type { Bubble, MapDoc } from '../doc/types.ts';

const ROW_HEIGHT = 60;

const centre = (bubble: Bubble): { x: number; y: number } => ({
  x: bubble.map.x + bubble.map.w / 2,
  y: bubble.map.y + 100,
});

export const walkOrder = (doc: MapDoc): Bubble[] => {
  const bubbles = visibleBubbles(doc, 'map');
  const groups = bubbles.filter((b) => b.kind === 'group');
  const notes = bubbles.filter((b) => b.kind === 'note');
  const ids = new Set(groups.map((b) => b.id));
  const links = doc.links.filter(
    (l) => l.status === 'accepted' && ids.has(l.from) && ids.has(l.to),
  );
  const pointedAt = new Set(links.map((l) => l.to));
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
    for (const link of links.filter((l) => l.from === bubble.id)) {
      const next = groups.find((b) => b.id === link.to);
      if (next) visit(next);
    }
  };
  reading.forEach(visit);

  // A note belongs with the group nearest to it, so it follows that group.
  for (const note of notes) {
    const c = centre(note);
    let nearest = -1;
    let best = Infinity;
    order.forEach((bubble, index) => {
      if (bubble.kind !== 'group') return;
      const g = centre(bubble);
      const d = Math.hypot(g.x - c.x, g.y - c.y);
      if (d < best) {
        best = d;
        nearest = index;
      }
    });
    order.splice(nearest + 1, 0, note);
  }
  return order;
};
