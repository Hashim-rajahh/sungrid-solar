// The performance budget as tests: the real app must stay inside it, and the check itself must behave
// (fail loudly when a limit is passed, refuse a budget file that was changed without a reason, never crash).

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  BUDGET_FILE, BudgetError, ROOT, checkBudget, loadBudget, measureRender, measureShell, parseBudget, shellFiles,
} from '../scripts/budget-lib.mjs';

const MEASURE = path.join(ROOT, 'scripts', 'measure.mjs');
const entry = (over = {}) => ({ step: 5, firstLoadGzipKb: 40, precacheGzipKb: 55, largestFileGzipKb: 10, renderMs: 5, reason: 'A reason that is long enough.', ...over });
const budgetOf = (over = {}, last = {}) => ({ firstLoadGzipKb: 40, precacheGzipKb: 55, largestFileGzipKb: 10, renderMs: 5, ...over, history: [entry({ ...over, ...last })] });
const fakeShell = (files) => ({
  files: files.map(([file, kbGz]) => ({ file, raw: kbGz * 2048, gz: Math.round(kbGz * 1024), firstLoad: true })),
  firstLoadGz: Math.round(files.reduce((t, [, k]) => t + k, 0) * 1024),
  precacheGz: Math.round(files.reduce((t, [, k]) => t + k, 0) * 1024),
  largest: files.map(([file, k]) => ({ file, gz: Math.round(k * 1024) })).sort((a, b) => b.gz - a.gz)[0],
});
const run = (env = {}) => spawnSync(process.execPath, [MEASURE], { encoding: 'utf8', env: { ...process.env, ...env } });

// ---------- main path: the real app against the real budget ----------

test('the app stays inside every limit in scripts/budget.json', async () => {
  const budget = await loadBudget();
  const shell = await measureShell();
  const rows = checkBudget(shell, measureRender(20).worstMs, budget);
  const failures = rows.filter((r) => !r.pass).map((r) => `${r.label}: ${r.value}. ${r.hint}`);
  assert.deepEqual(failures, []);
  assert.equal(rows.length, 4, 'first load, offline copy, largest file and render time are all checked');
});

test('every file the service worker saves is measured once, index.html first', async () => {
  const shell = await measureShell();
  const names = shell.files.map((f) => f.file);
  assert.equal(names[0], 'index.html');
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.includes('js/outbox-core.js') && names.includes('icons/icon-512.png'));
  assert.ok(shell.precacheGz > shell.firstLoadGz, 'the offline copy also holds the icons');
  assert.ok(shell.files.filter((f) => f.firstLoad).every((f) => /\.(html|css|js|svg)$/.test(f.file)));
});

test('the budget file is valid, and its latest history entry matches the limits', async () => {
  const budget = await loadBudget();
  const last = budget.history.at(-1);
  assert.equal(last.firstLoadGzipKb, budget.firstLoadGzipKb);
  assert.equal(last.precacheGzipKb, budget.precacheGzipKb);
  assert.ok(budget.history.length >= 4, 'every change of a limit so far is recorded');
  assert.ok(budget.history.every((h) => h.reason.length > 20));
});

test('every screen builds its HTML far below the render budget', () => {
  const { perRoute, worstMs } = measureRender(20);
  assert.ok(perRoute.length >= 9 && perRoute.some((r) => r.hash === '#/reports'));
  assert.ok(worstMs < 5);
});

test('"npm run measure" exits 0 and prints a PASS line for every limit', () => {
  const result = run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal((result.stdout.match(/-> PASS/g) ?? []).length, 4);
  assert.match(result.stdout, /left\)/, 'it says how much room is left');
});

// ---------- failure paths: going over, and a budget that cannot be trusted ----------

test('over the first-load limit: FAIL, with the biggest files and what to do about it', () => {
  const shell = fakeShell([['js/views.js', 20], ['js/outbox-core.js', 15], ['css/styles.css', 5], ['js/app.js', 2]]);
  const row = checkBudget(shell, 0.1, budgetOf()).find((r) => r.id === 'first-load');
  assert.equal(row.pass, false);
  assert.ok(row.left < 0);
  assert.match(row.hint, /js\/views\.js 20\.0 KB, js\/outbox-core\.js 15\.0 KB, css\/styles\.css 5\.0 KB/);
  assert.match(row.hint, /history entry saying why/);
});

test('the first-load hint lists only files a new visitor downloads, not icons that are only saved for offline', () => {
  const shell = fakeShell([['js/views.js', 30], ['js/app.js', 15]]);
  shell.files.push({ file: 'icons/icon-512.png', raw: 30000, gz: 30000, firstLoad: false });
  const row = checkBudget(shell, 0.1, budgetOf()).find((r) => r.id === 'first-load');
  assert.equal(row.pass, false);
  assert.doesNotMatch(row.hint, /icon-512/);
  assert.match(row.hint, /js\/views\.js/);
});

test('a size exactly at the limit passes; a hair over fails', () => {
  const exactly = checkBudget(fakeShell([['a.js', 40]]), 0.1, budgetOf());
  assert.equal(exactly.find((r) => r.id === 'first-load').pass, true);
  const over = fakeShell([['a.js', 40]]);
  over.firstLoadGz += 1;
  assert.equal(checkBudget(over, 0.1, budgetOf()).find((r) => r.id === 'first-load').pass, false);
});

