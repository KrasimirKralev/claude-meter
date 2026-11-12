// Pan and zoom. Changes go straight to the page and the ink layer, never through React state.

import type { Box } from '../doc/types.ts';

export interface CameraState {
  x: number;
  y: number;
  z: number;
}

type Listener = (state: CameraState) => void;

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 4;

class Camera {
  state: CameraState = { x: 0, y: 0, z: 1 };
  private listeners = new Set<Listener>();
  private tween = 0;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(next: CameraState): void {
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }

  toWorld(sx: number, sy: number): { x: number; y: number } {
    const { x, y, z } = this.state;
    return { x: (sx - x) / z, y: (sy - y) / z };
  }

  panBy(dx: number, dy: number): void {
    this.stop();
    this.set({ ...this.state, x: this.state.x + dx, y: this.state.y + dy });
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    this.stop();
    const { x, y, z } = this.state;
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor));
    const ratio = next / z;
    this.set({ x: sx - (sx - x) * ratio, y: sy - (sy - y) * ratio, z: next });
  }

  private stop(): void {
    cancelAnimationFrame(this.tween);
  }

  animateTo(target: CameraState, duration = 320): void {
    this.stop();
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || duration <= 0) {
      this.set(target);
      return;
    }
    const start = this.state;
    const began = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - began) / duration);
      const eased = 1 - (1 - t) ** 4;
      this.set({
        x: start.x + (target.x - start.x) * eased,
        y: start.y + (target.y - start.y) * eased,
        z: start.z + (target.z - start.z) * eased,
      });
      if (t < 1) this.tween = requestAnimationFrame(tick);
    };
    this.tween = requestAnimationFrame(tick);
  }

  /** Fits a world box inside the free area of the screen, leaving room for the toolbars. */
  fit(box: Box, viewport: Box, options: { maxZoom?: number; animate?: boolean } = {}): void {
    if (box.w <= 0 || box.h <= 0) return;
    const z = Math.min(
      options.maxZoom ?? 1,
      viewport.w / box.w,
      viewport.h / box.h,
    );
    const target = {
      x: viewport.x + (viewport.w - box.w * z) / 2 - box.x * z,
      y: viewport.y + (viewport.h - box.h * z) / 2 - box.y * z,
      z: Math.max(MIN_ZOOM, z),
    };
    if (options.animate === false) this.set(target);
    else this.animateTo(target);
  }
}

export const camera = new Camera();

/** The dots move with the canvas and thin out when zoomed far out, so they never become noise. */
export const applyDots = (element: HTMLElement, state: CameraState): void => {
  let size = 22 * state.z;
  while (size < 13) size *= 2;
  while (size > 66) size /= 2;
  element.style.setProperty('--dot-size', `${size}px`);
  element.style.setProperty('--dot-x', `${state.x % size}px`);
  element.style.setProperty('--dot-y', `${state.y % size}px`);
};
