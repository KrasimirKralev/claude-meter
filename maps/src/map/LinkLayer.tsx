import { estimateHeight } from './layout.ts';
import { routeLink } from './links.ts';
import type { Box, Bubble } from '../doc/types.ts';
import { useStore } from '../state/store.ts';

export const LinkLayer = () => {
  const links = useStore((s) => s.doc.links);
  const bubbles = useStore((s) => s.doc.bubbles);
  const view = useStore((s) => s.ui.view);
  const heights = useStore((s) => s.ui.heights);
  const selected = useStore((s) => s.ui.selectedLink);

  const boxOf = (bubble: Bubble): Box => {
    const place = view === 'map' ? bubble.map : bubble.sketch;
    const measured = view === 'map' ? heights.map[bubble.id] : heights.both[bubble.id];
    return {
      x: place.x,
      y: place.y,
      w: place.w,
      h: measured ?? estimateHeight(bubble, place.w),
    };
  };

  const shown = links.flatMap((link) => {
    if (link.status === 'rejected') return [];
    if (view === 'map' && link.status !== 'accepted') return [];
    const from = bubbles.find((b) => b.id === link.from);
    const to = bubbles.find((b) => b.id === link.to);
    if (!from || !to || from.status === 'rejected' || to.status === 'rejected') return [];
    if (view === 'map' && (from.status !== 'accepted' || to.status !== 'accepted')) return [];
    const others = bubbles
      .filter(
        (b) =>
          b.id !== from.id &&
          b.id !== to.id &&
          (view === 'map' ? b.status === 'accepted' : b.status !== 'rejected'),
      )
      .map(boxOf);
    return [{ link, route: routeLink(boxOf(from), boxOf(to), others) }];
  });

  return (
    <>
      <svg className="link-layer" aria-hidden="true">
        <defs>
          <marker
            id="arrow-head"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M1 1L9 5L1 9z" />
          </marker>
          <marker
            id="arrow-head-thin"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="8"
            markerHeight="8"
            orient="auto"
          >
            <path d="M1 1L9 5L1 9z" />
          </marker>
        </defs>
        {shown.map(({ link, route }) => (
          <g key={link.id} className={`link-group ${selected === link.id ? 'selected' : ''}`}>
            <path className="link-hit" data-link={link.id} d={route.d} />
            <path
              className={`link-line ${link.status === 'pending' ? 'pending' : ''}`}
              d={route.d}
              pathLength={view === 'map' ? 1 : undefined}
              markerEnd={view === 'map' ? 'url(#arrow-head)' : 'url(#arrow-head-thin)'}
            />
          </g>
        ))}
      </svg>
      {shown
        .filter(({ link }) => link.label)
        .map(({ link, route }) => (
          <div
            key={link.id}
            className="link-label"
            style={{ left: route.mid.x, top: route.mid.y }}
          >
            {link.label}
          </div>
        ))}
    </>
  );
};
