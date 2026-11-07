// Uses the Claude Code command already installed on this computer, so Digitize works without an
// API key. It runs one short, tool-free request per click.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { buildUserPrompt, SYSTEM_PROMPT } from '../prompt.ts';
import type { Provider } from './types.ts';

interface CliEvent {
  type?: string;
  is_error?: boolean;
  result?: string;
  event?: { type?: string; delta?: { type?: string; text?: string } };
}

/** How long a stopped process gets to exit by itself before it is killed outright. */
const KILL_AFTER_MS = 2000;

const isLoggedIn = (dir: string): boolean => existsSync(join(dir, '.credentials.json'));

/**
 * Which Claude Code login to use. This server can outlive the terminal it started from, so a config
 * folder that belongs to one running session is the last choice. With a multi-account launcher, the account
 * it chose most recently is the one known to have room left. It is read on every request, so this
 * follows the launcher when it moves on to another account.
 */
export const claudeConfigDir = (home = homedir(), env = process.env): string | undefined => {
  const candidates: (string | undefined)[] = [env.BALONCHE_CLAUDE_CONFIG_DIR];
  try {
    const active = JSON.parse(
      readFileSync(join(home, '.claude', 'active-account.json'), 'utf8'),
    ) as { dir?: string };
    candidates.push(active.dir);
  } catch {
    // No launcher here, which is the normal case.
  }
  candidates.push(env.CLAUDE_CONFIG_DIR);
  // Set by the desktop app: its account with the most room, for when nothing above is logged in.
  candidates.push(env.BALONCHE_FALLBACK_CONFIG_DIR);
  return candidates.find((dir): dir is string => Boolean(dir) && isLoggedIn(dir as string));
};

/**
 * This is a one-shot text request, not a coding session. An empty working folder and these settings
 * keep your hooks, plugins, memory and project instructions out of it, which also starts it faster.
 */
export const isolatedEnv = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1',
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
  };
  // These mark a parent Claude Code session, which would refuse a nested one.
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.CLAUDE_CODE_PLUGIN_DIRS;
  // Set for this server when the desktop app starts it. It must not reach anything this runs.
  delete env.ELECTRON_RUN_AS_NODE;
  const configDir = claudeConfigDir();
  if (configDir) env.CLAUDE_CONFIG_DIR = configDir;
  return env;
};

const emptyFolder = (): string => {
  const folder = join(homedir(), '.cache', 'balonche', 'empty');
  mkdirSync(folder, { recursive: true });
  return folder;
};

export const createClaudeCliProvider = (command: string, model: string): Provider => ({
  name: 'Claude Code',
  model,
  async *stream(request, signal) {
    const child = spawn(
      command,
      [
        '-p',
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        '--verbose',
        '--include-partial-messages',
        '--no-session-persistence',
        '--strict-mcp-config',
        '--setting-sources',
        '',
        '--settings',
        '{"disableAllHooks":true}',
        '--tools',
        '',
        '--effort',
        'low',
        '--model',
        model,
        '--system-prompt',
        SYSTEM_PROMPT,
      ],
      { env: isolatedEnv(), cwd: emptyFolder(), stdio: ['pipe', 'pipe', 'pipe'], signal },
    );
    const stderr: string[] = [];
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk.toString()));
    const exited = new Promise<number | null>((resolve) => {
      child.on('close', (code) => resolve(code));
      child.on('error', () => resolve(null));
    });

    const content: unknown[] = [];
    if (request.image) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: request.image },
      });
    }
    content.push({ type: 'text', text: buildUserPrompt(request) });
    child.stdin.on('error', () => undefined);
    child.stdin.end(
      `${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`,
    );

    const forceStop = (): void => {
      setTimeout(() => child.kill('SIGKILL'), KILL_AFTER_MS).unref();
    };
    signal.addEventListener('abort', forceStop, { once: true });

    let streamed = false;
    try {
      for await (const line of createInterface({ input: child.stdout })) {
        let event: CliEvent;
        try {
          event = JSON.parse(line) as CliEvent;
        } catch {
          continue;
        }
        const delta = event.event?.delta;
        if (event.type === 'stream_event' && delta?.type === 'text_delta' && delta.text) {
          streamed = true;
          yield delta.text;
        } else if (event.type === 'result') {
          if (event.is_error) throw new Error(event.result ?? 'Claude Code reported an error.');
          if (!streamed && event.result) yield event.result;
        }
      }
      const code = await exited;
      if (code !== 0 && !signal.aborted) {
        throw new Error(`Claude Code exited with code ${code}: ${stderr.join('').slice(0, 400)}`);
      }
    } finally {
      // Also runs when the request ends early, so a stopped map never leaves a process behind.
      signal.removeEventListener('abort', forceStop);
      if (child.exitCode === null) {
        child.kill();
        forceStop();
      }
    }
  },
});
