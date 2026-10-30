// Install prompt logic. No DOM access: browser objects are passed in (`env`), so every branch
// can be tested in Node with fakes.
//
// What it decides:
//   - what state the device is in (already installed, one tap away, needs manual steps, cannot install)
//   - when it is polite to show the install bar (after the person has used the app, never twice in a row)
//   - what happens when the install window is opened, cancelled, or breaks

export const STORAGE_KEY = 'sungrid.install.v1';
export const SNOOZE_DAYS = 14;
export const SCREENS_BEFORE_PROMPT = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Home-screen shortcuts (press and hold the installed icon on Android).
 * manifest.webmanifest must list exactly these; a test compares the two.
 */
export const SHORTCUTS = [
  {
    name: 'New quote',
    short_name: 'Quote',
    description: "Size a system from a customer's electricity bill",
    url: './#/quote',
    icon: 'icons/shortcut-quote-96.png',
  },
  {
    name: 'Installs in progress',
    short_name: 'Installs',
    description: 'Jobs that are being installed right now',
    url: './#/jobs?status=Installing',
    icon: 'icons/shortcut-jobs-96.png',
  },
  {
    name: 'Stock to reorder',
    short_name: 'Stock',
    description: 'Panels, inverters and batteries at or below reorder level',
    url: './#/inventory',
    icon: 'icons/shortcut-stock-96.png',
  },
];

// ---------- what kind of device is this? ----------

/**
 * @param {{navigator?: object, matchMedia?: Function, isSecureContext?: boolean}} env
 */
export function detectPlatform(env = {}) {
  const nav = env.navigator ?? {};
  const ua = String(nav.userAgent ?? '');

  // iPadOS reports itself as a Mac; a Mac with a touch screen is an iPad.
  const iPadAsMac = nav.platform === 'MacIntel' && Number(nav.maxTouchPoints) > 1;
  const ios = /iPhone|iPad|iPod/.test(ua) || iPadAsMac;
  // On iOS only Safari offers "Add to Home Screen" reliably; Chrome, Firefox, Edge and in-app browsers wrap it.
  const iosSafari = ios && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA|FBAN|FBAV|Instagram/.test(ua);

  let standalone = nav.standalone === true; // iOS home-screen apps
  try {
    if (typeof env.matchMedia === 'function') {
      for (const mode of ['standalone', 'fullscreen', 'minimal-ui']) {
        if (env.matchMedia(`(display-mode: ${mode})`)?.matches) standalone = true;
      }
    }
  } catch {
    /* matchMedia can throw in odd embedded browsers; treat as "not installed" */
  }

  return {
    ios,
    iosSafari,
    android: /Android/i.test(ua),
    standalone,
    secure: env.isSecureContext !== false,
    hasServiceWorker: Boolean(nav.serviceWorker),
  };
}

// ---------- plain-language verdict ----------

const IOS_STEPS = [
  'Tap the Share button (the square with an arrow) at the bottom of Safari.',
  'Scroll down and tap "Add to Home Screen".',
  'Tap "Add". SunGrid Solar now sits on your home screen.',
];

const IOS_OTHER_STEPS = [
  'Open this same address in Safari.',
  'Tap the Share button (the square with an arrow).',
  'Tap "Add to Home Screen", then "Add".',
];

const MANUAL_STEPS = [
  'Open the browser menu (the three dots).',
  'Tap "Install app" or "Add to Home screen".',
  'Confirm. SunGrid Solar now sits on your home screen.',
];

/**
 * Turn raw facts into one verdict. Checked in order of importance, so the most useful message wins.
 *
 * @param {{platform: object, canPrompt: boolean, installedNow: boolean, declined: boolean, error: string|null}} f
 * @returns {{state: string, tone: 'ok'|'warn'|'bad', title: string, message: string, steps: string[], action: null|'install', details: {label: string, value: string}[]}}
 */
export function describeInstall(f) {
  const p = f.platform;
  const done = (state, tone, title, message, extra = {}) => ({
    state,
    tone,
    title,
    message,
    steps: [],
    action: null,
    details: [],
    ...extra,
  });

  if (p.standalone || f.installedNow) {
    return done('installed', 'ok', 'SunGrid Solar is installed', 'You are using the installed app. Open it from your home screen, with or without signal.');
  }

  if (!p.secure || !p.hasServiceWorker) {
    return done(
      'unsupported',
      'bad',
      'Install is not available here',
      'This page cannot be installed from this browser or address. Open SunGrid Solar in Chrome, Edge or Safari using its https:// address, not a file on your computer.',
    );
  }

  if (f.canPrompt) {
    return done('ready', 'ok', 'Ready to install', 'Install SunGrid Solar on this device. It opens full screen from your home screen and works with no signal.', { action: 'install' });
  }

  if (f.declined) {
    return done(
      'declined',
      'warn',
      'Install was cancelled',
      'Nothing was changed. You can install later from the browser menu ("Install app" or "Add to Home screen"), or reload this page to be offered again.',
      { steps: MANUAL_STEPS },
    );
  }

  if (f.error) {
    return done('error', 'warn', 'The install window could not open', `${f.error} You can still install from the browser menu.`, { steps: MANUAL_STEPS });
  }

  if (p.ios) {
    return p.iosSafari
      ? done('ios', 'ok', 'Add SunGrid Solar to your home screen', 'iPhones and iPads do not show an install button, so it takes three taps in Safari.', { steps: IOS_STEPS })
      : done('ios-other', 'warn', 'Open this page in Safari to install', 'On iPhone and iPad, installing works from Safari. Copy this address into Safari, then follow these steps.', { steps: IOS_OTHER_STEPS });
  }

  return done(
    'manual',
    'warn',
    'Install from the browser menu',
    'Your browser has not offered a one-tap install yet. Use the menu instead. If you opened this link from WhatsApp or Facebook, open it in Chrome or Safari first.',
    { steps: MANUAL_STEPS },
  );
}

