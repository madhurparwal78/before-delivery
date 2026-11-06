import crypto from 'node:crypto';
import { ApiError, checkPassword, nowSeconds, randomHex, sha256Hex } from './lib/core.js';
import { objectBody, unknown } from './lib/validate.js';
import { query } from './db.js';
import { keyView, memberView } from './services/views.js';

// Resolves a bearer value to {org, member, apiKey, role}; null when it is no live session token or key.
// The membership and role are read fresh on every request.
export async function resolveCredential(token) {
  if (!token) return null;
  const hash = sha256Hex(token);
  if (token.startsWith('cvo_')) {
    const { rows } = await query(
      `SELECT k.*, o.name AS o_name, o.app_id AS o_app_id
         FROM api_keys k JOIN organizations o ON o.id = k.organization_id
        WHERE k.secret_hash = $1 AND k.revoked_at IS NULL`, [hash]);
    if (!rows.length) return null;
    const k = rows[0];
    return { org: { id: k.organization_id, name: k.o_name, app_id: k.o_app_id }, member: null, apiKey: keyView(k),
      role: k.role };
  }
  const { rows } = await query(
    `SELECT m.*, s.id AS session_id, s.csrf, s.flash, o.name AS o_name, o.app_id AS o_app_id
       FROM sessions s JOIN members m ON m.id = s.member_id JOIN organizations o ON o.id = m.organization_id
      WHERE s.token_hash = $1`, [hash]);
  if (!rows.length) return null;
  const m = rows[0];
  return { org: { id: m.organization_id, name: m.o_name, app_id: m.o_app_id }, member: memberView(m), apiKey: null,
    role: m.role, sessionId: m.session_id, csrf: m.csrf, flash: m.flash };
}

export async function signIn(rawBody) {
  const body = objectBody(rawBody);
  unknown(body, { email: true, password: true });
  for (const field of ['email', 'password']) {
    if (typeof body[field] !== 'string') throw new ApiError(422, 'VALIDATION_ERROR', `${field} is required.`, { field });
  }
  const { rows } = await query(
    `SELECT m.*, o.name AS o_name, o.app_id AS o_app_id FROM members m JOIN organizations o ON o.id = m.organization_id
      WHERE m.email = $1`, [body.email.trim().toLowerCase()]);
  const m = rows[0];
  if (!m || !checkPassword(body.password, m.password_hash)) {
    throw new ApiError(401, 'BAD_CREDENTIALS', 'Email or password is incorrect');
  }
  const token = `cvs_${randomHex(24)}`;
  await query('INSERT INTO sessions (id, member_id, token_hash, csrf, created_at) VALUES ($1, $2, $3, $4, to_timestamp($5))',
    [crypto.randomUUID(), m.id, sha256Hex(token), randomHex(16), nowSeconds()]);
  return { token, member: memberView(m), organization: { id: m.organization_id, name: m.o_name, app_id: m.o_app_id } };
}

export async function signOut(caller) {
  await query('DELETE FROM sessions WHERE id = $1', [caller.sessionId]);
}

function bearer(req) {
  const m = (req.get('Authorization') || '').match(/^Bearer\s+(\S+)\s*$/i);
  return m ? m[1] : null;
}

// App id, credential, app id match: in that order, on every signed-in API route. The role step follows per route.
export async function apiAuth(req, res, next) {
  try {
    const appId = req.get('X-Corvo-Org');
    if (!appId) throw new ApiError(400, 'APP_ID_REQUIRED', 'Send your app id in the X-Corvo-Org header.');
    const token = bearer(req);
    if (!token) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in or send an API key.');
    const caller = await resolveCredential(token);
    if (!caller) throw new ApiError(401, 'INVALID_CREDENTIAL', 'This token or key is not valid.');
    if (caller.org.app_id !== appId) throw new ApiError(403, 'APP_ID_MISMATCH', 'This app id is not your organization app id.');
    req.caller = caller;
    next();
  } catch (err) {
    next(err);
  }
}

const MEMBERS = ['owner', 'operator', 'approver', 'auditor'];
// Who may call what: member roles, and the roles of API keys.
export const ROLE = {
  readers: { roles: MEMBERS, keys: ['operator', 'auditor'] },
  members: { roles: MEMBERS, keys: [] },
  owner: { roles: ['owner'], keys: [] },
  movers: { roles: ['owner', 'operator'], keys: ['operator'] },
  auditors: { roles: ['owner', 'auditor'], keys: ['auditor'] },
};

export function allows(caller, rule) {
  return caller.apiKey ? rule.keys.includes(caller.apiKey.role) : rule.roles.includes(caller.role);
}

export const forbidden = () => new ApiError(403, 'FORBIDDEN_ROLE', 'Your role cannot do this.');

export function need(rule) {
  return (req, res, next) => next(allows(req.caller, rule) ? undefined : forbidden());
}
