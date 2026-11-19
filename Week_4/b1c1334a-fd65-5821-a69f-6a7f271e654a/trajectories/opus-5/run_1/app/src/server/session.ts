import type { Client } from './db.js';
import type { RequestContext } from './http.js';

export type Account = { id: string; email: string; display_name: string };

export async function accountFromRequest(
  client: Client,
  request: RequestContext,
): Promise<Account | null> {
  const token = request.cookies['tf_session'];
  if (token === undefined || token === '') return null;
  const result = await client.query<Account>(
    `select a.id, a.email, a.display_name
     from sessions s join accounts a on a.id = s.account_id
     where s.token = $1`,
    [token],
  );
  return result.rows[0] ?? null;
}
