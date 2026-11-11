// Measures the app against the performance budget so the README's claims are numbers, not guesses.
//   1. Size of every saved file (raw and gzip) against the budget.
//   2. Time to build every screen's HTML (average over many runs).
// Exit code: 0 = within budget, 1 = over budget, 2 = the check itself could not run (bad budget file, broken sw.js list).
// The limits, and the reason for every change to them, are in scripts/budget.json. `npm test` enforces the same limits.
// Usage: node scripts/measure.mjs        (SUNGRID_BUDGET_FILE=path uses another budget file, as the tests do)

import { BUDGET_FILE, BudgetError, checkBudget, loadBudget, measureRender, measureShell } from './budget-lib.mjs';

try {
  const budget = await loadBudget(process.env.SUNGRID_BUDGET_FILE || BUDGET_FILE);
  const shell = await measureShell();

  console.log('\nApp shell size');
  console.log('file'.padEnd(34), 'raw'.padStart(9), 'gzip'.padStart(9));
  for (const f of shell.files) {
    console.log(f.file.padEnd(34), `${(f.raw / 1024).toFixed(1)} KB`.padStart(9), `${(f.gz / 1024).toFixed(1)} KB`.padStart(9));
  }
  console.log('-'.repeat(54));
  console.log('FIRST LOAD (html/css/js/svg)'.padEnd(34), `${(shell.firstLoadRaw / 1024).toFixed(1)} KB`.padStart(9), `${(shell.firstLoadGz / 1024).toFixed(1)} KB`.padStart(9));
  console.log('FULL PRECACHE (offline)'.padEnd(34), `${(shell.precacheRaw / 1024).toFixed(1)} KB`.padStart(9), `${(shell.precacheGz / 1024).toFixed(1)} KB`.padStart(9));

  const render = measureRender(500);
  console.log('\nRender time (average of 500 runs)');
  for (const r of render.perRoute) console.log(r.hash.padEnd(34), `${r.avgMs.toFixed(3)} ms`.padStart(12));

  const rows = checkBudget(shell, render.worstMs, budget);
  console.log('');
  for (const row of rows) {
    const room = row.left >= 0 ? `${row.left.toFixed(row.id === 'render' ? 2 : 1)} left` : `${Math.abs(row.left).toFixed(row.id === 'render' ? 2 : 1)} OVER`;
    console.log(`Budget: ${row.label} -> ${row.pass ? 'PASS' : 'FAIL'} (${row.value}, ${room})`);
  }
  const failed = rows.filter((r) => !r.pass);
  for (const row of failed) console.log(`\n${row.label}: ${row.hint}`);
  process.exit(failed.length ? 1 : 0);
} catch (err) {
  if (err instanceof BudgetError) {
    console.error(`\nBudget check could not run: ${err.message}`);
    process.exit(2);
  }
  throw err;
}
