// Hash-based router. Pure functions only (no DOM), so it can be unit-tested in Node.
//
// URLs look like  index.html#/jobs/SG-1042  or  index.html#/jobs?status=Installing
// See the README "Decision" section for why hash routing was chosen over the History API.

export const ROUTES = [
  { name: 'dashboard', pattern: '/' },
  { name: 'jobs', pattern: '/jobs' },
  { name: 'job', pattern: '/jobs/:id' },
  { name: 'quote', pattern: '/quote' },
  { name: 'inventory', pattern: '/inventory' },
  { name: 'offline', pattern: '/offline' },
];

/** decodeURIComponent that returns null instead of throwing on malformed input like "%E0%A4%A". */
function safeDecode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}

/**
 * Split a location hash into a normalised path and a query object.
 *   ""                       -> { path: "/", query: {} }
 *   "#/jobs/"                -> { path: "/jobs", query: {} }
 *   "#/jobs?status=Quoted"   -> { path: "/jobs", query: { status: "Quoted" } }
 */
export function parseHash(hash) {
  let raw = typeof hash === 'string' ? hash : '';
  if (raw.startsWith('#')) raw = raw.slice(1);

  const q = raw.indexOf('?');
  const pathPart = q === -1 ? raw : raw.slice(0, q);
  const queryPart = q === -1 ? '' : raw.slice(q + 1);

  let path = pathPart.startsWith('/') ? pathPart : `/${pathPart}`;
  if (path.length > 1) path = path.replace(/\/+$/, '') || '/';

  const query = {};
  for (const pair of queryPart.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const key = safeDecode((eq === -1 ? pair : pair.slice(0, eq)).replace(/\+/g, ' '));
    const value = safeDecode((eq === -1 ? '' : pair.slice(eq + 1)).replace(/\+/g, ' '));
    if (key !== null && value !== null && key !== '') query[key] = value;
  }
  return { path, query };
}

/** Match a normalised path against ROUTES. Unknown or malformed paths give { name: "not-found" }. */
export function matchRoute(path) {
  const segments = path.split('/').slice(1); // "/jobs/SG-1" -> ["jobs", "SG-1"]; "/" -> [""]
  for (const route of ROUTES) {
    const patternSegments = route.pattern.split('/').slice(1);
    if (patternSegments.length !== segments.length) continue;

    const params = {};
    let matched = true;
    for (let i = 0; i < patternSegments.length; i++) {
      const want = patternSegments[i];
      const got = segments[i];
      if (want.startsWith(':')) {
        const decoded = safeDecode(got);
        if (decoded === null || decoded === '') {
          matched = false;
          break;
        }
        params[want.slice(1)] = decoded;
      } else if (want !== got) {
        matched = false;
        break;
      }
    }
    if (matched) return { name: route.name, params };
  }
  return { name: 'not-found', params: {} };
}

/** Full resolution used by the app: hash in, { name, params, query, path } out. */
export function resolve(hash) {
  const { path, query } = parseHash(hash);
  return { ...matchRoute(path), query, path };
}
