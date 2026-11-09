// Arrow routing for the finished map: straight whenever two bubbles face each other with nothing
// between them, and around whatever is in the way otherwise.

import type { Box } from '../doc/types.ts';

const GAP = 7;
const MIN_OVERLAP = 28;
const TITLE_LINE = 36;
const CORNER = 16;
const CLEARANCE = 30;

export interface Route {
  d: string;
  mid: { x: number; y: number };
}

type Point = [number, number];

const overlap = (a0: number, a1: number, b0: number, b1: number): [number, number] => [
  Math.max(a0, b0),
  Math.min(a1, b1),
];

/** A path through the points with rounded corners. It always ends on a straight run. */
const roundedPath = (points: Point[]): string => {
  const [[startX, startY]] = points;
  let d = `M${startX} ${startY}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const [px, py] = points[i - 1];
    const [x, y] = points[i];
    const [nx, ny] = points[i + 1];
    const radius = Math.min(
      CORNER,
      Math.hypot(x - px, y - py) / 2,
      Math.hypot(nx - x, ny - y) / 2,
    );
    const toward = (fromX: number, fromY: number): Point => {
      const length = Math.hypot(fromX - x, fromY - y) || 1;
      return [x + ((fromX - x) / length) * radius, y + ((fromY - y) / length) * radius];
    };
    const [inX, inY] = toward(px, py);
    const [outX, outY] = toward(nx, ny);
    d += `L${inX} ${inY}Q${x} ${y} ${outX} ${outY}`;
  }
  const [endX, endY] = points[points.length - 1];
  return `${d}L${endX} ${endY}`;
};

const hitsAcross = (y: number, x0: number, x1: number, boxes: Box[]): boolean =>
  boxes.some(
    (b) =>
      y >= b.y - GAP &&
      y <= b.y + b.h + GAP &&
      Math.max(x0, x1) >= b.x - GAP &&
      Math.min(x0, x1) <= b.x + b.w + GAP,
  );

const hitsDown = (x: number, y0: number, y1: number, boxes: Box[]): boolean =>
  boxes.some(
    (b) =>
      x >= b.x - GAP &&
      x <= b.x + b.w + GAP &&
      Math.max(y0, y1) >= b.y - GAP &&
      Math.min(y0, y1) <= b.y + b.h + GAP,
  );

/** Whether any straight run of a route passes through one of the boxes. */
const pathHits = (points: Point[], boxes: Box[]): boolean =>
  points.slice(1).some(([x1, y1], i) => {
    const [x0, y0] = points[i];
    if (y0 === y1) return hitsAcross(y0, x0, x1, boxes);
    if (x0 === x1) return hitsDown(x0, y0, y1, boxes);
    return false;
  });

export const routeLink = (a: Box, b: Box, obstacles: Box[] = []): Route => {
  const [y0, y1] = overlap(a.y, a.y + a.h, b.y, b.y + b.h);
  const [x0, x1] = overlap(a.x, a.x + a.w, b.x, b.x + b.w);

  if (y1 - y0 >= MIN_OVERLAP && (a.x + a.w <= b.x || b.x + b.w <= a.x)) {
    const y = Math.min(y0 + TITLE_LINE, y1 - 10);
    const rightward = a.x + a.w <= b.x;
    const from = rightward ? a.x + a.w + GAP : a.x - GAP;
    const to = rightward ? b.x - GAP : b.x + b.w + GAP;
    if (!hitsAcross(y, from, to, obstacles)) {
      return { d: `M${from} ${y}L${to} ${y}`, mid: { x: (from + to) / 2, y } };
    }
    // Something sits between them, so the arrow passes underneath it.
    const between = obstacles.filter(
      (o) =>
        Math.max(from, to) >= o.x &&
        Math.min(from, to) <= o.x + o.w &&
        o.y + o.h >= y0 &&
        o.y <= y1,
    );
    const floor =
      Math.max(a.y + a.h, b.y + b.h, ...between.map((o) => o.y + o.h)) + CLEARANCE;
    const ceiling = Math.min(a.y, b.y, ...between.map((o) => o.y)) - CLEARANCE;
    // Centres belong to straight arrows. These ends sit off-centre, toward each other, so a routed
    // arrow can never merge with a straight one into something that reads as one line.
    const ax = a.x + a.w * (rightward ? 0.75 : 0.25);
    const bx = b.x + b.w * (rightward ? 0.25 : 0.75);
    const under: Point[] = [
      [ax, a.y + a.h + GAP],
      [ax, floor],
      [bx, floor],
      [bx, b.y + b.h + GAP],
    ];
    const over: Point[] = [
      [ax, a.y - GAP],
      [ax, ceiling],
      [bx, ceiling],
      [bx, b.y - GAP],
    ];
    // Underneath reads best, unless another bubble sits on that path and would hide it.
    const points = pathHits(under, obstacles) && !pathHits(over, obstacles) ? over : under;
    return { d: roundedPath(points), mid: { x: (ax + bx) / 2, y: points[1][1] } };
  }

  if (x1 - x0 >= MIN_OVERLAP && (a.y + a.h <= b.y || b.y + b.h <= a.y)) {
    const centre = a.x + a.w / 2;
    const x = centre >= x0 + 10 && centre <= x1 - 10 ? centre : (x0 + x1) / 2;
    const downward = a.y + a.h <= b.y;
    const from = downward ? a.y + a.h + GAP : a.y - GAP;
    const to = downward ? b.y - GAP : b.y + b.h + GAP;
    if (!hitsDown(x, from, to, obstacles)) {
      return { d: `M${x} ${from}L${x} ${to}`, mid: { x, y: (from + to) / 2 } };
    }
    const inBand = obstacles.filter(
      (o) => Math.max(from, to) >= o.y && Math.min(from, to) <= o.y + o.h,
    );
    const rightWall = Math.max(a.x + a.w, b.x + b.w, ...inBand.map((o) => o.x + o.w)) + CLEARANCE;
    const leftWall = Math.min(a.x, b.x, ...inBand.map((o) => o.x)) - CLEARANCE;
    const ay = a.y + a.h * (downward ? 0.75 : 0.25);
    const by = b.y + b.h * (downward ? 0.25 : 0.75);
    const right: Point[] = [
      [a.x + a.w + GAP, ay],
      [rightWall, ay],
      [rightWall, by],
      [b.x + b.w + GAP, by],
    ];
    const left: Point[] = [
      [a.x - GAP, ay],
      [leftWall, ay],
      [leftWall, by],
      [b.x - GAP, by],
    ];
    // The right side reads best, unless another bubble sits on that path and would hide it.
    const points = pathHits(right, obstacles) && !pathHits(left, obstacles) ? left : right;
    return { d: roundedPath(points), mid: { x: points[1][0], y: (ay + by) / 2 } };
  }

  // Neither faces the other: one rounded elbow, leaving from the bottom or top of the first bubble.
  const downward = a.y + a.h / 2 < b.y + b.h / 2;
  const rightward = a.x + a.w / 2 < b.x + b.w / 2;
  const startX = a.x + a.w * (rightward ? 0.75 : 0.25);
  const startY = downward ? a.y + a.h + GAP : a.y - GAP;
  const endX = rightward ? b.x - GAP : b.x + b.w + GAP;
  const endY = b.y + Math.min(TITLE_LINE, b.h / 2);
  return {
    d: roundedPath([
      [startX, startY],
      [startX, endY],
      [endX, endY],
    ]),
    mid: { x: startX, y: (startY + endY) / 2 },
  };
};

const clamp = (value: number, low: number, high: number): number =>
  low > high ? (low + high) / 2 : Math.max(low, Math.min(high, value));

/** The label of a routed arrow sits on its longest straight run. */
const midOf = (points: Point[]): { x: number; y: number } => {
  let best = 0;
  let mid = { x: points[0][0], y: points[0][1] };
  for (let i = 1; i < points.length; i += 1) {
    const [ax, ay] = points[i - 1];
    const [bx, by] = points[i];
    const length = Math.hypot(bx - ax, by - ay);
    if (length > best) {
      best = length;
      mid = { x: (ax + bx) / 2, y: (ay + by) / 2 };
    }
  }
  return mid;
};

/**
 * An arrow that leaves one line of a bubble: out of the bubble's side at that line's height, then
 * across to the target. Straight when the target is level with the line.
 */
const fromLine = (a: Box, lineY: number, b: Box): Point[] => {
  const leftOf = b.x + b.w <= a.x;
  const rightOf = b.x >= a.x + a.w;
  if (leftOf || rightOf) {
    const startX = rightOf ? a.x + a.w + GAP : a.x - GAP;
    const endX = rightOf ? b.x - GAP : b.x + b.w + GAP;
    const endY = b.h < 40 ? b.y + b.h / 2 : clamp(lineY, b.y + 20, b.y + b.h - 20);
    if (Math.abs(endY - lineY) < 4) return [[startX, lineY], [endX, lineY]];
    const midX = (startX + endX) / 2;
    return [[startX, lineY], [midX, lineY], [midX, endY], [endX, endY]];
  }
  // The target sits above or below: leave by the nearer side, then come down onto its top.
  const below = b.y + b.h / 2 > lineY;
  const toRight = b.x + b.w / 2 >= a.x + a.w / 2;
  const startX = toRight ? a.x + a.w + GAP : a.x - GAP;
  const columnX = toRight ? a.x + a.w + CLEARANCE : a.x - CLEARANCE;
  const endY = below ? b.y - GAP : b.y + b.h + GAP;
  const gapY = below ? Math.max(a.y + a.h, lineY) : Math.min(a.y, lineY);
  const turnY = (gapY + endY) / 2;
  const endX = clamp(b.x + b.w / 2, b.x + 24, b.x + b.w - 24);
  return [[startX, lineY], [columnX, lineY], [columnX, turnY], [endX, turnY], [endX, endY]];
};

/**
 * Routes an arrow whose ends may be single lines. `aLine` and `bLine` are the bands of those lines;
 * without either, it is the ordinary bubble to bubble route.
 */
export const routeAnchored = (
  a: Box,
  b: Box,
  aLine: Box | null,
  bLine: Box | null,
  obstacles: Box[] = [],
): Route => {
  if (!aLine && !bLine) return routeLink(a, b, obstacles);
  let points: Point[];
  if (aLine) {
    points = fromLine(a, aLine.y + aLine.h / 2, bLine ?? b);
  } else {
    // Into one line: the same route traced from that line back to the start, then turned around.
    const line = bLine as Box;
    points = fromLine(b, line.y + line.h / 2, a).reverse();
  }
  return { d: roundedPath(points), mid: midOf(points) };
};
