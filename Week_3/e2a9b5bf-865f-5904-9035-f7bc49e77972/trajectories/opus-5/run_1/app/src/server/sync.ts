import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { parseTimestamp, CLOCK_SKEW_MS } from '../shared/clock.js';
import { hasMarks, isPng, MAX_SKETCH_BYTES, parseStrokeFile } from '../shared/strokes.js';
import type {
  ConflictReport,
  ObservationFieldName,
  Optics,
  SyncResult,
} from '../shared/types.js';
import { pool } from './db.js';
import { ApiError, FieldErrors, notFound, storageUnavailable, ValidationError } from './errors.js';
import { decideField, type FieldEditMap } from './field-resolution.js';
import { readKit } from './kit.js';
import { canonicalJson } from './canonical-json.js';
import {
  editedSinceAnotherDevice,
  listRemovals,
  refusalsForDelete,
  refuseWith,
  removeObjects,
  tombstone,
} from './observation-delete.js';
import { validateFields, validateOptics, type FieldPatch } from './observation-fields.js';
import { returnCitingPacketsToDraft } from './packet-store.js';
import {
  findObservation,
  readSession,
  toObservation,
  toSession,
  type ObservationRow,
  type SessionRow,
} from './records.js';
import { putObject, rasterKey, StorageDown, strokesKey } from './storage.js';
import type { Kit } from '../shared/types.js';

const MAX_CHANGES = 200;

const KINDS = new Set([
  'session.create',
  'session.optics',
  'observation.create',
  'observation.update',
  'sketch.put',
  'observation.delete',
]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Outcome {
  status: number;
  body: unknown;
  conflicts: ConflictReport[];
}

function readEditedAt(value: unknown): Date {
  const parsed = parseTimestamp(value);
  if (!parsed || parsed.getTime() > Date.now() + CLOCK_SKEW_MS) {
    new FieldErrors().add('edited_at').throwIfAny();
  }
  return parsed as Date;
}

function readBaseVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    new FieldErrors().add('base_version').throwIfAny();
  }
  return value as number;
}

function readUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    new FieldErrors().add(field, 'session_id').throwIfAny();
  }
  return value as string;
}

async function loadFieldEdits(
  client: PoolClient,
  observationId: string,
): Promise<FieldEditMap> {
  const found = await client.query<{
    field: ObservationFieldName;
    edited_at: Date;
    device: string;
    set_at_version: number;
  }>(
    'SELECT field, edited_at, device, set_at_version FROM observation_field_edits WHERE observation_id = $1',
    [observationId],
  );
  const edits: FieldEditMap = new Map();
  for (const row of found.rows) {
    edits.set(row.field, {
      edited_at: row.edited_at,
      device: row.device,
      set_at_version: row.set_at_version,
    });
  }
  return edits;
}

async function recordFieldEdit(
  client: PoolClient,
  observationId: string,
  field: ObservationFieldName,
  editedAt: Date,
  device: string,
  version: number,
): Promise<void> {
  await client.query(
    `INSERT INTO observation_field_edits (observation_id, field, edited_at, device, set_at_version)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (observation_id, field) DO UPDATE
       SET edited_at = EXCLUDED.edited_at, device = EXCLUDED.device,
           set_at_version = EXCLUDED.set_at_version`,
    [observationId, field, editedAt, device, version],
  );
}

async function lockObservation(client: PoolClient, observationId: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`observation:${observationId}`]);
}

async function ownedObservationOr404(
  client: PoolClient,
  accountId: string,
  observationId: string,
): Promise<{ deleted: boolean }> {
  const found = await client.query<{ account_id: string; deleted: boolean }>(
    'SELECT account_id, deleted FROM observations WHERE id = $1',
    [observationId],
  );
  const row = found.rows[0];
  if (!row || row.account_id !== accountId) throw notFound();
  return { deleted: row.deleted };
}

async function sessionOr404(
  client: PoolClient,
  accountId: string,
  sessionId: string,
): Promise<SessionRow> {
  return readSession(accountId, sessionId, client);
}

async function observationOr404(
  client: PoolClient,
  accountId: string,
  observationId: string,
): Promise<ObservationRow> {
  const row = await findObservation(accountId, observationId, client);
  if (!row) throw notFound();
  return row;
}

