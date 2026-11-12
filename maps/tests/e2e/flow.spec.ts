import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { drawBox, drawLine, inkPixels, openBlank, openExample, typeAt } from './helpers.ts';

const surface = (page: import('@playwright/test').Page) => page.getByTestId('surface');
const bubble = (page: import('@playwright/test').Page) => page.locator('[data-bubble]:visible');

test('first run shows the example and the whole flow reaches a finished map', async ({ page }) => {
  await openExample(page);
  await expect(page.getByText('This is an example sketch.')).toBeVisible();
  await expect(page.locator('[data-text]')).toHaveCount(6);

  await page.getByRole('button', { name: 'Digitize', exact: true }).click();
  await expect(surface(page)).toHaveAttribute('data-view', 'both');
  await expect(page.locator('.bubble.status-pending')).toHaveCount(6);
  await expect(page.getByText('Rename: Улавяне → Улавяне (AI)')).toBeVisible();
  await expect(page.getByText('Summary: Кратко описание на картата.')).toBeVisible();
  await expect(page.getByLabel('Proposals').getByText(/first AI idea/)).toBeVisible();

  await page.getByRole('button', { name: 'Accept all and see the map' }).click();
  await expect(surface(page)).toHaveAttribute('data-view', 'map');
  await expect(bubble(page)).toHaveCount(6);
  await expect(page.locator('.map-header h1')).toHaveText('Бяла дъска — план');
  await expect(page.locator('.map-header p')).toHaveText('Кратко описание на картата.');
  await expect(page.getByRole('heading', { name: 'Улавяне (AI)' })).toBeVisible();

  // The drawn lines are gone from the finished map.
  await expect(page.locator('.ink-committed')).toHaveCSS('opacity', '0');
  await expect(page.locator('.map-candy')).toHaveCount(1);
  await expect(page.locator('.link-line')).toHaveCount(4);
});

test('nothing goes on the map until it is accepted, and a rejection can be undone', async ({ page }) => {
  await openExample(page);
  await page.getByRole('button', { name: 'Digitize', exact: true }).click();
  await expect(page.getByText('Rename: Улавяне → Улавяне (AI)')).toBeVisible();
  await page.getByRole('button', { name: 'Reject' }).click();
  await expect(page.locator('s').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Улавяне', exact: true })).toBeVisible();
  await page.getByLabel('Proposals').getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('s')).toHaveCount(0);

  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(bubble(page)).toHaveCount(0);
});

test('drawing with the mouse makes real marks, undo removes them and redo restores them', async ({ page }) => {
  await openBlank(page);
  await expect.poll(() => inkPixels(page)).toBe(0);
  await drawLine(page, [
    [400, 300],
    [600, 320],
    [700, 500],
  ]);
  await expect.poll(() => inkPixels(page)).toBeGreaterThan(200);

  await page.keyboard.press('Control+z');
  await expect.poll(() => inkPixels(page)).toBe(0);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(() => inkPixels(page)).toBeGreaterThan(200);
});

test('a box with typed words becomes a bubble, and shortcuts work on the Bulgarian layout', async ({ page }) => {
  await openBlank(page);
  await drawBox(page, 300, 200, 300, 200);
  await typeAt(page, 340, 240, 'Идеи\nПърво\nВторо');
  await expect(page.locator('[data-text]')).toHaveText('Идеи\nПърво\nВторо');

  // KeyD is "д" on a Bulgarian keyboard. The shortcut follows the physical key.
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', key: 'д', bubbles: true }));
  });
  await expect(page.getByRole('heading', { name: 'Идеи' })).toBeVisible();
  await expect(page.locator('.bubble li')).toHaveText(['Първо', 'Второ']);
});

