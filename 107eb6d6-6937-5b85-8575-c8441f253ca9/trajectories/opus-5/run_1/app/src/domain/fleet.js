import { db, withTransaction } from '../db.js';
import { COPY, FIELD_REASONS, conflict, notFound, validationFailed } from './errors.js';
import { buildDecision, buildTruckId, buildTruckStatus } from './validation.js';
import { assignedActivityNote, releasedActivityNote } from './labels.js';
import { listSubmittedRequests, loadRequest } from './requests.js';

const TRUCK_COLUMNS = 'SELECT id, depot, status, request_id FROM truck_state';

async function lockRequest(client, requestId) {
  const { rows } = await client.query(
    'SELECT id, status, trucks_requested FROM logistics_requests WHERE id = $1 FOR UPDATE',
    [requestId]
  );
  if (!rows[0]) throw notFound();
  return rows[0];
}

async function lockTruck(client, truckId) {
  const locked = await client.query('SELECT id FROM trucks WHERE id = $1 FOR UPDATE', [truckId]);
  if (locked.rowCount === 0) return null;
  const { rows } = await client.query(`${TRUCK_COLUMNS} WHERE id = $1`, [truckId]);
  return rows[0];
}

async function assignedCount(client, requestId) {
  const { rows } = await client.query(
    'SELECT count(*)::int AS count FROM assignments WHERE request_id = $1',
    [requestId]
  );
  return rows[0].count;
}

const writeActivity = (client, { requestId, kind, actorId, note }) =>
  client.query('INSERT INTO activity (request_id, kind, actor_id, note) VALUES ($1, $2, $3, $4)', [
    requestId,
    kind,
    actorId,
    note
  ]);

export async function listTrucks({ status = null } = {}) {
  const { rows } = await db.query(
    `${TRUCK_COLUMNS} WHERE ($1::text IS NULL OR status = $1) ORDER BY id`,
    [status]
  );
  return rows;
}

export async function fleetSummary() {
  const { rows } = await db.query(
    `SELECT count(*) FILTER (WHERE status = 'available')::int AS available,
            count(*) FILTER (WHERE status = 'assigned')::int AS assigned,
            count(*) FILTER (WHERE status = 'maintenance')::int AS maintenance
     FROM truck_state`
  );
  return rows[0];
}

async function boardSummary() {
  const { rows } = await db.query(
    `SELECT
       (SELECT count(*) FROM logistics_requests WHERE status = 'submitted')::int AS waiting,
       (SELECT coalesce(sum(r.trucks_requested -
          (SELECT count(*) FROM assignments a WHERE a.request_id = r.id)), 0)
        FROM logistics_requests r WHERE r.status = 'submitted')::int AS trucks_needed,
       (SELECT count(*) FROM truck_state WHERE status = 'available')::int AS trucks_available`
  );
  return rows[0];
}

export async function dispatchBoard() {
  const [requests, summary] = await Promise.all([listSubmittedRequests(), boardSummary()]);
  return { requests, summary };
}

export async function assignTruck({ member, requestId, body }) {
  return withTransaction(async (client) => {
    const request = await lockRequest(client, requestId);
    const truckId = buildTruckId(body);
    const truck = await lockTruck(client, truckId);
    if (!truck) throw validationFailed({ truck_id: FIELD_REASONS.truckId });
    if (request.status !== 'submitted') throw conflict(COPY.requestDecided);
    if (truck.status !== 'available') throw conflict(COPY.truckUnavailable);
    if ((await assignedCount(client, requestId)) >= request.trucks_requested) {
      throw conflict(COPY.requestFull);
    }

    await client.query(
      'INSERT INTO assignments (truck_id, request_id, assigned_by) VALUES ($1, $2, $3)',
      [truckId, requestId, member.id]
    );
    await client.query("UPDATE trucks SET status = 'assigned', updated_at = now() WHERE id = $1", [truckId]);
    await writeActivity(client, {
      requestId,
      kind: 'truck_assigned',
      actorId: member.id,
      note: assignedActivityNote(truckId)
    });

    return loadRequest({ member, id: requestId, executor: client });
  });
}

async function releaseAssignment(client, { requestId, truckId, actorId }) {
  await client.query('DELETE FROM assignments WHERE truck_id = $1 AND request_id = $2', [truckId, requestId]);
  await client.query("UPDATE trucks SET status = 'available', updated_at = now() WHERE id = $1", [truckId]);
  await writeActivity(client, {
    requestId,
    kind: 'truck_released',
    actorId,
    note: releasedActivityNote(truckId)
  });
}

export async function releaseTruck({ member, requestId, truckId }) {
  return withTransaction(async (client) => {
    const request = await lockRequest(client, requestId);
    const truck = await lockTruck(client, truckId);
    if (!truck) throw notFound();
    if (request.status !== 'submitted') throw conflict(COPY.requestDecided);
    if (truck.request_id !== requestId) throw notFound();

    await releaseAssignment(client, { requestId, truckId, actorId: member.id });
    return loadRequest({ member, id: requestId, executor: client });
  });
}

export async function decideRequest({ member, requestId, body }) {
  return withTransaction(async (client) => {
    const request = await lockRequest(client, requestId);
    const { decision, note } = buildDecision(body);
    if (request.status !== 'submitted') throw conflict(COPY.requestDecided);

    if (decision === 'confirm') {
      if ((await assignedCount(client, requestId)) < request.trucks_requested) {
        throw conflict(COPY.confirmShort);
      }
    } else {
      const held = await client.query(
        `SELECT a.truck_id FROM assignments a
         JOIN trucks t ON t.id = a.truck_id
         WHERE a.request_id = $1 ORDER BY a.truck_id FOR UPDATE OF t`,
        [requestId]
      );
      for (const row of held.rows) {
        await releaseAssignment(client, { requestId, truckId: row.truck_id, actorId: member.id });
      }
    }

    const status = decision === 'confirm' ? 'confirmed' : 'declined';
    await client.query(
      `UPDATE logistics_requests
       SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4
       WHERE id = $1`,
      [requestId, status, member.id, note]
    );
    await writeActivity(client, { requestId, kind: status, actorId: member.id, note });

    return loadRequest({ member, id: requestId, executor: client });
  });
}

export async function setTruckStatus({ truckId, body }) {
  return withTransaction(async (client) => {
    const truck = await lockTruck(client, truckId);
    if (!truck) throw notFound();
    const status = buildTruckStatus(body);
    if (truck.request_id) throw conflict(COPY.truckOnRequest);
    if (truck.status !== status) {
      await client.query('UPDATE trucks SET status = $2, updated_at = now() WHERE id = $1', [truckId, status]);
    }
    const { rows } = await client.query(`${TRUCK_COLUMNS} WHERE id = $1`, [truckId]);
    return rows[0];
  });
}
