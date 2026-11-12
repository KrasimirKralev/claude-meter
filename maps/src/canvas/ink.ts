// Two canvas layers: everything already drawn, and the stroke under the pointer.
// A stroke in progress only ever draws its newest segment, so its cost does not grow with the map.

import type { Id, InkColor, Stroke } from '../doc/types.ts';
import type { CameraState } from './camera.ts';

export type InkPalette = Record<InkColor, string>;

export const INK_PALETTES: Record<'dark' | 'light', InkPalette> = {
  dark: {
    ink: '#E8EAF0',
    yellow: '#FFE14D',
    pink: '#FF8CC6',
    aqua: '#6FE3E1',
    peach: '#FFB27A',
    periwinkle: '#A9B8FF',
  },
  light: {
    ink: '#1F2430',
    yellow: '#C79A00',
    pink: '#D6408F',
    aqua: '#0E9C9A',
    peach: '#D9722B',
    periwinkle: '#4F63D9',
  },
};

const paths = new WeakMap<Stroke, Path2D>();

const hasPressure = (points: Float32Array): boolean => {
  const firstPressure = points[2];
  for (let i = 5; i < points.length; i += 3) {
    if (Math.abs(points[i] - firstPressure) > 0.01) return true;
  }
  return false;
};

/** A smooth centre line, or a filled outline when a real pen gave varying pressure. */
const buildPath = (stroke: Stroke): Path2D => {
  const p = stroke.points;
  const path = new Path2D();
  if (p.length < 6) {
    path.arc(p[0], p[1], stroke.width / 2, 0, Math.PI * 2);
    return path;
  }
  if (!hasPressure(p)) {
    path.moveTo(p[0], p[1]);
    for (let i = 3; i < p.length - 3; i += 3) {
      path.quadraticCurveTo(p[i], p[i + 1], (p[i] + p[i + 3]) / 2, (p[i + 1] + p[i + 4]) / 2);
    }
    path.lineTo(p[p.length - 3], p[p.length - 2]);
    return path;
  }
  const n = p.length / 3;
  const left: number[] = [];
  const right: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = Math.max(0, i - 1) * 3;
    const b = Math.min(n - 1, i + 1) * 3;
    const dx = p[b] - p[a];
    const dy = p[b + 1] - p[a + 1];
    const length = Math.hypot(dx, dy) || 1;
    const half = (stroke.width * (0.35 + p[i * 3 + 2] * 1.3)) / 2;
    const nx = (-dy / length) * half;
    const ny = (dx / length) * half;
    left.push(p[i * 3] + nx, p[i * 3 + 1] + ny);
    right.push(p[i * 3] - nx, p[i * 3 + 1] - ny);
  }
  path.moveTo(left[0], left[1]);
  for (let i = 2; i < left.length; i += 2) path.lineTo(left[i], left[i + 1]);
  for (let i = right.length - 2; i >= 0; i -= 2) path.lineTo(right[i], right[i + 1]);
  path.closePath();
  return path;
};

const pathFor = (stroke: Stroke): Path2D => {
  let path = paths.get(stroke);
  if (!path) {
    path = buildPath(stroke);
    paths.set(stroke, path);
  }
  return path;
};

const drawArrowHead = (ctx: CanvasRenderingContext2D, stroke: Stroke): void => {
  const p = stroke.points;
  const x2 = p[p.length - 3];
  const y2 = p[p.length - 2];
  const x1 = p[p.length - 6] ?? p[0];
  const y1 = p[p.length - 5] ?? p[1];
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const size = 11 + stroke.width * 2;
  ctx.beginPath();
  ctx.moveTo(x2 + Math.cos(angle + 2.6) * size, y2 + Math.sin(angle + 2.6) * size);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x2 + Math.cos(angle - 2.6) * size, y2 + Math.sin(angle - 2.6) * size);
  ctx.stroke();
};

export interface Offset {
  ids: ReadonlySet<Id>;
  dx: number;
  dy: number;
}

/** Above this many visible points, moving the finished bitmap beats redrawing it every frame. */
const HEAVY_POINTS = 40_000;

export class InkRenderer {
  private committedCtx: CanvasRenderingContext2D;
  private liveCtx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private camera: CameraState = { x: 0, y: 0, z: 1 };
  private palette: InkPalette = INK_PALETTES.dark;
  private liveLast: { x: number; y: number; mx: number; my: number } | null = null;
  private liveStyle: { color: string; width: number } = { color: '#fff', width: 2 };
  private bitmapCamera: CameraState = this.camera;
  private visiblePoints = 0;

  private committed: HTMLCanvasElement;
  private live: HTMLCanvasElement;

  constructor(committed: HTMLCanvasElement, live: HTMLCanvasElement) {
    this.committed = committed;
    this.live = live;
    this.committedCtx = committed.getContext('2d', { alpha: true })!;
    // Low latency mode lets the browser skip compositing work for the stroke being drawn.
    this.liveCtx = live.getContext('2d', { alpha: true, desynchronized: true })!;
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    for (const canvas of [this.committed, this.live]) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
  }

