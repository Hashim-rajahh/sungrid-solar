// Waiting for the app to finish, without guessing a delay.
//
// A fixed pause such as 30 ms is enough on a fast machine and too short on a slow one (a first run on Windows with
// a virus scanner, a busy CI machine), which makes a correct test fail now and then. These helpers wait for what the
// test actually cares about instead.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Resolve when `snapshot()` has returned the same text for `quietMs` in a row (the app has stopped changing things).
 * Gives up after `maxMs` so a test that never settles fails on its own assertion instead of hanging.
 */
export async function untilQuiet(snapshot, { quietMs = 100, stepMs = 20, maxMs = 5000 } = {}) {
  let last = snapshot();
  let quiet = 0;
  for (let waited = 0; waited < maxMs && quiet < quietMs; waited += stepMs) {
    await sleep(stepMs);
    const now = snapshot();
    quiet = now === last ? quiet + stepMs : 0;
    last = now;
  }
}

/** Resolve as soon as `check()` is true (or after `maxMs`, so the assertion that follows reports the real problem). */
export async function until(check, { stepMs = 10, maxMs = 5000 } = {}) {
  for (let waited = 0; waited < maxMs && !check(); waited += stepMs) await sleep(stepMs);
}
