import { describe, expect, it } from 'vitest';
import type { Bubble } from '../doc/types.ts';
import { BUBBLE_W, layoutBubbles, mapWidth, NEST_PAD, NOTE_W, WIDE_W } from './layout.ts';
import { assignLanes, routeAnchored, routeLink } from './links.ts';

const bubble = (id: string, x: number, y: number, extra: Partial<Bubble> = {}): Bubble => ({
  id,
  kind: 'group',
  title: id,
  items: [],
  status: 'accepted',
  slot: 0,
  sketch: { x, y, w: 200, h: 150 },
  map: { x: 0, y: 0, w: 300 },
  pinned: false,
  sourceStrokes: [],
  sourceTexts: [],
  ...extra,
});

describe('layoutBubbles', () => {
  it('keeps the drawn rows and left-to-right order', () => {
    const bubbles = [bubble('c', 800, 10), bubble('a', 0, 0), bubble('b', 400, 20), bubble('d', 100, 500)];
    const placed = layoutBubbles(bubbles, () => 200);
    const a = placed.get('a')!;
    const b = placed.get('b')!;
    const c = placed.get('c')!;
    const d = placed.get('d')!;
    expect(a.y).toBe(b.y);
    expect(b.y).toBe(c.y);
    expect(a.x).toBeLessThan(b.x);
    expect(b.x).toBeLessThan(c.x);
    expect(d.y).toBeGreaterThan(a.y + 200);
  });

  it('never overlaps bubbles in a row, whatever their heights', () => {
    const bubbles = [bubble('a', 0, 0), bubble('b', 300, 0), bubble('c', 600, 0)];
    const placed = layoutBubbles(bubbles, (b) => (b.id === 'b' ? 900 : 100));
    expect(placed.get('b')!.x).toBeGreaterThanOrEqual(placed.get('a')!.x + BUBBLE_W);
    expect(placed.get('c')!.x).toBeGreaterThanOrEqual(placed.get('b')!.x + BUBBLE_W);
  });

  it('puts the row below the tallest bubble of the row above', () => {
    const bubbles = [bubble('a', 0, 0), bubble('b', 400, 0), bubble('c', 0, 600)];
    const placed = layoutBubbles(bubbles, (b) => (b.id === 'b' ? 900 : 100));
    expect(placed.get('c')!.y).toBeGreaterThan(900);
  });

  it('places a note in the emptier nearby row instead of adding a row', () => {
    const bubbles = [
      bubble('a', 0, 0),
      bubble('b', 400, 0),
      bubble('c', 800, 0),
      bubble('d', 0, 500),
      bubble('e', 800, 500),
      bubble('note', 400, 230, { kind: 'note', sketch: { x: 400, y: 230, w: 200, h: 60 } }),
    ];
    const placed = layoutBubbles(bubbles, () => 200);
    expect(placed.get('note')!.y).toBe(placed.get('d')!.y);
    expect(placed.get('note')!.x).toBeGreaterThan(placed.get('d')!.x);
    expect(placed.get('note')!.x).toBeLessThan(placed.get('e')!.x);
  });

  it('leaves pinned bubbles out of the layout', () => {
    const placed = layoutBubbles([bubble('a', 0, 0, { pinned: true }), bubble('b', 10, 10)], () => 100);
    expect(placed.has('a')).toBe(false);
    expect(placed.has('b')).toBe(true);
  });

  it('handles an empty map', () => {
    expect(layoutBubbles([], () => 100).size).toBe(0);
  });
});

describe('mapWidth', () => {
  it('gives long sentences a wider bubble and notes a narrow one', () => {
    expect(mapWidth(bubble('a', 0, 0))).toBe(BUBBLE_W);
    expect(
      mapWidth(bubble('a', 0, 0, { items: [{ id: 'i', text: 'x'.repeat(60) }] })),
    ).toBe(WIDE_W);
    expect(mapWidth(bubble('a', 0, 0, { kind: 'note' }))).toBe(NOTE_W);
  });
});

