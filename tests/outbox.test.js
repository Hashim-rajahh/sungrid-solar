// Tests for the outbox rules (js/outbox-core.js, used through js/outbox.js): validation, what is sent,
// how answers are classified, the queue and the order it is flushed in.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateReport,
  createRecord,
  encodeReport,
  classifyStatus,
  sendReport,
  memoryStore,
  createOutbox,
  countRecords,
  flushOutbox,
  flushWithLock,
  registerBackgroundSync,
  REPORT_KINDS,
  LIMITS,
  MAX_ATTEMPTS,
  KEEP_SENT,
  SYNC_TAG,
  LOCK_NAME,
  FORM_NAME,
} from '../js/outbox.js';
import { jobs, sampleReports } from '../js/data.js';

const good = { jobId: 'SG-1043', kind: 'Progress update', panels: '6', note: 'East roof done', installer: 'Imran Khalid' };
const at = (second) => new Date(Date.UTC(2026, 9, 30, 8, 0, second));

// ---------------- validation: main path ----------------
test('validate: a complete report passes and panels becomes a number', () => {
  const r = validateReport(good, jobs);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { jobId: 'SG-1043', kind: 'Progress update', panels: 6, note: 'East roof done', installer: 'Imran Khalid' });
});

test('validate: every sample report in data.js is valid (the "Use an example" button can never produce an error)', () => {
  for (const sample of sampleReports) assert.equal(validateReport(sample, jobs).ok, true, JSON.stringify(sample));
});

test('validate: surrounding spaces are trimmed; a note is optional for a normal update', () => {
  const r = validateReport({ ...good, jobId: ' SG-1043 ', panels: ' 0 ', note: '   ', installer: '  Imran  ' }, jobs);
  assert.equal(r.ok, true);
  assert.equal(r.value.panels, 0);
  assert.equal(r.value.note, '');
  assert.equal(r.value.installer, 'Imran');
});

// ---------------- validation: wrong or empty input ----------------
test('validate: an empty form says what to fill in, field by field', () => {
  const r = validateReport({}, jobs);
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.errors).sort(), ['installer', 'jobId', 'kind', 'panels']);
  assert.match(r.errors.jobId, /Pick the job/);
  assert.match(r.errors.panels, /0 if none/);
});

test('validate: missing or non-object input does not crash', () => {
  assert.equal(validateReport(undefined, jobs).ok, false);
  assert.equal(validateReport(null, jobs).ok, false);
  assert.equal(validateReport(good, undefined).ok, false, 'no job list means no job can match');
});

test('validate: an unknown job and an unknown type are named in the message', () => {
  const r = validateReport({ ...good, jobId: 'SG-9999', kind: 'Gossip' }, jobs);
  assert.match(r.errors.jobId, /"SG-9999" is not one of your jobs/);
  assert.match(r.errors.kind, /"Gossip" is not a report type/);
});

test('validate: panels must be a whole number: letters, decimals, minus, exponent and blanks are all refused', () => {
  for (const bad of ['six', '1.5', '-2', '1e2', '0x10', '12 panels', '', '  ', '٣']) {
    const r = validateReport({ ...good, panels: bad }, jobs);
    assert.equal(r.ok, false, `"${bad}" should be refused`);
    assert.ok(r.errors.panels, `"${bad}" should explain itself`);
  }
});

test('validate: more panels than the job has is refused with the real limit in the message', () => {
  const r = validateReport({ ...good, panels: '13' }, jobs); // SG-1043 has 12
  assert.match(r.errors.panels, /SG-1043 has only 12 panels in total, so 13 is too many/);
  assert.equal(validateReport({ ...good, panels: '12' }, jobs).ok, true, 'exactly the job total is fine');
});

test('validate: a huge number is refused instead of becoming a float', () => {
  const r = validateReport({ ...good, panels: '99999999999999999999999' }, jobs);
  assert.match(r.errors.panels, /too many/);
});

test('validate: a problem report needs a note; a long note is refused with its length', () => {
  const noNote = validateReport({ ...good, kind: 'Problem found', note: ' ' }, jobs);
  assert.match(noNote.errors.note, /Describe the problem/);

  const long = validateReport({ ...good, note: 'x'.repeat(LIMITS.noteMax + 1) }, jobs);
  assert.match(long.errors.note, /501 characters; the limit is 500/);
  assert.equal(validateReport({ ...good, note: 'x'.repeat(LIMITS.noteMax) }, jobs).ok, true);
});

