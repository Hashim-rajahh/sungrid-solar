# SunGrid Solar: handover

**Live app:** https://sungrid-solar.netlify.app/  
**Source and full technical README:** https://github.com/Hashim-rajahh/sungrid-solar

## What you are getting

An installable web app for SunGrid Solar's installers and office, built from five steps that now work as one project:

| Part | What it does for the business | Screenshot |
|---|---|---|
| Dashboard, jobs and job sheets | The day's jobs and their progress, each with address, panels, stage and notes, readable with no signal | [dashboard](screens/dashboard.png), [jobs](screens/jobs.png), [job sheet](screens/job-sheet.png) |
| Quote calculator | Sizes a system and estimates cost from a customer's monthly units, city and system type | [quote](screens/quote.png) |
| Inventory | Stock levels with what needs reordering | [inventory](screens/inventory.png) |
| Site reports | An installer files a report from the roof; with no signal it is kept on the phone and sent by itself when the signal returns | [reports](screens/reports.png) |
| Offline and install | The whole app is saved on the phone; it can be put on the home screen with its own icon and shortcuts | [offline](screens/offline.png), [install](screens/install.png) |

## How it is run

- **Hosting:** Netlify serves the repository as it is, with no build step. A push to the repository's main branch is deployed in about a minute.
- **Reports** arrive in Netlify: site **Forms**, form **site-report**, one row per report with its `report_id`, job, type, panels fitted, note, installer and time.
- **Releasing a change:** edit the code, run `npm run stamp` (it gives the offline copy a new version; a test fails if this is forgotten), run `npm run check` (all tests and the size budget), then commit and push. Phones that already have the app show a blue **Reload to update** bar the next time they are online; nothing changes under a worker's hands until they tap it.
- **Running it locally:** `npm start`, then open the address it prints. There are no dependencies to install.

## Key decisions and their trade-offs

Each is recorded with its alternatives in the [README](../README.md#decisions-and-their-trade-offs).

| Decision | What it gives you | What it costs |
|---|---|---|
| Web addresses use `#` (hash routing) | Works on any static host and offline with no server rules | Addresses look like `/#/jobs/SG-1042` |
| A new version waits for a tap on **Reload to update** | An installer is never switched to new code in the middle of a quote | Some people stay on an older version until they tap |
| The app offers installing itself after the second screen | Few people dismiss it by reflex | iPhone has no install event, so it shows three manual steps |
| Reports are saved on the phone first, then sent, and delivered at least once | A report is never lost | In a rare case a report can arrive twice; the `report_id` lets the office spot it |
| The size and speed limits are a test, and every change to a limit needs a written reason | The app cannot quietly grow heavy | A feature that adds size stops the build until the limit is changed on purpose |
| Two documents: the README for developers and reviewers, this handover for the client | Each reader gets what they need | A few numbers appear in both; this page quotes only headline figures and links to the README |

## How the result was measured

| Measure | Result |
|---|---|
| Automated tests | 274, all passing (main paths and failure paths for every part) |
| Real-browser checks (Chromium 153) | 84, all passing: offline cache and updates (14), install and icons (30), reports and background sync (40) |
| First load for a new visitor | 37.5 KB compressed (limit 40 KB, about 0.75 s on a 400 kbps connection) |
| Offline copy saved on the phone | 52.9 KB compressed, 25 files (limit 55 KB) |
| Time to build any screen | under 0.1 ms (limit 5 ms) |
| A real report sent to the live Netlify inbox | Confirmed after deployment |

## What is not done

- **Jobs, stock and prices are sample data** (`js/data.js`). A report goes to the office but does not change a job on screen, and the app cannot read reports back.
- **Not tried on a physical phone.** Install and background sending were verified in desktop Chromium; iPhone Safari is checked by simulating it. Safari and Firefox have no Background Sync, so there a report is sent the next time the app is opened with signal.
- **Reports carry text and numbers only,** no photos, and the form has no sign-in; it relies on Netlify's built-in spam filtering and Netlify's submission limits for the plan in use.
- **Lighthouse scores** were taken after step 1 (Performance 83, the rest 100) and not repeated.

## What I would do next

1. Replace the sample data with the company's real jobs and stock, and let a report update its job.
2. Let reports carry photos of the roof and the finished work.
3. Try the app on real Android and iPhone devices and fix what that shows.
4. Remove duplicate reports on the receiving side by `report_id`, and add a sign-in for the form.
5. Repeat the Lighthouse audit on the finished app.
