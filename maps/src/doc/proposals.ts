import type { AiProposal } from '../../shared/digitize.ts';
import { newId, updateBubble } from './ops.ts';
import type { Bubble, Id, MapDoc, Proposal, Status } from './types.ts';

const bubbleOf = (doc: MapDoc, id: Id): Bubble | undefined => doc.bubbles.find((b) => b.id === id);

/** New proposals may only aim at bubbles still in play. */
const liveBubble = (doc: MapDoc, id: Id): Bubble | undefined => {
  const bubble = bubbleOf(doc, id);
  return bubble?.status === 'rejected' ? undefined : bubble;
};

const dependsOn = (proposal: Proposal, doc: MapDoc, bubble: Id): boolean => {
  const body = proposal.body;
  switch (body.kind) {
    case 'rename':
    case 'rewrite':
    case 'add-item':
      return body.bubble === bubble;
    case 'move-item':
      return body.from === bubble || body.to === bubble;
    case 'link': {
      const link = doc.links.find((l) => l.id === body.link);
      return link?.from === bubble || link?.to === bubble;
    }
    default:
      return false;
  }
};

const setProposalStatus = (doc: MapDoc, id: Id, status: Status, cascadeOf?: Id): MapDoc => ({
  ...doc,
  proposals: doc.proposals.map((p) => (p.id === id ? { ...p, status, cascadeOf } : p)),
});

const applyBody = (doc: MapDoc, proposal: Proposal): MapDoc => {
  const body = proposal.body;
  switch (body.kind) {
    case 'group':
    case 'note':
      return updateBubble(doc, body.bubble, { status: 'accepted' });
    case 'link':
      return {
        ...doc,
        links: doc.links.map((l) => (l.id === body.link ? { ...l, status: 'accepted' } : l)),
      };
    case 'rename':
      return updateBubble(doc, body.bubble, { title: body.title });
    case 'rewrite': {
      // Search every bubble, because a move accepted just before may have carried the item away.
      const bubble = doc.bubbles.find((b) => b.items.some((i) => i.id === body.item));
      if (!bubble) return doc;
      return updateBubble(doc, bubble.id, {
        items: bubble.items.map((i) => (i.id === body.item ? { ...i, text: body.text } : i)),
      });
    }
    case 'add-item': {
      const bubble = bubbleOf(doc, body.bubble);
      if (!bubble) return doc;
      return updateBubble(doc, body.bubble, {
        items: [...bubble.items, { id: newId(), text: body.text }],
      });
    }
    case 'move-item': {
      const from = bubbleOf(doc, body.from);
      const to = bubbleOf(doc, body.to);
      const item = from?.items.find((i) => i.id === body.item);
      if (!from || !to || !item) return doc;
      const removed = updateBubble(doc, body.from, {
        items: from.items.filter((i) => i.id !== body.item),
      });
      const moved = updateBubble(removed, body.to, { items: [...to.items, item] });
      // Accepting a move into a waiting group accepts that group too, or the item would be hidden.
      const group = moved.proposals.find(
        (p) => p.status === 'pending' && p.body.kind === 'group' && p.body.bubble === body.to,
      );
      return group ? acceptProposal(moved, group.id) : moved;
    }
    case 'map-title':
      return { ...doc, title: body.title };
    case 'summary':
      return { ...doc, summary: body.text };
  }
};

export const acceptProposal = (doc: MapDoc, id: Id): MapDoc => {
  const proposal = doc.proposals.find((p) => p.id === id);
  if (!proposal || proposal.status !== 'pending') return doc;
  return setProposalStatus(applyBody(doc, proposal), id, 'accepted');
};

