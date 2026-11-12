import { describe, expect, it } from 'vitest';
import { createDoc, dropPending, removeBubble, shownParent, shownRoot, isShownIn } from './ops.ts';
import { acceptProposal, bindAiProposal, proposalLabel, rejectProposal, restoreProposal } from './proposals.ts';
import type { Bubble, MapDoc, Proposal } from './types.ts';
import { validateDoc } from './validate.ts';

const bubble = (id: string, over: Partial<Bubble> = {}): Bubble => ({
  id,
  kind: 'group',
  title: '',
  items: [{ id: `${id}-1`, text: `${id} one` }],
  status: 'pending',
  slot: 0,
  sketch: { x: 0, y: 0, w: 200 },
  map: { x: 0, y: 0, w: 300 },
  pinned: false,
  sourceStrokes: [`${id}-stroke`],
  sourceTexts: [],
  ...over,
});

const proposal = (id: string, body: Proposal['body'], origin: Proposal['origin'] = 'local'): Proposal => ({
  id,
  status: 'pending',
  origin,
  body,
});

/** A frame holding a box, an arrow from one line of the frame to an outside box, and AI ideas. */
const fixture = (): MapDoc => ({
  ...createDoc('Map'),
  bubbles: [bubble('frame'), bubble('inner', { parent: 'frame' }), bubble('goal')],
  links: [
    { id: 'l', from: 'frame', fromItem: 'frame-1', to: 'goal', status: 'pending', sourceStrokes: ['arrow'] },
  ],
  proposals: [
    proposal('pf', { kind: 'group', bubble: 'frame' }),
    proposal('pi', { kind: 'group', bubble: 'inner' }),
    proposal('pg', { kind: 'group', bubble: 'goal' }),
    proposal('pl', { kind: 'link', link: 'l' }),
    proposal('pn', { kind: 'label', link: 'l', label: 'builds', previous: '' }, 'ai'),
  ],
});

describe('nested proposals', () => {
  it('accepting a box drawn inside another accepts the one around it', () => {
    const doc = acceptProposal(fixture(), 'pi');
    expect(doc.bubbles.find((b) => b.id === 'frame')?.status).toBe('accepted');
    expect(doc.proposals.find((p) => p.id === 'pf')?.status).toBe('accepted');
  });

  it('rejecting the box around rejects what was read inside it, and restoring brings it back', () => {
    const rejected = rejectProposal(fixture(), 'pf');
    expect(rejected.bubbles.find((b) => b.id === 'inner')?.status).toBe('rejected');
    expect(rejected.links[0].status).toBe('rejected');
    const restored = restoreProposal(rejected, 'pf');
    expect(restored.bubbles.find((b) => b.id === 'inner')?.status).toBe('pending');
    expect(restored.links[0].status).toBe('pending');
  });

  it('naming an arrow labels it and accepts it', () => {
    const doc = acceptProposal(fixture(), 'pn');
    expect(doc.links[0]).toMatchObject({ label: 'builds', status: 'accepted' });
  });

  it('rejecting an arrow drops the name proposed for it', () => {
    const doc = rejectProposal(fixture(), 'pl');
    expect(doc.proposals.find((p) => p.id === 'pn')).toMatchObject({ status: 'rejected', cascadeOf: 'pl' });
  });

  it('names an arrow from a circled line by that line', () => {
    const doc = fixture();
    const label = proposalLabel(doc, doc.proposals.find((p) => p.id === 'pl') as Proposal);
    expect(label).toBe('Link: frame one → Untitled');
  });

  it('takes an AI arrow name only for an arrow that exists, one waiting name at a time', () => {
    const doc = { ...fixture(), proposals: [] };
    expect(bindAiProposal(doc, { kind: 'label', link: 'nope', label: 'x' }, (b) => b)).toBeNull();
    const bound = bindAiProposal(doc, { kind: 'label', link: 'l', label: 'builds' }, (b) => b);
    expect(bound?.proposal.body).toEqual({ kind: 'label', link: 'l', label: 'builds', previous: '' });
    const twice = { ...doc, proposals: [bound!.proposal] };
    expect(bindAiProposal(twice, { kind: 'label', link: 'l', label: 'builds' }, (b) => b)).toBeNull();
    expect(bindAiProposal(twice, { kind: 'label', link: 'l', label: 'helps' }, (b) => b)?.replaces).toBe(
      bound?.proposal.id,
    );
  });

  it('takes an AI arrow from a line only when that line is in that box', () => {
    const doc = { ...fixture(), proposals: [] };
    const wrong = bindAiProposal(doc, { kind: 'link', from: 'goal', fromItem: 'frame-1', to: 'inner' }, (b) => b);
    expect(wrong).toBeNull();
    const right = bindAiProposal(doc, { kind: 'link', from: 'goal', fromItem: 'goal-1', to: 'inner' }, (b) => b);
    expect(right?.link).toMatchObject({ from: 'goal', fromItem: 'goal-1', to: 'inner' });
  });

  it('moves an arrow along with the line it starts from', () => {
    const doc = {
      ...fixture(),
      proposals: [proposal('pm', { kind: 'move-item', item: 'frame-1', from: 'frame', to: 'goal' }, 'ai')],
    };
    expect(acceptProposal(doc, 'pm').links[0]).toMatchObject({ from: 'goal', fromItem: 'frame-1' });
  });
});

