// The instant local pass: strokes become shapes and arrows, and text joins the shape around it.
// Pure on purpose, so it runs in a worker and tests run without a browser.

import type { Box, Id, InkColor } from '../doc/types.ts';

export interface InStroke {
  id: Id;
  points: Float32Array;
  color: InkColor;
  arrow?: boolean;
}

export interface InText {
  id: Id;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
}

/** One line of a group. `mark` is the colour of a circle drawn around just this line. */
export interface OutItem {
  text: string;
  mark?: InkColor;
}

export interface OutGroup {
  box: Box;
  /** Empty when the lines read as a list of equals, so the AI names the group. */
  title: string;
  items: OutItem[];
  strokeIds: Id[];
  textIds: Id[];
  color: InkColor;
  /** Pen marks inside the shape that may be handwriting. */
  inkIds: Id[];
  /** Index of the group this one was drawn inside. */
  parent?: number;
}

export interface OutNote {
  box: Box;
  text: string;
  textIds: Id[];
}

export interface OutLink {
  from: number;
  to: number;
  /** Index into the items of `from`, when the arrow leaves one circled line. */
  fromItem?: number;
  /** Index into the items of `to`, when the arrow points at one circled line. */
  toItem?: number;
  strokeIds: Id[];
  color: InkColor;
}

export interface Recognition {
  groups: OutGroup[];
  notes: OutNote[];
  links: OutLink[];
  /** True when enough small marks exist that a model should look at an image of the sketch. */
  needsVision: boolean;
}

interface Point {
  x: number;
  y: number;
}

interface Shape {
  strokeIds: Id[];
  box: Box;
  /** Outline for inside tests. Missing for shapes built from several strokes. */
  outline?: Float32Array;
  color: InkColor;
  textIds: Id[];
  texts: InText[];
  inkIds: Id[];
  /** The smallest shape this one was drawn inside. */
  parent?: Shape;
  /** Merged into the one shape it was drawn around, as emphasis. */
  merged?: boolean;
  /** A circle around one line inside a bigger shape: that line, marked, not a group of its own. */
  ringOf?: Shape;
}

const NEAR_SHAPE = 46;
const JOIN_ENDS = 24;
const HEAD_RANGE = 36;
const MAX_TICK = 90;
/** Closer than this to a drawn border, an arrow end belongs to the box, not to a line in it. */
const BORDER = 16;

const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

const first = (p: Float32Array): Point => ({ x: p[0], y: p[1] });
const last = (p: Float32Array): Point => ({ x: p[p.length - 3], y: p[p.length - 2] });

const pathLength = (p: Float32Array): number => {
  let total = 0;
  for (let i = 3; i < p.length; i += 3) {
    total += Math.hypot(p[i] - p[i - 3], p[i + 1] - p[i - 2]);
  }
  return total;
};

const boxOf = (p: Float32Array): Box => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    minX = Math.min(minX, p[i]);
    maxX = Math.max(maxX, p[i]);
    minY = Math.min(minY, p[i + 1]);
    maxY = Math.max(maxY, p[i + 1]);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
};

const centre = (b: Box): Point => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

const insideBox = (p: Point, b: Box, slack = 0): boolean =>
  p.x >= b.x - slack && p.x <= b.x + b.w + slack && p.y >= b.y - slack && p.y <= b.y + b.h + slack;

