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
    // Centres belong to straight arrows. These ends sit off-centre, toward each other, so a routed
    // arrow can never merge with a straight one into something that reads as one line.
    const ax = a.x + a.w * (rightward ? 0.75 : 0.25);
    const bx = b.x + b.w * (rightward ? 0.25 : 0.75);
    return {
      d: roundedPath([
        [ax, a.y + a.h + GAP],
        [ax, floor],
        [bx, floor],
        [bx, b.y + b.h + GAP],
      ]),
      mid: { x: (ax + bx) / 2, y: floor },
    };
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
    const wall =
      Math.max(
        a.x + a.w,
        b.x + b.w,
        ...obstacles
          .filter((o) => Math.max(from, to) >= o.y && Math.min(from, to) <= o.y + o.h)
          .map((o) => o.x + o.w),
      ) + CLEARANCE;
    const ay = a.y + a.h * (downward ? 0.75 : 0.25);
    const by = b.y + b.h * (downward ? 0.25 : 0.75);
    return {
      d: roundedPath([
        [a.x + a.w + GAP, ay],
        [wall, ay],
        [wall, by],
        [b.x + b.w + GAP, by],
      ]),
      mid: { x: wall, y: (ay + by) / 2 },
    };
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
