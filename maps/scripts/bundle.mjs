// Packs the finished page and server into build/ for the desktop app. Electron 33 ships Node 20, which
// can't run the server's TypeScript directly, so the server becomes plain JavaScript here.
import { cpSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'rolldown';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'build');

rmSync(out, { recursive: true, force: true });
await build({
  input: join(root, 'server', 'index.ts'),
  platform: 'node',
  output: {
    dir: join(out, 'server'),
    format: 'esm',
    entryFileNames: 'index.mjs',
    chunkFileNames: '[name]-[hash].mjs',
  },
});
cpSync(join(root, 'dist'), join(out, 'dist'), { recursive: true });
console.log(`Maps bundled into ${out}`);
