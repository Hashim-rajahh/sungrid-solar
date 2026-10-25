import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from '../js/router.js';
import { renderRoute, quoteResultHtml, stockStatus, offlineStatusHtml } from '../js/views.js';
import { calculateQuote } from '../js/quote.js';

const render = (hash, ctx) => renderRoute(resolve(hash), ctx);

// ---- main path ----
test('dashboard shows real jobs, stats and low-stock items', () => {
  const { title, html } = render('#/');
  assert.equal(title, 'Dashboard');
  assert.match(html, /Ahmed Raza/);
  assert.match(html, /Jobs in progress/);
  assert.match(html, /Pipeline value/);
  assert.match(html, /Earthing kit/); // out of stock in the sample data
});

test('jobs list shows every sample job and a working filter', () => {
  const all = render('#/jobs').html;
  assert.match(all, /SG-1042/);
  assert.match(all, /Al-Noor Medical Centre/);

  const filtered = render('#/jobs?status=Installing').html;
  assert.match(filtered, /Ayesha Siddiqui/);
  assert.doesNotMatch(filtered, /Ahmed Raza/);
});

test('job detail shows system sizing and the DISCO for the city', () => {
  const { title, html } = render('#/jobs/SG-1042');
  assert.equal(title, 'SG-1042');
  assert.match(html, /18 × 575 W = 10\.35 kWp/);
  assert.match(html, /LESCO/);
  assert.match(html, /Rs 17,20,000/);
});

test('inventory lists out-of-stock and reorder items before healthy ones', () => {
  const { html } = render('#/inventory');
  assert.ok(html.indexOf('Earthing kit') < html.indexOf('MNT-AL5'), 'out-of-stock item should come first');
  assert.match(html, /Out of stock/);
  assert.match(html, /Reorder now/);
});

test('quote page renders a labelled form', () => {
  const { html } = render('#/quote');
  assert.match(html, /<label for="units">/);
  assert.match(html, /<label for="city">/);
  assert.match(html, /<label for="type">/);
  assert.match(html, /id="quote-result"/);
});

test('quote result shows the numbers for a valid quote', () => {
  const html = quoteResultHtml(calculateQuote({ units: '600', city: 'Lahore', type: 'On-grid' }));
  assert.match(html, /5\.18 kWp On-grid/);
  assert.match(html, /Rs 8,28,000/);
});

// ---- failure paths ----
test('unknown route renders a friendly not-found page', () => {
  const { title, html } = render('#/does-not-exist');
  assert.equal(title, 'Page not found');
  assert.match(html, /Go to dashboard/);
});

test('unknown job id renders a clear message, not a crash', () => {
  const { title, html } = render('#/jobs/SG-9999');
  assert.equal(title, 'Job not found');
  assert.match(html, /There is no job &quot;SG-9999&quot;/);
});

test('user-controlled text from the URL is escaped (no HTML injection)', () => {
  const evilId = encodeURIComponent('<img src=x onerror=alert(1)>');
  const html = render(`#/jobs/${evilId}`).html;
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);

  const evilStatus = encodeURIComponent('<script>alert(1)</script>');
  assert.doesNotMatch(render(`#/jobs?status=${evilStatus}`).html, /<script>/);
  assert.doesNotMatch(render(`#/${evilStatus}`).html, /<script>/);
});

test('unknown status filter explains itself', () => {
  const { html } = render('#/jobs?status=Banana');
  assert.match(html, /Unknown status/);
  assert.match(html, /not a job status/);
});

test('empty data shows empty states instead of blank pages or errors', () => {
  const empty = { jobs: [], inventory: [] };
  assert.match(render('#/', empty).html, /Nothing here yet/);
  assert.match(render('#/jobs', empty).html, /No jobs yet/);
  assert.match(render('#/inventory', empty).html, /No stock recorded/);
});

test('a status with zero jobs says so', () => {
  const onlyOne = { jobs: [{ id: 'SG-1', customer: 'A', site: 'S', city: 'Lahore', type: 'On-grid', panels: 1, panelWatt: 575, inverter: 'X', batteries: 0, status: 'Quoted', valuePkr: 1, nextStep: 'n', nextDate: '2026-10-25' }] };
  assert.match(render('#/jobs?status=Installing', onlyOne).html, /No jobs are at &quot;Installing&quot;/);
});

test('invalid quote input renders each error message', () => {
  const html = quoteResultHtml(calculateQuote({ units: '', city: '', type: '' }));
  assert.match(html, /Please fix the following/);
  assert.match(html, /Enter your average monthly units/);
  assert.match(html, /Choose the city/);
});

test('a view that throws is turned into the error page', () => {
  const original = console.error;
  console.error = () => {}; // keep test output clean
  try {
    const broken = { jobs: [null], inventory: [] }; // corrupt record -> the view throws
    const { title } = render('#/', broken);
    assert.equal(title, 'Something went wrong');
  } finally {
    console.error = original;
  }
});

test('stockStatus classifies zero, at-reorder and healthy stock', () => {
  assert.equal(stockStatus({ stock: 0, reorderLevel: 5 }).key, 'out');
  assert.equal(stockStatus({ stock: 5, reorderLevel: 5 }).key, 'low');
  assert.equal(stockStatus({ stock: 6, reorderLevel: 5 }).key, 'ok');
});

// ---- Task 2: Offline page ----
test('offline page lists what works with no signal, using the real sample data counts', () => {
  const { title, html } = render('#/offline');
  assert.equal(title, 'Offline');
  assert.match(html, /8 job sheets/);
  assert.match(html, /10 stock items/);
  assert.match(html, /LESCO, GEPCO, FESCO, MEPCO, IESCO/);
  assert.match(html, /data-action="offline-refresh"/);
  assert.match(html, /data-action="offline-clear"/);
  assert.match(html, /id="offline-status"/);
});

test('offline page does not crash with empty data', () => {
  const { html } = render('#/offline', { jobs: [], inventory: [] });
  assert.match(html, /0 job sheets/);
});

test('status card shows tone, details and an extra note, and escapes everything', () => {
  const html = offlineStatusHtml(
    { tone: 'bad', title: '<b>Oops</b>', message: 'm', details: [{ label: 'L', value: '<script>x</script>' }] },
    'note & more',
  );
  assert.match(html, /card-error/);
  assert.match(html, /&lt;b&gt;Oops/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /note &amp; more/);
  assert.match(offlineStatusHtml({ tone: 'ok', title: 't', message: 'm', details: [] }), /card-ok/);
});
