import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { heightOf, relayout } from '../canvas/actions.ts';
import { camera } from '../canvas/camera.ts';
import { isShownIn, newId, shownParent, updateBubble } from '../doc/ops.ts';
import type { Bubble, BubbleItem, Id, InkColor, View } from '../doc/types.ts';
import { store, useStore } from '../state/store.ts';
import type { Anchor } from '../state/store.ts';
import { Icon } from '../ui/primitives.tsx';
import { childrenIn } from './boxes.ts';
import type { ShownView } from './boxes.ts';
import { childRows, mapWidth, noteTail } from './layout.ts';
import type { Tail } from './layout.ts';

const placeCaretAtEnd = (element: HTMLElement): void => {
  element.focus();
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
};

const setItems = (bubbleId: Id, items: BubbleItem[]): void => {
  store.commit((doc) => updateBubble(doc, bubbleId, { items }), { coalesce: `items-${bubbleId}` });
};

const currentBubble = (id: Id): Bubble | undefined => store.doc.bubbles.find((b) => b.id === id);

interface FieldProps {
  bubble: Bubble;
  value: string;
  field: 'title' | Id;
  /** Shown only while the field is empty. It is never written into the map. */
  placeholder?: string;
  /** The colour of the circle drawn around this line in the sketch. */
  mark?: InkColor;
}

/** One line of a bubble. Plain text until clicked, then a small editor. */
const Field = ({ bubble, value, field, placeholder, mark }: FieldProps) => {
  const isTitle = field === 'title';
  const editing = useStore((s) => {
    const e = s.ui.editing;
    if (!e || e.type === 'text' || e.bubble !== bubble.id) return false;
    return isTitle ? e.type === 'bubble-title' : e.type === 'bubble-item' && e.item === field;
  });
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    if (editing && ref.current) {
      ref.current.textContent = value;
      placeCaretAtEnd(ref.current);
    }
    // The text is written once when editing starts, and the browser owns it after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const read = (): string => (ref.current?.innerText ?? '').replace(/\n/g, ' ').trim();

  const commit = (): void => {
    const text = read();
    const fresh = currentBubble(bubble.id);
    if (!fresh) return;
    if (isTitle) {
      if (text !== fresh.title) {
        store.commit((doc) => updateBubble(doc, bubble.id, { title: text }));
      }
    } else if (text) {
      if (fresh.items.find((i) => i.id === field)?.text !== text) {
        setItems(
          bubble.id,
          fresh.items.map((i) => (i.id === field ? { ...i, text } : i)),
        );
      }
    } else {
      setItems(
        bubble.id,
        fresh.items.filter((i) => i.id !== field),
      );
    }
  };

  const editNext = (next: typeof store.ui.editing): void => {
    commit();
    store.setUi({ editing: next });
  };

  const stillEditing = (): boolean => {
    const e = store.ui.editing;
    if (!e || e.type === 'text' || e.bubble !== bubble.id) return false;
    return isTitle ? e.type === 'bubble-title' : e.type === 'bubble-item' && e.item === field;
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      ref.current?.blur();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (bubble.kind === 'note') {
        ref.current?.blur();
        return;
      }
      // Enter on an empty line ends the list, the way it does in any editor.
      if (!isTitle && read() === '') {
        editNext(null);
        return;
      }
      // Otherwise Enter opens the next line, which makes typing a list as fast as on paper.
      const before = currentBubble(bubble.id);
      if (!before) return;
      const index = isTitle ? 0 : before.items.findIndex((i) => i.id === field) + 1;
      commit();
      const fresh = currentBubble(bubble.id);
      if (!fresh) return;
      const item: BubbleItem = { id: newId(), text: '' };
      const items = [...fresh.items];
      items.splice(index, 0, item);
      setItems(bubble.id, items);
      store.setUi({ editing: { type: 'bubble-item', bubble: bubble.id, item: item.id } });
      return;
    }
    if (e.key === 'Backspace' && !isTitle && read() === '') {
      e.preventDefault();
      const fresh = currentBubble(bubble.id);
      if (!fresh) return;
      const index = fresh.items.findIndex((i) => i.id === field);
      const previous = fresh.items[index - 1];
      editNext(
        previous
          ? { type: 'bubble-item', bubble: bubble.id, item: previous.id }
          : { type: 'bubble-title', bubble: bubble.id },
      );
    }
  };

  const onBlur = (): void => {
    commit();
    if (stillEditing()) store.setUi({ editing: null });
  };

  const Tag = isTitle ? 'h2' : 'li';
  const hint =
    placeholder ?? (isTitle ? (bubble.kind === 'note' ? 'Note' : 'Title') : 'Write something');
  // Lines are measured by id, so an arrow drawn from one of them can start right there.
  const lineProps = isTitle
    ? {}
    : { 'data-item': field, className: mark ? `marked mark-${mark}` : undefined };
  if (editing) {
    return (
      <Tag
        ref={ref as never}
        {...lineProps}
        data-edit={field}
        data-placeholder={hint}
        contentEditable="plaintext-only"
        suppressContentEditableWarning
        role="textbox"
        aria-label={isTitle ? 'Bubble title' : 'Bubble item'}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      />
    );
  }
  return (
    <Tag {...lineProps} data-edit={field} data-placeholder={hint}>
      {value}
    </Tag>
  );
};