function patchColumns(patch: FieldPatch, applied: Set<ObservationFieldName>): {
  assignments: string[];
  values: unknown[];
} {
  const assignments: string[] = [];
  const values: unknown[] = [];
  const add = (column: string, value: unknown): void => {
    values.push(value);
    assignments.push(`${column} = $${values.length + 2}`);
  };
  if (applied.has('observed_at')) add('observed_at', patch.observed_at ?? null);
  if (applied.has('seeing')) add('seeing', patch.seeing ?? null);
  if (applied.has('transparency_nelm')) add('transparency_nelm', patch.transparency_nelm ?? null);
  if (applied.has('concentration_class')) {
    add('concentration_class', patch.concentration_class ?? null);
  }
  if (applied.has('pair')) add('pair', patch.pair ? JSON.stringify(patch.pair) : null);
  if (applied.has('description')) add('description', patch.description ?? '');
  if (applied.has('optics')) add('optics', JSON.stringify(patch.optics));
  return { assignments, values };
}

async function createSession(
  client: PoolClient,
  accountId: string,
  kit: Kit,
  change: Record<string, unknown>,
): Promise<Outcome> {
  const sessionId = readUuid(change.session_id, 'session_id');
  const siteId = change.site_id;
  const errors = new FieldErrors();
  const startedAt = parseTimestamp(change.started_at);
  if (!startedAt || startedAt.getTime() > Date.now() + CLOCK_SKEW_MS) errors.add('started_at');
  if (typeof siteId !== 'string') errors.add('site_id');
  if (!('optics' in change) || change.optics === null) errors.add('optics');
  errors.throwIfAny();

  const existing = await client.query<{ account_id: string }>(
    'SELECT account_id FROM observing_sessions WHERE id = $1',
    [sessionId],
  );
  const owner = existing.rows[0];
  if (owner) {
    if (owner.account_id !== accountId) throw notFound();
    throw new ApiError(409, 'id_conflict');
  }
  const site = await client.query<{ id: string }>(
    'SELECT id FROM sites WHERE account_id = $1 AND id = $2',
    [accountId, siteId as string],
  );
  if (site.rowCount === 0) throw notFound();
  const optics = validateOptics(kit, change.optics);

  await client.query(
    `INSERT INTO observing_sessions (id, account_id, site_id, started_at, optics)
     VALUES ($1,$2,$3,$4,$5)`,
    [sessionId, accountId, siteId, startedAt, JSON.stringify(optics)],
  );
  const row = await sessionOr404(client, accountId, sessionId);
  return { status: 201, body: toSession(row, kit), conflicts: [] };
}

async function setSessionOptics(
  client: PoolClient,
  accountId: string,
  kit: Kit,
  change: Record<string, unknown>,
): Promise<Outcome> {
  const sessionId = readUuid(change.session_id, 'session_id');
  await sessionOr404(client, accountId, sessionId);
  const optics = validateOptics(kit, change.optics);
  await client.query('UPDATE observing_sessions SET optics = $3 WHERE account_id = $1 AND id = $2', [
    accountId,
    sessionId,
    JSON.stringify(optics),
  ]);
  const row = await sessionOr404(client, accountId, sessionId);
  return { status: 200, body: toSession(row, kit), conflicts: [] };
}

async function createObservation(
  client: PoolClient,
  accountId: string,
  device: string,
  kit: Kit,
  change: Record<string, unknown>,
): Promise<Outcome> {
  const observationId = readUuid(change.observation_id, 'observation_id');
  const sessionId = readUuid(change.session_id, 'session_id');
  const editedAt = readEditedAt(change.edited_at);

  const existing = await client.query<{ account_id: string; deleted: boolean }>(
    'SELECT account_id, deleted FROM observations WHERE id = $1',
    [observationId],
  );
  const owner = existing.rows[0];
  if (owner) {
    if (owner.account_id !== accountId) throw notFound();
    if (owner.deleted) throw new ApiError(409, 'observation_deleted');
    throw new ApiError(409, 'id_conflict');
  }

  const session = await sessionOr404(client, accountId, sessionId);
  const objectId = change.object_id;
  const object = await client.query<{ kind: string }>(
    'SELECT kind FROM catalogue_objects WHERE id = $1',
    [typeof objectId === 'string' ? objectId : ''],
  );
  const kind = object.rows[0]?.kind;
  if (!kind) new FieldErrors().add('object_id').throwIfAny();

  const rawFields = (change.fields ?? {}) as Record<string, unknown>;
  if (typeof rawFields !== 'object' || rawFields === null || Array.isArray(rawFields)) {
    new FieldErrors().add('object_id').throwIfAny();
  }
  const { patch, touched } = validateFields(rawFields, {
    kit,
    kind: kind as ObservationRow['kind'],
    startedAt: session.started_at,
  });
  const optics: Optics = patch.optics ?? session.optics;

  await client.query(
    `INSERT INTO observations (id, account_id, session_id, object_id, observed_at, seeing,
        transparency_nelm, concentration_class, pair, description, optics, version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1)`,
    [
      observationId,
      accountId,
      sessionId,
      objectId,
      patch.observed_at ?? null,
      patch.seeing ?? null,
      patch.transparency_nelm ?? null,
      patch.concentration_class ?? null,
      patch.pair ? JSON.stringify(patch.pair) : null,
      patch.description ?? '',
      JSON.stringify(optics),
    ],
  );
  const fieldsToStamp = new Set<ObservationFieldName>([...touched, 'optics']);
  for (const field of fieldsToStamp) {
    await recordFieldEdit(client, observationId, field, editedAt, device, 1);
  }
  const row = await observationOr404(client, accountId, observationId);
  return { status: 201, body: toObservation(row, kit), conflicts: [] };
}

