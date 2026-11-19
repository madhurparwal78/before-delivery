import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import pg from 'pg';
import type { Person } from '../domain/types.js';
import { pool } from '../db/pool.js';

const hash = (token: string): string => createHash('sha256').update(token).digest('hex');

export async function createSession(person: Person): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await pool.query('INSERT INTO sessions (token_hash, person_id, created_at) VALUES ($1,$2,$3)', [
    hash(token), person.id, new Date().toISOString(),
  ]);
  return token;
}

export async function getSession(token: string | undefined): Promise<Person | null> {
  if (!token) return null;
  const res = await pool.query<Person>(
    `SELECT p.id, p.email, p.name, p.firm, p.kind, p.staff_role AS "staffRole"
     FROM sessions s JOIN people p ON p.id = s.person_id
     WHERE s.token_hash = $1`,
    [hash(token)],
  );
  return res.rows[0] ?? null;
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hash(token)]);
}

export function parseSessionCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === 'lintel_session') return rest.join('=');
  }
  return undefined;
}
