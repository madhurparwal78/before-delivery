import type { App } from './app.js';
import type { RequestContext } from './http.js';
import { sendJson } from './http.js';
import { ApiError, mailUnavailable, validation, wrongCredentials, unconfirmed } from './errors.js';
import { limits } from './rules.js';
import { trim, countCodePoints, randomId, isoPlusSeconds } from './util.js';
import bcrypt from 'bcryptjs';

export async function handleSignup(app: App, ctx: RequestContext): Promise<void> {
  const body = ctx.jsonBody as Record<string, unknown>;
  const displayName = trim(String(body.display_name ?? ''));
  const email = trim(String(body.email ?? '')).toLowerCase();
  const password = String(body.password ?? '');
  const errors: Record<string, string> = {};
  if (countCodePoints(displayName) < 1 || countCodePoints(displayName) > limits.displayNameMax) {
    errors.display_name = 'Display names are 1 to 40 characters.';
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Enter an email address.';
  if (password.length < limits.passwordMin || password.length > limits.passwordMax) {
    errors.password = 'Passwords are 8 to 72 characters.';
  }
  if (Object.keys(errors).length > 0) throw validation(errors);

  const existing = await app.db.query('SELECT id, confirmed FROM users WHERE email = $1', [email]);
  const existingRow = existing.rows[0] as { id: string; confirmed: boolean } | undefined;
  if (existingRow?.confirmed) throw validation({ email: 'That email already has an account.' });

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expires = isoPlusSeconds(app.config.verifyCodeTtl);
  const sent = await app.services.mail.send({
    to: email,
    subject: 'Your Pinsheet code',
    text: `Your Pinsheet code is ${code}.`,
  });
  if (!sent) throw mailUnavailable();

  const hash = await bcrypt.hash(password, 10);
  if (existingRow) {
    await app.db.query('UPDATE users SET display_name = $1, password_hash = $2 WHERE id = $3', [
      displayName,
      hash,
      existingRow.id,
    ]);
  } else {
    await app.db.query('INSERT INTO users (id, display_name, email, password_hash) VALUES ($1, $2, $3, $4)', [
      randomId('usr'),
      displayName,
      email,
      hash,
    ]);
  }
  await app.db.query('INSERT INTO verify_codes (id, email, code, expires_at) VALUES ($1, $2, $3, $4)', [
    randomId('vcd'),
    email,
    code,
    expires,
  ]);
  sendJson(ctx.res, 202, { status: 'code_sent' });
}

export async function handleVerify(app: App, ctx: RequestContext): Promise<void> {
  const body = ctx.jsonBody as Record<string, unknown>;
  const email = trim(String(body.email ?? '')).toLowerCase();
  const code = trim(String(body.code ?? ''));
  const res = await app.db.query(
    `SELECT v.id AS code_id, v.expires_at, u.id AS user_id, u.display_name, u.email, u.confirmed
       FROM verify_codes v JOIN users u ON u.email = v.email
      WHERE v.email = $1 AND v.code = $2 AND NOT v.used
      ORDER BY v.created_at DESC LIMIT 1`,
    [email, code],
  );
  const row = res.rows[0] as
    | { code_id: string; expires_at: Date; user_id: string; display_name: string; email: string; confirmed: boolean }
    | undefined;
  if (!row || row.expires_at.getTime() < Date.now()) {
    throw validation({ code: 'That code is wrong or has expired.' });
  }
  await app.db.query('UPDATE verify_codes SET used = true WHERE id = $1', [row.code_id]);
  await app.db.query('UPDATE users SET confirmed = true WHERE id = $1', [row.user_id]);
  await app.db.query('DELETE FROM verify_codes WHERE email = $1', [email]);
  const { createSession } = await import('./sessions.js');
  const session = await createSession(app.db, row.user_id);
  app.setSessionCookie(ctx, session);
  sendJson(ctx.res, 200, { user: { id: row.user_id, display_name: row.display_name, email: row.email } });
}

export async function handleSignin(app: App, ctx: RequestContext): Promise<void> {
  const body = ctx.jsonBody as Record<string, unknown>;
  const email = trim(String(body.email ?? '')).toLowerCase();
  const password = String(body.password ?? '');
  const res = await app.db.query('SELECT id, display_name, email, password_hash, confirmed FROM users WHERE email = $1', [email]);
  const row = res.rows[0] as
    | { id: string; display_name: string; email: string; password_hash: string; confirmed: boolean }
    | undefined;
  if (!row || !(await bcrypt.compare(password, row.password_hash))) throw wrongCredentials();
  if (!row.confirmed) throw unconfirmed();
  const { createSession } = await import('./sessions.js');
  const session = await createSession(app.db, row.id);
  app.setSessionCookie(ctx, session);
  sendJson(ctx.res, 200, { user: { id: row.id, display_name: row.display_name, email: row.email } });
}

export async function handleSignout(app: App, ctx: RequestContext): Promise<void> {
  const { destroySession } = await import('./sessions.js');
  await destroySession(app.db, ctx.cookies['pinsheet_session']);
  app.setSessionCookie(ctx, null);
  ctx.res.writeHead(204);
  ctx.res.end();
}

export async function handleMe(app: App, ctx: RequestContext): Promise<void> {
  if (!ctx.userId) throw new ApiError(401, { error: 'sign_in_required' });
  const res = await app.db.query('SELECT id, display_name, email FROM users WHERE id = $1', [ctx.userId]);
  const row = res.rows[0] as { id: string; display_name: string; email: string } | undefined;
  if (!row) throw new ApiError(401, { error: 'sign_in_required' });
  sendJson(ctx.res, 200, { user: row });
}
