// Small, dependency-free helpers shared by views, quote logic and tests.

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape any value for safe insertion into HTML text or attribute values. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/**
 * Format a number as Pakistani rupees with lakh/crore grouping,
 * e.g. 1720000 -> "Rs 17,20,000". Deterministic: does not depend on the
 * browser's Intl locale data, so tests and every device agree.
 */
export function formatPkr(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  const digits = String(Math.round(Math.abs(n)));
  let grouped = digits;
  if (digits.length > 3) {
    const last3 = digits.slice(-3);
    const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    grouped = `${rest},${last3}`;
  }
  return `${n < 0 ? '-' : ''}Rs ${grouped}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-24" -> "24 Oct 2026". Anything unparsable returns an em dash. */
export function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  if (!m) return '—';
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return '—';
  return `${day} ${MONTHS[month - 1]} ${m[1]}`;
}

/**
 * Round half-up without binary floating-point surprises.
 * Plain (5.175).toFixed(2) gives "5.17" because 5.175 is stored as 5.17499999...;
 * shifting the decimal point through exponent notation avoids that.
 */
function roundTo(n, digits) {
  if (String(n).includes('e')) return n; // very large/small: leave to toFixed
  return Number(`${Math.round(Number(`${n}e${digits}`))}e-${digits}`);
}

/** Fixed-decimal number with thousands separators, e.g. 1234.5 -> "1,234.5". */
export function formatNumber(n, digits = 0) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  const [whole, frac] = roundTo(n, digits).toFixed(digits).split('.');
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${withCommas}.${frac}` : withCommas;
}

/** Lower-case, hyphenated slug for CSS class names: "Net-metering" -> "net-metering". */
export function slug(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
