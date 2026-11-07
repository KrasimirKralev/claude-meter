// Each test pins a defect found in code review, in the words of what a person would do.

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { drawBox, drawLine, inkPixels, openBlank, openExample } from './helpers.ts';

const digitize = (page: Page) => page.getByRole('button', { name: 'Digitize', exact: true });
const toMap = async (page: Page): Promise<void> => {
  await openExample(page);
  await digitize(page).click();
  await expect(page.getByText('Summary: Кратко описание на картата.')).toBeVisible();
  await page.getByRole('button', { name: 'Accept all and see the map' }).click();
  await page.waitForTimeout(700);
};

/** Sends pointer events the way a touch screen or a pen would. */
const fire = (page: Page, events: [string, number, number, number, string][]) =>
  page.evaluate((list) => {
    const root = document.querySelector('[data-testid=surface]') as HTMLElement;
    root.setPointerCapture = () => undefined;
    for (const [type, id, x, y, kind] of list) {
      root.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: id,
          pointerType: kind,
          clientX: x,
          clientY: y,
          button: 0,
          buttons: 1,
          pressure: 0.5,
        }),
      );
    }
  }, events);

test('a damaged backup is refused and the app keeps working after a reload', async ({ page }) => {
  await openBlank(page);
  for (const broken of [
    { bubbles: [{}] },
    { style: 'neon' },
    { proposals: [{}] },
    { strokes: [{ points: [] }] },
    { bubbles: [null] },
    { texts: [{ id: 't' }] },
  ]) {
    await page.getByTestId('import-json').setInputFiles({
      name: 'broken.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          version: 1,
          title: 'x',
          strokes: [],
          texts: [],
          bubbles: [],
          links: [],
          proposals: [],
          ...broken,
        }),
      ),
    });
    await expect(page.getByText('not a Balonche map')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Your maps' })).toBeVisible();
  }
  await page.reload();
  await expect(digitize(page)).toBeVisible();
});

test('a line can be edited again after pressing Enter on it', async ({ page }) => {
  await toMap(page);
  await page.locator('.bubble h2', { hasText: 'Групиране' }).click();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.locator('.bubble h2', { hasText: 'Групиране' }).click();
  await page.keyboard.type(' второ');
  await page.mouse.click(700, 860);
  await page.getByRole('button', { name: 'Both', exact: true }).click();
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(page.locator('.bubble h2', { hasText: 'Групиране второ' })).toBeVisible();
});

