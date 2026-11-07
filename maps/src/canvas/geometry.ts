import type { Box, Stroke, TextNote } from '../doc/types.ts';

export const pointInBox = (x: number, y: number, b: Box, slack = 0): boolean =>
  x >= b.x - slack && x <= b.x + b.w + slack && y >= b.y - slack && y <= b.y + b.h + slack;

export const boxesTouch = (a: Box, b: Box): boolean =>
  a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;

export const boxContains = (outer: Box, inner: Box): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.w <= outer.x + outer.w &&
  inner.y + inner.h <= outer.y + outer.h;

const distanceToSegment = (
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number => {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

export const hitStroke = (stroke: Stroke, x: number, y: number, radius: number): boolean => {
  if (!pointInBox(x, y, stroke.box, radius + stroke.width)) return false;
  const p = stroke.points;
  const reach = radius + stroke.width / 2;
  if (p.length < 6) return Math.hypot(p[0] - x, p[1] - y) <= reach;
  for (let i = 3; i < p.length; i += 3) {
    if (distanceToSegment(x, y, p[i - 3], p[i - 2], p[i], p[i + 1]) <= reach) return true;
  }
  return false;
};

export const pointInPolygon = (x: number, y: number, polygon: readonly number[]): boolean => {
  let inside = false;
  const n = polygon.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const xi = polygon[i * 2];
    const yi = polygon[i * 2 + 1];
    const xj = polygon[j * 2];
    const yj = polygon[j * 2 + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/** At least most of a stroke must sit inside the lasso, so a passing line is not grabbed. */
export const strokeInPolygon = (stroke: Stroke, polygon: readonly number[]): boolean => {
  const p = stroke.points;
  let inside = 0;
  let total = 0;
  const step = Math.max(3, Math.floor(p.length / 30 / 3) * 3);
  for (let i = 0; i < p.length; i += step) {
    total += 1;
    if (pointInPolygon(p[i], p[i + 1], polygon)) inside += 1;
  }
  return total > 0 && inside / total >= 0.7;
};

export const textBox = (note: TextNote): Box => ({ x: note.x, y: note.y, w: note.w, h: note.h });