async function updateObservation(
  client: PoolClient,
  accountId: string,
  device: string,
  kit: Kit,
  change: Record<string, unknown>,
): Promise<Outcome> {
  const observationId = readUuid(change.observation_id, 'observation_id');
  const state = await ownedObservationOr404(client, accountId, observationId);
  if (state.deleted) throw new ApiError(409, 'observation_deleted');
  const baseVersion = readBaseVersion(change.base_version);
  const editedAt = readEditedAt(change.edited_at);

  await lockObservation(client, observationId);
  const row = await observationOr404(client, accountId, observationId);
  const rawFields = (change.fields ?? {}) as Record<string, unknown>;
  const { patch, touched } = validateFields(rawFields, {
    kit,
    kind: row.kind,
    startedAt: row.started_at,
  });

  const edits = await loadFieldEdits(client, observationId);
  const applied = new Set<ObservationFieldName>();
  const conflicts: ConflictReport[] = [];
  for (const field of touched) {
    const decision = decideField(field, editedAt, device, edits.get(field), baseVersion);
    if (decision.apply) applied.add(field);
    if (decision.conflict) conflicts.push(decision.conflict);
  }

  if (applied.size > 0) {
    const nextVersion = row.version + 1;
    const { assignments, values } = patchColumns(patch, applied);
    await client.query(
      `UPDATE observations SET ${assignments.join(', ')}, version = $${values.length + 3}
       WHERE account_id = $1 AND id = $2`,
      [accountId, observationId, ...values, nextVersion],
    );
    for (const field of applied) {
      await recordFieldEdit(client, observationId, field, editedAt, device, nextVersion);
    }
    await returnCitingPacketsToDraft(client, accountId, observationId);
  }

  const fresh = await observationOr404(client, accountId, observationId);
  return { status: 200, body: toObservation(fresh, kit), conflicts };
}

