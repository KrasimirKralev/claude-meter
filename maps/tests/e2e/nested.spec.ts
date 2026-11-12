// Nested sketches: lines in a box with two of them circled, arrows from the circles and from the
// box, and boxes drawn inside a box. The geometry is a real sketch's, with stand-in words.

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { NESTED_STROKES, NESTED_TEXTS } from '../../src/recognize/nested-sketch.fixture.ts';
import { RELATIONS_STROKES, RELATIONS_TEXTS } from '../../src/recognize/relations-sketch.fixture.ts';
import { openBlank } from './helpers.ts';

/** Puts a sketch straight into the open map's storage, then reloads it. */
const loadSketch = async (
  page: Page,
  strokes: { id: string; color: string; arrow?: boolean; points: number[] }[],
  texts: unknown[],
): Promise<void> => {
  await page.evaluate(
    async ({ strokes: raw, texts: notes }) => {
      const id = localStorage.getItem('balonche-last-map') ?? 'nested';
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('balonche', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const now = Date.now();
      const doc = {
        version: 1,
        id,
        title: 'Untitled map',
        summary: '',
        style: 'candy',
        bulgarianLetters: false,
        run: 0,
        createdAt: now,
        updatedAt: now,
        bubbles: [],
        links: [],
        proposals: [],
        texts: notes,
        strokes: raw.map((s) => {
          const points = Float32Array.from(s.points);
          let minX = Infinity;
          let minY = Infinity;
          let maxX = -Infinity;
          let maxY = -Infinity;
          for (let i = 0; i < points.length; i += 3) {
            minX = Math.min(minX, points[i]);
            maxX = Math.max(maxX, points[i]);
            minY = Math.min(minY, points[i + 1]);
            maxY = Math.max(maxY, points[i + 1]);
          }
          return {
            ...s,
            points,
            width: 2.4,
            box: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
          };
        }),
      };
      await new Promise((resolve, reject) => {
        const tx = db.transaction('maps', 'readwrite');
        tx.objectStore('maps').put(doc);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      localStorage.setItem('balonche-last-map', id);
    },
    { strokes, texts },
  );
  await page.reload();
  await expect(page.getByRole('button', { name: 'Digitize' })).toBeVisible();
};

const plain = NESTED_STROKES.map((s) => ({ ...s, points: Array.from(s.points) }));

test('a box with circled lines keeps them as its lines, and arrows leave from them', async ({ page }) => {
  await openBlank(page);
  await loadSketch(page, plain, NESTED_TEXTS);
  await page.getByRole('button', { name: 'Digitize' }).click();

  const big = page.locator('[data-bubble]').filter({ hasText: 'member registration' });
  await expect(big.locator('li')).toHaveText(['Library', 'member registration', 'Workshoops']);
  await expect(big.locator('li.marked')).toHaveCount(2);
  await expect(page.locator('section[data-bubble]')).toHaveCount(4);
  await expect(page.locator('.link-line')).toHaveCount(3);

  await page.getByRole('button', { name: 'Accept all and see the map' }).click();
  await expect(page.locator('.surface[data-view="map"]')).toBeVisible();
  // The view glides into place first.
  await page.waitForTimeout(1200);
  // The arrow from the circled line leaves at that line's height, not from the box's middle.
  const line = await big.locator('li', { hasText: 'Library' }).boundingBox();
  const starts = await page.locator('.link-line').evaluateAll((paths) =>
    paths.map((p) => {
      const start = (p as SVGPathElement).getPointAtLength(0);
      const matrix = (p as SVGPathElement).getScreenCTM() as DOMMatrix;
      return new DOMPoint(start.x, start.y).matrixTransform(matrix).y;
    }),
  );
  const middle = (line?.y ?? 0) + (line?.height ?? 0) / 2;
  expect(starts.some((y) => Math.abs(y - middle) < 6)).toBe(true);
});

test('a box drawn inside a box shows inside it, over the sketch and on the map', async ({ page }) => {
  await openBlank(page);
  const rect = (id: string, x: number, y: number, w: number, h: number) => ({
    id,
    color: 'ink',
    points: [x, y, 0.5, x + w, y, 0.5, x + w, y + h, 0.5, x, y + h, 0.5, x, y + 3, 0.5],
  });
  const text = (id: string, x: number, y: number, value: string) => ({
    id,
    x,
    y,
    text: value,
    w: 120,
    h: value.split('\n').length * 23,
  });
  await loadSketch(
    page,
    [rect('outer', 100, 100, 700, 400), rect('left', 140, 180, 280, 280), rect('right', 480, 180, 280, 280)],
    [
      text('t0', 130, 120, 'Platform'),
      text('t1', 160, 200, 'Front end\nPages'),
      text('t2', 500, 200, 'Back end\nAPI'),
    ],
  );
  await page.getByRole('button', { name: 'Digitize' }).click();
  const outer = page.locator('section[data-bubble]').filter({ hasText: 'Platform' }).first();
  await expect(outer.locator('section.nested')).toHaveCount(2);
  await page.getByRole('button', { name: 'Accept all and see the map' }).click();
  await expect(outer.locator('section.nested h2')).toHaveText(['Front end', 'Back end']);
  const box = await outer.boundingBox();
  for (const child of await outer.locator('section.nested').all()) {
    const inner = await child.boundingBox();
    expect(inner && box && inner.x >= box.x && inner.x + inner.width <= box.x + box.width).toBe(true);
  }
});

test('a box of names in three strokes sends an arrow from each name, laid out in one column', async ({
  page,
}) => {
  await openBlank(page);
  const strokes = RELATIONS_STROKES.map((s) => ({ ...s, points: Array.from(s.points) }));
  await loadSketch(page, strokes, RELATIONS_TEXTS);
  await page.getByRole('button', { name: 'Digitize' }).click();

  const people = page.locator('[data-bubble]').filter({ hasText: 'Boris' });
  await expect(people.locator('li')).toHaveText(['Anton', 'Boris', 'Ivan']);
  // Three boxes of facts, the box of names, and three single words an arrow points at.
  await expect(page.locator('section[data-bubble]')).toHaveCount(7);
  await expect(page.locator('section.kind-note')).toHaveCount(0);
  await expect(page.locator('.link-line')).toHaveCount(6);

  await page.getByRole('button', { name: 'Accept all and see the map' }).click();
  await expect(page.locator('.surface[data-view="map"]')).toBeVisible();
  await page.waitForTimeout(1200);
  // Every arrow leaves the box at the height of one of the names.
  const names = await people.locator('li').evaluateAll((items) =>
    items.map((li) => {
      const box = li.getBoundingClientRect();
      return box.y + box.height / 2;
    }),
  );
  const starts = await page.locator('.link-line').evaluateAll((paths) =>
    paths.map((p) => {
      const start = (p as SVGPathElement).getPointAtLength(0);
      const matrix = (p as SVGPathElement).getScreenCTM() as DOMMatrix;
      return new DOMPoint(start.x, start.y).matrixTransform(matrix).y;
    }),
  );
  for (const y of starts) expect(names.some((name) => Math.abs(name - y) < 6)).toBe(true);
  // Everything the names point at stands in one column to the right.
  const lefts = await page.locator('section[data-bubble]').evaluateAll((sections) =>
    sections
      .filter((s) => !s.textContent?.includes('Boris'))
      .map((s) => Math.round(s.getBoundingClientRect().x)),
  );
  expect(new Set(lefts).size).toBe(1);
});
