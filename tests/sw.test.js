// Runs the REAL sw.js inside a sandbox (node:vm) with a fake cache store and a fake network, then fires
// install / activate / fetch / message events at it. This tests the actual file, not a copy of its logic.

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeIndexedDB } from './helpers/fake-idb.js';
import { openOutbox, createRecord, SYNC_TAG, LOCK_NAME } from '../js/outbox.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = await readFile(path.join(root, 'sw.js'), 'utf8');
const OUTBOX_CORE = await readFile(path.join(root, 'js/outbox-core.js'), 'utf8'); // what importScripts loads
const BASE = 'https://sungrid.test/';
const VERSION = /const VERSION = '([^']+)'/.exec(SOURCE)[1];
const SHELL = [...(/const SHELL = \[([\s\S]*?)\];/.exec(SOURCE)[1]).matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]);

const abs = (input) => new URL(typeof input === 'string' ? input : input.url, BASE).href;
const stripSearch = (href) => href.split('?')[0];

class FakeRequest extends Request {
  constructor(input, init) {
    super(new URL(input, BASE).href, init);
  }
}

function makeCache(store) {
  return {
    async add(req) { await this.addAll([req]); },
    async addAll(requests) {
      const fetched = await Promise.all(requests.map(async (r) => [r, await world.fetch(r)]));
      for (const [r, res] of fetched) {
        if (!res.ok) throw new TypeError(`addAll: bad response ${res.status} for ${abs(r)}`);
        store.set(abs(r), res);
      }
    },
    async put(req, res) { store.set(abs(req), res); },
    async match(req, opts = {}) {
      const key = opts.ignoreSearch ? stripSearch(abs(req)) : abs(req);
      for (const [k, v] of store) if ((opts.ignoreSearch ? stripSearch(k) : k) === key) return v.clone();
      return undefined;
    },
    async keys() { return [...store.keys()].map((href) => ({ url: href })); },
  };
}

let world;

/** Build a fresh sandbox. `site` maps URL paths to bodies; `online` toggles the fake network. */
function makeWorld({ online = true, site = defaultSite(), caches: seeded = {}, storageBroken = false, idb = fakeIndexedDB(), locks = null, pages = [] } = {}) {
  const stores = new Map(Object.entries(seeded).map(([name, files]) => [name, new Map(Object.entries(files).map(([u, body]) => [abs(u), new Response(body)]))]));
  const listeners = {};
  const spies = { skipWaiting: 0, claim: 0, fetched: [] };

  world = {
    online,
    site,
    posts: [], // reports the fake office server received
    postStatus: 200,
    async post(init) {
      if (!world.online) throw new TypeError('Failed to fetch');
      world.posts.push(Object.fromEntries(new URLSearchParams(init.body)));
      return { status: world.postStatus };
    },
    async fetch(req) {
      const url = abs(req);
      spies.fetched.push(url);
      if (!world.online) throw new TypeError('Failed to fetch');
      const pathname = new URL(url).pathname;
      const body = world.site[pathname];
      const res = new Response(body ?? 'not found', { status: body === undefined ? 404 : 200 });
      Object.defineProperty(res, 'type', { value: 'basic' });
      return res;
    },
  };

  const sandbox = {
    Request: FakeRequest,
    Response,
    URL,
    URLSearchParams,
    console,
    // a POST is a report going to the office; everything else is a file
    fetch: (r, init) => (init && init.method === 'POST' ? world.post(init) : world.fetch(r)),
    importScripts: (url) => {
      assert.equal(url, './js/outbox-core.js');
      vm.runInContext(OUTBOX_CORE, sandbox, { filename: 'outbox-core.js' });
    },
    caches: {
      async open(name) {
        if (storageBroken) throw new Error('storage disabled');
        if (!stores.has(name)) stores.set(name, new Map());
        return makeCache(stores.get(name));
      },
      async keys() { return [...stores.keys()]; },
      async delete(name) { return stores.delete(name); },
    },
    self: {
      location: new URL(`${BASE}sw.js`),
      registration: { scope: BASE },
      indexedDB: idb,
      navigator: { locks },
      clients: {
        claim: async () => { spies.claim++; },
        matchAll: async () => pages,
      },
      skipWaiting: () => { spies.skipWaiting++; },
      addEventListener: (type, fn) => { listeners[type] = fn; },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: 'sw.js' });

  return {
    stores,
    spies,
    setOnline(v) { world.online = v; },
    /** install / activate: resolves when waitUntil promises settle, rejects if any rejected. */
    async lifecycle(type) {
      const pending = [];
      listeners[type]({ waitUntil: (p) => pending.push(p) });
      await Promise.all(pending);
    },
    idb,
    posts: () => world.posts,
    setPostStatus(status) { world.postStatus = status; },
    /** Fire a Background Sync event; resolves when the worker is done, rejects if it asked the browser to retry. */
    async sync(tag = SYNC_TAG) {
      const pending = [];
      listeners.sync({ tag, waitUntil: (p) => pending.push(p) });
      await Promise.all(pending);
      return pending.length;
    },
    /** Returns the Response the worker answered with, or null if it did not handle the request. */
    async fetch(url, { mode = 'cors', method = 'GET' } = {}) {
      let answer = null;
      listeners.fetch({ request: { url: abs(url), method, mode }, respondWith: (p) => { answer = p; } });
      return answer ? await answer : null;
    },
    /** Send a message; returns what the worker posts back on the port, if anything. */
    async message(data, withPort = true) {
      let reply;
      const pending = [];
      const ports = withPort ? [{ postMessage: (m) => { reply = m; } }] : [];
      listeners.message({ data, ports, waitUntil: (p) => pending.push(p) });
      await Promise.all(pending);
      return reply;
    },
  };
}

