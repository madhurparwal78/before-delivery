import { now } from './clock';
import { query, type Queryable } from './db';
import { newToken } from './http';

/** Creates a session for a person and returns the `hs_session` cookie value. */
export async function createSession(personId: string, client?: Queryable): Promise<string> {
  const token = newToken();
  const at = await now(client);
  if (client) await client.query('INSERT INTO sessions (token, person_id, created_at) VALUES ($1, $2, $3)', [token, personId, at]);
  else await query('INSERT INTO sessions (token, person_id, created_at) VALUES ($1, $2, $3)', [token, personId, at]);
  return token;
}
