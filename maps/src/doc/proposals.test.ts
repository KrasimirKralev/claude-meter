import { describe, expect, it } from 'vitest';
import { createDoc } from './ops.ts';
import {
  acceptAll,
  acceptProposal,
  bindAiProposal,
  currentProposal,
  isLiveProposal,
  rejectProposal,
  restoreProposal,
} from './proposals.ts';
import type { Bubble, MapDoc } from './types.ts';

const bubble = (id: string, title: string): Bubble => ({
  id,
  kind: 'group',
  title,
  items: [{ id: `${id}-1`, text: 'one' }],
  status: 'pending',
  slot: 0,
  sketch: { x: 0, y: 0, w: 200 },
  map: { x: 0, y: 0, w: 300 },
  pinned: false,
  sourceStrokes: [],
  sourceTexts: ['text-1'],
});

const fixture = (): MapDoc => ({
  ...createDoc('Map'),
  bubbles: [bubble('a', 'Alpha'), bubble('b', 'Beta')],
  links: [{ id: 'l', from: 'a', to: 'b', status: 'pending', sourceStrokes: [] }],
  proposals: [
    { id: 'pa', status: 'pending', origin: 'local', body: { kind: 'group', bubble: 'a' } },
    { id: 'pb', status: 'pending', origin: 'local', body: { kind: 'group', bubble: 'b' } },
    { id: 'pl', status: 'pending', origin: 'local', body: { kind: 'link', link: 'l' } },
    {
      id: 'pr',
      status: 'pending',
      origin: 'ai',
      body: { kind: 'rename', bubble: 'a', title: 'Alpha 2', previous: 'Alpha' },
    },
  ],
});

describe('proposals', () => {
  it('changes nothing on the map until a proposal is accepted', () => {
    const doc = fixture();
    expect(doc.bubbles[0].title).toBe('Alpha');
    const accepted = acceptProposal(doc, 'pr');
    expect(accepted.bubbles[0].title).toBe('Alpha 2');
    expect(doc.bubbles[0].title).toBe('Alpha');
  });

  it('rejecting a group takes down links and renames aimed at it, and restore brings them back', () => {
    const rejected = rejectProposal(fixture(), 'pa');
    const status = (doc: MapDoc, id: string) => doc.proposals.find((p) => p.id === id)?.status;
    expect(rejected.bubbles[0].status).toBe('rejected');
    expect(status(rejected, 'pl')).toBe('rejected');
    expect(status(rejected, 'pr')).toBe('rejected');
    expect(status(rejected, 'pb')).toBe('pending');

    const restored = restoreProposal(rejected, 'pa');
    expect(restored.bubbles[0].status).toBe('pending');
    expect(status(restored, 'pl')).toBe('pending');
    expect(status(restored, 'pr')).toBe('pending');
    expect(restored.links[0].status).toBe('pending');
  });

  it('accept all puts groups on the map before renames', () => {
    const doc = acceptAll(fixture());
    expect(doc.bubbles.map((b) => b.status)).toEqual(['accepted', 'accepted']);
    expect(doc.bubbles[0].title).toBe('Alpha 2');
    expect(doc.links[0].status).toBe('accepted');
    expect(doc.proposals.every((p) => p.status === 'accepted')).toBe(true);
  });
});

describe('bindAiProposal', () => {
  const place = (b: Bubble): Bubble => b;

  it('drops proposals that name ids that do not exist', () => {
    const doc = fixture();
    expect(bindAiProposal(doc, { kind: 'rename', bubble: 'nope', title: 'x' }, place)).toBeNull();
    expect(bindAiProposal(doc, { kind: 'link', from: 'a', to: 'nope' }, place)).toBeNull();
    expect(
      bindAiProposal(doc, { kind: 'move-item', item: 'nope', from: 'a', to: 'b' }, place),
    ).toBeNull();
  });

  it('drops a rename that changes nothing and a link that already exists', () => {
    const doc = fixture();
    expect(bindAiProposal(doc, { kind: 'rename', bubble: 'a', title: 'Alpha' }, place)).toBeNull();
    expect(bindAiProposal(doc, { kind: 'link', from: 'a', to: 'b' }, place)).toBeNull();
  });

  it('lets a later name for the same arrow or box replace the one still waiting', () => {
    const doc = fixture();
    const first = bindAiProposal(doc, { kind: 'label', link: 'l', label: 'has' }, place);
    const withFirst = { ...doc, proposals: [...doc.proposals, first!.proposal] };
    const second = bindAiProposal(withFirst, { kind: 'label', link: 'l', label: 'drives' }, place);
    expect(second?.replaces).toBe(first?.proposal.id);
    // The rename already waiting in the fixture came from the AI too.
    expect(bindAiProposal(doc, { kind: 'rename', bubble: 'a', title: 'Alpha 3' }, place)?.replaces).toBe('pr');
  });

  it('drops a new group that only repeats things already on the map', () => {
    const doc = fixture();
    expect(bindAiProposal(doc, { kind: 'group', title: 'Cars', items: ['one', 'Beta'] }, place)).toBeNull();
    expect(bindAiProposal(doc, { kind: 'group', title: 'Cars', items: ['one', 'two'] }, place)).not.toBeNull();
  });

  it('creates a pending bubble for a new group', () => {
    const bound = bindAiProposal(fixture(), { kind: 'group', title: 'New', items: ['x'] }, place);
    expect(bound?.bubble?.status).toBe('pending');
    expect(bound?.proposal.body.kind).toBe('group');
  });
});

