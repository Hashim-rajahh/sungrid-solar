# SunGrid Solar: service worker and offline cache

An offline-ready progressive web app (PWA) for **SunGrid Solar**, a solar panel installer in Lahore. This repository is **Task 2**, built on the app shell and routing from Task 1: a service worker that saves the whole app on the phone, a safe way to update it, and an **Offline** page that tells an installer whether the app is ready before driving to a site with weak signal.

**Live app:** https://sungrid-solar.netlify.app/  
**Repository:** https://github.com/Hashim-rajahh/sungrid-solar

It is plain HTML, CSS and JavaScript (ES modules). There is **no build step and no dependencies**, so it runs the same on a developer laptop, on Netlify and on a customer's phone.

## Why it works this way: a day in the life of an installer

1. **Morning, at the office (online).** The installer opens the app once. The service worker saves all 16 app files on the phone. The footer says **Ready for offline use ✓**.
2. **On a rooftop in DHA or Johar Town (no signal).** The installer opens job SG-1043, checks the inverter and next step, runs a quote for the customer, and looks at stock. Nothing waits on the network.
3. **Evening, back in signal.** The app quietly checks for a new version. If one is ready, a blue bar says so. It is applied only when the installer taps **Reload to update**, never in the middle of a quote.

## What this step adds

| Part | File | What it does |
|---|---|---|
| Service worker | [`sw.js`](sw.js) | Saves 16 files at install, answers every page load and file from the saved copy, and never throws when something is missing |
| Registration and updates | [`js/sw-register.js`](js/sw-register.js) | Registers the worker, detects a new version, waits for the user, reloads exactly once when the update is applied |
| Offline status | [`js/offline.js`](js/offline.js) | Works out one plain-language verdict from raw browser facts (files saved, storage, update waiting) |
| Offline page | `#/offline` in [`js/views.js`](js/views.js) | "Ready for site visits", file count, app version, storage used, update state, buttons to re-check, check for updates, remove the copy |
| Version stamp | [`scripts/stamp-sw.mjs`](scripts/stamp-sw.mjs) | Sets the cache version from a hash of the file contents, so a release can never ship with a forgotten version number |
| Real-browser check | [`scripts/verify-offline.mjs`](scripts/verify-offline.mjs) | Runs the whole offline and update story in Chromium with the network switched off |

## How to run it

