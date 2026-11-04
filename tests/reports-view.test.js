// The Reports page, the report list and the messages under the form (js/views.js). Pure functions: HTML in, text out.

import test from 'node:test';
import assert from 'node:assert/strict';
import { renderRoute, reportsView, reportsListHtml, reportOutcomeHtml, jobDetailView } from '../js/views.js';
import { resolve } from '../js/router.js';
import { formatWhen } from '../js/util.js';
import { jobs } from '../js/data.js';
import { REPORT_KINDS, MAX_ATTEMPTS } from '../js/outbox.js';

const rec = (over = {}) => ({
  id: 'R-1', createdAt: '2026-10-30T08:00:00.000Z', status: 'pending', attempts: 0, lastError: null,
  jobId: 'SG-1043', kind: 'Progress update', panels: 6, note: 'East roof done', installer: 'Imran Khalid', ...over,
});

// ---------------- the page ----------------
test('route: #/reports resolves and renders the form and the list area', () => {
  assert.equal(resolve('#/reports').name, 'reports');
  const { title, html } = renderRoute(resolve('#/reports'));
  assert.equal(title, 'Site reports');
  for (const id of ['report-form', 'report-job', 'report-kind', 'report-panels', 'report-note', 'report-installer', 'report-result', 'reports-list']) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  for (const id of ['report-job-err', 'report-kind-err', 'report-panels-err', 'report-note-err', 'report-installer-err']) assert.match(html, new RegExp(`id="${id}"`));
});

test('form: offers every job (id and customer) and every report type', () => {
  const { html } = reportsView({ jobs });
  for (const j of jobs) assert.ok(html.includes(`<option value="${j.id}">${j.id} · ${j.customer}`) || html.includes(`${j.id} · ${j.customer.replace('&', '&amp;')}`), j.id);
  for (const k of REPORT_KINDS) assert.match(html, new RegExp(`<option value="${k}">`));
  assert.match(html, /data-action="report-example"/);
});

test('form: ?job=SG-1043 preselects that job; an unknown job selects nothing and does not break', () => {
  assert.match(reportsView({ jobs }, { job: 'SG-1043' }).html, /<option value="SG-1043" selected>/);
  assert.doesNotMatch(reportsView({ jobs }, { job: 'SG-0000' }).html, /selected/);
  assert.doesNotMatch(reportsView({ jobs }, { job: '"><script>alert(1)</script>' }).html, /<script>/);
});

test('form: with no jobs at all the page still renders (an empty job list, not an error)', () => {
  const { html } = reportsView({ jobs: [] });
  assert.match(html, /Select a job/);
});

test('job page links to the report form with that job preselected', () => {
  const { html } = jobDetailView({ jobs }, 'SG-1043');
  assert.match(html, /href="#\/reports\?job=SG-1043"/);
});

// ---------------- the list ----------------
test('list: empty gives a helpful sentence', () => {
  assert.match(reportsListHtml([]), /No reports yet/);
});

test('list: each status has its own words, newest first, with date, panels and installer', () => {
  const html = reportsListHtml([
    rec({ id: 'R-1', status: 'sent', createdAt: '2026-10-30T08:00:00.000Z' }),
    rec({ id: 'R-2', status: 'pending', createdAt: '2026-10-30T09:00:00.000Z', jobId: 'SG-1044' }),
    rec({ id: 'R-3', status: 'rejected', lastError: 'The office server refused this report (error 400).', createdAt: '2026-10-30T10:00:00.000Z' }),
    rec({ id: 'R-4', status: 'stuck', attempts: MAX_ATTEMPTS, lastError: 'No connection', createdAt: '2026-10-30T11:00:00.000Z' }),
  ]);
  for (const label of ['Sent to office', 'Waiting to send', 'Refused by server', 'Needs attention']) assert.match(html, new RegExp(label));
  assert.ok(html.indexOf('report-stuck') < html.indexOf('report-pending') && html.indexOf('report-pending') < html.indexOf('report-sent'), 'newest first');
  assert.match(html, /6 panels fitted · Imran Khalid/);
  assert.match(html, /1 waiting to send · 2 need attention · 1 sent/);
  assert.match(html, new RegExp(`Could not be sent after ${MAX_ATTEMPTS} tries`));
  assert.match(html, /refused this report \(error 400\)/);
});

