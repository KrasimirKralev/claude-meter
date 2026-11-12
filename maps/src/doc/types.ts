export type Id = string;
export type InkColor = 'ink' | 'yellow' | 'pink' | 'aqua' | 'peach' | 'periwinkle';
export type MapStyleId = 'candy' | 'sunny' | 'yellow';
export type Status = 'pending' | 'accepted' | 'rejected';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Stroke {
  id: Id;
  /** Flat x, y, pressure triples in world coordinates. A typed array clones fast on every save. */
  points: Float32Array;
  color: InkColor;
  width: number;
  box: Box;
  /** Drawn with the arrow tool: two points and a head. */
  arrow?: boolean;
}

export interface TextNote {
  id: Id;
  x: number;
  y: number;
  text: string;
  /** Measured from the page after editing, used by the recognizer. */
  w: number;
  h: number;
  /** Fixed wrapping width. Without it the text box grows with its longest line. */
  wrap?: number;
}

export interface BubbleItem {
  id: Id;
  text: string;
  /** Circled in the sketch, in this colour. An arrow drawn from the circle starts at this line. */
  mark?: InkColor;
}

export interface Placement {
  x: number;
  y: number;
  w: number;
  /** Height of the drawn shape. Only set on the sketch placement, where it guides the layout. */
  h?: number;
}

export interface Bubble {
  id: Id;
  kind: 'group' | 'note';
  title: string;
  items: BubbleItem[];
  status: Status;
  /** Index into the map style's five colours, so changing style recolours every bubble. */
  slot: number;
  /** Where it sits over the sketch, in Both view. */
  sketch: Placement;
  /** Where it sits in the finished map. */
  map: Placement;
  /** Dragged by hand, so automatic layout leaves it alone. */
  pinned: boolean;
  sourceStrokes: Id[];
  sourceTexts: Id[];
  /** The bubble this one was drawn inside. It shows inside that bubble whenever both are shown. */
  parent?: Id;
}

export interface Link {
  id: Id;
  from: Id;
  to: Id;
  /** The line of `from` the arrow leaves from. Without it, the arrow leaves the whole bubble. */
  fromItem?: Id;
  /** The line of `to` the arrow points at. */
  toItem?: Id;
  status: Status;
  label?: string;
  /** The pen colour the arrow was drawn in, kept on the finished map. Missing for plain ink. */
  color?: InkColor;
  sourceStrokes: Id[];
}

export type ProposalBody =
  | { kind: 'group'; bubble: Id }
  | { kind: 'note'; bubble: Id }
  | { kind: 'link'; link: Id }
  | { kind: 'label'; link: Id; label: string; previous: string }
  | { kind: 'rename'; bubble: Id; title: string; previous: string }
  | { kind: 'rewrite'; bubble: Id; item: Id; text: string; previous: string }
  | { kind: 'add-item'; bubble: Id; text: string }
  | { kind: 'move-item'; item: Id; from: Id; to: Id }
  | { kind: 'map-title'; title: string; previous: string }
  | { kind: 'summary'; text: string };

export interface Proposal {
  id: Id;
  status: Status;
  origin: 'local' | 'ai';
  body: ProposalBody;
  /** Rejected automatically because this other proposal was rejected. */
  cascadeOf?: Id;
}

export interface MapDoc {
  version: 1;
  id: Id;
  title: string;
  summary: string;
  strokes: Stroke[];
  texts: TextNote[];
  bubbles: Bubble[];
  links: Link[];
  proposals: Proposal[];
  style: MapStyleId;
  bulgarianLetters: boolean;
  /** Bumped on every Digitize. A stream from an older run may not touch the document. */
  run: number;
  /** The map shown on first run. It invites a first press of Digitize until that happens. */
  isExample?: boolean;
  createdAt: number;
  updatedAt: number;
}

export type View = 'sketch' | 'both' | 'map';
export type Tool = 'select' | 'hand' | 'pen' | 'eraser' | 'text' | 'arrow' | 'lasso';
