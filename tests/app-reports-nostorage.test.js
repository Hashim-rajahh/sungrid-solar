// The Reports page in a browser that will not give the app IndexedDB (some private windows).
// The app must say so honestly and never pretend a report is safe when it is not.

import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeBrowser } from './helpers/fake-dom.js';
import { fakeIndexedDB } from './helpers/fake-idb.js';
import { until, untilQuiet } from './helpers/settle.js';

const office = { down: false, posts: [] };
globalThis.fetch = async (url, init) => {
  if (office.down) throw new TypeError('Failed to fetch');
  office.posts.push(Object.fromEntries(new URLSearchParams(init.body)));
  return { status: 200 };
};
globalThis.indexedDB = fakeIndexedDB({ openError: new Error('SecurityError: storage is blocked') });

const browser = installFakeBrowser();
const { elements, goto } = browser;
const watched = () => [office.posts.length, ...['report-result', 'reports-list'].map((id) => elements[id] && elements[id].innerHTML)].join('|');
const settle = () => untilQuiet(watched);
const setOnline = (v) => Object.defineProperty(globalThis.navigator, 'onLine', { configurable: true, value: v });
const valid = { jobId: 'SG-1043', kind: 'Progress update', panels: '6', note: '', installer: 'Imran Khalid' };

async function fileReport(values) {
  if (elements['report-result']) elements['report-result'].innerHTML = '';
  elements.app.listeners.submit({ target: { id: 'report-form', values, reset() {} }, preventDefault() {} });
  await until(() => elements['report-result'] && elements['report-result'].innerHTML !== '');
  await settle();
}

test('the page warns that reports cannot be kept on this device', async () => {
  await import('../js/app.js');
  goto('#/reports');
  await settle();
  assert.match(elements['reports-list'].innerHTML, /cannot keep reports on the device/);
});

test('offline with nowhere to keep it: the report is refused with a clear reason instead of silently lost', async () => {
  setOnline(false);
  await fileReport(valid);
  assert.match(elements['report-result'].innerHTML, /Report not saved/);
  assert.match(elements['report-result'].innerHTML, /no signal and this browser cannot keep reports on the device/);
  assert.match(elements['report-result'].innerHTML, /storage is blocked/);
  assert.equal(office.posts.length, 0);
});

test('online it still works (sent straight away); if the server is down it waits, with a "do not close this page" warning', async () => {
  setOnline(true);
  await fileReport(valid);
  assert.equal(office.posts.length, 1);
  assert.match(elements['report-result'].innerHTML, /Sent to the office/);

  office.down = true;
  await fileReport({ ...valid, panels: '2' });
  assert.match(elements['report-result'].innerHTML, /do not close this page/);
});
