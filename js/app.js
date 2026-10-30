// Browser entry point: wires the router to the page. All real logic lives in router.js / views.js /
// quote.js / offline.js / sw-register.js, which are tested without a browser.

import { resolve } from './router.js';
import { renderRoute, quoteResultHtml, offlineStatusHtml, installStatusHtml } from './views.js';
import { calculateQuote } from './quote.js';
import { collectStatus, clearOfflineData } from './offline.js';
import { setupServiceWorker } from './sw-register.js';
import { createInstallController, bannerCopy } from './install.js';
import { company } from './data.js';

const outlet = document.getElementById('app');
const netStatus = document.getElementById('net-status');
const offlineBadge = document.getElementById('offline-ready');
const updateBanner = document.getElementById('update-banner');
const updateButton = document.getElementById('update-btn');
const installBanner = document.getElementById('install-banner');
let firstRender = true;
let currentRoute = 'dashboard';

// Which nav link to highlight for each route ("job" belongs under "Jobs").
const NAV_FOR = { dashboard: 'dashboard', jobs: 'jobs', job: 'jobs', quote: 'quote', inventory: 'inventory', offline: 'offline', install: 'install' };

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
  installer.noteScreen();
  refreshInstallUi();
}

// ---- Quote form (event delegation, because the form is re-created on every visit) ----
outlet.addEventListener('submit', (event) => {
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

// ---- Online / offline indicator ----
function updateNetwork() {
  const online = navigator.onLine;
  netStatus.hidden = online;
  netStatus.textContent = online ? '' : 'You are offline. SunGrid Solar keeps working with the data on this device.';
}
window.addEventListener('online', () => {
  updateNetwork();
  worker.checkForUpdate(); // back in signal: good moment to look for a new version
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

  if (action === 'install-now') {
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
