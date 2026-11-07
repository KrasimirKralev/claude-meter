// The finished map as a plan people and Claude Code can read. Bubbles run in arrow order.

import { visibleBubbles } from '../doc/ops.ts';
import type { MapDoc } from '../doc/types.ts';
import { walkOrder } from '../map/walk.ts';

/** Text typed on the canvas can span lines. In a plan, that could look like a heading of its own. */
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

export const docToPlanMarkdown = (doc: MapDoc): string => {
  const bubbles = visibleBubbles(doc, 'map');
  const byId = new Map(bubbles.map((b) => [b.id, b]));
  const lines: string[] = [`# ${oneLine(doc.title)}`, ''];
  if (doc.summary) lines.push(oneLine(doc.summary), '');
  for (const note of bubbles.filter((b) => b.kind === 'note')) {
    lines.push(`> ${oneLine(note.title)}`, '');
  }
  for (const bubble of walkOrder(doc).filter((b) => b.kind === 'group')) {
    lines.push(`## ${oneLine(bubble.title) || 'Untitled'}`, '');
    for (const item of bubble.items) lines.push(`- [ ] ${oneLine(item.text)}`);
    if (bubble.items.length > 0) lines.push('');
    const outgoing = doc.links.filter(
      (l) => l.status === 'accepted' && l.from === bubble.id && byId.has(l.to),
    );
    for (const link of outgoing) {
      const target = oneLine(byId.get(link.to)?.title ?? '') || 'Untitled';
      lines.push(`Leads to: ${target}${link.label ? ` (${oneLine(link.label)})` : ''}`);
    }
    if (outgoing.length > 0) lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
};

export const planForClaudeCode = (doc: MapDoc): string =>
  [
    'This is a project map I drew. Each section is a part of the project, and "Leads to" lines show',
    'its arrows. Read it, ask me about anything unclear, then propose how to build it.',
    '',
    docToPlanMarkdown(doc),
  ].join('\n');