describe('routeLink', () => {
  const box = (x: number, y: number, w = 100, h = 100) => ({ x, y, w, h });

  it('runs straight across bubbles that face each other', () => {
    const { d } = routeLink(box(0, 0), box(200, 0));
    expect(d).toMatch(/^M107 36L193 36$/);
  });

  it('runs straight down and straight up', () => {
    expect(routeLink(box(0, 0), box(0, 300)).d).toBe('M50 107L50 293');
    expect(routeLink(box(0, 300), box(0, 0)).d).toBe('M50 293L50 107');
  });

  it('uses one rounded elbow when they do not face each other', () => {
    const { d } = routeLink(box(0, 0), box(300, 300));
    expect(d.startsWith('M75 107L75')).toBe(true);
    expect(d).toContain('Q');
  });

  it('goes underneath a bubble that sits between the two', () => {
    const { d, mid } = routeLink(box(0, 0), box(400, 0), [box(200, 0)]);
    // Off-centre at both ends, so it cannot merge with a straight arrow using the centre.
    expect(d.startsWith('M75 107')).toBe(true);
    expect(d).toContain('Q');
    expect(mid.y).toBeGreaterThan(100);
    expect(d.endsWith('L425 107')).toBe(true);
  });

  it('goes around the side when a bubble blocks the way down', () => {
    const { mid } = routeLink(box(0, 0), box(0, 400), [box(0, 200)]);
    expect(mid.x).toBeGreaterThan(100);
  });

  it('stays straight when the other bubble is not in the way', () => {
    expect(routeLink(box(0, 0), box(200, 0), [box(900, 900)]).d).toBe('M107 36L193 36');
  });
});

describe('layout of a sketch drawn in columns', () => {
  it('keeps a lone box on the side it was drawn on, under the box above it', () => {
    const placed = layoutBubbles(
      [bubble('a', 0, 0), bubble('b', 900, 0), bubble('c', 900, 400), bubble('d', 0, 700)],
      () => 150,
    );
    expect(placed.get('c')?.x).toBe(placed.get('b')?.x);
    expect(placed.get('d')?.x).toBe(placed.get('a')?.x);
  });

  it('makes room for the boxes drawn inside a box', () => {
    const outer = bubble('outer', 0, 0, { sketch: { x: 0, y: 0, w: 800, h: 400 } });
    const kids = [bubble('k1', 20, 50), bubble('k2', 400, 50)];
    const width = mapWidth(outer, (b) => (b.id === 'outer' ? kids : []));
    expect(width).toBe(240 * 2 + 14 + NEST_PAD * 2);
  });
});

describe('routes past other bubbles', () => {
  const box = (x: number, y: number, w = 100, h = 100) => ({ x, y, w, h });

  it('goes around the left when the right side is taken', () => {
    const { mid } = routeLink(box(0, 0), box(0, 400), [box(0, 200), box(100, 50, 200, 50)]);
    expect(mid.x).toBeLessThan(0);
  });

  it('goes over the top when the space underneath is taken', () => {
    const { mid } = routeLink(box(0, 0), box(400, 0), [box(200, 0), box(-50, 120, 600, 40)]);
    expect(mid.y).toBeLessThan(0);
  });
});

describe('arrows from one line', () => {
  const box = (x: number, y: number, w = 200, h = 200) => ({ x, y, w, h });
  const line = (y: number) => ({ x: 0, y, w: 200, h: 30 });

  it('leaves the side of the bubble at the height of that line', () => {
    const { d } = routeAnchored(box(0, 0), box(400, 0), line(60), null);
    expect(d).toBe('M207 75L393 75');
  });

  it('turns once to reach a target lower down', () => {
    const { d } = routeAnchored(box(0, 0), box(400, 300), line(60), null);
    expect(d.startsWith('M207 75')).toBe(true);
    expect(d.endsWith('L393 320')).toBe(true);
  });

  it('comes into one line from the side', () => {
    const { d } = routeAnchored(box(400, 0), box(0, 0), null, line(60));
    expect(d.endsWith('L207 75')).toBe(true);
  });

  it('comes down onto a target below', () => {
    const { d } = routeAnchored(box(0, 0), box(0, 400), line(60), null);
    expect(d.startsWith('M207 75')).toBe(true);
    expect(d.endsWith('393')).toBe(true);
  });
});

