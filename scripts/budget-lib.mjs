// The performance budget: where the limits live, how the app is measured, and how the two are compared.
// Used by scripts/measure.mjs (prints the table) and tests/budget.test.js (fails the build when a limit is passed).
// No dependencies; nothing here touches the network.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { resolve } from '../js/router.js';
import { renderRoute } from '../js/views.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BUDGET_FILE = path.join(ROOT, 'scripts', 'budget.json');

/** A problem the person running the check can fix (bad budget file, broken service worker list). Not a crash. */
export class BudgetError extends Error {}

const LIMIT_KEYS = ['firstLoadGzipKb', 'precacheGzipKb', 'largestFileGzipKb', 'renderMs'];
const kb = (bytes) => bytes / 1024;
const fmt = (n) => `${n.toFixed(1)} KB`;

/** Check the budget file's text and return the budget. Throws BudgetError that names exactly what is wrong. */
export function parseBudget(text, where = 'the budget file') {
  let budget;
  try {
    budget = JSON.parse(text);
  } catch (err) {
    throw new BudgetError(`${where} is not valid JSON (${err.message}).`);
  }
  if (!budget || typeof budget !== 'object' || Array.isArray(budget)) throw new BudgetError(`${where} must hold one JSON object.`);
  for (const key of LIMIT_KEYS) {
    const value = budget[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new BudgetError(`${where}: "${key}" must be a number above 0 (found ${JSON.stringify(value)}).`);
    }
  }
  const history = budget.history;
  if (!Array.isArray(history) || history.length === 0) {
    throw new BudgetError(`${where}: "history" must list every limit that was set, with the step and the reason.`);
  }
  history.forEach((entry, i) => {
    if (!entry || typeof entry.step !== 'number') throw new BudgetError(`${where}: history entry ${i + 1} needs a "step" number.`);
    if (typeof entry.reason !== 'string' || entry.reason.trim().length < 10) {
      throw new BudgetError(`${where}: history entry for step ${entry.step} needs a "reason" (at least a short sentence).`);
    }
  });
  const last = history[history.length - 1];
  for (const key of LIMIT_KEYS) {
    if (last[key] !== undefined && last[key] !== budget[key]) {
      throw new BudgetError(
        `${where}: "${key}" is ${budget[key]} but the latest history entry (step ${last.step}) says ${last[key]}. ` +
          'A limit may be changed, but the change has to be written down: add a history entry with the step and the reason.',
      );
    }
  }
  for (const key of ['firstLoadGzipKb', 'precacheGzipKb']) {
    if (last[key] === undefined) throw new BudgetError(`${where}: the latest history entry must state "${key}".`);
  }
  return budget;
}

export async function loadBudget(file = BUDGET_FILE) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    throw new BudgetError(`The budget file ${file} could not be read (${err.code ?? err.message}).`);
  }
  return parseBudget(text, path.basename(file));
}

/** The files the service worker saves, as paths: index.html first, nothing twice. */
export function shellFiles(swSource) {
  const block = /const SHELL = \[([\s\S]*?)\];/.exec(swSource)?.[1];
  if (!block) throw new BudgetError('sw.js has no "const SHELL = [ ... ]" list, so there is nothing to measure.');
  const listed = [...block.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean); // './' alone is index.html
  return [...new Set(['index.html', ...listed])];
}

const isFirstLoad = (file) => /\.(html|css|js|svg)$/.test(file);

/** Size of every saved file, raw and gzip. */
export async function measureShell(root = ROOT) {
  let swSource;
  try {
    swSource = await readFile(path.join(root, 'sw.js'), 'utf8');
  } catch {
    throw new BudgetError(`sw.js could not be read in ${root}.`);
  }
  const files = [];
  for (const file of shellFiles(swSource)) {
    let buffer;
    try {
      buffer = await readFile(path.join(root, file));
    } catch {
      throw new BudgetError(`sw.js saves ./${file} but that file does not exist.`);
    }
    files.push({ file, raw: buffer.length, gz: gzipSync(buffer).length, firstLoad: isFirstLoad(file) });
  }
  const sum = (list, key) => list.reduce((total, f) => total + f[key], 0);
  const first = files.filter((f) => f.firstLoad);
  const largest = files.reduce((a, b) => (b.gz > a.gz ? b : a));
  return {
    files,
    firstLoadGz: sum(first, 'gz'),
    firstLoadRaw: sum(first, 'raw'),
    precacheGz: sum(files, 'gz'),
    precacheRaw: sum(files, 'raw'),
    largest,
  };
}

export const RENDER_ROUTES = ['#/', '#/jobs', '#/jobs/SG-1042', '#/quote', '#/inventory', '#/reports', '#/offline', '#/install', '#/nope'];

/** Average time to build each screen's HTML. */
export function measureRender(runs = 200, routes = RENDER_ROUTES) {
  const perRoute = routes.map((hash) => {
    const route = resolve(hash);
    const start = performance.now();
    for (let i = 0; i < runs; i++) renderRoute(route);
    return { hash, avgMs: (performance.now() - start) / runs };
  });
  return { perRoute, worstMs: Math.max(...perRoute.map((r) => r.avgMs)) };
}

/**
 * Compare a measurement with the budget. Returns one row per limit: { id, label, pass, value, left, hint }.
 * A value exactly at the limit passes. `left` is the room remaining (negative when over).
 */
export function checkBudget(shell, renderWorstMs, budget) {
  const biggestOf = (files) => [...files].sort((a, b) => b.gz - a.gz).slice(0, 3).map((f) => `${f.file} ${fmt(kb(f.gz))}`).join(', ');
  const raise = ' To keep this growth on purpose, raise the limit in scripts/budget.json and add a history entry saying why.';
  const rows = [];
  const add = (id, label, valueKb, limit, hintWhenOver, unit = 'KB') => {
    const pass = valueKb <= limit;
    rows.push({ id, label, pass, value: `${valueKb.toFixed(unit === 'ms' ? 3 : 1)} ${unit}`, left: limit - valueKb, hint: pass ? '' : hintWhenOver });
  };
  add('first-load', `first load <= ${budget.firstLoadGzipKb} KB gzip`, kb(shell.firstLoadGz), budget.firstLoadGzipKb,
    `Over the limit for what a new visitor must download. Biggest files: ${biggestOf(shell.files.filter((f) => f.firstLoad))}.${raise}`);
  add('precache', `offline copy <= ${budget.precacheGzipKb} KB gzip`, kb(shell.precacheGz), budget.precacheGzipKb,
    `Over the limit for what is saved on the phone. Biggest files: ${biggestOf(shell.files)}.${raise}`);
  add('largest-file', `largest file <= ${budget.largestFileGzipKb} KB gzip`, kb(shell.largest.gz), budget.largestFileGzipKb,
    `${shell.largest.file} is the largest file and is over the limit: split it into smaller modules.${raise}`);
  add('render', `slowest screen <= ${budget.renderMs} ms`, renderWorstMs, budget.renderMs,
    'A screen takes too long to build its HTML; look for a loop that runs more often than it should.', 'ms');
  return rows;
}
