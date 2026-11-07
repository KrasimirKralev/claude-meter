// Inside the desktop app, a small preload script adds `window.meterMaps`. The app uses it to list
// maps and ask for one to open. In an ordinary browser tab it is absent and all of this does nothing.

import type { MapDoc } from '../doc/types.ts';
import { MAP_STYLES } from '../map/styles.ts';

export interface PreviewBubble {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

export interface ReportedMap {
  id: string;
  title: string;
  updatedAt: number;
  preview: PreviewBubble[];
  /** Arrows between bubbles, as indexes into `preview`. */
  links: [number, number][];
}

export interface OpenRequest {
  id?: string;
  new?: boolean;
}

/** The app's look. The page's own dark and light, plus the app's main theme. */
export type AppTheme = 'brutal' | 'dark' | 'light';

interface MeterBridge {
  reportMaps(maps: ReportedMap[]): void;
  onOpen(listener: (request: OpenRequest) => void): void;
  onTheme(listener: (theme: AppTheme) => void): void;
}

const PREVIEW_BUBBLES = 12;
/** Bubbles get their height from their text, which isn't known here. Good enough for a thumbnail. */
const BUBBLE_ASPECT = 0.45;
const REPORT_DELAY_MS = 400;

const bridge = (): MeterBridge | undefined =>
  (globalThis as { meterMaps?: MeterBridge }).meterMaps;

const previewBubbles = (doc: MapDoc): MapDoc['bubbles'] =>
  doc.bubbles.filter((b) => b.status === 'accepted').slice(0, PREVIEW_BUBBLES);

/** The finished map's bubbles, scaled to fit a 100-wide box, for the app to draw as a thumbnail. */
export const previewOf = (doc: MapDoc): PreviewBubble[] => {
  const colors = MAP_STYLES[doc.style].colors;
  const bubbles = previewBubbles(doc);
  if (bubbles.length === 0) return [];
  const left = Math.min(...bubbles.map((b) => b.map.x));
  const top = Math.min(...bubbles.map((b) => b.map.y));
  const right = Math.max(...bubbles.map((b) => b.map.x + b.map.w));
  const scale = 100 / Math.max(1, right - left);
  const rounded = (value: number): number => Math.round(value * 10) / 10;
  return bubbles.map((b) => ({
    x: rounded((b.map.x - left) * scale),
    y: rounded((b.map.y - top) * scale),
    w: rounded(b.map.w * scale),
    h: rounded(b.map.w * BUBBLE_ASPECT * scale),
    color: colors[b.slot % colors.length],
  }));
};

export const previewLinksOf = (doc: MapDoc): [number, number][] => {
  const bubbles = previewBubbles(doc);
  const indexOf = (id: string): number => bubbles.findIndex((b) => b.id === id);
  return doc.links
    .filter((link) => link.status === 'accepted')
    .map((link): [number, number] => [indexOf(link.from), indexOf(link.to)])
    .filter(([from, to]) => from !== -1 && to !== -1);
};

/** A damaged map must not cost the app the whole list, so it goes through without a picture. */
const reportOf = (doc: MapDoc): ReportedMap => {
  try {
    return {
      id: doc.id,
      title: doc.title,
      updatedAt: doc.updatedAt,
      preview: previewOf(doc),
      links: previewLinksOf(doc),
    };
  } catch (error) {
    console.error('A saved map could not be previewed', doc?.id, error);
    return { id: doc?.id, title: doc?.title, updatedAt: doc?.updatedAt, preview: [], links: [] };
  }
};

let reportTimer: ReturnType<typeof setTimeout> | undefined;

/** Tells the app which maps exist, a moment after the latest change. */
export const reportMapsSoon = (readAll: () => Promise<MapDoc[]>): void => {
  const target = bridge();
  if (!target) return;
  clearTimeout(reportTimer);
  reportTimer = setTimeout(() => {
    readAll()
      .then((docs) => {
        target.reportMaps(
          [...docs].sort((a, b) => (b?.updatedAt ?? 0) - (a?.updatedAt ?? 0)).map(reportOf),
        );
      })
      .catch((error: unknown) => {
        // The list in the app goes stale. The maps themselves are untouched.
        console.error('Reporting maps to the app failed', error);
      });
  }, REPORT_DELAY_MS);
};

export const listenForOpen = (listener: (request: OpenRequest) => void): void => {
  bridge()?.onOpen(listener);
};

/** Inside the app, the look comes from the app, so the page offers no theme switch of its own. */
export const insideApp = (): boolean => bridge() !== undefined;

export const listenForTheme = (listener: (theme: AppTheme) => void): void => {
  bridge()?.onTheme(listener);
};
