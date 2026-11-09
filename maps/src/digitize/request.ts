// What leaves this computer when Digitize asks the AI: the map's structure, never the raw strokes.

import type { DigitizeRequest } from '../../shared/digitize.ts';
import { claimedTextIds, unionBoxes } from '../doc/ops.ts';
import type { Bubble, Id, MapDoc } from '../doc/types.ts';

/** When part of the canvas was selected, only that part may leave this computer. */
export interface Scope {
  bubbles: ReadonlySet<Id>;
  texts: ReadonlySet<Id>;
  strokes: ReadonlySet<Id>;
}

const GRID = 100;

export const buildRequest = (
  doc: MapDoc,
  scope: Scope | null,
  image: string | undefined,
): DigitizeRequest => {
  const live = doc.bubbles.filter(
    (b) => b.status !== 'rejected' && (!scope || scope.bubbles.has(b.id)),
  );
  const claimed = claimedTextIds(doc);
  const liveIds = new Set(live.map((b) => b.id));
  const strokeColor = new Map(doc.strokes.map((s) => [s.id, s.color]));
  // Positions on a 0 to 100 grid: enough for the model to see what sits beside or under what.
  const area = unionBoxes(
    live.map((b) => ({ x: b.sketch.x, y: b.sketch.y, w: b.sketch.w, h: b.sketch.h ?? 120 })),
  );
  const grid = (value: number, origin: number, size: number): number =>
    Math.round(((value - origin) / Math.max(size, 1)) * GRID);
  const parentIn = (b: Bubble): string | undefined => {
    for (let id = b.parent; id; id = doc.bubbles.find((p) => p.id === id)?.parent) {
      if (liveIds.has(id)) return id;
    }
    return undefined;
  };
  return {
    title: doc.title,
    bubbles: live.map((b) => {
      const out: DigitizeRequest['bubbles'][number] = {
        id: b.id,
        kind: b.kind,
        title: b.title,
        items: b.items.map((i) => (i.mark ? { id: i.id, text: i.text, mark: i.mark } : { id: i.id, text: i.text })),
      };
      const parent = parentIn(b);
      if (parent) out.parent = parent;
      const color = b.sourceStrokes.map((id) => strokeColor.get(id)).find(Boolean);
      if (color && color !== 'ink') out.color = color;
      if (area && b.sourceStrokes.length + b.sourceTexts.length > 0) {
        out.at = {
          x: grid(b.sketch.x, area.x, area.w),
          y: grid(b.sketch.y, area.y, area.h),
          w: grid(b.sketch.x + b.sketch.w, area.x, area.w) - grid(b.sketch.x, area.x, area.w),
          h:
            grid(b.sketch.y + (b.sketch.h ?? 120), area.y, area.h) - grid(b.sketch.y, area.y, area.h),
        };
      }
      return out;
    }),
    links: doc.links
      .filter((l) => l.status !== 'rejected' && liveIds.has(l.from) && liveIds.has(l.to))
      .map((l) => {
        const out: DigitizeRequest['links'][number] = { id: l.id, from: l.from, to: l.to };
        if (l.fromItem) out.fromItem = l.fromItem;
        if (l.toItem) out.toItem = l.toItem;
        if (l.label) out.label = l.label;
        if (l.color) out.color = l.color;
        return out;
      }),
    looseText: doc.texts
      .filter((t) => !claimed.has(t.id) && (!scope || scope.texts.has(t.id)))
      .map((t) => t.text),
    image,
  };
};
