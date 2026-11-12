import { describe, expect, it } from 'vitest';
import { buildUserPrompt } from './prompt.ts';

describe('what the AI is shown', () => {
  const prompt = JSON.parse(
    buildUserPrompt({
      title: 'Untitled map',
      bubbles: [
        {
          id: 'big',
          kind: 'group',
          title: '',
          items: [
            { id: 'i1', text: 'Library', mark: 'aqua' },
            { id: 'i2', text: 'Workshops' },
          ],
        },
        { id: 'inner', kind: 'group', title: 'Inner', items: [], parent: 'big' },
        { id: 'goal', kind: 'group', title: 'Goals', items: [{ id: 'g1', text: 'More visitors' }] },
      ],
      links: [
        { id: 'l1', from: 'big', fromItem: 'i1', to: 'goal', color: 'aqua' },
        { id: 'l2', from: 'big', to: 'goal' },
      ],
      looseText: [],
    }),
  ) as {
    boxes: { id: string; inside?: { id: string }[]; lines?: { circled?: string }[] }[];
    arrows: { id: string; reads: string; drawn?: string }[];
  };

  it('gets the boxes as a tree, with circled lines', () => {
    expect(prompt.boxes.map((b) => b.id)).toEqual(['big', 'goal']);
    expect(prompt.boxes[0].inside?.map((b) => b.id)).toEqual(['inner']);
    expect(prompt.boxes[0].lines?.[0].circled).toBe('aqua');
  });

  it('gets every arrow spelled out, from a line or from the whole box, with its colour', () => {
    expect(prompt.arrows[0]).toMatchObject({
      reads: 'line "Library" of box untitled ("Library", "Workshops") → whole box "Goals"',
      drawn: 'aqua',
    });
    expect(prompt.arrows[1].reads).toBe(
      'whole box untitled ("Library", "Workshops") → whole box "Goals"',
    );
  });
});

describe('things written with no box around them', () => {
  const prompt = JSON.parse(
    buildUserPrompt({
      title: 'Untitled map',
      bubbles: [
        {
          id: 'people',
          kind: 'group',
          title: '',
          items: [
            { id: 'p1', text: 'Anton' },
            { id: 'p2', text: 'Boris' },
          ],
        },
        { id: 'car', kind: 'group', title: 'Skoda', items: [], free: true },
      ],
      links: [{ id: 'l1', from: 'people', fromItem: 'p1', to: 'car' }],
      looseText: [],
    }),
  ) as { boxes: { id: string; free?: boolean }[]; arrows: { reads: string }[] };

  it('marks a word typed on its own as free, so the AI reads it as one thing', () => {
    expect(prompt.boxes.find((b) => b.id === 'car')?.free).toBe(true);
  });

  it('spells an arrow to it as going to that word', () => {
    expect(prompt.arrows[0].reads).toBe('line "Anton" of box untitled ("Anton", "Boris") → word "Skoda"');
  });
});
