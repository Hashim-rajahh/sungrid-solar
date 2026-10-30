# SunGrid Solar

An offline-ready progressive web app (PWA) for **SunGrid Solar**, a solar panel installer in Lahore. Installers use it on site, often with weak or no signal, to open job sheets, size a quote from a customer's electricity bill and check stock. It works with no signal at all, and it can be installed on a phone's home screen.

**Live app:** https://sungrid-solar.netlify.app/  
**Repository:** https://github.com/Hashim-rajahh/sungrid-solar

It is plain HTML, CSS and JavaScript (ES modules). There is **no build step and no dependencies**, so it runs the same on a laptop, on Netlify and on a phone.

## The project in three steps

| Step | What it delivers | Main files | Decision recorded |
|---|---|---|---|
| **1. App shell and routing** | The page frame and menu, a hash router, five screens, a quote calculator, realistic sample data | [`index.html`](index.html), [`js/router.js`](js/router.js), [`js/views.js`](js/views.js), [`js/quote.js`](js/quote.js), [`js/data.js`](js/data.js) | [Hash routing instead of the History API](#step-1-hash-routing-instead-of-the-history-api) |
| **2. Service worker and offline cache** | The whole app saved on the device, works with no signal, safe updates, an Offline page | [`sw.js`](sw.js), [`js/sw-register.js`](js/sw-register.js), [`js/offline.js`](js/offline.js), [`scripts/stamp-sw.mjs`](scripts/stamp-sw.mjs) | [A new version waits until the user taps "Reload to update"](#step-2-a-new-version-waits-until-the-user-taps-reload-to-update) |
| **3. Install prompt and icons** | Install bar, Install page, full icon set, long-press shortcuts, screenshots | [`js/install.js`](js/install.js), [`manifest.webmanifest`](manifest.webmanifest), [`icons/`](icons), [`screenshots/`](screenshots) | [The app holds the browser's install offer and shows its own bar after the second screen](#step-3-the-app-holds-the-browsers-install-offer-and-shows-its-own-bar-after-the-second-screen) |

## What the app does

| Screen | Route | What it is for |
|---|---|---|
| Dashboard | `#/` | Jobs in progress, pipeline value, installed kWp, stock that needs reordering, next steps due |
| Jobs | `#/jobs` and `#/jobs?status=Installing` | All installation jobs with status filters |
| Job detail | `#/jobs/SG-1042` | Site, system size, inverter, batteries, net-metering utility (LESCO, FESCO...), progress |
| Quote | `#/quote` | Sizes a system from a monthly electricity bill: panels, kWp, cost, savings, payback |
| Inventory | `#/inventory` | Panels, inverters and batteries in stock, items to reorder listed first |
| Offline | `#/offline` | Whether the app is saved on this device, app version, storage used, update state |
| Install | `#/install` | How to put the app on the home screen, for this device, plus the shortcuts and icon previews |

## A day in the life of an installer

1. **Morning, at the office (online).** The installer opens the app once. The service worker saves all 23 app files on the phone and the footer says **Ready for offline use ✓**. After a second screen, a bar offers to install the app, and it lands on the home screen with the SunGrid sun icon.
2. **On a rooftop in DHA or Johar Town (no signal).** The installer opens the app from the home screen, checks job SG-1043's inverter and next step, runs a quote for the customer and looks at stock. Nothing waits on the network. Pressing and holding the icon jumps straight to **New quote**, **Installs in progress** or **Stock to reorder**.
3. **Evening, back in signal.** The app quietly checks for a new version. If one is ready, a blue bar says so, and it is applied only when the installer taps **Reload to update**, never in the middle of a quote.

## Running it

Node.js 20 or newer is needed. There is nothing to install.

```bash
git clone https://github.com/Hashim-rajahh/sungrid-solar.git
cd sungrid-solar
npm start
```

The address it prints (normally **http://localhost:8080/**; the next free port is used if that one is busy) can be opened in Chrome or Edge. Browsers allow service workers and install only on `http://localhost` or `https://`. The same app is live at the link above. Any static file server also works, for example `python3 -m http.server 8080`.

## Checking it

### Automated checks

```bash
npm test                # 175 tests, about 2 seconds
npm run measure         # file sizes and render times against budgets
npm run verify:offline  # real Chromium: offline cache and updates (14 checks)
npm run verify:install  # real Chromium: installability, icons, install flow (30 checks)
```

The two `verify:` scripts need a browser driver that the app itself does not use (`npm i --no-save playwright-core`, and `CHROMIUM_PATH` pointing at Chrome or Chromium if Playwright has none). They work on a throw-away copy of the project and exit with code 1 if any check fails.

### Manual check, step 1: shell and routing (about 3 minutes)

1. **Dashboard loads** with names like *Ahmed Raza* and *Usman Traders*.
2. **Routing:** click *Jobs*, then the *Installing* filter, then open a job. The browser's back button returns through each step. Reload on a job page and the same job stays open (deep links work).
3. **Wrong input is handled:** `#/jobs/SG-9999` shows "Job not found" with a link back; `#/anything-else` shows "Page not found"; `#/jobs?status=Banana` says it is not a job status. On *Quote*, pressing **Calculate** with empty fields gives each field its own message; `abc`, `0`, `-5`, `20` and `99999` each give a different, specific message.
4. **Valid quote:** `600`, *Lahore*, *On-grid* gives **5.18 kWp, 9 panels, Rs 8,28,000, payback about 2.1 years**.

### Manual check, step 2: offline cache and updates (about 5 minutes)

1. **Saved:** wait for the footer to say **Ready for offline use ✓**, then open **Offline** in the menu. The card says **Ready for site visits** and **23 of 23 files**.
2. **No signal:** in Chrome DevTools open **Application → Service Workers**, tick **Offline** and reload while on `#/jobs/SG-1043`. The job still opens, a yellow "You are offline" bar appears, and the calculator on **Quote** still works.
3. **Wrong input while offline:** `#/jobs/SG-9999` still gives "Job not found". Typing `localhost:8080/jobs/SG-1042` without the `#` is sent back to the app root instead of a broken page.
4. **New version:** untick Offline, change any visible text in `js/views.js`, run `npm run stamp` and reload once. A blue bar appears and the page does **not** reload by itself; **Reload to update** applies the change and **Offline** shows a new app version.
5. **Remove the copy:** on **Offline**, "Advanced: remove the offline copy" asks first, deletes the saved app and says how to set it up again.

### Manual check, step 3: install and icons (about 5 minutes)

1. Open the app, then click **Jobs** and **Quote**. Chrome decides by itself when to offer install (usually within a few seconds of a first visit); once it has, the bar appears on the next screen, and the browser's address bar also shows its install icon.
2. Click **Install** in the menu. The status card says **Ready to install** with a button, which opens the browser's own install window.
3. In Chrome DevTools open **Application → Manifest**. It lists the app identity, the 4 icons (tick *Show only the minimum safe area for maskable icons* to see the sun stay whole), the 3 shortcuts and the 4 screenshots, and *Installability* shows no errors.
4. After installing, the app opens in its own window and the **Install** menu entry is gone. Right-clicking its taskbar or dock icon (or pressing and holding it on Android) shows the three shortcuts.
5. Press **Not now** on the bar: it disappears and stays hidden after a reload.
6. With DevTools **Offline** ticked, open `#/install`: the page and all six of its images still load.
7. **Android, Chrome:** use two screens and tap **Install** in the bar. **iPhone or iPad, Safari:** the bar says **Show me how** and the Install page lists the Share button, **Add to Home Screen** and **Add**. **Chrome on iPhone:** the page says to open the address in Safari, because only Safari can add to the home screen on iOS.

## Sample data

All data lives in [`js/data.js`](js/data.js) and was written to match how a Pakistani solar installer works:

- **8 jobs** across the whole pipeline (Site survey → Quoted → Approved → Installing → Net-metering → Commissioned) in Lahore (DHA, Johar Town, Bahria Town, Model Town, Gulberg, Wapda Town, Kot Lakhpat) and Faisalabad.
- Real equipment names: JA Solar 575 W panels, Huawei SUN2000 and Growatt inverters, Pylontech US5000 batteries.
- **Net-metering utilities** per city (LESCO, FESCO, GEPCO, MEPCO, IESCO), because getting the utility's bi-directional meter approved is a real step in every grid-tied job.
- **10 inventory items** with prices in rupees, including one out of stock and some below their reorder level, so alerts are visible.
- Amounts use Pakistani grouping (`Rs 17,20,000`). Prices, sun hours and tariff are indicative sample figures, not a real price list, and sit in one `pricing` object.

Later steps reuse the same data instead of typing in new numbers:

- The **Offline** page's "Works with no signal" list counts the real jobs, stock items, cities and utilities.
- The **Install** page's "Why install it" list shows the real counts (8 job sheets, 10 stock items).
- The three **shortcuts** are the three things an installer opens on a job: **New quote**, **Installs in progress** (jobs filtered to status *Installing*) and **Stock to reorder**. Their icons are a calculator, a clipboard and a carton.
- The four **screenshots** in the manifest come from the running app: the dashboard (3 jobs in progress, Rs 49,05,000 pipeline, 13.55 kWp installed), the job sheet for SG-1043, and a 600-unit Lahore quote (9 panels, Rs 8,28,000, LESCO net-metering).

A test fails if any placeholder text such as "lorem" or "tbd" appears in the sample data.

## Wrong, empty or unexpected situations

Nothing is allowed to crash. Every failure gives a message that says what to do next.

**Screens and the quote form (step 1)**

| Situation | What the user sees |
|---|---|
| Unknown URL | "Page not found" with a button to the dashboard |
| Unknown job ID | "No job with that ID" with a link to the job list |
| Bad `?status=` filter | "Not a job status. Pick one of the filters above" |
| Status with no jobs | "No jobs are at 'Installing' right now" |
| No jobs or no stock at all | Empty-state panels instead of blank pages |
| Quote: empty, not a number, zero or negative, under 50 units, over 5,000 units | A different, specific message for each |
| Quote: missing city or system type | Message under that field, focus moves to the first problem |
| Malformed URL such as `%E0%A4%A` | Treated as not found |
| A view throws unexpectedly | "Something went wrong" page; the shell stays usable |
| Text from the URL | HTML-escaped everywhere (no injection) |

**Offline cache and updates (step 2)**

| Situation | What happens |
|---|---|
| File never saved and no signal | The worker answers with a plain 503 message ("SunGrid Solar is offline and this file is not saved…") instead of an unhandled error |
| Opened before the first install finished and offline | Same clear message, no crash |
| A file is missing or the network drops during install | The whole install fails, so a half-saved version never takes over; the previous version keeps working |
| Address without `#` such as `/jobs/SG-1042` | Sent to the app root, because index.html would otherwise load with broken file paths |
| Query string on a file (`icon-192.png?v=2`) | Still served from the saved copy |
| POST requests and other websites | Left alone, not touched by the worker |
| Browser without service worker support | Footer and Offline page explain what to use instead; the app keeps working online |
| Saved copy incomplete (for example 21 of 23 files) | Offline page says **Offline copy is incomplete** and how many are missing |
| Phone storage over 90% full | Warning that the phone may delete the saved app |
| Worker does not answer a status request | Times out after 2 seconds and asks the user to reload once online, rather than hanging |
| Checking for updates while offline | Fails quietly, keeps the saved version, tells the user they are offline |
| Removing the offline copy | Asks first; failures show a message instead of throwing |

**Install (step 3)**

| Situation | What happens |
|---|---|
| Browser has not offered install (or the offer was already used) | Install page shows manual steps; pressing the button says "The browser has not offered installing yet. Use the browser menu" |
| Install window cancelled | "Install was cancelled. Nothing was changed", with the manual route; the bar rests for 14 days |
| Install window refuses to open (for example `NotAllowedError: Needs a user gesture`) | "The install window could not open", with the browser's own reason and the manual steps; the rest of the app keeps working. The browser's offer can be used only once, so it is dropped |
| Already installed (standalone window, or iPhone home-screen app) | No bar, no Install menu entry; the page says "You are using the installed app" |
| Installed from the browser menu instead of the bar (`appinstalled` event) | Noticed: the bar and menu entry go away |
| iPhone or iPad in Safari | Bar offers **Show me how**; the page lists the three Share-menu steps |
| Chrome, Firefox, Edge or an in-app browser on iPhone | No bar it cannot act on; the page says to open the address in Safari |
| Insecure address (plain `http://` on a real host) or a browser without service workers | Red card: "Install is not available here", with what to use instead, no button |
| Site storage blocked or full (private window) | "Not now" still works for the visit, held in memory; nothing throws, the app still starts |
| Saved "Not now" data is damaged (garbage text, wrong types, a date far in the future) | Ignored, as if nothing was saved |
| Odd browser objects (event without `preventDefault`, `matchMedia` that throws, no listeners) | Handled; no exception |
| Text shown in the status cards | HTML-escaped (no injection through messages or notes) |

## Tests

Run with `npm test` (Node's built-in runner, no dependencies). **175 tests in 14 files.** The service worker file itself is loaded in a sandbox with a fake cache and fake network, so its real code is tested, not a copy.

| Step | File | Tests | Main path | Failure paths |
|---|---|---|---|---|
| 1 | `router.test.js` | 8 | every route resolves; job id and query parsed | unknown paths, malformed `%` encoding, garbage input |
| 1 | `quote.test.js` | 9 | 600 units in Lahore matches a hand calculation (9 panels, 5.175 kWp, Rs 8,28,000, 33,000/month saving); hybrid adds batteries | empty, text, zero, negative, tiny, huge; bad city or type; `constructor` as a city name |
| 1 | `views.test.js` | 18 | dashboard, list, filter, detail, inventory, quote form | not found, unknown job, escaped HTML injection, empty data, a view that throws |
| 1 | `util-data.test.js` | 10 | rupee, date and number formatting; every job and stock record is consistent | bad input to formatters; no placeholder text in the sample data |
| 1 | `app.test.js` | 12 | the real `app.js` against a fake DOM: first render, navigation, valid quote, Offline page buttons | empty form, other forms ignored, offline banner, service worker failure, removal asks first |
| 1, 2, 3 | `pwa.test.js` | 7 | manifest valid, every cached file exists, none missing from the list | root-absolute URLs, uncached file |
| 2 | `sw.test.js` | 19 | install saves every file bypassing the HTTP cache; offline load serves saved page and files; unsaved file is fetched once, then works offline; old version caches are removed | failed or 404 install rejects; offline miss gives 503, not an exception; address without `#` redirected; POST and other sites ignored; broken storage answers with an error |
| 2 | `sw-register.test.js` | 9 | first install reports ready without reloading; update flow: found → installed → banner → tap → takes over → exactly one reload | registration failure; no support at all; first install not announced as an update; update check while offline |
| 2 | `offline.test.js` | 22 | ready, update-ready and offline-but-complete verdicts with real counts | unsupported browser, first visit, silent helper, incomplete copy, low storage, thrown errors, clearing failures |
| 2 | `stamp.test.js` | 6 | `sw.js` version matches the real files; changes when a cached file changes | stale version fails the test; missing file or list reported clearly; Windows and Linux line endings give the same version |
| 3 | `install.test.js` | 22 | the offer is kept and the verdict becomes "ready"; the bar waits until a second screen; accepting installs and hides the bar; `appinstalled` is noticed; "Not now" lasts 14 days, survives a new visit, then lapses; iPhone Safari gets "how" instead of a button | no offer, broken window (offer not reused), cancelled window, old browsers that answer from `prompt()`, blocked or absent storage, damaged saved data, insecure address, Chrome on iPhone, odd inputs that must not throw, named errors shown with their reason |
| 3 | `install-view.test.js` | 9 | `#/install` route, real counts from the data, three shortcuts, icons under the shapes phones use, button only when install is offered | every image on the page exists, empty data, HTML escaped, unsupported browser shows a red card with no button |
| 3 | `manifest.test.js` | 14 | one `any` and one `maskable` icon at 192 and 512; every icon is a real PNG of the declared size; `any` has transparent corners; `maskable` and the iPhone icon are fully opaque; shortcuts equal the ones on the Install page and open real screens; screenshots at declared size; everything needed offline is saved by the service worker | no combined `any maskable` icon; absolute addresses; a file that is not a PNG is reported by name instead of passing |
| 3 | `app-install.test.js` | 10 | the real `app.js` against a fake DOM: offer arrives, bar after a second screen, hidden on the Install page, accepting installs and removes the menu entry | blocked storage at start, broken window, cancelled window, `appinstalled` after the fact, an install click when no offer was made |

**Bugs the tests caught.** `(5.175).toFixed(2)` returns `"5.17"` in JavaScript because of binary floating-point, so the quote showed **5.17 kWp** for a 5.175 kWp system. `formatNumber` now rounds half-up correctly and has a regression test.

**What the real-browser checks prove (Chromium 153, all passing):**

- **`verify:offline` (14 checks).** A first visit saves 23 of 23 files. With the network off, a deep link to a job renders styled, the quote calculator gives 5.18 kWp, bad input gives a clear message, the Offline page says "Ready for site visits", and an address without `#` lands on the working app root; there are no console errors. After a simulated new release the blue banner appears, the page is **not** reloaded by itself, both versions are kept while it waits, and after **Reload to update** only the new version remains.
- **`verify:install` (30 checks).**
  - *Chromium's own verdict:* it parses the manifest with no errors and reports no installability errors, **both online and with the network switched off** (the icons come from the saved copy).
  - *The icons, pixel by pixel:* all 4 manifest icons decode at their declared size; `any` icons have transparent corners and `maskable` icons none; the maskable artwork reaches 0.333 of the width from the centre (limit 0.40); the iPhone icon is 180 × 180 and fully opaque; shortcut icons are 96 × 96; the 4 screenshots match their declared sizes.
  - *The install flow:* the page takes over from the browser's own bar; no bar on the first screen; bar after the second; hidden on the Install page; **Not now** is remembered for 14.00 days and survives a reload; installing opens the browser window exactly once and removes the menu entry; a cancelled window and a broken window are each explained, and the app keeps working.
  - *Other devices:* already installed shows no bar; iPhone Safari gets **Show me how** and the three Share-menu steps; Chrome on iPhone is told to open Safari.
  - *Offline:* the Install page opens with the network off and all 6 images loaded from the saved copy; no console or page errors anywhere in the run.

## Measured results

From `npm run measure` (Node 22), after each step:

| Measure | After step 1 | After step 2 | Now (step 3) | Budget now |
|---|---|---|---|---|
| First load (HTML, CSS, JS, favicon), gzip | 15.5 KB | 21.2 KB | **26.8 KB** (76.8 KB raw) | 30 KB |
| Everything saved for offline, gzip | 25.0 KB | 30.6 KB | **42.2 KB** (94.4 KB raw) | 45 KB |
| Items saved on the device | 14 | 16 | **23** | |
| Time to build any screen's HTML | 0.1 ms or less | 0.035 ms | **0.091 ms** (Install page: 0.004 ms) | 5 ms |

The render figures come from different machines, so only their order of magnitude means anything: every screen builds in about a tenth of a millisecond or less.

- **Step 1:** measuring found a real problem. The first icons made the offline copy **66.5 KB** gzip, over budget, because three 32-bit PNGs took about 50 KB. Reducing them to a 32-colour palette (the artwork is two flat colours) gave **25.0 KB** with no visible change.
- **Step 2:** the whole offline feature (worker, update flow, status page) cost about **5.6 KB gzip**.
- **Step 3:** the install feature costs **5.6 KB gzip on first load** (the install logic is 3.9 KB of it) and **11.6 KB in the offline copy**, of which about 5 KB is the new icons. Both budgets were raised in this step, from 25 KB to 30 KB and from 40 KB to 45 KB, with the reasons given under the step 3 decision. The screenshots (about 360 KB) are in the repository but deliberately not saved on the phone, so they are not in these totals.

From the real-browser runs (local server, no throttling):

| Run | First visit to "ready for offline" | Deep link opened with the network off (median of 7) | Items saved |
|---|---|---|---|
| Step 2 (earlier Chromium, faster machine) | 243 ms | 80 ms | 16 |
| Step 3 (Chromium 153) | 650 ms | about 0.2 s (range 165 to 252 ms) | 23 |

These come from different machines and browser builds, so they should not be compared with each other. They show the worker adds no noticeable wait, not what a phone on 3G will see.

Lighthouse on the deployed site after step 1 (`https://sungrid-solar.netlify.app/#/inventory`): Performance **83** · Accessibility **100** · Best Practices **100** · SEO **100**. It was not re-run for later steps.

## Decisions and their trade-offs

### Step 1: hash routing instead of the History API

**The choice.** Routes are URLs like `index.html#/jobs/SG-1042` (hash routing), handled by [`js/router.js`](js/router.js), instead of clean URLs like `/jobs/SG-1042` (the History API, `pushState`).

**Why.** SunGrid Solar is used by installers on phones, often with poor signal, and the hosting is a plain static host (Netlify) with no server logic.

- With clean URLs, opening or refreshing `/jobs/SG-1042` asks the *server* for that path. A static host has no such file and returns a 404, so every host needs a "rewrite everything to index.html" rule, and the service worker needs matching fallback logic.
- With hash URLs, the browser only ever requests `index.html`. The part after `#` never reaches the server, so every deep link, refresh and offline reload works on any host with zero configuration, and the offline cache has exactly one page to remember.

**Trade-offs accepted.**

- URLs are slightly less pretty (`#/jobs` rather than `/jobs`).
- Hash URLs are poor for search engines. That is acceptable because this is a field and office tool, not a marketing site.
- `#anchor` links to a spot within a page cannot be used inside the app.

**When to revisit.** If SunGrid later wants a public, indexable website (for example a page per service area), that part could move to the History API on a host with rewrite rules. The router is isolated in one small file with `parseHash` and `matchRoute` as pure functions, so changing it means swapping those two functions and the event listener in `app.js`; the views do not change.

**Other decisions in step 1**

| Decision | Alternative | Why / cost |
|---|---|---|
| **No framework, no build step** | React / Vite | The whole app is small and has no tooling to break or update. Cost: no component model or hot reload |
| **Views are pure functions returning HTML strings** (`js/views.js`) | Build DOM nodes directly | Testable in plain Node with no browser, and a screen builds in about a tenth of a millisecond. Cost: every dynamic value must go through `esc()`; an injection test covers it |
| **Sample data bundled in `js/data.js`** | Fetch JSON, or IndexedDB | Works offline with no loading states. Cost: data is read-only (see limitations) |
| **Icons reduced to a 32-colour palette** | Full-colour PNGs | Offline copy went from 66.5 KB to 25.0 KB gzip (see measured results) |
| **All URLs relative (`./`)** | `/`-rooted URLs | The app works from any folder or sub-path, not only a domain root; a test enforces it |

### Step 2: a new version waits until the user taps "Reload to update"

**The choice.** When a new version of the app is found, the service worker installs it in the background and **waits**. It only takes over when the user taps **Reload to update** in the blue bar. The alternative, `skipWaiting()` on install, would switch every open page to the new version immediately.

**Why.** An installer on a roof may be halfway through typing a customer's monthly units or reading a job sheet. A silent switch (or an automatic reload) would throw that away at the worst moment, in a place where reconnecting and starting again is expensive. Waiting also means the page in front of the user and its saved files always belong to the same release, and a half-installed version can never run.

**Trade-offs accepted.**

- A user who ignores the blue bar keeps running the old version, so a fix reaches that phone later. The bar is persistent and the Offline page also shows "New version ready", but it relies on the user.
- A little more code and testing: a message from page to worker (`SKIP_WAITING`), a one-time reload when the new worker takes over, and a guard so the very first install does not reload the page. These are covered in `sw-register.test.js` and the real-browser check.
- Two copies of the app are stored while an update waits, and cleaned up as soon as the new version activates.

**When to revisit.** If a critical fix must reach everyone quickly (for example a wrong tariff in the quote), a "required update" flag could make the page apply updates automatically. Only `applyUpdate()` in `sw-register.js` would need to be called by the app instead of by a button.

**Other decisions in step 2**

| Decision | Alternative | Why / cost |
|---|---|---|
| **Version is a hash of the file contents** (`npm run stamp`) | Edit a version number by hand | The browser installs a new copy only when `sw.js` changes. A hand-edited number gets forgotten, and then users keep a stale app. A test fails if the stamp is out of date. Cost: one command after changing a cached file |
| **All files saved together, or none** (`cache.addAll`) | Save files one by one and skip failures | A release is always complete and consistent: a new `views.js` cannot run with an old `data.js`. Cost: one missing file fails the whole install; the previous version keeps working and the failure is visible in the tests and the Offline page |
| **Install fetches with `cache: 'reload'`** | Default fetch | Skips the browser's HTTP cache so a new version can never be built from stale files. Cost: slightly more data on install |
| **Saved copy first, network second, for files** | Network first | Instant start with no signal and no waiting for a timeout. Cost: a brand-new file must be added to the list in `sw.js` to be saved up front |
| **Plain 503 message for anything unavailable** | Let the request fail | The user sees a sentence that says what to do, and the code never raises an unhandled error |
| **Status asked of the worker over a message channel** with a 2-second timeout | Count files from the page | The count reflects what the worker really saved, and a silent worker produces a message instead of a frozen page |
| **Update check on load, when back online, and hourly** | Only on load | Phones keep the app open all day; this finds a release without the user doing anything, while still waiting for their tap to apply it |

### Step 3: the app holds the browser's install offer and shows its own bar after the second screen

**The choice.** When Chrome or Edge decide the app can be installed, they fire a `beforeinstallprompt` event. The app calls `preventDefault()` on it, keeps the offer, and shows its own bar only after the person has opened a second screen. **Not now** silences the bar for 14 days (kept on the device). The Install page and menu entry stay available. The alternative is to leave the event alone and let the browser show its default install hint at a moment of its own choosing.

**Why.** The design assumes an installer's first visit is to look at one job sheet or run one quote. Asking to install before they have seen that the app is useful interrupts the work and is easy to dismiss without reading. After two screens the person has seen it work, and the wording can say what they gain ("works with no signal") instead of a generic browser hint. Holding the offer also lets the app give a clear message when something goes wrong, and one bar can cover both Android and iPhone.

**Trade-offs accepted.**

- **The offer can be used once.** If the install window fails to open, that offer is spent. The app shows the browser's own reason and the manual route (browser menu steps), and this is covered by tests and by the real-browser check.
- **Fewer reminders.** After **Not now** the bar stays quiet for 14 days, which may be fewer nudges than the browser's default. The Install menu entry and page remain available until the app is installed, so nothing is hidden.
- **iPhone cannot be handled the same way.** Safari on iOS fires no install event and has no install button, so those users get **Show me how** and three manual taps; Chrome on iPhone cannot install at all and is sent to Safari.
- **More code and a bigger download.** About 10 KB of install logic (3.9 KB gzip) plus 55 tests. First load grew by 5.6 KB gzip, so the first-load budget moved from 25 KB to 30 KB. At 26.8 KB the first load is still about half a second on a 400 kbps 3G link, and the install logic must be there on the first visit because the browser's offer can arrive at any moment.

**Where to change it.** The two numbers behind this behaviour, `SCREENS_BEFORE_PROMPT` (2) and `SNOOZE_DAYS` (14), are constants at the top of [`js/install.js`](js/install.js), and `describeInstall` there is the single place that decides what message each situation gets.

**Other decisions in step 3**

| Decision | Alternative | Why / cost |
|---|---|---|
| **Separate `any` and `maskable` icon files** (never `"any maskable"` in one entry) | One icon with a combined purpose | A combined icon gets cropped badly by phones that cut it into a circle, and a test forbids it. Cost: one extra 192 px file (1.1 KB gzip) |
| **Maskable artwork kept inside the central 33% of the width** (spec limit 40%); the generator stops with an error if it is not | Edge-to-edge artwork | The sun stays whole under round, rounded-square and square crops (checked pixel by pixel in Chromium). Cost: on phones that do not crop, the sun looks a little smaller than in the `any` icon |
| **iPhone icon is 180 × 180 and fully opaque** | Reuse the 192 px icon with transparent corners | iOS paints transparent areas black. Cost: one extra file (1.2 KB gzip) |
| **Tab icon as SVG and as a 32 px PNG** whose sun is thicker and simpler | SVG only | Tabs and browsers without SVG favicons still get a readable icon at 32 px. Cost: 0.5 KB |
| **Shortcuts defined once** in `js/install.js`, used by both the manifest and the Install page | Written out twice | A test fails if the two lists differ, so what the page promises is what the phone shows |
| **Shortcut icons are three simple glyphs** (calculator, clipboard, carton) in the app's two colours | Reuse the sun for all three | Recognisable at 96 px in a long-press menu. Cost: 2.1 KB gzip |
| **Stable manifest `id`** (`sungrid-solar`) | Let the browser derive identity from `start_url` | A later change to the start address will not create a second, duplicate install |
| **Everything the manifest names that the app needs is saved offline** (all icons), but **screenshots are not** | Cache screenshots too | The app stays installable with no signal (Chromium confirms), while 360 KB of screenshots that only the install dialog uses do not take space on the phone. Cost: the offline budget moved from 40 KB to 45 KB |
| **"Not now" in `localStorage`, with an in-memory copy as fallback** | Cookie, or nothing | Blocked or full storage (private windows) cannot break the app or make the bar nag; damaged saved data is ignored |
| **Install entry leaves the menu once installed** | Always show it | An installed app has nothing left to install; the page still explains the state if opened by address |
| **Icons are generated by a script and reduced to a small palette** | Hand-exported full-colour PNGs | Reproducible, safe-zone-checked, and the 9 PNG icons total about 15 KB gzip |

## Project layout

```
index.html              the shell: header, nav, update bar, install bar, <main id="app">, footer
manifest.webmanifest    identity, icons, shortcuts, screenshots
sw.js                   service worker: save, answer, clean up, report status
css/styles.css          all styling (mobile first)
js/app.js               browser wiring: router -> views, quote form, offline page, update bar, install bar
js/router.js            hash router (pure functions)
js/views.js             one function per screen, returns { title, html }
js/quote.js             system sizing and cost estimate (pure)
js/data.js              sample jobs, inventory, cities, pricing assumptions
js/util.js              escaping and formatting helpers
js/sw-register.js       registration and update flow (no DOM)
js/offline.js           offline status verdicts (no DOM)
js/install.js           install offer, bar rules, verdicts, shortcut list (no DOM)
icons/                  sun icons (any, maskable, iPhone, tab) and three shortcut glyphs
screenshots/            four screenshots of the running app for the install dialog
tests/                  node:test suites; tests/helpers has a fake DOM and a PNG reader
scripts/                serve.mjs, measure.mjs, stamp-sw.mjs, make-icons.py, make-screenshots.mjs,
                        verify-offline.mjs, verify-install.mjs
netlify.toml            publish folder and headers
.github/workflows/      runs tests and measurements on every push
```

## Hosting

The site is static and is served by Netlify at https://sungrid-solar.netlify.app/ with no build step. [`netlify.toml`](netlify.toml) publishes the repository root, serves `sw.js` with `no-cache` (so a new release is noticed on the next visit) and `manifest.webmanifest` as `application/manifest+json`, and adds basic security headers. HTTPS, which Netlify provides, is required by both service workers and install.

## Known limitations

- **Sample data is read-only.** Job and stock figures are saved inside the app; editing offline and syncing with the office is a later step. Quote figures are estimates from the assumptions in `pricing`; a real quote needs a site survey (roof area, shading, load profile).
- **Real phones.** The install flow was verified in desktop Chromium 153. iPhone Safari and Chrome on iPhone are checked by presenting their user-agent strings; the behaviour was not tried on a physical iPhone or Android phone. Chromium's manifest parsing and installability verdict are its own; the browser's `beforeinstallprompt` event is simulated in the tests, because real Chrome decides when to fire it.
- **Other browsers.** A browser that never offers install gets a generic "install from the browser menu" message; the exact menu wording differs between browsers. iOS offers no install event, so installing there is always manual (platform limitation).
- **Saved data can be removed by the phone.** Browsers can delete saved site data when a phone is very low on storage, and Safari can clear it for sites not opened for about a week. The Offline page warns when storage is nearly full but cannot prevent it.
- **Update checks** run only while the app is open (on load, when the connection returns, and hourly).
- **Update check in headless Chrome 153.** In the test environment, an update check requested after the app had been opened offline three or more times stayed pending for over a minute (the same happens with the step 2 code; one or two offline openings were fine). `verify:offline` therefore runs its update step before the repeated offline loads. The cause was not investigated further and the behaviour was not seen on a real device.
- **Timings** are from local machines without throttling. The Lighthouse scores were taken after step 1 and not repeated.
