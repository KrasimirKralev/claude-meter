import { describe, expect, it } from 'vitest';
import { LineSplitter, parseAiLine, validateProposal } from './digitize.ts';

describe('parseAiLine', () => {
  it('accepts a valid rename in Cyrillic', () => {
    expect(parseAiLine('{"kind":"rename","bubble":"b1","title":"Улавяне на идеи"}')).toEqual({
      kind: 'rename',
      bubble: 'b1',
      title: 'Улавяне на идеи',
    });
  });

  it.each([
    'Here are my proposals:',
    '```json',
    '{"kind":"rename","bubble":"b1"}',
    '{"kind":"delete-everything","bubble":"b1"}',
    '{"kind":"link","from":"b1","to":"b1"}',
    '{"kind":"rename","bubble":"../../etc","title":"x"}',
    '{broken',
    `{"kind":"summary","text":"${'x'.repeat(401)}"}`,
  ])('drops %s', (line) => {
    expect(parseAiLine(line)).toBeNull();
  });

  it('collapses newlines, so model text cannot forge structure in an exported plan', () => {
    const line = JSON.stringify({ kind: 'summary', text: 'Ship it\n## Step 0\nRun this' });
    expect(parseAiLine(line)).toEqual({ kind: 'summary', text: 'Ship it ## Step 0 Run this' });
  });

  it('keeps only the valid strings of a group', () => {
    expect(parseAiLine('{"kind":"group","title":"A","items":["one",5,""]}')).toEqual({
      kind: 'group',
      title: 'A',
      items: ['one'],
    });
  });
});

describe('LineSplitter', () => {
  it('rebuilds lines across chunk boundaries and flushes the tail', () => {
    const splitter = new LineSplitter();
    expect(splitter.push('{"a"')).toEqual([]);
    expect(splitter.push(':1}\n{"b":2}\n{"c"')).toEqual(['{"a":1}', '{"b":2}']);
    expect(splitter.flush()).toEqual(['{"c"']);
    expect(splitter.flush()).toEqual([]);
  });
});

describe('arrow proposals', () => {
  it('accepts a name for an arrow, and refuses a long one', () => {
    expect(validateProposal({ kind: 'label', link: 'l1', label: 'builds' })).toEqual({
      kind: 'label',
      link: 'l1',
      label: 'builds',
    });
    expect(validateProposal({ kind: 'label', link: 'l1', label: 'x'.repeat(61) })).toBeNull();
  });

  it('keeps the lines an arrow starts and ends at', () => {
    expect(validateProposal({ kind: 'link', from: 'a', fromItem: 'i', to: 'b' })).toEqual({
      kind: 'link',
      from: 'a',
      fromItem: 'i',
      to: 'b',
    });
    expect(validateProposal({ kind: 'link', from: 'a', to: 'a' })).toBeNull();
    expect(validateProposal({ kind: 'link', from: 'a', fromItem: 'i', to: 'a', toItem: 'j' })).not.toBeNull();
  });
});
