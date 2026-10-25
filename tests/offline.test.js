import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes, describeStatus, collectStatus, clearOfflineData, askWorker } from '../js/offline.js';

const base = { supported: true, online: true, controlled: true, worker: { version: 'sungrid-abc12345', expected: 16, cached: 16 }, updateReady: false, storage: null, error: null };
const detail = (status, label) => status.details.find((d) => d.label === label)?.value;

// ---------- main path ----------
test('everything saved: "Ready for site visits" with the real counts', () => {
  const s = describeStatus(base);
  assert.equal(s.state, 'ready');
  assert.equal(s.tone, 'ok');
  assert.match(s.message, /All 16 app files are saved/);
  assert.equal(detail(s, 'Saved on this device'), '16 of 16 files');
  assert.equal(detail(s, 'App version'), 'sungrid-abc12345');
  assert.equal(detail(s, 'Update'), 'Up to date');
});

test('a waiting update is reported, but the app is still ready offline', () => {
  const s = describeStatus({ ...base, updateReady: true });
  assert.equal(s.state, 'update-ready');
  assert.match(s.message, /Everything works offline now/);
});

test('being offline is not a problem when the copy is complete', () => {
  const s = describeStatus({ ...base, online: false });
  assert.equal(s.state, 'ready');
  assert.equal(detail(s, 'Connection'), 'Offline');
});

test('formatBytes', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
  assert.equal(formatBytes(3 * 1024 ** 3), '3.0 GB');
});

// ---------- failure paths: each gives a different, specific message ----------
test('unsupported browser says what to use instead', () => {
  const s = describeStatus({ ...base, supported: false });
  assert.equal(s.state, 'unsupported');
  assert.match(s.message, /Chrome or Edge/);
});

test('first visit: still setting up, with what to do', () => {
  const s = describeStatus({ ...base, controlled: false, worker: null });
  assert.equal(s.state, 'installing');
  assert.match(s.message, /Stay online/);
});

test('helper silent or answering with an error: asks to reload once online', () => {
  assert.equal(describeStatus({ ...base, worker: null }).state, 'no-answer');
  assert.equal(describeStatus({ ...base, worker: { error: 'storage disabled' } }).state, 'no-answer');
  assert.equal(describeStatus({ ...base, worker: { version: 'v', expected: 'x' } }).state, 'no-answer');
});

test('incomplete copy is a problem, and says how many files are missing', () => {
  const s = describeStatus({ ...base, worker: { version: 'v', expected: 16, cached: 10 } });
  assert.equal(s.state, 'incomplete');
  assert.equal(s.tone, 'bad');
  assert.match(s.message, /Only 10 of 16/);
});

test('storage almost full is a warning; incomplete still outranks it', () => {
  const full = { usage: 95, quota: 100 };
  assert.equal(describeStatus({ ...base, storage: full }).state, 'storage-low');
  assert.equal(describeStatus({ ...base, storage: full, worker: { version: 'v', expected: 16, cached: 3 } }).state, 'incomplete');
});

test('an error while checking is shown as a message, not thrown', () => {
  const s = describeStatus({ ...base, error: 'Offline check failed (boom).' });
  assert.equal(s.state, 'error');
  assert.match(s.message, /boom/);
});

test('formatBytes survives bad input', () => {
  for (const bad of [undefined, null, NaN, -5, '12', Infinity]) assert.equal(formatBytes(bad), 'unknown');
});

// ---------- collectStatus with fake browser objects ----------
function fakeNavigator({ reply, waiting = null, controlled = true, storage, registrationError, onLine = true } = {}) {
  return {
    onLine,
    storage: storage === undefined ? { estimate: async () => ({ usage: 400_000, quota: 5_000_000_000 }) } : storage,
    serviceWorker: {
      controller: controlled ? { postMessage: (_msg, [port]) => { if (reply) port.postMessage(reply); } } : null,
      getRegistration: async () => {
        if (registrationError) throw new Error(registrationError);
        return { waiting };
      },
    },
  };
}
const GOOD = { version: 'sungrid-abc12345', expected: 16, cached: 16 };

