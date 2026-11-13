import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import type { Quizmaster } from '../shared/protocol.js';
import { SESSION_TTL_SECONDS } from './config.js';
import { query, uniqueViolationOn } from './db/pool.js';
import { emailTaken, invalidCredentials } from './errors.js';
import { FieldErrors } from './parse.js';

const KEY_LENGTH = 32;
const SCRYPT_COST = 16_384;

function deriveKey(password: string, salt: Buffer, length: number, cost: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, length, { N: cost, r: 8, p: 1 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await deriveKey(password, salt, KEY_LENGTH, SCRYPT_COST);
  return `scrypt$${SCRYPT_COST}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [scheme, cost, salt, digest] = stored.split('$');
  if (scheme !== 'scrypt' || !cost || !salt || !digest) return false;
  const expected = Buffer.from(digest, 'base64url');
  const derived = await deriveKey(
    password,
    Buffer.from(salt, 'base64url'),
    expected.length,
    Number(cost),
  );
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export function validateCredentials(
  email: string | null,
  password: string | null,
  displayName: string | null,
): { email: string; password: string; displayName: string } {
  const errors = new FieldErrors();
  const trimmedEmail = (email ?? '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail) || trimmedEmail.length > 200) {
    errors.add('email', 'Enter an email address.');
  }
  const givenPassword = password ?? '';
  if (givenPassword.length < 10) {
    errors.add('password', 'Use a password of at least 10 characters.');
  }
  const trimmedName = (displayName ?? '').trim();
  if (trimmedName.length < 1 || trimmedName.length > 60) {
    errors.add('displayName', 'Use a display name of 1 to 60 characters.');
  }
  errors.throwIfAny();
  return { email: trimmedEmail, password: givenPassword, displayName: trimmedName };
}

interface QuizmasterRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
}

export async function createQuizmaster(
  email: string,
  password: string,
  displayName: string,
): Promise<Quizmaster> {
  const id = randomUUID();
  try {
    await query(
      `INSERT INTO quizmasters (id, email, email_lower, password_hash, display_name)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, email, email.toLowerCase(), await hashPassword(password), displayName],
    );
  } catch (error) {
    if (uniqueViolationOn(error, 'quizmasters_email_lower_key')) throw emailTaken();
    throw error;
  }
  return { id, email, displayName };
}

export async function authenticate(email: string, password: string): Promise<Quizmaster> {
  const rows = await query<QuizmasterRow>(
    'SELECT id, email, display_name, password_hash FROM quizmasters WHERE email_lower = $1',
    [email.trim().toLowerCase()],
  );
  const row = rows[0];
  if (!row || !(await passwordMatches(password, row.password_hash))) throw invalidCredentials();
  return { id: row.id, email: row.email, displayName: row.display_name };
}

export async function startSession(quizmasterId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await query(
    `INSERT INTO sessions (token_hash, quizmaster_id, expires_at)
     VALUES ($1, $2, now() + make_interval(secs => $3))`,
    [hashSession(token), quizmasterId, SESSION_TTL_SECONDS],
  );
  return token;
}

export async function endSession(token: string): Promise<void> {
  await query('DELETE FROM sessions WHERE token_hash = $1', [hashSession(token)]);
}

export async function sessionQuizmaster(token: string): Promise<Quizmaster | null> {
  const rows = await query<{ id: string; email: string; display_name: string }>(
    `SELECT q.id, q.email, q.display_name FROM sessions s
     JOIN quizmasters q ON q.id = s.quizmaster_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashSession(token)],
  );
  const row = rows[0];
  return row ? { id: row.id, email: row.email, displayName: row.display_name } : null;
}

function hashSession(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
