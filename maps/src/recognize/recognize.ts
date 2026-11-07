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

export interface OutGroup {
  box: Box;
  title: string;
  items: string[];
  strokeIds: Id[];
  textIds: Id[];
  color: InkColor;
  /** Pen marks inside the shape that may be handwriting. */
  inkIds: Id[];
}

export interface OutNote {
  box: Box;
  text: string;
  textIds: Id[];
}

export interface OutLink {
  from: number;
  to: number;
  strokeIds: Id[];
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
}

const NEAR_SHAPE = 46;
const JOIN_ENDS = 20;
const HEAD_RANGE = 36;
const MAX_TICK = 90;

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

const isClosed = (points: Float32Array, box: Box, length: number): boolean => {
  if (box.w < 48 || box.h < 36) return false;
  if (length < 1.5 * (box.w + box.h)) return false;
  return dist(first(points), last(points)) <= Math.max(36, 0.22 * length);
};

const cleanLine = (line: string): string => line.replace(/^\s*[-–—•*]\s+/, '').trim();

const linesOf = (texts: InText[]): string[] =>
  [...texts]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .flatMap((t) => t.text.split('\n'))
    .map(cleanLine)
    .filter(Boolean);

/** Boxes drawn with several strokes: straight lines whose ends all meet another line's end. */
const findJoinedShapes = (lines: InStroke[]): InStroke[][] => {
  const straight = lines.filter((s) => {
    const span = dist(first(s.points), last(s.points));
    return span > 30 && pathLength(s.points) <= span * 1.3;
  });
  const parent = straight.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    parent[i] = root;
    return root;
  };
  const degree = straight.map(() => [0, 0]);
  for (let a = 0; a < straight.length; a += 1) {
    for (let b = a + 1; b < straight.length; b += 1) {
      const ends = (s: InStroke) => [first(s.points), last(s.points)];
      ends(straight[a]).forEach((ea, ia) => {
        ends(straight[b]).forEach((eb, ib) => {
          if (dist(ea, eb) <= JOIN_ENDS) {
            degree[a][ia] += 1;
            degree[b][ib] += 1;
            parent[find(a)] = find(b);
          }
        });
      });
    }
  }
  const components = new Map<number, InStroke[]>();
  straight.forEach((s, i) => {
    const root = find(i);
    components.set(root, [...(components.get(root) ?? []), s]);
  });
  return [...components.entries()]
    .filter(([root, group]) => {
      if (group.length < 3) return false;
      return straight.every(
        (_, i) => find(i) !== root || (degree[i][0] > 0 && degree[i][1] > 0),
      );
    })
    .map(([, group]) => group);
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

const clusterFreeText = (texts: InText[]): InText[][] => {
  const clusters: InText[][] = [];
  const sorted = [...texts].sort((a, b) => a.y - b.y);
  for (const text of sorted) {
    const home = clusters.find((cluster) =>
      cluster.some((other) => {
        const verticalGap = text.y - (other.y + other.h);
        return verticalGap <= 40 && Math.abs(text.x - other.x) <= 120;
      }),
    );
    if (home) home.push(text);
    else clusters.push([text]);
  }
  return clusters;
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
  for (const group of findJoinedShapes(lines)) {
    group.forEach((s) => joined.add(s.id));
    shapes.push({
      strokeIds: group.map((s) => s.id),
      box: unionBox(group.map((s) => boxOf(s.points))),
      color: group[0].color,
      textIds: [],
      texts: [],
      inkIds: [],
    });
  }
  const openLines = lines.filter((s) => !joined.has(s.id));

  // The smallest shape around a text claims it, so a circle around a box does not steal its words.
  const bySize = [...shapes].sort((a, b) => a.box.w * a.box.h - b.box.w * b.box.h);
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

  // An empty ring around other shapes only emphasises them. It is not a group of its own.
  const live = shapes.filter((s) => {
    if (s.texts.length > 0) return true;
    return !shapes.some((other) => other !== s && insideBox(centre(other.box), s.box));
  });

  const nearestShape = (p: Point): Shape | null => {
    let best: Shape | null = null;
    let bestDistance = NEAR_SHAPE;
    for (const shape of live) {
      const d = distanceToBox(p, shape.box);
      if (d < bestDistance || (d === bestDistance && best && shape.box.w < best.box.w)) {
        best = shape;
        bestDistance = d;
      }
    }
    return best;
  };

  const usedTicks = new Set<Id>();
  const rawLinks: { from: Shape; to: Shape; strokeIds: Id[] }[] = [];
  const inkCandidates: InStroke[] = [];
  // Longest first, so a shaft claims its head before that head could pass for a short arrow.
  const shortestLast = [...openLines, ...ticks].sort(
    (a, b) => pathLength(b.points) - pathLength(a.points),
  );

  for (const stroke of [...arrows, ...shortestLast]) {
    if (usedTicks.has(stroke.id)) continue;
    const start = first(stroke.points);
    const end = last(stroke.points);
    const a = nearestShape(start);
    const b = nearestShape(end);
    if (!a || !b || a === b || dist(start, end) < 24) {
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
    parts.forEach((t) => usedTicks.add(t.id));
    rawLinks.push({
      from: reversed ? b : a,
      to: reversed ? a : b,
      strokeIds: [stroke.id, ...parts.map((t) => t.id)],
    });
  }

  let looseInk = 0;
  for (const stroke of inkCandidates) {
    if (usedTicks.has(stroke.id)) continue;
    const c = centre(boxOf(stroke.points));
    const home = bySize.find((s) => live.includes(s) && insideShape(c, s));
    if (home) home.inkIds.push(stroke.id);
    else if (pathLength(stroke.points) < MAX_TICK) looseInk += 1;
  }

  const groups: (OutGroup & { shape?: Shape })[] = live
    .filter((s) => s.texts.length > 0 || s.inkIds.length > 0 || s.box.w * s.box.h >= 80 * 60)
    .map((shape) => {
      const [title = '', ...items] = linesOf(shape.texts);
      return {
        shape,
        box: shape.box,
        title,
        items,
        strokeIds: shape.strokeIds,
        textIds: shape.textIds,
        color: shape.color,
        inkIds: shape.inkIds,
      };
    });

  const notes: OutNote[] = [];
  for (const cluster of clusterFreeText(freeTexts)) {
    const lines2 = linesOf(cluster);
    const box = unionBox(cluster);
    if (lines2.length >= 2) {
      const [title, ...items] = lines2;
      groups.push({
        box,
        title,
        items,
        strokeIds: [],
        textIds: cluster.map((t) => t.id),
        color: 'ink',
        inkIds: [],
      });
    } else if (lines2.length === 1) {
      notes.push({ box, text: lines2[0], textIds: cluster.map((t) => t.id) });
    }
  }

  // Reading order decides the colours, so the same sketch always looks the same.
  const rowOf = (b: Box): number => Math.round(centre(b).y / 180);
  const ordered = [...groups].sort(
    (a, b) => rowOf(a.box) - rowOf(b.box) || a.box.x - b.box.x,
  );

  const links: OutLink[] = rawLinks
    .map((link) => ({
      from: ordered.findIndex((g) => g.shape === link.from),
      to: ordered.findIndex((g) => g.shape === link.to),
      strokeIds: link.strokeIds,
    }))
    .filter((link) => link.from >= 0 && link.to >= 0);

  const inkCount = ordered.reduce((sum, g) => sum + g.inkIds.length, looseInk);

  return {
    groups: ordered.map(({ shape: _shape, ...group }) => group),
    notes,
    links,
    needsVision: inkCount >= 3,
  };
};
