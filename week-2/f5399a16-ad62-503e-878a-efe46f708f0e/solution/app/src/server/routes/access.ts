import { randomUUID } from 'node:crypto';
import { COPY } from '../../shared/copy';
import { foldedKey } from '../../shared/fold';
import { one, pool, transaction, type Row } from '../db';
import { conflict, invalid, noContent, ok, refused, route, Refusal, withHeaders } from '../http';
import { hashPassword, openSession, passwordMatches } from '../session';
import { checkMail, checkName, throwIfAny, type Fields } from '../validate';

const deskJson = (desk: Row) => ({ id: desk.id, name: desk.name, email: desk.email });

function isLongEnough(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 10;
}

route('GET', '/api/health', { auth: 'none' }, async () => ok({ status: 'ok' }));

route('POST', '/api/sign-up', { auth: 'none' }, async ({ body, now }) => {
  const fields: Fields = {};
  const name = checkName(fields, 'name', body.name);
  const email = checkMail(fields, 'email', body.email);
  if (!isLongEnough(body.password)) fields.password = COPY.shortPassword;
  throwIfAny(fields);
  const passwordHash = await hashPassword(body.password as string);
  return transaction(async (tx) => {
    const desk = await one(
      tx,
      `INSERT INTO desks (id, name, email, email_key, password_hash, created_at) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (email_key) DO NOTHING RETURNING id, name, email`,
      [randomUUID(), name, email, foldedKey(email), passwordHash, new Date(now)],
    );
    if (!desk) throw conflict('A desk already holds that mail address.');
    return withHeaders(ok(deskJson(desk), 201), await openSession(tx, desk.id, now));
  });
});

route('POST', '/api/sign-in', { auth: 'none' }, async ({ body, now }) => {
  const fields: Fields = {};
  if (typeof body.email !== 'string' || !body.email) fields.email = COPY.typeMail;
  if (typeof body.password !== 'string' || !body.password) fields.password = COPY.shortPassword;
  throwIfAny(fields);
  const desk = await one(pool, 'SELECT * FROM desks WHERE email_key = $1', [foldedKey(body.email as string)]);
  if (!desk || !(await passwordMatches(body.password as string, desk.password_hash))) {
    throw new Refusal(401, 'wrongSignIn', COPY.wrongSignIn);
  }
  return withHeaders(ok(deskJson(desk)), await openSession(pool, desk.id, now));
});

route('POST', '/api/sign-out', { body: 'none' }, async ({ session }) => {
  if (session.state === 'live') await pool.query('DELETE FROM sessions WHERE token = $1', [session.token]);
  return noContent();
});

route('GET', '/api/session', {}, async ({ desk }) => ok(deskJson(desk)));

route('POST', '/api/password', {}, async ({ body, desk, session }) => {
  if (!isLongEnough(body.newPassword)) throw invalid({ newPassword: COPY.shortPassword });
  const row = await one(pool, 'SELECT password_hash FROM desks WHERE id = $1', [desk.id]);
  if (typeof body.currentPassword !== 'string' || !(await passwordMatches(body.currentPassword, row?.password_hash))) {
    throw refused(COPY.passwordRefused);
  }
  const token = session.state === 'live' ? session.token : '';
  await pool.query('UPDATE desks SET password_hash = $1 WHERE id = $2', [await hashPassword(body.newPassword), desk.id]);
  await pool.query('DELETE FROM sessions WHERE desk_id = $1 AND token <> $2', [desk.id, token]);
  return noContent();
});
