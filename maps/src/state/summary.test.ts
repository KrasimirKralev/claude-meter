import { describe, expect, it } from 'vitest';
import { createDoc } from '../doc/ops.ts';
import type { Bubble, MapDoc, Stroke } from '../doc/types.ts';
import { filterMaps, sizeLabel, summaryOf, THUMB_H, THUMB_W } from './summary.ts';

const bubble = (id: string, x: number, y: number, over: Partial<Bubble> = {}): Bubble => ({
  id,
  kind: 'group',
  title: id,
  items: [{ id: `${id}-1`, text: 'one' }],
  status: 'accepted',
  slot: 1,
  sketch: { x, y, w: 200, h: 120 },
  map: { x, y, w: 300 },
  pinned: false,
  sourceStrokes: [],
  sourceTexts: [],
  ...over,
});

const stroke = (id: string, points: number[]): Stroke => {
  const xs = points.filter((_, i) => i % 3 === 0);
  const ys = points.filter((_, i) => i % 3 === 1);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    id,
    points: Float32Array.from(points),
    color: 'aqua',
    width: 2.4,
    box: { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y },
  };
};

const doc = (over: Partial<MapDoc>): MapDoc => ({ ...createDoc('Plan'), ...over });

describe('the picture of a finished map', () => {
  const summary = summaryOf(
    doc({
      bubbles: [
        bubble('a', 0, 0),
        bubble('b', 2000, 3000),
        bubble('inside', 0, 0, { parent: 'a' }),
        bubble('waiting', 500, 500, { status: 'pending' }),
      ],
      links: [
        { id: 'l1', from: 'inside', to: 'b', status: 'accepted', sourceStrokes: [] },
        { id: 'l2', from: 'a', to: 'b', status: 'accepted', sourceStrokes: [] },
        { id: 'l3', from: 'a', to: 'waiting', status: 'accepted', sourceStrokes: [] },
      ],
    }),
  );

  it('draws the bubbles that stand on their own, inside the picture', () => {
    if (summary.thumb.kind !== 'map') throw new Error('expected a map picture');
    expect(summary.thumb.bubbles).toHaveLength(2);
    for (const b of summary.thumb.bubbles) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(THUMB_W);
      expect(b.y + b.h).toBeLessThanOrEqual(THUMB_H);
      // Even on a huge map every bubble stays visible.
      expect(b.w).toBeGreaterThanOrEqual(3);
    }
  });

  it('draws an arrow once, between the outer bubbles, and none to a bubble not on the map', () => {
    if (summary.thumb.kind !== 'map') throw new Error('expected a map picture');
    expect(summary.thumb.links).toEqual([[0, 1]]);
  });

  it('counts every accepted bubble and says so', () => {
    expect(summary.bubbles).toBe(3);
    expect(sizeLabel(summary)).toBe('3 bubbles');
  });
});

describe('the picture of a sketch', () => {
  const summary = summaryOf(
    doc({
      strokes: [stroke('s', [100, 100, 0.5, 900, 100, 0.5, 900, 700, 0.5, 100, 700, 0.5, 100, 104, 0.5])],
      texts: [{ id: 't', x: 200, y: 200, w: 300, h: 23, text: 'words' }],
    }),
  );

  it('draws the strokes in their colours and the typed words as bars', () => {
    if (summary.thumb.kind !== 'sketch') throw new Error('expected a sketch picture');
    expect(summary.thumb.strokes).toHaveLength(1);
    expect(summary.thumb.strokes[0].color).toBe('aqua');
    expect(summary.thumb.strokes[0].d.startsWith('M')).toBe(true);
    expect(summary.thumb.notes).toHaveLength(1);
    expect(sizeLabel(summary)).toBe('Sketch');
  });

  it('keeps every point inside the picture', () => {
    if (summary.thumb.kind !== 'sketch') throw new Error('expected a sketch picture');
    const numbers = summary.thumb.strokes[0].d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    numbers.forEach((value, i) => {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(i % 2 === 0 ? THUMB_W : THUMB_H);
    });
  });
});

describe('maps with nothing to draw', () => {
  it('an empty map is called empty', () => {
    const summary = summaryOf(doc({}));
    expect(summary.thumb.kind).toBe('empty');
    expect(sizeLabel(summary)).toBe('Empty');
  });

  it('a damaged map still gets its line, so it can be found and deleted', () => {
    const broken = { ...doc({ title: 'Broken' }), bubbles: null } as unknown as MapDoc;
    const summary = summaryOf(broken);
    expect(summary.title).toBe('Broken');
    expect(summary.thumb.kind).toBe('empty');
  });

  it('one bubble is singular', () => {
    expect(sizeLabel(summaryOf(doc({ bubbles: [bubble('a', 0, 0)] })))).toBe('1 bubble');
  });
});

describe('finding a map by name', () => {
  const maps = ['ClawBox Spark Cluster: 4 nodes', 'DGX spark mapc', 'Семейство, образование и професии'].map(
    (title) => summaryOf(doc({ title })),
  );
  const found = (query: string): string[] => filterMaps(maps, query).map((m) => m.title);

  it('ignores letter case, in Latin and in Cyrillic', () => {
    expect(found('SPARK')).toEqual(['ClawBox Spark Cluster: 4 nodes', 'DGX spark mapc']);
    expect(found('семейство')).toEqual(['Семейство, образование и професии']);
  });

  it('takes several words in any order', () => {
    expect(found('nodes spark')).toEqual(['ClawBox Spark Cluster: 4 nodes']);
  });

  it('shows everything for an empty search, and nothing when no name fits', () => {
    expect(found('  ')).toHaveLength(3);
    expect(found('zebra')).toEqual([]);
  });
});
