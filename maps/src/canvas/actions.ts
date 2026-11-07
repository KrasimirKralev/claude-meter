// The things a toolbar button or a shortcut can do.

import type { AppTheme } from '../desktop/bridge.ts';
import { applyLayout } from '../digitize/apply.ts';
import {
  addLink,
  hasRealTitle,
  newId,
  removeBubble,
  removeLink,
  removeStrokes,
  removeTexts,
  unionBoxes,
  updateBubble,
  visibleBubbles,
} from '../doc/ops.ts';
import type { Box, Bubble, Id, MapDoc, Tool, View } from '../doc/types.ts';
import { estimateHeight } from '../map/layout.ts';
import { showToast, store } from '../state/store.ts';
import { camera } from './camera.ts';
import { textBox } from './geometry.ts';

/** Room above the map for its title, and for its summary once there is one. */
export const headerHeight = (doc: MapDoc): number => {
  if (!hasRealTitle(doc) && !doc.summary) return 0;
  const measured = store.ui.headerH;
  if (measured > 0) return measured + 44;
  return doc.summary ? 146 : 92;
};

export const heightOf = (bubble: Bubble, width: number): number =>
  store.ui.heights.map[bubble.id] ?? estimateHeight(bubble, width);

/** Places the header above the top-left of whatever is on the map. */
export const headerPosition = (doc: MapDoc): { x: number; y: number } => {
  const accepted = visibleBubbles(doc, 'map');
  const height = headerHeight(doc);
  if (accepted.length === 0) return { x: 0, y: -height };
  return {
    x: Math.min(...accepted.map((b) => b.map.x)),
    y: Math.min(...accepted.map((b) => b.map.y)) - height,
  };
};

export const contentBox = (view: View): Box | null => {
  const doc = store.doc;
  if (view === 'map') {
    const boxes = visibleBubbles(doc, 'map').map((b) => ({
      x: b.map.x,
      y: b.map.y,
      w: b.map.w,
      h: heightOf(b, b.map.w),
    }));
    const body = unionBoxes(boxes);
    if (!body) return null;
    const height = headerHeight(doc);
    // Arrows that route around a bubble run just below the last row.
    return { ...body, y: body.y - height, h: body.h + height + 44 };
  }
  const boxes: Box[] = [...doc.strokes.map((s) => s.box), ...doc.texts.map(textBox)];
  if (view === 'both') {
    for (const b of visibleBubbles(doc, 'both')) {
      boxes.push({
        x: b.sketch.x,
        y: b.sketch.y,
        w: b.sketch.w,
        h: store.ui.heights.both[b.id] ?? b.sketch.h ?? 120,
      });
    }
  }
  return unionBoxes(boxes);
};

const freeArea = (): Box => {
  const { view, present } = store.ui;
  if (present) {
    return { x: 40, y: 40, w: innerWidth - 80, h: innerHeight - 80 };
  }
  const hasPanel = view === 'map' || store.doc.proposals.length > 0;
  return {
    x: 84,
    y: 84,
    w: innerWidth - 84 - (hasPanel ? 340 : 32),
    h: innerHeight - 84 - 28,
  };
};

export const fitView = (animate = true): void => {
  const box = contentBox(store.ui.view);
  if (box) camera.fit(box, freeArea(), { animate });
  else camera.animateTo({ x: 0, y: 0, z: 1 }, 0);
};

export const focusBox = (box: Box, maxZoom: number): void => {
  camera.fit(box, freeArea(), { maxZoom });
};

export const relayout = (): void => {
  store.commit((doc) => applyLayout(doc, heightOf), { history: false });
};

let morphTimer: ReturnType<typeof setTimeout> | undefined;

export const changeView = (view: View): void => {
  if (store.ui.view === view) return;
  clearTimeout(morphTimer);
  const needsPen = view !== 'map' && store.ui.tool === 'select' && store.doc.bubbles.length === 0;
  const tool: Tool =
    view === 'map' && !['select', 'text', 'arrow'].includes(store.ui.tool)
      ? 'select'
      : needsPen
        ? 'pen'
        : store.ui.tool;
  store.setUi({
    view,
    tool,
    morphing: true,
    selection: [],
    selectedBubble: null,
    selectedLink: null,
    editing: null,
  });
  if (view === 'map') relayout();
  fitView();
  const first = contentBox(view);
  morphTimer = setTimeout(() => {
    store.setUi({ morphing: false });
    // Real heights arrive after the fonts settle. Only move again if it is worth noticing.
    const settled = contentBox(view);
    if (first && settled && Math.abs(settled.h - first.h) + Math.abs(settled.w - first.w) > 40) {
      fitView();
    }
  }, 460);
};

