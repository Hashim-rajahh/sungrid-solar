import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pngInfo } from './helpers/png.js';
import { SHORTCUTS } from '../js/install.js';
import { resolve } from '../js/router.js';
import { STATUSES } from '../js/data.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFile(path.join(root, f), 'utf8');
const manifest = JSON.parse(await read('manifest.webmanifest'));
const [shellText, indexHtml] = [await read('sw.js'), await read('index.html')];
const shell = new Set([...(/const SHELL = \[([\s\S]*?)\];/.exec(shellText)[1]).matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]));

const declared = (sizes) => sizes.split('x').map(Number);

// ---------- main path: the icons ----------

test('manifest names one "any" and one "maskable" icon at both 192 and 512 pixels', () => {
  for (const purpose of ['any', 'maskable']) {
    for (const size of ['192x192', '512x512']) {
      assert.ok(
        manifest.icons.some((i) => i.sizes === size && i.purpose === purpose),
        `missing ${purpose} icon at ${size}`,
      );
    }
  }
});

test('every manifest icon is a real PNG of exactly the declared size', async () => {
  for (const icon of manifest.icons) {
    const info = await pngInfo(path.join(root, icon.src));
    const [w, h] = declared(icon.sizes);
    assert.deepEqual([info.width, info.height], [w, h], `${icon.src} is ${info.width}x${info.height}, manifest says ${icon.sizes}`);
    assert.equal(icon.type, 'image/png');
  }
});

test('"any" icons keep transparent rounded corners; "maskable" icons are fully opaque so the phone can cut them freely', async () => {
  for (const icon of manifest.icons) {
    const info = await pngInfo(path.join(root, icon.src));
    if (icon.purpose === 'any') assert.equal(info.hasTransparency, true, `${icon.src} should have transparent corners`);
    else assert.equal(info.hasTransparency, false, `${icon.src} must have no transparent pixels`);
  }
});

test('the iPhone icon is 180x180 and fully opaque (iOS paints transparent areas black)', async () => {
  const info = await pngInfo(path.join(root, 'icons/apple-touch-icon.png'));
  assert.deepEqual([info.width, info.height], [180, 180]);
  assert.equal(info.hasTransparency, false);
  assert.match(indexHtml, /<link rel="apple-touch-icon" href="\.\/icons\/apple-touch-icon\.png"/);
});

test('the tab icon exists in SVG and as a 32 pixel PNG, and both are linked', async () => {
  const info = await pngInfo(path.join(root, 'icons/favicon-32.png'));
  assert.deepEqual([info.width, info.height], [32, 32]);
  assert.match(indexHtml, /href="\.\/icons\/favicon\.svg"/);
  assert.match(indexHtml, /href="\.\/icons\/favicon-32\.png" sizes="32x32"/);
});

test('the installed app on iPhone gets a short name and full-screen mode', () => {
  assert.match(indexHtml, /name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(indexHtml, /name="apple-mobile-web-app-title" content="SunGrid"/);
});

// ---------- main path: identity, shortcuts, screenshots ----------

test('the app has a stable identity and the fields the browser needs to offer install', () => {
  assert.equal(manifest.id, 'sungrid-solar');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.prefer_related_applications, false);
  for (const key of ['name', 'short_name', 'description', 'start_url', 'scope', 'theme_color', 'background_color', 'lang']) {
    assert.ok(manifest[key], `manifest.${key} is required`);
  }
  assert.ok(manifest.short_name.length <= 12, 'short_name must fit under a home-screen icon');
});

test('manifest shortcuts are exactly the ones the Install page lists', () => {
  assert.equal(manifest.shortcuts.length, SHORTCUTS.length);
  SHORTCUTS.forEach((sc, i) => {
    const m = manifest.shortcuts[i];
    assert.equal(m.name, sc.name);
    assert.equal(m.short_name, sc.short_name);
    assert.equal(m.description, sc.description);
    assert.equal(m.url, sc.url);
    assert.equal(m.icons[0].src, sc.icon);
  });
});

test('every shortcut opens a real screen of this app, with a valid job status if it filters', async () => {
  for (const sc of manifest.shortcuts) {
    assert.match(sc.url, /^\.\/#\//, `${sc.name}: shortcut must stay inside the app and be relative`);
    const route = resolve(sc.url.slice(sc.url.indexOf('#')));
    assert.notEqual(route.name, 'not-found', `${sc.name} (${sc.url}) opens a page that does not exist`);
    if (route.query.status) assert.ok(STATUSES.includes(route.query.status), `${sc.name}: "${route.query.status}" is not a job status`);
    const info = await pngInfo(path.join(root, sc.icons[0].src));
    assert.deepEqual([info.width, info.height], [96, 96], `${sc.name} icon must be 96x96`);
  }
});

test('screenshots exist at the declared size, with a phone set and a laptop set', async () => {
  const forms = new Set(manifest.screenshots.map((s) => s.form_factor));
  assert.deepEqual([...forms].sort(), ['narrow', 'wide']);
  for (const shot of manifest.screenshots) {
    const info = await pngInfo(path.join(root, shot.src));
    const [w, h] = declared(shot.sizes);
    assert.deepEqual([info.width, info.height], [w, h], `${shot.src} is ${info.width}x${info.height}, manifest says ${shot.sizes}`);
    assert.ok(shot.label && shot.label.length > 10, `${shot.src} needs a meaningful label`);
    assert.ok(Math.max(w, h) / Math.min(w, h) <= 2.3, `${shot.src}: Chrome ignores screenshots with an aspect ratio above 2.3`);
  }
});

// ---------- failure paths these guard against ----------

test('no icon uses the combined "any maskable" purpose (browsers then crop the icon badly)', () => {
  for (const icon of manifest.icons) assert.ok(!/\s/.test(icon.purpose), `${icon.src}: purpose "${icon.purpose}" mixes two meanings`);
});

test('everything the manifest names that the app needs offline is saved by the service worker', () => {
  const needed = [...manifest.icons.map((i) => i.src), ...manifest.shortcuts.map((s) => s.icons[0].src), 'icons/apple-touch-icon.png', 'icons/favicon-32.png'];
  for (const f of needed) assert.ok(shell.has(f), `${f} is not saved by the service worker, so install would fail with no signal`);
});

test('all manifest and shortcut addresses are relative, so the app works from any folder', () => {
  const text = JSON.stringify(manifest);
  assert.doesNotMatch(text, /"(src|start_url|scope|url)":\s*"\//);
});

test('a file that is not a PNG is reported by name instead of passing silently', async () => {
  await assert.rejects(() => pngInfo(path.join(root, 'manifest.webmanifest')), /not a PNG file/);
});
