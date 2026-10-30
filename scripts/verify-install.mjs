// End-to-end check of installability and the install prompt in a REAL browser (Chromium via Playwright).
//
//   npm i --no-save playwright-core        (one time; the app itself has no dependencies)
//   npm run verify:install
//
// Optional: CHROMIUM_PATH=/path/to/chrome  to use an already-installed Chrome/Chromium.
//
// What it proves, in order:
//   1. Chromium itself parses the manifest without errors and reports the app as installable,
//      online and also with the network switched OFF
//   2. every icon decodes at its declared size; maskable artwork stays inside the safe zone;
//      the iPhone icon is fully opaque; "any" icons have transparent corners
//   3. the install flow with a synthetic browser offer: the bar waits for a second screen, "Not now" is
//      remembered across a reload, installing works, cancelling and a broken install window are explained
//   4. already-installed, iPhone Safari and Chrome-on-iPhone each get the right experience
//   5. the Install page opens offline with every image loaded
// Real Chrome decides by itself when to fire its install offer (it needs user engagement), so that event is
// simulated here; everything else in the list is the browser's own behaviour.
// Exits with code 1 if any check fails.

import path from 'node:path';
import os from 'node:os';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

const { createServer, listen } = await import(pathToFileURL(path.join(root, 'scripts/serve.mjs')).href);
const server = createServer();
await listen(server, 0);
const base = `http://localhost:${server.address().port}`;
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.webmanifest'), 'utf8'));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--no-sandbox', '--disable-gpu'],
});

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1',
};

const problems = [];
async function newPage(context, url = `${base}/`) {
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  await page.goto(url);
  await page.waitForSelector('h1');
  return page;
}
const ready = (page) => page.waitForFunction(() => /Ready for offline use/.test(document.getElementById('offline-ready').textContent), null, { timeout: 15000 });
const go = async (page, hash, heading) => {
  await page.evaluate((h) => { window.location.hash = h; }, hash);
  await page.waitForSelector(`h1:has-text("${heading}")`);
};
/** Fire a synthetic beforeinstallprompt. Returns whether the page took over from the browser's own bar. */
const offer = (page, { outcome = 'accepted', throws = false } = {}) =>
  page.evaluate(({ outcome, throws }) => {
    const e = new Event('beforeinstallprompt', { cancelable: true });
    e.prompt = async () => {
      window.__prompts = (window.__prompts || 0) + 1;
      if (throws) throw new DOMException('Needs a user gesture', 'NotAllowedError');
    };
    e.userChoice = Promise.resolve({ outcome });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  }, { outcome, throws });
const bar = (page) => page.isVisible('#install-banner');
const installStatus = async (page) => (await page.textContent('#install-status')).replace(/\s+/g, ' ').trim();

