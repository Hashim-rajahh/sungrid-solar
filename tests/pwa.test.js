import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFile(path.join(root, f), 'utf8');
const exists = (f) => access(path.join(root, f)).then(() => true, () => false);

async function shellFromServiceWorker() {
  const sw = await read('sw.js');
  const block = /const SHELL = \[([\s\S]*?)\];/.exec(sw);
  assert.ok(block, 'sw.js must define a SHELL array');
  return [...block[1].matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]);
}

// ---- main path ----
test('manifest is valid and its icons exist', async () => {
  const manifest = JSON.parse(await read('manifest.webmanifest'));
  for (const key of ['name', 'short_name', 'start_url', 'display', 'theme_color', 'background_color']) {
    assert.ok(manifest[key], `manifest.${key} is required`);
  }
  assert.equal(manifest.display, 'standalone');
  const sizes = manifest.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'), 'needs 192 and 512 icons');
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'), 'needs a maskable icon');
  for (const icon of manifest.icons) assert.ok(await exists(icon.src), `missing icon file ${icon.src}`);
});

test('index.html links the manifest, stylesheet and module entry point', async () => {
  const html = await read('index.html');
  assert.match(html, /rel="manifest" href="\.\/manifest\.webmanifest"/);
  assert.match(html, /href="\.\/css\/styles\.css"/);
  assert.match(html, /<script type="module" src="\.\/js\/app\.js">/);
  assert.match(html, /<main id="app"/);
  assert.match(html, /<html lang="en">/);
});

test('every file the service worker precaches exists', async () => {
  for (const f of await shellFromServiceWorker()) {
    if (f === '') continue; // "./" is the start URL
    assert.ok(await exists(f), `sw.js precaches missing file: ${f}`);
  }
});

// ---- failure paths this guards against ----
test('no app file is missing from the offline cache (would break offline use)', async () => {
  const cached = new Set(await shellFromServiceWorker());
  const required = ['index.html', 'manifest.webmanifest'];
  for (const dir of ['js', 'css', 'icons']) {
    for (const name of await readdir(path.join(root, dir))) required.push(`${dir}/${name}`);
  }
  for (const f of required) assert.ok(cached.has(f), `${f} is not in the service worker SHELL list`);
});

test('service worker has versioned caches and cleans up old ones', async () => {
  const sw = await read('sw.js');
  assert.match(sw, /const VERSION = 'sungrid-[0-9a-f]{8}'/);
  assert.match(sw, /caches\.delete/);
  assert.match(sw, /request\.mode === 'navigate'/);
});

test('all asset URLs are relative so the app works under /<repo-name>/ on GitHub Pages', async () => {
  const html = await read('index.html');
  const manifest = await read('manifest.webmanifest');
  const sw = await read('sw.js');
  assert.doesNotMatch(html, /(src|href)="\/[^/]/, 'index.html must not use root-absolute URLs');
  assert.doesNotMatch(manifest, /"(src|start_url|scope)":\s*"\//);
  assert.doesNotMatch(sw, /'\/[a-z]/);
});

test('netlify.toml publishes the root and never caches the service worker', async () => {
  const toml = await read('netlify.toml');
  assert.match(toml, /publish = "\."/);
  assert.match(toml, /for = "\/sw\.js"[\s\S]*?Cache-Control = "no-cache"/);
});
