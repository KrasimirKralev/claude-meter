// What pressing Digitize does: local structure at once, then AI proposals as they stream in.

import { LineSplitter } from '../../shared/digitize.ts';
import type { DigitizeRequest, StreamEvent } from '../../shared/digitize.ts';
import { changeView, fitView } from '../canvas/actions.ts';
import { claimedStrokeIds, claimedTextIds, dropPending, unionBoxes } from '../doc/ops.ts';
import { bindAiProposal } from '../doc/proposals.ts';
import type { Bubble, Id, Link, Proposal } from '../doc/types.ts';
import { ripple } from '../effects/ripple.ts';
import { recognizeInWorker } from '../recognize/client.ts';
import { showToast, store } from '../state/store.ts';
import { applyRecognition } from './apply.ts';
import { buildRequest } from './request.ts';
import type { Scope } from './request.ts';
import { snapshotSketch } from './snapshot.ts';

/** Longer than the server's own limit, so this only fires if the server itself stops answering. */
const CLIENT_TIMEOUT_MS = 40_000;
const REACH_FAILED = 'Could not reach the AI. Your sketch and the local map are safe. Try again.';

export type { Scope } from './request.ts';

let controller: AbortController | null = null;
let generation = 0;
let lastRequest: { scope: Scope | null; needsVision: boolean } | null = null;

export const stopDigitize = (): void => {
  controller?.abort();
  controller = null;
  if (store.ui.digitize.state === 'streaming') {
    store.setUi({ digitize: { ...store.ui.digitize, state: 'idle' } });
  }
};

/** A group the AI read from ink has no drawn position yet, so it goes below everything else. */
const placeBelow = (bubble: Bubble): Bubble => {
  const doc = store.doc;
  const box = unionBoxes([
    ...doc.strokes.map((s) => s.box),
    ...doc.bubbles
      .filter((b) => b.status !== 'rejected')
      .map((b) => ({ x: b.sketch.x, y: b.sketch.y, w: b.sketch.w, h: b.sketch.h ?? 120 })),
  ]);
  const x = box?.x ?? 0;
  const y = (box ? box.y + box.h : 0) + 40;
  return { ...bubble, sketch: { x, y, w: 280, h: 120 } };
};

const streamProposals = async (
  docId: Id,
  run: number,
  request: DigitizeRequest,
  started: number,
  signal: AbortSignal,
): Promise<void> => {
  const setStatus = (patch: Partial<typeof store.ui.digitize>): void => {
    store.setUi({ digitize: { ...store.ui.digitize, ...patch } });
  };
  const response = await fetch('/api/digitize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  });
  if (!response.ok || !response.body) throw new Error(`Server answered ${response.status}`);

  const handle = (event: StreamEvent): void => {
    // Undo went back past this Digitize, or another map opened, so these results belong nowhere.
    if (store.doc.id !== docId || store.doc.run !== run) {
      stopDigitize();
      return;
    }
    switch (event.type) {
      case 'start':
        setStatus({ provider: event.provider });
        break;
      case 'proposal': {
        const bound = bindAiProposal(store.doc, event.proposal, placeBelow);
        if (!bound) break;
        const add: { proposals: Proposal[]; bubbles: Bubble[]; links: Link[]; drop?: Id[] } = {
          proposals: [bound.proposal],
          bubbles: bound.bubble ? [bound.bubble] : [],
          links: bound.link ? [bound.link] : [],
        };
        if (bound.replaces) add.drop = [bound.replaces];
        store.appendFromStream(run, add);
        if (store.ui.digitize.firstMs === undefined) {
          setStatus({ firstMs: performance.now() - started });
        }
        break;
      }
      case 'done':
        setStatus({ state: 'done', totalMs: performance.now() - started });
        break;
      case 'error':
        setStatus({
          state: event.code === 'no-provider' ? 'local-only' : 'failed',
          message: event.message,
          totalMs: performance.now() - started,
        });
        break;
    }
  };

  const splitter = new LineSplitter();
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of splitter.push(decoder.decode(value, { stream: true }))) {
      if (line.trim()) handle(JSON.parse(line) as StreamEvent);
    }
  }
  for (const line of splitter.flush()) handle(JSON.parse(line) as StreamEvent);
  if (store.ui.digitize.state === 'streaming') {
    setStatus({ state: 'failed', message: 'The AI stopped early. Try again.' });
  }
};