function defaultSite() {
  const site = { '/': '<html>SunGrid app</html>', '/index.html': '<html>SunGrid app</html>' };
  for (const file of SHELL) if (file) site[`/${file}`] = `content of ${file}`;
  site['/js/extra.js'] = 'extra module';
  return site;
}

// ---------------- main path ----------------
test('install saves every shell file, bypassing the browser HTTP cache', async () => {
  const w = makeWorld();
  await w.lifecycle('install');
  const cache = w.stores.get(VERSION);
  assert.equal(cache.size, SHELL.length);
  assert.ok(cache.has(`${BASE}index.html`) && cache.has(`${BASE}js/offline.js`));
});

test('install does NOT take over by itself: the user decides when to update', async () => {
  const w = makeWorld();
  await w.lifecycle('install');
  assert.equal(w.spies.skipWaiting, 0);
});

test('SKIP_WAITING message (sent when the user taps "Reload to update") takes over', async () => {
  const w = makeWorld();
  await w.message({ type: 'SKIP_WAITING' }, false);
  assert.equal(w.spies.skipWaiting, 1);
});

test('activate removes older sungrid caches, keeps the current one and other apps', async () => {
  const w = makeWorld({ caches: { 'sungrid-oldoldol': { '/index.html': 'old' }, [VERSION]: { '/index.html': 'new' }, 'other-app-v1': { '/x': 'x' } } });
  await w.lifecycle('activate');
  assert.deepEqual([...w.stores.keys()].sort(), [VERSION, 'other-app-v1'].sort());
  assert.equal(w.spies.claim, 1);
});

test('with no signal, opening the app serves the saved page and files', async () => {
  const w = makeWorld();
  await w.lifecycle('install');
  w.setOnline(false);

  const page = await w.fetch('/', { mode: 'navigate' });
  assert.equal(await page.text(), 'content of index.html');

  const script = await w.fetch('/js/views.js');
  assert.equal(await script.text(), 'content of js/views.js');
  assert.equal(w.spies.fetched.filter((u) => u.endsWith('views.js')).length, 1, 'only the install fetched it');
});

test('a file not saved yet is fetched once, remembered, and then works offline', async () => {
  const w = makeWorld();
  await w.lifecycle('install');
  assert.equal(await (await w.fetch('/js/extra.js')).text(), 'extra module');
  w.setOnline(false);
  assert.equal(await (await w.fetch('/js/extra.js')).text(), 'extra module');
});

test('query strings do not defeat the saved copy (icon-192.png?v=2)', async () => {
  const w = makeWorld();
  await w.lifecycle('install');
  w.setOnline(false);
  const res = await w.fetch('/icons/icon-192.png?v=2');
  assert.equal(res.status, 200);
});

