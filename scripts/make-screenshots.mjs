// Takes the screenshots listed in manifest.webmanifest from the real app (Chromium via Playwright).
// Browsers show them in the richer install dialog, so they must look like the running app.
//
//   npm i --no-save playwright-core
//   node scripts/make-screenshots.mjs        (CHROMIUM_PATH=/path/to/chrome if needed)
//
// Writes screenshots/*.png. Sizes must match the "sizes" in the manifest; a test checks that.

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'screenshots');
const { chromium } = await import('playwright-core');
const { createServer, listen } = await import(pathToFileURL(path.join(root, 'scripts/serve.mjs')).href);

await mkdir(out, { recursive: true });
const server = createServer();
await listen(server, 0);
const base = `http://localhost:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-gpu'] });

try {
  // Phone: 360 x 640 CSS pixels at 1.5x gives 540 x 960 pixels.
  const phone = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 1.5 });
  const p = await phone.newPage();

  // Wait for the real footer message, so the pictures show the app as a customer sees it.
  const ready = () => document.getElementById('offline-ready').textContent.includes('Ready for offline use');

  await p.goto(`${base}/#/`);
  await p.waitForSelector('.stats');
  await p.waitForFunction(ready);
  await p.screenshot({ path: path.join(out, 'phone-dashboard.png') });

  await p.goto(`${base}/#/jobs/SG-1043`);
  await p.waitForSelector('h1:has-text("SG-1043")');
  await p.screenshot({ path: path.join(out, 'phone-job.png') });

  await p.goto(`${base}/#/quote`);
  await p.fill('#units', '600');
  await p.selectOption('#city', 'Lahore');
  await p.selectOption('#type', 'On-grid');
  await p.click('button[type=submit]');
  await p.waitForSelector('#quote-result .big');
  await p.evaluate(() => document.getElementById('quote-result').scrollIntoView());
  await p.screenshot({ path: path.join(out, 'phone-quote.png') });

  // Desktop: 1280 x 720.
  const desk = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const d = await desk.newPage();
  await d.goto(`${base}/#/`);
  await d.waitForSelector('.stats');
  await d.waitForFunction(ready);
  await d.screenshot({ path: path.join(out, 'desktop-dashboard.png') });
  console.log('Wrote screenshots to', out);
} finally {
  await browser.close();
  server.close();
}