// ---------- the controller ----------

/** "NotAllowedError: Needs a user gesture": the error's name says what kind of failure, the message says why. */
function reasonOf(err) {
  const name = err && err.name && err.name !== 'Error' ? err.name : '';
  const message = err && err.message ? err.message : '';
  return [name, message].filter(Boolean).join(': ') || 'unknown reason';
}

function readSnoozeUntil(storage, now) {
  try {
    const raw = storage && storage.getItem(STORAGE_KEY);
    if (!raw) return 0;
    const value = JSON.parse(raw)?.snoozeUntil;
    if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
    // A value far beyond our own snooze length is damaged data, not a real choice.
    if (value - now > SNOOZE_DAYS * DAY_MS) return 0;
    return value;
  } catch {
    return 0;
  }
}

/**
 * @param {{window: object, navigator: object, storage?: object|null, now?: () => number, onChange?: () => void}} env
 */
export function createInstallController(env) {
  const win = env.window;
  const nav = env.navigator;
  const storage = env.storage ?? null;
  const now = env.now ?? (() => Date.now());
  const onChange = env.onChange ?? (() => {});

  let deferred = null; // the browser's install offer; it can be used only once
  let installedNow = false;
  let declined = false;
  let error = null;
  let screens = 0;
  let memorySnoozeUntil = 0; // used when storage is blocked or full

  const platform = () =>
    detectPlatform({
      navigator: nav,
      matchMedia: win && typeof win.matchMedia === 'function' ? (q) => win.matchMedia(q) : undefined,
      isSecureContext: win ? win.isSecureContext : undefined,
    });

  if (win && typeof win.addEventListener === 'function') {
    win.addEventListener('beforeinstallprompt', (event) => {
      // Keep the offer for later instead of letting the browser show its own bar at a random moment.
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      deferred = event;
      declined = false;
      error = null;
      onChange();
    });
    win.addEventListener('appinstalled', () => {
      installedNow = true;
      deferred = null;
      onChange();
    });
  }

  const snoozedUntil = () => Math.max(memorySnoozeUntil, readSnoozeUntil(storage, now()));

  function status() {
    return describeInstall({ platform: platform(), canPrompt: Boolean(deferred), installedNow, declined, error });
  }

  function snooze() {
    const until = now() + SNOOZE_DAYS * DAY_MS;
    memorySnoozeUntil = until;
    try {
      if (storage) storage.setItem(STORAGE_KEY, JSON.stringify({ snoozeUntil: until }));
    } catch {
      /* storage full or blocked: the in-memory copy still covers this visit */
    }
    onChange();
  }

  return {
    status,

    /** Call once per screen the person opens. */
    noteScreen() {
      screens += 1;
    },

    /** The bar is shown only when it can help and will not feel pushy. */
    shouldShowBanner() {
      const p = platform();
      if (p.standalone || installedNow) return false;
      if (screens < SCREENS_BEFORE_PROMPT) return false;
      if (now() < snoozedUntil()) return false;
      return Boolean(deferred) || (p.iosSafari && p.secure);
    },

    /** "Not now": stay quiet for SNOOZE_DAYS days. */
    snooze,

    /**
     * Open the browser's install window.
     * @returns {Promise<{ok: boolean, outcome?: 'accepted'|'dismissed', message?: string}>}
     */
    async promptInstall() {
      if (!deferred) {
        return { ok: false, message: 'The browser has not offered installing yet. Use the browser menu: "Install app" or "Add to Home screen".' };
      }
      const offer = deferred;
      deferred = null; // an offer cannot be reused, even if this attempt fails
      try {
        const direct = await offer.prompt();
        const choice = offer.userChoice ? await offer.userChoice : direct;
        if (choice && choice.outcome === 'accepted') {
          installedNow = true;
          return { ok: true, outcome: 'accepted' };
        }
        declined = true;
        snooze();
        return { ok: true, outcome: 'dismissed' };
      } catch (err) {
        error = `The browser refused to open the install window (${reasonOf(err)}).`;
        return { ok: false, message: error };
      } finally {
        onChange();
      }
    },
  };
}

/** Text for the install bar, from the current verdict. */
export function bannerCopy(status) {
  if (status.state === 'ready') {
    return { text: 'Install SunGrid Solar on this device. It opens from your home screen and works with no signal.', primary: 'Install', link: false };
  }
  return { text: 'Keep SunGrid Solar on your home screen. It works with no signal on site.', primary: 'Show me how', link: true };
}
