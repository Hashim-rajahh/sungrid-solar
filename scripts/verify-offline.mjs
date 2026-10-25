// End-to-end check of the offline cache in a REAL browser (Chromium via Playwright).
//
//   npm i --no-save playwright-core        (one time; the app itself has no dependencies)
//   npm run verify:offline
//
// Optional: CHROMIUM_PATH=/path/to/chrome  to use an already-installed Chrome/Chromium.
//
// It works on a throw-away COPY of the project, so it can change a file to simulate a new release.
// What it proves, in order:
//   1. first visit online saves the whole app
//   2. with the network switched OFF: deep links, the quote calculator and the Offline page still work
//   3. an address without # is sent to the app root instead of showing a broken page
//   4. a new release is detected, waits (does NOT reload the page by itself), and applies on request
// It also prints timings (median of 7 runs) and exits with code 1 if any check fails.

import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const run = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.error('playwright-core is not installed. Run:  npm i --no-save playwright-core');
  console.error('Then, if you have no Chrome/Chromium, either set CHROMIUM_PATH or run: npx playwright-core install chromium');
  process.exit(2);
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

// ---- work on a copy, served by the copy's own dev server ----
const tmp = await mkdtemp(path.join(os.tmpdir(), 'sungrid-e2e-'));
const site = path.join(tmp, 'site');
await cp(projectRoot, site, { recursive: true, filter: (src) => !/node_modules|\.git(\/|\\|$)/.test(src) });
const { createServer, listen } = await import(pathToFileURL(path.join(site, 'scripts/serve.mjs')).href);
const server = createServer();
await listen(server, 0);
const base = `http://localhost:${server.address().port}`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--no-sandbox', '--disable-gpu'],
});

try {
  const context = await browser.newContext();
  const problems = [];
  context.on('weberror', (e) => problems.push(`page error: ${e.error().message}`));

  // 1 ---- first visit, online
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
  const t0 = Date.now();
  await page.goto(`${base}/`);
  await page.waitForFunction(() => /Ready for offline use/.test(document.getElementById('offline-ready').textContent), null, { timeout: 15000 });
  const timeToReady = Date.now() - t0;

  const saved = await page.evaluate(async () => {
    const names = await caches.keys();
    const cache = await caches.open(names[0]);
    return { names, count: (await cache.keys()).length };
  });
  const shellCount = (await readFile(path.join(site, 'sw.js'), 'utf8')).match(/^\s*'\.\/[^']*',?$/gm).length;
  check('first visit saves the whole app', saved.names.length === 1 && saved.count === shellCount, `${saved.count}/${shellCount} files in ${saved.names[0]}, ${timeToReady} ms to "ready"`);

  // 2 ---- network OFF
  await context.setOffline(true);

  const loadTimes = [];
  for (let i = 0; i < 7; i++) {
    const p = await context.newPage();
    const start = Date.now();
    await p.goto(`${base}/#/jobs/SG-1042`);
    await p.waitForSelector('h1:has-text("SG-1042")', { timeout: 10000 });
    loadTimes.push(Date.now() - start);
    if (i === 0) {
      check('offline: deep link to a job renders from the saved copy', /Ahmed Raza/.test(await p.textContent('main')));
      check('offline: stylesheet was applied (page is styled, not a bare document)', await p.evaluate(() => getComputedStyle(document.querySelector('.site-header')).backgroundColor === 'rgb(15, 42, 67)'));
    }
    await p.close();
  }

  const quote = await context.newPage();
  await quote.goto(`${base}/#/quote`);
  await quote.fill('#units', '600');
  await quote.selectOption('#city', 'Lahore');
  await quote.selectOption('#type', 'On-grid');
  await quote.click('button[type=submit]');
  await quote.waitForSelector('#quote-result .big');
  check('offline: quote calculator works', /5\.18 kWp On-grid/.test(await quote.textContent('#quote-result')), await quote.textContent('#quote-result .big'));
  await quote.fill('#units', 'abc');
  await quote.click('button[type=submit]');
  check('offline: bad quote input shows a clear message, no crash', /must be a number/.test(await quote.textContent('#units-err')));
  await quote.close();

  const status = await context.newPage();
  await status.goto(`${base}/#/offline`);
  await status.waitForSelector('#offline-status:has-text("Ready for site visits")', { timeout: 10000 });
  check('offline: Offline page reports "Ready for site visits"', true, (await status.textContent('#offline-status dl')).replace(/\s+/g, ' ').trim());
  await status.close();

  // 3 ---- address without #
  const typo = await context.newPage();
  await typo.goto(`${base}/jobs/SG-1042`);
  await typo.waitForSelector('h1');
  check('offline: an address without # goes to the app root, styled and working', typo.url() === `${base}/` && /Dashboard/.test(await typo.textContent('h1')), typo.url());
  await typo.close();

  check('no console or page errors during offline use', problems.length === 0, problems.join(' | '));
  await context.setOffline(false);

  // 4 ---- a new release
  const oldVersion = saved.names[0];
  await page.evaluate(() => { window.__sameDocument = true; });
  await writeFile(path.join(site, 'css/styles.css'), `${await readFile(path.join(site, 'css/styles.css'), 'utf8')}\n/* release 2 marker */\n`);
  await run('node', [path.join(site, 'scripts/stamp-sw.mjs')]);
  const newVersion = /const VERSION = '([^']+)'/.exec(await readFile(path.join(site, 'sw.js'), 'utf8'))[1];
  check('stamp script produced a new version for the changed file', newVersion !== oldVersion, `${oldVersion} -> ${newVersion}`);

  await page.goto(`${base}/#/offline`); // a normal navigation; the old worker still serves the old copy
  await page.evaluate(() => { window.__sameDocument = true; });
  await page.click('[data-action="check-update"]');
  await page.waitForSelector('#update-banner:not([hidden])', { timeout: 15000 });
  check('new release is detected and the blue banner appears', true);
  check('the page was NOT reloaded by itself while the update waited', await page.evaluate(() => window.__sameDocument === true));
  const during = await page.evaluate(async () => (await caches.keys()).sort());
  check('both versions are saved while the update waits (nothing half-applied)', during.length === 2 && during.includes(oldVersion) && during.includes(newVersion), during.join(', '));

  await Promise.all([page.waitForNavigation({ timeout: 15000 }), page.click('#update-btn')]);
  await page.waitForFunction(() => /Ready for offline use/.test(document.getElementById('offline-ready').textContent), null, { timeout: 15000 });
  const after = await page.evaluate(async () => ({ names: await caches.keys(), css: await (await fetch('./css/styles.css')).text() }));
  check('after "Reload to update": only the new version remains, with the new file', after.names.length === 1 && after.names[0] === newVersion && after.css.includes('release 2 marker'), after.names.join(', '));
  check('banner is gone after the update', await page.evaluate(() => document.getElementById('update-banner').hidden));

  console.log(`\nTimings (local server, Chromium): first visit to "ready for offline" ${timeToReady} ms; offline deep-link load, median of 7: ${median(loadTimes)} ms (range ${Math.min(...loadTimes)} to ${Math.max(...loadTimes)} ms)`);
} finally {
  await browser.close();
  server.close();
  await rm(tmp, { recursive: true, force: true });
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
