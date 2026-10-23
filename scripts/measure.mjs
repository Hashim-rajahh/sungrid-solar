// Measures the app shell so claims in the README are numbers, not guesses.
//   1. Size of every precached file (raw and gzip) against a budget.
//   2. Time to render every view as HTML (average over many runs).
// Exit code 1 if a budget is exceeded, so it can run in CI.
// Usage: node scripts/measure.mjs

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { resolve } from '../js/router.js';
import { renderRoute } from '../js/views.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Two budgets, because they protect different things:
//  - FIRST LOAD: what a new visitor must download before the app is usable (HTML, CSS, JS, favicon).
//  - PRECACHE:   everything saved for offline use, including install icons that are only fetched on demand.
const BUDGET_FIRST_LOAD_GZIP_KB = 25;
const BUDGET_PRECACHE_GZIP_KB = 40;
const BUDGET_RENDER_MS = 5; // average per view
const isFirstLoad = (f) => /\.(html|css|js|svg)$/.test(f);

const sw = await readFile(path.join(root, 'sw.js'), 'utf8');
const shellBlock = /const SHELL = \[([\s\S]*?)\];/.exec(sw)?.[1] ?? '';
const files = [...shellBlock.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean);
files.unshift('index.html'); // './' is served as index.html; avoid counting it twice
const unique = [...new Set(files)];

let rawTotal = 0;
let gzTotal = 0;
let firstLoadGz = 0;
let firstLoadRaw = 0;
console.log('\nApp shell size');
console.log('file'.padEnd(34), 'raw'.padStart(9), 'gzip'.padStart(9));
for (const f of unique) {
  const buf = await readFile(path.join(root, f));
  const gz = gzipSync(buf).length;
  rawTotal += buf.length;
  gzTotal += gz;
  if (isFirstLoad(f)) {
    firstLoadRaw += buf.length;
    firstLoadGz += gz;
  }
  console.log(f.padEnd(34), `${(buf.length / 1024).toFixed(1)} KB`.padStart(9), `${(gz / 1024).toFixed(1)} KB`.padStart(9));
}
console.log('-'.repeat(54));
console.log('FIRST LOAD (html/css/js/svg)'.padEnd(34), `${(firstLoadRaw / 1024).toFixed(1)} KB`.padStart(9), `${(firstLoadGz / 1024).toFixed(1)} KB`.padStart(9));
console.log('FULL PRECACHE (offline)'.padEnd(34), `${(rawTotal / 1024).toFixed(1)} KB`.padStart(9), `${(gzTotal / 1024).toFixed(1)} KB`.padStart(9));

const routes = ['#/', '#/jobs', '#/jobs/SG-1042', '#/quote', '#/inventory', '#/nope'];
const RUNS = 500;
console.log(`\nRender time (average of ${RUNS} runs)`);
let worst = 0;
for (const hash of routes) {
  const route = resolve(hash);
  const start = performance.now();
  for (let i = 0; i < RUNS; i++) renderRoute(route);
  const avg = (performance.now() - start) / RUNS;
  worst = Math.max(worst, avg);
  console.log(hash.padEnd(34), `${avg.toFixed(3)} ms`.padStart(12));
}

const firstKb = firstLoadGz / 1024;
const fullKb = gzTotal / 1024;
const checks = [
  [`first load <= ${BUDGET_FIRST_LOAD_GZIP_KB} KB gzip`, firstKb <= BUDGET_FIRST_LOAD_GZIP_KB, `${firstKb.toFixed(1)} KB`],
  [`full precache <= ${BUDGET_PRECACHE_GZIP_KB} KB gzip`, fullKb <= BUDGET_PRECACHE_GZIP_KB, `${fullKb.toFixed(1)} KB`],
  [`render <= ${BUDGET_RENDER_MS} ms`, worst <= BUDGET_RENDER_MS, `worst ${worst.toFixed(3)} ms`],
];
console.log('');
for (const [label, pass, value] of checks) console.log(`Budget: ${label} -> ${pass ? 'PASS' : 'FAIL'} (${value})`);
if (checks.some(([, pass]) => !pass)) process.exit(1);