try {
  // ---------------------------------------------------------------- 1. Chromium's own verdict
  // Playwright's normal contexts are private (incognito) windows, where Chromium refuses installs by design,
  // so the installability verdict is taken in a regular profile.
  const profile = await mkdtemp(path.join(os.tmpdir(), 'sungrid-profile-'));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await newPage(context);
  await ready(page);
  const cdp = await context.newCDPSession(page);

  const app = await cdp.send('Page.getAppManifest');
  check('Chromium parses the manifest with no errors', app.errors.length === 0, app.errors.map((e) => e.message).join('; ') || app.url.replace(base, ''));
  const parsed = app.parsed ? JSON.parse(app.data) : manifest;
  check('manifest has id, 4 icons, 3 shortcuts and 4 screenshots', parsed.id && parsed.icons.length === 4 && parsed.shortcuts.length === 3 && parsed.screenshots.length === 4, `id=${parsed.id}`);

  const online = await cdp.send('Page.getInstallabilityErrors');
  check('Chromium reports the app as installable (online)', online.installabilityErrors.length === 0, online.installabilityErrors.map((e) => e.errorId).join(', ') || 'no installability errors');

  await context.setOffline(true);
  const offline = await cdp.send('Page.getInstallabilityErrors');
  check('and still installable with the network switched OFF', offline.installabilityErrors.length === 0, offline.installabilityErrors.map((e) => e.errorId).join(', ') || 'icons come from the saved copy');
  await context.setOffline(false);

  // ---------------------------------------------------------------- 2. the icons, pixel by pixel
  const inspect = (src) =>
    page.evaluate(async (src) => {
      const bmp = await createImageBitmap(await (await fetch(src)).blob());
      const ctx = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d');
      ctx.drawImage(bmp, 0, 0);
      const { data, width, height } = ctx.getImageData(0, 0, bmp.width, bmp.height);
      let minAlpha = 255;
      let reach = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          minAlpha = Math.min(minAlpha, data[i + 3]);
          if (data[i + 3] > 0 && Math.abs(data[i] - 15) + Math.abs(data[i + 1] - 42) + Math.abs(data[i + 2] - 67) > 30) {
            reach = Math.max(reach, Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2) / width);
          }
        }
      }
      return { width, height, cornerAlpha: data[3], minAlpha, reach };
    }, src);

  const iconFailures = [];
  for (const icon of manifest.icons) {
    const info = await inspect(`./${icon.src}`);
    const [w, h] = icon.sizes.split('x').map(Number);
    if (info.width !== w || info.height !== h) iconFailures.push(`${icon.src} decodes as ${info.width}x${info.height}`);
    if (icon.purpose === 'any' && info.cornerAlpha !== 0) iconFailures.push(`${icon.src} corners are not transparent`);
    if (icon.purpose === 'maskable' && info.minAlpha !== 255) iconFailures.push(`${icon.src} has transparent pixels`);
  }
  check('all 4 manifest icons decode at their declared size, with the right transparency', iconFailures.length === 0, iconFailures.join('; ') || 'any: rounded corners; maskable: opaque');

  const mask512 = await inspect('./icons/icon-maskable-512.png');
  const mask192 = await inspect('./icons/icon-maskable-192.png');
  check('maskable artwork stays inside the safe zone (40% of the width)', mask512.reach <= 0.4 && mask192.reach <= 0.4, `reaches ${mask512.reach.toFixed(3)} (512) and ${mask192.reach.toFixed(3)} (192)`);

  const apple = await inspect('./icons/apple-touch-icon.png');
  check('the iPhone icon is 180x180 and fully opaque', apple.width === 180 && apple.height === 180 && apple.minAlpha === 255, `${apple.width}x${apple.height}, lowest alpha ${apple.minAlpha}`);

  const shortcutSizes = [];
  for (const sc of manifest.shortcuts) shortcutSizes.push((await inspect(`./${sc.icons[0].src}`)).width);
  check('shortcut icons decode at 96x96', shortcutSizes.every((w) => w === 96), shortcutSizes.join(', '));

  const shotInfo = await page.evaluate(async (shots) => Promise.all(shots.map(async (s) => { const b = await createImageBitmap(await (await fetch(`./${s.src}`)).blob()); return `${b.width}x${b.height}` === s.sizes; })), manifest.screenshots);
  check('the 4 screenshots decode at their declared size', shotInfo.every(Boolean));
  await context.close();
  await rm(profile, { recursive: true, force: true });

  // ---------------------------------------------------------------- 3. the install flow
  const flow = await browser.newContext();
  const p = await newPage(flow);
  await ready(p);

  const prevented = await offer(p);
  check("the page takes over from the browser's own install bar", prevented === true);
  check('the install bar is NOT shown on the first screen', !(await bar(p)));

  await go(p, '#/jobs', 'Jobs');
  check('after a second screen the bar appears', await bar(p), (await p.textContent('#install-banner-text')).trim());

  await go(p, '#/install', 'Install');
  check('the bar is hidden on the Install page, which has its own button', !(await bar(p)));
  check('the Install page says "Ready to install" with a button', /Ready to install/.test(await installStatus(p)) && (await p.isVisible('[data-action="install-now"]')));

  await go(p, '#/jobs', 'Jobs');
  await p.click('#install-later');
  check('"Not now" hides the bar', !(await bar(p)));
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('sungrid.install.v1')));
  const days = (saved.snoozeUntil - Date.now()) / 86400000;
  check('and remembers the choice for 14 days', days > 13.99 && days <= 14, `${days.toFixed(2)} days`);

  await p.reload();
  await p.waitForSelector('h1');
  await go(p, '#/quote', 'Quick quote');
  await offer(p);
  await go(p, '#/inventory', 'Inventory');
  check('after a reload the bar stays quiet (the choice survived)', !(await bar(p)));

  await go(p, '#/install', 'Install');
  await p.click('[data-action="install-now"]');
  await p.waitForSelector('#install-status:has-text("SunGrid Solar is installed")');
  check('installing opens the browser window once and shows "installed"', (await p.evaluate(() => window.__prompts)) === 1, (await installStatus(p)).slice(0, 90));
  check('the Install link leaves the menu once installed', !(await p.isVisible('#nav-install')));
  await flow.close();

  // cancelled
  const c2 = await browser.newContext();
  const p2 = await newPage(c2);
  await ready(p2);
  await go(p2, '#/install', 'Install');
  await offer(p2, { outcome: 'dismissed' });
  await p2.click('[data-action="install-now"]');
  await p2.waitForSelector('#install-status:has-text("Install was cancelled")');
  check('cancelling the install window is explained, nothing breaks', /Nothing was changed/.test(await installStatus(p2)));
  await c2.close();

  // broken window
  const c3 = await browser.newContext();
  const p3 = await newPage(c3);
  await ready(p3);
  await go(p3, '#/install', 'Install');
  await offer(p3, { throws: true });
  await p3.click('[data-action="install-now"]');
  await p3.waitForSelector('#install-status:has-text("could not open")');
  const brokenText = await installStatus(p3);
  check('a broken install window shows the reason and manual steps', /NotAllowedError: Needs a user gesture/.test(brokenText) && /Install app/.test(brokenText), brokenText.slice(0, 140));
  await go(p3, '#/jobs', 'Jobs');
  check('and the rest of the app keeps working', /Ahmed Raza/.test(await p3.textContent('main')));
  await c3.close();

  // ---------------------------------------------------------------- 4. other devices
  const standalone = await browser.newContext();
  await standalone.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : original(q));
  });
  const ps = await newPage(standalone);
  await ready(ps);
  await offer(ps);
  await go(ps, '#/jobs', 'Jobs');
  await go(ps, '#/quote', 'Quick quote');
  check('already installed (standalone): no bar, no Install link', !(await bar(ps)) && !(await ps.isVisible('#nav-install')));
  await go(ps, '#/install', 'Install');
  check('and the Install page says so', /You are using the installed app/.test(await installStatus(ps)));
  await standalone.close();

  const iphone = await browser.newContext({ userAgent: UA.iphoneSafari, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const pi = await newPage(iphone);
  await ready(pi);
  await go(pi, '#/jobs', 'Jobs');
  const howVisible = await pi.isVisible('#install-how');
  check('iPhone Safari: after a second screen the bar offers "Show me how" (no install button exists there)', (await bar(pi)) && howVisible && !(await pi.isVisible('#install-btn')));
  await pi.click('#install-how');
  await pi.waitForSelector('h1:has-text("Install")');
  const iosText = await installStatus(pi);
  check('iPhone Safari: the Install page lists the three Share-menu steps', /Share button/.test(iosText) && /Add to Home Screen/.test(iosText));
  await iphone.close();

  const iChrome = await browser.newContext({ userAgent: UA.iphoneChrome, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const pc = await newPage(iChrome);
  await ready(pc);
  await go(pc, '#/jobs', 'Jobs');
  await go(pc, '#/quote', 'Quick quote');
  check('Chrome on iPhone: no bar it cannot act on', !(await bar(pc)));
  await go(pc, '#/install', 'Install');
  check('Chrome on iPhone: the page says to open Safari', /Open this page in Safari/.test(await installStatus(pc)));
  await iChrome.close();

  // ---------------------------------------------------------------- 5. offline
  const off = await browser.newContext();
  const po = await newPage(off);
  await ready(po);
  await off.setOffline(true);
  const t0 = Date.now();
  const offPage = await off.newPage();
  offPage.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
  await offPage.goto(`${base}/#/install`);
  await offPage.waitForSelector('#install-status h2');
  const renderMs = Date.now() - t0;
  await offPage.waitForLoadState('load');
  const images = await offPage.evaluate(() => [...document.images].map((i) => ({ src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0 })));
  check('offline: the Install page opens with every image loaded from the saved copy', images.length >= 6 && images.every((i) => i.ok), `${images.filter((i) => i.ok).length}/${images.length} images, ${renderMs} ms to render`);
  await off.close();

  check('no console or page errors anywhere in this run', problems.length === 0, problems.join(' | '));
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
