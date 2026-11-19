import { Router } from 'express';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { pool } from '../db.js';
import { ApiError, validation, handle } from '../errors.js';
import { hashToken, newId, newToken } from '../ids.js';
import { createSession, requireUser, SESSION_COOKIE, toProtocolUser } from '../auth.js';
import { sendMail } from '../mail.js';
import { config } from '../config.js';

export const authRouter = Router();

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

authRouter.post('/signup', handle(async (req, res) => {
  const { displayName, email, password } = req.body ?? {};
  const fields: Record<string, string> = {};
  if (typeof displayName !== 'string' || displayName.length < 1 || displayName.length > 40) fields.displayName = 'Display name needs 1 to 40 characters.';
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.email = 'Enter a valid email address.';
  if (typeof password !== 'string' || password.length < 10) fields.password = 'Password needs at least 10 characters.';
  if (Object.keys(fields).length > 0) throw validation(fields);

  const normalized = email.trim().toLowerCase();
  const existing = await pool.query('SELECT id FROM users WHERE email_ci = $1', [normalized]);
  if (existing.rows[0]) throw new ApiError(409, 'email_taken', 'An account with this email already exists.');

  const id = newId('u');
  await pool.query('INSERT INTO users (id, email, email_ci, display_name, password_hash, verified) VALUES ($1, $2, $3, $4, $5, false)', [
    id,
    normalized,
    normalized,
    displayName.trim(),
    hashPassword(password),
  ]);

  const token = newToken(24);
  await pool.query('INSERT INTO verify_tokens (token_hash, user_id, email, expires_at) VALUES ($1, $2, $3, now() + ($4 || \' seconds\')::interval)', [
    hashToken(token),
    id,
    normalized,
    config().verifyTtlSeconds,
  ]);
  await sendMail(normalized, 'Confirm your Wringbench account', `Confirm your account: ${config().publicUrl}/verify/${token}`);

  res.status(201).json({ user: { id, email: normalized, displayName: displayName.trim(), verified: false } });
}));

authRouter.post('/verify', handle(async (req, res) => {
  const { token } = req.body ?? {};
  if (typeof token !== 'string' || token.length === 0) throw validation({ token: 'A token is needed.' });
  const r = await pool.query<{ user_id: string }>(
    'UPDATE verify_tokens SET used = true WHERE token_hash = $1 AND NOT used AND expires_at > now() RETURNING user_id',
    [hashToken(token)],
  );
  if (!r.rows[0]) throw new ApiError(404, 'not_found', 'Not found.');
  const u = await pool.query('UPDATE users SET verified = true WHERE id = $1 RETURNING id, email, display_name, verified', [r.rows[0].user_id]);
  res.json({ user: { id: u.rows[0].id, email: u.rows[0].email, displayName: u.rows[0].display_name, verified: true } });
}));

authRouter.post('/signin', handle(async (req, res) => {
  const { email, password } = req.body ?? {};
  const fields: Record<string, string> = {};
  if (typeof email !== 'string' || email.length === 0) fields.email = 'Email is needed.';
  if (typeof password !== 'string' || password.length === 0) fields.password = 'Password is needed.';
  if (Object.keys(fields).length > 0) throw validation(fields);

  const normalized = email.trim().toLowerCase();
  const r = await pool.query<{ id: string; display_name: string; verified: boolean; password_hash: string }>(
    'SELECT id, display_name, verified, password_hash FROM users WHERE email_ci = $1',
    [normalized],
  );
  const row = r.rows[0];
  if (!row || !verifyPassword(password, row.password_hash)) throw new ApiError(401, 'invalid_credentials', 'Email or password is wrong.');
  if (!row.verified) throw new ApiError(403, 'email_unverified', 'Confirm your email first. We sent you a link.');

  const token = await createSession(row.id);
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 30 * 24 * 3600 * 1000 });
  res.json({ user: { id: row.id, email: normalized, displayName: row.display_name, verified: true } });
}));

authRouter.post('/signout', handle(async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) await pool.query('DELETE FROM sessions WHERE token = $1', [hashToken(token)]);
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', path: '/' });
  res.status(204).end();
}));

authRouter.get('/me', handle(async (req, res) => {
  const user = requireUser(req);
  const teams = await pool.query<{ id: string; name: string; role: string }>(
    `SELECT t.id, t.name, tm.role FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE tm.user_id = $1 ORDER BY t.name`,
    [user.id],
  );
  res.json({ user: toProtocolUser(user), teams: teams.rows });
}));