describe('a bubble whose lines each point somewhere', () => {
  const people = bubble('people', 300, 250, {
    sketch: { x: 300, y: 250, w: 400, h: 300 },
    items: [
      { id: 'p1', text: 'Anton' },
      { id: 'p2', text: 'Boris' },
      { id: 'p3', text: 'Ivan' },
    ],
  });
  const bubbles = [
    people,
    bubble('factsA', 850, 0, { items: [{ id: 'a1', text: 'Taxi driver' }] }),
    bubble('carA', 1250, 150, { items: [] }),
    bubble('factsB', 1150, 350, { items: [{ id: 'b1', text: 'Engineer' }] }),
    bubble('carB', 800, 500, { items: [] }),
    bubble('carC', 0, 750, { items: [] }),
    bubble('factsC', 300, 800, { items: [{ id: 'c1', text: 'Builder' }] }),
    bubble('other', 1200, 1400),
  ];
  const links = [
    { from: 'people', fromItem: 'p1', to: 'factsA' },
    { from: 'people', fromItem: 'p1', to: 'carA' },
    { from: 'people', fromItem: 'p2', to: 'factsB' },
    { from: 'people', fromItem: 'p2', to: 'carB' },
    { from: 'people', fromItem: 'p3', to: 'carC' },
    { from: 'people', fromItem: 'p3', to: 'factsC' },
  ];
  const height = (b: Bubble): number => (b.items.length === 0 ? 60 : 180);
  const placed = layoutBubbles(bubbles, height, undefined, links);
  const targets = ['factsA', 'carA', 'factsB', 'carB', 'carC', 'factsC'];

  it('puts everything its lines point at in one column to its right', () => {
    const source = placed.get('people')!;
    const xs = new Set(targets.map((id) => placed.get(id)!.x));
    expect(xs.size).toBe(1);
    expect([...xs][0]).toBeGreaterThan(source.x + source.w + 100);
  });

  it('orders that column by the line each arrow leaves from, without overlaps', () => {
    const ys = targets.map((id) => placed.get(id)!.y);
    for (let i = 1; i < ys.length; i += 1) {
      const above = bubbles.find((b) => b.id === targets[i - 1])!;
      expect(ys[i]).toBeGreaterThanOrEqual(ys[i - 1] + height(above));
    }
  });

  it('places what is not part of it below', () => {
    const lowest = Math.max(
      ...targets.map((id) => placed.get(id)!.y + height(bubbles.find((b) => b.id === id)!)),
    );
    expect(placed.get('other')!.y).toBeGreaterThanOrEqual(lowest);
  });

  it('leaves a single arrow from one line to the drawn layout', () => {
    const one = layoutBubbles(bubbles, height, undefined, links.slice(0, 2));
    expect(one.get('carC')!.x).toBeLessThan(one.get('factsC')!.x);
  });
});

describe('several arrows leaving one side of a bubble', () => {
  it('turn in their own lanes, so they never run on top of each other', () => {
    const box = (x: number, y: number) => ({ x, y, w: 200, h: 200 });
    const line = { x: 0, y: 60, w: 200, h: 30 };
    const first = routeAnchored(box(0, 0), box(500, 300), line, null, [], 0).d;
    const second = routeAnchored(box(0, 0), box(500, 600), line, null, [], 1).d;
    const turn = (d: string): string => d.split('L')[1].split(' ')[0];
    expect(turn(first)).not.toBe(turn(second));
    expect(Number(turn(first))).toBeLessThan(Number(turn(second)));
  });
});

describe('assignLanes', () => {
  const box = (x: number, y: number) => ({ x, y, w: 200, h: 100 });
  const line = { x: 0, y: 140, w: 200, h: 30 };
  const arrow = (id: string, b: { x: number; y: number; w: number; h: number }) => ({
    id,
    from: 'people',
    a: box(0, 100),
    b,
    fromLine: line,
    toLine: null,
  });

  it('gives arrows leaving one side of a bubble lanes of their own, the furthest innermost', () => {
    const lanes = assignLanes([arrow('near', box(500, 60)), arrow('far', box(500, -300))]);
    expect(lanes.get('far')).toBe(0);
    expect(lanes.get('near')).toBe(1);
  });

  it('leaves a lone arrow on its ordinary route', () => {
    expect(assignLanes([arrow('only', box(500, 300))]).size).toBe(0);
  });
});
