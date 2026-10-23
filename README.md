# SunGrid Solar: app shell and routing

An offline-ready progressive web app (PWA) for **SunGrid Solar**, a solar panel installer in Lahore. This repository is **Task 1**: the app shell, routing and a first usable set of screens, set up so the next tasks (forms, storage, sync, and so on) can build on it.

It is plain HTML, CSS and JavaScript (ES modules). There is **no build step and no dependencies**, so it runs the same on a developer laptop, on GitHub Pages and on a customer's phone.

**Live demo:** `https://<Hashim-rajahh>.github.io/sungrid-solar/` (after GitHub Pages is switched on, see [Deploy](#deploy-to-github-pages))

## What it does

| Screen | Route | What it is for |
|---|---|---|
| Dashboard | `#/` | Jobs in progress, pipeline value, installed kWp, stock that needs reordering, next steps due |
| Jobs | `#/jobs` and `#/jobs?status=Installing` | All installation jobs with status filters |
| Job detail | `#/jobs/SG-1042` | Site, system size, inverter, batteries, net-metering utility (LESCO, FESCO...), progress |
| Quote | `#/quote` | Sizes a system from a monthly electricity bill: panels, kWp, cost, savings, payback |
| Inventory | `#/inventory` | Panels, inverters and batteries in stock, with items that need reordering listed first |

Everything works with no network after the first visit: the app shell and the sample data are cached by a service worker.

## How to run it

You need [Node.js](https://nodejs.org) 20 or newer. Nothing to install.

```bash
git clone https://github.com/<Hashim-rajahh>/sungrid-solar.git
cd sungrid-solar
npm start
```

Open **http://localhost:8081/**.

No Node? Any static file server works, for example `py -m http.server 8080` (Windows) or `python3 -m http.server 8080`.

> Do not open `index.html` by double-clicking it. Service workers (the offline feature) only run on `http://localhost` or `https://`, not on `file://`. The app still loads from `file://`, but the footer will say offline mode is unavailable.

## How to check it works

### 1. Automated checks

```bash
npm test          # 56 tests, about half a second
npm run measure   # file sizes and render times against budgets
```

### 2. Manual check (about 3 minutes)

1. **Dashboard loads** with names like *Ahmed Raza* and *Usman Traders*, and the footer eventually says **Ready for offline use ✓**.
2. **Routing:** click *Jobs*, then the *Installing* filter, then open a job. Use the browser back button; each step returns to the previous screen. Reload on a job page; you stay on that job (deep links work).
3. **Wrong input is handled:**
   - `#/jobs/SG-9999` shows "Job not found" with a link back.
   - `#/anything-else` shows "Page not found".
   - `#/jobs?status=Banana` says it is not a job status.
   - On *Quote*, press **Calculate** with the form empty: each field gets its own message. Try `abc`, `0`, `-5`, `20` and `99999` in the units box; each gives a different, specific message.
4. **Valid quote:** `600`, *Lahore*, *On-grid* gives **5.18 kWp, 9 panels, Rs 8,28,000, payback about 2.1 years**.
5. **Offline:** open Chrome DevTools, go to **Application, Service Workers** and tick **Offline** (or **Network, Offline**), then reload. The app still loads, a yellow "You are offline" bar appears, and every screen still works.

## Sample data

All data lives in [`js/data.js`](js/data.js) and was written to match how a Pakistani solar installer works:

- **8 jobs** across the whole pipeline (Site survey → Quoted → Approved → Installing → Net-metering → Commissioned) in Lahore (DHA, Johar Town, Bahria Town, Model Town, Gulberg, Wapda Town, Kot Lakhpat) and Faisalabad.
- Real equipment names: JA Solar 575 W panels, Huawei SUN2000 and Growatt inverters, Pylontech US5000 batteries.
- **Net-metering utilities** per city (LESCO, FESCO, GEPCO, MEPCO, IESCO), because getting the utility's bi-directional meter approved is a real step in every grid-tied job.
- **10 inventory items** with prices in rupees, including one out-of-stock and some items below their reorder level, so alerts are visible.
- Amounts use Pakistani grouping (`Rs 17,20,000`).

The prices, sun hours and tariff are indicative sample figures, not a real price list. They are all in one `pricing` object so they are easy to review.

## Wrong or empty input

Nothing is allowed to crash the page. Every failure shows a message that says what to do next:

| Situation | What the user sees |
|---|---|
| Unknown URL | "Page not found" with a button to the dashboard |
| Unknown job ID | "No job with that ID" with a link to the job list |
| Bad `?status=` filter | "Not a job status. Pick one of the filters above" |
| Status with no jobs | "No jobs are at 'Installing' right now" |
| No jobs / no stock at all | Empty-state panels instead of blank pages |
| Quote: empty, not a number, zero or negative, under 50 units, over 5,000 units | A different, specific message for each |
| Quote: missing city or system type | Message under that field, focus moves to the first problem |
| Malformed URL such as `%E0%A4%A` | Treated as not found |
| A view throws unexpectedly | "Something went wrong" page; the shell stays usable |
| Text from the URL | HTML-escaped everywhere (no injection) |
| Service worker unavailable | Footer note; the app keeps working online |

## Tests

Run with `npm test` (Node's built-in test runner, no dependencies). **56 tests in 6 files**:

| File | Main path | Failure paths |
|---|---|---|
| `router.test.js` | every route resolves; job id and query parsed | unknown paths, malformed `%` encoding, garbage input |
| `quote.test.js` | 600 units in Lahore matches a hand calculation (9 panels, 5.175 kWp, Rs 8,28,000, 33,000/month saving); hybrid adds batteries | empty, text, zero, negative, tiny, huge; bad city/type; `constructor` as a city name |
| `views.test.js` | dashboard, list, filter, detail, inventory, quote form | not found, unknown job, escaped HTML injection, empty data, a view that throws |
| `util-data.test.js` | rupee / date / number formatting; every job and stock record is consistent | bad input to formatters; no placeholder text in the sample data |
| `pwa.test.js` | manifest valid, icons exist, every cached file exists | a file missing from the offline cache; root-absolute URLs that would break GitHub Pages |
| `app.test.js` | the real `app.js` against a fake DOM: first render, navigation, valid quote submit | empty form submit, other forms ignored, offline banner, service worker failure |

**A bug these tests caught:** `(5.175).toFixed(2)` returns `"5.17"` in JavaScript because of binary floating-point, so the quote showed **5.17 kWp** for a 5.175 kWp system. `formatNumber` now rounds half-up correctly and has a regression test.

## Measured results

From `npm run measure` (Node 22):

| Measure | Result | Budget |
|---|---|---|
| First load (HTML, CSS, JS, favicon), gzip | **15.5 KB** (42.4 KB raw) | 25 KB |
| Everything cached for offline, gzip | **25.0 KB** (52.5 KB raw) | 40 KB |
| Time to build any screen's HTML | **about 0.1 ms or less** (worst of 6 routes) | 5 ms |

Measuring found a real problem: the first version of the icons made the offline cache **66.5 KB** gzip, over budget, because three 32-bit PNGs took about 50 KB. Reducing them to a 32-colour palette (the artwork is two flat colours) gave **25.0 KB** with no visible change. See `scripts/make-icons.py`.

Lighthouse (Chrome DevTools, Mobile): Performance **__** · Accessibility **__** · Best practices **__** · SEO **__** · Installable PWA **__**  ⟵ FILL IN after running Lighthouse on the live URL

## Decision: hash routing instead of the History API

**The choice.** Routes are URLs like `index.html#/jobs/SG-1042` (hash routing), handled by [`js/router.js`](js/router.js), instead of clean URLs like `/jobs/SG-1042` (the History API, `pushState`).

**Why.** SunGrid Solar will be used by installers on phones, often with poor signal, and the hosting is a plain static host (GitHub Pages) with no server logic.

- With clean URLs, opening or refreshing `/jobs/SG-1042` asks the *server* for that path. A static host has no such file and returns a 404, so every host needs a "rewrite everything to index.html" rule, and the service worker needs matching fallback logic. A GitHub Pages project site also lives under `/sungrid-solar/`, which makes this fiddlier.
- With hash URLs, the browser only ever requests `index.html`. The part after `#` never reaches the server, so every deep link, refresh and offline reload works on any host with zero configuration, and the offline cache has exactly one page to remember.

**Trade-offs accepted.**

- URLs are slightly less pretty (`#/jobs` rather than `/jobs`).
- Hash URLs are poor for search engines. That is acceptable because this is a logged-in field and office tool, not a marketing site.
- `#anchor` links to a spot within a page cannot be used inside the app.

**When to revisit.** If SunGrid later wants a public, indexable website (for example a page per service area), move that part to the History API on a host with rewrite rules. The router is isolated in one small file with `parseHash` and `matchRoute` as pure functions, so changing it means swapping those two functions and the event listener in `app.js`; the views do not change.

### Other decisions made in this step

| Decision | Alternative | Why / cost |
|---|---|---|
| **No framework, no build step** | React / Vite | Whole app is about 15 KB gzip and has no tooling to break or update. Cost: no component model or hot reload; if the UI grows a lot, a framework may be worth adding in a later task. |
| **Views are pure functions returning HTML strings** (`js/views.js`) | Build DOM nodes directly | Testable in plain Node with no browser, and render time is measured in tenths of a millisecond. Cost: every dynamic value must go through `esc()`; this is covered by an injection test. |
| **Service worker: cache-first with a versioned cache** | Stale-while-revalidate | All files of one release come from one consistent cache, so a new `views.js` can never run with an old `data.js`. Cost: when any shell file changes you **must bump `VERSION` in `sw.js`**; a test fails if a file is missing from the list, but it cannot detect a forgotten bump. |
| **Sample data bundled in `js/data.js`** | Fetch JSON / IndexedDB | Works offline with no loading states for this task. Cost: data is read-only. Task 2 onward should move it behind a small storage module (IndexedDB) so screens do not change. |
| **Icons quantised to 32 colours** | Full-colour PNGs | Offline cache went from 66.5 KB to 25.0 KB gzip (see Measured results). |
| **All URLs relative (`./`)** | `/`-rooted URLs | Needed so the app works under `/sungrid-solar/` on GitHub Pages; a test enforces it. |

## Project layout

```
index.html              the shell: header, nav, <main id="app">, footer
manifest.webmanifest    install metadata (name, icons, colours)
sw.js                   service worker: precache + offline fallback
css/styles.css          all styling (mobile first)
js/app.js               browser wiring: router -> views, quote form, offline banner
js/router.js            hash router (pure functions)
js/views.js             one function per screen, returns { title, html }
js/quote.js             system sizing and cost estimate (pure)
js/data.js              sample jobs, inventory, cities, pricing assumptions
js/util.js              escaping and formatting helpers
icons/                  favicon + PWA icons
tests/                  node:test suites
scripts/                serve.mjs (dev server), measure.mjs, make-icons.py
.github/workflows/      runs tests and measurements on every push
```

## How the next tasks should build on this

- **Add a screen:** (1) add `{ name, pattern }` to `ROUTES` in `router.js`, (2) write `myView(data)` in `views.js` and add a `case` in `renderRoute`, (3) add a nav link in `index.html`. Add the new JS file to `SHELL` in `sw.js` and bump `VERSION`.
- **Add data that persists:** replace the imports from `data.js` in `renderRoute` with a storage module; the views already receive their data as an argument.
- **Add a form:** follow the quote form: labelled fields, a `*-err` message element per field, `aria-invalid` on problems, one pure validation function with its own tests.

## Deploy to GitHub Pages

1. Push this folder to a GitHub repository named `sungrid-solar`.
2. **Settings → Pages → Build and deployment**: Source *Deploy from a branch*, Branch `main`, folder `/ (root)`, Save.
3. After a minute the site is at `https://<your-github-username>.github.io/sungrid-solar/`. Open it once online, then it works offline.

## Known limitations

- Quote figures are estimates from the assumptions in `pricing`; a real quote needs a site survey (roof area, shading, load profile).
- Data is read-only sample data (see the decision table above).
- Updating the app for existing users requires bumping `VERSION` in `sw.js`.
- Lighthouse results are filled in manually, because they need a real Chrome against the deployed site.
