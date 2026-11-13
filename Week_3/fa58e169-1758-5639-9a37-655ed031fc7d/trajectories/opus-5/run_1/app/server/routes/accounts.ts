import {
  createSession,
  createUser,
  endSession,
  hashPassword,
  newToken,
  passwordMatches,
  requireUser,
  userByEmail,
} from '../auth';
import { config, limits, today } from '../config';
import { copy } from '../copy';
import { one, query } from '../db';
import { ApiError, conflict, invalid, notFound, type Router } from '../http';
import { MAIL_FAILED, sendMail, verificationMail } from '../mail';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validEmail(value: unknown): value is string {
  return typeof value === 'string' && EMAIL.test(value.trim());
}

export function hoursSince(when: Date): number {
  return (Date.now() - when.getTime()) / 3_600_000;
}

export function registerAccountRoutes(router: Router): void {
  router.get('/api/health', async () => ({ status: 'ok' }));

  router.get('/api/config', async () => ({
    today: today(),
    timeZone: config.timeZone,
    limits,
  }));

  router.post('/api/signup', async (ctx) => {
    const name = typeof ctx.body.name === 'string' ? ctx.body.name.trim() : '';
    if (name === '') throw invalid('name', copy.signUpName);
    if (!validEmail(ctx.body.email)) throw invalid('email', copy.signUpEmail);
    const email = (ctx.body.email as string).trim();
    const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
    if (password.length < 10) throw invalid('password', copy.signUpPassword);
    if (await userByEmail(email)) throw conflict('email_taken', copy.signUpTaken);

    const user = await createUser(name, email, password, false);
    const token = newToken();
    await query('insert into verify_tokens (token, user_id) values ($1, $2)', [token, user.id]);
    const mail = verificationMail(token);
    try {
      await sendMail(email, mail.subject, mail.body);
    } catch {
      await query('delete from users where id = $1', [user.id]);
      throw new ApiError(503, { error: 'mail_unavailable', message: MAIL_FAILED });
    }
    ctx.res.statusCode = 201;
    return { id: user.id };
  });

  router.post('/api/verify', async (ctx) => {
    const token = typeof ctx.body.token === 'string' ? ctx.body.token : '';
    const row = await one<{ user_id: string; created_at: Date }>(
      'select user_id, created_at from verify_tokens where token = $1',
      [token],
    );
    if (!row) throw notFound();
    if (hoursSince(row.created_at) > limits.verifyTtlHours) {
      throw conflict('link_expired', copy.verifyExpired);
    }
    await query('update users set verified = true where id = $1', [row.user_id]);
    await query('delete from verify_tokens where token = $1', [token]);
    return { verified: true };
  });

  router.post('/api/session', async (ctx) => {
    const email = typeof ctx.body.email === 'string' ? ctx.body.email : '';
    const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
    const user = await userByEmail(email);
    if (!user || !passwordMatches(password, user.passwordHash)) {
      throw new ApiError(401, { error: 'invalid_credentials', message: copy.signInWrong });
    }
    if (!user.verified) {
      throw new ApiError(401, { error: 'unverified', message: copy.signInUnverified });
    }
    await createSession(user.id, ctx.res);
    return { id: user.id, name: user.name, email: user.email };
  });

  router.delete('/api/session', async (ctx) => {
    await endSession(ctx);
    ctx.res.statusCode = 204;
    return null;
  });

  router.get('/api/me', async (ctx) => {
    const user = await requireUser(ctx);
    return { id: user.id, name: user.name, email: user.email, reduceMotion: user.reduceMotion };
  });

  router.patch('/api/me', async (ctx) => {
    const user = await requireUser(ctx);
    let name = user.name;
    if (ctx.body.name !== undefined) {
      const given = typeof ctx.body.name === 'string' ? ctx.body.name.trim() : '';
      if (given === '') throw invalid('name', copy.signUpName);
      name = given;
    }
    let reduceMotion = user.reduceMotion;
    if (ctx.body.reduceMotion !== undefined) reduceMotion = ctx.body.reduceMotion === true;
    await query('update users set name = $2, reduce_motion = $3 where id = $1', [
      user.id,
      name,
      reduceMotion,
    ]);
    return { id: user.id, name, email: user.email, reduceMotion };
  });

  router.post('/api/me/password', async (ctx) => {
    const user = await requireUser(ctx);
    const stored = await userByEmail(user.email);
    const current = typeof ctx.body.current === 'string' ? ctx.body.current : '';
    const next = typeof ctx.body.next === 'string' ? ctx.body.next : '';
    if (!stored || !passwordMatches(current, stored.passwordHash)) {
      throw invalid('current', copy.settingsPassword);
    }
    if (next.length < 10) throw invalid('next', copy.signUpPassword);
    await query('update users set password_hash = $2 where id = $1', [user.id, hashPassword(next)]);
    ctx.res.statusCode = 204;
    return null;
  });
}