test('reloading on a finished map leaves it fully editable and adds no invisible ink', async ({ page }) => {
  await toMap(page);
  await page.reload();
  await expect(page.getByTestId('surface')).toHaveAttribute('data-view', 'map');
  await expect(page.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.bubble li').first().click();
  await expect(page.getByRole('textbox', { name: 'Bubble item' })).toBeVisible();
});

test('selecting typed text by dragging out of the box does not lose it', async ({ page }) => {
  await openBlank(page);
  await page.keyboard.press('t');
  await page.mouse.click(500, 300);
  await page.keyboard.type('Важен текст');
  const box = await page.getByRole('textbox', { name: 'Text on the canvas' }).boundingBox();
  if (!box) throw new Error('No editor');
  await page.mouse.move(box.x + 5, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(800, 600, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByRole('textbox', { name: 'Text on the canvas' })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-text]')).toHaveText('Важен текст');
});

test('a tap elsewhere while typing keeps the words', async ({ page }) => {
  await openBlank(page);
  await page.keyboard.press('t');
  await page.mouse.click(500, 300);
  await page.keyboard.type('Първи');
  await fire(page, [
    ['pointerdown', 4, 800, 500, 'touch'],
    ['pointerup', 4, 800, 500, 'touch'],
  ]);
  await expect(page.locator('[data-text]')).toHaveText('Първи');
});

test('an AI name nobody accepted cannot slip in through a click', async ({ page }) => {
  await openBlank(page);
  await drawBox(page, 300, 200, 300, 200);
  await drawLine(page, [[350, 260], [380, 300]]);
  await drawLine(page, [[400, 260], [430, 300]]);
  await drawLine(page, [[450, 260], [480, 300]]);
  await digitize(page).click();
  await expect(page.getByText('Name: (AI)')).toBeVisible();
  const title = page.locator('.bubble h2');
  await expect(title).toHaveAttribute('data-placeholder', '(AI)');
  await title.click({ force: true });
  await page.keyboard.press('v');
  await page.locator('.bubble').click({ position: { x: 20, y: 150 } });
  await page.locator('.bubble h2').click();
  await page.mouse.click(1000, 800);
  await expect(page.getByText('Name: (AI)')).toBeVisible();
  await expect(page.locator('.bubble h2')).toHaveText('');
});

test('N rejects the highlighted proposal, not a whole group', async ({ page }) => {
  await openExample(page);
  await digitize(page).click();
  await expect(page.getByText('Summary: Кратко описание на картата.')).toBeVisible();
  await expect(page.getByText(/is looking at your map/)).toHaveCount(0);
  await page.keyboard.press('n');
  await expect(page.locator('.bubble.status-pending')).toHaveCount(6);
  await expect(page.getByLabel('Proposals').locator('s')).toHaveCount(1);
  await expect(page.getByLabel('Proposals').locator('s')).toContainText('Summary');
});

test('undo during the AI stream gives Digitize back', async ({ page }) => {
  await openExample(page);
  await digitize(page).click();
  await expect(page.locator('.bubble.status-pending')).toHaveCount(6);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(700);
  await expect(page.getByText(/is looking at your map/)).toHaveCount(0);
  await expect(digitize(page)).toBeEnabled();
});

test('a palm landing during a pen stroke changes nothing', async ({ page }) => {
  await openBlank(page);
  await fire(page, [
    ['pointerdown', 1, 300, 300, 'pen'],
    ['pointermove', 1, 400, 300, 'pen'],
    ['pointerdown', 9, 900, 700, 'touch'],
    ['pointermove', 9, 910, 720, 'touch'],
    ['pointermove', 1, 500, 300, 'pen'],
    ['pointerup', 9, 910, 720, 'touch'],
    ['pointermove', 1, 600, 300, 'pen'],
    ['pointerup', 1, 600, 300, 'pen'],
  ]);
  await expect.poll(() => inkPixels(page)).toBeGreaterThan(200);
  const farCorner = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.ink-committed')!;
    const { data } = canvas.getContext('2d')!.getImageData(880, 680, 60, 60);
    return data.some((value, index) => index % 4 === 3 && value > 0);
  });
  expect(farCorner).toBe(false);
  await page.keyboard.press('Control+z');
  await expect.poll(() => inkPixels(page)).toBe(0);
});

test('a palm that lands first gives way to the pen', async ({ page }) => {
  await openBlank(page);
  await fire(page, [
    ['pointerdown', 9, 900, 700, 'touch'],
    ['pointermove', 9, 920, 720, 'touch'],
    ['pointerdown', 1, 300, 300, 'pen'],
    ['pointermove', 1, 500, 300, 'pen'],
    ['pointerup', 9, 920, 720, 'touch'],
    ['pointerup', 1, 500, 300, 'pen'],
  ]);
  await expect.poll(() => inkPixels(page)).toBeGreaterThan(100);
  const palmMark = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.ink-committed')!;
    const { data } = canvas.getContext('2d')!.getImageData(880, 680, 60, 60);
    return data.some((value, index) => index % 4 === 3 && value > 0);
  });
  expect(palmMark).toBe(false);
});

test('a touch just after the pen lifts is treated as a palm', async ({ page }) => {
  await openBlank(page);
  await fire(page, [
    ['pointerdown', 1, 300, 300, 'pen'],
    ['pointermove', 1, 500, 300, 'pen'],
    ['pointerup', 1, 500, 300, 'pen'],
    ['pointerdown', 9, 900, 700, 'touch'],
    ['pointermove', 9, 920, 720, 'touch'],
    ['pointerup', 9, 920, 720, 'touch'],
  ]);
  await page.keyboard.press('Control+z');
  await expect.poll(() => inkPixels(page)).toBe(0);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
});

