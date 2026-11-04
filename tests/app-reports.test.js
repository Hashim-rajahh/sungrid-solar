// Runs the real js/app.js with a fake browser, a fake IndexedDB and a fake office server, to prove the Reports page,
// the outbox, the menu count and the sending are connected correctly. One story, in order, like an installer's day.

import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeBrowser } from './helpers/fake-dom.js';
import { fakeIndexedDB } from './helpers/fake-idb.js';
import { SYNC_TAG } from '../js/outbox.js';
import { sampleReports } from '../js/data.js';
import { until, untilQuiet } from './helpers/settle.js';

// ---- the fake office server and the fake service worker ----
const office = { status: 200, down: false, posts: [] };
globalThis.fetch = async (url, init) => {
  if (office.down) throw new TypeError('Failed to fetch');
  office.posts.push({ url, ...Object.fromEntries(new URLSearchParams(init.body)) });
  return { status: office.status };
};
globalThis.indexedDB = fakeIndexedDB();

const syncTags = [];
const swMessages = {};
const browser = installFakeBrowser({
  navigatorExtras: {
    serviceWorker: {
      controller: null,
      addEventListener: (type, fn) => { swMessages[type] = fn; },
      getRegistration: async () => ({}),
      register: async () => { throw new Error('no worker in this test'); },
      ready: Promise.resolve({ sync: { register: async (tag) => { syncTags.push(tag); } } }),
    },
  },
});
const { elements, windowListeners, goto, clickAction } = browser;
// Wait until nothing on screen (and nothing sent to the office) has changed for 100 ms, instead of a fixed pause.
const watched = () => [office.posts.length, ...['report-result', 'reports-list', 'outbox-count'].map((id) => elements[id] && `${elements[id].innerHTML}${elements[id].hidden}`)].join('|');
const settle = () => untilQuiet(watched);
const setOnline = (v) => Object.defineProperty(globalThis.navigator, 'onLine', { configurable: true, value: v });

/** Type into the form and press "Save report". */
async function fileReport(values) {
  const form = { id: 'report-form', values, reset() { for (const id of ['report-job', 'report-kind', 'report-panels', 'report-note', 'report-installer']) elements[id].value = ''; } };
  if (elements['report-result']) elements['report-result'].innerHTML = '';
  elements.app.listeners.submit({ target: form, preventDefault() {} });
  // The page always writes a message under the form when it has finished with a report, whatever happened to it.
  await until(() => elements['report-result'] && elements['report-result'].innerHTML !== '');
  await settle();
}
const valid = { jobId: 'SG-1043', kind: 'Progress update', panels: '6', note: 'East roof done', installer: 'Imran Khalid' };

test('the Reports page opens with the form and an empty list; the menu shows no count', async () => {
  await import('../js/app.js');
  goto('#/reports');
  await settle();
  assert.match(elements.app.innerHTML, /id="report-form"/);
  assert.match(elements['reports-list'].innerHTML, /No reports yet/);
  assert.equal(elements['outbox-count'].hidden, true);
});

test('pressing Save on an empty form shows a message under every field, marks them, focuses the first, and stores nothing', async () => {
  await fileReport({});
  for (const id of ['report-job', 'report-kind', 'report-panels', 'report-installer']) {
    assert.ok(elements[`${id}-err`].textContent.length > 10, `${id} explains itself`);
    assert.equal(elements[id].attrs['aria-invalid'], 'true');
  }
  assert.equal(elements['report-note-err'].textContent, '', 'the note is optional for a normal update');
  assert.equal(elements['report-job'].focused, true);
  assert.match(elements['report-result'].innerHTML, /Please fix the following/);
  assert.match(elements['reports-list'].innerHTML, /No reports yet/);
  assert.equal(office.posts.length, 0);
});

test('online: a valid report reaches the office at once, shows "Sent", and clears the errors', async () => {
  await fileReport(valid);
  assert.equal(office.posts.length, 1);
  assert.equal(office.posts[0].job, 'SG-1043');
  assert.equal(office.posts[0]['form-name'], 'site-report');
  assert.match(elements['report-result'].innerHTML, /Sent to the office/);
  assert.match(elements['reports-list'].innerHTML, /Sent to office/);
  assert.equal(elements['report-panels-err'].textContent, '');
  assert.equal(elements['report-job'].attrs['aria-invalid'], undefined);
  assert.equal(elements['outbox-count'].hidden, true);
  assert.equal(elements['report-installer'].value, 'Imran Khalid', 'the name stays for the next report');
  assert.equal(elements['report-panels'].value, '', 'the rest of the form is cleared');
});

test('offline: the report is saved, Background Sync is requested, the menu shows 1, nothing is sent', async () => {
  setOnline(false);
  office.down = true;
  office.posts.length = 0;
  await fileReport({ ...valid, panels: '3', note: 'West roof' });

  assert.equal(office.posts.length, 0);
  assert.deepEqual(syncTags.slice(-1), [SYNC_TAG]);
  assert.match(elements['report-result'].innerHTML, /Saved on this phone/);
  assert.match(elements['report-result'].innerHTML, /even if you close the app/);
  assert.match(elements['reports-list'].innerHTML, /Waiting to send/);
  assert.equal(elements['outbox-count'].hidden, false);
  assert.match(elements['outbox-count'].innerHTML, /^1<span class="sr-only"> reports not yet sent/);
});

