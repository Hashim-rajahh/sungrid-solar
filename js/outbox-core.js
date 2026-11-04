// The outbox: site reports filed by an installer wait here until the office can receive them.
//
// No DOM access. This file is used by the page (through js/outbox.js) AND by the service worker
// (importScripts in sw.js), so both sides read and write the same IndexedDB store and follow the same rules.
//
// Why it is written as a plain script (an IIFE that fills `SunGridOutbox`) and not as `export`s:
// sw.js is a classic service worker, and a classic worker cannot import an ES module. Making it a module
// worker would break the update for everyone who already installed the earlier versions of the app,
// because the browser re-reads their registered worker as a classic script. js/outbox.js re-exports this
// for the page and the tests.
//
// Life of a report:  validateReport -> createRecord -> outbox.add -> (flushOutbox) -> sent
//   pending   waiting for a connection; will be tried again
//   sent      the office server accepted it (kept for a short history)
//   rejected  the server refused it (a 4xx answer); retrying the same text will not help, so a person decides
//   stuck     tried MAX_ATTEMPTS times and still failing; a person decides

(function (root) {
  'use strict';

  const DB_NAME = 'sungrid-outbox';
  const STORE_NAME = 'reports';
  const SYNC_TAG = 'sungrid-send-reports'; // Background Sync tag
  const LOCK_NAME = 'sungrid-send-reports'; // Web Lock name: one sender at a time
  const FORM_NAME = 'site-report'; // must match the hidden form in index.html (Netlify Forms)
  const ENDPOINT = '/'; // Netlify Forms accepts the POST at the site root
  const MAX_ATTEMPTS = 8;
  const KEEP_SENT = 10;
  const REPORT_KINDS = ['Progress update', 'Problem found', 'Job finished'];
  const LIMITS = { noteMax: 500, nameMin: 2, nameMax: 60, panelsMax: 500 };

  // ---------------------------------------------------------------- validation

  function text(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  /**
   * Check what the installer typed. Returns { ok: true, value } or { ok: false, errors: { field: message } }.
   * Every message says what is wrong AND what to do, because it is read on a roof, on a phone.
   * @param {{jobId?: string, kind?: string, panels?: string, note?: string, installer?: string}} input
   * @param {Array<{id: string, panels: number}>} jobs
   */
  function validateReport(rawInput, rawJobs) {
    const input = rawInput && typeof rawInput === 'object' ? rawInput : {};
    const jobs = Array.isArray(rawJobs) ? rawJobs : [];
    const errors = {};

    const jobId = text(input.jobId);
    const job = jobs.find((j) => j.id === jobId);
    if (!jobId) errors.jobId = 'Pick the job this report is for.';
    else if (!job) errors.jobId = `"${jobId}" is not one of your jobs. Pick a job from the list.`;

    const kind = text(input.kind);
    if (!kind) errors.kind = 'Choose what kind of report this is.';
    else if (!REPORT_KINDS.includes(kind)) errors.kind = `"${kind}" is not a report type. Choose one from the list.`;

    const panelsText = text(input.panels);
    let panels = null;
    if (panelsText === '') {
      errors.panels = 'Enter how many panels were fitted today (0 if none).';
    } else if (!/^\d+$/.test(panelsText)) {
      errors.panels = 'Panels fitted must be a whole number such as 6, with no letters, minus sign or decimals.';
    } else {
      panels = Number(panelsText);
      const limit = job ? job.panels : LIMITS.panelsMax;
      if (panels > limit) {
        errors.panels = job
          ? `${job.id} has only ${job.panels} panels in total, so ${panelsText} is too many. Check the number.`
          : `${panelsText} panels in one day is not possible. Check the number.`;
      }
    }

    const note = text(input.note);
    if (kind === 'Problem found' && !note) errors.note = 'Describe the problem so the office can act on it.';
    else if (note.length > LIMITS.noteMax) {
      errors.note = `The note is ${note.length} characters; the limit is ${LIMITS.noteMax}. Shorten it.`;
    }

    const installer = text(input.installer);
    if (!installer) errors.installer = 'Enter your name so the office knows who filed this.';
    else if (installer.length < LIMITS.nameMin) errors.installer = 'Enter your full name.';
    else if (installer.length > LIMITS.nameMax) errors.installer = `Use at most ${LIMITS.nameMax} characters for your name.`;

    if (Object.keys(errors).length) return { ok: false, errors };
    return { ok: true, value: { jobId, kind, panels, note, installer } };
  }

  // ---------------------------------------------------------------- records and sending

  function newId(now) {
    const c = globalThis.crypto;
    const random = c && typeof c.randomUUID === 'function' ? c.randomUUID().slice(0, 8) : Math.random().toString(16).slice(2, 10).padEnd(8, '0');
    return `R-${now.getTime().toString(36)}-${random}`;
  }

  /** Turn a validated report into a stored record. The id travels with the report, so the office can spot a duplicate. */
  function createRecord(value, { now = new Date(), id } = {}) {
    return { id: id ?? newId(now), createdAt: now.toISOString(), status: 'pending', attempts: 0, lastError: null, sentAt: null, ...value };
  }

  /** The exact text POSTed to the office (application/x-www-form-urlencoded, as Netlify Forms expects). */
  function encodeReport(record) {
    return new URLSearchParams({
      'form-name': FORM_NAME,
      report_id: record.id,
      job: record.jobId,
      kind: record.kind,
      panels: String(record.panels),
      note: record.note ?? '',
      installer: record.installer,
      reported_at: record.createdAt,
    }).toString();
  }

  /**
   * What an HTTP status means for a stored report.
   *   2xx                     sent
   *   408, 425, 429, 5xx      the server is busy or broken: try again later
   *   any other status        the server refused THIS report: retrying the same text will not help
   */
  function classifyStatus(status) {
    if (status >= 200 && status < 300) return { kind: 'sent', status };
    if (status === 408 || status === 425 || status === 429 || status >= 500) {
      return { kind: 'retry', status, message: `The office server is busy (error ${status}). It will be tried again.` };
    }
    return { kind: 'rejected', status, message: `The office server refused this report (error ${status}).` };
  }

  /**
   * POST one report. Never throws: every outcome comes back as { kind: 'sent' | 'retry' | 'rejected', ... }.
   * A request that hangs is cut off after `timeoutMs`, so a dead connection cannot hold the queue forever.
   */
  async function sendReport(record, { fetchFn = globalThis.fetch, endpoint = ENDPOINT, timeoutMs = 15000 } = {}) {
    if (typeof fetchFn !== 'function') return { kind: 'retry', network: true, message: 'This browser cannot send reports.' };
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetchFn(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: encodeReport(record),
        signal: controller ? controller.signal : undefined,
      });
      return classifyStatus(response.status);
    } catch {
      return { kind: 'retry', network: true, message: 'No connection to the office server. It will be tried again.' };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // ---------------------------------------------------------------- storage

  /** In-memory store: used in tests, and as the fallback when the browser will not give us IndexedDB. */
  function memoryStore() {
    const rows = new Map();
    return {
      async all() { return [...rows.values()].map((r) => ({ ...r })); },
      async get(id) { const r = rows.get(id); return r ? { ...r } : undefined; },
      async put(record) { rows.set(record.id, { ...record }); },
      async delete(id) { rows.delete(id); },
    };
  }

  function wrapDatabase(db) {
    db.onversionchange = () => db.close(); // let a newer version of the app upgrade the store
    const run = (mode, action) =>
      new Promise((resolve, reject) => {
        let tx;
        try {
          tx = db.transaction(STORE_NAME, mode);
        } catch (err) {
          reject(err);
          return;
        }
        const request = action(tx.objectStore(STORE_NAME));
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = () => reject(tx.error || request.error || new Error('Could not use the on-device storage.'));
        tx.onabort = () => reject(tx.error || new Error('The on-device storage refused the change (the device may be full).'));
      });
    return {
      all: () => run('readonly', (s) => s.getAll()),
      get: (id) => run('readonly', (s) => s.get(id)),
      put: (record) => run('readwrite', (s) => s.put(record)),
      delete: (id) => run('readwrite', (s) => s.delete(id)),
    };
  }

  /** Open the IndexedDB store. Rejects with a readable message when the browser does not allow it. */
  function openIdbStore(factory) {
    return new Promise((resolve, reject) => {
      if (!factory || typeof factory.open !== 'function') {
        reject(new Error('This browser cannot keep data on the device (no IndexedDB).'));
        return;
      }
      let request;
      try {
        request = factory.open(DB_NAME, 1);
      } catch (err) {
        reject(err);
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(wrapDatabase(request.result));
      request.onerror = () => reject(request.error || new Error('Could not open the on-device storage.'));
      request.onblocked = () => reject(new Error('The on-device storage is busy. Close other SunGrid Solar tabs and try again.'));
    });
  }

  function byAge(a, b) {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  }

  /** Count records by status. `unsent` is everything a person still has to care about. */
  function countRecords(records) {
    const counts = { pending: 0, sent: 0, rejected: 0, stuck: 0 };
    for (const r of records) if (r.status in counts) counts[r.status] += 1;
    return { ...counts, unsent: counts.pending + counts.rejected + counts.stuck };
  }

  /** The queue itself, on top of any store. */
  function createOutbox(store) {
    const api = {
      /** Save a record. Older sent reports beyond KEEP_SENT are dropped so history stays small. */
      async add(record) {
        await store.put(record);
        const sent = (await store.all()).filter((r) => r.status === 'sent').sort(byAge);
        for (const old of sent.slice(0, Math.max(0, sent.length - KEEP_SENT))) await store.delete(old.id);
        return record;
      },
      /** Oldest first, so reports are sent in the order they were filed. */
      async list() {
        return (await store.all()).sort(byAge);
      },
      get: (id) => store.get(id),
      async update(id, patch) {
        const current = await store.get(id);
        if (!current) return undefined;
        const next = { ...current, ...patch, id };
        await store.put(next);
        return next;
      },
      async remove(id) {
        await store.delete(id);
      },
      /** A person decided to try a refused or stuck report again. */
      async retry(id) {
        const current = await store.get(id);
        if (!current || (current.status !== 'rejected' && current.status !== 'stuck')) return current;
        return api.update(id, { status: 'pending', attempts: 0, lastError: null });
      },
      async counts() {
        return countRecords(await store.all());
      },
    };
    return api;
  }

  /**
   * Open the outbox on IndexedDB. If the browser refuses, fall back to memory and say so (`durable: false`),
   * so the page can warn that reports will not survive closing the tab instead of pretending they are safe.
   */
  async function openOutbox(factory) {
    try {
      return { outbox: createOutbox(await openIdbStore(factory)), durable: true, reason: null };
    } catch (err) {
      return { outbox: createOutbox(memoryStore()), durable: false, reason: err && err.message ? err.message : String(err) };
    }
  }

  // ---------------------------------------------------------------- sending the queue

  /**
   * Send every pending report, oldest first.
   *   sent / refused   recorded, then carry on with the next one
   *   network or 5xx   stop at once (the next ones would fail the same way) and keep the order
   * `stopped: true` tells the caller the queue is not empty because of a temporary problem.
   * @param {{outbox: ReturnType<typeof createOutbox>, send: (r: object) => Promise<object>, now?: () => Date, maxAttempts?: number}} env
   */
  async function flushOutbox({ outbox, send, now = () => new Date(), maxAttempts = MAX_ATTEMPTS }) {
    const result = { sent: 0, rejected: 0, left: 0, stopped: false, error: null };
    const queue = (await outbox.list()).filter((r) => r.status === 'pending');

    for (const record of queue) {
      let outcome;
      try {
        outcome = await send(record);
      } catch (err) {
        outcome = { kind: 'retry', network: true, message: err && err.message ? err.message : String(err) };
      }
      const attempts = record.attempts + 1;

      if (outcome.kind === 'sent') {
        await outbox.update(record.id, { status: 'sent', sentAt: now().toISOString(), attempts, lastError: null });
        result.sent += 1;
      } else if (outcome.kind === 'rejected') {
        await outbox.update(record.id, { status: 'rejected', attempts, lastError: outcome.message });
        result.rejected += 1;
      } else {
        await outbox.update(record.id, { status: attempts >= maxAttempts ? 'stuck' : 'pending', attempts, lastError: outcome.message });
        result.stopped = true;
        result.error = outcome.message;
        break;
      }
    }

    result.left = (await outbox.list()).filter((r) => r.status === 'pending').length;
    return result;
  }

  /**
   * flushOutbox, but only one sender at a time. The page and the service worker can both wake up when the
   * signal returns; without this they would POST the same report twice. With the Web Locks API the second
   * one waits, then finds the report already marked "sent". Where Web Locks is missing, we still send
   * (the report_id lets the office spot a rare duplicate).
   */
  function flushWithLock({ locks, ...env }) {
    if (!locks || typeof locks.request !== 'function') return flushOutbox(env);
    return locks.request(LOCK_NAME, () => flushOutbox(env));
  }

  /**
   * Ask the browser to wake the service worker when the connection returns, even if the app is closed.
   * Resolves to 'registered', or the reason it is not available: 'unsupported' (this browser has no
   * Background Sync, e.g. Safari on iPhone), 'unavailable' (no service worker yet), 'failed'.
   */
  async function registerBackgroundSync(nav, { timeoutMs = 1500 } = {}) {
    const sw = nav && nav.serviceWorker;
    if (!sw) return 'unsupported';

    let timer;
    let registration;
    try {
      // No worker registered at all (first visit, or service workers blocked): answer now, do not wait for `ready`.
      if (typeof sw.getRegistration === 'function' && !(await sw.getRegistration())) return 'unavailable';
      registration = await Promise.race([
        sw.ready,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('no service worker')), timeoutMs); }),
      ]);
    } catch {
      return 'unavailable';
    } finally {
      clearTimeout(timer);
    }

    if (!registration || !registration.sync) return 'unsupported';
    try {
      await registration.sync.register(SYNC_TAG);
      return 'registered';
    } catch {
      return 'failed';
    }
  }

  root.SunGridOutbox = {
    DB_NAME,
    STORE_NAME,
    SYNC_TAG,
    LOCK_NAME,
    FORM_NAME,
    ENDPOINT,
    MAX_ATTEMPTS,
    KEEP_SENT,
    REPORT_KINDS,
    LIMITS,
    validateReport,
    createRecord,
    encodeReport,
    classifyStatus,
    sendReport,
    memoryStore,
    openIdbStore,
    countRecords,
    createOutbox,
    openOutbox,
    flushOutbox,
    flushWithLock,
    registerBackgroundSync,
  };
})(typeof self !== 'undefined' ? self : globalThis);
