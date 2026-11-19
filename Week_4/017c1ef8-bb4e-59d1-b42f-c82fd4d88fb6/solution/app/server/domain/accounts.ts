import { randomInt } from 'node:crypto';
import { createSession, hashPassword, passwordMatches } from '../auth.js';
import { now } from '../clock.js';
import { maybeRow, oneRow, pool, transaction } from '../db.js';
import { conflict, unprocessable, validation } from '../errors.js';
import { newId } from '../ids.js';
import { queueMail } from '../mail.js';
import { lengthOutside } from './text.js';

const HANDLE = /^[a-z0-9-]{3,30}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UNIQUE_VIOLATION = '23505';

interface SignupInput {
  email: string;
  password: string;
  name: string;
  handle: string;
}

interface PublicMember {
  id: string;
  handle: string;
  name: string;
}

const newCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0');

/** Which sign-up field a unique-index violation names. */
function takenField(error: unknown): 'email' | 'handle' | null {
  if (typeof error !== 'object' || error === null || (error as { code?: unknown }).code !== UNIQUE_VIOLATION) return null;
  return (error as { constraint?: unknown }).constraint === 'members_handle_key' ? 'handle' : 'email';
}

const TAKEN_MESSAGE = { email: 'This email is already registered.', handle: 'This handle is taken.' } as const;

/**
 * Creates the account, or replaces the code of one still unconfirmed for the same email, and emails the code.
 * Refuses with the published field messages.
 */
export async function signUp(input: SignupInput): Promise<void> {
  const { email, password, name, handle } = input;
  const unconfirmed = await maybeRow<{ id: string }>(pool, 'SELECT id FROM members WHERE lower(email) = lower($1) AND NOT confirmed', [email]);
  const fields: Record<string, string> = {};
  if (lengthOutside(name, 1, 80)) fields.name = 'Enter a name of 1 to 80 characters.';
  if (!EMAIL.test(email)) fields.email = 'Enter a valid email address.';
  else if (!unconfirmed && (await maybeRow(pool, 'SELECT 1 FROM members WHERE lower(email) = lower($1)', [email]))) fields.email = TAKEN_MESSAGE.email;
  if (!HANDLE.test(handle)) fields.handle = 'Handles use 3 to 30 lowercase letters, digits and hyphens.';
  else if (await maybeRow(pool, 'SELECT 1 FROM members WHERE handle = $1 AND id IS DISTINCT FROM $2', [handle, unconfirmed?.id ?? null])) fields.handle = TAKEN_MESSAGE.handle;
  if (password.length < 10) fields.password = 'Use at least 10 characters.';
  if (Object.keys(fields).length > 0) throw validation(fields);

  const code = newCode();
  const hash = await hashPassword(password);
  try {
    await transaction(async (tx) => {
      if (unconfirmed) {
        await tx.query('UPDATE members SET name = $2, handle = $3, password_hash = $4, confirm_code = $5 WHERE id = $1', [unconfirmed.id, name, handle, hash, code]);
      } else {
        const at = now();
        await tx.query(
          `INSERT INTO members (id, email, handle, password_hash, name, confirmed, confirm_code, created_at, notifications_seen_at)
           VALUES ($1, $2, $3, $4, $5, false, $6, $7, $7)`,
          [newId(), email, handle, hash, name, code, at],
        );
      }
      await queueMail(tx, {
        to: email,
        subject: `Your Plainwork code: ${code}`,
        text: `Your Plainwork confirmation code is ${code}.\n\nType it on the confirm page to finish joining.\n`,
      });
    });
  } catch (error) {
    const field = takenField(error);
    if (field) throw validation({ [field]: TAKEN_MESSAGE[field] });
    throw error;
  }
}

interface Session {
  token: string;
  member: PublicMember;
}

async function startSession(memberId: string): Promise<Session> {
  return { token: await createSession(pool, memberId), member: await oneRow<PublicMember>(pool, 'SELECT id, handle, name FROM members WHERE id = $1', [memberId]) };
}

/** Confirms the account with its emailed code and signs it in. */
export async function confirmAccount(email: string, code: string): Promise<Session> {
  const member = await maybeRow<{ id: string; confirm_code: string | null }>(pool, 'SELECT id, confirm_code FROM members WHERE lower(email) = lower($1) AND NOT confirmed', [email]);
  if (!member || !member.confirm_code || member.confirm_code !== code) throw validation({ code: "That code doesn't match." });
  await pool.query('UPDATE members SET confirmed = true, confirm_code = NULL WHERE id = $1', [member.id]);
  return startSession(member.id);
}

/** Signs a confirmed member in by email and password. */
export async function signIn(email: string, password: string): Promise<Session> {
  const member = await maybeRow<{ id: string; password_hash: string; confirmed: boolean }>(pool, 'SELECT id, password_hash, confirmed FROM members WHERE lower(email) = lower($1)', [email]);
  if (!member || !(await passwordMatches(password, member.password_hash))) throw unprocessable('invalid_credentials');
  if (!member.confirmed) throw conflict('unconfirmed');
  return startSession(member.id);
}

export async function signOut(token: string): Promise<void> {
  await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
}
