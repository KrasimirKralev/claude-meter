// Every pointer gesture on the canvas. Mouse, touch and pen share this one code path.
// Pen strokes touch only the live canvas until the pointer lifts, so React is never on the ink path.
// One pointer owns a gesture at a time, so a palm or a stray finger can never join a stroke.

import {
  addStroke,
  boxOfPoints,
  claimedTextIds,
  isShownIn,
  moveSketchItems,
  newId,
  removeStrokes,
  removeTexts,
  shownRoot,
  updateBubble,
} from '../doc/ops.ts';
import type { Box, Id, InkColor, Stroke, TextNote } from '../doc/types.ts';
import { store } from '../state/store.ts';
import { addBubbleAt, linkBubbles } from './actions.ts';
import { camera } from './camera.ts';
import {
  boxesTouch,
  hitStroke,
  pointInBox,
  pointInPolygon,
  strokeInPolygon,
  textBox,
} from './geometry.ts';
import type { InkRenderer, Offset } from './ink.ts';

type Gesture =
  | { type: 'pen'; points: number[]; color: InkColor; width: number; varies: boolean; lastX: number; lastY: number }
  | { type: 'pan'; lastX: number; lastY: number }
  | { type: 'pinch'; distance: number; midX: number; midY: number }
  | { type: 'erase' }
  | { type: 'arrow'; x1: number; y1: number; x2: number; y2: number; from: Id | null; color: InkColor; width: number }
  | { type: 'lasso'; points: number[] }
  | { type: 'box'; x1: number; y1: number; x2: number; y2: number }
  | { type: 'move-selection'; ids: ReadonlySet<Id>; startX: number; startY: number; dx: number; dy: number; moved: boolean; clicked: HTMLElement | null }
  | { type: 'move-bubble'; id: Id; inMap: boolean; startX: number; startY: number; originX: number; originY: number; moved: boolean; target: HTMLElement };

const CLICK_SLOP = 4;
/** A hand resting on the board lands around the pen, so touch waits this long after the pen. */
const PALM_WINDOW_MS = 500;

export interface InteractionDeps {
  ink: InkRenderer;
  world: HTMLElement;
  requestRender: () => void;
  setOffset: (offset: Offset | undefined) => void;
  setPanning: (panning: boolean) => void;
  expectAppended: (stroke: Stroke) => void;
}

let gesture: Gesture | null = null;

/** Keyboard shortcuts wait while a gesture runs, because they could pull the state out from under it. */
export const isGestureActive = (): boolean => gesture !== null;

const bubbleIdAt = (x: number, y: number): Id | null => {
  const element = document.elementFromPoint(x, y) as HTMLElement | null;
  return element?.closest<HTMLElement>('[data-bubble]')?.dataset.bubble ?? null;
};

const inEditor = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && target.closest('[contenteditable]') !== null;

/** Words are saved when an editor loses focus. A touch tap does not move focus by itself. */
const commitOpenEditor = (): boolean => {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.isContentEditable) {
    active.blur();
    return true;
  }
  return false;
};

/** Text a bubble has claimed is hidden in Both view, so it must not be erased or selected there. */
const reachableTexts = (): TextNote[] => {
  const { doc, ui } = store;
  if (ui.view !== 'both') return doc.texts;
  const claimed = claimedTextIds(doc);
  return doc.texts.filter((t) => !claimed.has(t.id));
};

