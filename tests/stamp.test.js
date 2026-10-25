// The offline copy is only replaced when the cache name changes, so the version in sw.js must change
// whenever any cached file changes. These tests make a forgotten bump impossible to ship.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeVersion, readStampedVersion, shellFiles } from '../scripts/stamp-sw.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- main path ----
test('sw.js VERSION matches the real project files (if this fails, run: npm run stamp)', async () => {
  assert.equal(await readStampedVersion(root), await computeVersion(root));
});

// ---- behaviour, on a tiny throw-away project ----
async function tinyProject(overrides = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sungrid-stamp-'));
  await mkdir(path.join(dir, 'js'));
  const files = {
    'sw.js': "const VERSION = 'sungrid-00000000';\nconst SHELL = [\n  './',\n  './index.html',\n  './js/a.js',\n];\nself.fetchStrategy = 'cache-first';\n",
    'index.html': '<html>\n<body>hi</body>\n</html>\n',
    'js/a.js': 'export const a = 1;\n',
    ...overrides,
  };
  for (const [name, text] of Object.entries(files)) await writeFile(path.join(dir, name), text);
  return dir;
}

test('version changes when a cached file changes, and not otherwise', async () => {
  const one = await tinyProject();
  const same = await tinyProject();
  const changed = await tinyProject({ 'js/a.js': 'export const a = 2;\n' });
  try {
    assert.equal(await computeVersion(one), await computeVersion(same));
    assert.notEqual(await computeVersion(one), await computeVersion(changed));
    assert.match(await computeVersion(one), /^sungrid-[0-9a-f]{8}$/);
  } finally {
    for (const d of [one, same, changed]) await rm(d, { recursive: true });
  }
});

test('Windows (CRLF) and Linux (LF) checkouts give the same version', async () => {
  const lf = await tinyProject();
  const crlf = await tinyProject({ 'index.html': '<html>\r\n<body>hi</body>\r\n</html>\r\n', 'js/a.js': 'export const a = 1;\r\n' });
  try {
    assert.equal(await computeVersion(lf), await computeVersion(crlf));
  } finally {
    for (const d of [lf, crlf]) await rm(d, { recursive: true });
  }
});

test('changing the worker logic changes the version, but the VERSION line itself does not', async () => {
  const base = await tinyProject();
  const logic = await tinyProject({ 'sw.js': "const VERSION = 'sungrid-00000000';\nconst SHELL = [\n  './',\n  './index.html',\n  './js/a.js',\n];\nself.fetchStrategy = 'network-first';\n" });
  const stamped = await tinyProject({ 'sw.js': "const VERSION = 'sungrid-ffffffff';\nconst SHELL = [\n  './',\n  './index.html',\n  './js/a.js',\n];\nself.fetchStrategy = 'cache-first';\n" });
  try {
    assert.notEqual(await computeVersion(base), await computeVersion(logic));
    assert.equal(await computeVersion(base), await computeVersion(stamped));
  } finally {
    for (const d of [base, logic, stamped]) await rm(d, { recursive: true });
  }
});

// ---- failure paths ----
test('a file listed in SHELL that does not exist is reported, not silently skipped', async () => {
  const dir = await tinyProject();
  await rm(path.join(dir, 'js/a.js'));
  try {
    await assert.rejects(() => computeVersion(dir), /ENOENT/);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('an sw.js without a SHELL list is rejected with a clear message', () => {
  assert.throws(() => shellFiles('const VERSION = "x";'), /no SHELL array/);
});
