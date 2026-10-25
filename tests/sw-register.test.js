// Tests the update flow (js/sw-register.js) with fake service worker objects.

import test from 'node:test';
import assert from 'node:assert/strict';
import { setupServiceWorker } from '../js/sw-register.js';

const tick = () => new Promise((r) => setTimeout(r, 5));

class FakeWorker extends EventTarget {
  constructor(state = 'installing') { super(); this.state = state; this.messages = []; }
  postMessage(m) { this.messages.push(m); }
  setState(state) { this.state = state; this.dispatchEvent(new Event('statechange')); }
}

class FakeRegistration extends EventTarget {
  constructor() { super(); this.waiting = null; this.installing = null; this.updateCalls = 0; this.updateError = null; }
  async update() { this.updateCalls++; if (this.updateError) throw new Error(this.updateError); }
  /** simulate the browser finding a new sw.js */
  startUpdate() { this.installing = new FakeWorker(); this.dispatchEvent(new Event('updatefound')); return this.installing; }
}

class FakeServiceWorker extends EventTarget {
  constructor({ controller = null, registration = new FakeRegistration(), registerError = null } = {}) {
    super();
    this.controller = controller;
    this.registration = registration;
    this.registerError = registerError;
    this.ready = Promise.resolve(registration);
  }
  async register() { if (this.registerError) throw new Error(this.registerError); return this.registration; }
  takeOver() { this.dispatchEvent(new Event('controllerchange')); }
}

function setup(swOptions) {
  const sw = new FakeServiceWorker(swOptions);
  const states = [];
  let reloads = 0;
  const api = setupServiceWorker({ navigator: { serviceWorker: sw }, onState: (s) => states.push(s.kind), reload: () => { reloads++; } });
  return { sw, api, states, reloads: () => reloads };
}

// ---------- main path ----------
test('first visit: reports ready, and the first takeover does not reload the page', async () => {
  const t = setup();
  await tick();
  assert.deepEqual(t.states, ['ready']);
  t.sw.takeOver(); // clients.claim() on a fresh install
  assert.equal(t.reloads(), 0);
});

test('update flow: found -> installed -> banner -> user taps -> takes over -> reloads exactly once', async () => {
  const t = setup({ controller: {} }); // an older version is already running
  await tick();

  const incoming = t.sw.registration.startUpdate();
  incoming.setState('installed');
  assert.deepEqual(t.states, ['ready', 'update-ready']);

  t.sw.registration.waiting = incoming; // the browser parks it as "waiting"
  t.api.applyUpdate();
  assert.deepEqual(incoming.messages, [{ type: 'SKIP_WAITING' }]);
  assert.equal(t.reloads(), 0, 'nothing reloads until the new worker really takes over');

  t.sw.takeOver();
  t.sw.takeOver(); // browsers can fire it twice; must not reload twice
  assert.equal(t.reloads(), 1);
});

test('an update that finished installing before this page opened is announced straight away', async () => {
  const registration = new FakeRegistration();
  registration.waiting = new FakeWorker('installed');
  const t = setup({ controller: {}, registration });
  await tick();
  assert.deepEqual(t.states, ['update-ready', 'ready']);
});

test('checkForUpdate: true when a new version is waiting afterwards', async () => {
  const t = setup({ controller: {} });
  await tick();
  assert.equal(await t.api.checkForUpdate(), false);
  assert.equal(t.sw.registration.updateCalls, 1);
  t.sw.registration.waiting = new FakeWorker('installed');
  assert.equal(await t.api.checkForUpdate(), true);
});

// ---------- failure paths ----------
test('registration failure is reported as unavailable (app keeps working online)', async () => {
  const t = setup({ registerError: 'Service workers need http(s)' });
  await tick();
  assert.deepEqual(t.states, ['unavailable']);
});

test('no service worker support at all: unavailable straight away, helpers are safe no-ops', async () => {
  const states = [];
  const api = setupServiceWorker({ navigator: {}, onState: (s) => states.push(s), reload() {} });
  assert.equal(states[0].kind, 'unavailable');
  assert.match(states[0].error, /not supported/);
  api.applyUpdate();
  assert.equal(await api.checkForUpdate(), false);
});

test('first install finishing is NOT announced as an update', async () => {
  const t = setup(); // no controller yet
  await tick();
  t.sw.registration.startUpdate().setState('installed');
  assert.deepEqual(t.states, ['ready']);
});

test('checking for updates while offline fails quietly and keeps the saved version', async () => {
  const t = setup({ controller: {} });
  await tick();
  t.sw.registration.updateError = 'Failed to fetch';
  assert.equal(await t.api.checkForUpdate(), false);
});

test('checkForUpdate / applyUpdate before registration finished, or with nothing waiting, do not throw', async () => {
  const t = setup({ controller: {} });
  assert.equal(await t.api.checkForUpdate(), false); // registration not resolved yet
  await tick();
  assert.doesNotThrow(() => t.api.applyUpdate()); // nothing waiting
});
