// The maps menu: every saved map with a small picture, found by typing, opened from the keyboard.

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { drawBox, openBlank, typeAt } from './helpers.ts';

const rename = async (page: Page, title: string): Promise<void> => {
  await page.locator('button.map-title').click();
  await page.getByRole('textbox', { name: 'Map name' }).fill(title);
  await page.keyboard.press('Enter');
  await expect(page.locator('button.map-title')).toHaveText(title);
};

/**
 * Three maps of ours: a sketch, an empty one and a typed one, newest last. The example map that a
 * first start opens is the fourth, and the oldest.
 */
const makeMaps = async (page: Page): Promise<void> => {
  await openBlank(page);
  await drawBox(page, 400, 300, 200, 120);
  await rename(page, 'Spark cluster');
  for (const title of ['Семейна карта', 'Website plan']) {
    await page.getByRole('button', { name: 'Your maps' }).click();
    await page.getByRole('button', { name: 'New map' }).click();
    if (title === 'Website plan') await typeAt(page, 500, 400, 'Pages');
    await rename(page, title);
  }
};

test('M opens the menu on the search box, and every map has its line and picture', async ({ page }) => {
  await makeMaps(page);
  await page.keyboard.press('KeyM');
  const search = page.getByRole('searchbox', { name: 'Find a map' });
  await expect(search).toBeFocused();
  // The letter that opened the menu is not typed into the search.
  await expect(search).toHaveValue('');
  const rows = page.getByRole('menuitem');
  await expect(rows).toHaveCount(4);
  await expect(rows.first()).toContainText('Website plan');
  await expect(rows.first()).toContainText('open now');
  await expect(page.getByRole('menuitem', { name: /Spark cluster/ })).toContainText('Sketch');
  await expect(page.getByRole('menuitem', { name: /Семейна карта/ })).toContainText('Empty');
  await expect(page.locator('[data-menu-panel] svg.map-thumb')).toHaveCount(4);
  // The sketch shows as a drawing, not as a blank.
  await expect(
    page.getByRole('menuitem', { name: /Spark cluster/ }).locator('path.map-thumb-ink'),
  ).toHaveCount(1);
});

test('typing finds a map in any letter case, and Enter opens it', async ({ page }) => {
  await makeMaps(page);
  await page.keyboard.press('KeyM');
  await page.keyboard.type('СЕМЕЙНА');
  await expect(page.getByRole('menuitem')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-menu-panel]')).toHaveCount(0);
  await expect(page.locator('button.map-title')).toHaveText('Семейна карта');

  // The arrow keys walk the list, newest first.
  await page.keyboard.press('KeyM');
  await page.keyboard.type('p');
  await expect(page.getByRole('menuitem')).toHaveText([/Website plan/, /Spark cluster/]);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('button.map-title')).toHaveText('Spark cluster');
});

test('a search with no match says so, and Escape clears it before closing the menu', async ({ page }) => {
  await makeMaps(page);
  await page.keyboard.press('KeyM');
  await page.keyboard.type('zebra');
  await expect(page.locator('[data-menu-panel]')).toContainText('No map has “zebra” in its name.');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('searchbox', { name: 'Find a map' })).toHaveValue('');
  await expect(page.getByRole('menuitem')).toHaveCount(4);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-menu-panel]')).toHaveCount(0);
  // With the menu closed, letters are shortcuts again.
  await page.keyboard.press('KeyH');
  await expect(page.getByRole('button', { name: /^Hand/ })).toHaveAttribute('aria-pressed', 'true');
});

test('a map is deleted only after a second, explicit press', async ({ page }) => {
  await makeMaps(page);
  await page.getByRole('button', { name: 'Your maps' }).click();
  await page.getByRole('button', { name: 'Delete Spark cluster' }).click();
  await expect(page.getByRole('menuitem')).toHaveCount(4);
  await page.getByRole('button', { name: 'Delete for good' }).click();
  await expect(page.getByRole('menuitem')).toHaveCount(3);
  await expect(page.getByRole('menuitem', { name: /Spark cluster/ })).toHaveCount(0);
});

test('the menu fits a narrow window and the toolbars do not collide', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 560 });
  await makeMaps(page);
  await page.keyboard.press('KeyM');
  const panel = await page.locator('[data-menu-panel]').boundingBox();
  expect(panel && panel.x >= 0 && panel.x + panel.width <= 700 && panel.y + panel.height <= 560).toBe(true);
  await page.keyboard.press('Escape');
  const pills = await page.locator('header > div').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { l: r.left, r: r.right, t: r.top, b: r.bottom };
    }),
  );
  for (let i = 0; i < pills.length; i += 1) {
    for (let j = i + 1; j < pills.length; j += 1) {
      const a = pills[i];
      const b = pills[j];
      expect(a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b).toBe(false);
    }
  }
});