test('collectStatus: healthy device is ready and shows storage use', async () => {
  const s = await collectStatus({ navigator: fakeNavigator({ reply: GOOD }), caches: {} });
  assert.equal(s.state, 'ready');
  assert.match(detail(s, 'Phone storage used by app'), /390\.6 KB of 4\.7 GB/);
});

test('collectStatus: waiting worker means update-ready', async () => {
  const s = await collectStatus({ navigator: fakeNavigator({ reply: GOOD, waiting: {} }), caches: {} });
  assert.equal(s.state, 'update-ready');
});

test('collectStatus: no service worker support', async () => {
  assert.equal((await collectStatus({ navigator: { onLine: true }, caches: {} })).state, 'unsupported');
  assert.equal((await collectStatus({ navigator: fakeNavigator(), caches: undefined })).state, 'unsupported');
  assert.equal((await collectStatus({ navigator: undefined })).state, 'unsupported');
});

test('collectStatus: page not yet controlled by a worker', async () => {
  const s = await collectStatus({ navigator: fakeNavigator({ controlled: false }), caches: {} });
  assert.equal(s.state, 'installing');
});

test('collectStatus: a worker that never answers times out instead of hanging', async () => {
  const started = Date.now();
  const s = await collectStatus({ navigator: fakeNavigator({ reply: null }), caches: {}, timeoutMs: 30 });
  assert.equal(s.state, 'no-answer');
  assert.ok(Date.now() - started < 1000);
});

test('collectStatus: incomplete copy', async () => {
  const s = await collectStatus({ navigator: fakeNavigator({ reply: { ...GOOD, cached: 4 } }), caches: {} });
  assert.equal(s.state, 'incomplete');
});

test('collectStatus: failing browser calls become an error state, never an exception', async () => {
  const s = await collectStatus({ navigator: fakeNavigator({ registrationError: 'denied' }), caches: {} });
  assert.equal(s.state, 'error');
  assert.match(s.message, /denied/);
});

test('collectStatus: missing or failing storage estimate does not spoil the verdict', async () => {
  const none = await collectStatus({ navigator: fakeNavigator({ reply: GOOD, storage: null }), caches: {} });
  assert.equal(none.state, 'ready');
  const throws = await collectStatus({ navigator: fakeNavigator({ reply: GOOD, storage: { estimate: async () => { throw new Error('x'); } } }), caches: {} });
  assert.equal(throws.state, 'ready');
});

test('askWorker: no controller, or a controller that throws, gives null', async () => {
  assert.equal(await askWorker(null), null);
  assert.equal(await askWorker({}), null);
  assert.equal(await askWorker({ postMessage() { throw new Error('closed'); } }), null);
});

// ---------- clearOfflineData ----------
test('clearOfflineData deletes only SunGrid caches and unregisters the worker', async () => {
  const deleted = [];
  let unregistered = false;
  const env = {
    caches: { keys: async () => ['sungrid-aaa', 'sungrid-bbb', 'other-app'], delete: async (k) => deleted.push(k) },
    navigator: { serviceWorker: { getRegistration: async () => ({ unregister: async () => { unregistered = true; } }) } },
  };
  assert.deepEqual(await clearOfflineData(env), { ok: true, deleted: 2 });
  assert.deepEqual(deleted, ['sungrid-aaa', 'sungrid-bbb']);
  assert.equal(unregistered, true);
});

test('clearOfflineData: nothing registered is fine; unsupported and failures give clear errors', async () => {
  const ok = await clearOfflineData({ caches: { keys: async () => [] }, navigator: { serviceWorker: { getRegistration: async () => undefined } } });
  assert.deepEqual(ok, { ok: true, deleted: 0 });

  const unsupported = await clearOfflineData({ navigator: {} });
  assert.equal(unsupported.ok, false);
  assert.match(unsupported.error, /not available/);

  const failing = await clearOfflineData({ caches: { keys: async () => { throw new Error('locked'); } }, navigator: { serviceWorker: {} } });
  assert.equal(failing.ok, false);
  assert.match(failing.error, /locked/);
});
