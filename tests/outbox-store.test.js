// The IndexedDB part of the outbox, run against a fake IndexedDB (tests/helpers/fake-idb.js).
// It matters most: this is the code both the page and the service worker use to keep reports safe.

import test from 'node:test';
import assert from 'node:assert/strict';
import { openOutbox, openIdbStore, createRecord, DB_NAME, STORE_NAME } from '../js/outbox.js';
import { fakeIndexedDB } from './helpers/fake-idb.js';

const value = { jobId: 'SG-1043', kind: 'Progress update', panels: 6, note: 'East roof done', installer: 'Imran Khalid' };
const record = (id, second = 0) => createRecord(value, { now: new Date(Date.UTC(2026, 9, 30, 8, 0, second)), id });

test('store: a report written through one connection is read back, in order, with every field intact', async () => {
  const idb = fakeIndexedDB();
  const { outbox, durable } = await openOutbox(idb);
  assert.equal(durable, true);
  await outbox.add(record('R-2', 2));
  await outbox.add(record('R-1', 1));
  assert.deepEqual((await outbox.list()).map((r) => r.id), ['R-1', 'R-2']);
  assert.deepEqual(await outbox.get('R-1'), record('R-1', 1));
  assert.equal(await outbox.get('R-nope'), undefined);
  assert.ok(idb.databases.get(DB_NAME).stores.has(STORE_NAME), 'the object store was created on first open');
});

test('store: the page and the service worker share one database: what one writes, the other sends', async () => {
  const idb = fakeIndexedDB();
  const page = (await openOutbox(idb)).outbox;
  const worker = (await openOutbox(idb)).outbox; // a second, separate connection to the same database
  await page.add(record('R-1'));
  assert.equal((await worker.list()).length, 1);
  await worker.update('R-1', { status: 'sent' });
  assert.equal((await page.get('R-1')).status, 'sent');
});

test('store: reports survive "closing the app": a fresh connection sees what the old one saved', async () => {
  const idb = fakeIndexedDB();
  await (await openOutbox(idb)).outbox.add(record('R-1'));
  assert.equal((await (await openOutbox(idb)).outbox.list()).length, 1);
});

test('store: what comes back is a copy; changing it does not silently change the stored report', async () => {
  const { outbox } = await openOutbox(fakeIndexedDB());
  await outbox.add(record('R-1'));
  const copy = await outbox.get('R-1');
  copy.status = 'sent';
  assert.equal((await outbox.get('R-1')).status, 'pending');
});

test('store: update and remove change the stored report', async () => {
  const { outbox } = await openOutbox(fakeIndexedDB());
  await outbox.add(record('R-1'));
  await outbox.update('R-1', { status: 'rejected', lastError: 'refused' });
  assert.equal((await outbox.get('R-1')).lastError, 'refused');
  await outbox.remove('R-1');
  assert.deepEqual(await outbox.list(), []);
});

// ---------------- failure paths ----------------
test('failure: if the browser refuses IndexedDB (private window), the outbox still works in memory and says it is not durable', async () => {
  const { outbox, durable, reason } = await openOutbox(fakeIndexedDB({ openError: new Error('SecurityError: storage blocked') }));
  assert.equal(durable, false);
  assert.match(reason, /storage blocked/);
  await outbox.add(record('R-1'));
  assert.equal((await outbox.list()).length, 1);
});

test('failure: no IndexedDB at all, an open() that throws, and an open that is blocked by another tab each give a readable reason', async () => {
  assert.match((await openOutbox(undefined)).reason, /no IndexedDB/);
  assert.match((await openOutbox({ open() { throw new Error('open exploded'); } })).reason, /open exploded/);
  assert.match((await openOutbox(fakeIndexedDB({ blocked: true }))).reason, /Close other SunGrid Solar tabs/);
  await assert.rejects(() => openIdbStore(undefined), /no IndexedDB/);
});

test('failure: a full device (writes abort) rejects with a message instead of losing the report silently', async () => {
  const { outbox, durable } = await openOutbox(fakeIndexedDB({ writeError: new Error('QuotaExceededError') }));
  assert.equal(durable, true, 'opening worked; only writing fails');
  await assert.rejects(() => outbox.add(record('R-1')), /QuotaExceededError/);
  assert.deepEqual(await outbox.list(), [], 'reading still works');
});

test('failure: a database without the store (corrupt or from another app) rejects clearly', async () => {
  const idb = fakeIndexedDB();
  idb.databases.set(DB_NAME, { version: 1, stores: new Map() });
  const store = await openIdbStore(idb);
  await assert.rejects(() => store.all(), /NotFoundError/);
});
