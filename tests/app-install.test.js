// Runs the real js/app.js with a fake browser to prove the install bar, the Install page and the
// menu link are connected correctly. Site storage is BLOCKED here (reading localStorage throws, as in
// some private windows), so every step also proves the app copes without it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeBrowser, fakeOffer } from './helpers/fake-dom.js';

const browser = installFakeBrowser({
  windowExtras: {
    get localStorage() { throw new Error('SecurityError: site data is blocked'); },
  },
});
const { elements, windowListeners, goto, clickAction } = browser;
const flush = () => new Promise((r) => setTimeout(r, 5));

test('first screen: the app starts even though site storage is blocked, and the bar stays hidden', async () => {
  await import('../js/app.js');
  assert.match(elements.app.innerHTML, /Dashboard/);
  assert.equal(elements['install-banner'].hidden, true);
  assert.equal(elements['nav-install'].hidden, false, 'the Install link is in the menu');
});

test('the browser offer arrives, and after a second screen the bar appears with an Install button', () => {
  const offer = fakeOffer();
  offer.label = 'offer-1';
  browser.offer1 = offer;
  windowListeners.beforeinstallprompt(offer);
  assert.equal(offer.prevented, true, "the browser's own mini-bar is suppressed");
  assert.equal(elements['install-banner'].hidden, true, 'still only one screen seen');

  goto('#/jobs');
  assert.equal(elements['install-banner'].hidden, false);
  assert.match(elements['install-banner-text'].textContent, /works with no signal/);
  assert.equal(elements['install-btn'].hidden, false);
  assert.equal(elements['install-how'].hidden, true, 'the "how" link is only for iPhones');
});

test('the bar is not shown on the Install page itself, and returns on other screens', () => {
  goto('#/install');
  assert.equal(elements['install-banner'].hidden, true, 'the page already has the button, a second prompt would be noise');
  goto('#/jobs');
  assert.equal(elements['install-banner'].hidden, false);
});

test('"Not now" hides the bar and keeps it hidden on later screens (remembered in memory when storage is blocked)', () => {
  elements['install-later'].listeners.click();
  assert.equal(elements['install-banner'].hidden, true);
  goto('#/inventory');
  goto('#/quote');
  assert.equal(elements['install-banner'].hidden, true);
});

test('the Install page still offers the button after "Not now"', () => {
  goto('#/install');
  assert.match(elements['install-status'].innerHTML, /Ready to install/);
  assert.match(elements['install-status'].innerHTML, /data-action="install-now"/);
});

test('a broken install window shows a clear message with manual steps, and the page keeps working', async () => {
  windowListeners.beforeinstallprompt(fakeOffer({ promptThrows: new Error('NotAllowedError') }));
  await clickAction('install-now');
  await flush();
  const html = elements['install-status'].innerHTML;
  assert.match(html, /The install window could not open/);
  assert.match(html, /NotAllowedError/);
  assert.match(html, /Install app/, 'manual steps are offered instead');
  assert.doesNotMatch(html, /data-action="install-now"/, 'a used offer cannot be tried again');
});

test('cancelling the install window explains that nothing changed', async () => {
  windowListeners.beforeinstallprompt(fakeOffer({ outcome: 'dismissed' }));
  assert.match(elements['install-status'].innerHTML, /Ready to install/, 'a fresh offer re-arms the button');
  await clickAction('install-now');
  await flush();
  const html = elements['install-status'].innerHTML;
  assert.match(html, /Install was cancelled/);
  assert.match(html, /Install cancelled\. You can try again later/);
});

test('accepting installs: success note, menu link removed, bar never returns', async () => {
  const offer = fakeOffer({ outcome: 'accepted' });
  windowListeners.beforeinstallprompt(offer);
  await clickAction('install-now');
  await flush();
  assert.equal(offer.promptCalls, 1);
  assert.match(elements['install-status'].innerHTML, /SunGrid Solar is installed/);
  assert.match(elements['install-status'].innerHTML, /Installing now/);
  assert.equal(elements['nav-install'].hidden, true, 'nothing left to do on the Install page');
  goto('#/jobs');
  goto('#/quote');
  assert.equal(elements['install-banner'].hidden, true);
});

test('the appinstalled event after the fact changes nothing and does not throw', () => {
  assert.doesNotThrow(() => windowListeners.appinstalled());
  assert.equal(elements['nav-install'].hidden, true);
});

test('an install click when the browser never made an offer says what to do instead', async () => {
  // Fresh page state is not possible in this process (the app is installed), so check the message path directly.
  const { createInstallController } = await import('../js/install.js');
  const c = createInstallController({ window: { addEventListener() {} }, navigator: { userAgent: 'x', serviceWorker: {} } });
  const result = await c.promptInstall();
  assert.equal(result.ok, false);
  assert.match(result.message, /Install app/);
});