test('a press released outside the window does not swallow the next stroke', async ({ page }) => {
  await openBlank(page);
  await page.keyboard.press('t');
  await page.mouse.move(600, 400);
  await page.mouse.down();
  await page.evaluate(() => {
    // The release happens where this page cannot see it, and the next press comes from the mouse.
    document.querySelector('[data-testid=surface]')!.dispatchEvent(
      new PointerEvent('pointercancel', { bubbles: true, pointerId: 999, pointerType: 'touch' }),
    );
  });
  await page.mouse.up();
  await page.keyboard.press('Escape');
  await page.keyboard.press('p');
  await drawLine(page, [[300, 300], [500, 300]]);
  await expect.poll(() => inkPixels(page)).toBeGreaterThan(100);
});

test('a half-typed map name survives closing the page', async ({ page }) => {
  await openBlank(page);
  await page.getByTitle('Rename this map').click();
  await page.getByRole('textbox', { name: 'Map name' }).fill('Ново име');
  await page.reload();
  await expect(digitize(page)).toBeVisible();
  await expect(page.getByTitle('Rename this map')).toHaveText('Ново име');
});

test('a third finger during a pinch draws nothing', async ({ page }) => {
  await openBlank(page);
  await fire(page, [
    ['pointerdown', 1, 300, 300, 'touch'],
    ['pointerdown', 2, 600, 300, 'touch'],
    ['pointerdown', 3, 450, 600, 'touch'],
    ['pointermove', 3, 460, 620, 'touch'],
    ['pointerup', 3, 460, 620, 'touch'],
    ['pointerup', 2, 600, 300, 'touch'],
    ['pointerup', 1, 300, 300, 'touch'],
  ]);
  await page.waitForTimeout(100);
  expect(await inkPixels(page)).toBe(0);
});

test('a second finger during an erase leaves undo working', async ({ page }) => {
  await openBlank(page);
  await drawLine(page, [[300, 300], [500, 300]]);
  await page.keyboard.press('e');
  await fire(page, [
    ['pointerdown', 1, 700, 700, 'touch'],
    ['pointerdown', 2, 800, 700, 'touch'],
    ['pointerup', 2, 800, 700, 'touch'],
    ['pointerup', 1, 700, 700, 'touch'],
  ]);
  await page.keyboard.press('p');
  const before = await inkPixels(page);
  await drawLine(page, [[300, 500], [500, 500]]);
  await expect.poll(() => inkPixels(page)).toBeGreaterThan(before);
  await page.keyboard.press('Control+z');
  await expect.poll(() => inkPixels(page)).toBe(before);
});

test('the plus button on a bubble adds a line', async ({ page }) => {
  await toMap(page);
  const first = page.locator('.bubble').first();
  await first.hover();
  await first.locator('.bubble-add').click();
  await expect(page.getByRole('textbox', { name: 'Bubble item' })).toBeFocused();
});

test('the text tool on a bubble edits it instead of stacking a new bubble', async ({ page }) => {
  await toMap(page);
  const count = await page.locator('.bubble').count();
  await page.keyboard.press('t');
  await page.locator('.bubble li').first().click();
  await expect(page.getByRole('textbox', { name: 'Bubble item' })).toBeVisible();
  await expect(page.locator('.bubble')).toHaveCount(count);
});

test('Enter on an empty line finishes the list', async ({ page }) => {
  await toMap(page);
  const items = await page.locator('.bubble').first().locator('li').count();
  await page.locator('.bubble').first().locator('li').last().click();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.locator('.bubble').first().locator('li')).toHaveCount(items);
});

test('pressing D twice quickly does not duplicate the map', async ({ page }) => {
  await openExample(page);
  await page.evaluate(() => {
    for (let i = 0; i < 2; i += 1) {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', bubbles: true }));
    }
  });
  await expect(page.locator('.bubble.status-pending')).toHaveCount(6);
  await page.waitForTimeout(300);
  await expect(page.locator('.bubble.status-pending')).toHaveCount(6);
});

