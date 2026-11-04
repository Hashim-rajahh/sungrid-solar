// Tiny static file server so the app can be run with `npm start` (service workers need http://, not file://).
// Zero dependencies. Usage: node scripts/serve.mjs [port]

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] ?? process.env.PORT ?? 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const MAX_BODY = 20 * 1024; // a site report is well under 1 KB; anything bigger is not one

/** Read a small request body. Resolves null if it is bigger than MAX_BODY. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) tooBig = true; // keep reading (and dropping) so the 413 answer can still be delivered
      else chunks.push(chunk);
    });
    req.on('end', () => resolve(tooBig ? null : Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function defaultHandleReport(fields) {
  console.log(`Report received: ${fields.report_id}  ${fields.job}  ${fields.kind}  ${fields.panels} panels  by ${fields.installer}`);
}

/**
 * `handleReport(fields)` stands in for Netlify Forms while developing: the app POSTs site reports to "/"
 * and this answers 200 like Netlify does. The default prints the report so it can be checked in the terminal.
 * It may return a number to answer with that status instead (the browser checks use this to simulate outages).
 */
export function createServer({ handleReport = defaultHandleReport } = {}) {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'POST') {
        const body = await readBody(req);
        if (body === null) {
          res.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Too large');
          return;
        }
        const fields = Object.fromEntries(new URLSearchParams(body));
        if (fields['form-name'] !== 'site-report') {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Unknown form');
          return;
        }
        const status = (await handleReport(fields)) ?? 200;
        res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(status === 200 ? 'Thank you' : 'Error');
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD, POST' }).end();
        return;
      }

      const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const relative = urlPath.endsWith('/') ? `${urlPath}index.html` : urlPath;
      const file = path.join(root, path.normalize(relative));

      // Never serve anything outside the project folder (blocks ../ tricks).
      if (!file.startsWith(root + path.sep)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
        // Dev server: always revalidate, so edits (and sw.js updates) show up immediately.
        'Cache-Control': 'no-cache',
      });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    }
  });
}

// Start on `port`; if it is taken, try the next ones instead of crashing.
export function listen(server, startPort, attemptsLeft = 10) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
        console.log(`Port ${startPort} is already in use, trying ${startPort + 1}...`);
        resolve(listen(server, startPort + 1, attemptsLeft - 1));
      } else {
        reject(err);
      }
    };
    server.once('error', onError);
    server.listen(startPort, () => {
      server.off('error', onError);
      resolve(startPort);
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const used = await listen(createServer(), port);
    console.log(`SunGrid Solar running at http://localhost:${used}/`);
    console.log('Press Ctrl+C to stop.');
  } catch (err) {
    console.error(`Could not start the server: ${err.message}`);
    process.exit(1);
  }
}