test('back online: the "online" event sends the waiting report (the fallback for browsers without Background Sync)', async () => {
  setOnline(true);
  office.down = false;
  windowListeners.online();
  await settle();
  assert.equal(office.posts.length, 1);
  assert.equal(office.posts[0].panels, '3');
  assert.match(elements['reports-list'].innerHTML, /2 sent/);
  assert.doesNotMatch(elements['reports-list'].innerHTML, /Waiting to send/);
  assert.equal(elements['outbox-count'].hidden, true);
});

test('online but the office server is down: the report waits, says so, and "Send now" delivers it when the server is back', async () => {
  office.down = true;
  office.posts.length = 0;
  await fileReport({ ...valid, panels: '2' });
  assert.match(elements['report-result'].innerHTML, /server did not answer/);
  assert.match(elements['reports-list'].innerHTML, /Last try failed: No connection to the office server\. It will be tried again\. \(try 1\)/);
  assert.match(elements['reports-list'].innerHTML, /data-action="reports-send"/);

  office.down = false;
  await clickAction('reports-send');
  await settle();
  assert.equal(office.posts.length, 1);
  assert.doesNotMatch(elements['reports-list'].innerHTML, /Waiting to send/);
});

test('the server refuses a report (400): it is kept with the reason; "Try again" works once the cause is fixed; "Remove" deletes it', async () => {
  office.status = 400;
  office.posts.length = 0;
  await fileReport({ ...valid, panels: '1' });
  assert.match(elements['report-result'].innerHTML, /refused the report/);
  const id = /data-action="report-retry" data-id="([^"]+)"/.exec(elements['reports-list'].innerHTML)[1];
  assert.match(elements['reports-list'].innerHTML, /Refused by server/);
  assert.equal(elements['outbox-count'].hidden, false, 'a refused report still needs attention, so the menu keeps counting it');

  office.status = 200;
  await clickAction('report-retry', { id });
  await settle();
  assert.doesNotMatch(elements['reports-list'].innerHTML, /Refused by server/);
  assert.equal(elements['outbox-count'].hidden, true);

  office.status = 400;
  await fileReport({ ...valid, panels: '4' });
  const id2 = /data-action="report-remove" data-id="([^"]+)"/.exec(elements['reports-list'].innerHTML)[1];
  await clickAction('report-remove', { id: id2 });
  await settle();
  assert.doesNotMatch(elements['reports-list'].innerHTML, /Refused by server/);
  office.status = 200;
});

test('the service worker sent something in the background: the page redraws the list when it is told', async () => {
  // simulate the worker marking the newest waiting report as sent by filing one offline and sending it "elsewhere"
  setOnline(false);
  office.down = true;
  await fileReport({ ...valid, panels: '5' });
  assert.match(elements['reports-list'].innerHTML, /Waiting to send/);

  // the other context (the worker) uses the same database
  const { openOutbox } = await import('../js/outbox.js');
  const { outbox } = await openOutbox(globalThis.indexedDB);
  for (const r of await outbox.list()) if (r.status === 'pending') await outbox.update(r.id, { status: 'sent' });
  assert.match(elements['reports-list'].innerHTML, /Waiting to send/, 'not redrawn until told');

  swMessages.message({ data: { type: 'OUTBOX_CHANGED' } });
  await settle();
  assert.doesNotMatch(elements['reports-list'].innerHTML, /Waiting to send/);
  assert.equal(elements['outbox-count'].hidden, true);
  swMessages.message({ data: { type: 'SOMETHING_ELSE' } }); // other messages are ignored
  swMessages.message({});
  setOnline(true);
  office.down = false;
});

test('"Use an example" fills the form from the sample data, and the next press shows the next example', async () => {
  await clickAction('report-example');
  assert.equal(elements['report-job'].value, sampleReports[0].jobId);
  assert.equal(elements['report-panels'].value, sampleReports[0].panels);
  assert.equal(elements['report-installer'].value, sampleReports[0].installer);
  await clickAction('report-example');
  assert.equal(elements['report-job'].value, sampleReports[1].jobId);
  assert.equal(elements['report-kind'].value, 'Problem found');
});

test('a Problem report without a note is refused with the reason; with a note it goes through', async () => {
  office.posts.length = 0;
  await fileReport({ ...valid, kind: 'Problem found', note: '' });
  assert.match(elements['report-note-err'].textContent, /Describe the problem/);
  assert.equal(office.posts.length, 0);
  await fileReport({ ...valid, kind: 'Problem found', note: 'Cracked panel on delivery' });
  assert.equal(office.posts.length, 1);
  assert.equal(office.posts[0].kind, 'Problem found');
});

test('the menu count and the list also update when you leave the Reports page and come back', async () => {
  goto('#/jobs');
  goto('#/reports');
  await settle();
  assert.match(elements['reports-list'].innerHTML, /Sent to office/, 'history is read from the device again');
});