test('a box drawn in pink becomes a pink bubble', async ({ page }) => {
  await openBlank(page);
  await page.getByRole('button', { name: 'Pink' }).click();
  await drawBox(page, 300, 200, 300, 200);
  await typeAt(page, 340, 240, 'Розово');
  await page.getByRole('button', { name: 'Digitize', exact: true }).click();
  await page.getByRole('button', { name: 'Accept all and see the map' }).click();
  await expect(page.locator('.bubble.slot-1')).toBeVisible();
  await expect(page.locator('.bubble.slot-1')).toHaveCSS('background-color', 'rgb(255, 140, 198)');
});

test('Digitize on an empty canvas explains itself and creates nothing', async ({ page }) => {
  await openBlank(page);
  await page.getByRole('button', { name: 'Digitize', exact: true }).click();
  await expect(page.getByText('Nothing to digitize yet.')).toBeVisible();
  await expect(page.locator('[data-bubble]')).toHaveCount(0);
});

test('Ctrl+Z while typing edits the text and leaves the document alone', async ({ page }) => {
  await openBlank(page);
  await drawLine(page, [
    [300, 300],
    [500, 300],
  ]);
  await page.keyboard.press('t');
  await page.mouse.click(600, 400);
  await page.keyboard.type('abc');
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('textbox', { name: 'Text on the canvas' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect.poll(() => inkPixels(page)).toBeGreaterThan(100);
});

test('very long text and long unbroken words stay inside the bubble', async ({ page }) => {
  await openBlank(page);
  await drawBox(page, 300, 150, 400, 300);
  const long = 'щ'.repeat(240);
  await typeAt(page, 340, 200, `Заглавие\n${long}\n${'дума '.repeat(60).trim()}`);
  await page.getByRole('button', { name: 'Digitize', exact: true }).click();
  await page.getByRole('button', { name: 'Accept all and see the map' }).click();
  await expect(surface(page)).toHaveAttribute('data-view', 'map');
  const overflow = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.bubble, .bubble li, .bubble h2')]
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.textContent?.slice(0, 20)),
  );
  expect(overflow).toEqual([]);
});

test('the map survives a reload, including pending proposals, with no stuck state', async ({ page }) => {
  await openExample(page);
  await page.getByRole('button', { name: 'Digitize', exact: true }).click();
  await expect(page.locator('.bubble.status-pending')).toHaveCount(6);
  // Reloading during the stream must lose nothing and must not leave the panel waiting forever.
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Digitize', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Both', exact: true }).click();
  await expect(page.locator('.bubble.status-pending')).toHaveCount(6);
  await expect(page.getByText('is looking at your map')).toHaveCount(0);
  await page.getByRole('button', { name: 'Sketch', exact: true }).click();
  await expect.poll(() => inkPixels(page)).toBeGreaterThan(1000);
});

test('undo after Digitize removes the proposals and later AI lines do not bring them back', async ({ page }) => {
  await openExample(page);
  await page.getByRole('button', { name: 'Digitize', exact: true }).click();
  await expect(page.locator('.bubble.status-pending')).toHaveCount(6);
  await page.keyboard.press('Control+z');
  await expect(page.locator('[data-bubble]')).toHaveCount(0);
  await page.waitForTimeout(600);
  await expect(page.locator('[data-bubble]')).toHaveCount(0);
  await expect(page.getByLabel('Proposals').getByRole('listitem')).toHaveCount(0);
});

test('lasso groups by hand with no AI', async ({ page }) => {
  await openBlank(page);
  await typeAt(page, 500, 400, 'Ръчна група\nред едно');
  await page.keyboard.press('l');
  await drawLine(page, [
    [440, 360],
    [760, 360],
    [760, 480],
    [440, 480],
    [440, 365],
  ]);
  await expect(page.getByText('1 selected')).toBeVisible();
  await page.getByRole('button', { name: 'Make a group' }).click();
  await expect(page.getByRole('heading', { name: 'Ръчна група' })).toBeVisible();
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(bubble(page)).toHaveCount(1);
});

