// A map from a file or from storage must be whole before anything renders it. One bad field could
// otherwise crash the page on every start and make every other map unreachable.

import { boxOfPoints, createDoc } from './ops.ts';
import type {
  Bubble,
  BubbleItem,
  Id,
  Link,
  MapDoc,
  Placement,
  Proposal,
  Stroke,
  TextNote,
} from './types.ts';

const REFUSED = 'This file is not a Balonche map.';

const INK = new Set(['ink', 'yellow', 'pink', 'aqua', 'peach', 'periwinkle']);
const STYLES = new Set(['candy', 'sunny', 'yellow']);
const STATUS = new Set(['pending', 'accepted', 'rejected']);

type Raw = Record<string, unknown>;

const fail = (): never => {
  throw new Error(REFUSED);
};
const object = (value: unknown): Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Raw) : fail();
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : fail());
const string = (value: unknown): string => (typeof value === 'string' ? value : fail());
const number = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fail();
// A negative width makes the canvas throw on every redraw.
const positive = (value: unknown): number => (number(value) > 0 ? (value as number) : fail());
const strings = (value: unknown): string[] => list(value).map(string);
const oneOf = <T extends string>(value: unknown, allowed: Set<string>): T =>
  typeof value === 'string' && allowed.has(value) ? (value as T) : fail();
const status = (value: unknown): Proposal['status'] => oneOf(value, STATUS);

const toPoints = (value: unknown): Float32Array => {
  const points =
    value instanceof Float32Array ? value : Float32Array.from(list(value).map(number));
  if (points.length < 3 || points.length % 3 !== 0) fail();
  for (const point of points) if (!Number.isFinite(point)) fail();
  return points;
};

const toStroke = (value: unknown): Stroke => {
  const raw = object(value);
  const points = toPoints(raw.points);
  const stroke: Stroke = {
    id: string(raw.id),
    points,
    color: oneOf(raw.color, INK),
    width: positive(raw.width),
    box: boxOfPoints(points),
  };
  if (raw.arrow === true) stroke.arrow = true;
  return stroke;
};

const toText = (value: unknown): TextNote => {
  const raw = object(value);
  const note: TextNote = {
    id: string(raw.id),
    x: number(raw.x),
    y: number(raw.y),
    text: string(raw.text),
    w: number(raw.w),
    h: number(raw.h),
  };
  if (raw.wrap !== undefined) note.wrap = number(raw.wrap);
  return note;
};

const toPlacement = (value: unknown): Placement => {
  const raw = object(value);
  const place: Placement = { x: number(raw.x), y: number(raw.y), w: number(raw.w) };
  if (raw.h !== undefined) place.h = number(raw.h);
  return place;
};

const toItem = (value: unknown): BubbleItem => {
  const raw = object(value);
  const item: BubbleItem = { id: string(raw.id), text: string(raw.text) };
  if (raw.mark !== undefined) item.mark = oneOf(raw.mark, INK);
  return item;
};

const toBubble = (value: unknown): Bubble => {
  const raw = object(value);
  const slot = number(raw.slot);
  if (!Number.isInteger(slot) || slot < 0 || slot > 4) fail();
  const bubble: Bubble = {
    id: string(raw.id),
    kind: raw.kind === 'note' ? 'note' : raw.kind === 'group' ? 'group' : fail(),
    title: string(raw.title),
    items: list(raw.items).map(toItem),
    status: status(raw.status),
    slot,
    sketch: toPlacement(raw.sketch),
    map: toPlacement(raw.map),
    pinned: raw.pinned === true,
    sourceStrokes: strings(raw.sourceStrokes),
    sourceTexts: strings(raw.sourceTexts),
  };
  if (raw.parent !== undefined) bubble.parent = string(raw.parent);
  return bubble;
};

const toLink = (value: unknown): Link => {
  const raw = object(value);
  const link: Link = {
    id: string(raw.id),
    from: string(raw.from),
    to: string(raw.to),
    status: status(raw.status),
    sourceStrokes: strings(raw.sourceStrokes),
  };
  if (raw.label !== undefined) link.label = string(raw.label);
  if (raw.color !== undefined) link.color = oneOf(raw.color, INK);
  if (raw.fromItem !== undefined) link.fromItem = string(raw.fromItem);
  if (raw.toItem !== undefined) link.toItem = string(raw.toItem);
  return link;
};