test('GET_STATUS reports version, expected and saved file counts', async () => {
  const w = makeWorld();
  await w.lifecycle('install');
  assert.deepEqual(JSON.parse(JSON.stringify(await w.message({ type: 'GET_STATUS' }))), { version: VERSION, expected: SHELL.length, cached: SHELL.length });
});

// ---------------- failure paths ----------------
test('a failed install (no network) rejects, so a half-saved version is never activated', async () => {
  const w = makeWorld({ online: false });
  await assert.rejects(() => w.lifecycle('install'), /Failed to fetch/);
});

test('a missing file during install (404) also fails the install', async () => {
  const site = defaultSite();
  delete site['/js/views.js'];
  const w = makeWorld({ site });
  await assert.rejects(() => w.lifecycle('install'), /bad response 404/);
});

test('offline + file never saved: a plain 503 message, not an exception', async () => {
  const w = makeWorld();
  await w.lifecycle('install');
  w.setOnline(false);
  const res = await w.fetch('/js/never-saved.js');
  assert.equal(res.status, 503);
  assert.match(await res.text(), /offline and this file is not saved/);
});

test('offline before install finished: opening the app gives the same 503 message, not a crash', async () => {
  const w = makeWorld({ online: false });
  const res = await w.fetch('/', { mode: 'navigate' });
  assert.equal(res.status, 503);
});

test('online before install finished: the page comes from the network', async () => {
  const w = makeWorld();
  const res = await w.fetch('/', { mode: 'navigate' });
  assert.equal(await res.text(), '<html>SunGrid app</html>');
});

test('addresses without # (like /jobs/SG-1042) are sent to the app root instead of loading a broken page', async () => {
  const w = makeWorld();
  await w.lifecycle('install');
  const res = await w.fetch('/jobs/SG-1042', { mode: 'navigate' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), BASE);
});

test('an old version cache never answers for the new version', async () => {
  const w = makeWorld({ caches: { 'sungrid-00000000': { '/index.html': 'OLD APP' } } });
  const res = await w.fetch('/', { mode: 'navigate' });
  assert.equal(await res.text(), '<html>SunGrid app</html>'); // came from the network ('/' page), not the old cache
});

test('requests the worker should not touch are left alone (POST, other websites)', async () => {
  const w = makeWorld();
  await w.lifecycle('install');
  assert.equal(await w.fetch('/api/quote', { method: 'POST' }), null);
  assert.equal(await w.fetch('https://cdn.example.org/lib.js'), null);
});

test('GET_STATUS shows an incomplete copy honestly', async () => {
  const w = makeWorld({ caches: { [VERSION]: { '/index.html': 'x', '/js/app.js': 'y' } } });
  const status = await w.message({ type: 'GET_STATUS' });
  assert.equal(status.cached, 2);
  assert.equal(status.expected, SHELL.length);
});

test('GET_STATUS answers with an error (instead of staying silent) when storage is unavailable', async () => {
  const w = makeWorld({ storageBroken: true });
  const status = await w.message({ type: 'GET_STATUS' });
  assert.match(status.error, /storage disabled/);
});

test('GET_STATUS without a reply port, and unknown messages, are ignored safely', async () => {
  const w = makeWorld();
  assert.equal(await w.message({ type: 'GET_STATUS' }, false), undefined);
  assert.equal(await w.message({ type: 'SOMETHING_ELSE' }), undefined);
  assert.equal(await w.message(undefined), undefined);
});

// ---------------- background sync: sending the outbox from the worker ----------------
const REPORT = { jobId: 'SG-1043', kind: 'Progress update', panels: 6, note: 'East roof done', installer: 'Imran Khalid' };

/** Put reports into the shared fake IndexedDB, the way the page would while offline. Returns the page-side outbox. */
async function fileReports(w, count = 1, extra = {}) {
  const { outbox, durable } = await openOutbox(w.idb);
  assert.equal(durable, true);
  for (let i = 0; i < count; i++) {
    await outbox.add(createRecord({ ...REPORT, panels: i + 1, ...extra }, { now: new Date(Date.UTC(2026, 9, 30, 8, 0, i)), id: `R-test-${i + 1}` }));
  }
  return outbox;
}

