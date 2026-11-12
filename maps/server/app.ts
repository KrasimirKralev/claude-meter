import { timingSafeEqual } from 'node:crypto';
import express from 'express';
import type { Express, Request, Response } from 'express';
import { LineSplitter, parseAiLine } from '../shared/digitize.ts';
import type { DigitizeRequest, StreamEvent } from '../shared/digitize.ts';
import { selectProvider } from './providers/index.ts';
import type { Provider } from './providers/types.ts';

const TIMEOUT_MS = 30_000;
const LOCAL_HOST = /^(127\.0\.0\.1|localhost)(:\d+)?$/;

const tokenMatches = (sent: unknown, token: string): boolean => {
  if (typeof sent !== 'string') return false;
  const given = Buffer.from(sent);
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
};

const NO_PROVIDER_MESSAGE =
  'No AI is connected, so only the local pass ran. Install Claude Code, or put an Anthropic API ' +
  'key in ~/.config/balonche/anthropic-key.';

const isRequest = (body: unknown): body is DigitizeRequest => {
  if (typeof body !== 'object' || body === null) return false;
  const r = body as Partial<DigitizeRequest>;
  return (
    typeof r.title === 'string' &&
    Array.isArray(r.bubbles) &&
    Array.isArray(r.links) &&
    Array.isArray(r.looseText) &&
    (r.image === undefined || typeof r.image === 'string')
  );
};

const friendlyError = (error: unknown): string => {
  const status = (error as { status?: number }).status;
  if (error instanceof Error && /not logged in/i.test(error.message)) {
    return 'Claude Code is not logged in. Run claude in a terminal once to log in, then try again.';
  }
  if (status === 401) return 'The AI key was refused. Check ~/.config/balonche/anthropic-key.';
  if (status === 429) return 'The AI is rate limited right now. Try again in a minute.';
  return 'The AI request failed. Your sketch and the local map are safe. Try again.';
};

/** With a token, as in the desktop app, every API call must carry it. */
export const createApp = (
  getProvider: () => Provider | null = selectProvider,
  token?: string,
): Express => {
  const app = express();
  let cached: { provider: Provider | null } | null = null;
  const provider = (): Provider | null => (cached ??= { provider: getProvider() }).provider;

  // This server can spend an AI key, so only this computer's own page may call it. The host check
  // stops DNS rebinding. Requiring JSON forces a browser preflight that other sites cannot pass.
  app.use('/api', (req, res, next) => {
    if (!LOCAL_HOST.test(req.headers.host ?? '')) {
      res.status(403).json({ error: 'Local use only.' });
      return;
    }
    // The checks above only stop web pages. This also stops other programs on the computer.
    if (token && !tokenMatches(req.headers['x-balonche-token'], token)) {
      res.status(401).json({ error: 'Not allowed.' });
      return;
    }
    if (req.method === 'POST' && !req.is('application/json')) {
      res.status(415).json({ error: 'JSON only.' });
      return;
    }
    next();
  });
  app.use('/api', express.json({ limit: '25mb' }));

  app.get('/api/health', (_req, res) => {
    const current = provider();
    res.json({ ok: true, provider: current?.name ?? null, model: current?.model ?? null });
  });

  app.post('/api/digitize', async (req: Request, res: Response) => {
    if (!isRequest(req.body)) {
      res.status(400).json({ error: 'That request is not a map.' });
      return;
    }
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Accel-Buffering', 'no');
    const send = (event: StreamEvent): void => {
      res.write(`${JSON.stringify(event)}\n`);
    };

    const current = provider();
    if (!current) {
      send({ type: 'error', code: 'no-provider', message: NO_PROVIDER_MESSAGE });
      res.end();
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('timeout')), TIMEOUT_MS);
    res.on('close', () => {
      if (!res.writableEnded) controller.abort(new Error('client left'));
    });

    send({ type: 'start', provider: current.name, model: current.model });
    let proposals = 0;
    let dropped = 0;
    const handleLine = (line: string): void => {
      if (!line.trim()) return;
      const proposal = parseAiLine(line);
      if (proposal) {
        proposals += 1;
        send({ type: 'proposal', proposal });
      } else {
        dropped += 1;
        console.warn('Dropped a line from the model:', line.slice(0, 200));
      }
    };

    try {
      const splitter = new LineSplitter();
      for await (const chunk of current.stream(req.body, controller.signal)) {
        splitter.push(chunk).forEach(handleLine);
      }
      // Some providers just end their stream when aborted, which must not read as a success.
      controller.signal.throwIfAborted();
      splitter.flush().forEach(handleLine);
      send({ type: 'done', proposals, dropped });
    } catch (error) {
      if (controller.signal.reason instanceof Error && controller.signal.reason.message === 'timeout') {
        send({
          type: 'error',
          code: 'timeout',
          message: 'The AI took more than 30 seconds, so it was stopped. Try again.',
        });
      } else if (!controller.signal.aborted) {
        console.error('Digitize failed', error);
        send({ type: 'error', code: 'failed', message: friendlyError(error) });
      }
    } finally {
      clearTimeout(timer);
      res.end();
    }
  });

  return app;
};