test('validate: the installer name is required, not a single letter, not absurdly long', () => {
  assert.match(validateReport({ ...good, installer: '' }, jobs).errors.installer, /Enter your name/);
  assert.match(validateReport({ ...good, installer: 'I' }, jobs).errors.installer, /full name/);
  assert.match(validateReport({ ...good, installer: 'x'.repeat(61) }, jobs).errors.installer, /at most 60/);
});

// ---------------- records and what is sent ----------------
test('record: gets a unique id, the time, and starts waiting with zero attempts', () => {
  const a = createRecord(validateReport(good, jobs).value, { now: at(0) });
  const b = createRecord(validateReport(good, jobs).value, { now: at(0) });
  assert.match(a.id, /^R-[0-9a-z]+-[0-9a-f]{8}$/);
  assert.notEqual(a.id, b.id, 'two reports filed in the same second still differ');
  assert.equal(a.status, 'pending');
  assert.equal(a.attempts, 0);
  assert.equal(a.createdAt, '2026-10-30T08:00:00.000Z');
});

test('encode: the POST body has the form name Netlify needs and every field, safely encoded', () => {
  const record = createRecord({ ...validateReport(good, jobs).value, note: 'Panels & "clamps" <ok>\nline two' }, { now: at(0), id: 'R-1' });
  const fields = Object.fromEntries(new URLSearchParams(encodeReport(record)));
  assert.equal(fields['form-name'], FORM_NAME);
  assert.deepEqual(
    { ...fields, note: undefined },
    { 'form-name': 'site-report', report_id: 'R-1', job: 'SG-1043', kind: 'Progress update', panels: '6', note: undefined, installer: 'Imran Khalid', reported_at: '2026-10-30T08:00:00.000Z' },
  );
  assert.equal(fields.note, 'Panels & "clamps" <ok>\nline two', 'special characters survive the round trip');
});

test('encode: the field names match the hidden form in index.html (otherwise Netlify rejects the post)', async () => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const form = /<form name="site-report"[\s\S]*?<\/form>/.exec(html)[0];
  assert.match(form, /data-netlify="true"/);
  const declared = [...form.matchAll(/name="([^"]+)"/g)].map((m) => m[1]).filter((n) => n !== 'site-report').sort();
  const sent = [...new URLSearchParams(encodeReport(createRecord(validateReport(good, jobs).value, { id: 'R-1' }))).keys()].sort();
  assert.deepEqual(declared, sent);
});

// ---------------- how the server's answer is read ----------------
test('classify: 2xx is sent; 408/425/429/5xx are retried; every other answer is a refusal', () => {
  assert.equal(classifyStatus(200).kind, 'sent');
  assert.equal(classifyStatus(204).kind, 'sent');
  for (const s of [408, 425, 429, 500, 502, 503, 504]) assert.equal(classifyStatus(s).kind, 'retry', String(s));
  for (const s of [400, 401, 403, 404, 413, 422, 302, 0]) assert.equal(classifyStatus(s).kind, 'rejected', String(s));
  assert.match(classifyStatus(404).message, /refused this report \(error 404\)/);
});

test('send: posts urlencoded to the site root and reports "sent" on 200', async () => {
  const seen = [];
  const record = createRecord(validateReport(good, jobs).value, { now: at(0), id: 'R-1' });
  const out = await sendReport(record, { fetchFn: async (url, init) => { seen.push({ url, init }); return { status: 200 }; } });
  assert.equal(out.kind, 'sent');
  assert.equal(seen[0].url, '/');
  assert.equal(seen[0].init.method, 'POST');
  assert.equal(seen[0].init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.match(seen[0].init.body, /report_id=R-1/);
});

test('send: never throws: a dead connection, a missing fetch and a hung request all become "retry"', async () => {
  const record = createRecord(validateReport(good, jobs).value, { now: at(0), id: 'R-1' });
  const dead = await sendReport(record, { fetchFn: async () => { throw new TypeError('Failed to fetch'); } });
  assert.equal(dead.kind, 'retry');
  assert.equal(dead.network, true);

  const none = await sendReport(record, { fetchFn: undefined });
  assert.equal(none.kind, 'retry');

  const hung = await sendReport(record, {
    timeoutMs: 20,
    fetchFn: (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))),
  });
  assert.equal(hung.kind, 'retry', 'cut off after the timeout instead of waiting forever');
});