const runStream = async (request: DigitizeRequest, started: number): Promise<void> => {
  const active = new AbortController();
  controller = active;
  let timedOut = false;
  const guard = setTimeout(() => {
    timedOut = true;
    active.abort();
  }, CLIENT_TIMEOUT_MS);
  try {
    await streamProposals(store.doc.id, store.doc.run, request, started, active.signal);
  } catch (error) {
    if (active.signal.aborted && !timedOut) return;
    console.error('Digitize stream failed', error);
    store.setUi({ digitize: { ...store.ui.digitize, state: 'failed', message: REACH_FAILED } });
  } finally {
    clearTimeout(guard);
  }
};

export const digitize = async (
  origin: { x: number; y: number } = { x: innerWidth / 2, y: innerHeight / 2 },
): Promise<void> => {
  // A second press before the first has answered replaces it, so nothing is proposed twice.
  generation += 1;
  const mine = generation;
  stopDigitize();
  const started = performance.now();
  const selection = new Set(store.ui.selection);
  const scoped = selection.size > 0;
  // Reading again replaces the last reading wherever nobody accepted any of it yet.
  const before = dropPending(store.doc, scoped ? selection : null);
  const claimedStrokes = claimedStrokeIds(before);
  const claimedTexts = claimedTextIds(before);
  const strokes = before.strokes.filter(
    (s) => !claimedStrokes.has(s.id) && (!scoped || selection.has(s.id)),
  );
  const texts = before.texts.filter(
    (t) => !claimedTexts.has(t.id) && (!scoped || selection.has(t.id)),
  );
  const hasMap = before.bubbles.some((b) => b.status !== 'rejected');
  if (strokes.length === 0 && texts.length === 0 && !hasMap) {
    showToast('Nothing to digitize yet. Draw or type something first.');
    return;
  }

  let result;
  try {
    result = await recognizeInWorker(
      strokes.map(({ id, points, color, arrow }) => ({ id, points, color, arrow })),
      texts,
    );
  } catch (error) {
    console.error('The local pass failed', error);
    showToast('The sketch could not be read. Your work is safe. Try again.');
    return;
  }
  if (mine !== generation) return;

  const run = store.doc.run + 1;
  const found = result.groups.length + result.notes.length;
  if (found === 0 && !hasMap) {
    showToast('No shapes or text found yet. Draw a box around some words and try again.');
    return;
  }

  const known = new Set(before.bubbles.map((b) => b.id));
  store.setUi({ rippleOrigin: origin });
  store.commit((doc) => applyRecognition(dropPending(doc, scoped ? selection : null), result, run));
  const localMs = performance.now() - started;
  store.setUi({
    selection: [],
    digitize: { state: 'streaming', localMs },
    focusedProposal: null,
  });
  ripple(origin.x, origin.y);
  if (store.ui.view === 'sketch') changeView('both');
  else fitView();

  const scope: Scope | null = scoped
    ? {
        bubbles: new Set(store.doc.bubbles.filter((b) => !known.has(b.id)).map((b) => b.id)),
        texts: new Set(texts.map((t) => t.id)),
        strokes: new Set(strokes.map((s) => s.id)),
      }
    : null;
  lastRequest = { scope, needsVision: result.needsVision };
  const image = result.needsVision ? snapshotSketch(store.doc, scope) : undefined;
  await runStream(buildRequest(store.doc, scope, image), started);
};

/** Runs only the AI part again, on the same part of the map as last time. */
export const retryAi = async (): Promise<void> => {
  stopDigitize();
  const started = performance.now();
  const { scope = null, needsVision = false } = lastRequest ?? {};
  store.setUi({ digitize: { state: 'streaming', localMs: store.ui.digitize.localMs } });
  const image = needsVision ? snapshotSketch(store.doc, scope) : undefined;
  await runStream(buildRequest(store.doc, scope, image), started);
};
