import type { Request, Response, NextFunction, Express } from 'express';
import { q, one } from './db.js';
import { randomToken, sixDigitCode, hashPassword, checkPassword } from './config.js';
import { unauthenticated, notFound, forbidden, conflict, fieldErrors } from './errors.js';
import { now } from './clock.js';
import { requireUser, setSessionCookie, clearSessionCookie, loadSession, type SessionUser } from './http.js';
import { queueMail } from './mail.js';

export function registerAuthRoutes(app: Express): void {
  app.post('/api/auth/signup', async (req, res, next) => {
    try {
      const body = req.body as Record<string, unknown>;
      const email = String(body['email'] ?? '').trim().toLowerCase();
      const password = String(body['password'] ?? '');
      const name = String(body['name'] ?? '').trim();
      if (password.length < 8) throw fieldErrors({ password: 'Use at least 8 characters' });
      const existing = await one<{ id: string }>('select id from users where email = $1', [email]);
      if (existing) throw fieldErrors({ email: 'Already registered' });
      const code = sixDigitCode();
      await q(
        `insert into users (email, name, password_hash, confirm_code, confirmed, created_at)
         values ($1, $2, $3, $4, false, $5)`,
        [email, name || email.split('@')[0], hashPassword(password), code, await now()]
      );
      await queueMail(email, `Your Celmate code: ${code}`, code);
      res.status(201).json({ status: 'pending' });
    } catch (e) { next(e); }
  });

  app.post('/api/auth/confirm', async (req, res, next) => {
    try {
      const body = req.body as Record<string, unknown>;
      const email = String(body['email'] ?? '').trim().toLowerCase();
      const code = String(body['code'] ?? '');
      const user = await one<{ id: string; email: string; name: string; confirm_code: string | null; confirmed: boolean }>(
        'select id::text, email, name, confirm_code, confirmed from users where email = $1', [email]
      );
      if (!user || user.confirm_code !== code) throw fieldErrors({ code: 'That code is not right' });
      await q('update users set confirmed = true, confirm_code = null where id = $1', [user.id]);
      const token = randomToken();
      await q('insert into sessions (token, user_id, created_at) values ($1, $2, $3)', [token, user.id, await now()]);
      setSessionCookie(res, token);
      res.json({ id: Number(user.id), email: user.email, name: user.name });
    } catch (e) { next(e); }
  });

  app.post('/api/auth/login', async (req, res, next) => {
    try {
      const body = req.body as Record<string, unknown>;
      const email = String(body['email'] ?? '').trim().toLowerCase();
      const password = String(body['password'] ?? '');
      const user = await one<{ id: string; email: string; name: string; password_hash: string; confirmed: boolean }>(
        'select id::text, email, name, password_hash, confirmed from users where email = $1', [email]
      );
      if (!user) throw fieldErrors({ password: 'Email or password is incorrect' });
      if (!user.confirmed) throw fieldErrors({ email: 'Confirm your email first' });
      if (!checkPassword(password, user.password_hash)) throw fieldErrors({ password: 'Email or password is incorrect' });
      const token = randomToken();
      await q('insert into sessions (token, user_id, created_at) values ($1, $2, $3)', [token, user.id, await now()]);
      setSessionCookie(res, token);
      res.json({ id: Number(user.id), email: user.email, name: user.name });
    } catch (e) { next(e); }
  });

  app.post('/api/auth/logout', async (req, res, next) => {
    try {
      const token = parseCookie(req.headers.cookie ?? '');
      if (token) await q('delete from sessions where token = $1', [token]);
      clearSessionCookie(res);
      res.status(204).end();
    } catch (e) { next(e); }
  });

  app.get('/api/me', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      res.json({ id: user.id, email: user.email, name: user.name, number_format: user.number_format, time_zone: user.time_zone });
    } catch (e) { next(e); }
  });

  app.patch('/api/me', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const body = req.body as Record<string, unknown>;
      const errors: Record<string, string> = {};
      const nf = body['number_format'];
      const tz = body['time_zone'];
      if (nf !== undefined && nf !== 'en-US' && nf !== 'en-IN') errors['number_format'] = 'Use en-US or en-IN';
      if (tz !== undefined && !['UTC', 'Asia/Kolkata', 'America/New_York'].includes(String(tz))) errors['time_zone'] = 'Use UTC, Asia/Kolkata or America/New_York';
      if (Object.keys(errors).length) throw fieldErrors(errors);
      if (nf !== undefined) await q('update users set number_format = $1 where id = $2', [nf, user.id]);
      if (tz !== undefined) await q('update users set time_zone = $1 where id = $2', [tz, user.id]);
      const fresh = await one<{ id: string; email: string; name: string; number_format: string; time_zone: string }>(
        'select id::text, email, name, number_format, time_zone from users where id = $1', [user.id]
      );
      res.json({ id: Number(fresh!.id), email: fresh!.email, name: fresh!.name, number_format: fresh!.number_format, time_zone: fresh!.time_zone });
    } catch (e) { next(e); }
  });
}

function parseCookie(header: string): string | null {
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === 'celmate_session') return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}
