#!/usr/bin/env node
// Validates every game listed in games/index.json: config shape, data files,
// unique ids, coordinates inside the map, cross references and file formatting.
// Usage: node tools/validate.mjs

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatDataset } from '../assets/js/format.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ICONS = new Set(['key', 'quest', 'locker', 'pin', 'star']);
const errors = [];
const warnings = [];
const rel = (p) => relative(root, p);

function readJSON(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    errors.push(`${rel(path)}: ${err.message}`);
    return null;
  }
}

function uniqueIds(list, where) {
  const seen = new Set();
  for (const entry of list) {
    if (typeof entry?.id !== 'string' || !entry.id) errors.push(`${where}: entry without an id`);
    else if (seen.has(entry.id)) errors.push(`${where}: duplicate id "${entry.id}"`);
    seen.add(entry?.id);
  }
  return seen;
}

function validateGame(game) {
  const gameDir = join(root, game.path);
  const configPath = join(gameDir, 'game.json');
  const config = readJSON(configPath);
  if (!config) return 0;
  const where = rel(configPath);

  if (config.id !== game.id) errors.push(`${where}: id "${config.id}" does not match games/index.json ("${game.id}")`);
  for (const key of ['title', 'maps', 'groups', 'categories', 'data']) {
    if (config[key] == null) errors.push(`${where}: missing "${key}"`);
  }
  if (errors.length) return 0;

  const mapIds = uniqueIds(config.maps, `${where} maps`);
  const maps = new Map(config.maps.map((m) => [m.id, m]));
  for (const m of config.maps) {
    if (!(m.width > 0 && m.height > 0)) errors.push(`${where}: map "${m.id}" needs positive width and height`);
    if (!m.image || !existsSync(join(gameDir, m.image))) errors.push(`${where}: map "${m.id}" image not found (${m.image})`);
  }

  const groupIds = uniqueIds(config.groups, `${where} groups`);
  const catIds = uniqueIds(config.categories, `${where} categories`);
  for (const c of config.categories) {
    if (!groupIds.has(c.group)) errors.push(`${where}: category "${c.id}" has unknown group "${c.group}"`);
    if (!/^#[0-9a-f]{3,8}$/i.test(c.color ?? '')) errors.push(`${where}: category "${c.id}" needs a hex color`);
    if (c.icon && !ICONS.has(c.icon)) warnings.push(`${where}: category "${c.id}" icon "${c.icon}" is unknown, a dot will be used`);
  }

  const allIds = new Set();
  const items = [];
  for (const file of config.data) {
    const path = join(gameDir, file);
    if (!existsSync(path)) {
      errors.push(`${where}: data file not found (${file})`);
      continue;
    }
    const data = readJSON(path);
    if (!data) continue;
    const dwhere = rel(path);
    if (!Array.isArray(data.items)) {
      errors.push(`${dwhere}: "items" must be an array`);
      continue;
    }
    if (readFileSync(path, 'utf8') !== formatDataset(data)) {
      errors.push(`${dwhere}: not in canonical format, run "npm run format"`);
    }
    for (const item of data.items) {
      const iwhere = `${dwhere} → ${item.id ?? '(no id)'}`;
      if (typeof item.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(item.id)) {
        errors.push(`${iwhere}: id must be lowercase letters, digits and dashes`);
      } else if (allIds.has(item.id)) {
        errors.push(`${iwhere}: duplicate id (ids must be unique across the whole game)`);
      }
      allIds.add(item.id);
      if (!item.name) errors.push(`${iwhere}: missing "name"`);

      const category = item.category ?? data.category;
      if (!catIds.has(category)) errors.push(`${iwhere}: unknown category "${category}"`);
      const mapId = item.map ?? data.map ?? config.maps[0].id;
      if (!mapIds.has(mapId)) errors.push(`${iwhere}: unknown map "${mapId}"`);

      const hasX = item.x != null;
      const hasY = item.y != null;
      if (hasX !== hasY) errors.push(`${iwhere}: set both x and y, or neither`);
      if (hasX && hasY) {
        const m = maps.get(mapId);
        if (!Number.isFinite(item.x) || !Number.isFinite(item.y)) errors.push(`${iwhere}: x/y must be numbers`);
        else if (m && (item.x < 0 || item.y < 0 || item.x > m.width || item.y > m.height)) {
          errors.push(`${iwhere}: (${item.x}, ${item.y}) is outside map "${mapId}" (${m.width}x${m.height})`);
        }
      }
      items.push({ ...item, category, iwhere });
    }
  }

  // Cross references: an item can say it is the reward of substory N.
  const substoryNumbers = new Set(items.filter((i) => i.category === 'substory').map((i) => i.number));
  for (const item of items) {
    const n = item.requires?.substory;
    if (n == null) continue;
    if (!Number.isInteger(n)) errors.push(`${item.iwhere}: requires.substory must be an integer`);
    else if (substoryNumbers.size && !substoryNumbers.has(n)) warnings.push(`${item.iwhere}: refers to substory #${n}, which has no entry yet`);
  }
  for (const item of items.filter((i) => i.category === 'substory')) {
    if (!Number.isInteger(item.number)) errors.push(`${item.iwhere}: substories need an integer "number"`);
  }

  return items.length;
}

const index = readJSON(join(root, 'games/index.json'));
let total = 0;
for (const game of index?.games ?? []) total += validateGame(game);

for (const w of warnings) console.warn(`warning: ${w}`);
for (const e of errors) console.error(`error: ${e}`);
if (errors.length) {
  console.error(`\n${errors.length} error(s)`);
  process.exit(1);
}
console.log(`OK: ${index.games.length} game(s), ${total} item(s)${warnings.length ? `, ${warnings.length} warning(s)` : ''}`);
