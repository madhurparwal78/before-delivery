/**
 * Boundary helpers: refusals a person can read, body validation and the
 * session the caller carries.
 */

import { Refusal } from './games.js';
import { hashToken } from './security.js';
import { one } from './db.js';

export { Refusal };

export function fail(status, message) {
  throw new Refusal(status, message);
}

export const route = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

export function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function bearerToken(req) {
  const header = req.get('authorization');
  if (header && /^bearer\s+/i.test(header)) return header.replace(/^bearer\s+/i, '').trim();
  const cookies = parseCookies(req);
  return cookies.gh_token || null;
}

/** Resolve the caller's member row from their bearer token or session cookie. */
export async function resolveMember(req) {
  const token = bearerToken(req);
  if (!token) return null;
  const member = await one(
    `select m.* from sessions s join members m on m.id = s.member_id where s.token_hash = $1`,
    [hashToken(token)],
  );
  return member || null;
}

export function requireMember(req) {
  if (!req.member) fail(401, 'Sign in to do that.');
  return req.member;
}

export function requireAdministrator(req) {
  const member = requireMember(req);
  if (member.role !== 'administrator') fail(403, 'Only an administrator may do that.');
  return member;
}

export function bodyObject(req) {
  const value = req.body;
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) fail(422, 'The request body must be an object.');
  return value;
}

export function requireString(value, label, { min = 1, max = 10_000, status = 422 } = {}) {
  if (typeof value !== 'string') fail(status, `${label} must be text.`);
  if (value.length < min) fail(status, `${label} must be at least ${min} characters.`);
  if (value.length > max) fail(status, `${label} must be at most ${max} characters.`);
  return value;
}

export function requireBoolean(value, label) {
  if (typeof value !== 'boolean') fail(422, `${label} must be true or false.`);
  return value;
}

export function requireOneOf(value, options, label) {
  if (!options.includes(value)) {
    fail(422, `${label} must be one of ${options.join(', ')}.`);
  }
  return value;
}

export function sendArray(res, items, { nextCursor = null } = {}) {
  if (nextCursor !== null && nextCursor !== undefined) res.setHeader('X-Next-Cursor', nextCursor);
  res.json(items);
}
