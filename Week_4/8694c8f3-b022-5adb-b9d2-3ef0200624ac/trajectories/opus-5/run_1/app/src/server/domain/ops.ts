import { pool, withTransaction } from '../db.js';
import { ApiError, fieldError } from '../errors.js';
import { asInteger, asRecord, asString, deepEqual } from '../input.js';
import type { Membership } from '../access.js';
import { collabHealthy, dropLeaseQuietly, readLease } from '../collab.js';
import { emit } from '../events.js';
import { writeActivity } from './activitylog.js';
import { loadSetRow } from './document.js';
import { isOpType, NO_BASE_VERSION, targetKindFor, type OpType } from './optypes.js';
import type { Applied, ApplyContext } from './version.js';
import {
  applyKeyRemove,
  applyKeySet,
  applyLayerAdd,
  applyLayerRemove,
  applyLayerReparent,
  applyLayerSet,
  applyShaderRestore,
  applyShaderSave,
} from './applylayer.js';
import {
  applyGraphNodeAdd,
  applyGraphNodeRemove,
  applyGraphNodeUpdate,
  applyGraphWireAdd,
  applyGraphWireRemove,
  applyScriptAdd,
  applyScriptRemove,
  applyScriptSave,
  applySetUpdate,
} from './applyother.js';
import type { OpDoc, OpResult } from '../../shared/types.js';

const APPLIERS: Record<OpType, (ctx: ApplyContext) => Promise<Applied>> = {
  'layer.add': applyLayerAdd,
  'layer.set': applyLayerSet,
  'layer.reparent': applyLayerReparent,
  'layer.remove': applyLayerRemove,
  'shader.save': applyShaderSave,
  'shader.restore': applyShaderRestore,
  'key.set': applyKeySet,
  'key.remove': applyKeyRemove,
  'set.update': applySetUpdate,
  'graph.node.add': applyGraphNodeAdd,
  'graph.node.update': applyGraphNodeUpdate,
  'graph.node.remove': applyGraphNodeRemove,
  'graph.wire.add': applyGraphWireAdd,
  'graph.wire.remove': applyGraphWireRemove,
  'script.add': applyScriptAdd,
  'script.save': applyScriptSave,
  'script.remove': applyScriptRemove,
};

export interface OpEnvelope {
  clientOpId: string;
  target: string;
  baseVersion: number | null;
  type: OpType;
  payload: Record<string, unknown>;
}

/** Reads the op envelope from a request body. */
export function readEnvelope(body: Record<string, unknown>): OpEnvelope {
  const clientOpId = asString(body['client_op_id']) ?? '';
  if (clientOpId.length < 8 || clientOpId.length > 64) {
    throw fieldError('client_op_id', 'Client op id must be 8 to 64 characters');
  }
  const typeText = asString(body['type']) ?? '';
  if (!isOpType(typeText)) throw fieldError('type', 'Unknown op type');
  const target = asString(body['target']) ?? '';
  if (target.length === 0) throw fieldError('target', 'An op needs a target');
  const payload = asRecord(body['payload']);
  if (payload === null) throw fieldError('payload', 'An op needs a payload object');
  const needsBase = !NO_BASE_VERSION.includes(typeText);
  let baseVersion: number | null = null;
  if (body['base_version'] !== undefined && body['base_version'] !== null) {
    baseVersion = asInteger(body['base_version']);
    if (baseVersion === null || baseVersion < 1) throw fieldError('base_version', 'Base version must be a version number');
  }
  if (needsBase && baseVersion === null) throw fieldError('base_version', 'Base version is required');
  return { clientOpId, target, baseVersion: needsBase ? baseVersion : null, type: typeText, payload };
}

interface StoredOp {
  target: string;
  type: string;
  payload: Record<string, unknown>;
  base_version: number | null;
  response: OpResult;
}

async function findStoredOp(setId: string, clientOpId: string): Promise<StoredOp | null> {
  const result = await pool.query<StoredOp>(
    `select target, type, payload, base_version, response from ops where set_id = $1 and client_op_id = $2`,
    [setId, clientOpId],
  );
  return result.rows[0] ?? null;
}

/** A replayed client op id returns the original response; a reused id with any difference is refused. */
function replayOrRefuse(stored: StoredOp, envelope: OpEnvelope): OpResult {
  const same =
    stored.target === envelope.target &&
    stored.type === envelope.type &&
    stored.base_version === envelope.baseVersion &&
    deepEqual(stored.payload, envelope.payload);
  if (!same) throw new ApiError(409, 'op_id_reused', 'That client op id was used for a different op');
  return { ...stored.response, replayed: true };
}

