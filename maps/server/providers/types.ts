import type { DigitizeRequest } from '../../shared/digitize.ts';

export interface Provider {
  name: string;
  model?: string;
  /** Yields raw model text. Lines may be split across chunks. */
  stream(request: DigitizeRequest, signal: AbortSignal): AsyncIterable<string>;
}
