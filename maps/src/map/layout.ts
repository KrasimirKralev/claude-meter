// Turns where things were drawn into a tidy finished layout, keeping the drawn structure.

import type { Box, Bubble, Id, Placement } from '../doc/types.ts';

export const BUBBLE_W = 300;
export const WIDE_W = 400;
export const NOTE_W = 240;
const COLUMN_GAP = 56;
const ROW_GAP = 76;

/** Room a bubble leaves around the bubbles drawn inside it, and between them, on the map. */
export const NEST_PAD = 22;
export const NEST_GAP = 14;
/** Bubbles drawn inside another one are a little narrower than the ones on their own. */
const CHILD_W = 240;

type ChildrenOf = (bubble: Bubble) => Bubble[];
const none: ChildrenOf = () => [];

/** Bubbles drawn inside another, in rows the way they were drawn: side by side or one above another. */
export const childRows = (children: Bubble[]): Bubble[][] => {
  const rows: { bubbles: Bubble[]; centre: number; band: number }[] = [];
  const centreOf = (b: Bubble): number => b.sketch.y + (b.sketch.h ?? 120) / 2;
  for (const child of [...children].sort((a, b) => centreOf(a) - centreOf(b))) {
    const row = rows.at(-1);
    const c = centreOf(child);
    if (row && c <= row.centre + row.band) {
      row.bubbles.push(child);
    } else {
      rows.push({ bubbles: [child], centre: c, band: (child.sketch.h ?? 120) / 2 });
    }
  }
  return rows.map((row) => row.bubbles.sort((a, b) => a.sketch.x - b.sketch.x));
};

export const mapWidth = (bubble: Bubble, childrenOf: ChildrenOf = none, nested = false): number => {
  if (bubble.kind === 'note') return nested ? CHILD_W : NOTE_W;
  const longest = Math.max(bubble.title.length * 1.6, ...bubble.items.map((i) => i.text.length));
  const own = longest > 44 ? WIDE_W : nested ? CHILD_W : BUBBLE_W;
  const children = childrenOf(bubble);
  if (children.length === 0) return own;
  const rows = childRows(children).map(
    (row) =>
      row.reduce((sum, child) => sum + mapWidth(child, childrenOf, true), 0) +
      NEST_GAP * (row.length - 1),
  );
  return Math.max(own, Math.max(...rows) + NEST_PAD * 2);
};

/** A first guess, replaced by the measured height as soon as the bubble is on the page. */
export const estimateHeight = (bubble: Bubble, width: number, childrenOf: ChildrenOf = none): number => {
  const inner = width - 70;
  const linesFor = (text: string): number => Math.max(1, Math.ceil((text.length * 7.8) / inner));
  if (bubble.kind === 'note') return 40 + linesFor(bubble.title) * 21;
  const items = bubble.items.reduce((sum, item) => sum + 28 + linesFor(item.text) * 21, 0);
  const rows = childRows(childrenOf(bubble));
  const nested = rows.reduce(
    (sum, row) =>
      sum +
      NEST_GAP +
      Math.max(...row.map((child) => estimateHeight(child, mapWidth(child, childrenOf, true), childrenOf))),
    0,
  );
  return (bubble.title ? 44 : 0) + 44 + items + nested;
};

interface Row {
  bubbles: Bubble[];
  centre: number;
  band: number;
}

const sketchCentre = (b: Bubble): number => b.sketch.y + (b.sketch.h ?? 120) / 2;

const mapWidthOf = (bubble: Bubble, childrenOf: ChildrenOf): number => mapWidth(bubble, childrenOf);

const buildRows = (bubbles: Bubble[]): Row[] => {
  const groups = bubbles.filter((b) => b.kind === 'group');
  const notes = bubbles.filter((b) => b.kind === 'note');
  const rows: Row[] = [];
  for (const bubble of [...groups].sort((a, b) => sketchCentre(a) - sketchCentre(b))) {
    const c = sketchCentre(bubble);
    const row = rows.at(-1);
    if (row && c <= row.centre + row.band) {
      row.bubbles.push(bubble);
      row.centre += (c - row.centre) / row.bubbles.length;
      row.band = Math.max(row.band, (bubble.sketch.h ?? 120) / 2);
    } else {
      rows.push({ bubbles: [bubble], centre: c, band: (bubble.sketch.h ?? 120) / 2 });
    }
  }
  for (const note of notes) {
    if (rows.length === 0) {
      rows.push({ bubbles: [note], centre: sketchCentre(note), band: 80 });
      continue;
    }
    // A note joins the emptier of the two nearest rows, so it fills a gap instead of adding a row.
    const nearest = [...rows]
      .sort(
        (a, b) => Math.abs(a.centre - sketchCentre(note)) - Math.abs(b.centre - sketchCentre(note)),
      )
      .slice(0, 2)
      .sort((a, b) => a.bubbles.length - b.bubbles.length);
    nearest[0].bubbles.push(note);
  }
  for (const row of rows) row.bubbles.sort((a, b) => a.sketch.x - b.sketch.x);
  return rows;
};