const insideOutline = (pt: Point, outline: Float32Array): boolean => {
  let inside = false;
  const n = outline.length / 3;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const xi = outline[i * 3];
    const yi = outline[i * 3 + 1];
    const xj = outline[j * 3];
    const yj = outline[j * 3 + 1];
    if (yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
};

const insideShape = (pt: Point, shape: Shape): boolean =>
  insideBox(pt, shape.box) && (!shape.outline || insideOutline(pt, shape.outline));

const distanceToBox = (p: Point, b: Box): number => {
  const dx = Math.max(b.x - p.x, 0, p.x - (b.x + b.w));
  const dy = Math.max(b.y - p.y, 0, p.y - (b.y + b.h));
  return Math.hypot(dx, dy);
};

/** How far a point sits inside a box, from its nearest side. Zero or less outside it. */
const insetOf = (p: Point, b: Box): number =>
  Math.min(p.x - b.x, b.x + b.w - p.x, p.y - b.y, b.y + b.h - p.y);

const isClosed = (points: Float32Array, box: Box, length: number): boolean => {
  if (box.w < 48 || box.h < 36) return false;
  if (length < 1.5 * (box.w + box.h)) return false;
  return dist(first(points), last(points)) <= Math.max(36, 0.22 * length);
};

const cleanLine = (line: string): string => line.replace(/^\s*[-–—•*]\s+/, '').trim();

/**
 * Boxes drawn with several strokes of any form: sides, corners or a long hook, each end meeting
 * another stroke's end. Strokes left with a loose end are peeled off first, so an arrow drawn from
 * a corner does not stop the box around it from closing.
 */
const findJoinedShapes = (lines: InStroke[]): { strokes: InStroke[]; outline?: Float32Array }[] => {
  const ends = (s: InStroke): Point[] => [first(s.points), last(s.points)];
  const meets = (a: InStroke, b: InStroke): boolean =>
    ends(a).some((ea) => ends(b).some((eb) => dist(ea, eb) <= JOIN_ENDS));
  const endJoined = (s: InStroke, end: Point, pool: InStroke[]): boolean =>
    pool.some((o) => o !== s && ends(o).some((e) => dist(e, end) <= JOIN_ENDS));
  let pool = [...lines];
  for (let changed = true; changed; ) {
    const kept = pool.filter((s) => ends(s).every((end) => endJoined(s, end, pool)));
    changed = kept.length !== pool.length;
    pool = kept;
  }
  const seen = new Set<InStroke>();
  const shapes: { strokes: InStroke[]; outline?: Float32Array }[] = [];
  for (const start of pool) {
    if (seen.has(start)) continue;
    const component: InStroke[] = [];
    const queue = [start];
    seen.add(start);
    while (queue.length > 0) {
      const s = queue.pop() as InStroke;
      component.push(s);
      for (const other of pool) {
        if (!seen.has(other) && meets(s, other)) {
          seen.add(other);
          queue.push(other);
        }
      }
    }
    const box = unionBox(component.map((s) => boxOf(s.points)));
    if (component.length < 2 || box.w < 48 || box.h < 36) continue;
    shapes.push({ strokes: component, outline: chainOutline(component) });
  }
  return shapes;
};

/** The strokes of one drawn shape joined end to end, for inside tests. Missing if they branch. */
const chainOutline = (strokes: InStroke[]): Float32Array | undefined => {
  const [head, ...rest] = strokes;
  const parts: Float32Array[] = [head.points];
  let end = last(head.points);
  const left = new Set(rest);
  while (left.size > 0) {
    let next: { stroke: InStroke; reversed: boolean } | null = null;
    let best = JOIN_ENDS;
    for (const s of left) {
      const toStart = dist(end, first(s.points));
      const toEnd = dist(end, last(s.points));
      if (toStart <= best) {
        best = toStart;
        next = { stroke: s, reversed: false };
      }
      if (toEnd <= best) {
        best = toEnd;
        next = { stroke: s, reversed: true };
      }
    }
    if (!next) return undefined;
    left.delete(next.stroke);
    const points = next.reversed ? reversePoints(next.stroke.points) : next.stroke.points;
    parts.push(points);
    end = last(points);
  }
  const outline = new Float32Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    outline.set(part, offset);
    offset += part.length;
  }
  return outline;
};

const reversePoints = (p: Float32Array): Float32Array => {
  const out = new Float32Array(p.length);
  const n = p.length / 3;
  for (let i = 0; i < n; i += 1) out.set(p.subarray((n - 1 - i) * 3, (n - i) * 3), i * 3);
  return out;
};

const unionBox = (boxes: Box[]): Box => {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    w: Math.max(...boxes.map((b) => b.x + b.w)) - x,
    h: Math.max(...boxes.map((b) => b.y + b.h)) - y,
  };
};

const lineHeight = (text: InText): number => text.h / Math.max(1, text.text.split('\n').length);

const clusterFreeText = (texts: InText[]): InText[][] => {
  const clusters: InText[][] = [];
  const sorted = [...texts].sort((a, b) => a.y - b.y);
  for (const text of sorted) {
    const home = clusters.find((cluster) =>
      cluster.some((other) => {
        const verticalGap = text.y - (other.y + other.h);
        // Lines placed by hand drift, so the gap allowed grows with the size of the text.
        return verticalGap <= Math.max(40, 2 * lineHeight(other)) && Math.abs(text.x - other.x) <= 120;
      }),
    );
    if (home) home.push(text);
    else clusters.push([text]);
  }
  return clusters;
};

const PROBE = 14;
const area = (b: Box): number => b.w * b.h;

