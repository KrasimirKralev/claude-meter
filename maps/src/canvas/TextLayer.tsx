import { memo, useEffect, useRef } from 'react';
import { claimedTextIds, removeTexts, upsertText } from '../doc/ops.ts';
import type { Id, TextNote } from '../doc/types.ts';
import { store, useStore } from '../state/store.ts';

const placeCaretAtEnd = (element: HTMLElement): void => {
  element.focus();
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
};

interface EditorProps {
  id: Id;
  x: number;
  y: number;
  initial: string;
  wrap?: number;
}

const TextEditor = ({ id, x, y, initial, wrap }: EditorProps) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current!;
    element.textContent = initial;
    placeCaretAtEnd(element);
  }, [initial]);

  const finish = (): void => {
    const element = ref.current;
    if (!element) return;
    const text = (element.innerText ?? '').replace(/\n+$/, '').trim();
    const existing = store.doc.texts.find((t) => t.id === id);
    if (text) {
      const note: TextNote = {
        id,
        x,
        y,
        text,
        w: element.offsetWidth,
        h: element.offsetHeight,
        wrap,
      };
      if (!existing || existing.text !== text) store.commit((doc) => upsertText(doc, note));
    } else if (existing) {
      store.commit((doc) => removeTexts(doc, new Set([id])));
    }
    store.setUi({ draftText: null, editing: null });
  };

  return (
    <div
      ref={ref}
      className="raw-text"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      role="textbox"
      aria-label="Text on the canvas"
      aria-multiline="true"
      style={{ left: x, top: y, width: wrap }}
      onBlur={finish}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          ref.current?.blur();
        }
      }}
    />
  );
};

const StaticText = memo(({ note, selected }: { note: TextNote; selected: boolean }) => (
  <div
    className={`raw-text ${selected ? 'selected' : ''}`}
    data-text={note.id}
    style={{ left: note.x, top: note.y, width: note.wrap }}
  >
    {note.text}
  </div>
));

export const TextLayer = () => {
  const texts = useStore((s) => s.doc.texts);
  const bubbles = useStore((s) => s.doc.bubbles);
  const view = useStore((s) => s.ui.view);
  const selection = useStore((s) => s.ui.selection);
  const editing = useStore((s) => s.ui.editing);
  const draft = useStore((s) => s.ui.draftText);
  // Words a bubble has claimed are drawn by that bubble, except in Sketch, which shows the source.
  const claimed = view === 'both' ? claimedTextIds({ ...store.doc, bubbles }) : null;
  const editingId = editing?.type === 'text' ? editing.id : null;
  return (
    <>
      {texts.map((note) => {
        if (claimed?.has(note.id)) return null;
        if (note.id === editingId) {
          return (
            <TextEditor
              key={note.id}
              id={note.id}
              x={note.x}
              y={note.y}
              initial={note.text}
              wrap={note.wrap}
            />
          );
        }
        return <StaticText key={note.id} note={note} selected={selection.includes(note.id)} />;
      })}
      {draft && <TextEditor key={draft.id} id={draft.id} x={draft.x} y={draft.y} initial="" />}
    </>
  );
};