// ---------------- the queue ----------------
async function filled(n = 3, store = memoryStore()) {
  const outbox = createOutbox(store);
  for (let i = 0; i < n; i++) await outbox.add(createRecord({ ...validateReport(good, jobs).value, panels: i }, { now: at(i), id: `R-${i + 1}` }));
  return outbox;
}

test('outbox: lists oldest first however they were stored, counts by status, removes', async () => {
  const outbox = createOutbox(memoryStore());
  await outbox.add(createRecord({ ...validateReport(good, jobs).value }, { now: at(5), id: 'R-late' }));
  await outbox.add(createRecord({ ...validateReport(good, jobs).value }, { now: at(1), id: 'R-early' }));
  assert.deepEqual((await outbox.list()).map((r) => r.id), ['R-early', 'R-late']);
  assert.equal((await outbox.counts()).pending, 2);
  await outbox.remove('R-early');
  assert.deepEqual((await outbox.list()).map((r) => r.id), ['R-late']);
});

test('outbox: only the newest few sent reports are kept as history', async () => {
  const outbox = createOutbox(memoryStore());
  for (let i = 0; i < KEEP_SENT + 3; i++) {
    await outbox.add({ ...createRecord(validateReport(good, jobs).value, { now: at(i), id: `R-${String(i).padStart(2, '0')}` }), status: 'sent' });
  }
  const ids = (await outbox.list()).map((r) => r.id);
  assert.equal(ids.length, KEEP_SENT);
  assert.equal(ids[0], 'R-03', 'the oldest three were dropped');
});

test('outbox: waiting reports are never pruned, however many there are', async () => {
  const outbox = await filled(KEEP_SENT + 5);
  assert.equal((await outbox.list()).length, KEEP_SENT + 5);
});

test('outbox: update/retry of a missing id is harmless, and retry only touches refused or stuck reports', async () => {
  const outbox = await filled(1);
  assert.equal(await outbox.update('R-nope', { status: 'sent' }), undefined);
  assert.equal(await outbox.retry('R-nope'), undefined);
  assert.equal((await outbox.retry('R-1')).status, 'pending', 'a waiting report is left as it is');

  await outbox.update('R-1', { status: 'rejected', attempts: 3, lastError: 'refused' });
  const again = await outbox.retry('R-1');
  assert.deepEqual([again.status, again.attempts, again.lastError], ['pending', 0, null]);
});

test('countRecords: unsent is everything a person still has to care about', () => {
  const c = countRecords([{ status: 'pending' }, { status: 'sent' }, { status: 'rejected' }, { status: 'stuck' }, { status: 'weird' }]);
  assert.deepEqual(c, { pending: 1, sent: 1, rejected: 1, stuck: 1, unsent: 3 });
});

// ---------------- flushing ----------------
const answers = (...kinds) => { const log = []; const send = async (r) => { log.push(r.id); const k = kinds.shift() ?? { kind: 'sent' }; return k; }; return { send, log }; };

test('flush: sends everything waiting, oldest first, and records the time', async () => {
  const outbox = await filled(3);
  const { send, log } = answers();
  const result = await flushOutbox({ outbox, send, now: () => new Date('2026-10-30T09:00:00Z') });
  assert.deepEqual(log, ['R-1', 'R-2', 'R-3']);
  assert.deepEqual(result, { sent: 3, rejected: 0, left: 0, stopped: false, error: null });
  const [first] = await outbox.list();
  assert.deepEqual([first.status, first.attempts, first.sentAt], ['sent', 1, '2026-10-30T09:00:00.000Z']);
});

test('flush: a temporary failure stops the run, keeps order, and counts the attempt', async () => {
  const outbox = await filled(3);
  const { send, log } = answers({ kind: 'sent' }, { kind: 'retry', network: true, message: 'No connection' });
  const result = await flushOutbox({ outbox, send });
  assert.deepEqual(log, ['R-1', 'R-2'], 'R-3 was not even tried');
  assert.equal(result.sent, 1);
  assert.equal(result.stopped, true);
  assert.equal(result.left, 2);
  assert.equal(result.error, 'No connection');
  const rows = await outbox.list();
  assert.deepEqual(rows.map((r) => [r.status, r.attempts]), [['sent', 1], ['pending', 1], ['pending', 0]]);
});

