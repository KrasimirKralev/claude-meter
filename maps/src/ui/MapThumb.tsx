import { INK_PALETTES } from '../canvas/ink.ts';
import type { MapStyleId } from '../doc/types.ts';
import { MAP_STYLES } from '../map/styles.ts';
import { useStore } from '../state/store.ts';
import { THUMB_H, THUMB_W } from '../state/summary.ts';
import type { Thumb } from '../state/summary.ts';

/** A small picture of a saved map: its bubbles and arrows, or its sketch while it is still one. */
export const MapThumb = ({ thumb, style }: { thumb: Thumb; style: MapStyleId }) => {
  const theme = useStore((s) => s.ui.theme);
  const pens = INK_PALETTES[theme === 'dark' ? 'dark' : 'light'];
  const colors = MAP_STYLES[style].colors;
  return (
    <svg
      className="map-thumb"
      viewBox={`0 0 ${THUMB_W} ${THUMB_H}`}
      width={THUMB_W}
      height={THUMB_H}
      aria-hidden="true"
    >
      {thumb.kind === 'map' && (
        <>
          {thumb.links.map(([from, to]) => {
            const a = thumb.bubbles[from];
            const b = thumb.bubbles[to];
            return (
              <path
                key={`${from}-${to}`}
                className="map-thumb-link"
                d={`M${a.x + a.w / 2} ${a.y + a.h / 2}L${b.x + b.w / 2} ${b.y + b.h / 2}`}
              />
            );
          })}
          {thumb.bubbles.map((b, i) => (
            <rect
              key={i}
              x={b.x}
              y={b.y}
              width={b.w}
              height={b.h}
              rx={Math.min(3, b.w / 3, b.h / 3)}
              fill={colors[b.slot % colors.length]}
            />
          ))}
        </>
      )}
      {thumb.kind === 'sketch' && (
        <>
          {thumb.strokes.map((stroke, i) => (
            <path key={i} className="map-thumb-ink" d={stroke.d} stroke={pens[stroke.color]} />
          ))}
          {thumb.notes.map((n, i) => (
            <rect key={i} className="map-thumb-note" x={n.x} y={n.y} width={n.w} height={n.h} rx={0.6} />
          ))}
        </>
      )}
    </svg>
  );
};
