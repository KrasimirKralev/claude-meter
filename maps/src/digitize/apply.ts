// Turns the local recognizer's result into pending bubbles, links and proposals.

import { isShownIn, newId, shownParent, shownRoot } from '../doc/ops.ts';
import type { Bubble, InkColor, Link, MapDoc, Proposal } from '../doc/types.ts';
import { layoutBubbles } from '../map/layout.ts';
import type { Recognition } from '../recognize/recognize.ts';

const SLOT_OF_COLOR: Partial<Record<InkColor, number>> = {
  yellow: 0,
  pink: 1,
  aqua: 2,
  peach: 3,
  periwinkle: 4,
};

export const applyLayout = (
  doc: MapDoc,
  heightOf: (bubble: Bubble, width: number) => number,
): MapDoc => {
  // Only bubbles standing on their own are placed. The ones drawn inside them travel along.
  const shown = isShownIn('map');
  const childrenOf = (parent: Bubble): Bubble[] =>
    doc.bubbles.filter((b) => shown(b) && shownParent(doc.bubbles, b, shown)?.id === parent.id);
  // Arrows count only between bubbles on the map, by the ones standing on their own that hold them.
  const rootId = (id: string): string | undefined => {
    const bubble = doc.bubbles.find((b) => b.id === id);
    if (!bubble || !shown(bubble)) return undefined;
    return shownRoot(doc.bubbles, bubble, shown).id;
  };
  const links = doc.links.flatMap((link) => {
    if (link.status !== 'accepted') return [];
    const from = rootId(link.from);
    const to = rootId(link.to);
    if (!from || !to) return [];
    // A line counts only when it belongs to the bubble standing on its own.
    return [{ from, to, fromItem: from === link.from ? link.fromItem : undefined }];
  });
  const placed = layoutBubbles(
    doc.bubbles.filter((b) => shown(b) && !shownParent(doc.bubbles, b, shown)),
    heightOf,
    childrenOf,
    links,
  );
  let changed = false;
  const bubbles = doc.bubbles.map((bubble) => {
    const next = placed.get(bubble.id);
    if (!next) return bubble;
    const same =
      next.x === bubble.map.x && next.y === bubble.map.y && next.w === bubble.map.w;
    if (same) return bubble;
    changed = true;
    return { ...bubble, map: next };
  });
  return changed ? { ...doc, bubbles } : doc;
};

export const applyRecognition = (doc: MapDoc, result: Recognition, run: number): MapDoc => {
  const taken = doc.bubbles.filter((b) => b.status !== 'rejected').length;
  const groups: Bubble[] = result.groups.map((group, index) => ({
    id: newId(),
    kind: 'group',
    title: group.title,
    items: group.items.map(({ text, mark }) => (mark ? { id: newId(), text, mark } : { id: newId(), text })),
    status: 'pending',
    slot: SLOT_OF_COLOR[group.color] ?? (taken + index) % 5,
    sketch: {
      x: group.box.x,
      y: group.box.y,
      w: Math.max(200, group.box.w),
      h: group.box.h,
    },
    map: { x: 0, y: 0, w: 300 },
    pinned: false,
    sourceStrokes: [...group.strokeIds, ...group.inkIds],
    sourceTexts: group.textIds,
  }));
  const notes: Bubble[] = result.notes.map((note) => ({
    id: newId(),
    kind: 'note',
    title: note.text,
    items: [],
    status: 'pending',
    slot: 0,
    sketch: { x: note.box.x, y: note.box.y, w: Math.max(200, note.box.w), h: note.box.h },
    map: { x: 0, y: 0, w: 240 },
    pinned: false,
    sourceStrokes: [],
    sourceTexts: note.textIds,
  }));
  result.groups.forEach((group, index) => {
    if (group.parent !== undefined && groups[group.parent]) {
      groups[index].parent = groups[group.parent].id;
    }
  });
  const links: Link[] = result.links.map((link) => {
    const from = groups[link.from];
    const to = groups[link.to];
    const out: Link = {
      id: newId(),
      from: from.id,
      to: to.id,
      status: 'pending',
      sourceStrokes: link.strokeIds,
    };
    if (link.color !== 'ink') out.color = link.color;
    const fromItem = link.fromItem === undefined ? undefined : from.items[link.fromItem];
    const toItem = link.toItem === undefined ? undefined : to.items[link.toItem];
    if (fromItem) out.fromItem = fromItem.id;
    if (toItem) out.toItem = toItem.id;
    return out;
  });
  const make = (body: Proposal['body']): Proposal => ({
    id: newId(),
    status: 'pending',
    origin: 'local',
    body,
  });
  const proposals: Proposal[] = [
    ...groups.map((b) => make({ kind: 'group', bubble: b.id })),
    ...notes.map((b) => make({ kind: 'note', bubble: b.id })),
    ...links.map((l) => make({ kind: 'link', link: l.id })),
  ];
  return {
    ...doc,
    run,
    isExample: false,
    bubbles: [...doc.bubbles, ...groups, ...notes],
    links: [...doc.links, ...links],
    // Proposals already decided belong to the previous run, so the panel starts clean.
    proposals: [...doc.proposals.filter((p) => p.status === 'pending'), ...proposals],
  };
};
