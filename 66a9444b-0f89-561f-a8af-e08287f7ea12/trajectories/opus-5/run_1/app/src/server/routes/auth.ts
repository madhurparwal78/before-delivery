import { Router } from 'express';
import { one, pool } from '../db/pool.js';
import { hashPassword, newId, verifyPassword } from '../lib/codes.js';
import { ApiError, conflict } from '../lib/errors.js';
import {
  clearSessionCookie,
  setSessionCookie,
  type Caller,
  type Role,
} from '../http/middleware.js';
import { ErrorBag, asString, asTrimmed, expectObject, looksLikeEmail } from '../http/validate.js';

export const authRouter = Router();

interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  organisation_id: string | null;
}

export function publicUser(caller: Caller): PublicUser {
  return {
    id: caller.id,
    email: caller.email,
    name: caller.name,
    role: caller.role,
    organisation_id: caller.organisationId,
  };
}

async function startSession(userId: string): Promise<string> {
  const sessionId = newId();
  await pool.query(`INSERT INTO auth_sessions (id, user_id) VALUES ($1, $2)`, [sessionId, userId]);
  return sessionId;
}

authRouter.post('/auth/register', async (req, res) => {
  const body = expectObject(req.body);
  const bag = new ErrorBag();
  const name = asTrimmed(body['name']);
  const email = asTrimmed(body['email']);
  const password = asString(body['password']);
  if (name === null || name.length > 200) bag.add('name', 'required');
  if (email === null || !looksLikeEmail(email)) bag.add('email', 'invalid');
  if (password === null || password.length < 10 || password.length > 200) {
    bag.add('password', 'invalid');
  }
  bag.throwIfAny();

  const lowered = (email as string).toLowerCase();
  const existing = await one<{ id: string }>(pool, `SELECT id FROM users WHERE email = $1`, [
    lowered,
  ]);
  if (existing !== null) throw conflict('email_taken');

  const id = newId();
  await pool.query(
    `INSERT INTO users (id, email, name, password_hash, role, organisation_id)
     VALUES ($1, $2, $3, $4, 'visitor', NULL)`,
    [id, lowered, name, hashPassword(password as string)],
  );
  await setSessionCookie(res, await startSession(id));
  res.status(201).json({
    user: { id, email: lowered, name, role: 'visitor', organisation_id: null },
  });
});

authRouter.post('/auth/signin', async (req, res) => {
  const body = expectObject(req.body);
  const email = asTrimmed(body['email']);
  const password = asString(body['password']);
  if (email === null || password === null) throw new ApiError(401, 'invalid_credentials');

  const row = await one<{
    id: string;
    email: string;
    name: string;
    role: Role;
    organisation_id: string | null;
    password_hash: string;
  }>(
    pool,
    `SELECT id, email, name, role, organisation_id, password_hash FROM users WHERE email = $1`,
    [email.toLowerCase()],
  );
  if (row === null || !verifyPassword(password, row.password_hash)) {
    throw new ApiError(401, 'invalid_credentials');
  }
  await setSessionCookie(res, await startSession(row.id));
  res.status(200).json({
    user: {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      organisation_id: row.organisation_id,
    },
  });
});

authRouter.post('/auth/signout', async (req, res) => {
  if (req.caller !== null) {
    await pool.query(`DELETE FROM auth_sessions WHERE user_id = $1`, [req.caller.id]);
  }
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.get('/me', (req, res) => {
  res.status(200).json({ user: req.caller === null ? null : publicUser(req.caller) });
});
