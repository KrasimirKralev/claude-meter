// The finished map as a plan people and Claude Code can read. Bubbles run in arrow order.

import { isShownIn, shownParent, visibleBubbles } from '../doc/ops.ts';
import type { Bubble, MapDoc } from '../doc/types.ts';
import { walkOrder } from '../map/walk.ts';

/** Text typed on the canvas can span lines. In a plan, that could look like a heading of its own. */
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

export const docToPlanMarkdown = (doc: MapDoc): string => {
  const bubbles = visibleBubbles(doc, 'map');
  const byId = new Map(bubbles.map((b) => [b.id, b]));
  const shown = isShownIn('map');
  const lines: string[] = [`# ${oneLine(doc.title)}`, ''];
  if (doc.summary) lines.push(oneLine(doc.summary), '');
  for (const note of bubbles.filter((b) => b.kind === 'note' && !shownParent(doc.bubbles, b, shown))) {
    lines.push(`> ${oneLine(note.title)}`, '');
  }
  const name = (bubble: Bubble | undefined): string => oneLine(bubble?.title ?? '') || 'Untitled';
  const lineText = (bubble: Bubble | undefined, item: string | undefined): string | undefined => {
    const found = item ? bubble?.items.find((i) => i.id === item) : undefined;
    return found ? oneLine(found.text) : undefined;
  };
  for (const bubble of walkOrder(doc).filter((b) => b.kind === 'group')) {
    // A box drawn inside another is a section of it, one heading level down.
    let depth = 0;
    for (let parent = shownParent(doc.bubbles, bubble, shown); parent; ) {
      depth += 1;
      parent = shownParent(doc.bubbles, parent, shown);
    }
    lines.push(`${'#'.repeat(Math.min(2 + depth, 6))} ${name(bubble)}`, '');
    for (const item of bubble.items) lines.push(`- [ ] ${oneLine(item.text)}`);
    if (bubble.items.length > 0) lines.push('');
    const outgoing = doc.links.filter(
      (l) => l.status === 'accepted' && l.from === bubble.id && byId.has(l.to),
    );
    for (const link of outgoing) {
      const target = byId.get(link.to);
      const into = lineText(target, link.toItem);
      const where = into ? `${into} (in ${name(target)})` : name(target);
      const label = link.label ? ` (${oneLine(link.label)})` : '';
      const start = lineText(bubble, link.fromItem);
      lines.push(start ? `${start} leads to: ${where}${label}` : `Leads to: ${where}${label}`);
    }
    if (outgoing.length > 0) lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
};

export const planForClaudeCode = (doc: MapDoc): string =>
  [
    'This is a project map I drew. Each section is a part of the project, a deeper heading is a box',
    'drawn inside the one above it, and "leads to" lines show its arrows. Read it, ask me about',
    'anything unclear, then propose how to build it.',
    '',
    docToPlanMarkdown(doc),
  ].join('\n');
