// End-to-end check of site reports and Background Sync in a REAL browser (Chromium via Playwright).
//
//   npm i --no-save playwright-core        (one time; the app itself has no dependencies)
//   npm run verify:sync
//
// Optional: CHROMIUM_PATH=/path/to/chrome  to use an already-installed Chrome/Chromium.
//
// A throw-away copy of the project is served by its own dev server, whose report endpoint is controlled here
// (it can be switched to "down" or "refusing"), so every outcome can be provoked on demand.
//
// What it proves:
//   1. online: a report is sent at once and the office receives every field
//   2. wrong input is refused with messages and nothing is sent
//   3. offline: the report is kept in IndexedDB, nothing is sent, the menu shows the count
//   4. the app is CLOSED, the connection returns: the service worker sends the report (Background Sync)
//   5. if the office is down at that moment the report is kept and the worker asks for a retry; when it is up, it goes
//   6. the page and the worker waking together send each report once (no duplicates)
//   7. a browser without Background Sync (iPhone Safari): the app says so, and sends when it is back online
//   8. a refused report is kept with a reason; "Try again" delivers it; Urdu text survives the trip
//
// About step 4/5: headless Chrome does not announce connectivity changes to Background Sync, so the browser's
// "connection is back" event is delivered through the DevTools protocol (ServiceWorker.dispatchSyncEvent).
// Everything after that event is the real service worker, the real IndexedDB and the real network.
// It exits with code 1 if any check fails.

import { cp, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, { timeout = 15000, every = 100 } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(every);
  }
  return false;
}

// ---- a copy of the project, served with a controllable office endpoint ----
const tmp = await mkdtemp(path.join(os.tmpdir(), 'sungrid-sync-'));
const site = path.join(tmp, 'site');
await cp(projectRoot, site, { recursive: true, filter: (src) => !/node_modules|\.git(\/|\\|$)/.test(src) });
const { createServer, listen } = await import(pathToFileURL(path.join(site, 'scripts/serve.mjs')).href);

const office = { status: 200, received: [], attempts: 0 };
const server = createServer({
  handleReport: (fields) => {
    office.attempts += 1;
    if (office.status !== 200) return office.status;
    office.received.push(fields);
    return 200;
  },
});
await listen(server, 0);
const base = `http://localhost:${server.address().port}`;
const origin = base;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--no-sandbox', '--disable-gpu'],
});

const READY = () => /Ready for offline use/.test(document.getElementById('offline-ready').textContent);
const problems = [];

/** Open the app on the Reports page and wait until the service worker is ready. */
async function openApp(context, hash = '#/reports') {
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  await page.goto(`${base}/${hash}`);
  await page.waitForFunction(READY, null, { timeout: 15000 });
  return page;
}

async function fill(page, { job, kind, panels, note, installer }) {
  await page.selectOption('#report-job', job);
  await page.selectOption('#report-kind', kind);
  await page.fill('#report-panels', panels);
  await page.fill('#report-note', note);
  await page.fill('#report-installer', installer);
}

/** Read the outbox from inside the service worker: the same IndexedDB the worker sends from. */
async function storedReports(context) {
  const worker = context.serviceWorkers()[0];
  if (!worker) return null;
  return worker.evaluate(async () => {
    const { outbox } = await self.SunGridOutbox.openOutbox(self.indexedDB);
    return (await outbox.list()).map((r) => ({ id: r.id, status: r.status, attempts: r.attempts, job: r.jobId, note: r.note }));
  });
}

/** Deliver the browser's "connection is back" event for the app's registration. */
async function wakeWorker(cdp, registrationId) {
  await cdp.send('ServiceWorker.dispatchSyncEvent', { origin, registrationId, tag: 'sungrid-send-reports', lastChance: false });
}

