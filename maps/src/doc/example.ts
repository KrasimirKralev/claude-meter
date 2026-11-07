import { EXAMPLE_SKETCH } from './example-sketch.ts';
import { boxOfPoints, createDoc, newId } from './ops.ts';
import type { MapDoc, Stroke, TextNote } from './types.ts';

/** Flattens the M, Q and L commands the example sketch uses into stroke points. */
export const flattenPath = (d: string): Float32Array => {
  const numbers: number[] = [];
  const tokens = d.match(/[MQL]|-?\d+(?:\.\d+)?/g) ?? [];
  let i = 0;
  let x = 0;
  let y = 0;
  const push = (px: number, py: number) => numbers.push(px, py, 0.5);
  while (i < tokens.length) {
    const command = tokens[i];
    i += 1;
    if (command === 'M' || command === 'L') {
      x = Number(tokens[i]);
      y = Number(tokens[i + 1]);
      i += 2;
      push(x, y);
    } else if (command === 'Q') {
      const cx = Number(tokens[i]);
      const cy = Number(tokens[i + 1]);
      const ex = Number(tokens[i + 2]);
      const ey = Number(tokens[i + 3]);
      i += 4;
      for (let t = 0.25; t <= 1; t += 0.25) {
        const u = 1 - t;
        push(u * u * x + 2 * u * t * cx + t * t * ex, u * u * y + 2 * u * t * cy + t * t * ey);
      }
      x = ex;
      y = ey;
    }
  }
  return Float32Array.from(numbers);
};

const note = (x: number, y: number, wrap: number, text: string): TextNote => {
  const lines = text.split('\n');
  const width = Math.max(...lines.map((line) => line.length)) * 7.4;
  const wrapped = lines.reduce((sum, line) => sum + Math.ceil((line.length * 7.4) / wrap), 0);
  return { id: newId(), x, y, text, w: Math.min(wrap, width), h: wrapped * 21, wrap };
};

export const createExampleDoc = (): MapDoc => {
  const strokes: Stroke[] = EXAMPLE_SKETCH.map((d) => {
    const points = flattenPath(d);
    return { id: newId(), points, color: 'ink', width: 2.4, box: boxOfPoints(points) };
  });
  return {
    ...createDoc('Бяла дъска — план'),
    isExample: true,
    strokes,
    texts: [
      note(
        86,
        84,
        245,
        'Улавяне\nРисувам свободно с мишката\nПиша директно върху платното\nПървата черта без никакво забавяне',
      ),
      note(
        414,
        66,
        230,
        'Групиране\nЛасо около няколко неща прави една група\nМестя блокове с влачене\nСкицата остава под всичко',
      ),
      note(
        716,
        108,
        262,
        'AI дигитализация\nЧертите стават блокове и стрелки\nРъкописът става текст на български и английски\nAI предлага, аз приемам',
      ),
      note(
        614,
        462,
        340,
        'Готова карта\nПлан, по който Claude Code да строи\nМоя работна карта на проекта\nПрезентация за екип, клиенти и инвеститори',
      ),
      note(112, 484, 255, 'По-късно\nДигитална дъска с пръст и писалка\nСъщият код в браузъра на дъската'),
      note(
        240,
        334,
        330,
        '„Първо изваждам структурата от главата си възможно най-бързо. Подреждането идва чак после.“',
      ),
    ],
  };
};