async function putSketch(
  client: PoolClient,
  accountId: string,
  device: string,
  kit: Kit,
  change: Record<string, unknown>,
): Promise<Outcome> {
  const observationId = readUuid(change.observation_id, 'observation_id');
  const state = await ownedObservationOr404(client, accountId, observationId);
  if (state.deleted) throw new ApiError(409, 'observation_deleted');
  const baseVersion = readBaseVersion(change.base_version);
  const editedAt = readEditedAt(change.edited_at);

  const errors = new FieldErrors();
  const text = change.strokes;
  const strokeBytes = typeof text === 'string' ? Buffer.from(text, 'utf8') : null;
  const file = typeof text === 'string' ? parseStrokeFile(text) : null;
  if (!strokeBytes || !file || strokeBytes.byteLength > MAX_SKETCH_BYTES) errors.add('strokes');
  let rasterBytes: Buffer | null = null;
  const raster = change.raster_png_base64;
  if (raster !== null && raster !== undefined) {
    if (typeof raster !== 'string') errors.add('raster');
    else {
      const decoded = Buffer.from(raster, 'base64');
      if (decoded.byteLength === 0 || decoded.byteLength > MAX_SKETCH_BYTES || !isPng(decoded)) {
        errors.add('raster');
      } else rasterBytes = decoded;
    }
  }
  errors.throwIfAny();

  await lockObservation(client, observationId);
  const row = await observationOr404(client, accountId, observationId);
  const edits = await loadFieldEdits(client, observationId);
  const decision = decideField('sketch', editedAt, device, edits.get('sketch'), baseVersion);
  if (!decision.apply) {
    // Discarded at field resolution: this answers 200 without contacting storage.
    return {
      status: 200,
      body: toObservation(row, kit),
      conflicts: decision.conflict ? [decision.conflict] : [],
    };
  }

  const bytes = strokeBytes as Buffer;
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  try {
    await putObject(strokesKey(accountId, observationId, sha256), bytes, 'application/json');
    if (rasterBytes) {
      const rasterSha = createHash('sha256').update(rasterBytes).digest('hex');
      await putObject(rasterKey(accountId, observationId, rasterSha), rasterBytes, 'image/png');
      await client.query('UPDATE observations SET raster_sha256 = $3 WHERE account_id = $1 AND id = $2', [
        accountId,
        observationId,
        rasterSha,
      ]);
    } else {
      await client.query('UPDATE observations SET raster_sha256 = NULL WHERE account_id = $1 AND id = $2', [
        accountId,
        observationId,
      ]);
    }
  } catch (error) {
    if (error instanceof StorageDown) throw storageUnavailable();
    throw error;
  }

  const nextVersion = row.version + 1;
  await client.query(
    `UPDATE observations SET strokes_sha256 = $3, strokes_size = $4, strokes_has_marks = $5,
       version = $6 WHERE account_id = $1 AND id = $2`,
    [
      accountId,
      observationId,
      sha256,
      bytes.byteLength,
      hasMarks(file as NonNullable<typeof file>),
      nextVersion,
    ],
  );
  await recordFieldEdit(client, observationId, 'sketch', editedAt, device, nextVersion);
  await returnCitingPacketsToDraft(client, accountId, observationId);

  const fresh = await observationOr404(client, accountId, observationId);
  return {
    status: 200,
    body: toObservation(fresh, kit),
    conflicts: decision.conflict ? [decision.conflict] : [],
  };
}

interface DeleteSideEffect {
  keys: string[];
  prefixes: string[];
}

async function deleteObservation(
  client: PoolClient,
  accountId: string,
  device: string,
  kit: Kit,
  change: Record<string, unknown>,
  sideEffect: { value: DeleteSideEffect | null },
): Promise<Outcome> {
  const observationId = readUuid(change.observation_id, 'observation_id');
  const state = await ownedObservationOr404(client, accountId, observationId);
  if (state.deleted) {
    return { status: 200, body: { id: observationId, deleted: true }, conflicts: [] };
  }
  const baseVersion = readBaseVersion(change.base_version);

  await lockObservation(client, observationId);
  const row = await observationOr404(client, accountId, observationId);
  const refusal = await refusalsForDelete(client, accountId, observationId);
  if (refusal) throw refuseWith(refusal, toObservation(row, kit));

  const edits = await loadFieldEdits(client, observationId);
  if (editedSinceAnotherDevice(edits, device, baseVersion)) {
    throw refuseWith('edited_since', toObservation(row, kit));
  }

  let removals;
  try {
    removals = await listRemovals(client, accountId, observationId);
  } catch (error) {
    if (error instanceof StorageDown) throw storageUnavailable();
    throw error;
  }
  await tombstone(client, accountId, observationId, removals.packetIds);
  sideEffect.value = {
    keys: removals.prefixes,
    prefixes: [
      ...removals.packetIds.map((id) => `observers/${accountId}/packets/${id}/`),
      `observers/${accountId}/strokes/${observationId}/`,
      `observers/${accountId}/rasters/${observationId}/`,
    ],
  };
  return { status: 200, body: { id: observationId, deleted: true }, conflicts: [] };
}

function payloadOf(change: Record<string, unknown>): Record<string, unknown> {
  const { client_op_id: _ignored, ...rest } = change;
  return rest;
}

interface StoredResult {
  status: number;
  body: unknown;
  conflicts: ConflictReport[];
  payload: unknown;
}

async function readStoredResult(
  client: PoolClient,
  accountId: string,
  clientOpId: string,
): Promise<StoredResult | null> {
  const found = await client.query<StoredResult>(
    'SELECT status, body, conflicts, payload FROM sync_results WHERE account_id = $1 AND client_op_id = $2',
    [accountId, clientOpId],
  );
  return found.rows[0] ?? null;
}

