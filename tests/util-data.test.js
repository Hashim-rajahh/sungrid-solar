import test from 'node:test';
import assert from 'node:assert/strict';
import { esc, formatPkr, formatDate, formatNumber, slug } from '../js/util.js';
import { jobs, inventory, STATUSES, cities } from '../js/data.js';

// ---- helpers ----
test('formatPkr uses lakh/crore grouping', () => {
  assert.equal(formatPkr(0), 'Rs 0');
  assert.equal(formatPkr(950), 'Rs 950');
  assert.equal(formatPkr(12345), 'Rs 12,345');
  assert.equal(formatPkr(1720000), 'Rs 17,20,000');
  assert.equal(formatPkr(123456789), 'Rs 12,34,56,789');
});

test('formatPkr, formatDate and formatNumber survive bad input', () => {
  assert.equal(formatPkr(NaN), '—');
  assert.equal(formatPkr(undefined), '—');
  assert.equal(formatPkr('12'), '—');
  assert.equal(formatDate('not a date'), '—');
  assert.equal(formatDate('2026-13-40'), '—');
  assert.equal(formatDate(undefined), '—');
  assert.equal(formatNumber(Infinity), '—');
});

test('formatDate and formatNumber format valid input', () => {
  assert.equal(formatDate('2026-10-24'), '24 Oct 2026');
  assert.equal(formatNumber(1234.5, 1), '1,234.5');
  assert.equal(formatNumber(605.475), '605');
});

test('formatNumber rounds half-up despite floating-point error (regression: 5.175 showed as 5.17)', () => {
  assert.equal(formatNumber(5.175, 2), '5.18');
  assert.equal(formatNumber(1.005, 2), '1.01');
  assert.equal(formatNumber(10.35, 2), '10.35');
  assert.equal(formatNumber(0, 2), '0.00');
  assert.equal(formatNumber(1234567.891, 1), '1,234,567.9');
});

test('esc neutralises HTML and tolerates null', () => {
  assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(0), '0');
});

test('slug makes safe class names', () => {
  assert.equal(slug('Net-metering'), 'net-metering');
  assert.equal(slug('Site survey'), 'site-survey');
});

// ---- sample data integrity (the mentor checks for realistic data, no lorem ipsum) ----
test('sample data contains no placeholder text', () => {
  const blob = JSON.stringify({ jobs, inventory }).toLowerCase();
  for (const bad of ['lorem', 'ipsum', 'foo', 'bar baz', 'test user', 'example.com', 'tbd', 'xxx']) {
    assert.ok(!blob.includes(bad), `sample data should not contain "${bad}"`);
  }
});

test('every job is internally consistent', () => {
  const ids = new Set();
  for (const j of jobs) {
    assert.ok(!ids.has(j.id), `duplicate job id ${j.id}`);
    ids.add(j.id);
    assert.ok(STATUSES.includes(j.status), `${j.id}: unknown status ${j.status}`);
    assert.ok(Object.hasOwn(cities, j.city), `${j.id}: unknown city ${j.city}`);
    assert.ok(['On-grid', 'Hybrid'].includes(j.type), `${j.id}: bad type`);
    assert.ok(j.panels > 0 && j.panelWatt >= 400, `${j.id}: unrealistic panels`);
    assert.ok(j.valuePkr > 100000, `${j.id}: unrealistic value`);
    assert.match(j.nextDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(j.type === 'Hybrid', j.batteries > 0, `${j.id}: only hybrid systems have batteries`);
  }
});

test('every status in the pipeline is used by at least one job', () => {
  for (const s of STATUSES) assert.ok(jobs.some((j) => j.status === s), `no sample job at "${s}"`);
});

test('inventory is valid and has a mix of healthy, low and empty stock', () => {
  const skus = new Set();
  for (const i of inventory) {
    assert.ok(!skus.has(i.sku), `duplicate sku ${i.sku}`);
    skus.add(i.sku);
    assert.ok(Number.isInteger(i.stock) && i.stock >= 0, `${i.sku}: bad stock`);
    assert.ok(i.unitPricePkr > 0, `${i.sku}: bad price`);
  }
  assert.ok(inventory.some((i) => i.stock === 0));
  assert.ok(inventory.some((i) => i.stock > 0 && i.stock <= i.reorderLevel));
  assert.ok(inventory.some((i) => i.stock > i.reorderLevel));
});
