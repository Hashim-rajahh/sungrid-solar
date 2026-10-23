# Submission note: Task 1, App shell and routing, SunGrid Solar

**Repository:** https://github.com/<your-github-username>/sungrid-solar
**Live demo:** https://<your-github-username>.github.io/sungrid-solar/

## What I did

I built the app shell for SunGrid Solar's offline-ready PWA as plain HTML, CSS and ES modules with no build step. It has a hash router and five screens (dashboard, jobs with status filters, job detail, quick quote, inventory). A service worker caches the whole shell so the app opens and works with no signal, which matters for installers on site.

The sample data is written for a Lahore solar installer: eight jobs from site survey to commissioned, real panel and inverter models, LESCO/FESCO net-metering steps, rupee amounts in lakh format, and stock with one item out and several to reorder. The quote page sizes a system from a monthly electricity bill.

## Why I made these choices

- **Hash routing** (`#/jobs/SG-1042`) so deep links and refreshes work on a static host and offline with no server rules. The cost is less pretty URLs; the README records this as the decision of the step.
- **No framework**, so the shell is 15.5 KB gzip on first load and there is nothing to maintain before the next tasks.
- **Cache-first, versioned service worker**, so one release never mixes old and new files.

## How I checked it

- 56 automated tests: each route, a hand-calculated quote, and failure paths (unknown pages and jobs, malformed URLs, empty or invalid quote input, HTML injection, a view that throws, service worker failure).
- Measuring found the icons made the offline cache 66.5 KB; shrinking them brought it to 25.0 KB.
- Tests also caught a rounding bug that displayed 5.175 kWp as 5.17; it is fixed with a regression test.

## What is not done yet

Data is read-only sample data; persistence is for a later task. Lighthouse scores are recorded in the README from the deployed site.