describe('where a bubble shows', () => {
  it('inside its parent when both show, on its own when the parent does not', () => {
    const doc = fixture();
    const inner = doc.bubbles[1];
    expect(shownParent(doc.bubbles, inner, isShownIn('both'))?.id).toBe('frame');
    expect(shownParent(doc.bubbles, inner, isShownIn('map'))).toBeUndefined();
    expect(shownRoot(doc.bubbles, inner, isShownIn('both')).id).toBe('frame');
  });

  it('deleting a box keeps what was drawn inside it', () => {
    const doc = removeBubble(fixture(), 'frame');
    expect(doc.bubbles.find((b) => b.id === 'inner')?.parent).toBeUndefined();
    expect(doc.links).toHaveLength(0);
  });
});

describe('reading the sketch again', () => {
  it('drops everything still waiting, and keeps what was accepted', () => {
    const accepted = acceptProposal(fixture(), 'pg');
    const doc = dropPending(accepted, null);
    expect(doc.bubbles.map((b) => b.id)).toEqual(['goal']);
    expect(doc.links).toHaveLength(0);
    expect(doc.proposals.every((p) => p.status !== 'pending')).toBe(true);
  });

  it('with a selection, drops only what was read from inside it', () => {
    const doc = dropPending(fixture(), new Set(['inner-stroke']));
    expect(doc.bubbles.map((b) => b.id)).toEqual(['frame', 'goal']);
    expect(doc.proposals.map((p) => p.id)).toEqual(['pf', 'pg', 'pl', 'pn']);
  });
});

describe('loading nesting from a file', () => {
  const load = (doc: MapDoc): MapDoc => validateDoc(JSON.parse(JSON.stringify(doc)));

  it('keeps parents, circled lines and arrow ends', () => {
    const doc = fixture();
    doc.bubbles[0].items[0].mark = 'aqua';
    doc.links[0].color = 'yellow';
    const loaded = load(doc);
    expect(loaded.bubbles[1].parent).toBe('frame');
    expect(loaded.bubbles[0].items[0].mark).toBe('aqua');
    expect(loaded.links[0].fromItem).toBe('frame-1');
    expect(loaded.links[0].color).toBe('yellow');
    expect(loaded.proposals[4].body).toEqual({ kind: 'label', link: 'l', label: 'builds', previous: '' });
  });

  it('drops a parent that is missing or loops, and an arrow end naming a missing line', () => {
    const doc = fixture();
    doc.bubbles[0].parent = 'inner';
    doc.bubbles[2].parent = 'ghost';
    doc.links[0].toItem = 'ghost-line';
    const loaded = load(doc);
    expect(loaded.bubbles.map((b) => b.parent)).toEqual([undefined, undefined, undefined]);
    expect(loaded.links[0].toItem).toBeUndefined();
    expect(loaded.links[0].fromItem).toBe('frame-1');
  });
});

describe('naming a list after its own first line', () => {
  it('makes that line the heading instead of repeating it', () => {
    const doc: MapDoc = {
      ...createDoc('Map'),
      bubbles: [
        bubble('b', {
          items: [
            { id: 'h', text: 'Back end' },
            { id: 'p', text: 'Payments', mark: 'yellow' },
          ],
        }),
        bubble('goal'),
      ],
      links: [{ id: 'l', from: 'b', fromItem: 'h', to: 'goal', status: 'accepted', sourceStrokes: [] }],
      proposals: [proposal('r', { kind: 'rename', bubble: 'b', title: 'back end', previous: '' }, 'ai')],
    };
    const next = acceptProposal(doc, 'r');
    expect(next.bubbles[0].title).toBe('back end');
    expect(next.bubbles[0].items.map((i) => i.text)).toEqual(['Payments']);
    expect(next.links[0].fromItem).toBeUndefined();
  });
});
