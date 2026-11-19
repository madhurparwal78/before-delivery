import { profileProjection, memberById } from '../../domain/members';
import { businessNow } from '../clock';
import { query } from '../db';
import { conflict, namedValidation, validation } from '../errors';
import { newConfirmationCode, newId, newToken } from '../ids';
import { jsonBody, requireMember, type Ctx } from '../http';
import { queueMail } from '../mail';
import { hashPassword, verifyPassword } from '../passwords';

const HANDLE_PATTERN = /^[a-z0-9-]{3,30}$/;

export function setSessionCookie(ctx: Ctx, token: string): void {
  ctx.res.setHeader(
    'set-cookie',
    `pw_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`,
  );
}

function clearSessionCookie(ctx: Ctx): void {
  ctx.res.setHeader('set-cookie', 'pw_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

async function createSession(ctx: Ctx, memberId: string): Promise<void> {
  const token = newToken();
  await query('INSERT INTO sessions (token, member_id, created_at) VALUES ($1,$2,$3)', [
    token,
    memberId,
    businessNow(),
  ]);
  setSessionCookie(ctx, token);
}

export async function signUp(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const body = jsonBody(ctx);
  const email = String(body.email ?? '').trim();
  const password = String(body.password ?? '');
  const name = String(body.name ?? '').trim();
  const handle = String(body.handle ?? '').trim();
  const fields: Record<string, string> = {};

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fields.email = 'Enter an email address.';
  if (name.length < 1 || name.length > 80) fields.name = 'Enter a name of 1 to 80 characters.';
  if (!HANDLE_PATTERN.test(handle)) {
    fields.handle = 'Handles use 3 to 30 lowercase letters, digits and hyphens.';
  }
  if (password.length < 10) fields.password = 'Use at least 10 characters.';

  const existingHandle = await query<{ id: string }>(
    'SELECT id FROM members WHERE lower(handle) = lower($1)',
    [handle],
  );
  if (!fields.handle && existingHandle.length > 0) fields.handle = 'This handle is taken.';

  const existingEmail = await query<{ id: string; confirmed: boolean }>(
    'SELECT id, confirmed FROM members WHERE lower(email) = lower($1)',
    [email],
  );
  const unconfirmed = existingEmail[0] && !existingEmail[0].confirmed;
  if (!fields.email && existingEmail[0] && existingEmail[0].confirmed) {
    fields.email = 'This email is already registered.';
  }
  if (Object.keys(fields).length > 0) throw validation(fields);

  const code = newConfirmationCode();
  if (unconfirmed) {
    await query('UPDATE members SET confirm_code = $2, name = $3, handle = $4, password_hash = $5 WHERE id = $1', [
      existingEmail[0].id,
      code,
      name,
      handle,
      hashPassword(password),
    ]);
  } else {
    await query(
      `INSERT INTO members (id, email, handle, password_hash, name, confirmed, confirm_code, created_at)
       VALUES ($1,$2,$3,$4,$5,false,$6,$7)`,
      [newId('mbr'), email, handle, hashPassword(password), name, code, businessNow()],
    );
  }
  await queueMail(
    email,
    `Your Plainwork code: ${code}`,
    `Your Plainwork confirmation code is ${code}.\n\nType it on the confirm page to finish joining.`,
  );
  return { status: 201, body: { status: 'confirmation_sent' } };
}

export async function confirm(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const body = jsonBody(ctx);
  const email = String(body.email ?? '').trim();
  const code = String(body.code ?? '').trim();
  const rows = await query<{ id: string; handle: string; name: string; confirm_code: string | null }>(
    'SELECT id, handle, name, confirm_code FROM members WHERE lower(email) = lower($1)',
    [email],
  );
  const member = rows[0];
  if (!member || member.confirm_code === null || member.confirm_code !== code) {
    throw validation({ code: "That code doesn't match." });
  }
  await query('UPDATE members SET confirmed = true, confirm_code = NULL WHERE id = $1', [member.id]);
  await createSession(ctx, member.id);
  return {
    status: 200,
    body: { member: { id: member.id, handle: member.handle, name: member.name } },
  };
}

export async function signIn(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const body = jsonBody(ctx);
  const email = String(body.email ?? '').trim();
  const password = String(body.password ?? '');
  const rows = await query<{
    id: string;
    handle: string;
    name: string;
    password_hash: string;
    confirmed: boolean;
  }>('SELECT id, handle, name, password_hash, confirmed FROM members WHERE lower(email) = lower($1)', [
    email,
  ]);
  const member = rows[0];
  if (!member || !verifyPassword(password, member.password_hash)) {
    throw namedValidation('invalid_credentials');
  }
  if (!member.confirmed) throw conflict('unconfirmed');
  await createSession(ctx, member.id);
  return {
    status: 200,
    body: { member: { id: member.id, handle: member.handle, name: member.name } },
  };
}

export async function signOut(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const cookie = ctx.req.headers.cookie ?? '';
  const match = /pw_session=([^;]+)/.exec(cookie);
  if (match) await query('DELETE FROM sessions WHERE token = $1', [match[1]]);
  clearSessionCookie(ctx);
  return { status: 204, body: null };
}

export async function me(ctx: Ctx): Promise<{ status: number; body: unknown }> {
  const memberId = requireMember(ctx);
  const member = await memberById(memberId);
  if (!member) throw namedValidation('invalid_credentials');
  return { status: 200, body: await profileProjection(memberId, member) };
}
