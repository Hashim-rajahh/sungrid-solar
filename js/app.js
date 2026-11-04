// Browser entry point: wires the router to the page. All real logic lives in router.js / views.js /
// quote.js / offline.js / sw-register.js, which are tested without a browser.

import { resolve } from './router.js';
import { renderRoute, quoteResultHtml, offlineStatusHtml, installStatusHtml, reportsListHtml, reportOutcomeHtml } from './views.js';
import { calculateQuote } from './quote.js';
import { collectStatus, clearOfflineData } from './offline.js';
import { setupServiceWorker } from './sw-register.js';
import { createInstallController, bannerCopy } from './install.js';
import { company, jobs, sampleReports } from './data.js';
import {
  validateReport,
  createRecord,
  openOutbox,
  sendReport,
  flushWithLock,
  registerBackgroundSync,
  countRecords,
} from './outbox.js';

const outlet = document.getElementById('app');
const netStatus = document.getElementById('net-status');
const offlineBadge = document.getElementById('offline-ready');
const updateBanner = document.getElementById('update-banner');
const updateButton = document.getElementById('update-btn');
const installBanner = document.getElementById('install-banner');
let firstRender = true;
let currentRoute = 'dashboard';

// Which nav link to highlight for each route ("job" belongs under "Jobs").
const NAV_FOR = { dashboard: 'dashboard', jobs: 'jobs', job: 'jobs', quote: 'quote', inventory: 'inventory', offline: 'offline', install: 'install', reports: 'reports' };

function render() {
  const route = resolve(window.location.hash);
  const { title, html } = renderRoute(route);
  currentRoute = route.name;

  outlet.innerHTML = html;
  document.title = `${title} · ${company.name}`;

  for (const link of document.querySelectorAll('[data-nav]')) {
    if (link.dataset.nav === NAV_FOR[route.name]) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }

  // Move focus into the new page for keyboard / screen-reader users, but not on first load.
  if (!firstRender) {
    outlet.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }
  firstRender = false;

  if (route.name === 'offline') refreshOfflineStatus();
  if (route.name === 'reports') refreshReports();
  installer.noteScreen();
  refreshInstallUi();
}

