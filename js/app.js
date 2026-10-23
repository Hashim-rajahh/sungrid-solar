// Browser entry point: wires the router to the page. All real logic lives in router.js / views.js / quote.js.

import { resolve } from './router.js';
import { renderRoute, quoteResultHtml } from './views.js';
import { calculateQuote } from './quote.js';
import { company } from './data.js';

const outlet = document.getElementById('app');
const netStatus = document.getElementById('net-status');
const offlineBadge = document.getElementById('offline-ready');
let firstRender = true;

// Which nav link to highlight for each route ("job" belongs under "Jobs").
const NAV_FOR = { dashboard: 'dashboard', jobs: 'jobs', job: 'jobs', quote: 'quote', inventory: 'inventory' };

function render() {
  const route = resolve(window.location.hash);
  const { title, html } = renderRoute(route);

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
window.addEventListener('online', updateNetwork);
window.addEventListener('offline', updateNetwork);

// ---- Service worker (offline support) ----
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('./sw.js');
    await navigator.serviceWorker.ready;
    offlineBadge.textContent = 'Ready for offline use ✓';
  } catch (err) {
    // Not fatal: the app still works online. Typical cause: opened via file:// instead of http(s).
    console.warn('Offline support unavailable:', err);
    offlineBadge.textContent = 'Offline mode unavailable in this browser';
  }
}

window.addEventListener('hashchange', render);
updateNetwork();
render();
registerServiceWorker();
