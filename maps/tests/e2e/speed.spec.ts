// Measures the local speed targets from the spec. A missed budget fails the run.

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openBlank, openExample } from './helpers.ts';

const FRAME = 1000 / 60;

/** A full map: strokes of 40 points each, all on screen at once, which is the worst case. */
const bigMapJson = (count: number): string => {
  const strokes = [];
  for (let i = 0; i < count; i += 1) {
    const baseX = 100 + (i % 80) * 15;
    const baseY = 100 + Math.floor(i / 80) * 12;
    const points: number[] = [];
    for (let p = 0; p < 40; p += 1) points.push(baseX + p * 0.3, baseY + Math.sin(p / 3) * 4, 0.5);
    strokes.push({
      id: `s${i}`,
      points,
      color: 'ink',
      width: 2.4,
      box: { x: baseX, y: baseY - 4, w: 12, h: 8 },
    });
  }
  return JSON.stringify({
    version: 1,
    id: 'big',
    title: 'Big',
    summary: '',
    strokes,
    texts: [],
    bubbles: [],
    links: [],
    proposals: [],
    style: 'candy',
    bulgarianLetters: false,
    run: 0,
    createdAt: 0,
    updatedAt: 0,
  });
};

const percentile = (values: number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
};

const openBigMap = async (page: Page, count: number): Promise<void> => {
  await openBlank(page);
  await page.getByTestId('import-json').setInputFiles({
    name: 'big.json',
    mimeType: 'application/json',
    buffer: Buffer.from(bigMapJson(count)),
  });
  await expect(page.getByText('Opened big.json.')).toBeVisible();
  await page.getByRole('button', { name: 'Reset to 100%' }).or(page.getByTitle('Reset to 100%')).click();
  await page.waitForTimeout(500);
};

test('drawing stays smooth with 5,000 strokes on the canvas', async ({ page }) => {
  await openBigMap(page, 5000);
  const result = await page.evaluate(async () => {
    const root = document.querySelector('[data-testid=surface]') as HTMLElement;
    root.setPointerCapture = () => undefined;
    const fire = (type: string, x: number, y: number) =>
      root.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: 9,
          pointerType: 'mouse',
          clientX: x,
          clientY: y,
          button: 0,
          buttons: 1,
          pressure: 0.5,
        }),
      );
    fire('pointerdown', 200, 700);
    const handler: number[] = [];
    const frames: number[] = [];
    let last = performance.now();
    await new Promise<void>((resolve) => {
      let i = 0;
      const step = (now: number) => {
        frames.push(now - last);
        last = now;
        const started = performance.now();
        fire('pointermove', 200 + i * 6, 700 + Math.sin(i / 8) * 60);
        handler.push(performance.now() - started);
        i += 1;
        if (i < 150) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    const commitStart = performance.now();
    fire('pointerup', 1100, 700);
    const commit = performance.now() - commitStart;
    return { handler, frames: frames.slice(5), commit };
  });
  const handlerP95 = percentile(result.handler, 0.95);
  const frameP95 = percentile(result.frames, 0.95);
  console.log(
    `draw: handler p95 ${handlerP95.toFixed(2)} ms, frame p95 ${frameP95.toFixed(1)} ms, finishing a stroke ${result.commit.toFixed(2)} ms`,
  );
  expect(handlerP95).toBeLessThan(FRAME / 2);
  expect(frameP95).toBeLessThan(FRAME * 1.5);
});

test('panning stays smooth with 5,000 strokes on screen', async ({ page }) => {
  await openBigMap(page, 5000);
  const frames = await page.evaluate(async () => {
    const root = document.querySelector('[data-testid=surface]') as HTMLElement;
    const samples: number[] = [];
    let last = performance.now();
    await new Promise<void>((resolve) => {
      let i = 0;
      const step = (now: number) => {
        samples.push(now - last);
        last = now;
        root.dispatchEvent(
          new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: 3, deltaY: 2 }),
        );
        i += 1;
        if (i < 120) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    return samples.slice(5);
  });
  const p95 = percentile(frames, 0.95);
  console.log(`pan: frame p50 ${percentile(frames, 0.5).toFixed(1)} ms, p95 ${p95.toFixed(1)} ms`);
  expect(p95).toBeLessThan(FRAME * 2);
});

test('Digitize shows local structure in under 100 ms', async ({ page }) => {
  await openExample(page);
  await page.getByRole('button', { name: 'Digitize', exact: true }).click();
  const footer = page.getByLabel('Proposals').getByText(/^Local /);
  await expect(footer).toBeVisible();
  const text = (await footer.textContent()) ?? '';
  const ms = Number(/Local (\d+) ms/.exec(text)?.[1] ?? 'NaN');
  console.log(`digitize local pass, example map: ${ms} ms`);
  expect(ms).toBeLessThan(100);
});

test('Digitize stays under 100 ms with 500 strokes to read', async ({ page }) => {
  await openBlank(page);
  // Fifty typed boxes and 450 marks: a very full real sketch.
  const strokes = [];
  const texts = [];
  for (let i = 0; i < 500; i += 1) {
    const x = (i % 25) * 90;
    const y = Math.floor(i / 25) * 90;
    const isBox = i % 10 === 0;
    const shape = isBox
      ? [x, y, x + 70, y, x + 70, y + 60, x, y + 60, x, y + 2]
      : [x + 10, y + 10, x + 30, y + 14, x + 44, y + 11];
    const points = shape.flatMap((value, index) =>
      index % 2 === 1 ? [value, 0.5] : [value],
    );
    strokes.push({
      id: `s${i}`,
      points,
      color: 'ink',
      width: 2.4,
      box: { x, y, w: 70, h: 60 },
    });
    if (isBox) texts.push({ id: `t${i}`, x: x + 12, y: y + 12, text: `Група ${i}`, w: 50, h: 20 });
  }
  await page.getByTestId('import-json').setInputFiles({
    name: 'sketch.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        version: 1,
        id: 'sketch',
        title: 'Sketch',
        summary: '',
        strokes,
        texts,
        bubbles: [],
        links: [],
        proposals: [],
        style: 'candy',
        bulgarianLetters: false,
        run: 0,
        createdAt: 0,
        updatedAt: 0,
      }),
    ),
  });
  await expect(page.getByText('Opened sketch.json.')).toBeVisible();
  await page.getByRole('button', { name: 'Digitize', exact: true }).click();
  const footer = page.getByLabel('Proposals').getByText(/^Local /);
  await expect(footer).toBeVisible();
  const ms = Number(/Local (\d+) ms/.exec((await footer.textContent()) ?? '')?.[1] ?? 'NaN');
  console.log(`digitize local pass, 500 strokes: ${ms} ms`);
  expect(ms).toBeLessThan(100);
  await expect(page.locator('.bubble.status-pending')).toHaveCount(50);
});

test('the theme switch lands within a frame or two on a normal map', async ({ page }) => {
  await openExample(page);
  const ms = await page.evaluate(async () => {
    const button = document.querySelector<HTMLButtonElement>('[aria-label="Switch to light theme"]')!;
    const started = performance.now();
    button.click();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return performance.now() - started;
  });
  console.log(`theme switch to painted: ${ms.toFixed(1)} ms`);
  expect(ms).toBeLessThan(FRAME * 3);
});

test('the app opens and is ready to draw in under a second', async ({ page }) => {
  await openExample(page);
  const started = Date.now();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Digitize', exact: true })).toBeVisible();
  const ms = Date.now() - started;
  console.log(`open to ready: ${ms} ms`);
  expect(ms).toBeLessThan(1000);
});
