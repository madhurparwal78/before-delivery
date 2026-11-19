import pg from 'pg';
import { newId } from '../domain/id.js';
import { toInstant, now } from '../domain/time.js';

export interface ActorRef { id: string; name: string; }

export async function recordLedger(
  client: pg.PoolClient,
  actor: ActorRef | null,
  action: string,
  fileId: string | null,
  folderId: string | null,
  detail: Record<string, unknown>,
): Promise<void> {
  await client.query(
    'INSERT INTO ledger (id, at, actor_id, actor_name, action, file_id, folder_id, detail) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [newId('led'), toInstant(now()), actor?.id ?? null, actor?.name ?? null, action, fileId, folderId, JSON.stringify(detail)],
  );
}
