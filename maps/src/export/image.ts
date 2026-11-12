// PNG and SVG of the finished map, drawn from the document so the sketch lines can never appear.
// Both formats share one scene, so they match each other.

import { hasRealTitle, isShownIn, shownParent, shownRoot, unionBoxes, visibleBubbles } from '../doc/ops.ts';
import type { Box, Bubble, InkColor, MapDoc } from '../doc/types.ts';
import { childrenIn } from '../map/boxes.ts';
import { childRows, mapWidth, NEST_GAP, noteTail } from '../map/layout.ts';
import { assignLanes, routeAnchored } from '../map/links.ts';
import { BUBBLE_INK, MAP_STYLES } from '../map/styles.ts';
import type { MapStyle } from '../map/styles.ts';
import { INK_PALETTES } from '../canvas/ink.ts';
import { store } from '../state/store.ts';

const MARGIN = 60;
const DOT = 22;
const ITEM_SIZE = 15;
const ITEM_LINE = 20.25;
const NESTED_EDGE = 'rgba(20, 21, 26, 0.14)';
/** Same as the circled lines on the page. */
const MARK_COLORS: Record<InkColor, string> = {
  ink: '#1f2430',
  yellow: '#c79a00',
  pink: '#d6408f',
  aqua: '#0e9c9a',
  peach: '#d9722b',
  periwinkle: '#4f63d9',
};

interface Theme {
  bg: string;
  dot: string;
  ink: string;
  mute: string;
  line: string;
  note: string;
  noteEdge?: string;
}

const THEMES: Record<'dark' | 'light', Theme> = {
  dark: {
    bg: '#111318',
    dot: '#3A3F4B',
    ink: '#F3F4F6',
    mute: '#A8AEBB',
    line: '#E5E7EB',
    note: '#FFF6C9',
  },
  light: {
    bg: '#FFFFFF',
    dot: '#D1D5DB',
    ink: '#111827',
    mute: '#4B5563',
    line: '#111827',
    note: '#FFEFA3',
    noteEdge: '#E3C75A',
  },
};

const measurer = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;

const wrap = (text: string, font: string, width: number): string[] => {
  measurer.font = font;
  const fits = (value: string): boolean => measurer.measureText(value).width <= width;
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (fits(candidate)) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = '';
    // A word wider than the line, like a long link, breaks by letter, as it does on the page.
    for (const letter of word) {
      if (line && !fits(line + letter)) {
        lines.push(line);
        line = letter;
      } else {
        line += letter;
      }
    }
  }
  if (line) lines.push(line);
  return lines;
};

interface SceneText {
  x: number;
  y: number;
  text: string;
  font: string;
  fill: string;
}

interface SceneRect {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
  fill: string;
  shadow?: boolean;
  edge?: string;
  /** Thicker for a line circled in the sketch. */
  edgeWidth?: number;
}

/** The note's pointer: two base corners on the bubble's edge and a tip outside it. */
interface SceneTail {
  points: [number, number][];
  fill: string;
  edge?: string;
}

interface Scene {
  width: number;
  height: number;
  originX: number;
  originY: number;
  theme: Theme;
  rects: SceneRect[];
  texts: SceneText[];
  tails: SceneTail[];
  links: { d: string; label?: string; mid: { x: number; y: number }; color: string }[];
}