try {
  // ======================= context A: a Chrome-like browser with Background Sync =======================
  const context = await browser.newContext({ locale: 'en-GB' });
  const control = await context.newPage(); // stays open: it carries the DevTools session, like a second tab
  await control.goto('about:blank');
  const cdp = await context.newCDPSession(control);
  let registrationId = null;
  cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => {
    const reg = e.registrations.find((r) => r.scopeURL.startsWith(origin));
    if (reg) registrationId = reg.registrationId;
  });
  await cdp.send('ServiceWorker.enable');

  // ---- 1. online ----
  let page = await openApp(context);
  check('the Reports page opens', (await page.textContent('h1')) === 'Site reports');
  check('the hidden Netlify form is in the page (so Netlify knows to accept the reports)', (await page.getAttribute('form[name="site-report"]', 'data-netlify')) === 'true');
  check('the browser offers Background Sync to this app', await page.evaluate(async () => 'sync' in (await navigator.serviceWorker.ready)));

  await page.click('[data-action="report-example"]');
  check('"Use an example" fills the form from the sample data', (await page.inputValue('#report-job')) === 'SG-1043' && (await page.inputValue('#report-panels')) === '6');
  await page.click('#report-form button[type=submit]');
  check('online: the report reaches the office at once', await until(() => office.received.length === 1, { timeout: 5000 }));
  const first = office.received[0] ?? {};
  check(
    'the office receives every field',
    first['form-name'] === 'site-report' && first.job === 'SG-1043' && first.kind === 'Progress update' && first.panels === '6' && first.installer === 'Imran Khalid' && /^R-/.test(first.report_id) && /^\d{4}-\d\d-\d\dT/.test(first.reported_at) && first.note.startsWith('East roof'),
    `${first.report_id}`,
  );
  await page.waitForSelector('#report-result:has-text("Sent to the office")', { timeout: 5000 });
  check('the page says "Sent to the office" and the list shows it', /Sent to office/.test(await page.textContent('#reports-list')));
  check('nothing is waiting, so the menu shows no count', await page.evaluate(() => document.getElementById('outbox-count').hidden));

  // ---- 2. wrong input ----
  office.received.length = 0;
  await fill(page, { job: 'SG-1043', kind: 'Progress update', panels: 'six', note: '', installer: '' });
  await page.click('#report-form button[type=submit]');
  check('wrong input: a clear message under the field', /whole number/.test(await page.textContent('#report-panels-err')) && /Enter your name/.test(await page.textContent('#report-installer-err')));
  check('wrong input: the first bad field gets the cursor', await page.evaluate(() => document.activeElement.id === 'report-panels'));
  await fill(page, { job: 'SG-1043', kind: 'Progress update', panels: '13', note: '', installer: 'Imran Khalid' }); // SG-1043 has 12
  await page.click('#report-form button[type=submit]');
  check('too many panels names the job and its real total', /SG-1043 has only 12 panels in total/.test(await page.textContent('#report-panels-err')));
  await sleep(300);
  check('nothing invalid was sent or stored', office.attempts === 1 && (await storedReports(context)).length === 1);

  // ---- 3. offline ----
  await fill(page, { job: 'SG-1043', kind: 'Progress update', panels: '4', note: 'West roof, 4 panels. Cable tray still to fit.', installer: 'Imran Khalid' });
  await context.setOffline(true);
  await page.click('#report-form button[type=submit]');
  await page.waitForSelector('#report-result:has-text("Saved on this phone")', { timeout: 5000 });
  const queuedText = await page.textContent('#report-result');
  check('offline: "Saved on this phone", and it says it will go out even if the app is closed', /even if you close the app/.test(queuedText), queuedText.replace(/\s+/g, ' ').trim().slice(0, 120));
  check('offline: the list shows "Waiting to send" and the menu shows 1', /Waiting to send/.test(await page.textContent('#reports-list')) && (await page.textContent('#outbox-count')).trim().startsWith('1'));
  const stored = await storedReports(context);
  check('offline: the report is really in IndexedDB (readable by the worker)', stored.filter((r) => r.status === 'pending').length === 1, JSON.stringify(stored.map((r) => r.status)));
  check('offline: nothing reached the office', office.received.length === 0);

  // ---- 4. the app is CLOSED, then the connection returns ----
  await page.close();
  await sleep(300);
  await context.setOffline(false);
  const regKnown = await until(() => registrationId !== null, { timeout: 5000 });
  check('the service worker registration is visible to the DevTools session', regKnown);

  // Chrome may fire the sync by itself when the network returns; if it does not within a few seconds, deliver the event.
  const byItself = await until(() => office.received.length === 1, { timeout: 4000 });
  if (!byItself) await wakeWorker(cdp, registrationId);
  const sentWhileClosed = await until(() => office.received.length === 1, { timeout: 10000 });
  check('APP CLOSED: the service worker sent the waiting report (Background Sync)', sentWhileClosed, byItself ? 'fired by Chrome itself' : 'sync event delivered through DevTools');
  check('...and it is the right report', office.received[0]?.panels === '4' && /West roof/.test(office.received[0]?.note ?? ''));
  check('...the outbox now says "sent"', await until(async () => (await storedReports(context)).every((r) => r.status === 'sent'), { timeout: 5000 }));

  // ---- 5. the office is down at that moment ----
  page = await openApp(context);
  office.received.length = 0;
  office.status = 503;
  await context.setOffline(true);
  await fill(page, { job: 'SG-1044', kind: 'Problem found', panels: '0', note: 'Roof sheet corroded near the south edge.', installer: 'Naveed Akhtar' });
  await page.click('#report-form button[type=submit]');
  await page.waitForSelector('#report-result:has-text("Saved on this phone")', { timeout: 5000 });
  await page.close();
  await context.setOffline(false); // signal is back, but the office server answers 503
  const attemptsBefore = office.attempts;
  await wakeWorker(cdp, registrationId);
  check('office down: the worker tried to send', await until(() => office.attempts > attemptsBefore, { timeout: 10000 }));
  await sleep(300);
  const afterDown = (await storedReports(context)).filter((r) => r.status !== 'sent');
  check('office down: the report is kept, still waiting, with the attempt counted', afterDown.length === 1 && afterDown[0].status === 'pending' && afterDown[0].attempts >= 1, JSON.stringify(afterDown));
  check('office down: nothing was lost or half-delivered', office.received.length === 0);

  office.status = 200;
  await wakeWorker(cdp, registrationId);
  check('office back: the same report is delivered on the next wake-up', await until(() => office.received.length === 1, { timeout: 10000 }));
  check('...delivered once', office.received.filter((r) => r.job === 'SG-1044').length === 1);

  // ---- 6. page and worker waking together ----
  page = await openApp(context);
  office.received.length = 0;
  await context.setOffline(true);
  for (const n of ['1', '2']) {
    await fill(page, { job: 'SG-1043', kind: 'Progress update', panels: n, note: `Report ${n}`, installer: 'Imran Khalid' });
    await page.click('#report-form button[type=submit]');
    await page.waitForSelector(`#reports-list:has-text("Report ${n}")`, { timeout: 5000 });
  }
  await context.setOffline(false);
  await Promise.all([page.evaluate(() => window.dispatchEvent(new Event('online'))), wakeWorker(cdp, registrationId)]);
  await sleep(1500);
  const ids = office.received.map((r) => r.report_id);
  check('page and worker woke at the same moment: both reports arrived', office.received.length === 2, `${office.received.length} received`);
  check('...each exactly once (no duplicates)', new Set(ids).size === ids.length && office.received.length === 2, ids.join(', '));
  check('...in the order they were filed', office.received[0]?.panels === '1' && office.received[1]?.panels === '2');

  // ---- 8a. refused report, Urdu text ----
  office.received.length = 0;
  office.status = 400;
  const urdu = 'چھت کی حالت ٹھیک ہے & "پینل" <12>';
  await fill(page, { job: 'SG-1042', kind: 'Job finished', panels: '18', note: urdu, installer: 'Imran Khalid' });
  await page.click('#report-form button[type=submit]');
  await page.waitForSelector('#report-result:has-text("refused the report")', { timeout: 5000 });
  check('refused (400): kept in the list with the reason and a "Try again" button', /refused this report \(error 400\)/.test(await page.textContent('#reports-list')) && (await page.locator('[data-action="report-retry"]').count()) === 1);
  check('refused: the menu still counts it (it needs a person)', !(await page.evaluate(() => document.getElementById('outbox-count').hidden)));
  office.status = 200;
  await page.click('[data-action="report-retry"]');
  check('"Try again" delivers it', await until(() => office.received.length === 1, { timeout: 5000 }));
  check('Urdu text, quotes, & and <> arrive unchanged', office.received[0]?.note === urdu, office.received[0]?.note);
  check('the notes are shown escaped, never as HTML', !(await page.evaluate(() => document.querySelector('#reports-list ul')?.innerHTML.includes('<12>'))));
  await page.close();

  // Chrome logs "Failed to load resource ... 400" for the refusal provoked on purpose in 8a; that line is expected.
  const unexpected = problems.filter((m) => !/status of 400/.test(m));
  check('no console errors or page errors in the Background Sync browser (apart from the 400 provoked on purpose)', unexpected.length === 0, unexpected.join(' | '));
  await context.close();

  // ======================= context B: a browser WITHOUT Background Sync (iPhone Safari, Firefox) =======================
  const plain = await browser.newContext();
  await plain.addInitScript(() => { delete ServiceWorkerRegistration.prototype.sync; });
  const p = await openApp(plain);
  check('no-Background-Sync browser: the API really is absent', await p.evaluate(async () => !('sync' in (await navigator.serviceWorker.ready))));
  office.received.length = 0;
  await plain.setOffline(true);
  await fill(p, { job: 'SG-1043', kind: 'Progress update', panels: '2', note: 'Battery rack fitted.', installer: 'Imran Khalid' });
  await p.click('#report-form button[type=submit]');
  await p.waitForSelector('#report-result:has-text("Saved on this phone")', { timeout: 5000 });
  const iphoneText = await p.textContent('#report-result');
  check('no-Background-Sync browser: it says honestly that the app must be opened again', /open SunGrid Solar again/.test(iphoneText) && /cannot send in the background/.test(iphoneText));
  await plain.setOffline(false);
  check('...but when the connection is back and the app is open, the report is sent by the "online" fallback', await until(() => office.received.length === 1, { timeout: 8000 }));
  check('...and the list updates to "Sent"', await until(async () => /Sent to office/.test(await p.textContent('#reports-list')) && !/Waiting to send/.test(await p.textContent('#reports-list')), { timeout: 5000 }));

  // left over from an earlier visit: sent when the app is opened again
  office.received.length = 0;
  await plain.setOffline(true);
  await fill(p, { job: 'SG-1044', kind: 'Problem found', panels: '0', note: 'Gate locked, no access.', installer: 'Naveed Akhtar' });
  await p.click('#report-form button[type=submit]');
  await p.waitForSelector('#report-result:has-text("Saved on this phone")', { timeout: 5000 });
  await p.close();
  await plain.setOffline(false);
  await sleep(500);
  check('closed app + no Background Sync: nothing is sent until the app is opened (as stated)', office.received.length === 0);
  const again = await openApp(plain, '#/');
  check('...opening the app again sends the waiting report', await until(() => office.received.length === 1, { timeout: 8000 }));
  await again.close();
  await plain.close();
} finally {
  await browser.close();
  server.close();
  await rm(tmp, { recursive: true, force: true });
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