export const setTool = (tool: Tool): void => {
  if (store.ui.view === 'map' && !['select', 'text', 'arrow'].includes(tool)) {
    changeView('sketch');
  }
  store.setUi({ tool, selection: [], selectedBubble: null, selectedLink: null });
};

export const toggleTheme = (): void => {
  const theme = store.ui.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  store.setUi({ theme });
  try {
    localStorage.setItem('balonche-theme', theme);
  } catch {
    // Storage blocked: the switch still works until the page reloads.
  }
};

/** Inside the desktop app, the look follows the app. The brutal theme draws on the light palette. */
export const applyAppTheme = ({ base, tokens }: AppTheme): void => {
  const root = document.documentElement;
  root.dataset.theme = base;
  root.dataset.skin = 'app';
  for (const [name, value] of Object.entries(tokens)) root.style.setProperty(`--${name}`, value);
  store.setUi({ theme: base === 'dark' ? 'dark' : 'light' });
};

export const deleteSelected = (): void => {
  const { selection, selectedBubble, selectedLink } = store.ui;
  if (selectedBubble) {
    store.commit((doc) => removeBubble(doc, selectedBubble));
    store.setUi({ selectedBubble: null });
  } else if (selectedLink) {
    store.commit((doc) => removeLink(doc, selectedLink));
    store.setUi({ selectedLink: null });
  } else if (selection.length > 0) {
    const ids = new Set(selection);
    store.commit((doc) => removeTexts(removeStrokes(doc, ids), ids));
    store.setUi({ selection: [] });
  }
};

const cleanLine = (line: string): string => line.replace(/^\s*[-–—•*]\s+/, '').trim();

/** Turns the selected ink and text into one finished group, by hand and without any AI. */
export const groupSelection = (): void => {
  const { selection } = store.ui;
  if (selection.length === 0) {
    showToast('Select something first, with the lasso or by dragging a box.');
    return;
  }
  const ids = new Set<Id>(selection);
  const doc = store.doc;
  const strokes = doc.strokes.filter((s) => ids.has(s.id));
  const texts = doc.texts.filter((t) => ids.has(t.id));
  const box = unionBoxes([...strokes.map((s) => s.box), ...texts.map(textBox)]);
  if (!box) return;
  const lines = [...texts]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .flatMap((t) => t.text.split('\n'))
    .map(cleanLine)
    .filter(Boolean);
  const [title = '', ...rest] = lines;
  const bubble: Bubble = {
    id: newId(),
    kind: 'group',
    title,
    items: rest.map((text) => ({ id: newId(), text })),
    status: 'accepted',
    slot: doc.bubbles.filter((b) => b.status !== 'rejected').length % 5,
    sketch: { x: box.x, y: box.y, w: Math.max(200, box.w), h: box.h },
    map: { x: 0, y: 0, w: 300 },
    pinned: false,
    sourceStrokes: strokes.map((s) => s.id),
    sourceTexts: texts.map((t) => t.id),
  };
  store.commit((current) => ({ ...current, bubbles: [...current.bubbles, bubble] }));
  store.setUi({
    selection: [],
    selectedBubble: bubble.id,
    view: store.ui.view === 'sketch' ? 'both' : store.ui.view,
    editing: title ? null : { type: 'bubble-title', bubble: bubble.id },
  });
};

export const addBubbleAt = (x: number, y: number): void => {
  const doc = store.doc;
  const bubble: Bubble = {
    id: newId(),
    kind: 'group',
    title: '',
    items: [],
    status: 'accepted',
    slot: doc.bubbles.filter((b) => b.status !== 'rejected').length % 5,
    sketch: { x, y, w: 260, h: 120 },
    map: { x, y, w: 300 },
    // Placed by hand, so automatic layout must not pull it away from the pointer.
    pinned: true,
    sourceStrokes: [],
    sourceTexts: [],
  };
  store.commit((current) => ({ ...current, bubbles: [...current.bubbles, bubble] }));
  store.setUi({ selectedBubble: bubble.id, editing: { type: 'bubble-title', bubble: bubble.id } });
};

export const tidyMap = (): void => {
  store.commit((doc) =>
    applyLayout(
      { ...doc, bubbles: doc.bubbles.map((b) => (b.pinned ? { ...b, pinned: false } : b)) },
      heightOf,
    ),
  );
  fitView();
};

export const setBubbleColor = (bubble: Id, slot: number): void => {
  store.commit((doc) => updateBubble(doc, bubble, { slot }));
};

export const linkBubbles = (from: Id, to: Id): void => {
  store.commit((doc) => addLink(doc, from, to));
};

