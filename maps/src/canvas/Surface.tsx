import { useEffect, useRef, useState } from 'react';
import type { Stroke } from '../doc/types.ts';
import { registerRipple } from '../effects/ripple.ts';
import { BubbleLayer } from '../map/BubbleLayer.tsx';
import { LinkLayer } from '../map/LinkLayer.tsx';
import { MapHeader } from '../map/MapHeader.tsx';
import { store, useStore } from '../state/store.ts';
import { applyDots, camera } from './camera.ts';
import { DotGrid } from './dots.ts';
import { attachInteraction } from './interaction.ts';
import { INK_PALETTES, InkRenderer } from './ink.ts';
import type { Offset } from './ink.ts';
import { TextLayer } from './TextLayer.tsx';

export const Surface = () => {
  const rootRef = useRef<HTMLDivElement>(null);
  const committedRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const rippleRef = useRef<HTMLDivElement>(null);
  const dotsRef = useRef<HTMLCanvasElement>(null);
  const view = useStore((s) => s.ui.view);
  const tool = useStore((s) => s.ui.tool);
  const style = useStore((s) => s.doc.style);
  const bulgarian = useStore((s) => s.doc.bulgarianLetters);
  const morphing = useStore((s) => s.ui.morphing);
  const spotlight = useStore((s) => Boolean(s.ui.present?.bubble));
  const [panning, setPanning] = useState(false);

  useEffect(() => {
    const root = rootRef.current!;
    const world = worldRef.current!;
    const ink = new InkRenderer(committedRef.current!, liveRef.current!);
    const dots = new DotGrid(dotsRef.current!, store.ui.theme);
    registerRipple(rippleRef.current);

    let frame = 0;
    let offset: Offset | undefined;
    let drawnStrokes: readonly Stroke[] = [];
    let drawnSelection: readonly string[] = [];
    let drawnTheme = store.ui.theme;
    let drawnView = store.ui.view;

    const draw = (): void => {
      frame = 0;
      drawnStrokes = store.doc.strokes;
      drawnSelection = store.ui.selection;
      drawnView = store.ui.view;
      // Nothing is visible on this layer in the finished map, so there is nothing to spend on.
      if (drawnView === 'map') return;
      ink.render(
        drawnStrokes,
        offset,
        drawnSelection.length > 0 ? new Set(drawnSelection) : undefined,
      );
    };
    const requestRender = (): void => {
      if (frame === 0) frame = requestAnimationFrame(draw);
    };

    const resize = (): void => {
      ink.resize(root.clientWidth, root.clientHeight, devicePixelRatio || 1);
      dots.resize(root.clientWidth, root.clientHeight, devicePixelRatio || 1);
      dots.draw(camera.state);
      draw();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(root);

    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let sharpenTimer: ReturnType<typeof setTimeout> | undefined;
    let dotsFrame = 0;
    const applyCamera = (state: typeof camera.state): void => {
      // A composited layer pans cheaply but freezes its text at the old zoom, so it only stays
      // composited while the view is moving. Text sharpens as soon as the movement stops.
      world.style.willChange = 'transform';
      clearTimeout(sharpenTimer);
      sharpenTimer = setTimeout(() => {
        world.style.willChange = 'auto';
      }, 160);
      world.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.z})`;
      applyDots(root, state);
      if (dotsFrame === 0) {
        dotsFrame = requestAnimationFrame(() => {
          dotsFrame = 0;
          dots.draw(camera.state);
        });
      }
      ink.setCamera(state);
      clearTimeout(settleTimer);
      if (ink.isHeavy && store.ui.view !== 'map') {
        // A very full canvas moves as one picture and sharpens when the movement stops.
        ink.previewCamera();
        settleTimer = setTimeout(requestRender, 120);
      } else {
        requestRender();
      }
    };
    const unsubscribeCamera = camera.subscribe(applyCamera);
    applyCamera(camera.state);

    ink.setPalette(INK_PALETTES[store.ui.theme]);
    resize();

    let expected: Stroke | null = null;
    const unsubscribeStore = store.subscribe(() => {
      const { doc, ui } = store;
      if (ui.theme !== drawnTheme) {
        drawnTheme = ui.theme;
        ink.setPalette(INK_PALETTES[ui.theme]);
        dots.setTheme(ui.theme);
        dots.draw(camera.state);
        requestRender();
        return;
      }
      if (doc.strokes !== drawnStrokes) {
        // A finished stroke was already painted by the pen path, so no full redraw is owed.
        const appended =
          expected !== null &&
          doc.strokes.length === drawnStrokes.length + 1 &&
          doc.strokes.at(-1) === expected;
        expected = null;
        if (appended) drawnStrokes = doc.strokes;
        else requestRender();
      }
      if (ui.selection !== drawnSelection || ui.view !== drawnView) requestRender();
    });

    const detach = attachInteraction(root, {
      ink,
      world,
      requestRender,
      setOffset: (next) => {
        offset = next;
      },
      setPanning,
      expectAppended: (stroke) => {
        expected = stroke;
      },
    });

    return () => {
      detach();
      unsubscribeStore();
      unsubscribeCamera();
      clearTimeout(settleTimer);
      clearTimeout(sharpenTimer);
      cancelAnimationFrame(dotsFrame);
      resizeObserver.disconnect();
      cancelAnimationFrame(frame);
      registerRipple(null);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className={`surface map-${style} ${morphing ? 'morphing' : ''} ${spotlight ? 'presenting' : ''}`}
      style={{ '--locl': bulgarian ? 1 : 0 } as React.CSSProperties}
      data-view={view}
      data-tool={tool}
      data-panning={panning}
      data-testid="surface"
      lang={bulgarian ? 'bg' : undefined}
    >
      <canvas ref={dotsRef} className="ink-layer dots" data-testid="dots" />
      <div ref={rippleRef} className="ripple" />
      <canvas ref={committedRef} className="ink-layer ink-committed" />
      <div ref={worldRef} className="world">
        <MapHeader />
        <LinkLayer />
        <TextLayer />
        <BubbleLayer />
      </div>
      <canvas ref={liveRef} className="ink-layer ink-live" />
    </div>
  );
};
