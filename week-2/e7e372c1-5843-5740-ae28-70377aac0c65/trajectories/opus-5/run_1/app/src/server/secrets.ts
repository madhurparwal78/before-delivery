import { randomBytes } from 'node:crypto';
import { query } from './db';

const SESSION_SIGNING_KEY = 'session_signing_key';
const TICK_KEY = 'tick_key';

/** Generated on first start and kept in Postgres, never sent to the browser. */
async function readOrCreate(name: string, bytes: number): Promise<string> {
  const generated = randomBytes(bytes).toString('hex');
  const rows = await query<{ value: string }>(
    `INSERT INTO app_state (name, value) VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET value = app_state.value
       RETURNING value`,
    [name, generated],
  );
  const stored = rows[0]?.value;
  if (stored === undefined) throw new Error('secret could not be stored');
  return stored;
}

let sessionSigningKey: string | null = null;
let tickKey: string | null = null;

export async function loadSecrets(): Promise<void> {
  sessionSigningKey = await readOrCreate(SESSION_SIGNING_KEY, 32);
  tickKey = await readOrCreate(TICK_KEY, 32);
}

export function getSessionSigningKey(): string {
  if (sessionSigningKey === null) throw new Error('secrets not loaded');
  return sessionSigningKey;
}

export function getTickKey(): string {
  if (tickKey === null) throw new Error('secrets not loaded');
  return tickKey;
}