const overlapArea = (a: Box, b: Box): number =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** Drawn inside: its middle is inside the outline, and nearly all of it is inside the box. */
const drawnInside = (inner: Shape, outer: Shape): boolean =>
  area(outer.box) > area(inner.box) &&
  insideShape(centre(inner.box), outer) &&
  overlapArea(inner.box, outer.box) >= 0.8 * area(inner.box);

const unit = (from: Point, to: Point): Point => {
  const length = dist(from, to) || 1;
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
};

/** The point about `distance` along the stroke from one end, for the direction it leaves in. */
const pointAlong = (p: Float32Array, distance: number, fromEnd: boolean): Point => {
  const n = p.length / 3;
  let travelled = 0;
  for (let k = 1; k < n; k += 1) {
    const i = fromEnd ? n - 1 - k : k;
    const j = fromEnd ? i + 1 : i - 1;
    travelled += Math.hypot(p[i * 3] - p[j * 3], p[i * 3 + 1] - p[j * 3 + 1]);
    if (travelled >= distance) return { x: p[i * 3], y: p[i * 3 + 1] };
  }
  return fromEnd ? first(p) : last(p);
};

interface Entry {
  /** The typed text this came from, so an arrow drawn from one of its lines can find that line. */
  id: Id;
  lines: string[];
  /** For each line kept, its row in the typed text. Blank rows are dropped. */
  rows: number[];
  x: number;
  y: number;
  h: number;
  mark?: InkColor;
}

/** One line of a group while it is being read, with the typed row it came from. */
interface Line extends OutItem {
  source: string;
}

const sourceOf = (id: Id, row: number): string => `${id}:${row}`;

const entryOf = (text: InText, mark?: InkColor): Entry => {
  const lines: string[] = [];
  const rows: number[] = [];
  text.text.split('\n').forEach((raw, row) => {
    const line = cleanLine(raw);
    if (line) {
      lines.push(line);
      rows.push(row);
    }
  });
  return { id: text.id, lines, rows, x: text.x, y: text.y, h: text.h, mark };
};

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

/**
 * Whether the first line heads the rest. One block of typed lines reads as a title and its list,
 * the way the example is written. Separately typed lines read as equals, unless the first stands
 * apart: a colon, a clear step to the left, a clear gap below it, or a whole typed list under it. Equals get no title here,
 * so the AI names the group instead of one line being promoted by accident.
 */
const splitTitle = (unsorted: Entry[]): { title: string; titleSource?: string; items: Line[] } => {
  const entries = unsorted
    .filter((e) => e.lines.length > 0)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const asItems = (list: Entry[]): Line[] =>
    list.flatMap((e) =>
      e.lines.map((text, k) => {
        const source = sourceOf(e.id, e.rows[k]);
        return e.mark ? { text, mark: e.mark, source } : { text, source };
      }),
    );
  if (entries.length === 0) return { title: '', items: [] };
  const [head, ...rest] = entries;
  const titled = (items: Line[]): { title: string; titleSource: string; items: Line[] } => ({
    title: head.lines[0].replace(/:\s*$/, ''),
    titleSource: sourceOf(head.id, head.rows[0]),
    items,
  });
  const headBody = { ...head, lines: head.lines.slice(1), rows: head.rows.slice(1), mark: undefined };
  if (entries.length === 1) return titled(asItems([headBody]));
  if (head.mark) return { title: '', items: asItems(entries) };
  if (head.lines.length > 1) return titled(asItems([{ ...headBody, mark: head.mark }, ...rest]));
  const gaps = entries.slice(1).map((e, i) => e.y - (entries[i].y + entries[i].h));
  // Typed lines are placed by hand, so only a clear step to the left counts as a heading.
  const outdented = head.x <= Math.min(...rest.map((e) => e.x)) - 16;
  const standsApart =
    head.lines[0].endsWith(':') ||
    outdented ||
    (rest.length === 1 && rest[0].lines.length > 1) ||
    // A gap only counts when it is clearly wider than a line. Unsure cases stay equals, because
    // the AI can still promote the first line, while a wrong title here is a line lost.
    (gaps.length >= 2 &&
      gaps[0] >= Math.max(20, 1.5 * (head.h / head.lines.length), 1.8 * median(gaps.slice(1))));
  return standsApart ? titled(asItems(rest)) : { title: '', items: asItems(entries) };
};