test('one file over the per-file limit is named and fails on its own', () => {
  const shell = fakeShell([['js/views.js', 10.5], ['js/app.js', 3]]);
  const rows = checkBudget(shell, 0.1, budgetOf());
  const row = rows.find((r) => r.id === 'largest-file');
  assert.equal(row.pass, false);
  assert.match(row.hint, /js\/views\.js is the largest file and is over the limit: split it/);
  assert.equal(rows.find((r) => r.id === 'first-load').pass, true, 'the totals are still fine');
});

test('a slow screen fails the render limit', () => {
  const row = checkBudget(fakeShell([['a.js', 1]]), 6.2, budgetOf()).find((r) => r.id === 'render');
  assert.equal(row.pass, false);
  assert.match(row.value, /^6\.200 ms$/);
});

test('a budget file that is broken or incomplete is refused with the reason', () => {
  const ok = JSON.stringify(budgetOf());
  assert.doesNotThrow(() => parseBudget(ok));
  assert.throws(() => parseBudget('{ not json'), /not valid JSON/);
  assert.throws(() => parseBudget('[]'), /one JSON object/);
  assert.throws(() => parseBudget(JSON.stringify({ ...budgetOf(), precacheGzipKb: undefined })), BudgetError);
  for (const bad of [0, -5, '55', null, NaN]) {
    assert.throws(() => parseBudget(JSON.stringify({ ...budgetOf(), firstLoadGzipKb: bad })), /"firstLoadGzipKb" must be a number above 0/, String(bad));
  }
  assert.throws(() => parseBudget(JSON.stringify({ ...budgetOf(), history: [] })), /"history" must list every limit/);
  assert.throws(() => parseBudget(JSON.stringify(budgetOf({}, { reason: 'x' }))), /needs a "reason"/);
  assert.throws(() => parseBudget(JSON.stringify(budgetOf({}, { step: 'five' }))), /needs a "step" number/);
});

test('raising a limit without writing down why is refused', () => {
  const sneaky = { ...budgetOf(), firstLoadGzipKb: 60 }; // history still says 40
  assert.throws(() => parseBudget(JSON.stringify(sneaky)), /"firstLoadGzipKb" is 60 but the latest history entry \(step 5\) says 40.*add a history entry/);
});

test('the service worker list is checked: none, or a file that is not there', async () => {
  assert.throws(() => shellFiles('const x = 1;'), /no "const SHELL/);
  assert.deepEqual(shellFiles("const SHELL = [\n  './',\n  './index.html',\n  './js/a.js',\n  './js/a.js',\n];"), ['index.html', 'js/a.js']);

  const dir = await mkdtemp(path.join(tmpdir(), 'sungrid-budget-'));
  try {
    await writeFile(path.join(dir, 'sw.js'), "const SHELL = ['./', './js/missing.js'];");
    await writeFile(path.join(dir, 'index.html'), '<p>hi</p>');
    await assert.rejects(measureShell(dir), /saves \.\/js\/missing\.js but that file does not exist/);
    await rm(path.join(dir, 'sw.js'));
    await assert.rejects(measureShell(dir), /sw\.js could not be read/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a budget file that does not exist is a clear error, not a crash', async () => {
  await assert.rejects(loadBudget(path.join(tmpdir(), 'no-such-budget.json')), /could not be read/);
});

// ---------- the command line: exit codes and messages ----------

test('"npm run measure" exits 1 and names the problem when the app is over a (very small) budget', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sungrid-budget-'));
  try {
    const file = path.join(dir, 'tiny.json');
    await writeFile(file, JSON.stringify(budgetOf({ firstLoadGzipKb: 1, precacheGzipKb: 2, largestFileGzipKb: 1 })));
    const result = run({ SUNGRID_BUDGET_FILE: file });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /Budget: first load <= 1 KB gzip -> FAIL/);
    assert.match(result.stdout, /OVER\)/);
    assert.match(result.stdout, /Biggest files: js\/views\.js/);
    assert.match(result.stdout, /-> PASS/, 'the limits that are fine still say PASS');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('"npm run measure" exits 2 with one plain sentence (no stack trace) when the budget file cannot be used', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sungrid-budget-'));
  try {
    const broken = path.join(dir, 'broken.json');
    await writeFile(broken, '{ "firstLoadGzipKb": ');
    const a = run({ SUNGRID_BUDGET_FILE: broken });
    assert.equal(a.status, 2);
    assert.match(a.stderr, /Budget check could not run: broken\.json is not valid JSON/);
    assert.doesNotMatch(a.stderr, /\n\s+at /, 'no stack trace');

    const b = run({ SUNGRID_BUDGET_FILE: path.join(dir, 'missing.json') });
    assert.equal(b.status, 2);
    assert.match(b.stderr, /could not be read/);

    const real = JSON.parse(await readFile(BUDGET_FILE, 'utf8'));
    const sneaky = path.join(dir, 'sneaky.json');
    await writeFile(sneaky, JSON.stringify({ ...real, precacheGzipKb: 99 }));
    const c = run({ SUNGRID_BUDGET_FILE: sneaky });
    assert.equal(c.status, 2);
    assert.match(c.stderr, /add a history entry/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