const buildScene = (doc: MapDoc): Scene => {
  const style: MapStyle = MAP_STYLES[doc.style];
  const theme = THEMES[store.ui.theme];
  // The same arrow colours as on the page: bright on dark, deeper on light.
  const pens = INK_PALETTES[store.ui.theme === 'dark' ? 'dark' : 'light'];
  const bubbles = visibleBubbles(doc, 'map');
  const rects: SceneRect[] = [];
  const texts: SceneText[] = [];
  const tails: SceneTail[] = [];
  const titleFont = `${style.titleWeight} ${style.titleSize}px "${style.titleFont}"`;
  const bodyFont = `${style.bodyWeight} ${ITEM_SIZE}px "${style.bodyFont}"`;
  const nestedTitleFont = `${style.titleWeight} ${style.titleSize * 0.8}px "${style.titleFont}"`;
  const boxes = new Map<string, Box>();
  const lineBoxes = new Map<string, Box>();
  const shown = isShownIn('map');
  const childrenOf = childrenIn(doc.bubbles, 'map');
  const roots = bubbles.filter((b) => !shownParent(doc.bubbles, b, shown));

  const place = (bubble: Bubble): void => {
    const { x, y, w } = bubble.map;
    if (bubble.kind === 'note') {
      const lines = wrap(bubble.title, bodyFont, w - 40);
      const h = 36 + lines.length * 21;
      const box = { x, y, w, h };
      boxes.set(bubble.id, box);
      rects.push({ ...box, r: style.radius, fill: theme.note, edge: theme.noteEdge, shadow: true });
      const groupBoxes = bubbles.filter((b) => b.kind === 'group').flatMap((b) => {
        const placed = boxes.get(b.id);
        return placed ? [placed] : [];
      });
      const tail = noteTail(box, groupBoxes);
      const reach = 12;
      const base = 13;
      const points: Record<typeof tail.side, [number, number][]> = {
        top: [[x + tail.pos - base, y + 1], [x + tail.pos, y - reach], [x + tail.pos + base, y + 1]],
        bottom: [[x + tail.pos - base, y + h - 1], [x + tail.pos, y + h + reach], [x + tail.pos + base, y + h - 1]],
        left: [[x + 1, y + tail.pos - base], [x - reach, y + tail.pos], [x + 1, y + tail.pos + base]],
        right: [[x + w - 1, y + tail.pos - base], [x + w + reach, y + tail.pos], [x + w - 1, y + tail.pos + base]],
      };
      tails.push({ points: points[tail.side], fill: theme.note, edge: theme.noteEdge });
      lines.forEach((text, i) =>
        texts.push({ x: x + 20, y: y + 18 + 15 + i * 21, text, font: bodyFont, fill: BUBBLE_INK }),
      );
      return;
    }
    placeGroup(bubble, x, y, w, false);
  };

  /** Lays out a group and everything drawn inside it, and returns its height. */
  const placeGroup = (bubble: Bubble, x: number, y: number, w: number, nested: boolean): number => {
    const pad = nested ? 16 : 22;
    const font = nested ? nestedTitleFont : titleFont;
    const size = nested ? style.titleSize * 0.8 : style.titleSize;
    // Pushed first and sized last, so it paints under everything inside it.
    const frame: SceneRect = {
      x,
      y,
      w,
      h: 0,
      r: nested ? style.radius * 0.6 : style.radius,
      fill: style.colors[bubble.slot % 5],
      shadow: !nested,
      edge: nested ? NESTED_EDGE : undefined,
      edgeWidth: nested ? 2 : undefined,
    };
    rects.push(frame);
    const titleLines = bubble.title ? wrap(bubble.title, font, w - pad * 2) : [];
    const titleLine = size * 1.2;
    let cursor = y + pad;
    titleLines.forEach((text, i) =>
      texts.push({ x: x + pad, y: cursor + size * 0.95 + i * titleLine, text, font, fill: BUBBLE_INK }),
    );
    cursor += titleLines.length * titleLine + (titleLines.length > 0 ? 12 : 0);
    bubble.items.forEach((item, index) => {
      if (index > 0 || titleLines.length > 0) cursor += 8;
      const lines = wrap(item.text, bodyFont, w - pad * 2 - 28);
      const h = 18 + lines.length * ITEM_LINE;
      rects.push({
        x: x + pad,
        y: cursor,
        w: w - pad * 2,
        h,
        r: style.itemRadius,
        fill: style.itemBg,
        edge: item.mark ? MARK_COLORS[item.mark] : undefined,
        edgeWidth: item.mark ? 2.5 : undefined,
      });
      lineBoxes.set(item.id, { x, y: cursor, w, h });
      lines.forEach((text, i) =>
        texts.push({
          x: x + pad + 14,
          y: cursor + 9 + 15 + i * ITEM_LINE,
          text,
          font: bodyFont,
          fill: style.itemInk,
        }),
      );
      cursor += h;
    });
    for (const row of childRows(childrenOf(bubble))) {
      cursor += NEST_GAP;
      let left = x + pad;
      let tallest = 0;
      for (const child of row) {
        const childW = mapWidth(child, childrenOf, true);
        tallest = Math.max(tallest, placeGroup(child, left, cursor, childW, true));
        left += childW + NEST_GAP;
      }
      cursor += tallest;
    }
    frame.h = cursor + pad - y;
    boxes.set(bubble.id, { x, y, w, h: frame.h });
    return frame.h;
  };
  // Groups first, because a note's tail aims at the nearest group. Bubbles drawn inside another are
  // placed by the one around them.
  roots.filter((b) => b.kind === 'group').forEach(place);
  roots.filter((b) => b.kind === 'note').forEach(place);

  const drawnLinks = doc.links.flatMap((link) => {
    if (link.status !== 'accepted') return [];
    const a = boxes.get(link.from);
    const b = boxes.get(link.to);
    if (!a || !b) return [];
    const ends = new Set(
      [link.from, link.to].map((id) => {
        const bubble = bubbles.find((x) => x.id === id) as Bubble;
        return shownRoot(doc.bubbles, bubble, shown).id;
      }),
    );
    const others = roots
      .filter((r) => !ends.has(r.id))
      .flatMap((r) => (boxes.has(r.id) ? [boxes.get(r.id) as Box] : []));
    const fromLine = link.fromItem ? (lineBoxes.get(link.fromItem) ?? null) : null;
    const toLine = link.toItem ? (lineBoxes.get(link.toItem) ?? null) : null;
    return [{ link, a, b, fromLine, toLine, others }];
  });
  // The same lanes as on screen, so the picture shows the arrows the way the map does.
  const lanes = assignLanes(
    drawnLinks.map(({ link, a, b, fromLine, toLine }) => ({
      id: link.id,
      from: link.from,
      a,
      b,
      fromLine,
      toLine,
    })),
  );
  const links = drawnLinks.map(({ link, a, b, fromLine, toLine, others }) => {
    const route = routeAnchored(a, b, fromLine, toLine, others, lanes.get(link.id));
    const color = link.color ? pens[link.color] : theme.line;
    return { d: route.d, label: link.label, mid: route.mid, color };
  });

  const body = unionBoxes([...boxes.values()]) ?? { x: 0, y: 0, w: 600, h: 300 };
  const width = Math.max(body.w, 560);
  const headerFont = `${style.titleWeight} 38px "${style.titleFont}"`;
  const summaryFont = `${style.bodyWeight} 16px "${style.bodyFont}"`;
  const titleLines = hasRealTitle(doc) ? wrap(doc.title, headerFont, width) : [];
  const summaryLines = doc.summary ? wrap(doc.summary, summaryFont, Math.min(width, 680)) : [];
  const headerLines =
    titleLines.length * 44 + (summaryLines.length > 0 ? 8 + summaryLines.length * 22 : 0);
  const headerRoom = headerLines > 0 ? headerLines + 44 : 0;
  const top = body.y - headerRoom;
  titleLines.forEach((text, i) =>
    texts.push({ x: body.x, y: top + 36 + i * 44, text, font: headerFont, fill: theme.ink }),
  );
  summaryLines.forEach((text, i) =>
    texts.push({
      x: body.x,
      y: top + titleLines.length * 44 + 24 + i * 22,
      text,
      font: summaryFont,
      fill: theme.mute,
    }),
  );

  return {
    width: Math.ceil(width + MARGIN * 2),
    height: Math.ceil(body.h + headerRoom + MARGIN * 2),
    originX: body.x - MARGIN,
    originY: top - MARGIN,
    theme,
    rects,
    texts,
    tails,
    links,
  };
};

