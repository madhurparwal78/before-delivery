import type { PoolClient } from '../db';
import { query, row, rows } from '../db';
import { apiError } from '../errors';
import { isoSecond } from '../format';

export type ReplicaState = 'pending' | 'settled' | 'failed' | 'superseded';
export type ReplicaError = 'etag_mismatch' | 'region_offline' | 'copy_failed';

export interface ReplicaRecord {
  version_id: string;
  region: string;
  role: string;
  state: string;
  attempts: number;
  settled_at: string | null;
  settle_ms: string | null;
  error: string | null;
  position: number;
}

export function replicaJson(replica: ReplicaRecord): Record<string, unknown> {
  return {
    region: replica.region,
    role: replica.role,
    state: replica.state,
    attempts: replica.attempts,
    settled_at: replica.settled_at ? isoSecond(replica.settled_at) : null,
    settle_ms: replica.settle_ms === null ? null : Number(replica.settle_ms),
    error: replica.error,
  };
}

export async function createReplicas(
  client: PoolClient,
  versionId: string,
  placement: string[],
  acknowledgedAt: Date,
): Promise<void> {
  for (let index = 0; index < placement.length; index += 1) {
    const isOrigin = index === 0;
    await client.query(
      `insert into replicas (version_id, region, role, state, attempts, settled_at, settle_ms, error, position)
       values ($1, $2, $3, $4, 0, $5, $6, null, $7)`,
      [
        versionId,
        placement[index],
        isOrigin ? 'origin' : 'replica',
        isOrigin ? 'settled' : 'pending',
        isOrigin ? acknowledgedAt.toISOString() : null,
        isOrigin ? 0 : null,
        index,
      ],
    );
  }
}

export async function supersedeReplicas(client: PoolClient, versionId: string): Promise<void> {
  await client.query(
    `update replicas set state = 'superseded'
     where version_id = $1 and state in ('pending', 'settled', 'failed')`,
    [versionId],
  );
}

export async function restoreReplicas(client: PoolClient, versionId: string, at: Date): Promise<void> {
  await client.query(
    `update replicas set state = 'settled', settled_at = $2, settle_ms = 0, error = null
     where version_id = $1 and role = 'origin'`,
    [versionId, at.toISOString()],
  );
  await client.query(
    `update replicas set state = 'pending', settled_at = null, settle_ms = null, error = null
     where version_id = $1 and role = 'replica'`,
    [versionId],
  );
}

export async function listReplicas(versionId: string): Promise<ReplicaRecord[]> {
  return query<ReplicaRecord>(
    `select version_id, region, role, state, attempts, settled_at, settle_ms::text as settle_ms, error, position
     from replicas where version_id = $1 order by position`,
    [versionId],
  );
}

/** Manual retry is legal only from failed. */
export async function retryReplica(client: PoolClient, versionId: string, region: string): Promise<ReplicaRecord> {
  const replica = await row<ReplicaRecord>(
    client,
    `select version_id, region, role, state, attempts, settled_at, settle_ms::text as settle_ms, error, position
     from replicas where version_id = $1 and region = $2 for update`,
    [versionId, region],
  );
  if (!replica) throw apiError('not_found');
  if (replica.state !== 'failed') {
    throw apiError('invalid_transition', "That change isn't allowed from the current state.", {
      from: replica.state,
      to: 'pending',
    });
  }
  const updated = await row<ReplicaRecord>(
    client,
    `update replicas set state = 'pending', error = null, settled_at = null, settle_ms = null
     where version_id = $1 and region = $2
     returning version_id, region, role, state, attempts, settled_at, settle_ms::text as settle_ms, error, position`,
    [versionId, region],
  );
  return updated as ReplicaRecord;
}

export async function markSettled(
  client: PoolClient,
  versionId: string,
  region: string,
  settledAt: Date,
  acknowledgedAt: Date,
): Promise<boolean> {
  const settleMs = Math.max(0, Math.floor(settledAt.getTime() - acknowledgedAt.getTime()));
  const updated = await rows<{ region: string }>(
    client,
    `update replicas set state = 'settled', settled_at = $3, settle_ms = $4, error = null
     where version_id = $1 and region = $2 and state = 'pending' returning region`,
    [versionId, region, settledAt.toISOString(), settleMs],
  );
  return updated.length > 0;
}

export async function markFailed(client: PoolClient, versionId: string, region: string, error: ReplicaError): Promise<void> {
  await client.query(
    `update replicas set state = 'failed', error = $3 where version_id = $1 and region = $2 and state = 'pending'`,
    [versionId, region, error],
  );
}

export async function countAttempt(client: PoolClient, versionId: string, region: string): Promise<void> {
  await client.query('update replicas set attempts = attempts + 1 where version_id = $1 and region = $2', [versionId, region]);
}

/** Bringing a region online requeues its region_offline failures of current versions, once. */
export async function requeueRegion(client: PoolClient, region: string): Promise<void> {
  await client.query(
    `update replicas r set state = 'pending', error = null
     from object_versions v
     where r.version_id = v.version_id and r.region = $1 and r.state = 'failed' and r.error = 'region_offline' and v.is_current`,
    [region],
  );
}

export async function readiness(versionId: string): Promise<{ placed: number; settled: number; failed: number; pending: number }> {
  const replicas = await listReplicas(versionId);
  return {
    placed: replicas.length,
    settled: replicas.filter((replica) => replica.state === 'settled').length,
    failed: replicas.filter((replica) => replica.state === 'failed').length,
    pending: replicas.filter((replica) => replica.state === 'pending').length,
  };
}
