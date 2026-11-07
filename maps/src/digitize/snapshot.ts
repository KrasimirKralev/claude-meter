// A plain black-on-white picture of the sketch for the model. Sent only when the local pass found
// marks it could not read, so typed maps stay fast.

import { unionBoxes } from '../doc/ops.ts';
import type { Id, MapDoc } from '../doc/types.ts';

const MAX_SIDE = 1400;
const MARGIN = 24;

export const snapshotSketch = (
  doc: MapDoc,
  scope: { strokes: ReadonlySet<Id>; texts: ReadonlySet<Id> } | null,
): string | undefined => {
  const strokes = scope ? doc.strokes.filter((s) => scope.strokes.has(s.id)) : doc.strokes;
  const texts = scope ? doc.texts.filter((t) => scope.texts.has(t.id)) : doc.texts;
  const box = unionBoxes([
    ...strokes.map((s) => s.box),
    ...texts.map((t) => ({ x: t.x, y: t.y, w: t.w, h: t.h })),
  ]);
  if (!box) return undefined;
  const scale = Math.min(MAX_SIDE / box.w, MAX_SIDE / box.h, 2);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((box.w + MARGIN * 2) * scale);
  canvas.height = Math.ceil((box.h + MARGIN * 2) * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, (MARGIN - box.x) * scale, (MARGIN - box.y) * scale);
  ctx.strokeStyle = '#000';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const stroke of strokes) {
    const p = stroke.points;
    ctx.lineWidth = Math.max(2, stroke.width);
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    for (let i = 3; i < p.length; i += 3) ctx.lineTo(p[i], p[i + 1]);
    ctx.stroke();
  }
  ctx.fillStyle = '#000';
  ctx.font = '15px "Inter Variable", sans-serif';
  for (const text of texts) {
    text.text.split('\n').forEach((line, index) => {
      ctx.fillText(line, text.x, text.y + 16 + index * 21);
    });
  }
  return canvas.toDataURL('image/png').split(',')[1];
};
