import { sha256Hex, newToken, verifyPassword } from './core.js';
import { errors } from './http.js';
import { withClient } from './db.js';

export const ROLES = ['owner', 'operator', 'approver', 'auditor'];
export const READER_ROLES = ['owner', 'operator', 'approver', 'auditor'];

export function hashToken(token) {
  return sha256Hex(token);
}

export async function createSession(client, memberId) {
  const token = newToken();
  await client.query(
    'INSERT INTO sessions (id, member_id, token_hash, created_at) VALUES ($1,$2,$3,$4)',
    [`ses_${sha256Hex(token).slice(0, 20)}`, memberId, hashToken(token), new Date()]);
  return token;
}

export async function resolveCredential(client, token) {
  if (!token) throw errors.invalidCredential();
  const { rows: sessions } = await client.query(
    `SELECT s.id, m.id AS member_id FROM sessions s
     JOIN members m ON m.id = s.member_id WHERE s.token_hash = $1`,
    [hashToken(token)]
  );
  if (sessions.length) {
    const { rows } = await client.query('SELECT * FROM members WHERE id = $1', [sessions[0].member_id]);
    if (!rows.length) throw errors.invalidCredential();
    return { kind: 'member', member: rows[0], organization_id: rows[0].organization_id };
  }
  if (/^cvo_[0-9a-f]{40}$/.test(token)) {
    const { rows } = await client.query(
      `SELECT k.*, m.id AS creator_id FROM api_keys k
       JOIN members m ON m.id = k.created_by
       WHERE k.secret_hash = $1 AND k.revoked_at IS NULL`,
      [hashToken(token)]
    );
    if (rows.length) {
      return { kind: 'api_key', apiKey: rows[0], member: null, organization_id: rows[0].organization_id };
    }
  }
  throw errors.invalidCredential();
}

export function tokenFromRequest(req, cookies) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return cookies.corvo_session || null;
}

export function checkRole(ctx, roles) {
  if (ctx.kind === 'api_key') {
    if (!roles.includes(ctx.apiKey.role)) throw errors.forbiddenRole();
    return;
  }
  if (!roles.includes(ctx.member.role)) throw errors.forbiddenRole();
}

export async function verifyLogin(client, email, password) {
  const { rows } = await client.query('SELECT * FROM members WHERE lower(email) = lower($1)', [email.trim().toLowerCase()]);
  const member = rows[0];
  if (!member) throw errors.badCredentials();
  const parts = member.password_hash.split(':');
  if (parts.length !== 3 || parts[0] !== 'corvo1') throw errors.badCredentials();
  if (!verifyPassword(password, parts[1], parts[2])) throw errors.badCredentials();
  return member;
}
