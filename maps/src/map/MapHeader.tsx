import { useLayoutEffect, useRef } from 'react';
import { contentBox, headerPosition } from '../canvas/actions.ts';
import { hasRealTitle } from '../doc/ops.ts';
import { store, useStore } from '../state/store.ts';

/** The map's name and one-line summary, so the finished map reads as a finished page. */
export const MapHeader = () => {
  const title = useStore((s) => s.doc.title);
  const summary = useStore((s) => s.doc.summary);
  const bubbles = useStore((s) => s.doc.bubbles);
  useStore((s) => s.ui.headerH);
  const ref = useRef<HTMLElement>(null);
  const { x, y } = headerPosition(store.doc);
  const width = Math.max(560, contentBox('map')?.w ?? 900);

  // Its height follows the title's wrapping, and the bubbles must leave room for it.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const measure = (): void => {
      const height = element.offsetHeight;
      if (height > 0 && Math.abs(height - store.ui.headerH) > 1) store.setUi({ headerH: height });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [bubbles.length]);

  return (
    <header
      ref={ref}
      className="map-header"
      style={{ width, transform: `translate(${x}px, ${y}px)` }}
    >
      {hasRealTitle(store.doc) && <h1>{title}</h1>}
      {summary && <p>{summary}</p>}
    </header>
  );
};
