import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { heightOf, relayout } from '../canvas/actions.ts';
import { camera } from '../canvas/camera.ts';
import { newId, updateBubble } from '../doc/ops.ts';
import type { Bubble, BubbleItem, Id, View } from '../doc/types.ts';
import { store, useStore } from '../state/store.ts';
import { Icon } from '../ui/primitives.tsx';
import { noteTail } from './layout.ts';
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
}

/** One line of a bubble. Plain text until clicked, then a small editor. */
const Field = ({ bubble, value, field, placeholder }: FieldProps) => {
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
  if (editing) {
    return (
      <Tag
        ref={ref as never}
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
    <Tag data-edit={field} data-placeholder={hint}>
      {value}
    </Tag>
  );
};

interface BubbleViewProps {
  bubble: Bubble;
  view: View;
  index: number;
  selected: boolean;
  spotlight: boolean;
  /** A name the AI has proposed but nobody has accepted yet. */
  pendingName?: string;
  tail?: Tail;
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

const BubbleView = memo(({ bubble, view, index, selected, spotlight, pendingName, tail }: BubbleViewProps) => {
  const place = view === 'map' ? bubble.map : bubble.sketch;
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
        bubble.items.length === 0 ? 'no-items' : '',
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
          width: place.w,
          // Over the sketch a card covers the shape it came from, not just the top of it.
          minHeight: view === 'both' && bubble.kind === 'group' ? bubble.sketch.h : undefined,
          transform: `translate3d(${place.x}px, ${place.y}px, 0)`,
          '--i': index,
          '--rise': `${rise}ms`,
          '--tail-pos': tail ? `${tail.pos}px` : undefined,
        } as React.CSSProperties
      }
    >
      {bubble.status === 'pending' && <span className="chip">Proposed</span>}
      <Field
        bubble={bubble}
        value={bubble.title}
        field="title"
        placeholder={inkOnly ? (pendingName ?? '') : undefined}
      />
      {bubble.kind === 'group' && bubble.items.length > 0 && (
        <ul>
          {bubble.items.map((item) => (
            <Field key={item.id} bubble={bubble} value={item.text} field={item.id} />
          ))}
        </ul>
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

export const BubbleLayer = () => {
  const bubbles = useStore((s) => s.doc.bubbles);
  const view = useStore((s) => s.ui.view);
  const selected = useStore((s) => s.ui.selectedBubble);
  const spotlightId = useStore((s) => s.ui.present?.bubble ?? null);
  const heightsMap = useStore((s) => s.ui.heights.map);
  const containerRef = useRef<HTMLDivElement>(null);

  const docId = useStore((s) => s.doc.id);
  const visible = bubbles.filter((b) => b.status !== 'rejected');
  const accepted = visible.filter((b) => b.status === 'accepted');
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
  const acceptedKey = accepted.map((b) => `${b.id}:${b.pinned}:${b.items.length}`).join(',');

  // Bubble heights follow fonts and text, so they are measured from the page.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const observer = new ResizeObserver((entries) => {
      const key = store.ui.view === 'map' ? 'map' : 'both';
      let changed = false;
      const next = { ...store.ui.heights[key] };
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
      if (changed) store.setUi({ heights: { ...store.ui.heights, [key]: next } });
    });
    container.querySelectorAll<HTMLElement>('[data-bubble]').forEach((b) => observer.observe(b));
    return () => observer.disconnect();
  }, [docId, visible.map((b) => b.id).join(','), view]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (view === 'map') relayout();
  }, [view, acceptedKey, heightsMap]);

  return (
    <div ref={containerRef}>
      {visible.map((bubble, index) => (
        <BubbleView
          key={bubble.id}
          bubble={bubble}
          view={view}
          index={index}
          selected={selected === bubble.id}
          spotlight={spotlightId === bubble.id}
          pendingName={pendingNames.get(bubble.id)}
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
