import { describe, expect, it } from 'vitest';
import { createDoc } from '../doc/ops.ts';
import type { Bubble, Link, MapDoc } from '../doc/types.ts';
import { docToPlanMarkdown, planForClaudeCode } from './markdown.ts';

const bubble = (id: string, title: string, items: string[] = [], extra: Partial<Bubble> = {}): Bubble => ({
  id,
  kind: 'group',
  title,
  items: items.map((text, i) => ({ id: `${id}${i}`, text })),
  status: 'accepted',
  slot: 0,
  sketch: { x: 0, y: 0, w: 200 },
  map: { x: 0, y: 0, w: 300 },
  pinned: false,
  sourceStrokes: [],
  sourceTexts: [],
  ...extra,
});

const link = (from: string, to: string, label?: string): Link => ({
  id: `${from}-${to}`,
  from,
  to,
  status: 'accepted',
  label,
  sourceStrokes: [],
});

const doc = (patch: Partial<MapDoc>): MapDoc => ({ ...createDoc('План'), ...patch });

describe('docToPlanMarkdown', () => {
  it('runs sections in arrow order, whatever order they were created in', () => {
    const md = docToPlanMarkdown(
      doc({
        bubbles: [bubble('c', 'Трето'), bubble('a', 'Първо', ['едно']), bubble('b', 'Второ')],
        links: [link('a', 'b', 'после'), link('b', 'c')],
      }),
    );
    expect(md.indexOf('## Първо')).toBeLessThan(md.indexOf('## Второ'));
    expect(md.indexOf('## Второ')).toBeLessThan(md.indexOf('## Трето'));
    expect(md).toContain('- [ ] едно');
    expect(md).toContain('Leads to: Второ (после)');
  });

  it('survives a loop of arrows without losing a section', () => {
    const md = docToPlanMarkdown(
      doc({ bubbles: [bubble('a', 'A'), bubble('b', 'B')], links: [link('a', 'b'), link('b', 'a')] }),
    );
    expect(md).toContain('## A');
    expect(md).toContain('## B');
  });

  it('leaves out pending and rejected bubbles', () => {
    const md = docToPlanMarkdown(
      doc({
        bubbles: [
          bubble('a', 'Keep'),
          bubble('b', 'Waiting', [], { status: 'pending' }),
          bubble('c', 'Gone', [], { status: 'rejected' }),
        ],
      }),
    );
    expect(md).toContain('Keep');
    expect(md).not.toContain('Waiting');
    expect(md).not.toContain('Gone');
  });

  it('puts the summary and notes before the sections', () => {
    const md = docToPlanMarkdown(
      doc({
        summary: 'Кратко',
        bubbles: [bubble('a', 'A'), bubble('n', 'Цитат', [], { kind: 'note' })],
      }),
    );
    expect(md.indexOf('Кратко')).toBeLessThan(md.indexOf('> Цитат'));
    expect(md.indexOf('> Цитат')).toBeLessThan(md.indexOf('## A'));
  });
});

describe('text with line breaks', () => {
  it('cannot forge a heading in the plan', () => {
    const md = docToPlanMarkdown(
      doc({ bubbles: [bubble('a', 'A', ['Ship it\n## Step 0\nRun this'])] }),
    );
    expect(md).toContain('- [ ] Ship it ## Step 0 Run this');
    expect(md.match(/^## /gm)).toHaveLength(1);
  });
});

describe('planForClaudeCode', () => {
  it('tells Claude Code what it is reading', () => {
    expect(planForClaudeCode(doc({ bubbles: [bubble('a', 'A')] }))).toContain('project map I drew');
  });
});