test('list: "Send now" appears only when something is waiting; Try again / Remove only for refused or stuck reports', () => {
  assert.doesNotMatch(reportsListHtml([rec({ status: 'sent' })]), /Send now|Try again|Remove/);
  assert.match(reportsListHtml([rec()]), /data-action="reports-send"/);
  const refused = reportsListHtml([rec({ id: 'R-9', status: 'rejected', lastError: 'x' })]);
  assert.match(refused, /data-action="report-retry" data-id="R-9"/);
  assert.match(refused, /data-action="report-remove" data-id="R-9"/);
  assert.doesNotMatch(refused, /Send now/);
});

test('list: a waiting report that already failed says so, with the try number', () => {
  assert.match(reportsListHtml([rec({ attempts: 2, lastError: 'No connection to the office server.' })]), /Last try failed: No connection to the office server\. \(try 2\)/);
});

test('list: when the browser cannot keep data on the device, the warning comes first', () => {
  const html = reportsListHtml([rec()], { durable: false });
  assert.match(html, /cannot keep reports on the device/);
  assert.match(reportsListHtml([], { durable: false }), /cannot keep reports on the device/);
});

test('list: anything an installer typed is escaped (a note cannot inject HTML or script)', () => {
  const evil = '<img src=x onerror=alert(1)> & "quotes"';
  const html = reportsListHtml([rec({ note: evil, installer: evil, jobId: evil, kind: evil, lastError: evil, status: 'rejected', id: evil })]);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; &amp; &quot;quotes&quot;/);
  assert.doesNotMatch(html, /data-id="<|data-id="[^"]*"[^>]*onerror/);
});

test('list: a damaged record (missing fields, unknown status) is shown, not a crash', () => {
  const html = reportsListHtml([{ id: 'R-x', status: 'weird' }]);
  assert.match(html, /Waiting to send/);
  assert.doesNotMatch(html, /undefined|null/);
});

// ---------------- messages under the form ----------------
test('outcome: invalid lists each problem', () => {
  const html = reportOutcomeHtml({ kind: 'invalid', errors: { panels: 'Enter how many panels were fitted today (0 if none).', installer: 'Enter your name so the office knows who filed this.' } });
  assert.match(html, /Please fix the following/);
  assert.match(html, /<li>Enter how many panels/);
  assert.match(html, /<li>Enter your name/);
});

test('outcome: sent, refused and not-saved each say what happened and what to do', () => {
  assert.match(reportOutcomeHtml({ kind: 'sent', id: 'R-1' }), /Report R-1 reached the office/);
  assert.match(reportOutcomeHtml({ kind: 'refused', message: 'The office server refused this report (error 404).' }), /kept in the list so you can try again/);
  assert.match(reportOutcomeHtml({ kind: 'not-saved', message: 'No signal and no storage.' }), /Report not saved[\s\S]*No signal and no storage/);
});

test('outcome: queued says why it is waiting and whether it can go out with the app closed', () => {
  const offline = reportOutcomeHtml({ kind: 'queued', online: false, sync: 'registered', durable: true });
  assert.match(offline, /You have no signal/);
  assert.match(offline, /even if you close the app/);

  const iphone = reportOutcomeHtml({ kind: 'queued', online: false, sync: 'unsupported', durable: true });
  assert.match(iphone, /open SunGrid Solar again/);
  assert.match(iphone, /cannot send in the background/);

  const down = reportOutcomeHtml({ kind: 'queued', online: true, sync: 'registered', durable: true });
  assert.match(down, /server did not answer/);

  assert.match(reportOutcomeHtml({ kind: 'queued', online: false, sync: 'failed', durable: false }), /do not close this page/);
});

test('outcome: text from the server or the browser is escaped', () => {
  assert.doesNotMatch(reportOutcomeHtml({ kind: 'not-saved', message: '<b>x</b>' }), /<b>/);
});

// ---------------- time ----------------
test('formatWhen: day, month, year and 24-hour time in the device time zone; junk becomes a dash', () => {
  const iso = new Date(2026, 9, 30, 15, 4).toISOString(); // built in local time, so the test passes in any time zone
  assert.equal(formatWhen(iso), '30 Oct 2026, 15:04');
  assert.equal(formatWhen('not a date'), '—');
  assert.equal(formatWhen(undefined), '—');
  assert.equal(formatWhen(null), '—');
});
