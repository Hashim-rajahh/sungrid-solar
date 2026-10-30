import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectPlatform,
  describeInstall,
  createInstallController,
  bannerCopy,
  STORAGE_KEY,
  SNOOZE_DAYS,
  SCREENS_BEFORE_PROMPT,
} from '../js/install.js';

const DAY = 24 * 60 * 60 * 1000;

const UA = {
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1',
  desktopChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
};

/** A fake window that records listeners so tests can fire browser events. */
function fakeWindow(extra = {}) {
  const listeners = {};
  return {
    listeners,
    addEventListener(type, fn) { listeners[type] = fn; },
    isSecureContext: true,
    ...extra,
  };
}

/** A fake install offer like the browser's beforeinstallprompt event. */
function fakeOffer({ outcome = 'accepted', promptThrows = null, legacy = false } = {}) {
  const offer = {
    prevented: false,
    promptCalls: 0,
    preventDefault() { this.prevented = true; },
    async prompt() {
      this.promptCalls += 1;
      if (promptThrows) throw promptThrows;
      return legacy ? { outcome } : undefined;
    },
  };
  if (!legacy) offer.userChoice = Promise.resolve({ outcome });
  return offer;
}

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem(k, v) { data[k] = String(v); },
  };
}

function setup({ ua = UA.androidChrome, storage = memoryStorage(), clock = { t: 1_800_000_000_000 }, win } = {}) {
  const w = win ?? fakeWindow();
  let changes = 0;
  const controller = createInstallController({
    window: w,
    navigator: { userAgent: ua, serviceWorker: {} },
    storage,
    now: () => clock.t,
    onChange: () => { changes += 1; },
  });
  return { w, controller, storage, clock, changes: () => changes };
}

const screens = (controller, n) => { for (let i = 0; i < n; i++) controller.noteScreen(); };

// ---------- main path ----------

test('detectPlatform recognises Android Chrome, iPhone Safari and an iPad that calls itself a Mac', () => {
  assert.deepEqual(
    (({ ios, android, standalone }) => ({ ios, android, standalone }))(detectPlatform({ navigator: { userAgent: UA.androidChrome, serviceWorker: {} } })),
    { ios: false, android: true, standalone: false },
  );
  const iphone = detectPlatform({ navigator: { userAgent: UA.iphoneSafari } });
  assert.equal(iphone.ios, true);
  assert.equal(iphone.iosSafari, true);
  const ipad = detectPlatform({ navigator: { userAgent: UA.desktopChrome.replace('Windows NT 10.0; Win64; x64', 'Macintosh; Intel Mac OS X 10_15_7'), platform: 'MacIntel', maxTouchPoints: 5 } });
  assert.equal(ipad.ios, true, 'a Mac with a touch screen is an iPad');
  const mac = detectPlatform({ navigator: { userAgent: UA.desktopChrome, platform: 'MacIntel', maxTouchPoints: 0 } });
  assert.equal(mac.ios, false, 'a real Mac is not');
});

test('detectPlatform sees the installed app (display-mode or iOS standalone flag)', () => {
  const byMedia = detectPlatform({ navigator: {}, matchMedia: (q) => ({ matches: q === '(display-mode: standalone)' }) });
  assert.equal(byMedia.standalone, true);
  assert.equal(detectPlatform({ navigator: { standalone: true } }).standalone, true);
  assert.equal(detectPlatform({ navigator: {}, matchMedia: () => ({ matches: false }) }).standalone, false);
});

test('describeInstall: one verdict per situation, each with the right tone and next step', () => {
  const base = { platform: { ios: false, iosSafari: false, standalone: false, secure: true, hasServiceWorker: true }, canPrompt: false, installedNow: false, declined: false, error: null };
  assert.equal(describeInstall({ ...base, platform: { ...base.platform, standalone: true } }).state, 'installed');
  assert.equal(describeInstall({ ...base, installedNow: true }).state, 'installed');

  const ready = describeInstall({ ...base, canPrompt: true });
  assert.equal(ready.state, 'ready');
  assert.equal(ready.action, 'install');
  assert.equal(ready.tone, 'ok');

  const ios = describeInstall({ ...base, platform: { ...base.platform, ios: true, iosSafari: true } });
  assert.equal(ios.state, 'ios');
  assert.match(ios.steps.join(' '), /Add to Home Screen/);

  const manual = describeInstall(base);
  assert.equal(manual.state, 'manual');
  assert.match(manual.steps.join(' '), /Install app/);
  assert.match(manual.message, /WhatsApp/);
});