interface BubbleViewProps {
  bubble: Bubble;
  view: View;
  index: number;
  selected: Id | null;
  spotlight: Id | null;
  /** Names the AI has proposed but nobody has accepted yet. */
  pendingNames: Map<Id, string>;
  tail?: Tail;
  /** Bubbles drawn inside this one, in the rows they were drawn in. */
  rowsOf: (bubble: Bubble) => Bubble[][];
  /** Width on the finished map, which grows to hold the bubbles inside. */
  widthOf: (bubble: Bubble, nested: boolean) => number;
  nested?: boolean;
}

/**
 * Nearer cards rise a touch sooner, so the structure seems to spread from the click. Capped, because
 * local structure must be on screen within 100 ms, and speed outranks the choreography.
 */
const riseDelay = (x: number, y: number): number => {
  const origin = store.ui.rippleOrigin;
  if (!origin) return 0;
  const { x: cx, y: cy, z } = camera.state;
  return Math.min(60, Math.hypot(x * z + cx - origin.x, y * z + cy - origin.y) * 0.05);
};

const BubbleView = memo((props: BubbleViewProps) => {
  const { bubble, view, index, tail, rowsOf, widthOf, nested = false } = props;
  const selected = props.selected === bubble.id;
  const spotlight = props.spotlight === bubble.id;
  const pendingName = props.pendingNames.get(bubble.id);
  const rows = rowsOf(bubble);
  const place = view === 'map' ? bubble.map : bubble.sketch;
  // Inside another bubble, the page places it. On its own, the layout does.
  const width = nested ? (view === 'map' ? widthOf(bubble, true) : undefined) : view === 'map' ? widthOf(bubble, false) : place.w;
  const [rise] = useState(() => riseDelay(bubble.sketch.x, bubble.sketch.y));
  // Only ink and no words: the marks must stay readable through the proposal.
  const inkOnly =
    bubble.status === 'pending' &&
    !bubble.title &&
    bubble.items.length === 0 &&
    bubble.sourceStrokes.length > 0;
  const addItem = (): void => {
    const fresh = currentBubble(bubble.id);
    if (!fresh) return;
    const item: BubbleItem = { id: newId(), text: '' };
    setItems(bubble.id, [...fresh.items, item]);
    store.setUi({ editing: { type: 'bubble-item', bubble: bubble.id, item: item.id } });
  };
  return (
    <section
      data-bubble={bubble.id}
      className={[
        'bubble',
        `kind-${bubble.kind}`,
        `status-${bubble.status}`,
        `slot-${bubble.slot}`,
        inkOnly ? 'ink-only' : '',
        bubble.items.length === 0 && rows.length === 0 ? 'no-items' : '',
        rows.length > 0 ? 'has-children' : '',
        nested ? 'nested' : '',
        selected ? 'selected' : '',
        spotlight ? 'spotlight' : '',
      ].join(' ')}
      data-tail={tail?.side}
      tabIndex={view === 'map' ? 0 : -1}
      aria-label={bubble.title || 'Untitled bubble'}
      onFocus={(e) => {
        if (e.target === e.currentTarget) store.setUi({ selectedBubble: bubble.id });
      }}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          store.setUi({ editing: { type: 'bubble-title', bubble: bubble.id } });
        }
      }}
      style={
        {
          width,
          // Over the sketch a card covers the shape it came from, not just the top of it.
          minHeight:
            view === 'both' && bubble.kind === 'group' && !nested ? bubble.sketch.h : undefined,
          transform: nested ? undefined : `translate3d(${place.x}px, ${place.y}px, 0)`,
          '--i': index,
          '--rise': `${rise}ms`,
          '--tail-pos': tail ? `${tail.pos}px` : undefined,
        } as React.CSSProperties
      }
    >
      {bubble.status === 'pending' && (!nested || view !== 'map') && (
        <span className="chip">Proposed</span>
      )}
      <Field
        bubble={bubble}
        value={bubble.title}
        field="title"
        placeholder={pendingName ?? (inkOnly ? '' : undefined)}
      />
      {bubble.kind === 'group' && bubble.items.length > 0 && (
        <ul>
          {bubble.items.map((item) => (
            <Field
              key={item.id}
              bubble={bubble}
              value={item.text}
              field={item.id}
              mark={item.mark}
            />
          ))}
        </ul>
      )}
      {rows.length > 0 && (
        <div className="bubble-children">
          {rows.map((row) => (
            <div className="nest-row" key={row[0].id}>
              {row.map((child) => (
                <BubbleView key={child.id} {...props} bubble={child} tail={undefined} nested />
              ))}
            </div>
          ))}
        </div>
      )}
      {bubble.kind === 'group' && (
        <button
          type="button"
          className="bubble-add"
          aria-label={`Add a line to ${bubble.title || 'this bubble'}`}
          title="Add a line"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={addItem}
        >
          <Icon name="plus" size={16} />
        </button>
      )}
    </section>
  );
});

