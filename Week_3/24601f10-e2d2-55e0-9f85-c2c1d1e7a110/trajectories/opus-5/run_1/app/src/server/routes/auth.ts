import {
  clearSession,
  createUser,
  guardLoginRate,
  normalizeUsername,
  requireUser,
  signInUser,
  startSession,
  validateCredentials,
} from '../auth';
import { pool, transact } from '../db';
import { type Ctx, readJsonBody, sendEmpty, sendJson } from '../http';

export const signUp = async (ctx: Ctx): Promise<void> => {
  const body = await readJsonBody(ctx.req);
  const { username, password } = validateCredentials(body.username, body.password);
  await transact(async (db) => {
    const user = await createUser(db, username, password);
    await startSession(db, ctx.res, user.id);
  });
  sendJson(ctx.res, 201, { user: { username } });
};

export const signIn = async (ctx: Ctx): Promise<void> => {
  const body = await readJsonBody(ctx.req);
  const username = normalizeUsername(body.username);
  const password = typeof body.password === 'string' ? body.password : '';
  await transact(async (db) => {
    await guardLoginRate(db, username);
  });
  const user = await transact(async (db) => signInUser(db, username, password));
  await transact(async (db) => {
    await startSession(db, ctx.res, user.id);
  });
  sendJson(ctx.res, 200, { user: { username: user.username } });
};

export const signOut = async (ctx: Ctx): Promise<void> => {
  await clearSession(pool, ctx.res, ctx.sessionId);
  sendEmpty(ctx.res, 204);
};

export const me = async (ctx: Ctx): Promise<void> => {
  const user = requireUser(ctx);
  sendJson(ctx.res, 200, { user: { username: user.username } });
};
