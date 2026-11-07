import { describe, expect, it } from 'vitest';
import { createExampleDoc } from './example.ts';
import { validateDoc } from './validate.ts';

const base = { version: 1, title: 'x', strokes: [], texts: [], bubbles: [], links: [], proposals: [] };

const bubble = {
  id: 'b',
  kind: 'group',
  title: 't',
  items: [],
  status: 'accepted',
  slot: 0,
  sketch: { x: 0, y: 0, w: 100 },
  map: { x: 0, y: 0, w: 100 },
  pinned: false,
  sourceStrokes: [],
  sourceTexts: [],
};

describe('validateDoc', () => {
  it('accepts a real map and returns it whole', () => {
    const doc = createExampleDoc();
    const result = validateDoc(doc);
    expect(result.id).toBe(doc.id);
    expect(result.strokes).toHaveLength(doc.strokes.length);
    expect(result.strokes[0].points).toBeInstanceOf(Float32Array);
    expect(result.texts[0].wrap).toBe(doc.texts[0].wrap);
  });

  it('turns stored number lists back into typed arrays and recomputes the box', () => {
    const result = validateDoc({
      ...base,
      strokes: [{ id: 's', points: [1, 2, 0.5, 11, 22, 0.5], color: 'ink', width: 2, box: 'nonsense' }],
    });
    expect(result.strokes[0].box).toEqual({ x: 1, y: 2, w: 10, h: 20 });
  });

  it.each([
    ['not an object', null],
    ['a list', []],
    ['the wrong version', { ...base, version: 2 }],
    ['no title', { ...base, title: undefined }],
    ['an unknown style', { ...base, style: 'neon' }],
    ['an empty bubble', { ...base, bubbles: [{}] }],
    ['a null bubble', { ...base, bubbles: [null] }],
    ['a bubble with no placement', { ...base, bubbles: [{ ...bubble, sketch: undefined }] }],
    ['a colour slot out of range', { ...base, bubbles: [{ ...bubble, slot: 9 }] }],
    ['a stroke with no points', { ...base, strokes: [{ id: 's', points: [], color: 'ink', width: 2 }] }],
    ['a broken point count', { ...base, strokes: [{ id: 's', points: [1, 2], color: 'ink', width: 2 }] }],
    ['a stroke with an unknown colour', { ...base, strokes: [{ id: 's', points: [1, 2, 3], color: 'red', width: 2 }] }],
    ['a negative stroke width', { ...base, strokes: [{ id: 's', points: [1, 2, 3], color: 'ink', width: -2 }] }],
    ['text with no words field', { ...base, texts: [{ id: 't', x: 0, y: 0, w: 1, h: 1 }] }],
    ['an empty proposal', { ...base, proposals: [{}] }],
    ['a proposal of an unknown kind', { ...base, proposals: [{ id: 'p', status: 'pending', origin: 'ai', body: { kind: 'wipe' } }] }],
  ])('refuses %s', (_name, value) => {
    expect(() => validateDoc(value)).toThrow('not a Balonche map');
  });

  it('refuses markup hiding in a position, which an SVG export would otherwise write out', () => {
    const attack = { ...bubble, map: { x: '0"/><script>alert(1)</script>', y: 0, w: 100 } };
    expect(() => validateDoc({ ...base, bubbles: [attack] })).toThrow();
  });
});