  setCamera(camera: CameraState): void {
    this.camera = camera;
  }

  setPalette(palette: InkPalette): void {
    this.palette = palette;
  }

  private applyTransform(ctx: CanvasRenderingContext2D): void {
    const { x, y, z } = this.camera;
    ctx.setTransform(this.dpr * z, 0, 0, this.dpr * z, this.dpr * x, this.dpr * y);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  private drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
    const color = this.palette[stroke.color];
    const path = pathFor(stroke);
    if (stroke.points.length >= 6 && hasPressure(stroke.points)) {
      ctx.fillStyle = color;
      ctx.fill(path);
      return;
    }
    if (stroke.points.length < 6) {
      ctx.fillStyle = color;
      ctx.fill(path);
      return;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = stroke.width;
    ctx.stroke(path);
    if (stroke.arrow) drawArrowHead(ctx, stroke);
  }

  /** Colour of selection and tool previews: the theme's accent, readable on either ground. */
  get accent(): string {
    return this.palette === INK_PALETTES.light ? '#2563EB' : '#60A5FA';
  }

  get isHeavy(): boolean {
    return this.visiblePoints > HEAVY_POINTS;
  }

  /**
   * Moves the bitmap already drawn instead of redrawing it, which only costs the compositor.
   * A full render follows when the camera settles.
   */
  previewCamera(): void {
    const scale = this.camera.z / this.bitmapCamera.z;
    const dx = this.camera.x - this.bitmapCamera.x * scale;
    const dy = this.camera.y - this.bitmapCamera.y * scale;
    this.committed.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
  }

  /** Full redraw of what is on screen. Strokes outside the view are skipped entirely. */
  render(strokes: readonly Stroke[], offset?: Offset, selected?: ReadonlySet<Id>): void {
    this.committed.style.transform = '';
    this.bitmapCamera = this.camera;
    let visiblePoints = 0;
    const ctx = this.committedCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.committed.width, this.committed.height);
    this.applyTransform(ctx);
    const { x, y, z } = this.camera;
    const left = -x / z;
    const top = -y / z;
    const right = (this.width - x) / z;
    const bottom = (this.height - y) / z;
    for (const stroke of strokes) {
      const shift = offset?.ids.has(stroke.id);
      const dx = shift ? offset!.dx : 0;
      const dy = shift ? offset!.dy : 0;
      const b = stroke.box;
      const pad = stroke.width + 12;
      if (
        b.x + dx > right + pad ||
        b.x + b.w + dx < left - pad ||
        b.y + dy > bottom + pad ||
        b.y + b.h + dy < top - pad
      ) {
        continue;
      }
      visiblePoints += stroke.points.length / 3;
      if (shift) ctx.translate(dx, dy);
      if (selected?.has(stroke.id)) {
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = this.accent;
        ctx.lineWidth = stroke.width + 5;
        ctx.stroke(pathFor(stroke));
        ctx.restore();
      }
      this.drawStroke(ctx, stroke);
      if (shift) ctx.translate(-dx, -dy);
    }
    this.visiblePoints = visiblePoints;
  }

  /** Adds one finished stroke without redrawing anything else. */
  appendCommitted(stroke: Stroke): void {
    this.visiblePoints += stroke.points.length / 3;
    this.applyTransform(this.committedCtx);
    this.drawStroke(this.committedCtx, stroke);
  }

  liveBegin(color: InkColor, width: number, x: number, y: number): void {
    this.liveStyle = { color: this.palette[color], width };
    this.liveLast = { x, y, mx: x, my: y };
    const ctx = this.liveCtx;
    this.applyTransform(ctx);
    ctx.fillStyle = this.liveStyle.color;
    ctx.beginPath();
    ctx.arc(x, y, width / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  liveExtend(x: number, y: number, pressure: number, varies: boolean): void {
    const last = this.liveLast;
    if (!last) return;
    const ctx = this.liveCtx;
    const mx = (last.x + x) / 2;
    const my = (last.y + y) / 2;
    ctx.strokeStyle = this.liveStyle.color;
    ctx.lineWidth = varies
      ? this.liveStyle.width * (0.35 + pressure * 1.3)
      : this.liveStyle.width;
    ctx.beginPath();
    ctx.moveTo(last.mx, last.my);
    ctx.quadraticCurveTo(last.x, last.y, mx, my);
    ctx.stroke();
    this.liveLast = { x, y, mx, my };
  }

  /** Previews for the arrow tool and the lasso, in world coordinates. */
  liveOverlay(draw: (ctx: CanvasRenderingContext2D) => void): void {
    this.liveClear();
    const ctx = this.liveCtx;
    this.applyTransform(ctx);
    draw(ctx);
  }

  liveClear(): void {
    const ctx = this.liveCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.live.width, this.live.height);
    this.liveLast = null;
  }
}
