import { describe, expect, it } from 'vitest';
import { createDoc } from '../doc/ops.ts';
import type { Bubble } from '../doc/types.ts';
import { buildRequest } from './request.ts';

const bubble = (id: string, patch: Partial<Bubble>): Bubble => ({
  id,
  kind: 'group',
  title: '',
  items: [],
  status: 'pending',
  slot: 0,
  sketch: { x: 0, y: 0, w: 200, h: 100 },
  map: { x: 0, y: 0, w: 300 },
  pinned: false,
  sourceStrokes: [],
  sourceTexts: [],
  ...patch,
});

describe('buildRequest', () => {
  it('marks a word typed with no shape around it as free, and a drawn box not', () => {
    const doc = {
      ...createDoc('Map'),
      bubbles: [
        bubble('box', { sourceStrokes: ['s1'], sourceTexts: ['t1'] }),
        bubble('word', { title: 'Skoda', sourceTexts: ['t2'] }),
      ],
    };
    const request = buildRequest(doc, null, undefined);
    expect(request.bubbles.find((b) => b.id === 'word')?.free).toBe(true);
    expect(request.bubbles.find((b) => b.id === 'box')?.free).toBeUndefined();
  });
});