test('flush: a refused report does not block the ones behind it', async () => {
  const outbox = await filled(3);
  const { send } = answers({ kind: 'sent' }, { kind: 'rejected', message: 'refused (400)' });
  const result = await flushOutbox({ outbox, send });
  assert.deepEqual([result.sent, result.rejected, result.stopped], [2, 1, false]);
  assert.deepEqual((await outbox.list()).map((r) => r.status), ['sent', 'rejected', 'sent']);
});

test('flush: after MAX_ATTEMPTS failures a report is parked as "stuck" instead of retrying for ever', async () => {
  const outbox = await filled(1);
  for (let i = 0; i < MAX_ATTEMPTS; i++) await flushOutbox({ outbox, send: async () => ({ kind: 'retry', message: 'down' }) });
  const [row] = await outbox.list();
  assert.deepEqual([row.status, row.attempts], ['stuck', MAX_ATTEMPTS]);

  const { send, log } = answers();
  await flushOutbox({ outbox, send });
  assert.deepEqual(log, [], 'a stuck report is not sent again until a person presses "Try again"');
});

test('flush: a send function that throws is treated like a lost connection, not a crash', async () => {
  const outbox = await filled(1);
  const result = await flushOutbox({ outbox, send: async () => { throw new Error('boom'); } });
  assert.equal(result.stopped, true);
  assert.equal(result.error, 'boom');
  assert.equal((await outbox.list())[0].status, 'pending');
});

test('flush: an empty outbox is a no-op', async () => {
  const result = await flushOutbox({ outbox: createOutbox(memoryStore()), send: async () => assert.fail('nothing to send') });
  assert.deepEqual(result, { sent: 0, rejected: 0, left: 0, stopped: false, error: null });
});

test('flushWithLock: runs under the shared lock name; without Web Locks it still runs', async () => {
  const outbox = await filled(1);
  const names = [];
  const locks = { request: (name, cb) => { names.push(name); return cb(); } };
  const { send } = answers();
  assert.equal((await flushWithLock({ locks, outbox, send })).sent, 1);
  assert.deepEqual(names, [LOCK_NAME]);

  const second = await filled(1);
  assert.equal((await flushWithLock({ locks: undefined, outbox: second, send: answers().send })).sent, 1);
});

test('flushWithLock: two flushes started together send each report once (the second finds it already sent)', async () => {
  const outbox = await filled(2);
  let tail = Promise.resolve();
  const locks = { request: (name, cb) => { const run = tail.then(cb); tail = run.catch(() => {}); return run; } };
  const sentIds = [];
  const send = async (r) => { sentIds.push(r.id); await new Promise((res) => setTimeout(res, 5)); return { kind: 'sent' }; };
  await Promise.all([flushWithLock({ locks, outbox, send }), flushWithLock({ locks, outbox, send })]);
  assert.deepEqual(sentIds, ['R-1', 'R-2']);
});

// ---------------- Background Sync registration ----------------
test('background sync: registers the tag when the browser supports it', async () => {
  const tags = [];
  const nav = { serviceWorker: { ready: Promise.resolve({ sync: { register: async (t) => tags.push(t) } }) } };
  assert.equal(await registerBackgroundSync(nav), 'registered');
  assert.deepEqual(tags, [SYNC_TAG]);
});

test('background sync: says why not, instead of failing: no service workers, no sync API (iPhone), no worker yet, refused', async () => {
  assert.equal(await registerBackgroundSync({}), 'unsupported');
  assert.equal(await registerBackgroundSync(undefined), 'unsupported');
  assert.equal(await registerBackgroundSync({ serviceWorker: { ready: Promise.resolve({}) } }), 'unsupported');
  assert.equal(await registerBackgroundSync({ serviceWorker: { ready: new Promise(() => {}) } }, { timeoutMs: 10 }), 'unavailable');
  const none = await registerBackgroundSync({ serviceWorker: { getRegistration: async () => undefined, ready: new Promise(() => {}) } }, { timeoutMs: 5000 });
  assert.equal(none, 'unavailable', 'no registered worker: answered at once, not after the timeout');
  const refused = { serviceWorker: { ready: Promise.resolve({ sync: { register: async () => { throw new Error('NotAllowedError'); } } }) } };
  assert.equal(await registerBackgroundSync(refused), 'failed');
});

test('the report kinds offered in the form are the ones validation accepts', () => {
  for (const kind of REPORT_KINDS) assert.equal(validateReport({ ...good, kind, note: 'x' }, jobs).ok, true);
});
