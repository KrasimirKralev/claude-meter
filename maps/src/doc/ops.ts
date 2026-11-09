import type { Box, Bubble, BubbleItem, Id, MapDoc, Stroke, TextNote } from './types.ts';

export const newId = (): Id =>
  Math.random().toString(36).slice(2, 7) + Math.random().toString(36).slice(2, 5);

const DEFAULT_TITLE = 'Untitled map';

/** The placeholder name is for the toolbar. It must never headline a finished map. */
export const hasRealTitle = (doc: MapDoc): boolean => doc.title !== DEFAULT_TITLE;

export const createDoc = (title = DEFAULT_TITLE): MapDoc => ({
  version: 1,
  id: newId(),
  title,
  summary: '',
  strokes: [],
  texts: [],
  bubbles: [],
  links: [],
  proposals: [],
  style: 'candy',
  bulgarianLetters: false,
  run: 0,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

export const boxOfPoints = (points: Float32Array): Box => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i += 3) {
    const x = points[i];
    const y = points[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
};

export const unionBoxes = (boxes: Box[]): Box | null => {
  if (boxes.length === 0) return null;
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.w));
  const maxY = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
};

export const addStroke = (doc: MapDoc, stroke: Stroke): MapDoc => ({
  ...doc,
  strokes: [...doc.strokes, stroke],
});

export const removeStrokes = (doc: MapDoc, ids: ReadonlySet<Id>): MapDoc => ({
  ...doc,
  strokes: doc.strokes.filter((s) => !ids.has(s.id)),
});

export const translateStroke = (stroke: Stroke, dx: number, dy: number): Stroke => {
  const points = stroke.points.slice();
  for (let i = 0; i < points.length; i += 3) {
    points[i] += dx;
    points[i + 1] += dy;
  }
  return {
    ...stroke,
    points,
    box: { ...stroke.box, x: stroke.box.x + dx, y: stroke.box.y + dy },
  };
};

export const moveSketchItems = (
  doc: MapDoc,
  ids: ReadonlySet<Id>,
  dx: number,
  dy: number,
): MapDoc => ({
  ...doc,
  strokes: doc.strokes.map((s) => (ids.has(s.id) ? translateStroke(s, dx, dy) : s)),
  texts: doc.texts.map((t) => (ids.has(t.id) ? { ...t, x: t.x + dx, y: t.y + dy } : t)),
});

export const upsertText = (doc: MapDoc, note: TextNote): MapDoc => {
  const exists = doc.texts.some((t) => t.id === note.id);
  return {
    ...doc,
    texts: exists ? doc.texts.map((t) => (t.id === note.id ? note : t)) : [...doc.texts, note],
  };
};

export const removeTexts = (doc: MapDoc, ids: ReadonlySet<Id>): MapDoc => ({
  ...doc,
  texts: doc.texts.filter((t) => !ids.has(t.id)),
});

export const updateBubble = (doc: MapDoc, id: Id, patch: Partial<Bubble>): MapDoc => ({
  ...doc,
  bubbles: doc.bubbles.map((b) => (b.id === id ? { ...b, ...patch } : b)),
});

/** Deleting a bubble keeps what was drawn inside it: those move up to the bubble around it. */
export const removeBubble = (doc: MapDoc, id: Id): MapDoc => {
  const removed = doc.bubbles.find((b) => b.id === id);
  return {
    ...doc,
    bubbles: doc.bubbles
      .filter((b) => b.id !== id)
      .map((b) => {
        if (b.parent !== id) return b;
        const { parent: _parent, ...rest } = b;
        return removed?.parent ? { ...rest, parent: removed.parent } : rest;
      }),
    links: doc.links.filter((l) => l.from !== id && l.to !== id),
    proposals: doc.proposals.filter((p) => !('bubble' in p.body) || p.body.bubble !== id),
  };
};

/**
 * The bubble a bubble shows inside: its nearest ancestor that is itself shown. A rejected or still
 * pending parent leaves its child standing on its own until the parent joins the view.
 */
export const shownParent = (
  bubbles: readonly Bubble[],
  bubble: Bubble,
  shown: (b: Bubble) => boolean,
): Bubble | undefined => {
  const seen = new Set<Id>([bubble.id]);
  let current = bubble.parent;
  while (current && !seen.has(current)) {
    seen.add(current);
    const parent = bubbles.find((b) => b.id === current);
    if (!parent) return undefined;
    if (shown(parent)) return parent;
    current = parent.parent;
  }
  return undefined;
};

/** The outermost shown bubble this one sits in, or the bubble itself. */
export const shownRoot = (
  bubbles: readonly Bubble[],
  bubble: Bubble,
  shown: (b: Bubble) => boolean,
): Bubble => {
  let current = bubble;
  for (let parent = shownParent(bubbles, current, shown); parent; ) {
    current = parent;
    parent = shownParent(bubbles, current, shown);
  }
  return current;
};

