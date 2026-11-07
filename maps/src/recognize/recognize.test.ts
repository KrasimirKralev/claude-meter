import { describe, expect, it } from 'vitest';
import { createExampleDoc } from '../doc/example.ts';
import { recognize } from './recognize.ts';
import type { InStroke, InText } from './recognize.ts';

const line = (id: string, ...xy: number[]): InStroke => {
  const points: number[] = [];
  for (let i = 0; i < xy.length; i += 2) points.push(xy[i], xy[i + 1], 0.5);
  return { id, points: Float32Array.from(points), color: 'ink' };
};

const rect = (id: string, x: number, y: number, w: number, h: number): InStroke =>
  line(id, x, y, x + w, y, x + w, y + h, x, y + h, x, y + 2);

const text = (id: string, x: number, y: number, value: string): InText => ({
  id,
  x,
  y,
  w: 120,
  h: value.split('\n').length * 20,
  text: value,
});

describe('the example in English', () => {
  it('fits the same drawn boxes, so it reads as the same five groups and a note', () => {
    const doc = createExampleDoc('en');
    const result = recognize(doc.strokes, doc.texts);
    expect(doc.title).toBe('Whiteboard: the plan');
    expect(result.groups.map((g) => g.title)).toEqual(['Capture', 'Group', 'AI digitizing', 'Later', 'Finished map']);
    expect(result.notes).toHaveLength(1);
  });
});

describe('recognize on the example sketch', () => {
  const doc = createExampleDoc('bg');
  const result = recognize(doc.strokes, doc.texts);

  it('finds the five groups and ignores the circle around one of them', () => {
    expect(result.groups.map((g) => g.title)).toEqual([
      'Улавяне',
      'Групиране',
      'AI дигитализация',
      'По-късно',
      'Готова карта',
    ]);
  });

  it('keeps the long sentence as a note', () => {
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0].text).toContain('Първо изваждам');
  });

  it('finds the four arrows with the direction they were drawn', () => {
    const titles = result.links.map(
      (l) => `${result.groups[l.from].title} > ${result.groups[l.to].title}`,
    );
    expect(titles.sort()).toEqual(
      [
        'Улавяне > Групиране',
        'Групиране > AI дигитализация',
        'AI дигитализация > Готова карта',
        'По-късно > Улавяне',
      ].sort(),
    );
  });

  it('splits typed lines into a title and items', () => {
    expect(result.groups[0].items).toEqual([
      'Рисувам свободно с мишката',
      'Пиша директно върху платното',
      'Първата черта без никакво забавяне',
    ]);
  });

  it('does not ask for vision when everything is typed', () => {
    expect(result.needsVision).toBe(false);
  });
});

describe('recognize', () => {
  it('returns nothing for an empty canvas', () => {
    expect(recognize([], [])).toEqual({ groups: [], notes: [], links: [], needsVision: false });
  });

  it('joins a box drawn with four separate strokes', () => {
    const result = recognize(
      [
        line('t', 0, 0, 200, 2),
        line('r', 202, 0, 200, 150),
        line('b', 200, 152, 0, 150),
        line('l', 0, 152, 2, 0),
      ],
      [text('a', 60, 60, 'Plan')],
    );
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].title).toBe('Plan');
    expect(result.groups[0].strokeIds).toHaveLength(4);
  });

  it('turns free multi-line text into a group, and strips list markers', () => {
    const result = recognize([], [text('a', 10, 10, 'Ideas\n- one\n• two')]);
    expect(result.groups[0].title).toBe('Ideas');
    expect(result.groups[0].items).toEqual(['one', 'two']);
  });

  it('honours the head when an arrow was drawn backwards', () => {
    const shaft = line('shaft', 200, 50, 500, 50);
    const head = line('head', 190, 40, 205, 50, 190, 60);
    const result = recognize(
      [rect('a', 0, 0, 180, 100), rect('b', 510, 0, 180, 100), shaft, head],
      [text('ta', 20, 30, 'Left'), text('tb', 530, 30, 'Right')],
    );
    expect(result.links).toHaveLength(1);
    expect(result.groups[result.links[0].from].title).toBe('Right');
    expect(result.groups[result.links[0].to].title).toBe('Left');
  });

  it('flags pen marks inside a shape as possible handwriting', () => {
    const marks = [1, 2, 3].map((n) => line(`m${n}`, 20 * n, 40, 20 * n + 12, 50));
    const result = recognize([rect('a', 0, 0, 300, 200), ...marks], []);
    expect(result.groups[0].inkIds).toHaveLength(3);
    expect(result.needsVision).toBe(true);
  });

  it('uses the colour the shape was drawn in', () => {
    const shape = { ...rect('a', 0, 0, 200, 120), color: 'pink' as const };
    expect(recognize([shape], [text('t', 50, 50, 'Hi')]).groups[0].color).toBe('pink');
  });
});
