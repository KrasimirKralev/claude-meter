import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DigitizeRequest, StreamEvent } from '../shared/digitize.ts';
import { createApp } from './app.ts';
import { claudeConfigDir, isolatedEnv } from './providers/claude-cli.ts';
import type { Provider } from './providers/types.ts';

const REQUEST: DigitizeRequest = { title: 'Map', bubbles: [], links: [], looseText: [] };

let server: Server | undefined;

const start = async (provider: Provider | null): Promise<string> => {
  const app = createApp(() => provider);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
};

afterEach(() => {
  server?.close();
  server = undefined;
});

const fake = (...chunks: string[]): Provider => ({
  name: 'Fake',
  async *stream() {
    yield* chunks;
  },
});

const digitize = async (base: string): Promise<StreamEvent[]> => {
  const response = await fetch(`${base}/api/digitize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(REQUEST),
  });
  const text = await response.text();
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as StreamEvent);
};

describe('POST /api/digitize', () => {
  it('rebuilds proposals split across chunks and drops bad lines', async () => {
    const base = await start(
      fake(
        '{"kind":"rename","bub',
        'ble":"a","title":"Нов"}\nHere is more:\n',
        '{"kind":"summary","text":"Кратко"}',
      ),
    );
    const events = await digitize(base);
    expect(events.map((e) => e.type)).toEqual(['start', 'proposal', 'proposal', 'done']);
    expect(events.at(-1)).toEqual({ type: 'done', proposals: 2, dropped: 1 });
  });

  it('keeps the proposals that arrived when the provider fails midway', async () => {
    const provider: Provider = {
      name: 'Fails',
      async *stream() {
        yield '{"kind":"summary","text":"Първо"}\n';
        throw new Error('boom');
      },
    };
    const events = await digitize(await start(provider));
    expect(events.map((e) => e.type)).toEqual(['start', 'proposal', 'error']);
    const error = events.at(-1) as Extract<StreamEvent, { type: 'error' }>;
    expect(error.code).toBe('failed');
    expect(error.message).not.toContain('boom');
  });

  it('says how to fix a Claude Code that is not logged in', async () => {
    const provider: Provider = {
      name: 'Claude Code',
      async *stream() {
        yield* [];
        throw new Error('Not logged in · Please run /login');
      },
    };
    const events = await digitize(await start(provider));
    const error = events.at(-1) as Extract<StreamEvent, { type: 'error' }>;
    expect(error.message).toContain('Run claude in a terminal');
  });

  it('explains how to connect AI when there is none', async () => {
    const events = await digitize(await start(null));
    expect(events[0]).toMatchObject({ type: 'error', code: 'no-provider' });
  });

  it('refuses a body that is not a map', async () => {
    const base = await start(fake());
    const response = await fetch(`${base}/api/digitize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"hello":1}',
    });
    expect(response.status).toBe(400);
  });

  it('refuses a form post, which a foreign website could send without a preflight', async () => {
    const base = await start(fake());
    const response = await fetch(`${base}/api/digitize`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(REQUEST),
    });
    expect(response.status).toBe(415);
  });
});

describe('with a token, as in the desktop app', () => {
  const startWithToken = async (): Promise<string> => {
    const app = createApp(() => fake(), 'secret');
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  };

  it.each([
    ['no token', {}],
    ['a wrong token', { 'X-Balonche-Token': 'wrong!' }],
    ['a token of another length', { 'X-Balonche-Token': 'secret-and-more' }],
  ])('refuses %s, so other programs cannot spend the AI', async (_name, headers) => {
    const base = await startWithToken();
    expect((await fetch(`${base}/api/health`, { headers })).status).toBe(401);
    const response = await fetch(`${base}/api/digitize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(REQUEST),
    });
    expect(response.status).toBe(401);
  });

  it('answers the page that has it', async () => {
    const base = await startWithToken();
    const response = await fetch(`${base}/api/health`, { headers: { 'X-Balonche-Token': 'secret' } });
    expect(response.status).toBe(200);
  });
});

describe('GET /api/health', () => {
  it('names the provider', async () => {
    const base = await start(fake());
    expect(await (await fetch(`${base}/api/health`)).json()).toMatchObject({ provider: 'Fake' });
  });
});

describe('isolatedEnv', () => {
  it('does not pass the desktop app\'s run-as-Node flag on to the command', () => {
    process.env.ELECTRON_RUN_AS_NODE = '1';
    try {
      expect(isolatedEnv().ELECTRON_RUN_AS_NODE).toBeUndefined();
    } finally {
      delete process.env.ELECTRON_RUN_AS_NODE;
    }
  });
});

describe('claudeConfigDir', () => {
  const folder = (): string => mkdtempSync(join(tmpdir(), 'balonche-test-'));
  const account = (): string => {
    const dir = folder();
    writeFileSync(join(dir, '.credentials.json'), '{}');
    return dir;
  };

  it('prefers the account a launcher chose, because a session folder can vanish', () => {
    const home = folder();
    const chosen = account();
    mkdirSync(join(home, '.claude'));
    writeFileSync(join(home, '.claude', 'active-account.json'), JSON.stringify({ dir: chosen }));
    expect(claudeConfigDir(home, { CLAUDE_CONFIG_DIR: account() })).toBe(chosen);
  });

  it('lets an explicit setting win', () => {
    const explicit = account();
    expect(claudeConfigDir(folder(), { BALONCHE_CLAUDE_CONFIG_DIR: explicit })).toBe(explicit);
  });

  it('skips a folder with no login, and leaves the default alone when nothing fits', () => {
    expect(claudeConfigDir(folder(), { CLAUDE_CONFIG_DIR: folder() })).toBeUndefined();
  });
});