export const isShownIn =
  (view: 'both' | 'map') =>
  (bubble: Bubble): boolean =>
    view === 'map' ? bubble.status === 'accepted' : bubble.status !== 'rejected';

/** Ids of a bubble and everything drawn inside it, at any depth. */
export const withDescendants = (doc: MapDoc, id: Id): Set<Id> => {
  const ids = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const b of doc.bubbles) {
      if (b.parent && ids.has(b.parent) && !ids.has(b.id)) {
        ids.add(b.id);
        grew = true;
      }
    }
  }
  return ids;
};

/**
 * Before Digitize reads the sketch again, what it proposed last time and nobody accepted goes, so
 * the new reading replaces it instead of being blocked by it. With a selection, only what was read
 * from inside the selection goes. Accepted and rejected work stays as it is.
 */
export const dropPending = (doc: MapDoc, scope: ReadonlySet<Id> | null): MapDoc => {
  const inScope = (sources: Id[]): boolean => !scope || sources.every((id) => scope.has(id));
  const dropped = new Set(
    doc.bubbles
      .filter(
        (b) =>
          b.status === 'pending' &&
          (!scope ||
            (b.sourceStrokes.length + b.sourceTexts.length > 0 &&
              inScope([...b.sourceStrokes, ...b.sourceTexts]))),
      )
      .map((b) => b.id),
  );
  const links = doc.links.filter(
    (l) =>
      !dropped.has(l.from) &&
      !dropped.has(l.to) &&
      !(l.status === 'pending' && (!scope || (l.sourceStrokes.length > 0 && inScope(l.sourceStrokes)))),
  );
  const linkIds = new Set(links.map((l) => l.id));
  const bubbles = doc.bubbles
    .filter((b) => !dropped.has(b.id))
    .map((b) => {
      if (!b.parent || !dropped.has(b.parent)) return b;
      const { parent: _parent, ...rest } = b;
      return rest;
    });
  const proposals = doc.proposals.filter((p) => {
    if (p.status !== 'pending') return true;
    // Without a selection, the AI reads the whole map again, so its old ideas are replaced too.
    if (!scope) return false;
    const body = p.body;
    if ('bubble' in body && dropped.has(body.bubble)) return false;
    if ((body.kind === 'link' || body.kind === 'label') && !linkIds.has(body.link)) return false;
    if (body.kind === 'move-item' && (dropped.has(body.from) || dropped.has(body.to))) return false;
    return true;
  });
  return { ...doc, bubbles, links, proposals };
};

export const setItems = (doc: MapDoc, bubbleId: Id, items: BubbleItem[]): MapDoc =>
  updateBubble(doc, bubbleId, { items });

export const addLink = (doc: MapDoc, from: Id, to: Id): MapDoc => {
  const exists = doc.links.some((l) => l.from === from && l.to === to && l.status !== 'rejected');
  if (exists || from === to) return doc;
  return {
    ...doc,
    links: [...doc.links, { id: newId(), from, to, status: 'accepted', sourceStrokes: [] }],
  };
};

export const removeLink = (doc: MapDoc, id: Id): MapDoc => ({
  ...doc,
  links: doc.links.filter((l) => l.id !== id),
  proposals: doc.proposals.filter((p) => p.body.kind !== 'link' || p.body.link !== id),
});

/** Bubbles shown in a view. Rejected ones stay in the document so Undo can restore them. */
export const visibleBubbles = (doc: MapDoc, view: 'both' | 'map'): Bubble[] =>
  doc.bubbles.filter(isShownIn(view));

/** Shown bubbles that sit on the canvas themselves, not inside another shown bubble. */
export const visibleRoots = (doc: MapDoc, view: 'both' | 'map'): Bubble[] => {
  const shown = isShownIn(view);
  return doc.bubbles.filter((b) => shown(b) && !shownParent(doc.bubbles, b, shown));
};

/** Text that a live bubble has already claimed is drawn by that bubble instead. */
export const claimedTextIds = (doc: MapDoc): Set<Id> => {
  const claimed = new Set<Id>();
  for (const bubble of doc.bubbles) {
    if (bubble.status === 'rejected') continue;
    for (const id of bubble.sourceTexts) claimed.add(id);
  }
  return claimed;
};

export const claimedStrokeIds = (doc: MapDoc): Set<Id> => {
  const claimed = new Set<Id>();
  for (const bubble of doc.bubbles) {
    if (bubble.status === 'rejected') continue;
    for (const id of bubble.sourceStrokes) claimed.add(id);
  }
  for (const link of doc.links) {
    if (link.status === 'rejected') continue;
    for (const id of link.sourceStrokes) claimed.add(id);
  }
  return claimed;
};