test('Enter and Space work on a focused button', async ({ page }) => {
  await openExample(page);
  await page.getByRole('button', { name: 'Both', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('surface')).toHaveAttribute('data-view', 'both');
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await page.getByRole('button', { name: 'Sketch', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('surface')).toHaveAttribute('data-view', 'sketch');
});

test('after clicking a button with the mouse, Enter still types on the canvas', async ({ page }) => {
  await openExample(page);
  await page.getByRole('button', { name: 'Both', exact: true }).click();
  await page.getByRole('button', { name: 'Sketch', exact: true }).click();
  await page.mouse.move(700, 700);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Text on the canvas' })).toBeVisible();
});

test('Escape during a selection drag puts things back with no extra undo step', async ({ page }) => {
  await openBlank(page);
  await drawLine(page, [[300, 300], [500, 300]]);
  await page.keyboard.press('v');
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(600, 500, { steps: 3 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  // The redraw lands on the next frame, so this waits for it instead of checking at once.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const canvas = document.querySelector<HTMLCanvasElement>('.ink-committed')!;
        const { data } = canvas.getContext('2d')!.getImageData(380, 295, 40, 10);
        return data.some((value, index) => index % 4 === 3 && value > 0);
      }),
    )
    .toBe(true);
  await page.keyboard.press('Control+z');
  await expect.poll(() => inkPixels(page)).toBe(0);
});

test('Digitize these sends only the selected part to the AI', async ({ page }) => {
  let sent: { bubbles: { title: string }[]; looseText: string[] } | null = null;
  await page.route('/api/digitize', async (route) => {
    sent = route.request().postDataJSON();
    await route.continue();
  });
  await openBlank(page);
  await drawBox(page, 200, 200, 200, 150);
  await page.keyboard.press('t');
  await page.mouse.click(240, 240);
  await page.keyboard.type('Споделено');
  await page.keyboard.press('Escape');
  await page.mouse.click(800, 240);
  await page.keyboard.type('Тайна бележка');
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  // Drag a selection box around the first shape only.
  await page.mouse.move(170, 170);
  await page.mouse.down();
  await page.mouse.move(430, 380, { steps: 4 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Digitize these' }).click();
  await expect.poll(() => sent).not.toBeNull();
  const body = JSON.stringify(sent);
  expect(body).toContain('Споделено');
  expect(body).not.toContain('Тайна');
});

test('Try again still sends the picture of a handwritten sketch', async ({ page }) => {
  const images: boolean[] = [];
  let attempts = 0;
  await page.route('/api/digitize', async (route) => {
    images.push(Boolean(route.request().postDataJSON().image));
    attempts += 1;
    if (attempts === 1) await route.abort();
    else await route.continue();
  });
  await openBlank(page);
  await drawBox(page, 300, 200, 300, 200);
  await drawLine(page, [[350, 260], [380, 300]]);
  await drawLine(page, [[400, 260], [430, 300]]);
  await drawLine(page, [[450, 260], [480, 300]]);
  await digitize(page).click();
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect.poll(() => images.length).toBe(2);
  expect(images).toEqual([true, true]);
});

test('the eraser cannot delete words hidden behind a proposal', async ({ page }) => {
  await openBlank(page);
  await drawBox(page, 300, 200, 400, 300);
  await page.keyboard.press('t');
  await page.mouse.click(350, 260);
  await page.keyboard.type('Запази ме');
  await page.keyboard.press('Escape');
  await digitize(page).click();
  await expect(page.locator('.bubble.status-pending')).toHaveCount(1);
  const box = await page.locator('.bubble').boundingBox();
  if (!box) throw new Error('No bubble');
  await page.keyboard.press('e');
  await page.mouse.move(box.x + 60, box.y + 70);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 75, { steps: 8 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Sketch', exact: true }).click();
  await expect(page.locator('[data-text]')).toHaveText('Запази ме');
});

test('words still being typed survive closing the page', async ({ page }) => {
  await openBlank(page);
  await page.keyboard.press('t');
  await page.mouse.click(500, 300);
  await page.keyboard.type('Недовършено');
  await page.reload();
  await expect(digitize(page)).toBeVisible();
  await expect(page.locator('[data-text]')).toHaveText('Недовършено');
});

test('two tabs on the same map are warned, and neither loses its work', async ({ page, context }) => {
  await openBlank(page);
  await drawLine(page, [[300, 300], [500, 300]]);
  await page.waitForTimeout(800);
  const second = await context.newPage();
  await second.goto('/');
  await expect(second.getByRole('button', { name: 'Digitize', exact: true })).toBeVisible();

  // Both tabs now hold the same map. The first draws and saves.
  await page.bringToFront();
  await drawLine(page, [[300, 450], [500, 450]]);
  await page.waitForTimeout(800);
  // The second never saw that stroke. Its save must not wipe it out.
  await second.bringToFront();
  await drawLine(second, [[300, 600], [500, 600]]);
  await expect(second.getByText(/kept as/)).toBeVisible();
  await expect(second.getByTitle('Rename this map')).toContainText('(other tab)');
  await second.close();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Digitize', exact: true })).toBeVisible();
  // The first tab's stroke is still in its saved map.
  const row = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.ink-committed')!;
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count += 1;
    return count;
  });
  expect(row).toBeGreaterThan(300);
  await page.getByRole('button', { name: 'Your maps' }).click();
  await expect(page.getByRole('menuitem', { name: /\(other tab\)/ })).toHaveCount(1);
  await expect(page.getByRole('menuitem', { name: /^Untitled map(?! \()/ })).toHaveCount(1);
});

test('a control character in the text does not break the SVG file', async ({ page }) => {
  await openBlank(page);
  await drawBox(page, 300, 200, 300, 200);
  await page.keyboard.press('t');
  await page.mouse.click(350, 260);
  await page.evaluate(() => document.execCommand('insertText', false, 'Заглавие\u0008 с & <знак>'));
  await page.keyboard.press('Escape');
  await digitize(page).click();
  await page.getByRole('button', { name: 'Accept all and see the map' }).click();
  await page.getByRole('button', { name: 'Export' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'SVG image' }).click();
  const { readFileSync } = await import('node:fs');
  const svg = readFileSync(await (await download).path(), 'utf8');
  const parsed = await page.evaluate(
    (text) =>
      new DOMParser().parseFromString(text, 'image/svg+xml').querySelector('parsererror') === null,
    svg,
  );
  expect(parsed).toBe(true);
  expect(svg).toContain('&amp;');
});

test('a long title wraps and the bubbles leave room for it', async ({ page }) => {
  await toMap(page);
  await page.getByTitle('Rename this map').click();
  await page.getByRole('textbox', { name: 'Map name' }).fill(
    'Много дълго заглавие на картата, което със сигурност не се побира на един ред над балончетата',
  );
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  const header = await page.locator('.map-header').boundingBox();
  const lines = await page.locator('.map-header h1').evaluate((el) => el.getClientRects()[0].height);
  const bubbles = await page.locator('.bubble').evaluateAll((all) =>
    all.map((el) => el.getBoundingClientRect().top),
  );
  if (!header) throw new Error('No header');
  expect(lines).toBeGreaterThan(50);
  expect(Math.min(...bubbles) - (header.y + header.height)).toBeGreaterThan(20);
});

test('a map nobody has named shows no headline', async ({ page }) => {
  await openBlank(page);
  await drawBox(page, 300, 200, 300, 200);
  await page.keyboard.press('t');
  await page.mouse.click(340, 240);
  await page.keyboard.type('Само това');
  await page.keyboard.press('Escape');
  await digitize(page).click();
  await page.getByRole('button', { name: 'Accept all and see the map' }).click();
  await expect(page.locator('.bubble h2')).toHaveText('Само това');
  await expect(page.locator('.map-header h1')).toHaveCount(0);
});

test('typed words are never blank while Digitize brings up the cards', async ({ page }) => {
  await openExample(page);
  await digitize(page).click();
  await page.waitForTimeout(16);
  const lowest = await page.locator('.bubble').evaluateAll((all) =>
    Math.min(...all.map((el) => Number(getComputedStyle(el).opacity))),
  );
  expect(lowest).toBeGreaterThanOrEqual(0.45);
});
