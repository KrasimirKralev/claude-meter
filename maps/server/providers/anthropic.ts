import Anthropic from '@anthropic-ai/sdk';
import { buildUserPrompt, SYSTEM_PROMPT } from '../prompt.ts';
import type { Provider } from './types.ts';

export const createAnthropicProvider = (apiKey: string, model: string): Provider => {
  const client = new Anthropic({ apiKey });
  return {
    name: 'Claude API',
    model,
    async *stream(request, signal) {
      const content: Anthropic.Beta.BetaContentBlockParam[] = [];
      if (request.image) {
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: request.image },
        });
      }
      content.push({ type: 'text', text: buildUserPrompt(request) });
      const stream = client.beta.messages.stream(
        {
          model,
          max_tokens: 8000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          // Thinking cannot be turned off on this model. Low effort keeps the first line quick.
          output_config: { effort: 'low' },
          system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content }],
        },
        { signal },
      );
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield event.delta.text;
        }
      }
      const message = await stream.finalMessage();
      if (message.stop_reason === 'refusal') {
        throw new Error('The model declined this map.');
      }
    },
  };
};
