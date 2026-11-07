// One store for the undoable document and the passing interface state.
// The ink path reads it directly and never waits for React.

import { useSyncExternalStore } from 'react';
import { createDoc } from '../doc/ops.ts';
import type { Bubble, Id, InkColor, Link, MapDoc, Proposal, Tool, View } from '../doc/types.ts';

export type Theme = 'dark' | 'light';

export type Editing =
  | { type: 'text'; id: Id }
  | { type: 'bubble-title'; bubble: Id }
  | { type: 'bubble-item'; bubble: Id; item: Id };

export interface DigitizeStatus {
  state: 'idle' | 'streaming' | 'done' | 'failed' | 'local-only';
  message?: string;
  provider?: string;
  localMs?: number;
  firstMs?: number;
  totalMs?: number;
}

export interface UiState {
  view: View;
  tool: Tool;
  penColor: InkColor;
  theme: Theme;
  selection: Id[];
  selectedBubble: Id | null;
  selectedLink: Id | null;
  editing: Editing | null;
  /** A text box being typed for the first time. It joins the document only if it gets words. */
  draftText: { id: Id; x: number; y: number } | null;
  digitize: DigitizeStatus;
  focusedProposal: Id | null;
  toast: { id: number; text: string } | null;
  morphing: boolean;
  present: { index: number; bubble: Id | null } | null;
  menu: 'maps' | 'export' | 'help' | null;
  /** Where the last Digitize started, so the cards can rise as the ring of dots reaches them. */
  rippleOrigin: { x: number; y: number } | null;
  /** Measured height of the map's title block. */
  headerH: number;
  /** Measured bubble heights per view, kept out of the document because they follow the fonts. */
  heights: { both: Record<Id, number>; map: Record<Id, number> };
}

const MAX_HISTORY = 200;

/** The page's first lines have already chosen, before first paint. */
const readTheme = (): Theme => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

export const initialUi = (): UiState => ({
  view: 'sketch',
  tool: 'pen',
  penColor: 'ink',
  theme: typeof document === 'undefined' ? 'dark' : readTheme(),
  selection: [],
  selectedBubble: null,
  selectedLink: null,
  editing: null,
  draftText: null,
  digitize: { state: 'idle' },
  focusedProposal: null,
  toast: null,
  morphing: false,
  present: null,
  menu: null,
  rippleOrigin: null,
  headerH: 0,
  heights: { both: {}, map: {} },
});

type Listener = () => void;

export class Store {
  doc: MapDoc = createDoc();
  ui: UiState = initialUi();
  private past: MapDoc[] = [];
  private future: MapDoc[] = [];
  private listeners = new Set<Listener>();
  private coalesceKey: string | null = null;
  private coalesceAt = 0;
  private gestureStart: MapDoc | null = null;
  private gestureChanged = false;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  /** Replaces the open map and forgets the history of the previous one. */
  load(doc: MapDoc): void {
    this.doc = doc;
    this.past = [];
    this.future = [];
    this.gestureStart = null;
    this.ui = {
      ...this.ui,
      selection: [],
      selectedBubble: null,
      selectedLink: null,
      editing: null,
      draftText: null,
      focusedProposal: null,
      digitize: { state: 'idle' },
      heights: { both: {}, map: {} },
    };
    this.emit();
  }

  /**
   * Applies a change to the document. `coalesce` merges quick repeats with the same key into one
   * undo step. `history: false` is for changes that must not be undo steps, like automatic layout.
   */
  commit(
    update: (doc: MapDoc) => MapDoc,
    options: { history?: boolean; coalesce?: string } = {},
  ): void {
    const next = update(this.doc);
    if (next === this.doc) return;
    const stamped = { ...next, updatedAt: Date.now() };
    if (this.gestureStart) this.gestureChanged = true;
    if (options.history !== false && !this.gestureStart) {
      const now = Date.now();
      const merges =
        options.coalesce !== undefined &&
        options.coalesce === this.coalesceKey &&
        now - this.coalesceAt < 800;
      if (!merges) {
        this.past.push(this.doc);
        if (this.past.length > MAX_HISTORY) this.past.shift();
      }
      this.future = [];
      this.coalesceKey = options.coalesce ?? null;
      this.coalesceAt = now;
    }
    this.doc = stamped;
    this.emit();
  }

  /** Everything between begin and end counts as one undo step, like a whole drag. */
  beginGesture(): void {
    this.gestureStart = this.doc;
    this.gestureChanged = false;
  }

  endGesture(): void {
    if (this.gestureStart && this.gestureChanged) {
      this.past.push(this.gestureStart);
      if (this.past.length > MAX_HISTORY) this.past.shift();
      this.future = [];
    }
    this.gestureStart = null;
  }

  /** Puts the document back as it was when the gesture began. */
  cancelGesture(): void {
    if (this.gestureStart) {
      this.doc = this.gestureStart;
      this.gestureStart = null;
      this.emit();
    }
  }

  /**
   * Adds what the AI stream delivers to the document and to every saved state of the same run, so
   * undoing an Accept never loses proposals that arrived after it.
   */
  appendFromStream(run: number, add: { proposals: Proposal[]; bubbles: Bubble[]; links: Link[] }): void {
    const patch = (doc: MapDoc): MapDoc =>
      doc.run === run
        ? {
            ...doc,
            proposals: [...doc.proposals, ...add.proposals],
            bubbles: [...doc.bubbles, ...add.bubbles],
            links: [...doc.links, ...add.links],
          }
        : doc;
    this.past = this.past.map(patch);
    this.future = this.future.map(patch);
    if (this.gestureStart) this.gestureStart = patch(this.gestureStart);
    this.doc = { ...patch(this.doc), updatedAt: Date.now() };
    this.emit();
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  undo(): void {
    // Undo in the middle of a drag would pull the document out from under it.
    if (this.gestureStart) return;
    const previous = this.past.pop();
    if (!previous) return;
    this.future.push(this.doc);
    this.doc = previous;
    this.coalesceKey = null;
    this.clearDanglingUi();
    this.emit();
  }

  redo(): void {
    if (this.gestureStart) return;
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.doc);
    this.doc = next;
    this.coalesceKey = null;
    this.clearDanglingUi();
    this.emit();
  }

  private clearDanglingUi(): void {
    this.ui = { ...this.ui, selection: [], selectedBubble: null, selectedLink: null };
  }

  setUi(patch: Partial<UiState>): void {
    this.ui = { ...this.ui, ...patch };
    this.emit();
  }
}

export const store = new Store();

/** Selectors must return stable values: a field, or something memoised by the caller. */
export const useStore = <T,>(selector: (s: Store) => T): T =>
  useSyncExternalStore(store.subscribe, () => selector(store));

let toastId = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const showToast = (text: string): void => {
  toastId += 1;
  store.setUi({ toast: { id: toastId, text } });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => store.setUi({ toast: null }), 4200);
};