// ---- Quote and report forms (event delegation, because the forms are re-created on every visit) ----
outlet.addEventListener('submit', (event) => {
  if (event.target.id === 'report-form') {
    event.preventDefault();
    submitReport(event.target).catch((err) => console.warn('Report form failed:', err));
    return;
  }
  if (event.target.id !== 'quote-form') return;
  event.preventDefault();

  const form = new FormData(event.target);
  const result = calculateQuote({
    units: form.get('units'),
    city: form.get('city'),
    type: form.get('type'),
  });

  // Show a message under each field that has a problem; clear the rest.
  for (const field of ['units', 'city', 'type']) {
    const box = document.getElementById(`${field}-err`);
    const input = document.getElementById(field);
    const message = result.ok ? '' : result.errors[field] ?? '';
    box.textContent = message;
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  document.getElementById('quote-result').innerHTML = quoteResultHtml(result);
  if (!result.ok) {
    const firstBad = ['units', 'city', 'type'].find((f) => result.errors[f]);
    document.getElementById(firstBad).focus();
  }
});

// ---- Site reports: outbox, sending and Background Sync (step 4) ----
const outboxReady = openOutbox(globalThis.indexedDB); // never rejects: falls back to memory and says so
const REPORT_FIELDS = { jobId: 'report-job', kind: 'report-kind', panels: 'report-panels', note: 'report-note', installer: 'report-installer' };
let exampleIndex = 0;

/** Redraw everything that shows the outbox: the list on the Reports page and the count in the menu. */
async function refreshReports() {
  try {
    const { outbox, durable } = await outboxReady;
    const records = await outbox.list();

    const list = document.getElementById('reports-list');
    if (list) list.innerHTML = reportsListHtml(records, { durable });

    const badge = document.getElementById('outbox-count');
    if (badge) {
      const { unsent } = countRecords(records);
      badge.hidden = unsent === 0;
      badge.innerHTML = unsent ? `${unsent}<span class="sr-only"> reports not yet sent</span>` : '';
    }
  } catch (err) {
    console.warn('Could not read the report outbox:', err);
  }
}

/** Send what is waiting. Safe to call from anywhere: one sender at a time, and it never throws. */
async function flushReports() {
  try {
    const { outbox } = await outboxReady;
    const result = await flushWithLock({ locks: navigator.locks, outbox, send: (record) => sendReport(record) });
    await refreshReports();
    return result;
  } catch (err) {
    console.warn('Could not send reports:', err);
    return { sent: 0, rejected: 0, left: 0, stopped: true, error: String(err && err.message ? err.message : err) };
  }
}

async function submitReport(formElement) {
  const form = new FormData(formElement);
  const input = {};
  for (const field of Object.keys(REPORT_FIELDS)) input[field] = form.get(field);

  const check = validateReport(input, jobs);
  for (const [field, id] of Object.entries(REPORT_FIELDS)) {
    const box = document.getElementById(`${id}-err`);
    const control = document.getElementById(id);
    const message = check.ok ? '' : check.errors[field] ?? '';
    if (box) box.textContent = message;
    if (control) {
      if (message) control.setAttribute('aria-invalid', 'true');
      else control.removeAttribute('aria-invalid');
    }
  }
  const result = document.getElementById('report-result');
  const show = (outcome) => { if (result) result.innerHTML = reportOutcomeHtml(outcome); };

  if (!check.ok) {
    show({ kind: 'invalid', errors: check.errors });
    const firstBad = Object.keys(REPORT_FIELDS).find((f) => check.errors[f]);
    const control = document.getElementById(REPORT_FIELDS[firstBad]);
    if (control) control.focus();
    return;
  }

  const { outbox, durable, reason } = await outboxReady;
  if (!durable && !navigator.onLine) {
    // Nowhere safe to keep it and no way to send it: say so instead of pretending it was saved.
    show({ kind: 'not-saved', message: `You have no signal and this browser cannot keep reports on the device (${reason}). Try again when you have signal.` });
    return;
  }

  const record = createRecord(check.value);
  try {
    await outbox.add(record);
  } catch (err) {
    show({ kind: 'not-saved', message: `The report could not be saved on this device: ${err && err.message ? err.message : err}` });
    return;
  }

  // Ask for a background send right away (if the page is closed a moment from now, the browser still sends it),
  // but do not make the installer wait for the answer: it only decides the wording of the message below.
  const syncRequest = registerBackgroundSync(navigator);
  if (typeof formElement.reset === 'function') formElement.reset();
  const nameBox = document.getElementById('report-installer');
  if (nameBox) nameBox.value = check.value.installer; // same installer files several reports in a row

  if (navigator.onLine) await flushReports();
  else await refreshReports();

  const saved = await outbox.get(record.id);
  if (saved && saved.status === 'sent') show({ kind: 'sent', id: record.id });
  else if (saved && saved.status === 'rejected') show({ kind: 'refused', message: saved.lastError });
  else show({ kind: 'queued', online: navigator.onLine, sync: await syncRequest, durable });
}

if (navigator.serviceWorker && typeof navigator.serviceWorker.addEventListener === 'function') {
  // The service worker sent something in the background: show it.
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'OUTBOX_CHANGED') refreshReports();
  });
}

// ---- Online / offline indicator ----
function updateNetwork() {
  const online = navigator.onLine;
  netStatus.hidden = online;
  netStatus.textContent = online ? '' : 'You are offline. SunGrid Solar keeps working with the data on this device.';
}
window.addEventListener('online', () => {
  updateNetwork();
  worker.checkForUpdate(); // back in signal: good moment to look for a new version
  flushReports(); // the fallback for browsers without Background Sync (and a second chance in the others)
});
window.addEventListener('offline', updateNetwork);

// ---- Service worker: offline copy and updates ----
function onWorkerState(state) {
  if (state.kind === 'ready') {
    offlineBadge.textContent = 'Ready for offline use ✓';
  } else if (state.kind === 'update-ready') {
    offlineBadge.textContent = 'Ready for offline use ✓ (update available)';
    if (updateBanner) updateBanner.hidden = false;
  } else {
    // Not fatal: the app still works online. Typical cause: opened via file:// instead of http(s).
    console.warn('Offline support unavailable:', state.error);
    offlineBadge.textContent = 'Offline mode unavailable in this browser';
  }
  if (document.getElementById('offline-status')) refreshOfflineStatus();
}

const worker = setupServiceWorker({
  navigator,
  onState: onWorkerState,
  reload: () => window.location.reload(),
});

if (updateButton) updateButton.addEventListener('click', () => worker.applyUpdate());

// Phones keep the app open all day, so look for a new version every hour as well.
const hourly = setInterval(() => worker.checkForUpdate(), 60 * 60 * 1000);
if (typeof hourly === 'object' && hourly.unref) hourly.unref(); // lets test runs exit; no effect in browsers