test('the browser offer is kept (not shown at a random moment), and the verdict becomes "ready"', () => {
  const { w, controller, changes } = setup();
  assert.equal(controller.status().state, 'manual');
  const offer = fakeOffer();
  w.listeners.beforeinstallprompt(offer);
  assert.equal(offer.prevented, true, 'the browser mini-bar must be suppressed so we choose the moment');
  assert.equal(controller.status().state, 'ready');
  assert.ok(changes() > 0, 'the page is told to redraw');
});

test('the install bar waits until the person has used the app', () => {
  const { w, controller } = setup();
  w.listeners.beforeinstallprompt(fakeOffer());
  assert.equal(controller.shouldShowBanner(), false, 'not on the very first screen');
  screens(controller, SCREENS_BEFORE_PROMPT - 1);
  assert.equal(controller.shouldShowBanner(), false);
  controller.noteScreen();
  assert.equal(controller.shouldShowBanner(), true);
  assert.match(bannerCopy(controller.status()).text, /works with no signal/);
});

test('accepting the install window installs and hides the bar', async () => {
  const { w, controller } = setup();
  const offer = fakeOffer({ outcome: 'accepted' });
  w.listeners.beforeinstallprompt(offer);
  screens(controller, 3);
  const result = await controller.promptInstall();
  assert.deepEqual(result, { ok: true, outcome: 'accepted' });
  assert.equal(offer.promptCalls, 1);
  assert.equal(controller.status().state, 'installed');
  assert.equal(controller.shouldShowBanner(), false);
});

test('the appinstalled event (installed from the browser menu) is also noticed', () => {
  const { w, controller } = setup();
  w.listeners.beforeinstallprompt(fakeOffer());
  screens(controller, 3);
  w.listeners.appinstalled();
  assert.equal(controller.status().state, 'installed');
  assert.equal(controller.shouldShowBanner(), false);
});

test('"Not now" is remembered for 14 days, then the bar may return', () => {
  const clock = { t: 1_800_000_000_000 };
  const storage = memoryStorage();
  const { w, controller } = setup({ storage, clock });
  w.listeners.beforeinstallprompt(fakeOffer());
  screens(controller, 3);
  assert.equal(controller.shouldShowBanner(), true);

  controller.snooze();
  assert.equal(controller.shouldShowBanner(), false);
  assert.equal(JSON.parse(storage.data[STORAGE_KEY]).snoozeUntil, clock.t + SNOOZE_DAYS * DAY);

  clock.t += (SNOOZE_DAYS - 1) * DAY;
  assert.equal(controller.shouldShowBanner(), false, 'still quiet on day 13');
  clock.t += 2 * DAY;
  assert.equal(controller.shouldShowBanner(), true, 'may return after 14 days');
});

test('the snooze survives a new visit (a new controller reads the saved choice)', () => {
  const storage = memoryStorage();
  const first = setup({ storage });
  first.controller.snooze();
  const second = setup({ storage, clock: first.clock });
  second.w.listeners.beforeinstallprompt(fakeOffer());
  screens(second.controller, 5);
  assert.equal(second.controller.shouldShowBanner(), false);
});

test('iPhone Safari gets the bar too, but with "how", because there is no install button there', () => {
  const { controller } = setup({ ua: UA.iphoneSafari });
  screens(controller, 3);
  assert.equal(controller.shouldShowBanner(), true);
  const copy = bannerCopy(controller.status());
  assert.equal(copy.link, true);
  assert.equal(copy.primary, 'Show me how');
});

// ---------- failure paths ----------

test('asking to install when the browser never offered gives a clear message, not an error', async () => {
  const { controller } = setup();
  const result = await controller.promptInstall();
  assert.equal(result.ok, false);
  assert.match(result.message, /browser menu/);
});

test('a broken install window is reported and the offer is not reused', async () => {
  const { w, controller } = setup();
  const offer = fakeOffer({ promptThrows: new Error('InvalidStateError') });
  w.listeners.beforeinstallprompt(offer);
  const result = await controller.promptInstall();
  assert.equal(result.ok, false);
  assert.match(result.message, /refused to open the install window \(InvalidStateError\)/);
  assert.equal(controller.status().state, 'error');
  assert.ok(controller.status().steps.length > 0, 'manual steps are still offered');

  const again = await controller.promptInstall();
  assert.equal(again.ok, false, 'a used offer cannot be prompted twice');
  assert.equal(offer.promptCalls, 1);
});

