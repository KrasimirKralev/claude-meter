#!/usr/bin/env node
'use strict';
// Builds the Maps app in maps/ into maps/build/ for packaging. It has its own dependencies, so React
// and Vite stay out of the desktop app's own package.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const source = path.join(__dirname, '..', 'maps');
// On Windows, npm is a .cmd file, which only a shell can start.
const run = (args) => execFileSync('npm', args, { cwd: source, stdio: 'inherit', shell: process.platform === 'win32' });

if (!fs.existsSync(path.join(source, 'node_modules'))) run(['install', '--no-audit', '--no-fund']);
run(['run', 'bundle']);
