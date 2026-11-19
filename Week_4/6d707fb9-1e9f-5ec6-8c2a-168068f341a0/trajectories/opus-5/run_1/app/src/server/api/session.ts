import { config } from '../config';
import { one, query } from '../db/pool';
import { copy } from '../domain/copy';
import { iso, nowSeconds } from '../domain/time';
import { checkPassword, hashPassword, newId, newToken } from '../ids';
import { problem } from '../http/problem';
import type { Ctx, Desk, Reply } from '../http/router';
import { FieldCollector, requiredEmail, requiredText } from '../store/fields';
import type { AssessorRow } from '../store/rows';

export async function findSession(id: string): Promise<{ desk: Desk; ended: boolean } | null> {
  const row = await one<{
    id: string;
    ended: boolean;
    ends_at: string;
    assessor_id: string;
    name: string;
    email: string;
  }>(
    `select s.id, s.ended, s.ends_at, a.id as assessor_id, a.name, a.email
     from sessions s join assessors a on a.id = s.assessor_id where s.id = $1`,
    [id],
  );
  if (!row) return null;
  const ended = row.ended || Number(row.ends_at) <= nowSeconds();
  return { desk: { id: row.assessor_id, name: row.name, email: row.email }, ended };
}

async function startSession(assessorId: string): Promise<string> {
  const id = newToken();
  const now = nowSeconds();
  await query('insert into sessions (id, assessor_id, created_at, ends_at) values ($1, $2, $3, $4)', [
    id,
    assessorId,
    now,
    now + config.sessionSeconds,
  ]);
  return id;
}

export async function signUp(ctx: Ctx): Promise<Reply> {
  const body = ctx.json();
  const problems = new FieldCollector();
  const name = requiredText(body, 'name', problems);
  const email = requiredEmail(body, 'email', problems);
  const password = typeof body.password === 'string' ? body.password : '';
  if (password.length < 10) problems.add('password', copy.emptyField);
  problems.throwIfAny();

  const taken = await one<{ id: string }>('select id from assessors where email = $1', [email]);
  if (taken) throw problem.emailTaken();

  const id = newId();
  await query('insert into assessors (id, name, email, password_hash, created_at) values ($1,$2,$3,$4,$5)', [
    id,
    name,
    email,
    hashPassword(password),
    ctx.now,
  ]);
  const session = await startSession(id);
  return {
    status: 201,
    json: { assessor: { id, name, email } },
    cookie: { value: session },
  };
}

export async function signIn(ctx: Ctx): Promise<Reply> {
  const body = ctx.json();
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const assessor = await one<AssessorRow>('select * from assessors where email = $1', [email]);
  if (!assessor || !checkPassword(password, assessor.password_hash)) throw problem.invalidCredentials();
  const session = await startSession(assessor.id);
  return {
    status: 200,
    json: { assessor: { id: assessor.id, name: assessor.name, email: assessor.email } },
    cookie: { value: session },
  };
}

export async function signOut(ctx: Ctx): Promise<Reply> {
  ctx.requireDesk();
  await query('update sessions set ended = true where id = $1', [ctx.sessionId]);
  return { status: 204, cookie: { clear: true } };
}

export async function readSession(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const row = await one<{ ends_at: string }>('select ends_at from sessions where id = $1', [ctx.sessionId]);
  return {
    status: 200,
    json: {
      assessor: { id: desk.id, name: desk.name, email: desk.email },
      endsAt: iso(Number(row?.ends_at ?? ctx.now)),
    },
  };
}

export async function changePassword(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const body = ctx.json();
  const problems = new FieldCollector();
  const current = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const next = typeof body.newPassword === 'string' ? body.newPassword : '';
  if (next.length < 10) problems.add('newPassword', copy.emptyField);
  problems.throwIfAny();

  const assessor = await one<AssessorRow>('select * from assessors where id = $1', [desk.id]);
  if (!assessor || !checkPassword(current, assessor.password_hash)) throw problem.invalidCredentials();

  await query('update assessors set password_hash = $1 where id = $2', [hashPassword(next), desk.id]);
  await query('update sessions set ended = true where assessor_id = $1 and id <> $2', [desk.id, ctx.sessionId]);
  return { status: 204 };
}
