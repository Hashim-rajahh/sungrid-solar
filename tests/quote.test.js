import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateQuote, parseUnits } from '../js/quote.js';

// ---- main path (hand-calculated) ----
// 600 units/month in Lahore: 20 kWh/day. Yield per kWp per day = 5.0 h x 0.78 = 3.9 kWh.
// Need 20 / 3.9 = 5.128 kWp -> ceil(5128 / 575) = 9 panels -> 9 x 575 W = 5.175 kWp.
// On-grid cost = 5.175 x 160,000 = Rs 828,000.
// Generation = 5.175 x 3.9 x 30 = 605.475 kWh (covers 100%). Saving = 600 x 55 = Rs 33,000 / month.
// Payback = 828,000 / (33,000 x 12) = 2.09 years.
test('on-grid quote for 600 units in Lahore matches the hand calculation', () => {
  const q = calculateQuote({ units: '600', city: 'Lahore', type: 'On-grid' });
  assert.equal(q.ok, true);
  assert.equal(q.panels, 9);
  assert.equal(q.systemKw, 5.175);
  assert.equal(q.batteries, 0);
  assert.equal(q.costPkr, 828000);
  assert.equal(q.monthlySavingsPkr, 33000);
  assert.equal(q.offsetPercent, 100);
  assert.ok(Math.abs(q.paybackYears - 2.09) < 0.01);
  assert.equal(q.disco, 'LESCO');
});

test('hybrid quote adds batteries and costs more than on-grid', () => {
  const onGrid = calculateQuote({ units: 600, city: 'Lahore', type: 'On-grid' });
  const hybrid = calculateQuote({ units: 600, city: 'Lahore', type: 'Hybrid' });
  assert.equal(hybrid.ok, true);
  assert.equal(hybrid.batteries, 2); // ceil(5.175 / 5)
  assert.equal(hybrid.costPkr, Math.round(5.175 * 185000 + 2 * 395000));
  assert.ok(hybrid.costPkr > onGrid.costPkr);
});

test('sunnier cities need fewer panels for the same bill', () => {
  const lahore = calculateQuote({ units: 900, city: 'Lahore', type: 'On-grid' });
  const multan = calculateQuote({ units: 900, city: 'Multan', type: 'On-grid' });
  assert.ok(multan.panels < lahore.panels);
});

test('commas and spaces in the units box are accepted', () => {
  const q = calculateQuote({ units: ' 1,200 ', city: 'Faisalabad', type: 'On-grid' });
  assert.equal(q.ok, true);
  assert.equal(q.input.units, 1200);
  assert.equal(q.disco, 'FESCO');
});

// ---- failure paths ----
test('empty input gives a clear message instead of a crash', () => {
  for (const empty of ['', '   ', undefined, null]) {
    const q = calculateQuote({ units: empty, city: 'Lahore', type: 'On-grid' });
    assert.equal(q.ok, false);
    assert.match(q.errors.units, /Enter your average monthly units/);
  }
});

test('non-numeric, zero, negative, tiny and huge units are each rejected with their own message', () => {
  assert.match(parseUnits('abc').error, /must be a number/);
  assert.match(parseUnits('12abc').error, /must be a number/);
  assert.match(parseUnits('NaN').error, /must be a number/);
  assert.match(parseUnits('0').error, /greater than zero/);
  assert.match(parseUnits('-300').error, /greater than zero/);
  assert.match(parseUnits('20').error, /too small/);
  assert.match(parseUnits('99999').error, /commercial site survey/);
});

test('missing or unknown city and type are reported per field, together', () => {
  const q = calculateQuote({ units: '600', city: 'Atlantis', type: 'Nuclear' });
  assert.equal(q.ok, false);
  assert.ok(q.errors.city);
  assert.ok(q.errors.type);
  assert.equal(q.errors.units, undefined);
});

test('city names that are object prototype keys are not treated as cities', () => {
  const q = calculateQuote({ units: '600', city: 'constructor', type: 'On-grid' });
  assert.equal(q.ok, false);
  assert.ok(q.errors.city);
});

test('calculateQuote(undefined) does not throw', () => {
  const q = calculateQuote(undefined);
  assert.equal(q.ok, false);
  assert.equal(Object.keys(q.errors).length, 3);
});
