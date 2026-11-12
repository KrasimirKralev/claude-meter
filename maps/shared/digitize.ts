// The contract between the browser and the local AI server.

export interface DigitizeBubble {
  id: string;
  kind: 'group' | 'note';
  title: string;
  /** `mark` is the colour of a circle drawn around that line. */
  items: { id: string; text: string; mark?: string }[];
  /** The bubble this one was drawn inside. */
  parent?: string;
  /** Pen colour of the drawn shape, when it had one. */
  color?: string;
  /** Typed with no shape drawn around it: a word or a list standing on its own. */
  free?: true;
  /** Where it was drawn, on a 0 to 100 grid over the whole sketch, so the model can read layout. */
  at?: { x: number; y: number; w: number; h: number };
}

export interface DigitizeLink {
  id: string;
  from: string;
  to: string;
  /** The line of `from` the arrow was drawn from, when it started at one circled line. */
  fromItem?: string;
  toItem?: string;
  label?: string;
  /** Pen colour of the drawn arrow, when it had one. People colour-code related things. */
  color?: string;
}

export interface DigitizeRequest {
  title: string;
  bubbles: DigitizeBubble[];
  links: DigitizeLink[];
  /** Typed text that no shape claimed. */
  looseText: string[];
  /** PNG as base64. Sent only when the sketch holds ink the local pass could not read. */
  image?: string;
}

export type AiProposal =
  | { kind: 'map-title'; title: string }
  | { kind: 'summary'; text: string }
  | { kind: 'rename'; bubble: string; title: string }
  | { kind: 'rewrite'; bubble: string; item: string; text: string }
  | { kind: 'add-item'; bubble: string; text: string }
  | { kind: 'move-item'; item: string; from: string; to: string }
  | { kind: 'link'; from: string; to: string; fromItem?: string; toItem?: string; label?: string }
  | { kind: 'label'; link: string; label: string }
  | { kind: 'group'; title: string; items: string[] };

export type StreamEvent =
  | { type: 'start'; provider: string; model?: string }
  | { type: 'proposal'; proposal: AiProposal }
  | { type: 'done'; proposals: number; dropped: number }
  | { type: 'error'; code: 'no-provider' | 'timeout' | 'failed'; message: string };

const MAX_TEXT = 400;

const text = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  // One line only: a newline could forge a heading in the plan exported for Claude Code.
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length > 0 && trimmed.length <= MAX_TEXT ? trimmed : null;
};

const id = (value: unknown): string | null =>
  typeof value === 'string' && /^[\w-]{1,40}$/.test(value) ? value : null;

/** Returns a proposal only when the object matches the contract exactly enough to apply safely. */
export const validateProposal = (raw: unknown): AiProposal | null => {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  switch (o.kind) {
    case 'map-title': {
      const title = text(o.title);
      return title ? { kind: 'map-title', title } : null;
    }
    case 'summary': {
      const value = text(o.text);
      return value ? { kind: 'summary', text: value } : null;
    }
    case 'rename': {
      const bubble = id(o.bubble);
      const title = text(o.title);
      return bubble && title ? { kind: 'rename', bubble, title } : null;
    }
    case 'rewrite': {
      const bubble = id(o.bubble);
      const item = id(o.item);
      const value = text(o.text);
      return bubble && item && value ? { kind: 'rewrite', bubble, item, text: value } : null;
    }
    case 'add-item': {
      const bubble = id(o.bubble);
      const value = text(o.text);
      return bubble && value ? { kind: 'add-item', bubble, text: value } : null;
    }
    case 'move-item': {
      const item = id(o.item);
      const from = id(o.from);
      const to = id(o.to);
      return item && from && to && from !== to ? { kind: 'move-item', item, from, to } : null;
    }
    case 'link': {
      const from = id(o.from);
      const to = id(o.to);
      if (!from || !to) return null;
      const proposal: AiProposal = { kind: 'link', from, to };
      const fromItem = id(o.fromItem);
      const toItem = id(o.toItem);
      // An arrow inside one bubble only makes sense between two of its lines.
      if (from === to && !(fromItem && toItem && fromItem !== toItem)) return null;
      if (fromItem) proposal.fromItem = fromItem;
      if (toItem) proposal.toItem = toItem;
      const label = text(o.label);
      if (label) proposal.label = label;
      return proposal;
    }
    case 'label': {
      const link = id(o.link);
      const label = text(o.label);
      return link && label && label.length <= 60 ? { kind: 'label', link, label } : null;
    }
    case 'group': {
      const title = text(o.title);
      if (!title || !Array.isArray(o.items)) return null;
      const items = o.items.map(text).filter((item): item is string => item !== null);
      return { kind: 'group', title, items };
    }
    default:
      return null;
  }
};

/** Parses one line of model output. Fences and prose return null and are dropped by the caller. */
export const parseAiLine = (line: string): AiProposal | null => {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    return validateProposal(JSON.parse(trimmed));
  } catch {
    return null;
  }
};

/** Turns arbitrary stream chunks into complete lines. */
export class LineSplitter {
  private buffer = '';

  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    return lines;
  }

  flush(): string[] {
    const rest = this.buffer;
    this.buffer = '';
    return rest.trim() ? [rest] : [];
  }
}
