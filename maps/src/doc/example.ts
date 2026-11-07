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

const WORDS = {
  bg: {
    title: 'Бяла дъска — план',
    capture: 'Улавяне\nРисувам свободно с мишката\nПиша директно върху платното\nПървата черта без никакво забавяне',
    group: 'Групиране\nЛасо около няколко неща прави една група\nМестя блокове с влачене\nСкицата остава под всичко',
    digitize: 'AI дигитализация\nЧертите стават блокове и стрелки\nРъкописът става текст на български и английски\nAI предлага, аз приемам',
    finished: 'Готова карта\nПлан, по който Claude Code да строи\nМоя работна карта на проекта\nПрезентация за екип, клиенти и инвеститори',
    later: 'По-късно\nДигитална дъска с пръст и писалка\nСъщият код в браузъра на дъската',
    quote: '„Първо изваждам структурата от главата си възможно най-бързо. Подреждането идва чак после.“',
  },
  en: {
    title: 'Whiteboard: the plan',
    capture: "Capture\nDraw freely with the mouse\nType straight onto the canvas\nThe first stroke with no delay",
    group: "Group\nA lasso around a few things makes a group\nDrag blocks to move them\nThe sketch stays under everything",
    digitize: "AI digitizing\nStrokes become blocks and arrows\nHandwriting becomes text\nAI proposes, I accept",
    finished: "Finished map\nA plan Claude Code can build from\nMy working map of the project\nA presentation for team and clients",
    later: "Later\nA digital board with finger and pen\nThe same code in the board's browser",
    quote: "\"First get the structure out of my head as fast as possible. Tidying up comes later.\"",
  },
};

const note = (x: number, y: number, wrap: number, text: string): TextNote => {
  const lines = text.split('\n');
  const width = Math.max(...lines.map((line) => line.length)) * 7.4;
  const wrapped = lines.reduce((sum, line) => sum + Math.ceil((line.length * 7.4) / wrap), 0);
  return { id: newId(), x, y, text, w: Math.min(wrap, width), h: wrapped * 21, wrap };
};

/** The example speaks the computer's language: Bulgarian there, English everywhere else. */
const exampleLanguage = (): keyof typeof WORDS =>
  typeof navigator !== 'undefined' && navigator.language.startsWith('bg') ? 'bg' : 'en';

export const createExampleDoc = (language = exampleLanguage()): MapDoc => {
  const words = WORDS[language];
  const strokes: Stroke[] = EXAMPLE_SKETCH.map((d) => {
    const points = flattenPath(d);
    return { id: newId(), points, color: 'ink', width: 2.4, box: boxOfPoints(points) };
  });
  return {
    ...createDoc(words.title),
    isExample: true,
    strokes,
    texts: [
      note(
        86,
        84,
        245,
        words.capture,
      ),
      note(
        414,
        66,
        230,
        words.group,
      ),
      note(
        716,
        108,
        262,
        words.digitize,
      ),
      note(
        614,
        462,
        340,
        words.finished,
      ),
      note(112, 484, 255, words.later),
      note(
        240,
        334,
        330,
        words.quote,
      ),
    ],
  };
};
