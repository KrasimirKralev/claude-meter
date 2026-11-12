import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Each test starts from an empty browser database, on a new blank map. */
export const openBlank = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.clear();
    const dbs = await indexedDB.databases();
    await Promise.all(
      dbs.map(
        (db) =>
          new Promise((resolve) => {
            const request = indexedDB.deleteDatabase(db.name as string);
            request.onsuccess = request.onerror = request.onblocked = resolve;
          }),
      ),
    );
  });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Digitize' })).toBeVisible();
  await page.getByRole('button', { name: 'Your maps' }).click();
  await page.getByRole('button', { name: 'New map' }).click();
  await expect(page.getByText('Draw anything.')).toBeVisible();
};

export const openExample = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.clear();
    const dbs = await indexedDB.databases();
    await Promise.all(
      dbs.map(
        (db) =>
          new Promise((resolve) => {
            const request = indexedDB.deleteDatabase(db.name as string);
            request.onsuccess = request.onerror = request.onblocked = resolve;
          }),
      ),
    );
  });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Digitize' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
};

export const drawLine = async (
  page: Page,
  points: [number, number][],
): Promise<void> => {
  await page.mouse.move(points[0][0], points[0][1]);
  await page.mouse.down();
  for (const [x, y] of points.slice(1)) await page.mouse.move(x, y, { steps: 4 });
  await page.mouse.up();
};

export const drawBox = (page: Page, x: number, y: number, w: number, h: number): Promise<void> =>
  drawLine(page, [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
    [x, y + 3],
  ]);

export const typeAt = async (page: Page, x: number, y: number, text: string): Promise<void> => {
  await page.keyboard.press('t');
  await page.mouse.click(x, y);
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    await page.keyboard.type(lines[i]);
    if (i < lines.length - 1) await page.keyboard.press('Enter');
  }
  await page.keyboard.press('Escape');
  await page.keyboard.press('p');
};

/** Counts lit pixels on the ink layer, which proves real marks reached the canvas. */
export const inkPixels = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.ink-committed');
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return 0;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count += 1;
    return count;
  });