async function assertLayerUnlocked(setId: string, layerId: string, userId: string): Promise<void> {
  if (!collabHealthy()) return;
  let holderId: string | null = null;
  let expiresAt: Date | null = null;
  try {
    const lease = await readLease(setId, layerId);
    if (lease === null || lease.userId === userId) return;
    holderId = lease.userId;
    expiresAt = lease.expiresAt;
  } catch {
    return;
  }
  const holder = await pool.query<{ user_id: string; display_name: string }>(
    `select id as user_id, display_name from users where id = $1`,
    [holderId],
  );
  const row = holder.rows[0];
  throw new ApiError(423, 'layer_locked', 'Another editor holds the lock on this layer', {
    holder: row ?? { user_id: holderId, display_name: 'Another editor' },
    expires_at: expiresAt?.toISOString() ?? null,
  });
}

/**
 * Commits one op: the op row, its gapless sequence number and its target's version bump
 * share a single transaction.
 */
export async function commitOp(membership: Membership, envelope: OpEnvelope): Promise<OpResult> {
  const { setId, user } = membership;

  const stored = await findStoredOp(setId, envelope.clientOpId);
  if (stored !== null) return replayOrRefuse(stored, envelope);

  if (targetKindFor(envelope.type) === 'layer' && envelope.type !== 'layer.add') {
    await assertLayerUnlocked(setId, envelope.target, user.id);
  }

  type Outcome =
    | { replay: OpResult }
    | { response: OpResult; doc: OpDoc; freedLayers: string[] };
  const outcome = await withTransaction<Outcome>(async (client) => {
    await client.query(`select id from sets where id = $1 for update`, [setId]);
    const inTransaction = await client.query<StoredOp>(
      `select target, type, payload, base_version, response from ops where set_id = $1 and client_op_id = $2`,
      [setId, envelope.clientOpId],
    );
    const prior = inTransaction.rows[0];
    if (prior !== undefined) return { replay: replayOrRefuse(prior, envelope) };

    const setRow = await loadSetRow(client, setId);
    const ctx: ApplyContext = {
      client,
      setId,
      user,
      setRow,
      target: envelope.target,
      payload: envelope.payload,
      baseVersion: envelope.baseVersion,
    };
    const applied = await APPLIERS[envelope.type](ctx);
    const seq = setRow.head + 1;
    await client.query(`update sets set head = $2 where id = $1`, [setId, seq]);
    const response: OpResult = { seq, target: envelope.target, version: applied.version, replayed: false };
    const inserted = await client.query<{ committed_at: Date }>(
      `insert into ops (set_id, seq, client_op_id, actor_id, target, type, payload, base_version, response)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning committed_at`,
      [
        setId,
        seq,
        envelope.clientOpId,
        user.id,
        envelope.target,
        envelope.type,
        JSON.stringify(envelope.payload),
        envelope.baseVersion,
        JSON.stringify(response),
      ],
    );
    await writeActivity(client, setId, user.id, envelope.type, envelope.target, applied.summary);
    const doc: OpDoc = {
      seq,
      client_op_id: envelope.clientOpId,
      actor: { user_id: user.id, display_name: user.display_name },
      target: envelope.target,
      type: envelope.type,
      payload: envelope.payload,
      committed_at: (inserted.rows[0]?.committed_at ?? new Date()).toISOString(),
    };
    return { response, doc, freedLayers: applied.freedLayers ?? [] };
  });

  if ('replay' in outcome) return outcome.replay;
  for (const layerId of outcome.freedLayers) await dropLeaseQuietly(setId, layerId);
  emit(setId, { event: 'op', id: outcome.doc.seq, data: outcome.doc });
  return outcome.response;
}

export async function readOps(setId: string, after: number, limit: number): Promise<OpDoc[]> {
  const result = await pool.query<{
    seq: number;
    client_op_id: string;
    user_id: string;
    display_name: string;
    target: string;
    type: string;
    payload: Record<string, unknown>;
    committed_at: Date;
  }>(
    `select o.seq, o.client_op_id, u.id as user_id, u.display_name, o.target, o.type, o.payload, o.committed_at
       from ops o join users u on u.id = o.actor_id
      where o.set_id = $1 and o.seq > $2
      order by o.seq asc limit $3`,
    [setId, after, limit],
  );
  return result.rows.map((row) => ({
    seq: row.seq,
    client_op_id: row.client_op_id,
    actor: { user_id: row.user_id, display_name: row.display_name },
    target: row.target,
    type: row.type,
    payload: row.payload,
    committed_at: row.committed_at.toISOString(),
  }));
}
