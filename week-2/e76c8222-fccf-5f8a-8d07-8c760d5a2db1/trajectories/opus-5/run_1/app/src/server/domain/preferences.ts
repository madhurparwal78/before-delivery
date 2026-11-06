import { UserSummary } from '../../shared/types';
import { Db, pool, query, withTransaction } from '../db/pool';
import { validationFailed } from '../http/errors';
import { writeAudit } from './audit';

export interface PreferenceLists {
  preferred: string[];
  blocked: string[];
}

export async function listInterpreters(db: Db): Promise<UserSummary[]> {
  return query<UserSummary>(
    db,
    `select id, name from users where role = 'interpreter' order by name`,
  );
}

export async function preferencesOf(db: Db, consumerId: string): Promise<PreferenceLists> {
  const rows = await query<{ interpreter_id: string; kind: 'preferred' | 'blocked' }>(
    db,
    'select interpreter_id, kind from consumer_preferences where consumer_id = $1',
    [consumerId],
  );
  return {
    preferred: rows.filter((row) => row.kind === 'preferred').map((row) => row.interpreter_id),
    blocked: rows.filter((row) => row.kind === 'blocked').map((row) => row.interpreter_id),
  };
}

/** Saving replaces both lists; blocks apply to every later dry-run and pin. */
export async function savePreferences(
  consumerId: string,
  lists: PreferenceLists,
): Promise<PreferenceLists> {
  const both = lists.preferred.filter((id) => lists.blocked.includes(id));
  if (both.length > 0) {
    throw validationFailed({ blocked: 'An interpreter cannot be both preferred and blocked.' });
  }
  const ids = [...new Set([...lists.preferred, ...lists.blocked])];
  if (ids.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) {
    throw validationFailed({ preferred: 'That is not a known interpreter.' });
  }
  const known = await query<{ id: string }>(
    pool,
    `select id from users where role = 'interpreter' and id = any($1::uuid[])`,
    [ids],
  );
  if (known.length !== ids.length) {
    throw validationFailed({ preferred: 'That is not a known interpreter.' });
  }

  return withTransaction(async (client) => {
    await client.query('delete from consumer_preferences where consumer_id = $1', [consumerId]);
    for (const interpreterId of lists.preferred) {
      await client.query(
        `insert into consumer_preferences (consumer_id, interpreter_id, kind)
         values ($1, $2, 'preferred')`,
        [consumerId, interpreterId],
      );
    }
    for (const interpreterId of lists.blocked) {
      await client.query(
        `insert into consumer_preferences (consumer_id, interpreter_id, kind)
         values ($1, $2, 'blocked')`,
        [consumerId, interpreterId],
      );
    }
    await writeAudit(client, {
      actorId: consumerId,
      action: 'preferences.updated',
      entity: 'preferences',
      entityId: consumerId,
      requestId: null,
      detail: { preferred: lists.preferred, blocked: lists.blocked },
    });
    return lists;
  });
}
