// Getting around a big map: the hand, the wheel while it is picked, and the arrow keys.

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { drawBox, inkPixels, openExample } from './helpers.ts';

const offset = (page: Page): Promise<{ x: number; y: number; z: number }> =>
  page.locator('.world').evaluate((world) => {
    const match = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(
      (world as HTMLElement).style.transform,
    );
    return { x: Number(match?.[1]), y: Number(match?.[2]), z: Number(match?.[3]) };
  });

test('the hand drags the view, even from on top of a bubble, and draws nothing', async ({ page }) => {
  await openExample(page);
  await page.getByRole('button', { name: 'Digitize' }).click();
  await page.getByRole('button', { name: 'Accept all and see the map' }).click();
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /^Hand/ }).click();
  const bubble = page.locator('section[data-bubble]').first();
  const before = await bubble.boundingBox();
  const start = await offset(page);
  const x = (before?.x ?? 0) + 40;
  const y = (before?.y ?? 0) + 40;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 150, y - 90, { steps: 6 });
  await page.mouse.up();
  const end = await offset(page);
  expect(Math.round(end.x - start.x)).toBe(-150);
  expect(Math.round(end.y - start.y)).toBe(-90);
  // The bubble rode along with the view instead of being dragged out of its place.
  const moved = await page.evaluate(
    () => (document.querySelector('section[data-bubble]') as HTMLElement).style.transform,
  );
  await page.reload();
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(page.locator('section[data-bubble]').first()).toHaveAttribute(
    'style',
    new RegExp(moved.replace(/[()]/g, '\\$&')),
  );
});

test('with the hand, the wheel scrolls; arrow keys move the view in any tool', async ({ page }) => {
  await openExample(page);
  await page.keyboard.press('KeyH');
  const start = await offset(page);
  await page.mouse.move(700, 450);
  await page.mouse.wheel(0, 120);
  await expect.poll(async () => (await offset(page)).y).toBeLessThan(start.y - 60);
  expect((await offset(page)).z).toBe(start.z);

  await page.keyboard.press('KeyP');
  const before = await offset(page);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  const after = await offset(page);
  expect(Math.round(after.x - before.x)).toBe(-120);
  expect(Math.round(after.y - before.y)).toBe(-120);
});

test('dragging with the hand over the sketch leaves no ink', async ({ page }) => {
  await openExample(page);
  await page.getByRole('button', { name: 'Sketch' }).click();
  await drawBox(page, 300, 300, 120, 80);
  const ink = await inkPixels(page);
  await page.keyboard.press('KeyH');
  await page.mouse.move(500, 500);
  await page.mouse.down();
  await page.mouse.move(420, 440, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  // Moving the view back the same way shows the same ink, and nothing was added.
  await page.mouse.move(420, 440);
  await page.mouse.down();
  await page.mouse.move(500, 500, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  // The canvas repaints on the next frame, which a busy machine can delay.
  await expect.poll(() => inkPixels(page)).toBe(ink);
});
