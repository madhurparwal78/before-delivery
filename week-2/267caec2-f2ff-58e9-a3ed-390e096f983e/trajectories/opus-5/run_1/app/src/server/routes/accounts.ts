import { emailTaken, invalidCredentials, studioNameTaken } from '../copy';
import { newId, pool } from '../db';
import { studioNameOf } from '../data';
import type { UserRow } from '../domain/types';
import { empty, json, requireActor, requireRole, route, type Ctx, type Reply } from '../http/router';
import { actorForToken, endSession, hashPassword, startSession, verifyPassword } from '../http/session';
import { isEmail, Problems, rawText, text } from '../http/validate';
import { userJson } from '../view';

async function emailInUse(email: string): Promise<boolean> {
  const found = await pool.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [email]);
  return found.rowCount !== 0;
}

async function createStudio(ctx: Ctx): Promise<Reply> {
  const studioName = text(ctx.body, 'studioName');
  const contactName = text(ctx.body, 'contactName');
  const email = text(ctx.body, 'email');
  const password = rawText(ctx.body, 'password');

  if (await emailInUse(email)) throw emailTaken();
  const nameTaken = await pool.query('SELECT 1 FROM studios WHERE lower(name) = lower($1)', [studioName]);
  if (nameTaken.rowCount !== 0) throw studioNameTaken();

  const problems = new Problems();
  problems.check(studioName.length >= 2 && studioName.length <= 80, 'studioName', 'Give a studio name of 2 to 80 characters.');
  problems.check(contactName.length >= 2 && contactName.length <= 80, 'contactName', 'Give a contact name of 2 to 80 characters.');
  problems.check(isEmail(email), 'email', 'Give a valid email address.');
  problems.check(password.length >= 10, 'password', 'Use a password of at least 10 characters.');
  problems.throwIfAny();

  const studioId = newId('std');
  const userId = newId('usr');
  await pool.query('INSERT INTO studios (id, name, contact_name, email) VALUES ($1, $2, $3, $4)', [
    studioId,
    studioName,
    contactName,
    email,
  ]);
  await pool.query(
    "INSERT INTO users (id, role, name, email, password_hash, studio_id) VALUES ($1, 'studio', $2, $3, $4, $5)",
    [userId, contactName, email, await hashPassword(password), studioId],
  );
  await startSession(ctx.res, userId);
  return json(201, {
    user: userJson(
      { id: userId, role: 'studio', name: contactName, email, studioId },
      studioName,
    ),
  });
}

async function signIn(ctx: Ctx): Promise<Reply> {
  const email = text(ctx.body, 'email');
  const password = rawText(ctx.body, 'password');
  const found = await pool.query<UserRow>('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
  const user = found.rows[0];
  if (user === undefined || !(await verifyPassword(password, user.password_hash))) {
    throw invalidCredentials();
  }
  await startSession(ctx.res, user.id);
  const actor = { id: user.id, role: user.role, name: user.name, email: user.email, studioId: user.studio_id };
  return json(200, { user: userJson(actor, await studioNameOf(pool, user.studio_id)) });
}

async function currentSession(ctx: Ctx): Promise<Reply> {
  const actor = requireActor(ctx);
  return json(200, { user: userJson(actor, await studioNameOf(pool, actor.studioId)) });
}

async function signOut(ctx: Ctx): Promise<Reply> {
  requireActor(ctx);
  await endSession(ctx.res, ctx.token as string);
  return empty(204);
}

async function listStudios(ctx: Ctx): Promise<Reply> {
  requireRole(ctx, 'director', 'juror');
  const result = await pool.query<{ id: string; name: string }>(
    'SELECT id, name FROM studios ORDER BY name',
  );
  return json(200, { studios: result.rows });
}

async function createJuror(ctx: Ctx): Promise<Reply> {
  requireRole(ctx, 'director');
  const name = text(ctx.body, 'name');
  const email = text(ctx.body, 'email');
  const password = rawText(ctx.body, 'password');
  const studioIdValue = ctx.body.studioId;
  const studioId = typeof studioIdValue === 'string' && studioIdValue !== '' ? studioIdValue : null;

  if (await emailInUse(email)) throw emailTaken();

  const problems = new Problems();
  problems.check(name.length >= 2 && name.length <= 80, 'name', 'Give a juror name of 2 to 80 characters.');
  problems.check(isEmail(email), 'email', 'Give a valid email address.');
  problems.check(password.length >= 10, 'password', 'Use a password of at least 10 characters.');
  if (studioId !== null) {
    const studio = await pool.query('SELECT 1 FROM studios WHERE id = $1', [studioId]);
    problems.check(studio.rowCount !== 0, 'studioId', 'Choose a studio.');
  }
  problems.throwIfAny();

  const id = newId('usr');
  await pool.query(
    "INSERT INTO users (id, role, name, email, password_hash, studio_id) VALUES ($1, 'juror', $2, $3, $4, $5)",
    [id, name, email, await hashPassword(password), studioId],
  );
  return json(201, { juror: { id, name, email, studioId } });
}

async function listJurors(ctx: Ctx): Promise<Reply> {
  requireRole(ctx, 'director');
  const result = await pool.query<{ id: string; name: string; email: string; studio_id: string | null }>(
    "SELECT id, name, email, studio_id FROM users WHERE role = 'juror' ORDER BY name",
  );
  return json(200, {
    jurors: result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      studioId: row.studio_id,
    })),
  });
}

export const accountRoutes = [
  route('POST', '/api/studios', createStudio),
  route('POST', '/api/session', signIn),
  route('GET', '/api/session', currentSession),
  route('DELETE', '/api/session', signOut),
  route('GET', '/api/studios', listStudios),
  route('POST', '/api/jurors', createJuror),
  route('GET', '/api/jurors', listJurors),
];

export { actorForToken };
