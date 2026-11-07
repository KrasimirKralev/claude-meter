#!/usr/bin/env node
'use strict';
// Copies the finished Balonche app into balonche/ for packaging. Balonche keeps its own folder and
// balonche/ is never committed. With no source folder this does nothing, and the Maps button stays
// hidden in that build.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const source = process.env.BALONCHE_SRC || path.join(root, '..', 'whiteboard-app');
const out = path.join(root, 'balonche');

if (!fs.existsSync(path.join(source, 'package.json'))) {
  console.log(`No Balonche source at ${source}. This build will have no Maps button.`);
  process.exit(0);
}

const run = (command, args) => execFileSync(command, args, { cwd: source, stdio: 'inherit' });

run('npm', ['run', 'build']);
fs.rmSync(out, { recursive: true, force: true });
// Electron 33 ships Node 20, which can't run the server's TypeScript directly.
run(path.join(source, 'node_modules', '.bin', 'rolldown'), [
  'server/index.ts',
  '--platform', 'node',
  '--format', 'esm',
  '--dir', path.join(out, 'server'),
  '--entry-file-names', 'index.mjs',
  '--chunk-file-names', '[name]-[hash].mjs',
]);
fs.cpSync(path.join(source, 'dist'), path.join(out, 'dist'), { recursive: true });
console.log(`Balonche bundled into ${out}`);
