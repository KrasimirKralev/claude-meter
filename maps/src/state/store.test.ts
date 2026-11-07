import { describe, expect, it } from 'vitest';
import { Store } from './store.ts';

const titled = (store: Store, title: string, options = {}) =>
  store.commit((doc) => ({ ...doc, title }), options);

describe('history', () => {
  it('undoes and redoes', () => {
    const store = new Store();
    const start = store.doc.title;
    titled(store, 'A');
    titled(store, 'B');
    store.undo();
    expect(store.doc.title).toBe('A');
    store.undo();
    expect(store.doc.title).toBe(start);
    store.redo();
    expect(store.doc.title).toBe('A');
  });

  it('drops the redo path after a new change', () => {
    const store = new Store();
    titled(store, 'A');
    store.undo();
    titled(store, 'B');
    expect(store.canRedo).toBe(false);
  });

  it('merges quick repeats with the same key into one step', () => {
    const store = new Store();
    const start = store.doc.title;
    titled(store, 'A', { coalesce: 'typing' });
    titled(store, 'AB', { coalesce: 'typing' });
    store.undo();
    expect(store.doc.title).toBe(start);
  });

  it('skips history when asked', () => {
    const store = new Store();
    titled(store, 'A', { history: false });
    expect(store.canUndo).toBe(false);
  });

  it('counts a whole gesture as one step', () => {
    const store = new Store();
    const start = store.doc.title;
    store.beginGesture();
    titled(store, 'A');
    titled(store, 'B');
    store.endGesture();
    expect(store.doc.title).toBe('B');
    store.undo();
    expect(store.doc.title).toBe(start);
  });

  it('adds nothing to history for an empty gesture', () => {
    const store = new Store();
    store.beginGesture();
    store.endGesture();
    expect(store.canUndo).toBe(false);
  });
});

describe('gestures', () => {
  it('cancelling puts the document back and adds no undo step', () => {
    const store = new Store();
    const start = store.doc;
    store.beginGesture();
    titled(store, 'dragging');
    store.cancelGesture();
    expect(store.doc).toBe(start);
    expect(store.canUndo).toBe(false);
  });

  it('after a cancel, history records normally again', () => {
    const store = new Store();
    store.beginGesture();
    store.cancelGesture();
    titled(store, 'A');
    expect(store.canUndo).toBe(true);
  });

  it('ignores undo and redo while a gesture is open', () => {
    const store = new Store();
    titled(store, 'A');
    store.beginGesture();
    titled(store, 'B');
    store.undo();
    expect(store.doc.title).toBe('B');
    store.endGesture();
    store.undo();
    expect(store.doc.title).toBe('A');
  });

  it('a stream arriving during a drag is not lost when the drag is undone', () => {
    const store = new Store();
    store.commit((doc) => ({ ...doc, run: 1 }));
    store.beginGesture();
    titled(store, 'dragged');
    store.appendFromStream(1, {
      proposals: [
        { id: 'p', status: 'pending', origin: 'ai', body: { kind: 'summary', text: 'x' } },
      ],
      bubbles: [],
      links: [],
    });
    store.endGesture();
    store.undo();
    expect(store.doc.title).not.toBe('dragged');
    expect(store.doc.proposals).toHaveLength(1);
  });

  it('a gesture that only saw a stream arrive adds no undo step', () => {
    const store = new Store();
    store.commit((doc) => ({ ...doc, run: 1 }), { history: false });
    store.beginGesture();
    store.appendFromStream(1, { proposals: [], bubbles: [], links: [] });
    store.endGesture();
    expect(store.canUndo).toBe(false);
  });
});

describe('appendFromStream', () => {
  const proposal = {
    id: 'p',
    status: 'pending' as const,
    origin: 'ai' as const,
    body: { kind: 'summary' as const, text: 'x' },
  };

  it('survives an undo within the same run', () => {
    const store = new Store();
    store.commit((doc) => ({ ...doc, run: 1 }));
    titled(store, 'accepted something');
    store.appendFromStream(1, { proposals: [proposal], bubbles: [], links: [] });
    store.undo();
    expect(store.doc.proposals).toHaveLength(1);
  });

  it('does not touch states from before the run', () => {
    const store = new Store();
    store.commit((doc) => ({ ...doc, run: 1 }));
    store.appendFromStream(1, { proposals: [proposal], bubbles: [], links: [] });
    store.undo();
    expect(store.doc.run).toBe(0);
    expect(store.doc.proposals).toHaveLength(0);
  });
});
