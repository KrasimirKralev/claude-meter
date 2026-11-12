// What the maps menu shows for one saved map: its name, its age, how far along it is, and a small
// picture. Pure, so it is tested without a browser and can never touch the stored map.

import { isShownIn, shownRoot, visibleRoots } from '../doc/ops.ts';
import type { Box, InkColor, MapDoc, MapStyleId } from '../doc/types.ts';
import { childrenIn } from '../map/boxes.ts';
import { estimateHeight } from '../map/layout.ts';

export const THUMB_W = 88;
export const THUMB_H = 56;
const PAD = 5;
const MAX_BUBBLES = 40;
const MAX_STROKES = 160;
const POINTS_PER_STROKE = 20;

export interface ThumbBubble extends Box {
  /** Index into the map style's colours. */
  slot: number;
}

export type Thumb =
  | { kind: 'map'; bubbles: ThumbBubble[]; links: [number, number][] }
  | { kind: 'sketch'; strokes: { d: string; color: InkColor }[]; notes: Box[] }
  | { kind: 'empty' };

export interface MapSummary {
  id: string;
  title: string;
  updatedAt: number;
  style: MapStyleId;
  thumb: Thumb;
  /** Accepted bubbles, including the ones drawn inside others. */
  bubbles: number;
  /** Something is drawn or typed on the sketch. */
  sketched: boolean;
}

const round = (value: number): number => Math.round(value * 10) / 10;

/** A transform that fits a box into the picture, centred, keeping its proportions. */
const fit = (content: Box): { x: (v: number) => number; y: (v: number) => number; s: number } => {
  const s = Math.min(
    (THUMB_W - PAD * 2) / Math.max(content.w, 1),
    (THUMB_H - PAD * 2) / Math.max(content.h, 1),
  );
  const left = (THUMB_W - content.w * s) / 2;
  const top = (THUMB_H - content.h * s) / 2;
  return {
    x: (v) => left + (v - content.x) * s,
    y: (v) => top + (v - content.y) * s,
    s,
  };
};

const union = (boxes: Box[]): Box => {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    w: Math.max(...boxes.map((b) => b.x + b.w)) - x,
    h: Math.max(...boxes.map((b) => b.y + b.h)) - y,
  };
};

const mapThumb = (doc: MapDoc): Thumb => {
  const roots = visibleRoots(doc, 'map').slice(0, MAX_BUBBLES);
  const childrenOf = childrenIn(doc.bubbles, 'map');
  const boxes = roots.map((b) => ({
    x: b.map.x,
    y: b.map.y,
    w: b.map.w,
    h: estimateHeight(b, b.map.w, childrenOf),
  }));
  const to = fit(union(boxes));
  const shown = isShownIn('map');
  const rootIndex = (id: string): number => {
    const bubble = doc.bubbles.find((b) => b.id === id);
    if (!bubble || !shown(bubble)) return -1;
    return roots.indexOf(shownRoot(doc.bubbles, bubble, shown));
  };
  const seen = new Set<string>();
  const links: [number, number][] = [];
  for (const link of doc.links) {
    if (link.status !== 'accepted') continue;
    const from = rootIndex(link.from);
    const end = rootIndex(link.to);
    if (from < 0 || end < 0 || from === end || seen.has(`${from}>${end}`)) continue;
    seen.add(`${from}>${end}`);
    links.push([from, end]);
  }
  return {
    kind: 'map',
    bubbles: boxes.map((box, i) => ({
      x: round(to.x(box.x)),
      y: round(to.y(box.y)),
      // Never thinner than a hairline, so a huge map still shows every bubble.
      w: round(Math.max(3, box.w * to.s)),
      h: round(Math.max(2.5, box.h * to.s)),
      slot: roots[i].slot,
    })),
    links,
  };
};

const sketchThumb = (doc: MapDoc): Thumb => {
  const strokes = doc.strokes.slice(0, MAX_STROKES);
  const notes = doc.texts.map((t) => ({ x: t.x, y: t.y, w: Math.max(t.w, 8), h: Math.max(t.h, 8) }));
  const to = fit(union([...strokes.map((s) => s.box), ...notes]));
  return {
    kind: 'sketch',
    strokes: strokes.map((stroke) => {
      const count = stroke.points.length / 3;
      const step = Math.max(1, Math.ceil(count / POINTS_PER_STROKE));
      let d = '';
      for (let i = 0; i < count; i += step) {
        d += `${d ? 'L' : 'M'}${round(to.x(stroke.points[i * 3]))} ${round(to.y(stroke.points[i * 3 + 1]))}`;
      }
      // The last point closes a drawn box, so it is never skipped by the sampling.
      const last = (count - 1) * 3;
      d += `L${round(to.x(stroke.points[last]))} ${round(to.y(stroke.points[last + 1]))}`;
      return { d, color: stroke.color };
    }),
    // Typed words show as short bars: at this size the words themselves could not be read.
    notes: notes.map((n) => ({
      x: round(to.x(n.x)),
      y: round(to.y(n.y + n.h * 0.3)),
      w: round(Math.max(2, n.w * to.s)),
      h: round(Math.max(1.2, n.h * to.s * 0.4)),
    })),
  };
};

export const summaryOf = (doc: MapDoc): MapSummary => {
  const base = { id: doc.id, title: doc.title, updatedAt: doc.updatedAt, style: doc.style };
  try {
    const bubbles = doc.bubbles.filter((b) => b.status === 'accepted').length;
    const sketched = doc.strokes.length + doc.texts.length > 0;
    const thumb: Thumb =
      bubbles > 0 ? mapThumb(doc) : sketched ? sketchThumb(doc) : { kind: 'empty' };
    return { ...base, thumb, bubbles, sketched };
  } catch (error) {
    // A damaged map still gets its line in the menu, so it can be found and deleted.
    console.error('A map could not be pictured', doc.id, error);
    return { ...base, style: 'candy', thumb: { kind: 'empty' }, bubbles: 0, sketched: false };
  }
};

/** "9 bubbles", "Sketch" or "Empty": how far along a map is, in a word or two. */
export const sizeLabel = (summary: MapSummary): string => {
  if (summary.bubbles > 0) return `${summary.bubbles} ${summary.bubbles === 1 ? 'bubble' : 'bubbles'}`;
  return summary.sketched ? 'Sketch' : 'Empty';
};

/** Maps whose name holds every word typed, in any order and any letter case. */
export const filterMaps = (maps: MapSummary[], query: string): MapSummary[] => {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return maps;
  return maps.filter((map) => {
    const title = map.title.toLocaleLowerCase();
    return words.every((word) => title.includes(word));
  });
};
