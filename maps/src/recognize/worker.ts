import { recognize } from './recognize.ts';
import type { InStroke, InText } from './recognize.ts';

self.onmessage = (event: MessageEvent<{ id: number; strokes: InStroke[]; texts: InText[] }>) => {
  const { id, strokes, texts } = event.data;
  try {
    self.postMessage({ id, result: recognize(strokes, texts) });
  } catch (error) {
    self.postMessage({ id, error: String(error) });
  }
};