export const rejectProposal = (doc: MapDoc, id: Id): MapDoc => {
  const proposal = doc.proposals.find((p) => p.id === id);
  if (!proposal || proposal.status !== 'pending') return doc;
  const body = proposal.body;
  let next = setProposalStatus(doc, id, 'rejected');
  if (body.kind === 'link') {
    next = {
      ...next,
      links: next.links.map((l) => (l.id === body.link ? { ...l, status: 'rejected' } : l)),
    };
  }
  if (body.kind === 'group' || body.kind === 'note') {
    next = updateBubble(next, body.bubble, { status: 'rejected' });
    // A link or rename aimed at a rejected bubble has nothing left to act on.
    for (const other of next.proposals) {
      if (other.status === 'pending' && dependsOn(other, next, body.bubble)) {
        next = rejectProposal(next, other.id);
        next = setProposalStatus(next, other.id, 'rejected', id);
      }
    }
  }
  return next;
};

/** Brings a rejected proposal back to pending, along with anything its rejection took down. */
export const restoreProposal = (doc: MapDoc, id: Id): MapDoc => {
  const proposal = doc.proposals.find((p) => p.id === id);
  if (!proposal || proposal.status !== 'rejected') return doc;
  const body = proposal.body;
  let next = setProposalStatus(doc, id, 'pending');
  if (body.kind === 'group' || body.kind === 'note') {
    next = updateBubble(next, body.bubble, { status: 'pending' });
  }
  if (body.kind === 'link') {
    next = {
      ...next,
      links: next.links.map((l) => (l.id === body.link ? { ...l, status: 'pending' } : l)),
    };
  }
  for (const other of next.proposals) {
    if (other.cascadeOf === id) next = restoreProposal(next, other.id);
  }
  return next;
};

export const acceptAll = (doc: MapDoc): MapDoc => {
  // Groups go first, so a rename or a moved item lands on a bubble that is already on the map.
  const order = (p: Proposal): number =>
    p.body.kind === 'group' || p.body.kind === 'note' ? 0 : 1;
  const pending = doc.proposals
    .filter((p) => p.status === 'pending')
    .sort((a, b) => order(a) - order(b));
  return pending.reduce((next, p) => acceptProposal(next, p.id), doc);
};

/** The proposal Y and N act on, and the one the panel highlights. They must always agree. */
export const currentProposal = (doc: MapDoc, focused: Id | null): Proposal | undefined => {
  const pending = doc.proposals.filter((p) => p.status === 'pending' && isLiveProposal(doc, p));
  return (
    pending.find((p) => p.id === focused) ?? pending.find((p) => p.origin === 'ai') ?? pending[0]
  );
};

/** A proposal whose target is gone, after an undo or an edit, no longer shows. */
export const isLiveProposal = (doc: MapDoc, proposal: Proposal): boolean => {
  const body = proposal.body;
  switch (body.kind) {
    case 'group':
    case 'note':
    case 'rename':
    case 'add-item':
      return Boolean(bubbleOf(doc, body.bubble));
    case 'rewrite':
      // Any bubble will do, because an accepted move may have carried the item away.
      return doc.bubbles.some((b) => b.items.some((i) => i.id === body.item));
    case 'move-item':
      return Boolean(
        bubbleOf(doc, body.from)?.items.some((i) => i.id === body.item) && bubbleOf(doc, body.to),
      );
    case 'link':
      return doc.links.some((l) => l.id === body.link);
    case 'map-title':
    case 'summary':
      return true;
  }
};

export const proposalLabel = (doc: MapDoc, proposal: Proposal): string => {
  const body = proposal.body;
  // A group of handwriting has no title yet, so it goes by the name waiting for it.
  const pendingName = (id: Id): string | undefined => {
    for (const p of doc.proposals) {
      if (p.status === 'pending' && p.body.kind === 'rename' && p.body.bubble === id) {
        return p.body.title;
      }
    }
    return undefined;
  };
  const name = (id: Id): string => bubbleOf(doc, id)?.title || pendingName(id) || 'Untitled';
  switch (body.kind) {
    case 'group':
      return `Group: ${name(body.bubble)}`;
    case 'note':
      return `Note: ${name(body.bubble)}`;
    case 'link': {
      const link = doc.links.find((l) => l.id === body.link);
      return link ? `Link: ${name(link.from)} → ${name(link.to)}` : 'Link';
    }
    case 'rename':
      return body.previous ? `Rename: ${body.previous} → ${body.title}` : `Name: ${body.title}`;
    case 'rewrite':
      return `Rewrite: ${body.previous} → ${body.text}`;
    case 'add-item':
      return `Add to ${name(body.bubble)}: ${body.text}`;
    case 'move-item': {
      const item = bubbleOf(doc, body.from)?.items.find((i) => i.id === body.item);
      return `Move: ${item?.text ?? 'item'} → ${name(body.to)}`;
    }
    case 'map-title':
      return `Title: ${body.title}`;
    case 'summary':
      return `Summary: ${body.text}`;
  }
};