const toBody = (value: unknown): Proposal['body'] => {
  const raw = object(value);
  switch (raw.kind) {
    case 'group':
    case 'note':
      return { kind: raw.kind, bubble: string(raw.bubble) };
    case 'link':
      return { kind: 'link', link: string(raw.link) };
    case 'label':
      return {
        kind: 'label',
        link: string(raw.link),
        label: string(raw.label),
        previous: string(raw.previous),
      };
    case 'rename':
      return {
        kind: 'rename',
        bubble: string(raw.bubble),
        title: string(raw.title),
        previous: string(raw.previous),
      };
    case 'rewrite':
      return {
        kind: 'rewrite',
        bubble: string(raw.bubble),
        item: string(raw.item),
        text: string(raw.text),
        previous: string(raw.previous),
      };
    case 'add-item':
      return { kind: 'add-item', bubble: string(raw.bubble), text: string(raw.text) };
    case 'move-item':
      return {
        kind: 'move-item',
        item: string(raw.item),
        from: string(raw.from),
        to: string(raw.to),
      };
    case 'map-title':
      return { kind: 'map-title', title: string(raw.title), previous: string(raw.previous) };
    case 'summary':
      return { kind: 'summary', text: string(raw.text) };
    default:
      return fail();
  }
};

const toProposal = (value: unknown): Proposal => {
  const raw = object(value);
  const proposal: Proposal = {
    id: string(raw.id),
    status: status(raw.status),
    origin: raw.origin === 'ai' ? 'ai' : raw.origin === 'local' ? 'local' : fail(),
    body: toBody(raw.body),
  };
  if (raw.cascadeOf !== undefined) proposal.cascadeOf = string(raw.cascadeOf);
  return proposal;
};

/**
 * Nesting that points nowhere, or in a circle, would hang or hide a bubble, so it is dropped rather
 * than refusing the whole map. The same goes for an arrow end naming a line its bubble lacks.
 */
const repairStructure = (bubbles: Bubble[], links: Link[]): { bubbles: Bubble[]; links: Link[] } => {
  const byId = new Map(bubbles.map((b) => [b.id, b]));
  const loops = (bubble: Bubble): boolean => {
    const seen = new Set([bubble.id]);
    let current = bubble.parent;
    while (current) {
      if (seen.has(current)) return true;
      seen.add(current);
      current = byId.get(current)?.parent;
    }
    return false;
  };
  const broken = new Set(
    bubbles
      .filter((b) => b.parent !== undefined && (!byId.has(b.parent) || loops(b)))
      .map((b) => b.id),
  );
  const fixed = bubbles.map((b) => {
    if (!broken.has(b.id)) return b;
    const { parent: _parent, ...rest } = b;
    return rest;
  });
  const hasItem = (bubbleId: Id, itemId: Id): boolean =>
    byId.get(bubbleId)?.items.some((i) => i.id === itemId) ?? false;
  const fixedLinks = links.map((link) => {
    const next = { ...link };
    if (next.fromItem !== undefined && !hasItem(next.from, next.fromItem)) delete next.fromItem;
    if (next.toItem !== undefined && !hasItem(next.to, next.toItem)) delete next.toItem;
    return next;
  });
  return { bubbles: fixed, links: fixedLinks };
};

/** Returns a complete map, or throws. Nothing from the input is trusted unchecked. */
export const validateDoc = (value: unknown): MapDoc => {
  const raw = object(value);
  if (raw.version !== 1) fail();
  const base = createDoc(string(raw.title));
  const { bubbles, links } = repairStructure(
    list(raw.bubbles).map(toBubble),
    list(raw.links).map(toLink),
  );
  return {
    ...base,
    id: raw.id === undefined ? base.id : string(raw.id),
    summary: raw.summary === undefined ? '' : string(raw.summary),
    strokes: list(raw.strokes).map(toStroke),
    texts: list(raw.texts).map(toText),
    bubbles,
    links,
    proposals: list(raw.proposals).map(toProposal),
    style: raw.style === undefined ? 'candy' : oneOf(raw.style, STYLES),
    bulgarianLetters: raw.bulgarianLetters === true,
    run: raw.run === undefined ? 0 : number(raw.run),
    isExample: raw.isExample === true,
    createdAt: raw.createdAt === undefined ? base.createdAt : number(raw.createdAt),
    updatedAt: raw.updatedAt === undefined ? base.updatedAt : number(raw.updatedAt),
  };
};
