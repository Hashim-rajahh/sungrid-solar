// A very small fake browser so js/app.js can run in Node. Not a general DOM: it has only what app.js touches.

function element() {
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

const IDS = [
  'app', 'net-status', 'offline-ready', 'update-banner', 'update-btn', 'install-banner', 'install-banner-text',
  'install-btn', 'install-how', 'install-later', 'nav-install', 'install-status', 'offline-status',
  'quote-result', 'units', 'city', 'type', 'units-err', 'city-err', 'type-err',
];

/**
 * Installs window, document, navigator, FormData as globals.
 * Elements that only exist on one page (install-status, offline-status) are found only while that page is on screen,
 * like in a real browser.
 */
export function installFakeBrowser({ windowExtras = {}, navigatorExtras = {} } = {}) {
  const elements = {};
  for (const id of IDS) elements[id] = element();
  for (const id of ['install-banner', 'install-how']) elements[id].hidden = true;

  const windowListeners = {};
  const fakeWindow = {
    location: { hash: '' },
    addEventListener(type, fn) { windowListeners[type] = fn; },
    scrollTo() {},
  };
  // Copy descriptors, not values, so a getter that throws (blocked site storage) stays lazy like in a real browser.
  Object.defineProperties(fakeWindow, Object.getOwnPropertyDescriptors(windowExtras));
  const pageOnly = { 'install-status': 'id="install-status"', 'offline-status': 'id="offline-status"' };
  const fakeDocument = {
    title: '',
    getElementById(id) {
      if (pageOnly[id]) return elements.app.innerHTML.includes(pageOnly[id]) ? elements[id] : null;
      return elements[id];
    },
    querySelectorAll: () => [],
  };

  globalThis.window = fakeWindow;
  globalThis.document = fakeDocument;
  globalThis.FormData = class { constructor(form) { this.values = form.values; } get(k) { return this.values[k]; } };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      onLine: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36',
      serviceWorker: {
        controller: null,
        addEventListener() {},
        getRegistration: async () => undefined,
        register: async () => { throw new Error('Service workers need http(s), not file://'); },
        ready: new Promise(() => {}),
      },
      ...navigatorExtras,
    },
  });

  return {
    elements,
    window: fakeWindow,
    windowListeners,
    goto(hash) { fakeWindow.location.hash = hash; windowListeners.hashchange(); },
    /** Click something that carries data-action inside the page. */
    clickAction(action) { return elements.app.listeners.click({ target: { closest: () => ({ dataset: { action } }) } }); },
  };
}

/** A fake install offer, like the browser's beforeinstallprompt event. */
export function fakeOffer({ outcome = 'accepted', promptThrows = null } = {}) {
  return {
    prevented: false,
    promptCalls: 0,
    preventDefault() { this.prevented = true; },
    async prompt() { this.promptCalls += 1; if (promptThrows) throw promptThrows; },
    userChoice: Promise.resolve({ outcome }),
  };
}
