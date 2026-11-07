import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createAnthropicProvider } from './anthropic.ts';
import { createClaudeCliProvider } from './claude-cli.ts';
import { createFakeProvider } from './fake.ts';
import type { Provider } from './types.ts';

const KEY_FILE = join(homedir(), '.config', 'balonche', 'anthropic-key');
const API_MODEL = 'claude-opus-5-5';
// Fastest of the three when timed on the example map, with the same quality as Opus there.
const CLI_MODEL = 'claude-sonnet-5-5';

const readKey = (): string | null => {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try {
    if ((statSync(KEY_FILE).mode & 0o077) !== 0) {
      console.warn(`${KEY_FILE} is readable by others. Run: chmod 600 ${KEY_FILE}`);
    }
    return readFileSync(KEY_FILE, 'utf8').trim() || null;
  } catch {
    return null;
  }
};

const findClaudeCommand = (): string | null => {
  try {
    return execFileSync('which', ['claude'], { encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
};

/** API key first, then the installed Claude Code command, then local-only. */
export const selectProvider = (): Provider | null => {
  const choice = process.env.BALONCHE_PROVIDER;
  if (choice === 'none') return null;
  if (choice === 'fake') return createFakeProvider();
  const model = process.env.BALONCHE_MODEL;
  if (choice !== 'claude-cli') {
    const key = readKey();
    if (key) return createAnthropicProvider(key, model ?? API_MODEL);
    if (choice === 'anthropic') return null;
  }
  const command = findClaudeCommand();
  return command ? createClaudeCliProvider(command, model ?? CLI_MODEL) : null;
};
