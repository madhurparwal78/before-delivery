import { Router } from 'express';
import { emailTaken, invalidCode, invalidCredentials, invalidField, notConfirmed } from '../../shared/errors';
import {
  UserRow,
  clearSessionCookie,
  createSession,
  endSession,
  hashPassword,
  newSignupCode,
  setSessionCookie,
  verifyPassword,
} from '../auth';
import { requireUser } from '../access';
import { newId } from '../collectionStore';
import { query, queryOne } from '../db';
import { body, handler } from '../httpUtil';
import { sendSignupCode } from '../mail';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(user: UserRow): Record<string, string> {
  return { id: user.id, email: user.email, name: user.name };
}

function readEmail(value: unknown): string {
  if (typeof value !== 'string' || !EMAIL.test(value.trim())) throw invalidField('email');
  return value.trim().toLowerCase();
}

export const authRoutes = Router();

authRoutes.post(
  '/signup',
  handler(async (req, res) => {
    const fields = body(req);
    const email = readEmail(fields['email']);
    const password = fields['password'];
    if (typeof password !== 'string' || password.length < 8) throw invalidField('password');
    const name = fields['name'];
    if (typeof name !== 'string' || name.length < 1 || name.length > 80) throw invalidField('name');

    const existing = await queryOne<UserRow>('select id, confirmed from users where email = $1', [email]);
    if (existing?.confirmed) throw emailTaken();
    if (existing) {
      await query('update users set name = $2, password_hash = $3 where id = $1', [
        existing.id,
        name,
        hashPassword(password),
      ]);
    } else {
      await query('insert into users (id, email, name, password_hash, confirmed) values ($1, $2, $3, $4, false)', [
        newId(),
        email,
        name,
        hashPassword(password),
      ]);
    }
    const code = newSignupCode();
    await query(
      `insert into signup_codes (email, code, created_at) values ($1, $2, now())
       on conflict (email) do update set code = $2, created_at = now()`,
      [email, code],
    );
    await sendSignupCode(email, code);
    res.status(201).json({ status: 'code_sent' });
  }),
);

authRoutes.post(
  '/confirm',
  handler(async (req, res) => {
    const fields = body(req);
    const email = readEmail(fields['email']);
    const code = fields['code'];
    if (typeof code !== 'string') throw invalidCode();
    const stored = await queryOne<{ code: string }>('select code from signup_codes where email = $1', [email]);
    if (!stored || stored.code !== code) throw invalidCode();
    const user = await queryOne<UserRow>(
      'select id, email, name, password_hash, confirmed from users where email = $1',
      [email],
    );
    if (!user) throw invalidCode();
    await query('update users set confirmed = true where id = $1', [user.id]);
    await query('delete from signup_codes where email = $1', [email]);
    const session = await createSession(user.id);
    setSessionCookie(res, session);
    res.status(200).json({ user: publicUser(user) });
  }),
);

authRoutes.post(
  '/resend',
  handler(async (req, res) => {
    const email = readEmail(body(req)['email']);
    const user = await queryOne<{ confirmed: boolean }>('select confirmed from users where email = $1', [email]);
    if (user && !user.confirmed) {
      const code = newSignupCode();
      await query(
        `insert into signup_codes (email, code, created_at) values ($1, $2, now())
         on conflict (email) do update set code = $2, created_at = now()`,
        [email, code],
      );
      await sendSignupCode(email, code);
    }
    res.status(202).json({ status: 'code_sent' });
  }),
);

authRoutes.post(
  '/signin',
  handler(async (req, res) => {
    const fields = body(req);
    const email = typeof fields['email'] === 'string' ? fields['email'].trim().toLowerCase() : '';
    const password = fields['password'];
    const user = await queryOne<UserRow>(
      'select id, email, name, password_hash, confirmed from users where email = $1',
      [email],
    );
    if (!user || typeof password !== 'string' || !verifyPassword(password, user.password_hash)) {
      throw invalidCredentials();
    }
    if (!user.confirmed) throw notConfirmed();
    const session = await createSession(user.id);
    setSessionCookie(res, session);
    res.status(200).json({ user: publicUser(user) });
  }),
);

authRoutes.post(
  '/signout',
  handler(async (req, res) => {
    await endSession(req);
    clearSessionCookie(res);
    res.status(204).end();
  }),
);

export const meRoute = Router();

meRoute.get(
  '/me',
  handler(async (req, res) => {
    const user = await requireUser(req);
    res.json({ user: publicUser(user) });
  }),
);
