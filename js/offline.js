// Offline status for the "Offline" page. No DOM access: browser objects are passed in (`env`),
// so every branch can be tested in Node with fakes.

export const CACHE_PREFIX = 'sungrid-';

/** 1536 -> "1.5 KB", 5242880 -> "5.0 MB". Bad input -> "unknown". */
export function formatBytes(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return 'unknown';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Turn raw facts into one plain-language verdict plus a list of details.
 * Checked in order of severity, so the most important problem is the one the person reads.
 *
 * @param {{supported:boolean, online:boolean, controlled:boolean,
 *          worker:null|{version?:string, expected?:number, cached?:number, error?:string},
 *          updateReady:boolean, storage:null|{usage:number, quota:number}, error:string|null}} s
 * @returns {{state:string, tone:'ok'|'warn'|'bad', title:string, message:string, details:{label:string,value:string}[]}}
 */
export function describeStatus(s) {
  const details = [{ label: 'Connection', value: s.online ? 'Online' : 'Offline' }];

  if (!s.supported) {
    return {
      state: 'unsupported',
      tone: 'bad',
      title: 'Offline mode is not available here',
      message: 'This browser cannot save the app for offline use. Open SunGrid Solar in Chrome or Edge, using the https:// address (not a file on disk).',
      details,
    };
  }

  if (s.error) {
    return {
      state: 'error',
      tone: 'bad',
      title: 'Could not check offline storage',
      message: `${s.error} Press "Check again". If it keeps failing, reconnect to the internet and reload the page.`,
      details,
    };
  }

  if (!s.controlled) {
    return {
      state: 'installing',
      tone: 'warn',
      title: 'Setting up offline mode',
      message: 'The app is being saved on this device. Stay online and keep this page open for a few seconds, then press "Check again".',
      details,
    };
  }

  if (!s.worker || s.worker.error || typeof s.worker.cached !== 'number' || typeof s.worker.expected !== 'number') {
    return {
      state: 'no-answer',
      tone: 'warn',
      title: 'Offline status is not available yet',
      message: 'The offline helper did not answer. Reload the page once while online, then press "Check again".',
      details,
    };
  }

  const { version, expected, cached } = s.worker;
  details.push({ label: 'Saved on this device', value: `${cached} of ${expected} files` });
  details.push({ label: 'App version', value: String(version ?? 'unknown') });
  if (s.storage) {
    details.push({ label: 'Phone storage used by app', value: `${formatBytes(s.storage.usage)} of ${formatBytes(s.storage.quota)} available` });
  }
  details.push({ label: 'Update', value: s.updateReady ? 'New version ready, reload to apply' : 'Up to date' });

  if (cached < expected) {
    return {
      state: 'incomplete',
      tone: 'bad',
      title: 'Offline copy is incomplete',
      message: `Only ${cached} of ${expected} files are saved, so some screens may not open without signal. Connect to the internet and press "Check again".`,
      details,
    };
  }

  if (s.storage && s.storage.quota > 0 && s.storage.usage / s.storage.quota > 0.9) {
    return {
      state: 'storage-low',
      tone: 'warn',
      title: 'Phone storage is almost full',
      message: 'The phone may delete the saved app to free space. Free up some storage, then press "Check again".',
      details,
    };
  }

  if (s.updateReady) {
    return {
      state: 'update-ready',
      tone: 'warn',
      title: 'Ready offline, update available',
      message: 'Everything works offline now. A newer version is waiting: use "Reload to update" when you are not in the middle of a quote.',
      details,
    };
  }

  return {
    state: 'ready',
    tone: 'ok',
    title: 'Ready for site visits',
    message: `All ${expected} app files are saved on this device. Jobs, stock and the quote calculator work with no signal.`,
    details,
  };
}

/** Ask the active service worker how many files it has saved. Resolves null if it stays silent. */
export function askWorker(controller, timeoutMs = 2000) {
  return new Promise((resolve) => {
    if (!controller || typeof controller.postMessage !== 'function') return resolve(null);
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      resolve(null);
    }, timeoutMs);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(event.data ?? null);
    };
    try {
      controller.postMessage({ type: 'GET_STATUS' }, [channel.port2]);
    } catch {
      clearTimeout(timer);
      channel.port1.close(); // closing one end closes the pair; otherwise the open channel leaks
      resolve(null);
    }
  });
}

/**
 * Gather the facts from the browser and describe them. Never throws.
 * @param {{navigator: object, caches?: object, timeoutMs?: number}} env
 */
export async function collectStatus(env) {
  const nav = env.navigator ?? {};
  const online = nav.onLine !== false;
  const supported = Boolean(nav.serviceWorker) && Boolean(env.caches);
  const facts = { supported, online, controlled: false, worker: null, updateReady: false, storage: null, error: null };
  if (!supported) return describeStatus(facts);

  try {
    const registration = await nav.serviceWorker.getRegistration();
    facts.updateReady = Boolean(registration && registration.waiting);
    facts.controlled = Boolean(nav.serviceWorker.controller);

    if (facts.controlled) facts.worker = await askWorker(nav.serviceWorker.controller, env.timeoutMs ?? 2000);

    if (nav.storage && typeof nav.storage.estimate === 'function') {
      try {
        const { usage, quota } = await nav.storage.estimate();
        if (typeof usage === 'number' && typeof quota === 'number') facts.storage = { usage, quota };
      } catch {
        /* storage figures are a nice-to-have, never a reason to fail */
      }
    }
  } catch (err) {
    facts.error = err && err.message ? `Offline check failed (${err.message}).` : 'Offline check failed.';
  }
  return describeStatus(facts);
}

/** Remove the saved copy and the service worker. Returns { ok, deleted } or { ok:false, error }. */
export async function clearOfflineData(env) {
  try {
    if (!env.caches || !env.navigator?.serviceWorker) return { ok: false, error: 'Offline mode is not available in this browser.' };
    const names = (await env.caches.keys()).filter((k) => k.startsWith(CACHE_PREFIX));
    await Promise.all(names.map((k) => env.caches.delete(k)));
    const registration = await env.navigator.serviceWorker.getRegistration();
    if (registration) await registration.unregister();
    return { ok: true, deleted: names.length };
  } catch (err) {
    return { ok: false, error: `Could not remove the offline copy (${err && err.message ? err.message : 'unknown error'}).` };
  }
}
