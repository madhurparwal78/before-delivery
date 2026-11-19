'use strict';
const crypto = require('crypto');

const BUSINESS_OFFSET_MINUTES = 330; // Asia/Kolkata, fixed +05:30

function iso(d) {
  return new Date(d).toISOString();
}

function nowIso() {
  return new Date().toISOString();
}

/** Calendar date of a moment in the business time zone, as YYYY-MM-DD. */
function businessDay(moment) {
  const t = new Date(moment).getTime() + BUSINESS_OFFSET_MINUTES * 60000;
  return new Date(t).toISOString().slice(0, 10);
}

const SECRET = 'keystone-cursor-' + (process.env.DATABASE_URL || 'local');

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const mac = crypto.createHmac('sha256', SECRET).update(body).digest('base64url').slice(0, 24);
  return body + '.' + mac;
}

function unsign(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const idx = token.lastIndexOf('.');
  const body = token.slice(0, idx);
  const mac = token.slice(idx + 1);
  const want = crypto.createHmac('sha256', SECRET).update(body).digest('base64url').slice(0, 24);
  if (mac !== want) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function sha256hex(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

const ZERO_HASH = '0'.repeat(64);

/** The published change log digest recipe. */
function entryHash(parts) {
  const text = [
    parts.previous_hash,
    parts.table_slug,
    String(parts.ordinal),
    parts.action,
    parts.account,
    parts.column === null || parts.column === undefined ? '' : parts.column,
    parts.recorded_at,
  ].join('|');
  return sha256hex(text);
}

function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const d = crypto.scryptSync(password, s, 32).toString('hex');
  return s + ':' + d;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, digest] = stored.split(':');
  const d = crypto.scryptSync(password, salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(d, 'hex'), Buffer.from(digest, 'hex'));
}

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

module.exports = {
  BUSINESS_OFFSET_MINUTES,
  iso,
  nowIso,
  businessDay,
  sign,
  unsign,
  sha256hex,
  ZERO_HASH,
  entryHash,
  randomToken,
  hashPassword,
  verifyPassword,
  escapeHtml,
  stableStringify,
};
