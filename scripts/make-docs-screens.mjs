// Takes the README's screenshots of every main part of the app, from the running app (Chromium via Playwright).
//
//   npm i --no-save playwright-core
//   npm run docs:screens        (CHROMIUM_PATH=/path/to/chrome if Playwright has no browser)
//
// Writes docs/screens/*.png at 540 x 960 (a 360 x 640 phone at 1.5x), the way an installer sees the app.
// The Reports picture is taken after one example report was filed and sent.

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'docs', 'screens');
const { chromium } = await import('playwright-core');
const { createServer, listen } = await import(pathToFileURL(path.join(root, 'scripts/serve.mjs')).href);

await mkdir(out, { recursive: true });
const server = createServer();
await listen(server, 0);
const base = `http://localhost:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-gpu'] });

try {
  const context = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 1.5 });
  const page = await context.newPage();
  const shot = (name) => page.screenshot({ path: path.join(out, `${name}.png`) });
  const ready = () => document.getElementById('offline-ready').textContent.includes('Ready for offline use');

  await page.goto(`${base}/#/`);
  await page.waitForSelector('.stats');
  await page.waitForFunction(ready); // the app is saved on the device, as for a real visitor
  await shot('dashboard');

  await page.goto(`${base}/#/jobs`);
  await page.waitForSelector('h1:has-text("Jobs")');
  await shot('jobs');

  await page.goto(`${base}/#/jobs/SG-1043`);
  await page.waitForSelector('h1:has-text("SG-1043")');
  await shot('job-sheet');

  await page.goto(`${base}/#/quote`);
  await page.fill('#units', '600');
  await page.selectOption('#city', 'Lahore');
  await page.selectOption('#type', 'On-grid');
  await page.click('button[type=submit]');
  await page.waitForSelector('#quote-result .big');
  await page.evaluate(() => document.getElementById('quote-result').scrollIntoView());
  await shot('quote');

  await page.goto(`${base}/#/inventory`);
  await page.waitForSelector('h1:has-text("Inventory")');
  await shot('inventory');

  // Reports: one report filed and sent, so the list shows a delivered report.
  await page.goto(`${base}/#/reports`);
  await page.waitForSelector('[data-action="report-example"]');
  await page.click('[data-action="report-example"]');
  await page.click('button:has-text("Save report")');
  await page.waitForTimeout(900);
  await page.evaluate(() => document.getElementById('reports-list').scrollIntoView());
  await shot('reports');

  await page.goto(`${base}/#/install`);
  await page.waitForTimeout(500);
  await shot('install');

  await page.goto(`${base}/#/offline`);
  await page.waitForTimeout(800); // the page asks the service worker how many files it holds
  await shot('offline');

  console.log('Wrote screenshots to', out);
} finally {
  await browser.close();
  server.close();
}
