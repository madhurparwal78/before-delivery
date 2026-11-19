// Shared client helpers: API access, money formatting, announcements.

export const SESSION_KEY = 'tallwind_token';
export const LAST_ACCOUNT_KEY = 'tallwind_last_account';

export function getToken() {
  try { return localStorage.getItem(SESSION_KEY) || ''; } catch { return ''; }
}
export function setToken(tok) {
  try {
    if (tok) localStorage.setItem(SESSION_KEY, tok);
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* storage unavailable */ }
}
export function setLastAccount(id) {
  try {
    if (id) localStorage.setItem(LAST_ACCOUNT_KEY, id);
    else localStorage.removeItem(LAST_ACCOUNT_KEY);
  } catch { /* storage unavailable */ }
}
export function getLastAccount() {
  try { return localStorage.getItem(LAST_ACCOUNT_KEY) || ''; } catch { return ''; }
}

export class ApiError extends Error {
  constructor(status, body) {
    super((body && body.error) || 'error');
    this.status = status;
    this.body = body || {};
  }
}

// A session epoch guards late answers from an already-signed-out session.
export let sessionEpoch = 0;
export function bumpSessionEpoch() { sessionEpoch++; }

export async function api(method, path, { body, idempotencyKey, token, signal } = {}) {
  const tok = token !== undefined ? token : getToken();
  const headers = {};
  if (body !== undefined && method !== 'GET') headers['Content-Type'] = 'application/json';
  if (tok) headers['Authorization'] = `Bearer ${tok}`;
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined && method !== 'GET' ? JSON.stringify(body) : undefined,
    signal,
  });
  if (res.status === 204) return null;
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

// ---------- money ----------

export function formatDollars(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toString();
  const frac = String(abs % 100).padStart(2, '0');
  return `${sign}$${groupThousands(whole)}.${frac}`;
}

export function groupThousands(digits) {
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return out;
}

// Dollars text -> cents by exact digit arithmetic. Returns null when refused.
// Accepted: optional $, digits, optional . with 1-2 digits; grouping in exact threes.
export function dollarsTextToCents(raw) {
  const text = String(raw).trim();
  if (text === '') return null;
  let t = text;
  if (t.startsWith('$')) t = t.slice(1);
  if (t === '') return null;
  const m = /^(\d+)((\.)(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const wholeDigits = m[1];
  // grouping check: either no commas, or commas in exact threes
  const groups = wholeDigits.split(',');
  if (groups.length > 1) {
    if (groups[0].length === 0 || groups[0].length > 3) return null;
    for (let i = 1; i < groups.length; i++) if (groups[i].length !== 3) return null;
  }
  const wholePlain = groups.join('');
  if (wholePlain === '') return null;
  const frac = m[4] || '';
  const cents = Number(wholePlain) * 100 + Number(frac.padEnd(2, '0') || '0');
  return cents;
}

// ---------- announcements ----------

// Every message is announced afresh: the region is emptied before each write.
export function announce(el, message) {
  if (!el) return;
  el.textContent = '';
  // Two frames so repeated text still fires a live-region change.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.textContent = message;
    });
  });
}

// ---------- misc ----------

export function codePoints(s) {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  const a = (parts[0] || '?')[0] || '?';
  const b = parts.length > 1 ? (parts[parts.length - 1][0] || '?') : (parts[0] ? parts[0][1] || '?' : '?');
  return (a + b).toUpperCase();
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

// A calendar date like "Tue, Jul 6, 2027" from a YYYY-MM-DD string, without
// the browser's clock or time zone shifting it by a day.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function formatEffectiveDate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  if (!m) return String(dateStr || '');
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dow = dayOfWeek(y, mo, d);
  return `${WEEKDAYS[dow]}, ${MONTHS[mo - 1]} ${d}, ${y}`;
}

export function formatShortDate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  if (!m) return String(dateStr || '');
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
}

// Day of week from a pure calendar date (Sakamoto's algorithm).
function dayOfWeek(y, m, d) {
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const yy = m < 3 ? y - 1 : y;
  return (yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) + t[m - 1] + d) % 7;
}

export function monthLabel(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''));
  if (!m) return String(ym || '');
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${names[Number(m[2]) - 1]} ${m[1]}`;
}

// Safe next handling for sign-in redirects.
export function currentPathAndQuery() {
  return window.location.pathname + window.location.search;
}

export function encodeNext(pathAndQuery) {
  return encodeURIComponent(pathAndQuery);
}

export function replaceOnce(nextPath) {
  window.history.replaceState(null, '', nextPath);
}
