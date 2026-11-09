import { isShownIn, shownRoot } from '../doc/ops.ts';
import type { Box, Bubble } from '../doc/types.ts';
import { useStore } from '../state/store.ts';
import { bubbleBox, lineBox } from './boxes.ts';
import { routeAnchored } from './links.ts';

export const LinkLayer = () => {
  const links = useStore((s) => s.doc.links);
  const bubbles = useStore((s) => s.doc.bubbles);
  const view = useStore((s) => s.ui.view);
  const heights = useStore((s) => s.ui.heights);
  const anchors = useStore((s) => s.ui.anchors);
  const selected = useStore((s) => s.ui.selectedLink);

  const key = view === 'map' ? 'map' : 'both';
  const measured = { heights: heights[key], anchors: anchors[key] };
  const shown = isShownIn(key);
  const boxOf = (bubble: Bubble): Box => bubbleBox(bubbles, bubble, key, measured);
  const rootOf = (bubble: Bubble): Bubble => shownRoot(bubbles, bubble, shown);

  const shownLinks = links.flatMap((link) => {
    if (link.status === 'rejected') return [];
    if (view === 'map' && link.status !== 'accepted') return [];
    const from = bubbles.find((b) => b.id === link.from);
    const to = bubbles.find((b) => b.id === link.to);
    if (!from || !to || from.status === 'rejected' || to.status === 'rejected') return [];
    if (view === 'map' && (from.status !== 'accepted' || to.status !== 'accepted')) return [];
    // The bubbles that hold either end are crossed on purpose, so only the others are in the way.
    const ends = new Set([rootOf(from).id, rootOf(to).id]);
    const others = bubbles
      .filter((b) => shown(b) && rootOf(b) === b && !ends.has(b.id))
      .map(boxOf);
    const fromLine = link.fromItem ? lineBox(bubbles, from, link.fromItem, key, measured) : null;
    const toLine = link.toItem ? lineBox(bubbles, to, link.toItem, key, measured) : null;
    return [{ link, route: routeAnchored(boxOf(from), boxOf(to), fromLine, toLine, others) }];
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
        {shownLinks.map(({ link, route }) => (
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
      {shownLinks
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
