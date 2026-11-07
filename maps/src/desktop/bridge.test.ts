import { afterEach, describe, expect, it, vi } from 'vitest';
import { createExampleDoc } from '../doc/example.ts';
import { createDoc } from '../doc/ops.ts';
import type { Bubble, MapDoc } from '../doc/types.ts';
import { listenForOpen, previewLinksOf, previewOf, reportMapsSoon } from './bridge.ts';

const bubble = (id: string, x: number, slot: number, status: Bubble['status'] = 'accepted'): Bubble => ({
  id,
  kind: 'group',
  title: id,
  items: [],
  status,
  slot,
  sketch: { x: 0, y: 0, w: 100 },
  map: { x, y: 50, w: 100 },
  pinned: false,
  sourceStrokes: [],
  sourceTexts: [],
});

const docWith = (bubbles: Bubble[]): MapDoc => ({ ...createDoc(), bubbles });

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { meterMaps?: unknown }).meterMaps;
});

describe('previewOf', () => {
  it('fits the bubbles into a 100-wide box and keeps their colour slots', () => {
    const doc = docWith([bubble('a', 200, 0), bubble('b', 400, 1)]);
    const preview = previewOf(doc);
    expect(preview[0]).toMatchObject({ x: 0, y: 0 });
    expect(preview[1].x + preview[1].w).toBeCloseTo(100, 0);
    expect(preview[0].color).not.toBe(preview[1].color);
  });

  it('leaves out proposals nobody accepted', () => {
    expect(previewOf(docWith([bubble('a', 0, 0, 'pending')]))).toEqual([]);
  });

  it('wraps a colour slot past the end of the palette', () => {
    expect(previewOf(docWith([bubble('a', 0, 12)]))[0].color).toMatch(/^#/);
  });
});

describe('previewLinksOf', () => {
  it('points arrows at the bubbles in the preview and drops the rest', () => {
    const doc: MapDoc = {
      ...docWith([bubble('a', 0, 0), bubble('hidden', 0, 1, 'pending'), bubble('b', 200, 1)]),
      links: [
        { id: '1', from: 'a', to: 'b', status: 'accepted', sourceStrokes: [] },
        { id: '2', from: 'a', to: 'hidden', status: 'accepted', sourceStrokes: [] },
        { id: '3', from: 'b', to: 'a', status: 'pending', sourceStrokes: [] },
      ],
    };
    expect(previewLinksOf(doc)).toEqual([[0, 1]]);
  });
});

describe('in a browser tab, with no app around it', () => {
  it('reports nothing and never reads the database', () => {
    const readAll = vi.fn(async () => [createExampleDoc()]);
    reportMapsSoon(readAll);
    expect(readAll).not.toHaveBeenCalled();
  });

  it('ignores a request to listen', () => {
    expect(() => listenForOpen(() => undefined)).not.toThrow();
  });
});

describe('inside the app', () => {
  it('still lists the other maps when one is damaged', async () => {
    vi.useFakeTimers();
    const reportMaps = vi.fn();
    (globalThis as { meterMaps?: unknown }).meterMaps = { reportMaps, onOpen: vi.fn() };
    const damaged = { id: 'bad', title: 'Bad', updatedAt: 2 } as unknown as MapDoc;
    const good = { ...docWith([bubble('a', 0, 0)]), id: 'good', updatedAt: 1 };
    reportMapsSoon(async () => [damaged, good]);
    await vi.runAllTimersAsync();
    const reported = reportMaps.mock.calls[0][0];
    expect(reported.map((m: { id: string }) => m.id)).toEqual(['bad', 'good']);
    expect(reported[0].preview).toEqual([]);
    expect(reported[1].preview).toHaveLength(1);
  });

  it('sends the newest map first, once, after changes settle', async () => {
    vi.useFakeTimers();
    const reportMaps = vi.fn();
    (globalThis as { meterMaps?: unknown }).meterMaps = { reportMaps, onOpen: vi.fn() };
    const older = { ...docWith([]), id: 'older', updatedAt: 1 };
    const newer = { ...docWith([]), id: 'newer', updatedAt: 2 };
    const readAll = async (): Promise<MapDoc[]> => [older, newer];
    reportMapsSoon(readAll);
    reportMapsSoon(readAll);
    await vi.runAllTimersAsync();
    expect(reportMaps).toHaveBeenCalledTimes(1);
    expect(reportMaps.mock.calls[0][0].map((m: { id: string }) => m.id)).toEqual(['newer', 'older']);
  });
});