test('cancelling the install window is not an error: friendly message, and the bar rests', async () => {
  const { w, controller, storage } = setup();
  w.listeners.beforeinstallprompt(fakeOffer({ outcome: 'dismissed' }));
  screens(controller, 3);
  const result = await controller.promptInstall();
  assert.deepEqual(result, { ok: true, outcome: 'dismissed' });
  assert.equal(controller.status().state, 'declined');
  assert.equal(controller.shouldShowBanner(), false);
  assert.ok(storage.data[STORAGE_KEY], 'the choice is remembered');
});

test('older browsers that return the choice from prompt() directly still work', async () => {
  const { w, controller } = setup();
  w.listeners.beforeinstallprompt(fakeOffer({ legacy: true, outcome: 'accepted' }));
  assert.deepEqual(await controller.promptInstall(), { ok: true, outcome: 'accepted' });
});

test('blocked or full storage: "Not now" still works for this visit and nothing throws', () => {
  const storage = {
    getItem() { throw new Error('SecurityError'); },
    setItem() { throw new Error('QuotaExceededError'); },
  };
  const { w, controller } = setup({ storage });
  w.listeners.beforeinstallprompt(fakeOffer());
  screens(controller, 3);
  assert.equal(controller.shouldShowBanner(), true, 'unreadable storage does not hide the bar');
  assert.doesNotThrow(() => controller.snooze());
  assert.equal(controller.shouldShowBanner(), false, 'the in-memory copy keeps it quiet');
});

test('no storage at all (private window) behaves the same', () => {
  const { w, controller } = setup({ storage: null });
  w.listeners.beforeinstallprompt(fakeOffer());
  screens(controller, 3);
  controller.snooze();
  assert.equal(controller.shouldShowBanner(), false);
});

test('damaged saved data is ignored: garbage text, wrong types, and an impossible far-future date', () => {
  for (const raw of ['not json', '{"snoozeUntil":"tomorrow"}', 'null', '[]', '{"snoozeUntil":9e15}', '{"snoozeUntil":null}']) {
    const { w, controller } = setup({ storage: memoryStorage({ [STORAGE_KEY]: raw }) });
    w.listeners.beforeinstallprompt(fakeOffer());
    screens(controller, 3);
    assert.equal(controller.shouldShowBanner(), true, `bar should not be hidden by: ${raw}`);
  }
});

test('an insecure address or a browser without service workers says install is unavailable', () => {
  const insecure = createInstallController({ window: fakeWindow({ isSecureContext: false }), navigator: { userAgent: UA.androidChrome, serviceWorker: {} } });
  assert.equal(insecure.status().state, 'unsupported');
  assert.match(insecure.status().message, /https/);

  const noWorker = createInstallController({ window: fakeWindow(), navigator: { userAgent: UA.desktopChrome } });
  assert.equal(noWorker.status().state, 'unsupported');
  screens(noWorker, 5);
  assert.equal(noWorker.shouldShowBanner(), false);
});

test('Chrome on iPhone is told to use Safari, and gets no bar it cannot act on', () => {
  const { controller } = setup({ ua: UA.iphoneChrome });
  screens(controller, 5);
  assert.equal(controller.status().state, 'ios-other');
  assert.match(controller.status().steps[0], /Safari/);
  assert.equal(controller.shouldShowBanner(), false);
});

test('odd inputs never throw: an event without preventDefault, a window without listeners, matchMedia that throws', () => {
  const { w } = setup();
  assert.doesNotThrow(() => w.listeners.beforeinstallprompt({ prompt() {} }));
  assert.doesNotThrow(() => createInstallController({ window: {}, navigator: {} }).status());
  assert.doesNotThrow(() => createInstallController({ window: undefined, navigator: undefined }).status());
  assert.doesNotThrow(() => detectPlatform({ navigator: {}, matchMedia() { throw new Error('boom'); } }));
});

test('already installed: no bar even with an offer and a long visit', () => {
  const { w, controller } = setup({ win: fakeWindow({ matchMedia: () => ({ matches: true }) }) });
  w.listeners.beforeinstallprompt(fakeOffer());
  screens(controller, 10);
  assert.equal(controller.status().state, 'installed');
  assert.equal(controller.shouldShowBanner(), false);
});

test('a named browser error (NotAllowedError) is shown with both its kind and its reason', async () => {
  const { w, controller } = setup();
  const err = Object.assign(new Error('Needs a user gesture'), { name: 'NotAllowedError' });
  w.listeners.beforeinstallprompt(fakeOffer({ promptThrows: err }));
  const result = await controller.promptInstall();
  assert.match(result.message, /\(NotAllowedError: Needs a user gesture\)/);
  const bare = setup();
  bare.w.listeners.beforeinstallprompt(fakeOffer({ promptThrows: new Error() }));
  assert.match((await bare.controller.promptInstall()).message, /\(unknown reason\)/);
});
