import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, matchRoute, resolve } from '../js/router.js';

// ---- main path ----
test('each known hash resolves to the right route', () => {
  assert.equal(resolve('').name, 'dashboard');
  assert.equal(resolve('#/').name, 'dashboard');
  assert.equal(resolve('#/jobs').name, 'jobs');
  assert.equal(resolve('#/quote').name, 'quote');
  assert.equal(resolve('#/inventory').name, 'inventory');
  assert.equal(resolve('#/offline').name, 'offline');
});

test('a job route captures its id', () => {
  const route = resolve('#/jobs/SG-1042');
  assert.equal(route.name, 'job');
  assert.deepEqual(route.params, { id: 'SG-1042' });
});

test('query string is parsed and decoded', () => {
  const route = resolve('#/jobs?status=Site%20survey&x=a+b');
  assert.equal(route.name, 'jobs');
  assert.deepEqual(route.query, { status: 'Site survey', x: 'a b' });
});

test('trailing slashes and a missing leading slash are normalised', () => {
  assert.equal(parseHash('#/jobs/').path, '/jobs');
  assert.equal(parseHash('#jobs').path, '/jobs');
  assert.equal(parseHash('#//').path, '/');
});

// ---- failure paths ----
test('unknown paths give not-found instead of throwing', () => {
  assert.equal(resolve('#/nope').name, 'not-found');
  assert.equal(resolve('#/jobs/SG-1/extra').name, 'not-found');
  assert.equal(resolve('#/jobs//x').name, 'not-found');
});

test('malformed percent-encoding does not crash the router', () => {
  assert.doesNotThrow(() => resolve('#/jobs/%E0%A4%A'));
  assert.equal(resolve('#/jobs/%E0%A4%A').name, 'not-found');
  assert.deepEqual(resolve('#/jobs?status=%E0%A4%A').query, {});
});

test('garbage input (undefined, numbers, objects) falls back to the dashboard', () => {
  for (const bad of [undefined, null, 42, {}, []]) {
    assert.equal(resolve(bad).name, 'dashboard');
  }
});

test('matchRoute works directly on a path', () => {
  assert.deepEqual(matchRoute('/jobs/SG%2D1').params, { id: 'SG-1' });
});
