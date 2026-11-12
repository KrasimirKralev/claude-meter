import { describe, expect, it } from 'vitest';
import { createDoc } from '../doc/ops.ts';
import type { Bubble, Link } from '../doc/types.ts';
import { walkOrder } from './walk.ts';

const bubble = (id: string, x: number, y: number, kind: Bubble['kind'] = 'group'): Bubble => ({
  id,
  kind,
  title: id,
  items: [],
  status: 'accepted',
  slot: 0,
  sketch: { x, y, w: 200 },
  map: { x, y, w: 300 },
  pinned: false,
  sourceStrokes: [],
  sourceTexts: [],
});

const link = (from: string, to: string): Link => ({
  id: `${from}-${to}`,
  from,
  to,
  status: 'accepted',
  sourceStrokes: [],
});

const ids = (bubbles: Bubble[], links: Link[] = []): string[] =>
  walkOrder({ ...createDoc(), bubbles, links }).map((b) => b.id);

describe('walkOrder', () => {
  it('starts top left, even when arrows form a loop', () => {
    const bubbles = [bubble('b', 400, 0), bubble('a', 0, 0), bubble('c', 400, 400)];
    expect(ids(bubbles, [link('a', 'b'), link('b', 'c'), link('c', 'a')])).toEqual(['a', 'b', 'c']);
  });

  it('never opens on a note, and puts each note after its nearest group', () => {
    const bubbles = [
      bubble('note', 0, 0, 'note'),
      bubble('a', 400, 0),
      bubble('b', 0, 600),
    ];
    expect(ids(bubbles)).toEqual(['a', 'note', 'b']);
  });

  it('follows an arrow before moving on to the next bubble in reading order', () => {
    const bubbles = [bubble('a', 0, 0), bubble('b', 400, 0), bubble('c', 0, 400)];
    expect(ids(bubbles, [link('a', 'c')])).toEqual(['a', 'c', 'b']);
  });

  it('handles a map of only notes, and an empty map', () => {
    expect(ids([bubble('n', 0, 0, 'note')])).toEqual(['n']);
    expect(ids([])).toEqual([]);
  });
});