/** Where every nested bubble and every line sits inside its outermost bubble, from the page. */
const measureAnchors = (container: HTMLElement, key: ShownView): void => {
  const next: Record<Id, Anchor> = {};
  container.querySelectorAll<HTMLElement>(':scope > [data-bubble]').forEach((root) => {
    const rootId = root.dataset.bubble as Id;
    root.querySelectorAll<HTMLElement>('[data-bubble], [data-item]').forEach((element) => {
      let x = 0;
      let y = 0;
      let node: HTMLElement | null = element;
      // Offsets ignore transforms, so the morph between views cannot skew what is measured.
      while (node && node !== root) {
        x += node.offsetLeft;
        y += node.offsetTop;
        node = node.offsetParent as HTMLElement | null;
      }
      if (node !== root) return;
      const id = (element.dataset.bubble ?? element.dataset.item) as Id;
      next[id] = { root: rootId, x, y, w: element.offsetWidth, h: element.offsetHeight };
    });
  });
  const previous = store.ui.anchors[key];
  const ids = Object.keys(next);
  const same =
    ids.length === Object.keys(previous).length &&
    ids.every((id) => {
      const a = previous[id];
      const b = next[id];
      return (
        a !== undefined &&
        a.root === b.root &&
        Math.abs(a.x - b.x) <= 1 &&
        Math.abs(a.y - b.y) <= 1 &&
        Math.abs(a.w - b.w) <= 1 &&
        Math.abs(a.h - b.h) <= 1
      );
    });
  if (!same) store.setUi({ anchors: { ...store.ui.anchors, [key]: next } });
};

