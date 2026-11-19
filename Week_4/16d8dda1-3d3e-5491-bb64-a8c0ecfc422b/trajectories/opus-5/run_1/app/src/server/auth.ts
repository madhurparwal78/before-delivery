import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { query, queryOne } from './db.js';
import { newId } from './ids.js';

const derive = promisify(scrypt);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = (await derive(password, salt, 32)) as Buffer;
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || salt === undefined || key === undefined) return false;
  const expected = Buffer.from(key, 'base64url');
  const actual = (await derive(password, Buffer.from(salt, 'base64url'), expected.byteLength)) as Buffer;
  return expected.byteLength === actual.byteLength && timingSafeEqual(expected, actual);
}

export async function startTeacherSession(teacherId: string): Promise<string> {
  const id = newId('sas');
  await query('INSERT INTO auth_sessions (id, teacher_id) VALUES ($1, $2)', [id, teacherId]);
  return id;
}

export async function startLearnerSession(learnerId: string): Promise<string> {
  const id = newId('sas');
  await query('INSERT INTO auth_sessions (id, learner_id) VALUES ($1, $2)', [id, learnerId]);
  return id;
}

export async function endAuthSession(id: string): Promise<void> {
  await query('DELETE FROM auth_sessions WHERE id = $1', [id]);
}

export async function teacherByEmail(
  worldId: string,
  email: string
): Promise<{ id: string; display_name: string; email: string } | null> {
  return queryOne('SELECT id, display_name, email FROM teachers WHERE world_id = $1 AND email_lower = $2', [
    worldId,
    email.trim().toLowerCase()
  ]);
}
