// Wiring test for js/app.js using a minimal fake DOM (no browser or jsdom needed).
// It proves the router, views and quote form are connected correctly: first render, navigation,
// a rejected form submission, an accepted one, and a service-worker failure.

import test from 'node:test';
import assert from 'node:assert/strict';

// ---------- minimal fake browser ----------
function el() {
  const attrs = {};
  return {
    innerHTML: '',
    textContent: '',
    hidden: false,
    dataset: {},
    focused: false,
    listeners: {},
    attrs,
    addEventListener(type, fn) { this.listeners[type] = fn; },
    setAttribute(k, v) { attrs[k] = v; },
    removeAttribute(k) { delete attrs[k]; },
    focus() { this.focused = true; },
  };
}

const elements = {};
for (const id of ['app', 'net-status', 'offline-ready', 'quote-result', 'units', 'city', 'type', 'units-err', 'city-err', 'type-err']) {
  elements[id] = el();
}
const windowListeners = {};
const fakeWindow = {
  location: { hash: '' },
  addEventListener(type, fn) { windowListeners[type] = fn; },
  scrollTo() {},
};
const fakeDocument = {
  title: '',
  getElementById: (id) => elements[id],
  querySelectorAll: () => [],
};
class FakeFormData {
  constructor(form) { this.values = form.values; }
  get(key) { return this.values[key]; }
}

globalThis.window = fakeWindow;
globalThis.document = fakeDocument;
globalThis.FormData = FakeFormData;
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    onLine: true,
    serviceWorker: {
      register: async () => { throw new Error('Service workers need http(s), not file://'); },
      ready: new Promise(() => {}),
    },
  },
});

const submit = (values) => {
  const event = { target: { id: 'quote-form', values }, preventDefault() { this.prevented = true; } };
  elements.app.listeners.submit(event);
  return event;
};

// ---------- tests ----------
test('app renders the dashboard on first load', async () => {
  await import('../js/app.js');
  assert.match(elements.app.innerHTML, /Dashboard/);
  assert.match(elements.app.innerHTML, /Ahmed Raza/);
  assert.equal(fakeDocument.title, 'Dashboard · SunGrid Solar');
});

test('changing the hash navigates to another view', () => {
  fakeWindow.location.hash = '#/jobs/SG-1043';
  windowListeners.hashchange();
  assert.match(elements.app.innerHTML, /Ayesha Siddiqui/);
  assert.equal(fakeDocument.title, 'SG-1043 · SunGrid Solar');
  assert.equal(elements.app.focused, true, 'focus should move into the new page');
});

test('an unknown hash shows the not-found page, not a blank screen', () => {
  fakeWindow.location.hash = '#/typo';
  windowListeners.hashchange();
  assert.match(elements.app.innerHTML, /Page not found/);
});

test('submitting an empty quote form shows a message under each field and keeps the page alive', () => {
  fakeWindow.location.hash = '#/quote';
  windowListeners.hashchange();
  const event = submit({ units: '', city: '', type: '' });

  assert.equal(event.prevented, true, 'form must not reload the page');
  assert.match(elements['units-err'].textContent, /Enter your average monthly units/);
  assert.match(elements['city-err'].textContent, /Choose the city/);
  assert.match(elements['type-err'].textContent, /On-grid or Hybrid/);
  assert.equal(elements.units.attrs['aria-invalid'], 'true');
  assert.equal(elements.units.focused, true, 'focus goes to the first invalid field');
  assert.match(elements['quote-result'].innerHTML, /Please fix the following/);
});

test('submitting valid details shows the estimate and clears old errors', () => {
  submit({ units: '600', city: 'Lahore', type: 'On-grid' });
  assert.equal(elements['units-err'].textContent, '');
  assert.equal(elements.units.attrs['aria-invalid'], undefined);
  assert.match(elements['quote-result'].innerHTML, /5\.18 kWp On-grid system/);
  assert.match(elements['quote-result'].innerHTML, /Rs 8,28,000/);
});

test('submit events from other forms are ignored', () => {
  const before = elements['quote-result'].innerHTML;
  const event = { target: { id: 'something-else', values: {} }, preventDefault() { this.prevented = true; } };
  elements.app.listeners.submit(event);
  assert.equal(event.prevented, undefined);
  assert.equal(elements['quote-result'].innerHTML, before);
});

test('offline banner follows the network state', () => {
  globalThis.navigator.onLine = false;
  windowListeners.offline();
  assert.equal(elements['net-status'].hidden, false);
  assert.match(elements['net-status'].textContent, /You are offline/);

  globalThis.navigator.onLine = true;
  windowListeners.online();
  assert.equal(elements['net-status'].hidden, true);
});

test('a service-worker failure is reported gently and does not break the app', async () => {
  await new Promise((r) => setTimeout(r, 10)); // let the rejected register() settle
  assert.match(elements['offline-ready'].textContent, /Offline mode unavailable/);
});
