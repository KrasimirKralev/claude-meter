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

/** An arrow as the layout sees it: between two bubbles that stand on their own on the map. */
export interface LayoutLink {
  from: Id;
  to: Id;
  /** The line of `from` it leaves from. */
  fromItem?: Id;
}

/** Room between a bubble and the column its lines point at: the turns, then the arrow's name. */
export const FAN_GAP = 220;
const FAN_ROW_GAP = 28;

interface Fan {
  source: Bubble;
  /** In the order of the lines they are pointed at from. */
  targets: Bubble[];
}

/**
 * A bubble whose lines point at different things, such as a list of people each with their own
 * facts, reads best as that list with what each line points at in one column beside it, in line
 * order. Only things that nothing else claims, and that do not fan out themselves, join a column.
 */
const findFans = (free: Bubble[], links: LayoutLink[]): Fan[] => {
  const byId = new Map(free.map((b) => [b.id, b]));
  const lineLinks = (source: Bubble): LayoutLink[] =>
    links.filter(
      (l) =>
        l.from === source.id &&
        l.to !== source.id &&
        byId.has(l.to) &&
        source.items.some((i) => i.id === l.fromItem),
    );
  const fansOut = (b: Bubble): boolean =>
    b.kind === 'group' && new Set(lineLinks(b).map((l) => l.fromItem)).size >= 2;
  const claimed = new Set<Id>();
  const fans: Fan[] = [];
  const reading = [...free].sort(
    (a, b) => sketchCentre(a) - sketchCentre(b) || a.sketch.x - b.sketch.x,
  );
  for (const source of reading) {
    if (claimed.has(source.id) || !fansOut(source)) continue;
    const line = (l: LayoutLink): number => source.items.findIndex((i) => i.id === l.fromItem);
    const targets: Bubble[] = [];
    const ordered = lineLinks(source).sort(
      (a, b) =>
        line(a) - line(b) ||
        sketchCentre(byId.get(a.to) as Bubble) - sketchCentre(byId.get(b.to) as Bubble),
    );
    for (const link of ordered) {
      const target = byId.get(link.to) as Bubble;
      if (target.pinned || claimed.has(target.id) || fansOut(target) || targets.includes(target)) continue;
      targets.push(target);
    }
    if (targets.length < 2) continue;
    claimed.add(source.id);
    targets.forEach((t) => claimed.add(t.id));
    fans.push({ source, targets });
  }
  return fans;
};

export const layoutBubbles = (
  bubbles: Bubble[],
  heightOf: (bubble: Bubble, width: number) => number,
  childrenOf: ChildrenOf = none,
  links: LayoutLink[] = [],
): Map<Id, Placement> => {
  const placements = new Map<Id, Placement>();
  const free = bubbles.filter((b) => !b.pinned);
  const mapWidth = (bubble: Bubble): number => mapWidthOf(bubble, childrenOf);
  const fans = findFans(free, links);
  const fanOf = new Map(fans.map((fan) => [fan.source.id, fan]));
  const inColumn = new Set(fans.flatMap((fan) => fan.targets.map((t) => t.id)));
  // A fan takes part in the rows as one block: the bubble, the gap, and its column.
  const columnWidth = (fan: Fan): number => Math.max(...fan.targets.map(mapWidth));
  const columnHeight = (fan: Fan): number =>
    fan.targets.reduce((sum, t) => sum + heightOf(t, mapWidth(t)), 0) +
    FAN_ROW_GAP * (fan.targets.length - 1);
  const unitWidth = (bubble: Bubble): number => {
    const fan = fanOf.get(bubble.id);
    return fan ? mapWidth(bubble) + FAN_GAP + columnWidth(fan) : mapWidth(bubble);
  };
  const unitHeight = (bubble: Bubble): number => {
    const own = heightOf(bubble, mapWidth(bubble));
    const fan = fanOf.get(bubble.id);
    return fan ? Math.max(own, columnHeight(fan)) : own;
  };
  const rows = buildRows(free.filter((b) => !inColumn.has(b.id)));
  const widths = rows.map((row) =>
    row.bubbles.reduce((sum, b) => sum + unitWidth(b), (row.bubbles.length - 1) * COLUMN_GAP),
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
        x += unitWidth(bubble) + gap;
      }
    } else {
      // Aim each bubble at its drawn position, then push apart any that would touch.
      let next = 0;
      row.bubbles.forEach((bubble) => {
        const w = unitWidth(bubble);
        const aim = across(bubble) * widest - w / 2;
        const x = Math.max(next, Math.min(widest - w, aim));
        xs.push(x);
        next = x + w + COLUMN_GAP;
      });
      // Pushed past the right edge: walk back from the right, keeping the gaps.
      let limit = widest;
      for (let i = row.bubbles.length - 1; i >= 0; i -= 1) {
        const w = unitWidth(row.bubbles[i]);
        xs[i] = Math.max(0, Math.min(xs[i], limit - w));
        limit = xs[i] - COLUMN_GAP;
      }
    }
    let rowHeight = 0;
    row.bubbles.forEach((bubble, i) => {
      const w = mapWidth(bubble);
      const height = unitHeight(bubble);
      const fan = fanOf.get(bubble.id);
      if (!fan) {
        placements.set(bubble.id, { x: Math.round(xs[i]), y: Math.round(y), w });
      } else {
        // The list sits level with the middle of its column, so its arrows fan out both ways.
        const own = heightOf(bubble, w);
        placements.set(bubble.id, { x: Math.round(xs[i]), y: Math.round(y + (height - own) / 2), w });
        const columnX = xs[i] + w + FAN_GAP;
        let ty = y + (height - columnHeight(fan)) / 2;
        for (const target of fan.targets) {
          const tw = mapWidth(target);
          placements.set(target.id, { x: Math.round(columnX), y: Math.round(ty), w: tw });
          ty += heightOf(target, tw) + FAN_ROW_GAP;
        }
      }
      rowHeight = Math.max(rowHeight, height);
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