// ---- Install prompt and icons ----
function safeStorage() {
  try {
    return window.localStorage ?? null; // reading the property itself can throw when site data is blocked
  } catch {
    return null;
  }
}

const installer = createInstallController({
  window,
  navigator,
  storage: safeStorage(),
  onChange: () => refreshInstallUi(),
});

function refreshInstallUi(note = '') {
  const status = installer.status();

  // Install page: the status card.
  const box = document.getElementById('install-status');
  if (box) box.innerHTML = installStatusHtml(status, note);

  // The bar: never on the Install page itself, and only when it can help.
  if (installBanner) {
    const show = currentRoute !== 'install' && installer.shouldShowBanner();
    installBanner.hidden = !show;
    if (show) {
      const copy = bannerCopy(status);
      document.getElementById('install-banner-text').textContent = copy.text;
      document.getElementById('install-btn').hidden = copy.link;
      document.getElementById('install-how').hidden = !copy.link;
    }
  }

  // Once installed there is nothing left to do on the Install page, so drop it from the menu.
  const navItem = document.getElementById('nav-install');
  if (navItem) navItem.hidden = status.state === 'installed';
}

async function runInstall() {
  const result = await installer.promptInstall();
  const note = !result.ok
    ? result.message
    : result.outcome === 'accepted'
      ? 'Installing now. Look for SunGrid Solar on your home screen.'
      : 'Install cancelled. You can try again later from this page.';
  refreshInstallUi(note);
}

const installNow = document.getElementById('install-btn');
if (installNow) installNow.addEventListener('click', runInstall);
const installLater = document.getElementById('install-later');
if (installLater) installLater.addEventListener('click', () => installer.snooze());

// ---- "Offline" page ----
async function refreshOfflineStatus(note = '') {
  const box = document.getElementById('offline-status');
  if (!box) return;
  const status = await collectStatus({ navigator, caches: globalThis.caches });
  if (document.getElementById('offline-status') !== box) return; // user moved to another page meanwhile
  box.innerHTML = offlineStatusHtml(status, note);
}

outlet.addEventListener('click', async (event) => {
  const el = typeof event.target.closest === 'function' ? event.target.closest('[data-action]') : event.target;
  const action = el && el.dataset ? el.dataset.action : undefined;

  if (action === 'report-example') {
    const sample = sampleReports[exampleIndex % sampleReports.length];
    exampleIndex += 1;
    for (const [field, id] of Object.entries(REPORT_FIELDS)) {
      const control = document.getElementById(id);
      if (control) control.value = sample[field];
    }
  } else if (action === 'reports-send') {
    await flushReports();
  } else if (action === 'report-retry' || action === 'report-remove') {
    const { outbox } = await outboxReady;
    if (action === 'report-retry') await outbox.retry(el.dataset.id);
    else await outbox.remove(el.dataset.id);
    await (action === 'report-retry' ? flushReports() : refreshReports());
  } else if (action === 'install-now') {
    await runInstall();
  } else if (action === 'offline-refresh') {
    await refreshOfflineStatus();
  } else if (action === 'check-update') {
    const waiting = await worker.checkForUpdate();
    const note = waiting
      ? 'A new version is ready. Use "Reload to update" in the blue bar.'
      : navigator.onLine
        ? 'You already have the latest version.'
        : 'You are offline, so updates cannot be checked right now.';
    await refreshOfflineStatus(note);
  } else if (action === 'offline-clear') {
    const sure =
      typeof window.confirm !== 'function' ||
      window.confirm('Remove the offline copy? You will need a good internet connection to set it up again.');
    if (!sure) return;
    const result = await clearOfflineData({ navigator, caches: globalThis.caches });
    const box = document.getElementById('offline-status');
    if (!box) return;
    box.innerHTML = offlineStatusHtml(
      result.ok
        ? {
            tone: 'warn',
            title: 'Offline copy removed',
            message: 'The saved app was deleted from this device. Reconnect to the internet and reload the page to set offline mode up again.',
            details: [{ label: 'Saved copies deleted', value: String(result.deleted) }],
          }
        : { tone: 'bad', title: 'Could not remove the offline copy', message: result.error, details: [] },
    );
  }
});

window.addEventListener('hashchange', render);
updateNetwork();
render();
refreshReports();
if (navigator.onLine) flushReports(); // reports left over from an earlier visit go out as soon as the app opens
