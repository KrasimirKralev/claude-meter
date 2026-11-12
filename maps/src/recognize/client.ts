import { recognize } from './recognize.ts';
import type { InStroke, InText, Recognition } from './recognize.ts';

let worker: Worker | null = null;
let nextId = 0;

const getWorker = (): Worker | null => {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  } catch (error) {
    console.warn('Recognizer worker unavailable, running on the main thread', error);
  }
  return worker;
};

export const recognizeInWorker = (strokes: InStroke[], texts: InText[]): Promise<Recognition> => {
  const target = getWorker();
  if (!target) return Promise.resolve().then(() => recognize(strokes, texts));
  nextId += 1;
  const id = nextId;
  return new Promise((resolve, reject) => {
    const finish = (): void => {
      target.removeEventListener('message', onMessage);
      target.removeEventListener('error', onFailure);
      target.removeEventListener('messageerror', onFailure);
    };
    // A worker that fails to load or crashes must not leave Digitize waiting forever.
    const onFailure = (event: Event): void => {
      console.warn('Recognizer worker failed, running on the main thread', event);
      finish();
      worker = null;
      try {
        resolve(recognize(strokes, texts));
      } catch (error) {
        reject(error);
      }
    };
    const onMessage = (event: MessageEvent<{ id: number; result?: Recognition; error?: string }>) => {
      if (event.data.id !== id) return;
      finish();
      if (event.data.result) resolve(event.data.result);
      else reject(new Error(event.data.error ?? 'The recognizer failed'));
    };
    target.addEventListener('message', onMessage);
    target.addEventListener('error', onFailure);
    target.addEventListener('messageerror', onFailure);
    target.postMessage({ id, strokes, texts });
  });
};
