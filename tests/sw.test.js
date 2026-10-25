// Runs the REAL sw.js inside a sandbox (node:vm) with a fake cache store and a fake network, then fires
// install / activate / fetch / message events at it. This tests the actual file, not a copy of its logic.

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = await readFile(path.join(root, 'sw.js'), 'utf8');
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
function makeWorld({ online = true, site = defaultSite(), caches: seeded = {}, storageBroken = false } = {}) {
  const stores = new Map(Object.entries(seeded).map(([name, files]) => [name, new Map(Object.entries(files).map(([u, body]) => [abs(u), new Response(body)]))]));
  const listeners = {};
  const spies = { skipWaiting: 0, claim: 0, fetched: [] };

  world = {
    online,
    site,
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
    console,
    fetch: (r) => world.fetch(r),
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
      clients: { claim: async () => { spies.claim++; } },
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