async function storeResult(
  client: PoolClient,
  accountId: string,
  clientOpId: string,
  payload: unknown,
  outcome: Outcome,
): Promise<void> {
  await client.query(
    `INSERT INTO sync_results (account_id, client_op_id, payload, status, body, conflicts)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
    [
      accountId,
      clientOpId,
      JSON.stringify(payload),
      outcome.status,
      JSON.stringify(outcome.body),
      JSON.stringify(outcome.conflicts),
    ],
  );
}

async function applyOne(
  client: PoolClient,
  accountId: string,
  device: string,
  kit: Kit,
  change: Record<string, unknown>,
  sideEffect: { value: DeleteSideEffect | null },
): Promise<Outcome> {
  switch (change.kind) {
    case 'session.create':
      return createSession(client, accountId, kit, change);
    case 'session.optics':
      return setSessionOptics(client, accountId, kit, change);
    case 'observation.create':
      return createObservation(client, accountId, device, kit, change);
    case 'observation.update':
      return updateObservation(client, accountId, device, kit, change);
    case 'sketch.put':
      return putSketch(client, accountId, device, kit, change);
    case 'observation.delete':
      return deleteObservation(client, accountId, device, kit, change, sideEffect);
    default:
      throw new ValidationError({ kind: 'Choose a change kind.' });
  }
}

async function runChange(
  accountId: string,
  device: string,
  kit: Kit,
  change: Record<string, unknown>,
): Promise<SyncResult> {
  const clientOpId = change.client_op_id as string;
  const payload = payloadOf(change);
  const client = await pool.connect();
  const opKey = `op:${accountId}:${clientOpId}`;
  const sideEffect: { value: DeleteSideEffect | null } = { value: null };
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [opKey]);
    const stored = await readStoredResult(client, accountId, clientOpId);
    if (stored) {
      if (canonicalJson(stored.payload) === canonicalJson(payload)) {
        return {
          client_op_id: clientOpId,
          status: stored.status,
          replayed: true,
          body: stored.body,
          conflicts: stored.conflicts,
        };
      }
      return {
        client_op_id: clientOpId,
        status: 409,
        replayed: false,
        body: { error: 'op_conflict' },
        conflicts: [],
      };
    }

    let outcome: Outcome;
    try {
      await client.query('BEGIN');
      outcome = await applyOne(client, accountId, device, kit, change, sideEffect);
      await storeResult(client, accountId, clientOpId, payload, outcome);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (!(error instanceof ApiError)) throw error;
      if (error.status === 503 || error.status >= 500) {
        return {
          client_op_id: clientOpId,
          status: error.status,
          replayed: false,
          body: error.body(),
          conflicts: [],
        };
      }
      const failure: Outcome = { status: error.status, body: error.body(), conflicts: [] };
      await storeResult(client, accountId, clientOpId, payload, failure);
      return {
        client_op_id: clientOpId,
        status: failure.status,
        replayed: false,
        body: failure.body,
        conflicts: [],
      };
    }

    if (sideEffect.value) {
      await removeObjects(sideEffect.value.keys, sideEffect.value.prefixes);
    }
    return {
      client_op_id: clientOpId,
      status: outcome.status,
      replayed: false,
      body: outcome.body,
      conflicts: outcome.conflicts,
    };
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [opKey]).catch(() => undefined);
    client.release();
  }
}

export async function applySync(
  accountId: string,
  body: Record<string, unknown>,
): Promise<{ results: SyncResult[] }> {
  const device = body.device;
  const changes = body.changes;
  const errors = new FieldErrors();
  if (typeof device !== 'string' || device.length < 1 || device.length > 40) errors.add('device');
  if (!Array.isArray(changes) || changes.length < 1 || changes.length > MAX_CHANGES) {
    errors.add('changes');
  }
  errors.throwIfAny();

  const list = changes as unknown[];
  for (const entry of list) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      Array.isArray(entry) ||
      typeof (entry as Record<string, unknown>).client_op_id !== 'string' ||
      !UUID_PATTERN.test((entry as Record<string, unknown>).client_op_id as string) ||
      !KINDS.has((entry as Record<string, unknown>).kind as string)
    ) {
      new FieldErrors().add('changes').throwIfAny();
    }
  }

  const kit = await readKit(accountId);
  const results: SyncResult[] = [];
  for (const entry of list) {
    const change = entry as Record<string, unknown>;
    try {
      results.push(await runChange(accountId, device as string, kit, change));
    } catch {
      results.push({
        client_op_id: change.client_op_id as string,
        status: 500,
        replayed: false,
        body: { error: 'internal' },
        conflicts: [],
      });
    }
  }
  return { results };
}