export const layoutBubbles = (
  bubbles: Bubble[],
  heightOf: (bubble: Bubble, width: number) => number,
  childrenOf: ChildrenOf = none,
): Map<Id, Placement> => {
  const placements = new Map<Id, Placement>();
  const free = bubbles.filter((b) => !b.pinned);
  const mapWidth = (bubble: Bubble): number => mapWidthOf(bubble, childrenOf);
  const rows = buildRows(free);
  const widths = rows.map((row) =>
    row.bubbles.reduce((sum, b) => sum + mapWidth(b), (row.bubbles.length - 1) * COLUMN_GAP),
  );
  const widest = Math.max(0, ...widths);
  // Where across the sketch each bubble was drawn, from 0 at the far left to 1 at the far right.
  const centres = free.map((b) => b.sketch.x + b.sketch.w / 2);
  const left = Math.min(...centres);
  const span = Math.max(...centres) - left;
  const across = (b: Bubble): number => (span > 0 ? (b.sketch.x + b.sketch.w / 2 - left) / span : 0.5);
  let y = 0;
  rows.forEach((row, index) => {
    const spare = widest - widths[index];
    const count = row.bubbles.length;
    // Close to full rows stretch to line up with the widest row. Short rows keep the side of the
    // sketch they were drawn on, so a box drawn under another stays under it and arrows run straight.
    const stretch = count > 1 && spare <= COLUMN_GAP * (count - 1) * 1.5;
    const gap = stretch ? COLUMN_GAP + spare / (count - 1) : COLUMN_GAP;
    const xs: number[] = [];
    if (stretch) {
      let x = 0;
      for (const bubble of row.bubbles) {
        xs.push(x);
        x += mapWidth(bubble) + gap;
      }
    } else {
      // Aim each bubble at its drawn position, then push apart any that would touch.
      let next = 0;
      row.bubbles.forEach((bubble) => {
        const w = mapWidth(bubble);
        const aim = across(bubble) * widest - w / 2;
        const x = Math.max(next, Math.min(widest - w, aim));
        xs.push(x);
        next = x + w + COLUMN_GAP;
      });
      // Pushed past the right edge: walk back from the right, keeping the gaps.
      let limit = widest;
      for (let i = row.bubbles.length - 1; i >= 0; i -= 1) {
        const w = mapWidth(row.bubbles[i]);
        xs[i] = Math.max(0, Math.min(xs[i], limit - w));
        limit = xs[i] - COLUMN_GAP;
      }
    }
    let rowHeight = 0;
    row.bubbles.forEach((bubble, i) => {
      const w = mapWidth(bubble);
      placements.set(bubble.id, { x: Math.round(xs[i]), y: Math.round(y), w });
      rowHeight = Math.max(rowHeight, heightOf(bubble, w));
    });
    y += rowHeight + ROW_GAP;
  });
  return placements;
};

export interface Tail {
  side: 'top' | 'bottom' | 'left' | 'right';
  /** Distance along that side, from the note's own corner. */
  pos: number;
}

/** A speech bubble points at something, so a note's tail aims at the nearest group. */
export const noteTail = (note: Box, groups: Box[]): Tail => {
  const cx = note.x + note.w / 2;
  const cy = note.y + note.h / 2;
  let nearest: Box | null = null;
  let best = Infinity;
  for (const group of groups) {
    const d = Math.hypot(group.x + group.w / 2 - cx, group.y + group.h / 2 - cy);
    if (d < best) {
      best = d;
      nearest = group;
    }
  }
  if (!nearest) return { side: 'top', pos: Math.min(50, note.w / 2) };
  const gx = nearest.x + nearest.w / 2;
  const gy = nearest.y + nearest.h / 2;
  const clamp = (value: number, size: number): number =>
    Math.max(34, Math.min(size - 34, value));
  if (Math.abs(gy - cy) >= Math.abs(gx - cx) * 0.6) {
    return { side: gy < cy ? 'top' : 'bottom', pos: clamp(gx - note.x, note.w) };
  }
  return { side: gx < cx ? 'left' : 'right', pos: clamp(gy - note.y, note.h) };
};
