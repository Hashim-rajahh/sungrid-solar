# SunGrid Solar

An offline-ready progressive web app (PWA) for **SunGrid Solar**, a solar panel installer in Lahore. Installers use it on site, often with weak or no signal, to open job sheets, size a quote from a customer's electricity bill, check stock and file a site report for the office. It works with no signal at all, it can be installed on a phone's home screen, and a report filed with no signal is sent by itself when the connection returns.

**Live app:** https://sungrid-solar.netlify.app/  
**Repository:** https://github.com/Hashim-rajahh/sungrid-solar

It is plain HTML, CSS and JavaScript (ES modules). There is **no build step and no dependencies**, so it runs the same on a laptop, on Netlify and on a phone.

## The project in five steps

| Step | What it delivers | Main files | Decision recorded |
|---|---|---|---|
| **1. App shell and routing** | The page frame and menu, a hash router, five screens, a quote calculator, realistic sample data | [`index.html`](index.html), [`js/router.js`](js/router.js), [`js/views.js`](js/views.js), [`js/quote.js`](js/quote.js), [`js/data.js`](js/data.js) | [Hash routing instead of the History API](#step-1-hash-routing-instead-of-the-history-api) |
| **2. Service worker and offline cache** | The whole app saved on the device, works with no signal, safe updates, an Offline page | [`sw.js`](sw.js), [`js/sw-register.js`](js/sw-register.js), [`js/offline.js`](js/offline.js), [`scripts/stamp-sw.mjs`](scripts/stamp-sw.mjs) | [A new version waits until the user taps "Reload to update"](#step-2-a-new-version-waits-until-the-user-taps-reload-to-update) |
| **3. Install prompt and icons** | Install bar, Install page, full icon set, long-press shortcuts, screenshots | [`js/install.js`](js/install.js), [`manifest.webmanifest`](manifest.webmanifest), [`icons/`](icons), [`screenshots/`](screenshots) | [The app holds the browser's install offer and shows its own bar after the second screen](#step-3-the-app-holds-the-browsers-install-offer-and-shows-its-own-bar-after-the-second-screen) |
| **4. Background sync for form submissions** | A site-report form that works with no signal: reports wait in an on-device outbox and are sent by the service worker when the connection returns, even with the app closed | [`js/outbox-core.js`](js/outbox-core.js), [`js/outbox.js`](js/outbox.js), [`sw.js`](sw.js), the Reports screen in [`js/views.js`](js/views.js), the hidden form in [`index.html`](index.html) | [Save the report on the phone first, send it afterwards, and deliver at least once](#step-4-save-the-report-on-the-phone-first-send-it-afterwards-and-deliver-at-least-once) |
| **5. Tests and performance budget** | The size and speed limits live in one file and are enforced by `npm test`; a one-command check; every change to a limit needs a written reason | [`scripts/budget.json`](scripts/budget.json), [`scripts/budget-lib.mjs`](scripts/budget-lib.mjs), [`scripts/measure.mjs`](scripts/measure.mjs), [`tests/budget.test.js`](tests/budget.test.js) | [The budget is a test, and every change to a limit has to be written down](#step-5-the-budget-is-a-test-and-every-change-to-a-limit-has-to-be-written-down) |

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
| Reports | `#/reports` and `#/reports?job=SG-1043` | A site-report form (job, type, panels fitted today, note, installer) and the list of reports on this phone with their delivery status. Every job sheet links to it with that job already chosen |

## A day in the life of an installer

1. **Morning, at the office (online).** The installer opens the app once. The service worker saves all 25 app files on the phone and the footer says **Ready for offline use ✓**. After a second screen, a bar offers to install the app, and it lands on the home screen with the SunGrid sun icon.
2. **On a rooftop in DHA or Johar Town (no signal).** The installer opens the app from the home screen, checks job SG-1043's inverter and next step, runs a quote for the customer and looks at stock. Nothing waits on the network. Pressing and holding the icon jumps straight to **New quote**, **Installs in progress** or **Stock to reorder**. At the end of the day's work the installer files a **Progress update** for SG-1043 (6 panels fitted, AC/DC box still to do). With no signal the screen says **Saved on this phone** and the menu shows a `1` next to **Reports**.
3. **Evening, back in signal.** The report goes to the office by itself: in Chrome the service worker sends it even if the installer has already closed the app, and the `1` disappears. The app also quietly checks for a new version. If one is ready, a blue bar says so, and it is applied only when the installer taps **Reload to update**, never in the middle of a quote.

## Running it

Node.js 20 or newer is needed. There is nothing to install.

```bash
git clone https://github.com/Hashim-rajahh/sungrid-solar.git
cd sungrid-solar
npm start
```

The address it prints (normally **http://localhost:8080/**; the next free port is used if that one is busy) can be opened in Chrome or Edge. The same server also accepts the site reports and prints each one in the terminal (`Report received: R-… SG-1043 Progress update 6 panels by Imran Khalid`), standing in for the Netlify form that receives them on the live site. Browsers allow service workers and install only on `http://localhost` or `https://`. The same app is live at the link above. Any static file server also works, for example `python3 -m http.server 8080`.

## Checking it

### Automated checks

```bash
npm run check           # everything below that needs no browser: all tests, then the size table with room left
npm test                # 274 tests, a few seconds (includes the performance budget)
npm run measure         # file sizes and render times against scripts/budget.json (exit 0 pass, 1 over, 2 cannot run)
npm run verify:offline  # real Chromium: offline cache and updates (14 checks)
npm run verify:install  # real Chromium: installability, icons, install flow (30 checks)
npm run verify:sync     # real Chromium: reports, outbox and Background Sync (40 checks)
npm run verify:all      # the three verify scripts one after another
```

The three `verify:` scripts need a browser driver that the app itself does not use (`npm i --no-save playwright-core`, and `CHROMIUM_PATH` pointing at Chrome or Chromium if Playwright has none). They work on a throw-away copy of the project and exit with code 1 if any check fails.

The same command line runs on every push (`.github/workflows/test.yml`, Node 20 and 22): the tests, which include the performance budget, and then `npm run measure`.

### Manual check, step 1: shell and routing (about 3 minutes)

1. **Dashboard loads** with names like *Ahmed Raza* and *Usman Traders*.
2. **Routing:** click *Jobs*, then the *Installing* filter, then open a job. The browser's back button returns through each step. Reload on a job page and the same job stays open (deep links work).
3. **Wrong input is handled:** `#/jobs/SG-9999` shows "Job not found" with a link back; `#/anything-else` shows "Page not found"; `#/jobs?status=Banana` says it is not a job status. On *Quote*, pressing **Calculate** with empty fields gives each field its own message; `abc`, `0`, `-5`, `20` and `99999` each give a different, specific message.
4. **Valid quote:** `600`, *Lahore*, *On-grid* gives **5.18 kWp, 9 panels, Rs 8,28,000, payback about 2.1 years**.

### Manual check, step 2: offline cache and updates (about 5 minutes)

1. **Saved:** wait for the footer to say **Ready for offline use ✓**, then open **Offline** in the menu. The card says **Ready for site visits** and **25 of 25 files**.
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

### Manual check, step 4: reports and background sync (about 6 minutes)

1. **Online:** open **Reports** in the menu and press **Use an example**. The form fills with job SG-1043, *Progress update*, 6 panels, a note and *Imran Khalid*. Press **Save report**: a green **Sent to the office** card appears, the list shows the report as **Sent to office**, and the terminal running `npm start` prints `Report received: …`.
2. **Wrong input:** press **Save report** with the form empty. Every field gets its own message, the cursor goes to the first one and nothing is saved. Then try `abc`, `7.5` and `-2` in *Panels fitted*, and `13` for SG-1043 (the message says the job has only 12 panels in total). Choose *Problem found* with an empty note: it asks for a description.
3. **No signal:** in Chrome DevTools open **Application → Service Workers**, tick **Offline**, and save another report. The card says **Saved on this phone** and that it will be sent automatically even if the app is closed; the menu shows `1` beside **Reports**; the list shows **Waiting to send**; the terminal prints nothing.
4. **Signal returns:** untick **Offline**. The report is sent within a moment, the `1` disappears and the list shows **Sent to office**. To have the service worker do it instead of the page, repeat step 3, then in **Application → Service Workers** type `sungrid-send-reports` into the *Sync* box and press **Sync**: the worker sends the report and the list updates.
5. **Office unreachable:** with the app already open, stop `npm start` (Ctrl+C) and save a report. It says **The office server did not answer, so the report is waiting**. Start `npm start` again and press **Send now**: it is delivered.
6. **Browsers without Background Sync (Safari, Firefox):** the saved card says the report will be sent when the app is opened again with signal, instead of promising more than the browser can do.

### Manual check, step 5: tests and performance budget (about 3 minutes)

1. Run `npm run check`. The tests end with `pass 274` and `fail 0`; then a table of every saved file appears, and four lines such as `Budget: first load <= 40 KB gzip -> PASS (37.5 KB, 2.5 left)` say how much room each limit has left.
2. **Over budget:** make a copy of [`scripts/budget.json`](scripts/budget.json) named `try.json`, change `firstLoadGzipKb` to `30` both at the top and in the last `history` entry, and run `SUNGRID_BUDGET_FILE=try.json npm run measure` (in PowerShell: `$env:SUNGRID_BUDGET_FILE="try.json"; npm run measure`). The first-load line says `FAIL (37.5 KB, 7.5 OVER)`, the three largest files are named, and the exit code is 1.
3. **A limit changed without a reason:** change only the top-level `firstLoadGzipKb` to `30` in `try.json` and run it again. It stops with `Budget check could not run: … "firstLoadGzipKb" is 30 but the latest history entry (step 5) says 40 … add a history entry with the step and the reason.` and exit code 2. Nothing is measured and no stack trace is shown.
4. **A broken file:** put `{ "firstLoadGzipKb": ` in `try.json`: the message says it is not valid JSON, exit code 2.

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

- **3 example site reports** (`sampleReports`), as the installers would file them: a progress update for SG-1043 (6 panels fitted, AC/DC box still to do), a problem on SG-1044 (corroded roof sheet near the south edge, needs a structural check) and a finished job on SG-1042 (18 panels, waiting for the LESCO meter inspection). The **Use an example** button fills the form from them, and a test checks that every example passes validation, so the button can never produce an error.

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
| Saved copy incomplete (for example 23 of 25 files) | Offline page says **Offline copy is incomplete** and how many are missing |
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

**Site reports and background sync (step 4)**

| Situation | What happens |
|---|---|
| Form empty | A message under every field, the fields are marked, the cursor goes to the first problem; nothing is saved or sent |
| Panels not a whole number (`abc`, `7.5`, `-2`, `1e3`, blank) | "Panels fitted must be a whole number such as 6, with no letters, minus sign or decimals." |
| More panels than the job has | Names the job and its real total: "SG-1043 has only 12 panels in total, so 13 is too many" |
| *Problem found* with no note, or a note over 500 characters | Asks for a description; or says how long the note is and the limit |
| Name missing, one letter, or over 60 characters | "Enter your name…", "Enter your full name.", or the limit |
| A job or report type that is not in the lists (edited page) | Named in the message; nothing is saved |
| No signal | Saved in the on-device outbox; the card says **Saved on this phone** and that it will be sent automatically; the menu shows how many are waiting |
| No signal and the browser cannot keep data on the device | The report is **not** accepted silently: the card says why and asks to try again with signal. If the server is down while online, the report waits in memory with a "do not close this page" warning |
| Device storage full or blocked while saving | "The report could not be saved on this device", with the browser's reason |
| Office server down, busy or too slow (timeout, 408, 425, 429, 5xx, no connection) | The report is kept and the attempt counted; the next ones wait behind it so the order is kept; the browser is asked to try again later. After 8 failed tries it becomes **Needs attention** with **Try again** and **Remove** |
| Office server refuses this report (any other 4xx) | Kept as **Refused by server** with the reason and **Try again** / **Remove**; the reports behind it still go out |
| The page and the service worker wake together when the signal returns | Each report is sent once (one sender at a time through a Web Lock); where Web Locks does not exist, the report id lets the office spot a rare duplicate |
| Browser without Background Sync (iPhone Safari, Firefox) | The card says so honestly; the report is sent when the app is open and the connection is back (the `online` event, or the next time the app opens) |
| Some other sync tag, or a worker that cannot open storage | Ignored, or ends quietly; no exception |
| Text typed by the installer (`<script>`, quotes, `&`, Urdu) | Shown HTML-escaped in the list; arrives at the office unchanged (checked in the browser with Urdu text) |
| A damaged stored record (missing fields, unknown status) | Still listed; no crash |

**Tests and performance budget (step 5)**

| Situation | What happens |
|---|---|
| The app is over a size limit | `npm test` fails and `npm run measure` exits 1. The line says `FAIL (37.5 KB, 7.5 OVER)`, names the three biggest files that count towards that limit, and says what to do (raise the limit on purpose, with a reason, or make the app smaller) |
| A value exactly at its limit | Passes; one byte over fails |
| One file over the per-file limit | That file is named and the message says to split it; the totals can still pass |
| A screen too slow to build | The render line fails with the time found |
| Budget file missing, unreadable or not JSON | `Budget check could not run: …` in one sentence, exit code 2, no stack trace |
| A limit that is missing, zero, negative, a number in quotes, or not a number | Names the field: `"firstLoadGzipKb" must be a number above 0 (found "55")` |
| `history` empty, an entry without a step, or a reason shorter than a sentence | Says which entry is missing what |
| A limit raised without a new `history` entry | `"firstLoadGzipKb" is 60 but the latest history entry (step 5) says 40 … add a history entry with the step and the reason`; exit code 2 |
| `sw.js` has no file list, or lists a file that does not exist | `sw.js saves ./js/missing.js but that file does not exist` |

## Tests

Run with `npm test` (Node's built-in runner, no dependencies). **274 tests in 20 files.** The service worker file itself is loaded in a sandbox with a fake cache, a fake network and a fake IndexedDB, so its real code is tested, not a copy; the outbox is also tested against a fake IndexedDB shared by a "page" and a "worker".

| Step | File | Tests | Main path | Failure paths |
|---|---|---|---|---|
| 1 | `router.test.js` | 8 | every route resolves; job id and query parsed | unknown paths, malformed `%` encoding, garbage input |
| 1 | `quote.test.js` | 9 | 600 units in Lahore matches a hand calculation (9 panels, 5.175 kWp, Rs 8,28,000, 33,000/month saving); hybrid adds batteries | empty, text, zero, negative, tiny, huge; bad city or type; `constructor` as a city name |
| 1 | `views.test.js` | 18 | dashboard, list, filter, detail, inventory, quote form | not found, unknown job, escaped HTML injection, empty data, a view that throws |
| 1 | `util-data.test.js` | 10 | rupee, date and number formatting; every job and stock record is consistent | bad input to formatters; no placeholder text in the sample data |
| 1 | `app.test.js` | 12 | the real `app.js` against a fake DOM: first render, navigation, valid quote, Offline page buttons | empty form, other forms ignored, offline banner, service worker failure, removal asks first |
| 1, 2, 3 | `pwa.test.js` | 7 | manifest valid, every cached file exists, none missing from the list | root-absolute URLs, uncached file |
| 2, 4 | `sw.test.js` | 29 | install saves every file bypassing the HTTP cache; offline load serves saved page and files; unsaved file is fetched once, then works offline; old version caches are removed. **Step 4:** a sync event sends the waiting reports oldest first and marks them sent; after a failure the same reports go out when the signal returns, once each; open pages are told | failed or 404 install rejects; offline miss gives 503, not an exception; address without `#` redirected; POST and other sites ignored; broken storage answers with an error. **Step 4:** no connection rejects the sync so the browser retries; a 500 asks for a retry; a 400 is final and the queue moves on; unreadable storage; another tag ignored |
| 2 | `sw-register.test.js` | 9 | first install reports ready without reloading; update flow: found → installed → banner → tap → takes over → exactly one reload | registration failure; no support at all; first install not announced as an update; update check while offline |
| 2 | `offline.test.js` | 22 | ready, update-ready and offline-but-complete verdicts with real counts | unsupported browser, first visit, silent helper, incomplete copy, low storage, thrown errors, clearing failures |
| 2 | `stamp.test.js` | 6 | `sw.js` version matches the real files; changes when a cached file changes | stale version fails the test; missing file or list reported clearly; Windows and Linux line endings give the same version |
| 3 | `install.test.js` | 22 | the offer is kept and the verdict becomes "ready"; the bar waits until a second screen; accepting installs and hides the bar; `appinstalled` is noticed; "Not now" lasts 14 days, survives a new visit, then lapses; iPhone Safari gets "how" instead of a button | no offer, broken window (offer not reused), cancelled window, old browsers that answer from `prompt()`, blocked or absent storage, damaged saved data, insecure address, Chrome on iPhone, odd inputs that must not throw, named errors shown with their reason |
| 3 | `install-view.test.js` | 9 | `#/install` route, real counts from the data, three shortcuts, icons under the shapes phones use, button only when install is offered | every image on the page exists, empty data, HTML escaped, unsupported browser shows a red card with no button |
| 3 | `manifest.test.js` | 14 | one `any` and one `maskable` icon at 192 and 512; every icon is a real PNG of the declared size; `any` has transparent corners; `maskable` and the iPhone icon are fully opaque; shortcuts equal the ones on the Install page and open real screens; screenshots at declared size; everything needed offline is saved by the service worker | no combined `any maskable` icon; absolute addresses; a file that is not a PNG is reported by name instead of passing |
| 3 | `app-install.test.js` | 10 | the real `app.js` against a fake DOM: offer arrives, bar after a second screen, hidden on the Install page, accepting installs and removes the menu entry | blocked storage at start, broken window, cancelled window, `appinstalled` after the fact, an install click when no offer was made |
| 4 | `outbox.test.js` | 33 | a complete report passes and panels becomes a number; every sample report is valid; spaces trimmed; the POST body carries the form name and every field, and its names match the hidden form in `index.html`; sending posts to the site root; the queue sends oldest first and records the time; one sender at a time; Background Sync is registered | an empty form named field by field; unknown job and type; panels with letters, decimals, minus, exponent or blank; more panels than the job has; a huge number; a problem without a note; a long note; a bad name; missing input; 408/425/429/5xx retried and other statuses refused; a dead connection, a missing `fetch` and a hung request become "retry"; a refused report does not block the queue; 8 failures park a report as "stuck"; a `send` that throws; no Web Locks; no Background Sync (iPhone) |
| 4 | `outbox-store.test.js` | 9 | a report written through one connection is read back with every field; the page and the worker share one database; reports survive "closing the app"; what is read back is a copy | the browser refuses IndexedDB (private window) so the outbox falls back to memory and says it is not durable; no IndexedDB, an `open()` that throws, a blocked open; a full device rejects with a message; a database without the store |
| 4 | `reports-view.test.js` | 17 | the route renders the form and the list; every job and type offered; `?job=SG-1043` preselects; the job page links to the form; each status has its own words, newest first | unknown job in the address; no jobs at all; a damaged record; HTML injection in notes and server messages escaped; browser that cannot keep data warns first; junk dates become a dash |
| 4 | `app-reports.test.js` | 11 | the real `app.js` against a fake DOM and fake network: online sends at once; offline saves, requests Background Sync and shows the count; the `online` event sends the waiting report; the page redraws when the worker tells it; the example button cycles | empty form marks every field and stores nothing; a Problem without a note; the office down, then "Send now"; a 400 kept with its reason, then "Try again" and "Remove" |
| 4 | `app-reports-nostorage.test.js` | 3 | online it still sends straight away | no on-device storage: the page warns; offline the report is refused with a reason instead of being lost silently; server down shows the "do not close this page" warning |
| 5 | `budget.test.js` | 16 | the real app is inside all four limits; every saved file is measured once; the budget file is valid and its latest history entry matches the limits; every screen renders far under the limit; `npm run measure` exits 0 with a PASS for each limit | over a limit: FAIL with the biggest files and the way out; exactly at the limit passes, one byte over fails; one oversized file named; a slow screen; icons not blamed for the first-load limit; a broken, incomplete or non-numeric budget file; a limit raised without a reason; `sw.js` without a list or with a missing file; the command line exits 1 when over and 2 with one plain sentence when the budget cannot be used |

**Bugs the tests caught.** `(5.175).toFixed(2)` returns `"5.17"` in JavaScript because of binary floating-point, so the quote showed **5.17 kWp** for a 5.175 kWp system. `formatNumber` now rounds half-up correctly and has a regression test.

**What the real-browser checks prove (Chromium 153, all passing):**

- **`verify:offline` (14 checks).** A first visit saves 25 of 25 files. With the network off, a deep link to a job renders styled, the quote calculator gives 5.18 kWp, bad input gives a clear message, the Offline page says "Ready for site visits", and an address without `#` lands on the working app root; there are no console errors. After a simulated new release the blue banner appears, the page is **not** reloaded by itself, both versions are kept while it waits, and after **Reload to update** only the new version remains.
- **`verify:install` (30 checks).**
  - *Chromium's own verdict:* it parses the manifest with no errors and reports no installability errors, **both online and with the network switched off** (the icons come from the saved copy).
  - *The icons, pixel by pixel:* all 4 manifest icons decode at their declared size; `any` icons have transparent corners and `maskable` icons none; the maskable artwork reaches 0.333 of the width from the centre (limit 0.40); the iPhone icon is 180 × 180 and fully opaque; shortcut icons are 96 × 96; the 4 screenshots match their declared sizes.
  - *The install flow:* the page takes over from the browser's own bar; no bar on the first screen; bar after the second; hidden on the Install page; **Not now** is remembered for 14.00 days and survives a reload; installing opens the browser window exactly once and removes the menu entry; a cancelled window and a broken window are each explained, and the app keeps working.
  - *Other devices:* already installed shows no bar; iPhone Safari gets **Show me how** and the three Share-menu steps; Chrome on iPhone is told to open Safari.
  - *Offline:* the Install page opens with the network off and all 6 images loaded from the saved copy; no console or page errors anywhere in the run.

- **`verify:sync` (40 checks).** Each outcome is provoked on demand against the project's own dev server, which can be switched to "down" or "refusing".
  - *Online:* the report reaches the office at once with every field, the page says **Sent to the office**, and the menu shows no count.
  - *Wrong input:* a clear message under the field, the cursor on the first bad field, the job's real panel total in the message, and nothing sent or stored.
  - *Offline:* **Saved on this phone**, **Waiting to send**, the menu shows 1, the report is really in IndexedDB (readable by the worker), and nothing reached the office.
  - *App closed:* the service worker sends the waiting report by Background Sync, the right report, marked sent. Chrome fired the sync event itself in the last run; if it has not within a few seconds the script delivers the event through DevTools, and the check's output says which happened.
  - *Office down, then back:* the worker tries, the report is kept as waiting with the attempt counted, nothing is lost or half-delivered, and it is delivered once on the next wake-up.
  - *Page and worker at the same moment:* both reports arrive, each exactly once, in the order they were filed.
  - *Refused (400):* kept with the reason and a **Try again** button, which delivers it.
  - *Text:* Urdu text, quotes, `&` and `<>` arrive unchanged and are shown escaped.
  - *A browser without Background Sync* (the API removed, as on iPhone Safari): the app says honestly that it must be opened again, sends when the connection is back and the app is open, and sends nothing while the app is closed. There are no console or page errors in the run, apart from the 400 provoked on purpose.

## Measured results

From `npm run measure` (Node 22), after each step:

| Measure | After step 1 | After step 2 | After step 3 | Now (step 4) | Budget now |
|---|---|---|---|---|---|
| First load (HTML, CSS, JS, favicon), gzip | 15.5 KB | 21.2 KB | 26.8 KB | **37.5 KB** (111.2 KB raw) | 40 KB |
| Everything saved for offline, gzip | 25.0 KB | 30.6 KB | 42.2 KB | **52.9 KB** (128.9 KB raw) | 55 KB |
| Items saved on the device | 14 | 16 | 23 | **25** | |
| Time to build any screen's HTML (slowest screen) | 0.1 ms or less | 0.035 ms | 0.091 ms | **0.09 ms or less** | 5 ms |

The render figures come from different machines, so only their order of magnitude means anything: every screen builds in about a tenth of a millisecond or less.

- **Step 1:** measuring found a real problem. The first icons made the offline copy **66.5 KB** gzip, over budget, because three 32-bit PNGs took about 50 KB. Reducing them to a 32-colour palette (the artwork is two flat colours) gave **25.0 KB** with no visible change.
- **Step 2:** the whole offline feature (worker, update flow, status page) cost about **5.6 KB gzip**.
- **Step 3:** the install feature costs **5.6 KB gzip on first load** (the install logic is 3.9 KB of it) and **11.6 KB in the offline copy**, of which about 5 KB is the new icons. Both budgets were raised in this step, from 25 KB to 30 KB and from 40 KB to 45 KB, with the reasons given under the step 3 decision. The screenshots (about 360 KB) are in the repository but deliberately not saved on the phone, so they are not in these totals.
- **Step 4:** the reports feature costs **10.7 KB gzip on first load** and the same in the offline copy. The largest parts are the outbox (5.6 KB for `outbox-core.js` plus 0.5 KB for its wrapper) and the Reports screen in `views.js`; the two new files are saved on the phone because the worker loads the outbox from there. Both budgets were raised again, from 30 KB to 40 KB and from 45 KB to 55 KB, because a report can be filed on the very first visit, so none of this can be loaded later. At 37.5 KB the first load is about 0.75 s on a 400 kbps 3G link. Trimming would have meant a build step, which step 1 rules out.

From the real-browser runs (local server, no throttling):

| Run | First visit to "ready for offline" | Deep link opened with the network off (median of 7) | Items saved |
|---|---|---|---|
| Step 2 (earlier Chromium, faster machine) | 243 ms | 80 ms | 16 |
| Step 3 (Chromium 153) | 650 ms | about 0.2 s (range 165 to 252 ms) | 23 |
| Step 4 (Chromium 153) | 670 ms | 0.27 s (range 266 to 309 ms) | 25 |

These come from different machines and browser builds, so they should not be compared with each other. They show the worker adds no noticeable wait, not what a phone on 3G will see.

Lighthouse on the deployed site after step 1 (`https://sungrid-solar.netlify.app/#/inventory`): Performance **83** · Accessibility **100** · Best Practices **100** · SEO **100**. It was not re-run for later steps.

### Budget history

The limits are in [`scripts/budget.json`](scripts/budget.json), together with the reason for each change. Today's room: first load 2.5 KB, offline copy 2.1 KB, largest file (`js/views.js`) 1.6 KB.

| Step | First load | Offline copy | Why |
|---|---|---|---|
| 1 | 25 KB | 40 KB | First budget: 25 KB gzip is about half a second on a 400 kbps 3G link |
| 3 | 30 KB | 45 KB | The install logic must be there on the first visit; the offline copy now holds the full icon set |
| 4 | 40 KB | 55 KB | The report form and the outbox cost 10.7 KB gzip and can be needed on the very first visit |
| 5 | 40 KB | 55 KB | No change; added a 10 KB limit for any single file and moved the limits into one file |

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

### Step 4: save the report on the phone first, send it afterwards, and deliver at least once

**The choice.** Pressing **Save report** never sends anything directly. The report is validated, written to an on-device outbox (IndexedDB), and only then sent. If the connection is there the send happens at once; if not, the browser's **Background Sync** wakes the service worker when the connection returns, even if the app has been closed, and the worker sends what is waiting. Every report carries a unique id and is delivered **at least once**: a report can never be lost, but in one rare case it can arrive twice. The alternative is to send the form straight from the page and show an error if there is no signal, or to try to guarantee exactly-once delivery.

**Why.** The people filing these reports stand on rooftops where signal comes and goes, and a report is usually written at the end of the work, with a customer waiting. A form that fails with "no connection" loses the one thing the installer cannot easily write again, and asking them to keep the app open until signal returns does not match how the phone is used. Saving first means the same path is used online and offline (one thing to test and one thing to understand), and the on-device copy is the source of truth until the office has accepted it. Exactly-once delivery is not possible over a network that can drop the answer: if the office receives a report and the reply is lost, the phone cannot know, and the only choices are to send it again (a duplicate) or to give up (a loss). A duplicate in an inbox is a small nuisance that the report id lets the office spot, so losing nothing was chosen over never repeating.

**Trade-offs accepted.**

- **A duplicate is possible.** If the connection drops after the office has received a report but before the phone hears the reply, the report is sent again on the next try. The office can recognise it by its `report_id`, but Netlify Forms does not remove duplicates itself, so someone has to ignore the second one.
- **Background Sync works in Chrome and Edge only.** Safari on iPhone and Firefox do not offer it. There the report is sent when the app is next opened with signal, or immediately when the `online` event fires with the app open, and the saved card says this instead of promising more than the browser can do.
- **The phone decides when to retry.** After a failed background try, the browser chooses the next moment itself (Chrome backs off); the app does not control it and the delay was not measured. **Send now** on the Reports screen is the manual route.
- **More code, more weight, more states.** A report is `pending`, `sent`, `rejected` or `stuck`, and each needs a screen, a button and a test; first load grew by 10.7 KB gzip (see measured results).
- **A person decides about stuck and refused reports.** After 8 failed tries, or an answer the server will not change, the report is parked as **Needs attention** with **Try again** and **Remove**, rather than being retried for ever or silently deleted.

**Where to change it.** The rules sit at the top of [`js/outbox-core.js`](js/outbox-core.js): `MAX_ATTEMPTS` (8), `KEEP_SENT` (10 sent reports kept as history), `REPORT_KINDS`, `LIMITS`, and `classifyStatus`, which is the single place that says which HTTP answers mean "try later" and which mean "refused".

**Other decisions in step 4**

| Decision | Alternative | Why / cost |
|---|---|---|
| **Netlify Forms receives the reports** (a hidden form in `index.html`; the app POSTs to the site root) | A serverless function and a database | No server code, no keys, and nothing new to deploy or secure: the host that already serves the app also keeps the reports. Cost: Netlify's submission limits apply, there is no duplicate removal, the app cannot read reports back, and the form has no sign-in of its own |
| **IndexedDB for the outbox** | `localStorage` | A service worker has no access to `localStorage`, and the worker is what sends the report when the app is closed. Cost: asynchronous code and a fake IndexedDB for the tests (`tests/helpers/fake-idb.js`) |
| **The outbox is a plain script shared with the service worker** (`importScripts`), with a small ES-module wrapper for the page | Convert `sw.js` into a module worker | A classic worker cannot import a module, and a module worker would break the update for everyone who installed an earlier version, because the browser re-reads their registered worker as a classic script. Cost: one extra 0.5 KB file |
| **Stop at the first temporary failure** | Skip it and try the next report | The next one would fail the same way, and the reports reach the office in the order they were filed. Cost: one bad connection holds the queue; a report the server *refuses* does not block the ones behind it |
| **Only 408, 425, 429 and 5xx are retried; any other 4xx is a refusal** | Retry every failure | Sending the same text again cannot fix a refusal, so it is kept visible with the server's reason instead of being retried for ever |
| **One sender at a time** (Web Locks), with the report id as the backstop | Nothing | The page and the worker can wake together when the signal returns and would post the same report twice. Cost: where Web Locks does not exist the rare duplicate remains |
| **Requests give up after 15 seconds** | Wait as long as the browser allows | A dead connection that never answers cannot hold the queue forever |
| **Panels fitted may not exceed the job's total; a *Problem found* report needs a note; whole numbers only** | Accept anything | The office can act on what it receives, and a typing slip (`66` for `6`) is caught on the roof. Cost: an installer cannot report a total that is wrong in the job data until the data is fixed |
| **If IndexedDB is blocked, fall back to memory and say so** (`durable: false`) | Fail, or pretend it is safe | A private window can still file a report while online; offline with nowhere to keep it, the report is refused with a reason rather than lost silently |
| **Keep the last 10 sent reports as history; never drop a waiting one** | Keep everything, or nothing | The list stays short on a phone, and a report that has not reached the office is never pruned |
| **The worker tells open pages** (`OUTBOX_CHANGED`) | Make the user reload | The list and the menu count update by themselves when a background send happens |

### Step 5: the budget is a test, and every change to a limit has to be written down

**The choice.** The size and speed limits live in one file, [`scripts/budget.json`](scripts/budget.json), and are enforced by `npm test`, the same command that runs every other test, not only by a separate script. If a change pushes the app over a limit the build fails, and the message names the biggest files and says what to do. A limit can still be raised, but not silently: every limit carries a `history` entry with the step and the reason, and a test fails when a limit and the latest history entry disagree. The alternative is a budget script that someone has to remember to run, with the numbers written as constants inside it.

**Why.** Twice already (steps 3 and 4) the app went over its budget, and both times the number was raised in a code comment, at the moment someone most wanted to ship. A budget that can be moved without a trace protects nothing. Putting the check inside `npm test` means it runs every time and in CI, and requiring a reason means the person who raises a limit has to say why in the place a reviewer will look. One file read by the script, the tests and this README also means the numbers cannot drift apart.

**Trade-offs accepted.**

- **Adding a feature can fail the build.** A change that costs 3 KB stops until someone edits the budget file and writes the reason. That friction is the point, but it is friction, and the reason is checked only for being present, not for being good.
- **The numbers are an alarm, not a prediction.** Sizes are the files compressed locally with Node's gzip at its default level; Netlify may send fewer bytes (it can use Brotli) and a real phone's speed varies, so the limits catch regressions rather than predict download time.
- **The render limit is a smoke alarm.** It times how long it takes to build each screen's HTML in Node (about 0.05 to 0.09 ms against a 5 ms limit). It catches an accidental slow loop, but says nothing about how fast a phone paints the page.
- **The per-file limit will need attention.** `js/views.js` is 8.4 KB against a 10 KB limit, so the next large addition to it will fail the build and is a prompt to split the file.
- **Size and speed only.** The budget does not include Lighthouse scores, which were taken after step 1 and not repeated.

**Where to change it.** [`scripts/budget.json`](scripts/budget.json): change the limit and add a `history` entry in the same edit. The comparison rules are in [`scripts/budget-lib.mjs`](scripts/budget-lib.mjs).

**Other decisions in step 5**

| Decision | Alternative | Why / cost |
|---|---|---|
| **Three exit codes: 0 within budget, 1 over budget, 2 the check could not run** | Any failure exits 1 | A broken budget file must not look like "the app is too big", and the reverse. Cost: one more thing to read in the README |
| **The budget test measures the real files** | Fake sizes only | It catches the thing that matters: the real app growing. Cost: the test depends on the files, which is why it can fail after a feature is added |
| **The failure paths of the check itself are tested** (bad file, no reason, missing file, exact limit, exit codes) | Test only that the app passes | A budget check that silently stops checking is worse than none. Cost: 16 tests for a 150-line module |
| **Each limit's message lists only the files that count towards it** | One list of the biggest files | An icon is not part of the first load and should not be blamed for it |
| **Room left is printed next to every PASS** | Print only PASS | You see the problem coming before the build fails |
| **`npm run check` = all tests, then the measurement** | Remember two commands | One command for a reviewer; the browser checks stay separate (`verify:all`) because they need a browser driver |

## Project layout

```
index.html              the shell: header, nav, update bar, install bar, <main id="app">, footer,
                        and the hidden form Netlify reads to accept the site reports
manifest.webmanifest    identity, icons, shortcuts, screenshots
sw.js                   service worker: save, answer, clean up, report status, send waiting reports
css/styles.css          all styling (mobile first)
js/app.js               browser wiring: router -> views, quote form, report form, offline page, update bar, install bar
js/router.js            hash router (pure functions)
js/views.js             one function per screen, returns { title, html }
js/quote.js             system sizing and cost estimate (pure)
js/data.js              sample jobs, inventory, cities, pricing assumptions
js/util.js              escaping and formatting helpers
js/sw-register.js       registration and update flow (no DOM)
js/offline.js           offline status verdicts (no DOM)
js/install.js           install offer, bar rules, verdicts, shortcut list (no DOM)
js/outbox-core.js       report validation, outbox, retry rules, sending; plain script shared by the page and the worker (no DOM)
js/outbox.js            ES-module face of outbox-core.js for the page and the tests
icons/                  sun icons (any, maskable, iPhone, tab) and three shortcut glyphs
screenshots/            four screenshots of the running app for the install dialog
tests/                  node:test suites; tests/helpers has a fake DOM, a fake IndexedDB, a "wait until the app
                        has stopped changing" helper (no fixed delays) and a PNG reader
scripts/                serve.mjs, measure.mjs, stamp-sw.mjs, make-icons.py, make-screenshots.mjs,
                        verify-offline.mjs, verify-install.mjs, verify-sync.mjs,
                        budget.json (the limits and the reason for each change), budget-lib.mjs (measuring and comparing)
netlify.toml            publish folder and headers
.github/workflows/      runs tests (which include the budget) and the measurement on every push
```

## Hosting

The site is static and is served by Netlify at https://sungrid-solar.netlify.app/ with no build step. [`netlify.toml`](netlify.toml) publishes the repository root, serves `sw.js` with `no-cache` (so a new release is noticed on the next visit) and `manifest.webmanifest` as `application/manifest+json`, and adds basic security headers. HTTPS, which Netlify provides, is required by both service workers and install.

Site reports are received by **Netlify Forms**. The hidden form named `site-report` in [`index.html`](index.html) makes Netlify create the form on deploy, and the app POSTs each report to the site root with that form name, so reports appear in the site's dashboard under *Forms → site-report*, one row per report with its `report_id`, job, type, panels, note, installer and time. The field names the app sends must match the hidden form; a test checks this. A POST that Netlify does not recognise is answered with an error and the app keeps the report as **Refused by server**.

## Known limitations

- **Job and stock data are read-only.** They are saved inside the app. A report goes to the office, but it does not change a job's progress on screen, and the app cannot read reports or job changes back from the office. Quote figures are estimates from the assumptions in `pricing`; a real quote needs a site survey (roof area, shading, load profile).
- **Real phones.** The install flow was verified in desktop Chromium 153. iPhone Safari and Chrome on iPhone are checked by presenting their user-agent strings; the behaviour was not tried on a physical iPhone or Android phone. Chromium's manifest parsing and installability verdict are its own; the browser's `beforeinstallprompt` event is simulated in the tests, because real Chrome decides when to fire it.
- **Other browsers.** A browser that never offers install gets a generic "install from the browser menu" message; the exact menu wording differs between browsers. iOS offers no install event, so installing there is always manual (platform limitation).
- **Saved data can be removed by the phone.** Browsers can delete saved site data when a phone is very low on storage, and Safari can clear it for sites not opened for about a week. The Offline page warns when storage is nearly full but cannot prevent it.
- **Reports reach a Netlify form, not an office system.** Delivery to the real Netlify Forms inbox is not covered by an automated check: the tests and the real-browser run use a local stand-in server that answers like the live form, so the first report filed on the live site is the end-to-end proof. Netlify limits how many submissions a site may receive on its free plan, does not remove duplicates, and the form has no sign-in or CAPTCHA of its own, so it relies on Netlify's built-in spam filtering.
- **Reports hold text and numbers only.** There are no photos, and the on-device history keeps the last 10 sent reports.
- **Background Sync** exists only in Chrome and Edge (see the step 4 decision). Headless Chrome does not announce connectivity changes to it, so `verify:sync` uses the event Chrome fires on its own when it comes and delivers it through DevTools otherwise. Sending with the app closed was verified in desktop Chromium only, not on a physical phone, and the browser's own retry timing was not measured.
- **Update checks** run only while the app is open (on load, when the connection returns, and hourly).
- **Update check in headless Chrome 153.** In the test environment, an update check requested after the app had been opened offline three or more times stayed pending for over a minute (the same happens with the step 2 code; one or two offline openings were fine). `verify:offline` therefore runs its update step before the repeated offline loads. The cause was not investigated further and the behaviour was not seen on a real device.
- **The budget measures files, not the experience.** Sizes are local gzip sizes (Netlify's own compression may differ), and the render time is the time to build HTML in Node, not the time a phone takes to paint. A change to this step touched no app code, so the real-browser scripts were not re-run for it; they last passed on step 4's code.
- **Timings** are from local machines without throttling. The Lighthouse scores were taken after step 1 and not repeated.
