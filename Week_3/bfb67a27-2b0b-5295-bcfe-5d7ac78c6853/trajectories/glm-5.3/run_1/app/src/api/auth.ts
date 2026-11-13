// Authentication and role resolution (DP-40).

import type { Request } from 'express';
import { pool } from '../db.js';


export interface StaffSession {
  role: 'owner' | 'prep_tech';
}

export async function createSession(passcode: string): Promise<StaffSession | null> {
  const result = await pool.query<{ role: 'owner' | 'prep_tech' }>(
    'SELECT role FROM staff WHERE passcode = $1',
    [passcode],
  );
  if (result.rowCount === 0) {
    return null;
  }
  return result.rows[0];
}

import { randomBytes } from 'node:crypto';

export function issueToken(): string {
  return randomBytes(24).toString('base64url');
}

export async function storeSession(token: string, role: 'owner' | 'prep_tech'): Promise<void> {
  await pool.query('INSERT INTO sessions (token, role) VALUES ($1, $2)', [token, role]);
}

export async function sessionRole(req: Request): Promise<'owner' | 'prep_tech' | null> {
  const token = req.cookies?.tallyslate_session;
  if (typeof token !== 'string' || token.length === 0) {
    return null;
  }
  const result = await pool.query<{ role: 'owner' | 'prep_tech' }>(
    'SELECT role FROM sessions WHERE token = $1',
    [token],
  );
  return result.rowCount === 0 ? null : result.rows[0].role;
}

export async function destroySession(token: string): Promise<void> {
  await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
}
