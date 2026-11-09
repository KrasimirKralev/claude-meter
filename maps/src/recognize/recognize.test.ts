import { describe, expect, it } from 'vitest';
import { createExampleDoc } from '../doc/example.ts';
import { NESTED_STROKES, NESTED_TEXTS } from './nested-sketch.fixture.ts';
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
    expect(result.groups[0].items.map((i) => i.text)).toEqual([
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
    expect(result.groups[0].items).toEqual([{ text: 'one' }, { text: 'two' }]);
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

describe('a nested sketch: lines in a box, two of them circled, arrows from the circles', () => {
  const result = recognize(NESTED_STROKES, NESTED_TEXTS);
  const big = result.groups.findIndex((g) => g.items.some((i) => i.text === 'Library'));
  const byFirst = (text: string): number =>
    result.groups.findIndex((g) => g.items[0]?.text === text || g.title === text);

  it('reads four boxes, and no circle becomes a box of its own', () => {
    expect(result.groups).toHaveLength(4);
    expect(result.notes).toHaveLength(0);
    expect(result.groups.every((g) => g.parent === undefined)).toBe(true);
  });

  it('keeps the three lines of the big box together, in order, with their circles', () => {
    expect(result.groups[big].items).toEqual([
      { text: 'Library', mark: 'aqua' },
      { text: 'member registration', mark: 'yellow' },
      { text: 'Workshoops' },
    ]);
    // Separately typed lines are equals, so none of them is promoted to the title.
    expect(result.groups[big].title).toBe('');
    expect(result.groups[big].strokeIds.sort()).toEqual(['bigBox', 'ringA', 'ringB']);
  });

  it('reads the other boxes as lists of equals too', () => {
    for (const text of ['Build more pride', 'Better signs', 'Will raise visitor count']) {
      const group = result.groups[byFirst(text)];
      expect(group.title).toBe('');
      expect(group.items).toHaveLength(2);
    }
  });

  it('starts each arrow where it was drawn from: a circled line, or the whole box', () => {
    const read = result.links.map((l) => {
      const from = result.groups[l.from];
      const start = l.fromItem === undefined ? 'box' : from.items[l.fromItem].text;
      return `${l.from === big ? 'big' : '?'}:${start} > ${result.groups[l.to].items[0].text}`;
    });
    expect(read.sort()).toEqual([
      'big:Library > Build more pride',
      'big:box > Will raise visitor count',
      'big:member registration > Better signs',
    ]);
  });
});

describe('nesting', () => {
  const platform = rect('outer', 0, 0, 700, 400);
  const left = rect('left', 40, 80, 260, 260);
  const right = rect('right', 380, 80, 260, 260);
  const goal = rect('goal', 900, 100, 240, 160);
  const arrow = { ...line('arrow', 640, 200, 900, 180), arrow: true };
  const result = recognize(
    [platform, left, right, goal, arrow],
    [
      text('t0', 40, 20, 'Platform'),
      text('t1', 60, 100, 'Front end\n- pages\n- forms'),
      text('t2', 400, 100, 'Back end\n- API'),
      text('t3', 920, 120, 'Launch'),
    ],
  );
  const named = (title: string): number => result.groups.findIndex((g) => g.title === title);

  it('puts a box drawn inside a box under it, with its own title and lines', () => {
    expect(result.groups[named('Front end')].parent).toBe(named('Platform'));
    expect(result.groups[named('Back end')].parent).toBe(named('Platform'));
    expect(result.groups[named('Platform')].parent).toBeUndefined();
    expect(result.groups[named('Front end')].items.map((i) => i.text)).toEqual(['pages', 'forms']);
  });

  it('starts an arrow at the innermost box it leaves', () => {
    expect(result.links).toHaveLength(1);
    expect(result.links[0].from).toBe(named('Back end'));
    expect(result.links[0].to).toBe(named('Launch'));
  });

  it('keeps an empty frame around several boxes as an untitled box that holds them', () => {
    const frame = recognize(
      [rect('frame', 0, 0, 700, 400), left, right],
      [text('t1', 60, 100, 'Front end'), text('t2', 400, 100, 'Back end')],
    );
    const outer = frame.groups.findIndex((g) => g.title === '' && g.items.length === 0);
    expect(outer).toBeGreaterThanOrEqual(0);
    expect(frame.groups.filter((g) => g.parent === outer)).toHaveLength(2);
  });

  it('lets an arrow point at one circled line', () => {
    const into = recognize(
      [
        rect('a', 0, 0, 200, 120),
        rect('b', 400, 0, 300, 200),
        rect('ring', 430, 90, 140, 50),
        { ...line('arrow', 200, 60, 428, 112), arrow: true },
      ],
      [text('ta', 20, 40, 'Start'), text('tb', 440, 30, 'Goals'), text('tc', 445, 100, 'Speed')],
    );
    const goals = into.groups.findIndex((g) => g.items.some((i) => i.text === 'Speed'));
    expect(into.links).toEqual([
      expect.objectContaining({ to: goals, toItem: into.groups[goals].items.findIndex((i) => i.text === 'Speed') }),
    ]);
  });
});

describe('titles', () => {
  const box = rect('box', 0, 0, 400, 300);
  const titleOf = (texts: InText[]): string => recognize([box], texts).groups[0].title;

  it('takes the first line of one typed block as the title', () => {
    expect(titleOf([text('a', 20, 20, 'Plan\nOne\nTwo')])).toBe('Plan');
  });

  it('gives separately typed equals no title', () => {
    expect(titleOf([text('a', 20, 20, 'One'), text('b', 20, 60, 'Two'), text('c', 20, 100, 'Three')])).toBe('');
  });

  it('takes a first line that ends with a colon, without the colon', () => {
    expect(titleOf([text('a', 20, 20, 'Goals:'), text('b', 20, 60, 'Two')])).toBe('Goals');
  });

  it('takes a first line that stands clearly apart from the rest', () => {
    expect(
      titleOf([text('a', 20, 10, 'Plan'), text('b', 20, 90, 'One'), text('c', 20, 120, 'Two'), text('d', 20, 150, 'Three')]),
    ).toBe('Plan');
  });

  it('takes a lone line above a typed list as its title', () => {
    expect(titleOf([text('a', 20, 10, 'Plan'), text('b', 20, 50, 'One\nTwo')])).toBe('Plan');
  });
});

describe('a heading set to the left', () => {
  const box = rect('box', 0, 0, 400, 300);
  it('counts only a clear step, not hand placement', () => {
    const at = (x: number) =>
      recognize([box], [text('a', x, 20, 'Back end'), text('b', 40, 60, 'Orders'), text('c', 40, 100, 'Stock')])
        .groups[0].title;
    expect(at(20)).toBe('Back end');
    expect(at(32)).toBe('');
  });
});