/** `fonts.ready` only waits for fonts in use, and the map fonts may not be on screen right now. */
const loadFonts = async (style: MapStyle): Promise<void> => {
  await style.load();
  await Promise.all([
    document.fonts.load(`${style.titleWeight} 20px "${style.titleFont}"`, 'Aa09 Ая'),
    document.fonts.load(`${style.bodyWeight} 15px "${style.bodyFont}"`, 'Aa09 Ая'),
  ]);
};

export const exportPng = async (): Promise<Blob> => {
  const doc = store.doc;
  await loadFonts(MAP_STYLES[doc.style]);
  const scene = buildScene(doc);
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = scene.width * scale;
  canvas.height = scene.height * scale;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.scale(scale, scale);
  ctx.fillStyle = scene.theme.bg;
  ctx.fillRect(0, 0, scene.width, scene.height);
  ctx.fillStyle = scene.theme.dot;
  for (let y = DOT / 2; y < scene.height; y += DOT) {
    for (let x = DOT / 2; x < scene.width; x += DOT) {
      ctx.beginPath();
      ctx.arc(x, y, 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.translate(-scene.originX, -scene.originY);
  ctx.strokeStyle = scene.theme.line;
  ctx.fillStyle = scene.theme.line;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (const link of scene.links) {
    const path = new Path2D(link.d);
    ctx.strokeStyle = link.color;
    ctx.fillStyle = link.color;
    ctx.stroke(path);
    const points = link.d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    const [x2, y2] = points.slice(-2);
    const [x1, y1] = points.slice(-4, -2);
    const angle = Math.atan2(y2 - y1, x2 - x1);
    ctx.save();
    ctx.translate(x2, y2);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(2, 0);
    ctx.lineTo(-10, -6.5);
    ctx.lineTo(-10, 6.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  for (const rect of scene.rects) {
    ctx.save();
    if (rect.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 28;
      ctx.shadowOffsetY = 10;
    }
    ctx.fillStyle = rect.fill;
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.w, rect.h, rect.r);
    ctx.fill();
    ctx.restore();
    if (rect.edge) {
      ctx.save();
      ctx.strokeStyle = rect.edge;
      ctx.lineWidth = rect.edgeWidth ?? 1;
      ctx.beginPath();
      ctx.roundRect(rect.x, rect.y, rect.w, rect.h, rect.r);
      ctx.stroke();
      ctx.restore();
    }
  }
  for (const tail of scene.tails) {
    const [a, tip, b] = tail.points;
    ctx.save();
    ctx.fillStyle = tail.fill;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(tip[0], tip[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.closePath();
    ctx.fill();
    if (tail.edge) {
      ctx.strokeStyle = tail.edge;
      ctx.lineWidth = 1;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(tip[0], tip[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.textBaseline = 'alphabetic';
  for (const text of scene.texts) {
    ctx.font = text.font;
    ctx.fillStyle = text.fill;
    ctx.fillText(text.text, text.x, text.y);
  }
  for (const link of scene.links) {
    if (!link.label) continue;
    const style = MAP_STYLES[doc.style];
    ctx.font = `${style.bodyWeight} 13px "${style.bodyFont}"`;
    const width = ctx.measureText(link.label).width + 20;
    ctx.fillStyle = scene.theme.line;
    ctx.beginPath();
    ctx.roundRect(link.mid.x - width / 2, link.mid.y - 12, width, 24, 12);
    ctx.fill();
    ctx.fillStyle = scene.theme.bg;
    ctx.textAlign = 'center';
    ctx.fillText(link.label, link.mid.x, link.mid.y + 4.5);
    ctx.textAlign = 'start';
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The image could not be created.'))),
      'image/png',
    );
  });
};

// Control characters are illegal in XML, and one pasted by accident would break the whole file.
const ILLEGAL_XML = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\uFFFE\\uFFFF]', 'g');

const escapeXml = (text: string): string =>
  text
    .replace(ILLEGAL_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Copies the current page's rules for these fonts, with the font files inlined, into the SVG. */
const embedFontFaces = async (families: string[]): Promise<string> => {
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let list: CSSRuleList;
    try {
      list = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(list)) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const family = rule.style.getPropertyValue('font-family').replace(/['"]/g, '');
      if (!families.includes(family)) continue;
      const range = rule.style.getPropertyValue('unicode-range');
      // Only the Latin and Cyrillic files are loaded by this app, so only they can be inlined.
      const url = rule.style.getPropertyValue('src').match(/url\("?([^")]+\.woff2)"?\)/)?.[1];
      if (!url) continue;
      const response = await fetch(url);
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
      rules.push(
        `@font-face{font-family:"${family}";font-weight:${rule.style.getPropertyValue('font-weight')};` +
          `src:url(data:font/woff2;base64,${btoa(binary)}) format("woff2");` +
          (range ? `unicode-range:${range};` : '') +
          '}',
      );
    }
  }
  return rules.join('');
};

export const exportSvg = async (): Promise<string> => {
  const doc = store.doc;
  const style = MAP_STYLES[doc.style];
  await loadFonts(style);
  const scene = buildScene(doc);
  const fontCss = await embedFontFaces([style.titleFont, style.bodyFont]);
  const font = (value: string): string => {
    const [weight, size, ...family] = value.split(' ');
    return `font-weight="${weight}" font-size="${parseFloat(size)}" font-family=${JSON.stringify(
      family.join(' ').replace(/"/g, ''),
    )}`;
  };
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" ` +
      `viewBox="${scene.originX} ${scene.originY} ${scene.width} ${scene.height}">`,
    `<title>${escapeXml(doc.title)}</title>`,
    `<defs><style>${fontCss}</style>`,
    `<pattern id="dots" width="${DOT}" height="${DOT}" patternUnits="userSpaceOnUse" x="${scene.originX}" y="${scene.originY}">` +
      `<circle cx="${DOT / 2}" cy="${DOT / 2}" r="1" fill="${scene.theme.dot}"/></pattern>`,
    ...[...new Set(scene.links.map((link) => link.color))].map(
      (color, i) =>
        `<marker id="head${i}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">` +
        `<path d="M1 1L9 5L1 9z" fill="${color}"/></marker>`,
    ),
    `<filter id="soft" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="10" stdDeviation="14" flood-opacity="0.35"/></filter>`,
    '</defs>',
    `<rect x="${scene.originX}" y="${scene.originY}" width="${scene.width}" height="${scene.height}" fill="${scene.theme.bg}"/>`,
    `<rect x="${scene.originX}" y="${scene.originY}" width="${scene.width}" height="${scene.height}" fill="url(#dots)"/>`,
  ];
  const heads = [...new Set(scene.links.map((link) => link.color))];
  for (const link of scene.links) {
    parts.push(
      `<path d="${link.d}" fill="none" stroke="${link.color}" stroke-width="3" stroke-linecap="round" marker-end="url(#head${heads.indexOf(link.color)})"/>`,
    );
  }
  for (const rect of scene.rects) {
    parts.push(
      `<rect x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}" rx="${rect.r}" fill="${rect.fill}"${
        rect.shadow ? ' filter="url(#soft)"' : ''
      }${rect.edge ? ` stroke="${rect.edge}"` : ''}${
        rect.edgeWidth ? ` stroke-width="${rect.edgeWidth}"` : ''
      }/>`,
    );
  }
  for (const tail of scene.tails) {
    const [a, tip, b] = tail.points;
    const line = `M${a[0]} ${a[1]}L${tip[0]} ${tip[1]}L${b[0]} ${b[1]}`;
    parts.push(`<path d="${line}z" fill="${tail.fill}"/>`);
    if (tail.edge) {
      parts.push(`<path d="${line}" fill="none" stroke="${tail.edge}" stroke-linejoin="round"/>`);
    }
  }
  for (const text of scene.texts) {
    parts.push(
      `<text x="${text.x}" y="${text.y}" ${font(text.font)} fill="${text.fill}">${escapeXml(text.text)}</text>`,
    );
  }
  for (const link of scene.links) {
    if (!link.label) continue;
    measurer.font = `${style.bodyWeight} 13px "${style.bodyFont}"`;
    const width = measurer.measureText(link.label).width + 20;
    parts.push(
      `<rect x="${link.mid.x - width / 2}" y="${link.mid.y - 12}" width="${width}" height="24" rx="12" fill="${scene.theme.line}"/>`,
      `<text x="${link.mid.x}" y="${link.mid.y + 4.5}" text-anchor="middle" font-size="13" font-weight="${style.bodyWeight}" font-family="${style.bodyFont}" fill="${scene.theme.bg}">${escapeXml(link.label)}</text>`,
    );
  }
  parts.push('</svg>');
  return parts.join('');
};
