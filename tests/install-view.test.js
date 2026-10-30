import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve } from '../js/router.js';
import { renderRoute, installStatusHtml } from '../js/views.js';
import { describeInstall } from '../js/install.js';
import { jobs, inventory } from '../js/data.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const render = (hash, ctx) => renderRoute(resolve(hash), ctx);
const platform = { ios: false, iosSafari: false, standalone: false, secure: true, hasServiceWorker: true };
const facts = (over = {}) => ({ platform, canPrompt: false, installedNow: false, declined: false, error: null, ...over });

// ---------- main path ----------

test('#/install is a real route with its own title', () => {
  assert.equal(resolve('#/install').name, 'install');
  assert.equal(render('#/install').title, 'Install');
});

test('the Install page shows real counts from the sample data and the three shortcuts', () => {
  const { html } = render('#/install');
  assert.match(html, new RegExp(`${jobs.length} job sheets, ${inventory.length} stock items`));
  for (const name of ['New quote', 'Installs in progress', 'Stock to reorder']) assert.match(html, new RegExp(name));
  assert.match(html, /id="install-status"/);
});

test('every image on the Install page exists, so nothing shows a broken icon offline', async () => {
  const { html } = render('#/install');
  const sources = [...html.matchAll(/src="\.\/([^"]+)"/g)].map((m) => m[1]);
  assert.ok(sources.length >= 5, 'icon previews and shortcut icons are present');
  for (const src of sources) await access(path.join(root, src));
});

test('icons are previewed under the shapes phones cut them into, each with alt text', () => {
  const { html } = render('#/install');
  for (const shape of ['mask-circle', 'mask-squircle']) assert.match(html, new RegExp(shape));
  assert.match(html, /alt="Icon cut to a circle"/);
  assert.match(html, /alt="iPhone home screen icon"/);
});

test('status card: an install button appears only when the browser has offered install', () => {
  const ready = installStatusHtml(describeInstall(facts({ canPrompt: true })));
  assert.match(ready, /data-action="install-now"/);
  assert.match(ready, /Ready to install/);
  assert.match(ready, /card-ok/);

  const manual = installStatusHtml(describeInstall(facts()));
  assert.doesNotMatch(manual, /data-action="install-now"/);
  assert.match(manual, /<ol class="how-steps">/);
  assert.match(manual, /card-warn/);
});

test('status card shows an extra note under the message', () => {
  const html = installStatusHtml(describeInstall(facts({ declined: true })), 'Install cancelled. You can try again later from this page.');
  assert.match(html, /<strong>Install cancelled/);
});

// ---------- failure paths ----------

test('empty data does not break the Install page', () => {
  const { title, html } = render('#/install', { jobs: [], inventory: [] });
  assert.equal(title, 'Install');
  assert.match(html, /0 job sheets, 0 stock items/);
});

test('text in the status card is escaped (no HTML injection through notes or messages)', () => {
  const html = installStatusHtml({ state: 'x', tone: 'bad', title: '<img src=x onerror=1>', message: '<script>alert(1)</script>', steps: ['<b>step</b>'], action: null, details: [] }, '<i>note</i>');
  assert.doesNotMatch(html, /<img|<script|<b>|<i>/);
  assert.match(html, /&lt;script&gt;/);
});

test('an unsupported browser shows a red card with no button and no steps to follow', () => {
  const html = installStatusHtml(describeInstall(facts({ platform: { ...platform, hasServiceWorker: false } })));
  assert.match(html, /card-error/);
  assert.match(html, /Install is not available here/);
  assert.doesNotMatch(html, /data-action="install-now"|how-steps/);
});
