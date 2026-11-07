import { describe, expect, it } from 'vitest';
import type { Bubble } from '../doc/types.ts';
import { BUBBLE_W, layoutBubbles, mapWidth, NOTE_W, WIDE_W } from './layout.ts';
import { routeLink } from './links.ts';

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