test('editing on the map: click to edit, Enter adds a line, undo reverts', async ({ page }) => {
  await openExample(page);
  await page.getByRole('button', { name: 'Digitize', exact: true }).click();
  await page.getByRole('button', { name: 'Accept all and see the map' }).click();
  await expect(surface(page)).toHaveAttribute('data-view', 'map');
  await page.waitForTimeout(700);
  await page.locator('.bubble li', { hasText: 'Местя блокове с влачене' }).click();
  await page.keyboard.press('Enter');
  await page.keyboard.type('Нов ред');
  await page.keyboard.press('Escape');
  await expect(page.locator('.bubble li', { hasText: 'Нов ред' })).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.bubble li', { hasText: 'Нов ред' })).toHaveCount(0);
});

test('the theme switch is instant, keeps the dots, and survives a reload', async ({ page }) => {
  await openExample(page);
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'dark');
  const dotPixels = () =>
    page.getByTestId('dots').evaluate((el) => {
      const canvas = el as HTMLCanvasElement;
      const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
      let count = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 40) count += 1;
      return count;
    });
  expect(await dotPixels()).toBeGreaterThan(2000);
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(surface(page)).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  expect(await dotPixels()).toBeGreaterThan(2000);
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'light');
});

test('export: plan, images and JSON, and a damaged file changes nothing', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openExample(page);
  await page.getByRole('button', { name: 'Digitize', exact: true }).click();
  await expect(page.getByText('Rename: Улавяне → Улавяне (AI)')).toBeVisible();
  await page.getByRole('button', { name: 'Accept all and see the map' }).click();

  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name: 'Copy plan for Claude Code' }).click();
  await expect(page.getByText('Plan copied.')).toBeVisible();
  const plan = await page.evaluate(() => navigator.clipboard.readText());
  expect(plan).toContain('## Улавяне (AI)');
  expect(plan).toContain('- [ ] Рисувам свободно с мишката');
  expect(plan.indexOf('Улавяне (AI)')).toBeLessThan(plan.indexOf('Групиране'));

  for (const [name, check] of [
    ['PNG image', (bytes: Buffer) => bytes.subarray(1, 4).toString() === 'PNG'],
    ['SVG image', (bytes: Buffer) => bytes.toString().includes('@font-face') && !bytes.toString().includes('stroke-width="2.4"')],
  ] as const) {
    await page.getByRole('button', { name: 'Export' }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name }).click();
    const file = await (await download).path();
    expect(check(readFileSync(file))).toBe(true);
  }

  await page.getByRole('button', { name: 'Export' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'JSON backup', exact: true }).click();
  const backup = readFileSync(await (await download).path(), 'utf8');
  expect(JSON.parse(backup).bubbles).toHaveLength(6);

  await page.getByTestId('import-json').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"hello":"world"}'),
  });
  await expect(page.getByText('not a Balonche map')).toBeVisible();
  await expect(bubble(page)).toHaveCount(6);

  await page.getByTestId('import-json').setInputFiles({
    name: 'good.json',
    mimeType: 'application/json',
    buffer: Buffer.from(backup),
  });
  await expect(page.getByText('Opened good.json.')).toBeVisible();
  await expect(bubble(page)).toHaveCount(6);
});

test('present walks the bubbles along the arrows and Esc leaves', async ({ page }) => {
  await openExample(page);
  await page.getByRole('button', { name: 'Digitize', exact: true }).click();
  await page.getByRole('button', { name: 'Accept all and see the map' }).click();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: 'Present' }).click();
  await expect(page.getByRole('button', { name: 'Export' })).toHaveCount(0);
  await expect(page.locator('.surface.presenting')).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.bubble.spotlight')).toHaveCount(1);
  // The camera lands on the same bubble the spotlight is on.
  await page.waitForTimeout(500);
  const spot = await page.locator('.bubble.spotlight').boundingBox();
  const viewport = page.viewportSize();
  if (!spot || !viewport) throw new Error('No spotlight box');
  expect(spot.x).toBeGreaterThanOrEqual(0);
  expect(spot.y).toBeGreaterThanOrEqual(0);
  expect(spot.x + spot.width).toBeLessThanOrEqual(viewport.width);
  expect(spot.y + spot.height).toBeLessThanOrEqual(viewport.height);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Export' })).toBeVisible();
});

