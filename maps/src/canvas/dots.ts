// The dot grid. Each dot lands on a whole pixel with the true spacing kept, so dots stay equally
// crisp at any zoom, which a repeating CSS background cannot do at fractional sizes.

import type { CameraState } from './camera.ts';

const DOT_COLORS = { dark: '#3A3F4B', light: '#D1D5DB' };
/** Slightly over one pixel, because an edge-to-edge circle never reaches full colour at 1x. */
const RADIUS = 1.2;

export class DotGrid {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private sprite: HTMLCanvasElement = document.createElement('canvas');
  private dpr = 1;
  private theme: keyof typeof DOT_COLORS;

  constructor(canvas: HTMLCanvasElement, theme: keyof typeof DOT_COLORS) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true })!;
    this.theme = theme;
  }

  private buildSprite(): void {
    // An even size centres the dot on a pixel corner, so it covers four pixels evenly.
    const size = Math.ceil((RADIUS + 1) * this.dpr) * 2;
    this.sprite.width = size;
    this.sprite.height = size;
    const ctx = this.sprite.getContext('2d')!;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = DOT_COLORS[this.theme];
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, RADIUS * this.dpr, 0, Math.PI * 2);
    ctx.fill();
  }

  resize(width: number, height: number, dpr: number): void {
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.buildSprite();
  }

  setTheme(theme: keyof typeof DOT_COLORS): void {
    this.theme = theme;
    this.buildSprite();
  }

  draw(state: CameraState): void {
    const { canvas, ctx, sprite } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // The same spacing rule as the ripple: dots thin out far from 100%, so they never become noise.
    let step = 22 * state.z;
    while (step < 13) step *= 2;
    while (step > 66) step /= 2;
    const pixelStep = step * this.dpr;
    const half = sprite.width / 2;
    const startX = (((state.x * this.dpr) % pixelStep) + pixelStep) % pixelStep;
    const startY = (((state.y * this.dpr) % pixelStep) + pixelStep) % pixelStep;
    for (let y = startY; y < canvas.height + half; y += pixelStep) {
      const py = Math.round(y - half);
      for (let x = startX; x < canvas.width + half; x += pixelStep) {
        ctx.drawImage(sprite, Math.round(x - half), py);
      }
    }
  }
}