export const attachInteraction = (root: HTMLElement, deps: InteractionDeps): (() => void) => {
  const { ink, world, requestRender, setOffset, setPanning, expectAppended } = deps;
  gesture = null;
  let activePointer: number | null = null;
  let spaceHeld = false;
  let pendingClear = false;
  let textClick: { pointerId: number; x: number; y: number; target: HTMLElement } | null = null;
  let lastPenAt = -Infinity;
  let gestureIsTouch = false;
  const touches = new Map<number, { x: number; y: number }>();

  const clearLive = (): void => {
    pendingClear = false;
    ink.liveClear();
  };

  const clearDrag = (): void => {
    setOffset(undefined);
    world.style.removeProperty('--drag-x');
    world.style.removeProperty('--drag-y');
  };

  /** Ends whatever is running and puts everything back, as if it had not started. */
  const abortGesture = (): void => {
    const current = gesture;
    gesture = null;
    activePointer = null;
    textClick = null;
    if (!current) return;
    switch (current.type) {
      case 'pen':
      case 'arrow':
      case 'lasso':
      case 'box':
        clearLive();
        break;
      case 'pan':
        setPanning(spaceHeld);
        break;
      case 'erase':
        store.cancelGesture();
        break;
      case 'move-bubble':
        if (current.moved) store.cancelGesture();
        break;
      case 'move-selection':
        clearDrag();
        requestRender();
        break;
      case 'pinch':
        break;
    }
  };

  const capture = (e: PointerEvent): void => {
    activePointer = e.pointerId;
    gestureIsTouch = e.pointerType === 'touch';
    try {
      root.setPointerCapture(e.pointerId);
    } catch {
      // The pointer is already gone. Its events simply stop arriving.
    }
  };

  const startPen = (e: PointerEvent): void => {
    if (pendingClear) clearLive();
    const { x, y } = camera.toWorld(e.clientX, e.clientY);
    const width = 2.4 / camera.state.z;
    const color = store.ui.penColor;
    const varies = e.pointerType === 'pen';
    ink.liveBegin(color, width, x, y);
    gesture = {
      type: 'pen',
      points: [x, y, varies ? e.pressure : 0.5],
      color,
      width,
      varies,
      lastX: x,
      lastY: y,
    };
  };

  const extendPen = (e: PointerEvent): void => {
    if (gesture?.type !== 'pen') return;
    const events = e.getCoalescedEvents?.() ?? [];
    const samples = events.length > 0 ? events : [e];
    const minStep = 0.5 / camera.state.z;
    for (const sample of samples) {
      const { x, y } = camera.toWorld(sample.clientX, sample.clientY);
      if (Math.hypot(x - gesture.lastX, y - gesture.lastY) < minStep) continue;
      const pressure = gesture.varies ? sample.pressure : 0.5;
      gesture.points.push(x, y, pressure);
      gesture.lastX = x;
      gesture.lastY = y;
      ink.liveExtend(x, y, pressure, gesture.varies);
    }
  };

  const finishPen = (): void => {
    if (gesture?.type !== 'pen') return;
    const points = Float32Array.from(gesture.points);
    const stroke: Stroke = {
      id: newId(),
      points,
      color: gesture.color,
      width: gesture.width,
      box: boxOfPoints(points),
    };
    gesture = null;
    ink.appendCommitted(stroke);
    expectAppended(stroke);
    store.commit((doc) => addStroke(doc, stroke));
    // The live canvas paints on its own schedule. Clearing it a frame later prevents a flicker.
    pendingClear = true;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (pendingClear && gesture === null) clearLive();
      }),
    );
  };

  const eraseAt = (e: PointerEvent): void => {
    const { x, y } = camera.toWorld(e.clientX, e.clientY);
    const radius = 7 / camera.state.z;
    const strokes = new Set(
      store.doc.strokes.filter((s) => hitStroke(s, x, y, radius)).map((s) => s.id),
    );
    const texts = new Set(
      reachableTexts()
        .filter((t) => pointInBox(x, y, textBox(t)))
        .map((t) => t.id),
    );
    if (strokes.size === 0 && texts.size === 0) return;
    store.commit((current) => removeTexts(removeStrokes(current, strokes), texts));
  };

  const selectionBox = (): Box | null => {
    const ids = new Set(store.ui.selection);
    const boxes = [
      ...store.doc.strokes.filter((s) => ids.has(s.id)).map((s) => s.box),
      ...store.doc.texts.filter((t) => ids.has(t.id)).map(textBox),
    ];
    if (boxes.length === 0) return null;
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    return {
      x,
      y,
      w: Math.max(...boxes.map((b) => b.x + b.w)) - x,
      h: Math.max(...boxes.map((b) => b.y + b.h)) - y,
    };
  };

  const startSelect = (e: PointerEvent): void => {
    const target = e.target as HTMLElement;
    const { x, y } = camera.toWorld(e.clientX, e.clientY);
    const { view, selection } = store.ui;

    const linkTarget = target.closest<SVGElement>('[data-link]');
    if (linkTarget) {
      store.setUi({
        selectedLink: linkTarget.dataset.link ?? null,
        selectedBubble: null,
        selection: [],
      });
      return;
    }

    const bubbleEl = target.closest<HTMLElement>('[data-bubble]');
    if (bubbleEl && view !== 'sketch') {
      const id = bubbleEl.dataset.bubble as Id;
      const clicked = store.doc.bubbles.find((b) => b.id === id);
      if (!clicked) return;
      const inMap = view === 'map';
      // A bubble drawn inside another one moves with it, so dragging it drags the outermost one.
      const bubble = shownRoot(store.doc.bubbles, clicked, isShownIn(inMap ? 'map' : 'both'));
      const place = inMap ? bubble.map : bubble.sketch;
      store.setUi({ selectedBubble: id, selectedLink: null, selection: [] });
      gesture = {
        type: 'move-bubble',
        id: bubble.id,
        inMap,
        startX: x,
        startY: y,
        originX: place.x,
        originY: place.y,
        moved: false,
        target,
      };
      return;
    }

    store.setUi({ selectedBubble: null, selectedLink: null });
    if (view === 'map') {
      gesture = { type: 'pan', lastX: e.clientX, lastY: e.clientY };
      setPanning(true);
      return;
    }

    const textEl = target.closest<HTMLElement>('[data-text]');
    let hit: Id | null = textEl?.dataset.text ?? null;
    if (!hit) {
      const radius = 6 / camera.state.z;
      for (let i = store.doc.strokes.length - 1; i >= 0; i -= 1) {
        if (hitStroke(store.doc.strokes[i], x, y, radius)) {
          hit = store.doc.strokes[i].id;
          break;
        }
      }
    }
    const box = selectionBox();
    if (hit && !selection.includes(hit)) {
      store.setUi({ selection: [hit] });
    } else if (!hit && !(box && pointInBox(x, y, box))) {
      store.setUi({ selection: [] });
      gesture = { type: 'box', x1: x, y1: y, x2: x, y2: y };
      return;
    }
    gesture = {
      type: 'move-selection',
      ids: new Set(store.ui.selection),
      startX: x,
      startY: y,
      dx: 0,
      dy: 0,
      moved: false,
      clicked: textEl,
    };
  };

  const startEditFrom = (target: HTMLElement): boolean => {
    const editable = target.closest<HTMLElement>('[data-edit]');
    const bubbleId = target.closest<HTMLElement>('[data-bubble]')?.dataset.bubble;
    if (!editable || !bubbleId) return false;
    const field = editable.dataset.edit as string;
    store.setUi({
      editing:
        field === 'title'
          ? { type: 'bubble-title', bubble: bubbleId }
          : { type: 'bubble-item', bubble: bubbleId, item: field },
    });
    return true;
  };

  const newTextAt = (x: number, y: number): void => {
    store.setUi({ draftText: { id: newId(), x, y }, selection: [] });
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (inEditor(e.target)) return;
    const target = e.target as HTMLElement;
    // A button on a bubble handles its own click. Capturing the pointer would take that click away.
    if (target.closest('button')) return;

    if (e.pointerType === 'pen') {
      lastPenAt = e.timeStamp;
      // The pen always wins: a palm that landed first gives up whatever it had started.
      if (gesture && (gestureIsTouch || gesture.type === 'pinch')) abortGesture();
      touches.clear();
    }

    if (e.pointerType === 'touch') {
      // A pen is down or just lifted, so this touch is a resting palm.
      if (gesture?.type === 'pen' && gesture.varies) return;
      if (e.timeStamp - lastPenAt < PALM_WINDOW_MS) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size >= 2) {
        // A second finger means navigate. Whatever the first finger began is undone.
        if (gesture?.type === 'pinch') return;
        abortGesture();
        const [a, b] = [...touches.values()];
        gesture = {
          type: 'pinch',
          distance: Math.hypot(a.x - b.x, a.y - b.y),
          midX: (a.x + b.x) / 2,
          midY: (a.y + b.y) / 2,
        };
        return;
      }
    }

    // The same pointer pressing again proves its last release never arrived, for example because
    // it happened outside the window. That gesture is over and must not swallow this one.
    if (e.pointerId === activePointer || textClick?.pointerId === e.pointerId) abortGesture();
    // Another pointer already owns the running gesture.
    if (gesture || textClick) return;

    const hadEditor = commitOpenEditor();
    const { tool, view } = store.ui;

    if (e.button === 1 || e.button === 2 || spaceHeld) {
      capture(e);
      gesture = { type: 'pan', lastX: e.clientX, lastY: e.clientY };
      setPanning(true);
      return;
    }
    if (e.button !== 0) return;

    const { x, y } = camera.toWorld(e.clientX, e.clientY);
    switch (tool) {
      case 'pen':
        capture(e);
        startPen(e);
        break;
      case 'eraser':
        capture(e);
        store.beginGesture();
        gesture = { type: 'erase' };
        eraseAt(e);
        break;
      case 'arrow':
        capture(e);
        gesture = {
          type: 'arrow',
          x1: x,
          y1: y,
          x2: x,
          y2: y,
          from: view === 'sketch' ? null : bubbleIdAt(e.clientX, e.clientY),
          color: store.ui.penColor,
          width: 2.4 / camera.state.z,
        };
        break;
      case 'lasso':
        capture(e);
        gesture = { type: 'lasso', points: [x, y] };
        break;
      case 'text':
        // Clicking away from an open editor only finishes it, like everywhere else.
        if (!hadEditor) textClick = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, target };
        break;
      case 'select':
        capture(e);
        startSelect(e);
        break;
    }
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (e.pointerType === 'pen') lastPenAt = e.timeStamp;
    if (!gesture) return;
    if (gesture.type !== 'pinch' && e.pointerId !== activePointer) return;
    // No button is down, so the release happened somewhere this page could not see it.
    if (e.pointerType === 'mouse' && e.buttons === 0) {
      onPointerUp(e);
      return;
    }

    switch (gesture.type) {
      case 'pen':
        extendPen(e);
        break;
      case 'pan':
        camera.panBy(e.clientX - gesture.lastX, e.clientY - gesture.lastY);
        gesture.lastX = e.clientX;
        gesture.lastY = e.clientY;
        break;
      case 'pinch': {
        if (touches.size < 2) break;
        const [a, b] = [...touches.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        camera.panBy(midX - gesture.midX, midY - gesture.midY);
        if (gesture.distance > 0) camera.zoomAt(midX, midY, distance / gesture.distance);
        gesture = { type: 'pinch', distance, midX, midY };
        break;
      }
      case 'erase':
        eraseAt(e);
        break;
      case 'arrow': {
        const { x, y } = camera.toWorld(e.clientX, e.clientY);
        gesture.x2 = x;
        gesture.y2 = y;
        const g = gesture;
        ink.liveOverlay((ctx) => {
          ctx.strokeStyle = ink.accent;
          ctx.lineWidth = g.width;
          ctx.beginPath();
          ctx.moveTo(g.x1, g.y1);
          ctx.lineTo(g.x2, g.y2);
          ctx.stroke();
        });
        break;
      }
      case 'lasso': {
        const { x, y } = camera.toWorld(e.clientX, e.clientY);
        gesture.points.push(x, y);
        const p = gesture.points;
        ink.liveOverlay((ctx) => {
          ctx.strokeStyle = ink.accent;
          ctx.lineWidth = 1.6 / camera.state.z;
          ctx.setLineDash([6 / camera.state.z, 6 / camera.state.z]);
          ctx.beginPath();
          ctx.moveTo(p[0], p[1]);
          for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
          ctx.stroke();
          ctx.setLineDash([]);
        });
        break;
      }
      case 'box': {
        const { x, y } = camera.toWorld(e.clientX, e.clientY);
        gesture.x2 = x;
        gesture.y2 = y;
        const g = gesture;
        ink.liveOverlay((ctx) => {
          ctx.strokeStyle = ink.accent;
          ctx.fillStyle = 'rgba(96,165,250,0.12)';
          ctx.lineWidth = 1.2 / camera.state.z;
          ctx.fillRect(g.x1, g.y1, g.x2 - g.x1, g.y2 - g.y1);
          ctx.strokeRect(g.x1, g.y1, g.x2 - g.x1, g.y2 - g.y1);
        });
        break;
      }
      case 'move-selection': {
        const { x, y } = camera.toWorld(e.clientX, e.clientY);
        gesture.dx = x - gesture.startX;
        gesture.dy = y - gesture.startY;
        if (Math.hypot(gesture.dx, gesture.dy) * camera.state.z > CLICK_SLOP) gesture.moved = true;
        if (gesture.moved) {
          setOffset({ ids: gesture.ids, dx: gesture.dx, dy: gesture.dy });
          world.style.setProperty('--drag-x', `${gesture.dx}px`);
          world.style.setProperty('--drag-y', `${gesture.dy}px`);
          requestRender();
        }
        break;
      }
      case 'move-bubble': {
        const { x, y } = camera.toWorld(e.clientX, e.clientY);
        const dx = x - gesture.startX;
        const dy = y - gesture.startY;
        if (!gesture.moved && Math.hypot(dx, dy) * camera.state.z <= CLICK_SLOP) break;
        if (!gesture.moved) {
          gesture.moved = true;
          store.beginGesture();
        }
        const g = gesture;
        store.commit((doc) => {
          const bubble = doc.bubbles.find((b) => b.id === g.id);
          if (!bubble) return doc;
          const place = { x: g.originX + dx, y: g.originY + dy };
          return updateBubble(
            doc,
            g.id,
            g.inMap
              ? { map: { ...bubble.map, ...place }, pinned: true }
              : { sketch: { ...bubble.sketch, ...place } },
          );
        });
        break;
      }
    }
  };

  const finishTextClick = (e: PointerEvent): void => {
    const click = textClick;
    textClick = null;
    if (!click) return;
    if (Math.hypot(e.clientX - click.x, e.clientY - click.y) > CLICK_SLOP) return;
    if (startEditFrom(click.target)) return;
    const { x, y } = camera.toWorld(e.clientX, e.clientY);
    if (store.ui.view === 'map') addBubbleAt(x, y);
    else newTextAt(x, y);
  };

  function onPointerUp(e: PointerEvent): void {
    if (e.pointerType === 'pen') lastPenAt = e.timeStamp;
    if (e.pointerType === 'touch') {
      touches.delete(e.pointerId);
      if (gesture?.type === 'pinch') {
        if (touches.size < 2) gesture = null;
        return;
      }
    }
    if (textClick?.pointerId === e.pointerId) {
      finishTextClick(e);
      return;
    }
    const finished = gesture;
    if (!finished || e.pointerId !== activePointer) return;
    activePointer = null;

    switch (finished.type) {
      case 'pen':
        extendPen(e);
        finishPen();
        return;
      case 'pan':
        setPanning(spaceHeld);
        break;
      case 'erase':
        store.endGesture();
        break;
      case 'arrow': {
        clearLive();
        const length = Math.hypot(finished.x2 - finished.x1, finished.y2 - finished.y1);
        if (length * camera.state.z < 10) break;
        const to = store.ui.view === 'sketch' ? null : bubbleIdAt(e.clientX, e.clientY);
        if (finished.from && to && finished.from !== to) {
          linkBubbles(finished.from, to);
        } else if (store.ui.view !== 'map') {
          const points = Float32Array.from([
            finished.x1,
            finished.y1,
            0.5,
            finished.x2,
            finished.y2,
            0.5,
          ]);
          const stroke: Stroke = {
            id: newId(),
            points,
            color: finished.color,
            width: finished.width,
            box: boxOfPoints(points),
            arrow: true,
          };
          store.commit((doc) => addStroke(doc, stroke));
        }
        break;
      }
      case 'lasso': {
        clearLive();
        const polygon = finished.points;
        if (polygon.length < 8) break;
        const selection = [
          ...store.doc.strokes.filter((s) => strokeInPolygon(s, polygon)).map((s) => s.id),
          ...reachableTexts()
            .filter((t) => pointInPolygon(t.x + t.w / 2, t.y + t.h / 2, polygon))
            .map((t) => t.id),
        ];
        store.setUi({ selection, tool: selection.length > 0 ? 'select' : store.ui.tool });
        break;
      }
      case 'box': {
        clearLive();
        const box: Box = {
          x: Math.min(finished.x1, finished.x2),
          y: Math.min(finished.y1, finished.y2),
          w: Math.abs(finished.x2 - finished.x1),
          h: Math.abs(finished.y2 - finished.y1),
        };
        if (box.w * camera.state.z < CLICK_SLOP && box.h * camera.state.z < CLICK_SLOP) break;
        store.setUi({
          selection: [
            ...store.doc.strokes.filter((s) => boxesTouch(box, s.box)).map((s) => s.id),
            ...reachableTexts()
              .filter((t) => boxesTouch(box, textBox(t)))
              .map((t) => t.id),
          ],
        });
        break;
      }
      case 'move-selection': {
        clearDrag();
        if (finished.moved) {
          store.commit((doc) => moveSketchItems(doc, finished.ids, finished.dx, finished.dy));
        } else if (finished.clicked?.dataset.text) {
          store.setUi({
            editing: { type: 'text', id: finished.clicked.dataset.text },
            selection: [],
          });
        }
        requestRender();
        break;
      }
      case 'move-bubble':
        if (finished.moved) store.endGesture();
        else startEditFrom(finished.target);
        break;
      case 'pinch':
        break;
    }
    gesture = null;
  }

  const onPointerCancel = (e: PointerEvent): void => {
    touches.delete(e.pointerId);
    if (textClick?.pointerId === e.pointerId) textClick = null;
    // The system took the pointer away, so the gesture it owned is undone.
    if (gesture?.type === 'pinch') {
      if (touches.size < 2) gesture = null;
    } else if (e.pointerId === activePointer) {
      abortGesture();
    }
  };

  const onDoubleClick = (e: MouseEvent): void => {
    if (store.ui.tool !== 'select' || inEditor(e.target)) return;
    // The pointer was captured, so the event target is the canvas, not what is under the pointer.
    const under = document.elementFromPoint(e.clientX, e.clientY);
    if (under?.closest('[data-bubble],[data-text],button')) return;
    const { x, y } = camera.toWorld(e.clientX, e.clientY);
    if (store.ui.view === 'map') addBubbleAt(x, y);
    else newTextAt(x, y);
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    // A mouse wheel moves in whole notches, a trackpad in small steps. Mouse zooms, trackpad pans.
    const notch = e.deltaMode !== 0 || (Math.abs(e.deltaY) >= 50 && e.deltaX === 0);
    if (e.ctrlKey || e.metaKey || (notch && !e.shiftKey)) {
      const scale = e.deltaMode === 1 ? 33 : 1;
      camera.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * scale * (e.ctrlKey ? 0.01 : 0.0016)));
    } else {
      camera.panBy(e.shiftKey ? -e.deltaY : -e.deltaX, e.shiftKey ? 0 : -e.deltaY);
    }
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Escape' && gesture) {
      e.stopPropagation();
      abortGesture();
      return;
    }
    if (e.code === 'Space' && !inEditor(e.target)) {
      // On a focused button or checkbox, Space belongs to that control.
      if (e.target instanceof Element && e.target.closest('button, a, input, select')) return;
      spaceHeld = true;
      setPanning(true);
      e.preventDefault();
    }
  };

  const onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'Space') {
      spaceHeld = false;
      if (gesture?.type !== 'pan') setPanning(false);
    }
  };

  // The key-up never arrives if the window loses focus while Space is held.
  const onWindowBlur = (): void => {
    spaceHeld = false;
    if (gesture?.type !== 'pan') setPanning(false);
  };

  const onContextMenu = (e: Event): void => e.preventDefault();

  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerUp);
  root.addEventListener('pointercancel', onPointerCancel);
  root.addEventListener('dblclick', onDoubleClick);
  root.addEventListener('wheel', onWheel, { passive: false });
  root.addEventListener('contextmenu', onContextMenu);
  // Runs before the shortcuts, so Escape cancels a gesture without also clearing the selection.
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onWindowBlur);

  return () => {
    root.removeEventListener('pointerdown', onPointerDown);
    root.removeEventListener('pointermove', onPointerMove);
    root.removeEventListener('pointerup', onPointerUp);
    root.removeEventListener('pointercancel', onPointerCancel);
    root.removeEventListener('dblclick', onDoubleClick);
    root.removeEventListener('wheel', onWheel);
    root.removeEventListener('contextmenu', onContextMenu);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onWindowBlur);
  };
};