export const BubbleLayer = () => {
  const bubbles = useStore((s) => s.doc.bubbles);
  const view = useStore((s) => s.ui.view);
  const selected = useStore((s) => s.ui.selectedBubble);
  const spotlightId = useStore((s) => s.ui.present?.bubble ?? null);
  const heightsMap = useStore((s) => s.ui.heights.map);
  const containerRef = useRef<HTMLDivElement>(null);
  const key: ShownView = view === 'map' ? 'map' : 'both';

  const docId = useStore((s) => s.doc.id);
  const visible = bubbles.filter((b) => b.status !== 'rejected');
  const shown = isShownIn(key);
  // A bubble drawn inside another shows inside it whenever that one is shown in this view.
  const parentOf = new Map<Id, Id>();
  for (const bubble of visible) {
    const parent = shownParent(bubbles, bubble, shown);
    if (parent) parentOf.set(bubble.id, parent.id);
  }
  const roots = visible.filter((b) => !parentOf.has(b.id));
  const childrenOf = (parent: Bubble): Bubble[] =>
    visible.filter((b) => parentOf.get(b.id) === parent.id);
  const rowsOf = (bubble: Bubble): Bubble[][] => childRows(childrenOf(bubble));
  const mapChildrenOf = childrenIn(bubbles, 'map');
  const widthOf = (bubble: Bubble, nested: boolean): number => mapWidth(bubble, mapChildrenOf, nested);
  const structureKey = visible.map((b) => `${b.id}<${parentOf.get(b.id) ?? ''}`).join(',');

  const accepted = roots.filter((b) => b.status === 'accepted');
  const proposals = useStore((s) => s.doc.proposals);
  const pendingNames = new Map<Id, string>();
  for (const proposal of proposals) {
    if (proposal.status === 'pending' && proposal.body.kind === 'rename') {
      pendingNames.set(proposal.body.bubble, proposal.body.title);
    }
  }
  const groupBoxes = accepted
    .filter((b) => b.kind === 'group')
    .map((b) => ({ x: b.map.x, y: b.map.y, w: b.map.w, h: heightOf(b, b.map.w) }));
  const acceptedKey = bubbles
    .filter((b) => b.status === 'accepted')
    .map((b) => `${b.id}:${b.pinned}:${b.items.length}:${b.parent ?? ''}`)
    .join(',');

  // Bubble heights follow fonts and text, so they are measured from the page.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const observer = new ResizeObserver((entries) => {
      const heightKey = store.ui.view === 'map' ? 'map' : 'both';
      let changed = false;
      const next = { ...store.ui.heights[heightKey] };
      for (const entry of entries) {
        const element = entry.target as HTMLElement;
        const id = element.dataset.bubble;
        if (!id) continue;
        const height = element.offsetHeight;
        if (Math.abs((next[id] ?? 0) - height) > 1) {
          next[id] = height;
          changed = true;
        }
      }
      if (changed) store.setUi({ heights: { ...store.ui.heights, [heightKey]: next } });
      measureAnchors(container, heightKey);
    });
    container.querySelectorAll<HTMLElement>('[data-bubble]').forEach((b) => observer.observe(b));
    return () => observer.disconnect();
  }, [docId, structureKey, view]); // eslint-disable-line react-hooks/exhaustive-deps

  // Text edits and new lines move what sits below them without resizing anything observed.
  useLayoutEffect(() => {
    if (containerRef.current) measureAnchors(containerRef.current, key);
  });

  useEffect(() => {
    if (view === 'map') relayout();
  }, [view, acceptedKey, heightsMap]);

  return (
    <div ref={containerRef}>
      {roots.map((bubble) => (
        <BubbleView
          key={bubble.id}
          bubble={bubble}
          view={view}
          index={visible.indexOf(bubble)}
          selected={selected}
          spotlight={spotlightId}
          pendingNames={pendingNames}
          rowsOf={rowsOf}
          widthOf={widthOf}
          tail={
            bubble.kind === 'note' && view === 'map'
              ? noteTail(
                  {
                    x: bubble.map.x,
                    y: bubble.map.y,
                    w: bubble.map.w,
                    h: heightOf(bubble, bubble.map.w),
                  },
                  groupBoxes,
                )
              : undefined
          }
        />
      ))}
    </div>
  );
};