describe('proposals aimed at the wrong thing', () => {
  const place = (b: Bubble): Bubble => b;
  const withNote = (): MapDoc => ({
    ...fixture(),
    bubbles: [...fixture().bubbles, { ...bubble('n', 'Note'), kind: 'note', items: [] }],
  });

  it('refuses to add or move an item into a note, where it would vanish', () => {
    const doc = withNote();
    expect(bindAiProposal(doc, { kind: 'add-item', bubble: 'n', text: 'x' }, place)).toBeNull();
    expect(
      bindAiProposal(doc, { kind: 'move-item', item: 'a-1', from: 'a', to: 'n' }, place),
    ).toBeNull();
  });

  it('refuses a new proposal aimed at a rejected bubble', () => {
    const doc = rejectProposal(fixture(), 'pa');
    expect(bindAiProposal(doc, { kind: 'rename', bubble: 'a', title: 'x' }, place)).toBeNull();
  });

  it('accepting a move into a waiting group puts that group on the map too', () => {
    const doc: MapDoc = {
      ...fixture(),
      proposals: [
        ...fixture().proposals,
        {
          id: 'pm',
          status: 'pending',
          origin: 'ai',
          body: { kind: 'move-item', item: 'a-1', from: 'a', to: 'b' },
        },
      ],
    };
    const accepted = acceptProposal(doc, 'pm');
    expect(accepted.bubbles.find((b) => b.id === 'b')?.status).toBe('accepted');
    expect(accepted.bubbles.find((b) => b.id === 'b')?.items.map((i) => i.id)).toContain('a-1');
  });

  it('a rewrite accepted after a move still finds the item', () => {
    const doc: MapDoc = {
      ...fixture(),
      proposals: [
        {
          id: 'pm',
          status: 'pending',
          origin: 'ai',
          body: { kind: 'move-item', item: 'a-1', from: 'a', to: 'b' },
        },
        {
          id: 'pw',
          status: 'pending',
          origin: 'ai',
          body: { kind: 'rewrite', bubble: 'a', item: 'a-1', text: 'new', previous: 'one' },
        },
      ],
    };
    const moved = acceptAll(doc).bubbles.find((b) => b.id === 'b');
    expect(moved?.items.find((i) => i.id === 'a-1')?.text).toBe('new');
  });
});

describe('currentProposal', () => {
  it('prefers the focused one, then the first AI idea, then the first waiting', () => {
    const doc = fixture();
    expect(currentProposal(doc, 'pb')?.id).toBe('pb');
    expect(currentProposal(doc, null)?.id).toBe('pr');
    const noAi = { ...doc, proposals: doc.proposals.filter((p) => p.origin === 'local') };
    expect(currentProposal(noAi, null)?.id).toBe('pa');
  });
});

describe('isLiveProposal', () => {
  it('keeps a rewrite alive after its item moved to another bubble', () => {
    const doc = fixture();
    const moved: MapDoc = {
      ...doc,
      bubbles: [
        { ...doc.bubbles[0], items: [] },
        { ...doc.bubbles[1], items: [...doc.bubbles[1].items, doc.bubbles[0].items[0]] },
      ],
    };
    expect(
      isLiveProposal(moved, {
        id: 'w',
        status: 'pending',
        origin: 'ai',
        body: { kind: 'rewrite', bubble: 'a', item: 'a-1', text: 'x', previous: 'one' },
      }),
    ).toBe(true);
  });

  it('hides a proposal whose target is gone', () => {
    const doc = { ...fixture(), bubbles: [] };
    expect(isLiveProposal(doc, doc.proposals[3])).toBe(false);
  });
});
