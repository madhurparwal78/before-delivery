import {
  clearedCookie,
  endSession,
  sessionCookie,
  startSession,
  type Caller,
} from '../auth.js';
import { hashPassword, newId, one, query, verifyPassword, type Row } from '../db.js';
import { fail } from '../errors.js';
import type { Reply, RequestContext } from '../http.js';
import { userView } from '../domain/views.js';

function readString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string') fail('invalid_body');
  return value;
}

export async function register(ctx: RequestContext): Promise<Reply> {
  const body = ctx.body();
  const name = readString(body, 'name').trim();
  const mobile = readString(body, 'mobile').trim();
  const password = readString(body, 'password');
  if (name.length < 1 || name.length > 120) fail('invalid_body');
  if (!/^[6-9]\d{9}$/.test(mobile)) fail('invalid_body');
  if (password.length < 8) fail('invalid_body');
  const taken = await one<Row>('select id from users where mobile = $1', [mobile]);
  if (taken) fail('mobile_taken');
  const id = newId();
  await query(
    `insert into users (id, role, name, mobile, password_hash) values ($1,'rider',$2,$3,$4)`,
    [id, name, mobile, await hashPassword(password)],
  );
  const row = await one<Row>('select * from users where id = $1', [id]);
  const token = await startSession(id);
  ctx.setCookie(sessionCookie(token));
  return { status: 201, json: { user: userView(row as Row) } };
}

export async function signIn(ctx: RequestContext): Promise<Reply> {
  const body = ctx.body();
  const mobile = readString(body, 'mobile').trim();
  const password = readString(body, 'password');
  const row = await one<Row>('select * from users where mobile = $1', [mobile]);
  if (!row) fail('bad_credentials');
  if (!(await verifyPassword(password, (row.password_hash as string | null) ?? null))) {
    fail('bad_credentials');
  }
  const token = await startSession(row.id as string);
  ctx.setCookie(sessionCookie(token));
  return { status: 200, json: { user: userView(row) } };
}

export async function signOut(ctx: RequestContext, caller: Caller): Promise<Reply> {
  await endSession(caller.token);
  ctx.setCookie(clearedCookie());
  return { status: 204 };
}

export function me(_ctx: RequestContext, caller: Caller): Reply {
  return { status: 200, json: { user: caller.user } };
}