test('sync: the worker sends the waiting reports, oldest first, and marks them sent', async () => {
  const w = makeWorld();
  const outbox = await fileReports(w, 3);
  await w.sync();

  assert.deepEqual(w.posts().map((p) => p.report_id), ['R-test-1', 'R-test-2', 'R-test-3']);
  assert.equal(w.posts()[0]['form-name'], 'site-report');
  assert.equal(w.posts()[0].job, 'SG-1043');
  assert.deepEqual((await outbox.list()).map((r) => r.status), ['sent', 'sent', 'sent']);
});

test('sync: a sync event for some other tag is ignored', async () => {
  const w = makeWorld();
  await fileReports(w, 1);
  assert.equal(await w.sync('someone-elses-tag'), 0, 'no work was started');
  assert.equal(w.posts().length, 0);
});

test('sync: with no connection the worker REJECTS (so the browser tries again later) and the report stays waiting', async () => {
  const w = makeWorld({ online: false });
  const outbox = await fileReports(w, 2);
  await assert.rejects(() => w.sync(), /No connection/);

  const [first, second] = await outbox.list();
  assert.equal(first.status, 'pending');
  assert.equal(first.attempts, 1);
  assert.match(first.lastError, /No connection/);
  assert.equal(second.attempts, 0, 'stopped at the first failure: the second was not even tried');
});

test('sync: when the signal returns, the very same reports go out (nothing lost, nothing doubled)', async () => {
  const w = makeWorld({ online: false });
  const outbox = await fileReports(w, 2);
  await assert.rejects(() => w.sync());
  w.setOnline(true);
  await w.sync();

  assert.deepEqual(w.posts().map((p) => p.report_id), ['R-test-1', 'R-test-2']);
  assert.deepEqual((await outbox.list()).map((r) => r.status), ['sent', 'sent']);
});

test('sync: a server error (500) asks for a retry; the report is kept', async () => {
  const w = makeWorld();
  w.setPostStatus(503);
  const outbox = await fileReports(w, 1);
  await assert.rejects(() => w.sync(), /busy/);
  assert.equal((await outbox.list())[0].status, 'pending');
});

test('sync: a refusal (400) is final for that report: marked rejected, no endless retry, and the queue moves on', async () => {
  const w = makeWorld();
  w.setPostStatus(400);
  const outbox = await fileReports(w, 2);
  await w.sync(); // must RESOLVE: rejecting would make the browser retry text the server will never accept

  const rows = await outbox.list();
  assert.deepEqual(rows.map((r) => r.status), ['rejected', 'rejected'], 'the second report was still tried');
  assert.match(rows[0].lastError, /refused this report \(error 400\)/);
  assert.equal(w.posts().length, 2);
});

test('sync: the worker does not crash when the on-device storage cannot be opened', async () => {
  const w = makeWorld({ idb: fakeIndexedDB({ openError: new Error('storage blocked') }) });
  await w.sync(); // resolves: nothing to send, nothing to retry
  assert.equal(w.posts().length, 0);
});

test('sync: open pages are told, so the report list updates without a reload', async () => {
  const told = [];
  const w = makeWorld({ pages: [{ postMessage: (m) => told.push(m) }, { postMessage: (m) => told.push(m) }] });
  await fileReports(w, 1);
  await w.sync();
  assert.deepEqual(JSON.parse(JSON.stringify(told)), [{ type: 'OUTBOX_CHANGED' }, { type: 'OUTBOX_CHANGED' }]);
});

test('sync: two senders at once (page + worker) do not post the same report twice when Web Locks is available', async () => {
  const lockNames = [];
  let tail = Promise.resolve();
  const locks = { request: (name, callback) => { lockNames.push(name); const run = tail.then(() => callback()); tail = run.catch(() => {}); return run; } };
  const w = makeWorld({ locks });
  await fileReports(w, 2);

  await Promise.all([w.sync(), w.sync()]);

  assert.equal(w.posts().length, 2, 'each report was posted exactly once');
  assert.deepEqual([...new Set(lockNames)], [LOCK_NAME]);
});

test('sync: the worker is classic (importScripts) so devices that installed earlier versions can still update', () => {
  assert.match(SOURCE, /importScripts\('\.\/js\/outbox-core\.js'\)/);
  assert.doesNotMatch(SOURCE, /^\s*(import|export)\s/m, 'an import/export statement would be a syntax error in a classic worker');
  assert.ok(SHELL.includes('js/outbox-core.js') && SHELL.includes('js/outbox.js'), 'both outbox files are saved for offline use');
});
