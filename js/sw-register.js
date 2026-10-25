// Registers the service worker and manages updates. No DOM access: it reports through `onState`,
// so the update flow can be tested in Node with fakes.
//
// States reported to onState:
//   { kind: 'ready' }          app is saved for offline use
//   { kind: 'update-ready' }   a newer version finished installing and is waiting for the user
//   { kind: 'unavailable', error }  offline mode cannot be used (not fatal: the app still works online)

/**
 * @param {{navigator: object, onState: (s: object) => void, reload: () => void, scriptUrl?: string}} env
 * @returns {{applyUpdate: () => void, checkForUpdate: () => Promise<boolean>}}
 */
export function setupServiceWorker(env) {
  const { navigator, onState, reload, scriptUrl = './sw.js' } = env;
  let registration = null;
  let reloading = false;
  let hadController = false;

  const noop = { applyUpdate() {}, checkForUpdate: async () => false };
  if (!navigator || !navigator.serviceWorker) {
    onState({ kind: 'unavailable', error: 'Service workers are not supported in this browser.' });
    return noop;
  }
  const sw = navigator.serviceWorker;
  hadController = Boolean(sw.controller);

  // When the waiting worker takes over, reload exactly once so the page and its files match.
  // Skip the very first takeover on a fresh install (no previous controller): nothing is stale.
  sw.addEventListener('controllerchange', () => {
    if (!hadController) {
      hadController = true;
      return;
    }
    if (reloading) return;
    reloading = true;
    reload();
  });

  function watch(reg) {
    if (reg.waiting && sw.controller) onState({ kind: 'update-ready' });
    reg.addEventListener('updatefound', () => {
      const incoming = reg.installing;
      if (!incoming) return;
      incoming.addEventListener('statechange', () => {
        // "installed" with an existing controller means: new version saved, old one still running.
        if (incoming.state === 'installed' && sw.controller) onState({ kind: 'update-ready' });
      });
    });
  }

  (async () => {
    try {
      registration = await sw.register(scriptUrl);
      watch(registration);
      await sw.ready;
      onState({ kind: 'ready' });
    } catch (err) {
      // Typical causes: opened from file://, private browsing in some browsers, or blocked by settings.
      onState({ kind: 'unavailable', error: err && err.message ? err.message : String(err) });
    }
  })();

  return {
    /** Tell the waiting worker to take over (the page reloads on controllerchange). */
    applyUpdate() {
      const waiting = registration && registration.waiting;
      if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' });
    },
    /** Ask the browser to look for a new sw.js now. Resolves true if a newer version is waiting. */
    async checkForUpdate() {
      if (!registration) return false;
      try {
        await registration.update();
      } catch {
        return false; // offline or server down: keep running the saved version
      }
      return Boolean(registration.waiting);
    },
  };
}
