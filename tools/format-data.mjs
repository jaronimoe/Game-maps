#!/usr/bin/env node
// Rewrites every data file in the canonical layout (one item per line), the same
// layout the in-browser editor exports. Usage: node tools/format-data.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatDataset } from '../assets/js/format.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { games } = JSON.parse(readFileSync(join(root, 'games/index.json'), 'utf8'));

for (const game of games) {
  const gameDir = join(root, game.path);
  const config = JSON.parse(readFileSync(join(gameDir, 'game.json'), 'utf8'));
  for (const file of config.data) {
    const path = join(gameDir, file);
    const before = readFileSync(path, 'utf8');
    const after = formatDataset(JSON.parse(before));
    if (before !== after) {
      writeFileSync(path, after);
      console.log(`formatted ${relative(root, path)}`);
    }
  }
}
