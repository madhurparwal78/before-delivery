import { User } from '../../shared/types';
import {
  clearedSessionCookie,
  createSession,
  destroySession,
  hashPassword,
  newId,
  sessionCookie,
  toUser,
  UserRow,
  verifyPassword,
} from '../auth';
import { queryOne, transaction } from '../db';
import { MESSAGES } from '../domain/messages';
import { isEmail, isNonEmptyString } from '../domain/validate';
import * as errors from '../http/errors';
import { bodyRecord, Ctx, requireSession, sendEmpty, sendJson } from '../http/context';
import { catalogueStates, createPractice, getPractice, insertStates, practiceNow } from '../repo/practice';
import { toInstantString, PRACTICE_ZONE } from '../domain/zones';

async function emailTaken(email: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>('SELECT id FROM users WHERE lower(email) = lower($1)', [
    email,
  ]);
  return row !== null;
}

export async function signUp(ctx: Ctx): Promise<void> {
  const body = bodyRecord(ctx);
  const fieldErrors: Record<string, string> = {};
  if (!isNonEmptyString(body.display_name)) fieldErrors.display_name = MESSAGES.display_name_signup;
  if (!isEmail(body.email)) fieldErrors.email = MESSAGES.email_invalid;
  if (typeof body.password !== 'string' || body.password.length < 8) {
    fieldErrors.password = MESSAGES.password;
  }
  if (!fieldErrors.email && (await emailTaken(body.email as string))) {
    fieldErrors.email = MESSAGES.email_taken;
  }
  if (Object.keys(fieldErrors).length > 0) throw errors.validation(fieldErrors);

  const email = (body.email as string).trim();
  const passwordHash = await hashPassword(body.password as string);
  const result = await transaction(async (tx) => {
    const practiceId = await createPractice(9, tx);
    const userId = newId();
    await tx.query(
      `INSERT INTO users (id, practice_id, display_name, email, password_hash, role, client_id, created_ms)
       VALUES ($1,$2,$3,$4,$5,'bookkeeper',NULL,$6)`,
      [userId, practiceId, (body.display_name as string).trim(), email, passwordHash, Date.now()],
    );
    await insertStates(practiceId, catalogueStates(), tx);
    const token = await createSession(userId, tx);
    return { practiceId, userId, token };
  });
  const user: User = {
    id: result.userId,
    display_name: (body.display_name as string).trim(),
    email,
    role: 'bookkeeper',
    client_id: null,
  };
  sendJson(ctx.res, 201, { practice_id: result.practiceId, user }, {
    'set-cookie': sessionCookie(result.token),
  });
}

export async function signIn(ctx: Ctx): Promise<void> {
  const body = bodyRecord(ctx);
  const wrong = () => errors.validation({ email: MESSAGES.signin });
  if (typeof body.email !== 'string' || typeof body.password !== 'string') throw wrong();
  const row = await queryOne<UserRow>(
    `SELECT id, practice_id, display_name, email, password_hash, role, client_id
       FROM users WHERE lower(email) = lower($1)`,
    [body.email.trim()],
  );
  if (!row || !(await verifyPassword(body.password, row.password_hash))) throw wrong();
  const token = await createSession(row.id);
  sendJson(ctx.res, 200, { user: toUser(row) }, { 'set-cookie': sessionCookie(token) });
}

export async function signOut(ctx: Ctx): Promise<void> {
  requireSession(ctx);
  if (ctx.token) await destroySession(ctx.token);
  sendEmpty(ctx.res, 204, { 'set-cookie': clearedSessionCookie() });
}

export async function me(ctx: Ctx): Promise<void> {
  const user = requireSession(ctx);
  const practice = await getPractice(user.practice_id);
  if (!practice) throw errors.notFound();
  sendJson(ctx.res, 200, {
    user: toUser(user),
    practice_id: practice.id,
    now: toInstantString(practiceNow(practice)),
    practice_zone: PRACTICE_ZONE,
    reminder_hour: practice.reminder_hour,
  });
}
