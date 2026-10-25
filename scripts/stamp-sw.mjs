// Stamps sw.js with a version derived from the content of every cached file.
//
//   npm run stamp         rewrite VERSION in sw.js
//   npm run stamp -- --check   exit 1 if VERSION is stale (the test suite does the same check)
//
// Why: the browser only installs a new offline copy when the cache name changes. A hand-edited
// version number gets forgotten; a content hash changes exactly when something the user would
// receive has changed.

import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION_LINE = /const VERSION = '[^']*';/;

/** Read the SHELL list out of sw.js text. */
export function shellFiles(swText) {
  const block = /const SHELL = \[([\s\S]*?)\];/.exec(swText);
  if (!block) throw new Error('sw.js has no SHELL array');
  return [...block[1].matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean);
}

const TEXT = /\.(html|css|js|mjs|json|webmanifest|svg|txt)$/;

/** Text files: normalise line endings so Windows (CRLF) and Linux (LF) checkouts give the same hash. */
function normalise(file, buffer) {
  return TEXT.test(file) ? Buffer.from(buffer.toString('utf8').replace(/\r\n/g, '\n')) : buffer;
}

/** Version string for the project in `root`, e.g. "sungrid-3fa91c2e". */
export async function computeVersion(root) {
  const sw = await readFile(path.join(root, 'sw.js'), 'utf8');
  const hash = createHash('sha256');

  // sw.js itself counts (a changed fetch strategy must change the version), minus the VERSION line.
  hash.update('sw.js\0');
  hash.update(normalise('sw.js', Buffer.from(sw.replace(VERSION_LINE, ''))));

  for (const file of [...new Set(['index.html', ...shellFiles(sw)])].sort()) {
    hash.update(`\0${file}\0`);
    hash.update(normalise(file, await readFile(path.join(root, file))));
  }
  return `sungrid-${hash.digest('hex').slice(0, 8)}`;
}

export async function readStampedVersion(root) {
  const sw = await readFile(path.join(root, 'sw.js'), 'utf8');
  return VERSION_LINE.exec(sw)?.[0].match(/'([^']*)'/)[1] ?? null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const wanted = await computeVersion(root);
  const current = await readStampedVersion(root);

  if (process.argv.includes('--check')) {
    if (current === wanted) {
      console.log(`sw.js version is up to date (${current})`);
    } else {
      console.error(`sw.js version is stale: has ${current}, files hash to ${wanted}. Run: npm run stamp`);
      process.exit(1);
    }
  } else if (current === wanted) {
    console.log(`sw.js already at ${wanted}, nothing to do`);
  } else {
    const swPath = path.join(root, 'sw.js');
    const text = await readFile(swPath, 'utf8');
    await writeFile(swPath, text.replace(VERSION_LINE, `const VERSION = '${wanted}';`));
    console.log(`sw.js version: ${current} -> ${wanted}`);
  }
}
