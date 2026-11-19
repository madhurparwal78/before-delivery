/** Buyer accounts and sign-in. */

import { pool } from '../db';
import { ApiError, invalidFields } from '../errors';
import { FIELD_MESSAGES } from '../../shared/errors';
import {
  createAccountIfNew,
  endSession,
  publicAccount,
  signIn,
  startSession,
} from '../domain/accounts';
import { requireAccount, sessionToken } from '../http/auth';
import {
  clearedSessionCookieHeader,
  sendEmpty,
  sendJson,
  sessionCookieHeader,
  type JsonBody,
  type Wire,
} from '../http/wire';

const EMAIL = /^[^\s@",;:<>()[\]\\]+@[^\s@.",;:<>()[\]\\]+(\.[^\s@.",;:<>()[\]\\]+)+$/;

function readString(body: JsonBody, field: string): string | null {
  const value = body.value[field];
  return typeof value === 'string' ? value : null;
}

/** The same status and message whether or not the address already has an account. */
export async function createAccount(wire: Wire, body: JsonBody): Promise<void> {
  const fields: Record<string, string> = {};
  const name = readString(body, 'name');
  const email = readString(body, 'email');
  const password = readString(body, 'password');
  if (name === null || name.trim().length < 1 || name.trim().length > 80) fields.name = FIELD_MESSAGES.name;
  if (email === null || email.length > 254 || !EMAIL.test(email)) fields.email = FIELD_MESSAGES.email;
  if (password === null || password.length < 10 || password.length > 200) fields.password = FIELD_MESSAGES.password;
  if (Object.keys(fields).length > 0) throw invalidFields(fields);

  await createAccountIfNew(pool, { name: name as string, email: email as string, password: password as string });
  sendJson(wire, 202, { message: 'Your details are in. Sign in to continue.' });
}

export async function openSession(wire: Wire, body: JsonBody): Promise<void> {
  const fields: Record<string, string> = {};
  const email = readString(body, 'email');
  const password = readString(body, 'password');
  if (email === null) fields.email = FIELD_MESSAGES.email;
  if (password === null) fields.password = FIELD_MESSAGES.password;
  if (Object.keys(fields).length > 0) throw invalidFields(fields);

  const account = await signIn(pool, email as string, password as string);
  if (!account) throw new ApiError('sign_in_failed');
  const token = await startSession(pool, account.id);
  sendJson(wire, 200, { account: publicAccount(account) }, { 'Set-Cookie': sessionCookieHeader(token) });
}

export async function readSession(wire: Wire): Promise<void> {
  sendJson(wire, 200, { account: publicAccount(await requireAccount(wire)) });
}

export async function closeSession(wire: Wire): Promise<void> {
  const token = sessionToken(wire);
  if (token) await endSession(pool, token);
  sendEmpty(wire, 204, { 'Set-Cookie': clearedSessionCookieHeader() });
}