export const recognize = (strokes: InStroke[], texts: InText[]): Recognition => {
  const shapes: Shape[] = [];
  const lines: InStroke[] = [];
  const ticks: InStroke[] = [];
  const arrows: InStroke[] = [];

  for (const stroke of strokes) {
    if (stroke.points.length < 6) continue;
    if (stroke.arrow) {
      arrows.push(stroke);
      continue;
    }
    const box = boxOf(stroke.points);
    const length = pathLength(stroke.points);
    if (isClosed(stroke.points, box, length)) {
      shapes.push({
        strokeIds: [stroke.id],
        box,
        outline: stroke.points,
        color: stroke.color,
        textIds: [],
        texts: [],
        inkIds: [],
      });
    } else if (length < MAX_TICK) {
      ticks.push(stroke);
    } else {
      lines.push(stroke);
    }
  }

  const joined = new Set<Id>();
  for (const { strokes: group, outline } of findJoinedShapes(lines)) {
    group.forEach((s) => joined.add(s.id));
    shapes.push({
      strokeIds: group.map((s) => s.id),
      box: unionBox(group.map((s) => boxOf(s.points))),
      outline,
      color: group[0].color,
      textIds: [],
      texts: [],
      inkIds: [],
    });
  }
  const openLines = lines.filter((s) => !joined.has(s.id));

  // Smallest first, so the first shape found around something is the one it was drawn in.
  const bySize = [...shapes].sort((a, b) => area(a.box) - area(b.box));
  for (const shape of shapes) {
    shape.parent = bySize.find((other) => other !== shape && drawnInside(shape, other));
  }

  const freeTexts: InText[] = [];
  for (const text of texts) {
    const home = bySize.find((s) => insideShape(centre(text), s));
    if (home) {
      home.texts.push(text);
      home.textIds.push(text.id);
    } else {
      freeTexts.push(text);
    }
  }

  const childrenOf = (shape: Shape): Shape[] =>
    shapes.filter((s) => !s.merged && s.parent === shape);

  // A wordless outline around exactly one shape only emphasises it, like a second circle.
  for (const shape of bySize) {
    const children = childrenOf(shape);
    if (shape.texts.length > 0 || children.length !== 1) continue;
    const [child] = children;
    shape.merged = true;
    child.parent = shape.parent;
    child.strokeIds.push(...shape.strokeIds);
  }

  // A circle drawn snugly around one line inside a bigger shape marks that line, and the line stays
  // in its group. A roomy box around one line is a box of its own, drawn inside the bigger one.
  const hugs = (shape: Shape, text: InText): boolean =>
    shape.box.h <= Math.max(3.5 * text.h, text.h + 70) && shape.box.w <= text.w + 160;
  for (const shape of shapes) {
    if (shape.merged || !shape.parent || childrenOf(shape).length > 0) continue;
    const [only] = shape.texts;
    if (shape.texts.length === 1 && entryOf(only).lines.length === 1 && hugs(shape, only)) {
      shape.ringOf = shape.parent;
    }
  }

  const live = shapes.filter((s) => !s.merged && !s.ringOf);
  const ringsIn = (shape: Shape): Shape[] => shapes.filter((s) => s.ringOf === shape);

  // Words typed outside every shape are things too: an arrow can start or end at them.
  const words: Shape[] = clusterFreeText(freeTexts).map((cluster) => ({
    strokeIds: [],
    box: unionBox(cluster),
    color: 'ink',
    textIds: cluster.map((t) => t.id),
    texts: cluster,
    inkIds: [],
  }));

  // An arrow end belongs to the innermost thing it is drawn from: a circled line, then the
  // smallest shape or typed word. The test point sits a little back along the arrow, inside what it
  // leaves, so an arrow starting where two circles touch goes with the circle it actually leaves.
  const candidates = [...live, ...shapes.filter((s) => s.ringOf), ...words].sort(
    (a, b) => area(a.box) - area(b.box),
  );
  const anchorAt = (point: Point, inward: Point): Shape | null => {
    const probe = { x: point.x + inward.x * PROBE, y: point.y + inward.y * PROBE };
    const inside = candidates.find((s) => insideShape(probe, s));
    if (inside) return inside;
    let best: Shape | null = null;
    let bestDistance = NEAR_SHAPE;
    for (const shape of candidates) {
      const d = distanceToBox(point, shape.box);
      if (d < bestDistance) {
        best = shape;
        bestDistance = d;
      }
    }
    return best;
  };

  // An arrow drawn from right at a typed line comes from that line, the way a circle would say,
  // so a box of names can point each name somewhere else. Half a line of slack either way, except
  // at the drawn border: an arrow leaving from the edge of a box comes from the whole box.
  const lineAt = (shape: Shape, point: Point): string | undefined => {
    if (shape.ringOf) return undefined;
    const atBorder = shape.strokeIds.length > 0 && insetOf(point, shape.box) < BORDER;
    let best: string | undefined;
    let bestDistance = Infinity;
    for (const text of shape.texts) {
      const rows = Math.max(1, text.text.split('\n').length);
      const height = text.h / rows;
      const d = distanceToBox(point, text);
      if (d > (atBorder ? 0 : height / 2) || d >= bestDistance) continue;
      const row = Math.min(rows - 1, Math.max(0, Math.floor((point.y - text.y) / height)));
      best = sourceOf(text.id, row);
      bestDistance = d;
    }
    return best;
  };

  const groupOf = (shape: Shape): Shape => shape.ringOf ?? shape;
  const sameEnd = (a: Shape, b: Shape): boolean =>
    a === b || (groupOf(a) === groupOf(b) && !(a.ringOf && b.ringOf));

  interface RawLink {
    from: Shape;
    to: Shape;
    fromLine?: string;
    toLine?: string;
    strokeIds: Id[];
    color: InkColor;
  }
  const usedTicks = new Set<Id>();
  const rawLinks: RawLink[] = [];
  const inkCandidates: InStroke[] = [];
  // Longest first, so a shaft claims its head before that head could pass for a short arrow.
  const shortestLast = [...openLines, ...ticks].sort(
    (a, b) => pathLength(b.points) - pathLength(a.points),
  );

  for (const stroke of [...arrows, ...shortestLast]) {
    if (usedTicks.has(stroke.id)) continue;
    const start = first(stroke.points);
    const end = last(stroke.points);
    if (dist(start, end) < 24) {
      if (!stroke.arrow) inkCandidates.push(stroke);
      continue;
    }
    const leaving = unit(start, pointAlong(stroke.points, 20, false));
    const arriving = unit(pointAlong(stroke.points, 20, true), end);
    const a = anchorAt(start, { x: -leaving.x, y: -leaving.y });
    const b = anchorAt(end, arriving);
    const aLine = a ? lineAt(a, start) : undefined;
    const bLine = b ? lineAt(b, end) : undefined;
    // Inside one box, only an arrow drawn with the arrow tool between two of its lines is a link.
    // A pen mark there is more likely an underline or handwriting.
    const betweenLines = a === b && stroke.arrow === true && aLine && bLine && aLine !== bLine;
    if (!a || !b || (sameEnd(a, b) && !betweenLines)) {
      if (!stroke.arrow) inkCandidates.push(stroke);
      continue;
    }
    usedTicks.add(stroke.id);
    const heads = ticks.filter(
      (t) => !usedTicks.has(t.id) && dist(centre(boxOf(t.points)), end) <= HEAD_RANGE,
    );
    const tails = ticks.filter(
      (t) => !usedTicks.has(t.id) && dist(centre(boxOf(t.points)), start) <= HEAD_RANGE,
    );
    const reversed = !stroke.arrow && heads.length === 0 && tails.length > 0;
    const parts = reversed ? tails : heads;
    // A plain pen line touching a typed word is as likely an underline as a link, so it needs a head.
    if (!stroke.arrow && parts.length === 0 && (words.includes(a) || words.includes(b))) {
      usedTicks.delete(stroke.id);
      inkCandidates.push(stroke);
      continue;
    }
    parts.forEach((t) => usedTicks.add(t.id));
    rawLinks.push({
      from: reversed ? b : a,
      to: reversed ? a : b,
      fromLine: reversed ? bLine : aLine,
      toLine: reversed ? aLine : bLine,
      strokeIds: [stroke.id, ...parts.map((t) => t.id)],
      color: stroke.color,
    });
  }

  let looseInk = 0;
  const liveBySize = bySize.filter((s) => live.includes(s));
  for (const stroke of inkCandidates) {
    if (usedTicks.has(stroke.id)) continue;
    const c = centre(boxOf(stroke.points));
    const home = liveBySize.find((s) => insideShape(c, s));
    if (home) home.inkIds.push(stroke.id);
    else if (pathLength(stroke.points) < MAX_TICK) looseInk += 1;
  }

  interface Built extends Omit<OutGroup, 'parent' | 'items'> {
    shape: Shape;
    items: Line[];
    titleSource?: string;
    /** The circles whose lines became items, in item order, so arrows can find their line. */
    itemRings: (Shape | undefined)[];
  }

  const groups: Built[] = live
    .filter(
      (s) =>
        s.texts.length > 0 ||
        s.inkIds.length > 0 ||
        ringsIn(s).length > 0 ||
        childrenOf(s).length > 0 ||
        area(s.box) >= 80 * 60,
    )
    .map((shape) => {
      const rings = ringsIn(shape);
      const ringEntries = rings.map((ring) => ({ ring, entry: entryOf(ring.texts[0], ring.color) }));
      const { title, titleSource, items } = splitTitle([
        ...shape.texts.map((t) => entryOf(t)),
        ...ringEntries.map((r) => r.entry),
      ]);
      // Items keep reading order, so each ring finds its own line by text and mark.
      const taken = new Set<Shape>();
      const itemRings = items.map((item) => {
        if (!item.mark) return undefined;
        const match = ringEntries.find(
          (r) => !taken.has(r.ring) && r.entry.mark === item.mark && r.entry.lines[0] === item.text,
        );
        if (match) taken.add(match.ring);
        return match?.ring;
      });
      return {
        shape,
        box: shape.box,
        title,
        titleSource,
        items,
        itemRings,
        strokeIds: [...shape.strokeIds, ...rings.flatMap((r) => r.strokeIds)],
        textIds: [...shape.textIds, ...rings.flatMap((r) => r.textIds)],
        color: shape.color,
        inkIds: shape.inkIds,
      };
    });

  // A typed word an arrow touches is a thing on the map, even alone. Untouched, a lone line is a note.
  const linked = new Set(rawLinks.flatMap((l) => [l.from, l.to]));
  const notes: OutNote[] = [];
  for (const word of words) {
    const { title, titleSource, items } = splitTitle(word.texts.map((t) => entryOf(t)));
    if (items.length > 0 || (title && linked.has(word))) {
      groups.push({
        shape: word,
        box: word.box,
        title,
        titleSource,
        items,
        itemRings: items.map(() => undefined),
        strokeIds: [],
        textIds: word.textIds,
        color: 'ink',
        inkIds: [],
      });
    } else if (title) {
      notes.push({ box: word.box, text: title, textIds: word.textIds });
    }
  }

  // Reading order decides the colours, so the same sketch always looks the same.
  const rowOf = (b: Box): number => Math.round(centre(b).y / 180);
  const ordered = [...groups].sort(
    (a, b) => rowOf(a.box) - rowOf(b.box) || a.box.x - b.box.x,
  );
  const indexOf = (shape: Shape | undefined): number =>
    shape ? ordered.findIndex((g) => g.shape === shape) : -1;

  const endOf = (shape: Shape, line: string | undefined): { group: number; item?: number } => {
    if (!shape.ringOf) {
      const group = indexOf(shape);
      // A line that became the title stands for the whole box.
      const item = group >= 0 && line ? ordered[group].items.findIndex((i) => i.source === line) : -1;
      return item >= 0 ? { group, item } : { group };
    }
    const group = indexOf(shape.ringOf);
    const item = group >= 0 ? ordered[group].itemRings.indexOf(shape) : -1;
    return item >= 0 ? { group, item } : { group };
  };

  const links: OutLink[] = rawLinks
    .map((link) => {
      const from = endOf(link.from, link.fromLine);
      const to = endOf(link.to, link.toLine);
      const out: OutLink = {
        from: from.group,
        to: to.group,
        strokeIds: link.strokeIds,
        color: link.color,
      };
      if (from.item !== undefined) out.fromItem = from.item;
      if (to.item !== undefined) out.toItem = to.item;
      return out;
    })
    // Two lines that read as one end, such as a title and the box, make no arrow.
    .filter((link) => {
      if (link.from < 0 || link.to < 0) return false;
      if (link.from !== link.to) return true;
      return link.fromItem !== undefined && link.toItem !== undefined && link.fromItem !== link.toItem;
    });

  const inkCount = ordered.reduce((sum, g) => sum + g.inkIds.length, looseInk);

  return {
    groups: ordered.map(({ shape, itemRings: _rings, titleSource: _title, items, ...rest }) => {
      const group: OutGroup = {
        ...rest,
        items: items.map(({ source: _source, ...item }) => item),
      };
      let parent = shape.parent;
      while (parent && indexOf(parent) < 0) parent = parent.parent;
      const index = indexOf(parent);
      return index >= 0 ? { ...group, parent: index } : group;
    }),
    notes,
    links,
    needsVision: inkCount >= 3,
  };
};
