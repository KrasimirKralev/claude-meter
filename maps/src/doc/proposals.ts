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
    case 'link':
    case 'label': {
      const link = doc.links.find((l) => l.id === body.link);
      return link?.from === bubble || link?.to === bubble;
    }
    // A box read inside a rejected box was part of the same wrong reading.
    case 'group':
    case 'note':
      return bubbleOf(doc, body.bubble)?.parent === bubble;
    default:
      return false;
  }
};

/** The waiting proposal that would put this bubble on the map, if there is one. */
const pendingBubbleProposal = (doc: MapDoc, bubble: Id): Proposal | undefined =>
  doc.proposals.find(
    (p) =>
      p.status === 'pending' &&
      (p.body.kind === 'group' || p.body.kind === 'note') &&
      p.body.bubble === bubble,
  );

const setProposalStatus = (doc: MapDoc, id: Id, status: Status, cascadeOf?: Id): MapDoc => ({
  ...doc,
  proposals: doc.proposals.map((p) => (p.id === id ? { ...p, status, cascadeOf } : p)),
});

const applyBody = (doc: MapDoc, proposal: Proposal): MapDoc => {
  const body = proposal.body;
  switch (body.kind) {
    case 'group':
    case 'note': {
      const accepted = updateBubble(doc, body.bubble, { status: 'accepted' });
      // A box drawn inside another one keeps its place: accepting it accepts the box around it.
      const parent = bubbleOf(accepted, body.bubble)?.parent;
      const around = parent ? pendingBubbleProposal(accepted, parent) : undefined;
      return around ? acceptProposal(accepted, around.id) : accepted;
    }
    case 'link':
      return {
        ...doc,
        links: doc.links.map((l) => (l.id === body.link ? { ...l, status: 'accepted' } : l)),
      };
    case 'label': {
      const named = {
        ...doc,
        links: doc.links.map((l) => (l.id === body.link ? { ...l, label: body.label } : l)),
      };
      // Naming a waiting arrow says the arrow is wanted, so it joins the map with its name.
      const arrow = named.proposals.find(
        (p) => p.status === 'pending' && p.body.kind === 'link' && p.body.link === body.link,
      );
      return arrow ? acceptProposal(named, arrow.id) : named;
    }
    case 'rename': {
      const bubble = bubbleOf(doc, body.bubble);
      const [first, ...rest] = bubble?.items ?? [];
      const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();
      // Naming an untitled list after its own first line makes that line the heading, not a copy.
      if (bubble && !bubble.title && first && same(first.text, body.title)) {
        const promoted = updateBubble(doc, body.bubble, { title: body.title, items: rest });
        return {
          ...promoted,
          links: promoted.links.map((l) => {
            if (l.fromItem !== first.id && l.toItem !== first.id) return l;
            const next = { ...l };
            if (next.fromItem === first.id) delete next.fromItem;
            if (next.toItem === first.id) delete next.toItem;
            return next;
          }),
        };
      }
      return updateBubble(doc, body.bubble, { title: body.title });
    }
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
      const carried = updateBubble(removed, body.to, { items: [...to.items, item] });
      // An arrow from or to that line now belongs to the bubble the line moved into.
      const moved = {
        ...carried,
        links: carried.links.map((l) => ({
          ...l,
          from: l.fromItem === body.item ? body.to : l.from,
          to: l.toItem === body.item ? body.to : l.to,
        })),
      };
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
    // A name for an arrow that is not wanted has nothing left to name.
    for (const other of next.proposals) {
      if (other.status === 'pending' && other.body.kind === 'label' && other.body.link === body.link) {
        next = setProposalStatus(next, other.id, 'rejected', id);
      }
    }
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
    p.body.kind === 'group' || p.body.kind === 'note' ? 0 : p.body.kind === 'link' ? 1 : 2;
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
    case 'label':
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
  // An arrow from one circled line is named by that line, not by the whole box around it.
  const end = (link: MapDoc['links'][number], side: 'from' | 'to'): string => {
    const itemId = side === 'from' ? link.fromItem : link.toItem;
    const bubbleId = link[side];
    const item = itemId ? bubbleOf(doc, bubbleId)?.items.find((i) => i.id === itemId) : undefined;
    return item?.text || name(bubbleId);
  };
  switch (body.kind) {
    case 'group':
      return `Group: ${name(body.bubble)}`;
    case 'note':
      return `Note: ${name(body.bubble)}`;
    case 'link': {
      const link = doc.links.find((l) => l.id === body.link);
      return link ? `Link: ${end(link, 'from')} → ${end(link, 'to')}` : 'Link';
    }
    case 'label': {
      const link = doc.links.find((l) => l.id === body.link);
      const route = link ? `${end(link, 'from')} → ${end(link, 'to')}: ` : '';
      return `Arrow: ${route}${body.label}`;
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
): {
  proposal: Proposal;
  bubble?: Bubble;
  link?: MapDoc['links'][number];
  /** A waiting AI proposal this one supersedes: the model changed its mind while streaming. */
  replaces?: Id;
} | null => {
  const make = (body: Proposal['body']): Proposal => ({
    id: newId(),
    status: 'pending',
    origin: 'ai',
    body,
  });
  const duplicate = (test: (p: Proposal) => boolean): boolean => doc.proposals.some(test);
  const waitingAi = (test: (p: Proposal) => boolean): Id | undefined =>
    doc.proposals.find((p) => p.status === 'pending' && p.origin === 'ai' && test(p))?.id;
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
      const earlier = doc.proposals.find(
        (p) =>
          p.status === 'pending' &&
          p.origin === 'ai' &&
          p.body.kind === 'rename' &&
          p.body.bubble === bubble.id,
      );
      if (earlier?.body.kind === 'rename' && earlier.body.title === ai.title) return null;
      return {
        proposal: make({
          kind: 'rename',
          bubble: bubble.id,
          title: ai.title,
          previous: bubble.title,
        }),
        replaces: earlier?.id,
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
      const from = liveBubble(doc, ai.from);
      const to = liveBubble(doc, ai.to);
      if (!from || !to) return null;
      // A line the AI names must really be in that bubble, or the arrow would point at nothing.
      if (ai.fromItem && !from.items.some((i) => i.id === ai.fromItem)) return null;
      if (ai.toItem && !to.items.some((i) => i.id === ai.toItem)) return null;
      const exists = doc.links.some(
        (l) =>
          l.from === ai.from &&
          l.to === ai.to &&
          (l.fromItem ?? null) === (ai.fromItem ?? null) &&
          (l.toItem ?? null) === (ai.toItem ?? null) &&
          l.status !== 'rejected',
      );
      if (exists) return null;
      const link: MapDoc['links'][number] = {
        id: newId(),
        from: ai.from,
        to: ai.to,
        status: 'pending',
        sourceStrokes: [],
      };
      if (ai.fromItem) link.fromItem = ai.fromItem;
      if (ai.toItem) link.toItem = ai.toItem;
      if (ai.label) link.label = ai.label;
      return { proposal: make({ kind: 'link', link: link.id }), link };
    }
    case 'label': {
      const link = doc.links.find((l) => l.id === ai.link && l.status !== 'rejected');
      if (!link || link.label === ai.label) return null;
      const same = (p: Proposal): boolean => p.body.kind === 'label' && p.body.link === link.id;
      // A name from the local pass, or one the same as the waiting one, stays as it is.
      const keeps = (p: Proposal): boolean =>
        p.origin !== 'ai' || (p.body.kind === 'label' && p.body.label === ai.label);
      if (duplicate((p) => p.status === 'pending' && same(p) && keeps(p))) return null;
      return {
        proposal: make({ kind: 'label', link: link.id, label: ai.label, previous: link.label ?? '' }),
        replaces: waitingAi(same),
      };
    }
    case 'group': {
      // Gathering words that are already on the map into a new box would show each of them twice.
      const onMap = new Set(
        doc.bubbles
          .filter((b) => b.status !== 'rejected')
          .flatMap((b) => [b.title, ...b.items.map((i) => i.text)])
          .map((text) => text.trim().toLowerCase()),
      );
      if (ai.items.length > 0 && ai.items.every((text) => onMap.has(text.trim().toLowerCase()))) {
        return null;
      }
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