You need [Node.js](https://nodejs.org) 20 or newer. Nothing to install.

```bash
git clone https://github.com/Hashim-rajahh/sungrid-solar.git
cd sungrid-solar
npm start
```

Open the address it prints (normally **http://localhost:8080/**; if that port is busy it uses the next free one).

> Open the app through `http://localhost` or `https://`, not by double-clicking `index.html`. Browsers only allow service workers on those addresses. From `file://` the app still loads, and the footer says offline mode is unavailable.

## How to check it works

### 1. Automated checks

```bash
npm test               # 120 tests, about 1 second
npm run measure        # file sizes and render times against budgets
npm run verify:offline # optional: real Chromium, network switched off (see below)
```

`verify:offline` needs a browser driver, which the app itself does not use: run `npm i --no-save playwright-core` once, and set `CHROMIUM_PATH` to a Chrome or Chromium if you do not have one installed for Playwright. It works on a throw-away copy of the project and prints 14 PASS/FAIL checks.

### 2. Manual check (about 5 minutes)

1. **Saved:** run `npm start`, open the app, wait for the footer to say **Ready for offline use ✓**.
2. **Offline page:** click **Offline** in the menu. The card says **Ready for site visits** and **16 of 16 files**.
3. **No signal:** in Chrome DevTools open **Application → Service Workers** and tick **Offline** (or stop `npm start` entirely). Reload while on `#/jobs/SG-1043`. The job still opens, a yellow "You are offline" bar appears, the calculator on **Quote** still works (try `600`, *Lahore*, *On-grid* for 5.18 kWp, 9 panels, Rs 8,28,000).
4. **Wrong input:** while offline, open `#/jobs/SG-9999` (job not found message) and type `localhost:8080/jobs/SG-1042` without the `#` (it is sent back to the app root instead of showing a broken page). On **Quote**, press Calculate with empty fields: each field gets its own message.
5. **New version:** untick Offline. Change any visible text in `js/views.js`, run `npm run stamp`, and reload once. A blue bar appears: the page does **not** reload by itself. Tap **Reload to update** and the new text appears. **Offline** now shows a new app version.
6. **Remove the copy:** on **Offline**, open "Advanced: remove the offline copy". It asks first, deletes the saved app, and says how to set it up again.

## Wrong, empty or unexpected situations

Nothing is allowed to crash. Every failure gives a message that says what to do next.

| Situation | What happens |
|---|---|
| File never saved and no signal | The worker answers with a plain 503 message ("SunGrid Solar is offline and this file is not saved…") instead of an unhandled error |
| Opened before the first install finished and offline | Same clear message, no crash |
| A file is missing or the network drops during install | The whole install fails, so a half-saved version never takes over; the previous version keeps working |
| Address without `#` such as `/jobs/SG-1042` | Sent to the app root, because index.html would otherwise load with broken file paths |
| Query string on a file (`icon-192.png?v=2`) | Still served from the saved copy |
| POST requests and other websites | Left alone, not touched by the worker |
| Browser without service worker support, or `file://` | Footer and Offline page explain what to use instead; the app keeps working online |
| Saved copy incomplete (for example 14 of 16 files) | Offline page says **Offline copy is incomplete** and how many are missing |
| Phone storage over 90% full | Warning that the phone may delete the saved app |
| Worker does not answer a status request | Times out after 2 seconds and asks the user to reload once online, rather than hanging |
| Checking for updates while offline | Fails quietly, keeps the saved version, tells the user they are offline |
| Removing the offline copy | Asks first; failures show a message instead of throwing |
| Unknown page, job, filter or bad quote input | Unchanged from Task 1: specific message for each, nothing crashes |

## Sample data

The data is the same realistic Pakistani solar-installer data as Task 1 ([`js/data.js`](js/data.js)): eight jobs from site survey to commissioned in Lahore and Faisalabad, JA Solar 575 W panels, Huawei and Growatt inverters, Pylontech batteries, LESCO/FESCO/GEPCO/MEPCO/IESCO net-metering, ten stock items with one out of stock, and rupee amounts in lakh format (`Rs 17,20,000`). The Offline page builds its "Works with no signal" list from that data (job sheets, stock items, cities and utilities), so the numbers it shows are real counts, not text typed in.

## Tests

Run with `npm test` (Node's built-in runner, no dependencies). **120 tests in 10 files.** The service worker file itself is loaded in a sandbox with a fake cache and fake network, so its real code is tested, not a copy.

| File | Tests | Main path | Failure paths |
|---|---|---|---|
| `sw.test.js` | 19 | install saves every file bypassing the HTTP cache; offline load serves saved page and files; unsaved file is fetched once then works offline; old version caches are removed | failed or 404 install rejects; offline miss gives 503 not an exception; address without `#` redirected; POST and other sites ignored; broken storage answers with an error |
| `sw-register.test.js` | 9 | first install reports ready without reloading; update flow: found → installed → banner → tap → takes over → exactly one reload | registration failure; no support at all; first install not announced as an update; update check while offline |
| `offline.test.js` | 22 | ready, update-ready and offline-but-complete verdicts with real counts | unsupported browser, first visit, silent helper, incomplete copy, low storage, thrown errors, clearing failures |
| `stamp.test.js` | 6 | `sw.js` version matches the real files; changes when a cached file changes | stale version fails the test; missing file or missing list reported clearly; Windows and Linux line endings give the same version |
| `app.test.js` | 12 | page wiring: first render, navigation, valid quote, Offline page buttons | empty form, unavailable offline mode, removal asks first and shows failures, clicks that are not actions |
| `pwa.test.js` | 7 | manifest valid, every cached file exists, none missing from the list | root-absolute URLs, uncached file |
| `router`, `views`, `quote`, `util-data` | 45 | Task 1 behaviour (plus the new `#/offline` route and view) | Task 1 failure paths |

**What the real browser check proves (`verify:offline`, 14 checks, all passing):** first visit saves 16 of 16 files; with the network off, a deep link to a job renders styled, the quote calculator gives 5.18 kWp, bad input gives a clear message, the Offline page says "Ready for site visits", and an address without `#` lands on the working app root; there are no console errors; after a simulated new release the blue banner appears, the page is **not** reloaded by itself, both versions are kept while it waits, and after **Reload to update** only the new version remains.

## Measured results

From `npm run measure` (Node 22):

| Measure | Task 1 | Now | Budget |
|---|---|---|---|
| First load (HTML, CSS, JS, favicon), gzip | 15.5 KB | **21.2 KB** (59.1 KB raw) | 25 KB |
| Everything saved for offline, gzip | 25.0 KB | **30.6 KB** (69.2 KB raw) | 40 KB |
| Time to build any screen's HTML | about 0.1 ms | **0.035 ms or less** (worst of 6 routes) | 5 ms |

So the whole offline feature (worker, update flow, status page) costs about **5.6 KB gzip** and stays inside both budgets.

From `npm run verify:offline` (Chromium, local server, no network throttling):

| Measure | Result |
|---|---|
| First visit until "ready for offline" | **243 ms** |
| Opening a deep link with the network off (median of 7) | **80 ms** (range 64 to 93 ms) |
| Files saved on the device | 16 of 16 (the browser reports 108.9 KB of storage used by the app) |

These timings are from a fast local machine, so they show the worker adds no waiting, not what a phone on 3G will see. The result that matters for a roof visit is binary: with no signal the app opens, and it did in every run.

Lighthouse on the deployed site after Task 1 (`https://sungrid-solar.netlify.app/#/inventory`): Performance **83** · Accessibility **100** · Best Practices **100** · SEO **100**.

## Decision: a new version waits until the user taps "Reload to update"

**The choice.** When a new version of the app is found, the service worker installs it in the background and **waits**. It only takes over when the user taps **Reload to update** in the blue bar. The alternative, `skipWaiting()` on install, would switch every open page to the new version immediately.

**Why.** An installer on a roof may be half-way through typing a customer's monthly units or reading a job sheet. A silent switch (or an automatic reload) would throw that away at the worst moment, in a place where reconnecting and starting again is expensive. Waiting also means the page in front of the user and its saved files always belong to the same release, and a half-installed version can never run.

**Trade-offs accepted.**

- A user who ignores the blue bar keeps running the old version, so a fix reaches that phone later. The bar is persistent and the Offline page also shows "New version ready", but it relies on the user.
- A little more code and testing: a message from page to worker (`SKIP_WAITING`), a one-time reload when the new worker takes over, and a guard so the very first install does not reload the page. These are covered in `sw-register.test.js` and the real-browser check.
- Two copies of the app (about 70 KB raw each) are stored while an update waits. It is cleaned up as soon as the new version activates.

**When to revisit.** If a critical fix must reach everyone quickly (for example a wrong tariff in the quote), add a "required update" flag that the page treats as automatic. The structure already supports it: only `applyUpdate()` in `sw-register.js` needs to be called by the app instead of by a button.

### Other decisions made in this step

| Decision | Alternative | Why / cost |
|---|---|---|
| **Version is a hash of the file contents** (`npm run stamp`) | Edit a version number by hand (Task 1) | The browser installs a new copy only when `sw.js` changes. A hand-edited number is forgotten, and then users keep a stale app. A test fails if the stamp is out of date. Cost: one command to run after changing a cached file (`npm run stamp`). |
| **All files saved together, or none** (`cache.addAll`) | Save files one by one and skip failures | A release is always complete and consistent: a new `views.js` cannot run with an old `data.js`. Cost: one missing file fails the whole install; the previous version keeps working and the failure is visible in the test and in the Offline page. |
| **Install fetches with `cache: 'reload'`** | Default fetch | Skips the browser's HTTP cache so a new version can never be built from stale files. Cost: slightly more data on install. |
| **Saved copy first, network second, for files** | Network first | Instant start with no signal and no waiting for a timeout. Cost: files not in the list are saved the first time they are fetched online, so a brand-new file added later must be put in the list. |
| **Plain 503 message for anything unavailable** | Let the request fail | The user sees a sentence that says what to do, and the code never raises an unhandled error. |
| **Status asked of the worker over a message channel** with a 2-second timeout | Count files from the page | The count reflects what the worker really saved, and a silent worker produces a message instead of a frozen page. |
| **Update check on load, when back online, and hourly** | Only on load | Phones keep the app open all day; this finds a release without the user doing anything, while still waiting for their tap to apply it. |

## Project layout

```
index.html              the shell: header, nav, update bar, <main id="app">, footer
manifest.webmanifest    install metadata (name, icons, colours)
sw.js                   service worker: save, answer, clean up, report status
css/styles.css          all styling (mobile first)
js/app.js               browser wiring: router -> views, quote form, offline page, update bar
js/router.js            hash router (pure functions)
js/views.js             one function per screen, returns { title, html }
js/sw-register.js       registration and update flow (no DOM)
js/offline.js           offline status verdicts (no DOM)
js/quote.js             system sizing and cost estimate (pure)
js/data.js              sample jobs, inventory, cities, pricing assumptions
js/util.js              escaping and formatting helpers
icons/                  favicon + PWA icons
tests/                  node:test suites
scripts/                serve.mjs, measure.mjs, stamp-sw.mjs, verify-offline.mjs, make-icons.py
netlify.toml            publish folder and headers (sw.js is never cached by the browser)
.github/workflows/      runs tests and measurements on every push
```

## How the next tasks should build on this

- **Change or add any app file:** make sure it is listed in `SHELL` in `sw.js`, run `npm run stamp`, then `npm test`. A test fails if a file is missing from the list or the stamp is stale.
- **Add data that persists** (saving job notes or stock counts on the phone): put it behind a storage module such as IndexedDB; the views already receive their data as an argument, and the Offline page can report how many unsent changes are waiting.

## Deploy to Netlify

The app is static, so there is nothing to build. [`netlify.toml`](netlify.toml) sets the publish folder to the repository root and adds headers:

- `sw.js` is served with `no-cache`, so a new release is noticed on the next visit instead of being held back by the browser's HTTP cache. This matters more now that the app updates itself.
- `manifest.webmanifest` is served with the correct `application/manifest+json` type.
- Basic security headers (`X-Content-Type-Options`, `Referrer-Policy`).

To deploy: import the repository in Netlify, leave the build command empty and set the publish directory to `.`. Netlify serves over HTTPS, which service workers require. After pushing a change, run `npm run stamp` first so the new version is detected.

## Known limitations

- Job and stock figures are read-only sample data saved inside the app. Editing them offline and syncing with the office is the next step.
- Browsers can delete saved site data when a phone is very low on storage, and Safari can clear it for sites not opened for about a week. The Offline page warns when storage is nearly full; it cannot prevent the phone from clearing data.
- The update check runs only while the app is open (on load, when the connection returns, and hourly).
- Timings are from a local machine without throttling. The Lighthouse scores were taken after Task 1 and should be re-run on the latest deployment.