/**
 * Turns a validated AI line into document changes. Returns null when it names ids that do not
 * exist, or repeats what the map already says. A new group arrives as a pending bubble.
 */
export const bindAiProposal = (
  doc: MapDoc,
  ai: AiProposal,
  placeNew: (bubble: Bubble) => Bubble,
): { proposal: Proposal; bubble?: Bubble; link?: MapDoc['links'][number] } | null => {
  const make = (body: Proposal['body']): Proposal => ({
    id: newId(),
    status: 'pending',
    origin: 'ai',
    body,
  });
  const duplicate = (test: (p: Proposal) => boolean): boolean => doc.proposals.some(test);
  switch (ai.kind) {
    case 'map-title':
      if (ai.title === doc.title || duplicate((p) => p.body.kind === 'map-title')) return null;
      return { proposal: make({ kind: 'map-title', title: ai.title, previous: doc.title }) };
    case 'summary':
      if (duplicate((p) => p.body.kind === 'summary' && p.status === 'pending')) return null;
      return { proposal: make({ kind: 'summary', text: ai.text }) };
    case 'rename': {
      const bubble = liveBubble(doc, ai.bubble);
      if (!bubble || bubble.title === ai.title) return null;
      return {
        proposal: make({
          kind: 'rename',
          bubble: bubble.id,
          title: ai.title,
          previous: bubble.title,
        }),
      };
    }
    case 'rewrite': {
      const item = liveBubble(doc, ai.bubble)?.items.find((i) => i.id === ai.item);
      if (!item || item.text === ai.text) return null;
      return {
        proposal: make({
          kind: 'rewrite',
          bubble: ai.bubble,
          item: item.id,
          text: ai.text,
          previous: item.text,
        }),
      };
    }
    case 'add-item':
      // A note shows one sentence and no list, so an item added to it would simply vanish.
      if (liveBubble(doc, ai.bubble)?.kind !== 'group') return null;
      return { proposal: make({ kind: 'add-item', bubble: ai.bubble, text: ai.text }) };
    case 'move-item':
      if (!liveBubble(doc, ai.from)?.items.some((i) => i.id === ai.item)) return null;
      if (liveBubble(doc, ai.to)?.kind !== 'group') return null;
      return { proposal: make({ kind: 'move-item', item: ai.item, from: ai.from, to: ai.to }) };
    case 'link': {
      if (!liveBubble(doc, ai.from) || !liveBubble(doc, ai.to)) return null;
      const exists = doc.links.some(
        (l) => l.from === ai.from && l.to === ai.to && l.status !== 'rejected',
      );
      if (exists) return null;
      const link = {
        id: newId(),
        from: ai.from,
        to: ai.to,
        status: 'pending' as const,
        label: ai.label,
        sourceStrokes: [],
      };
      return { proposal: make({ kind: 'link', link: link.id }), link };
    }
    case 'group': {
      const bubble = placeNew({
        id: newId(),
        kind: 'group',
        title: ai.title,
        items: ai.items.map((text) => ({ id: newId(), text })),
        status: 'pending',
        slot: doc.bubbles.length % 5,
        sketch: { x: 0, y: 0, w: 280 },
        map: { x: 0, y: 0, w: 300 },
        pinned: false,
        sourceStrokes: [],
        sourceTexts: [],
      });
      return { proposal: make({ kind: 'group', bubble: bubble.id }), bubble };
    }
  }
};