test('touch input draws like the mouse, and a second finger cancels the mark', async ({ page }) => {
  await openBlank(page);
  await page.evaluate(() => {
    const root = document.querySelector('[data-testid=surface]') as HTMLElement;
    root.setPointerCapture = () => undefined;
    const fire = (type: string, id: number, x: number, y: number, kind = 'touch') =>
      root.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: id,
          pointerType: kind,
          clientX: x,
          clientY: y,
          button: 0,
          buttons: 1,
          pressure: 0.6,
        }),
      );
    // A pen stroke with varying pressure, as a digital board would send.
    fire('pointerdown', 7, 300, 300, 'pen');
    fire('pointermove', 7, 500, 300, 'pen');
    fire('pointerup', 7, 500, 300, 'pen');
    // One finger starts a mark, then a second finger turns it into a pinch.
    fire('pointerdown', 1, 300, 500);
    fire('pointermove', 1, 320, 500);
    fire('pointerdown', 2, 600, 500);
    fire('pointermove', 2, 700, 500);
    fire('pointerup', 1, 320, 500);
    fire('pointerup', 2, 700, 500);
  });
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
});

test('on the map: draw an arrow between bubbles, select it, delete it', async ({ page }) => {
  await openExample(page);
  await page.getByRole('button', { name: 'Digitize', exact: true }).click();
  await page.getByRole('button', { name: 'Accept all and see the map' }).click();
  await page.waitForTimeout(800);
  await expect(page.locator('.link-line')).toHaveCount(4);

  const box = async (name: string) => {
    const found = await page.getByRole('heading', { name, exact: true }).boundingBox();
    if (!found) throw new Error(`No bubble named ${name}`);
    return found;
  };
  await page.keyboard.press('a');
  const from = await box('Групиране');
  const to = await box('Готова карта');
  await page.mouse.move(from.x + 40, from.y + 10);
  await page.mouse.down();
  await page.mouse.move(to.x + 40, to.y + 10, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.link-line')).toHaveCount(5);

  await page.keyboard.press('v');
  await page.waitForTimeout(250);
  const added = page.locator('.link-hit').last();
  const lineBox = await added.boundingBox();
  if (!lineBox) throw new Error('The new arrow has no box');
  await added.dispatchEvent('pointerdown', {
    bubbles: true,
    button: 0,
    pointerId: 1,
    clientX: lineBox.x,
    clientY: lineBox.y,
  });
  await page.keyboard.press('Delete');
  await expect(page.locator('.link-line')).toHaveCount(4);
});

test('bubbles can be reached with the keyboard on the finished map', async ({ page }) => {
  await openExample(page);
  await page.getByRole('button', { name: 'Digitize', exact: true }).click();
  await page.getByRole('button', { name: 'Accept all and see the map' }).click();
  await page.waitForTimeout(700);
  const first = page.locator('[data-bubble]').first();
  await first.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Bubble title' })).toBeFocused();
  await page.keyboard.press('Escape');
});

test('Digitize tells the user when no AI is connected, and keeps the local result', async ({ page }) => {
  await page.route('/api/digitize', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson',
      body: `${JSON.stringify({ type: 'error', code: 'no-provider', message: 'No AI is connected, so only the local pass ran.' })}\n`,
    }),
  );
  await openExample(page);
  await page.getByRole('button', { name: 'Digitize', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('No AI is connected');
  await expect(page.locator('.bubble.status-pending')).toHaveCount(6);
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
});

test('a failed AI request says so and Try again recovers', async ({ page }) => {
  let fail = true;
  await page.route('/api/digitize', async (route) => {
    if (fail) {
      fail = false;
      await route.abort();
    } else {
      await route.continue();
    }
  });
  await openExample(page);
  await page.getByRole('button', { name: 'Digitize', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not reach the AI');
  await expect(page.locator('.bubble.status-pending')).toHaveCount(6);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('Summary: Кратко описание на картата.')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
