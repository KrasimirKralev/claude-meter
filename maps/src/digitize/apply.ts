// Turns the local recognizer's result into pending bubbles, links and proposals.

import { newId } from '../doc/ops.ts';
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
  const placed = layoutBubbles(
    doc.bubbles.filter((b) => b.status === 'accepted'),
    heightOf,
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
    items: group.items.map((text) => ({ id: newId(), text })),
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
  const links: Link[] = result.links.map((link) => ({
    id: newId(),
    from: groups[link.from].id,
    to: groups[link.to].id,
    status: 'pending',
    sourceStrokes: link.strokeIds,
  }));
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
