// Replays canned proposals for the browser tests, with real pauses so streaming can be observed.

import type { Provider } from './types.ts';

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const createFakeProvider = (): Provider => ({
  name: 'Test AI',
  async *stream(request) {
    const first = request.bubbles.find((b) => b.kind === 'group');
    await pause(150);
    yield '{"kind":"summary","text":"Кратко описание на картата."}\n';
    await pause(100);
    yield 'This line is not JSON and must be dropped.\n';
    if (first) {
      yield `{"kind":"rename","bubble":"${first.id}","ti`;
      await pause(50);
      yield `tle":"${first.title} (AI)"}\n`;
      yield '{"kind":"rename","bubble":"does-not-exist","title":"ignored"}\n';
    }
    if (first?.title.includes('FAIL-MIDWAY')) throw new Error('simulated failure');
  },
});
