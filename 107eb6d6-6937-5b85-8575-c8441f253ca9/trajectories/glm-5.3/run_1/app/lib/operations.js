'use strict';

const {
  DECIDED_CONFLICT, TRUCK_UNAVAILABLE_CONFLICT, FULL_REQUEST_CONFLICT,
  TRUCK_ON_REQUEST_CONFLICT, EARLY_CONFIRM_CONFLICT, LAST_ADMIN_CONFLICT,
} = require('./domain');
const { writeTransaction } = require('./db');

class ConflictError extends Error {
  constructor(message) { super(message); this.name = 'ConflictError'; }
}

// Ids run one higher than the highest stored id, consecutive with no gaps, and a
// refused post uses none. The write transaction serializes every id assignment.
async function withRequestId(client) {
  const { rows } = await client.query("SELECT max(substring(id from 4 for 4)::int) AS max_num FROM logistics_requests");
  const next = (rows[0].max_num || 0) + 1;
  return `LR-${String(next).padStart(4, '0')}`;
}

async function insertActivity(client, requestId, kind, actorId, note) {
  await client.query(
    'INSERT INTO activity (request_id, kind, actor_id, note) VALUES ($1,$2,$3,$4)',
    [requestId, kind, actorId, note],
  );
}

async function submitRequest(store, member, draft) {
  return writeTransaction(async (client) => {
    if (draft.draft_id) {
      const { rows } = await client.query(
        'SELECT * FROM logistics_requests WHERE requester_id = $1 AND draft_id = $2',
        [member.id, draft.draft_id],
      );
      if (rows[0]) {
        const full = await store.readRequest(client, member, rows[0].id);
        return { status: 200, request: full };
      }
    }
    const id = await withRequestId(client);
    await client.query(
      `INSERT INTO logistics_requests (id, tour_name, transport_type, trucks_requested, notes, requester_id, status, draft_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,'submitted',$7, now())`,
      [id, draft.tour_name, draft.transport_type, draft.trucks_requested, draft.notes, member.id, draft.draft_id],
    );
    for (const [kind, stop] of Object.entries(draft.stops)) {
      await client.query(
        `INSERT INTO stops (request_id, kind, date, address, city, region, postal_code, country)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, kind, stop.date, stop.address, stop.city, stop.region, stop.postal_code, stop.country],
      );
    }
    const note = draft.trucks_requested === 1 ? 'Requested 1 truck' : `Requested ${draft.trucks_requested} trucks`;
    await insertActivity(client, id, 'submitted', member.id, note);
    const request = await store.readRequest(client, member, id);
    return { status: 201, request };
  });
}

async function assignTruck(store, member, requestId, truckId) {
  return writeTransaction(async (client) => {
    const { rows: requestRows } = await client.query(
      'SELECT * FROM logistics_requests WHERE id = $1', [requestId],
    );
    const request = requestRows[0];
    if (!request) return { notFound: true };
    if (request.status !== 'submitted') throw new ConflictError(DECIDED_CONFLICT);
    const { rows: truckRows } = await client.query('SELECT * FROM trucks WHERE id = $1', [truckId]);
    const truck = truckRows[0];
    if (!truck) return { validation: { truck_id: 'Choose a truck from the fleet.' } };
    if (truck.status !== 'available') throw new ConflictError(TRUCK_UNAVAILABLE_CONFLICT);
    const { rows: countRows } = await client.query(
      'SELECT count(*) AS n, r.trucks_requested FROM assignments a JOIN logistics_requests r ON r.id = a.request_id WHERE a.request_id = $1 GROUP BY r.trucks_requested',
      [requestId],
    );
    const assigned = Number(countRows[0] ? countRows[0].n : 0);
    if (assigned >= request.trucks_requested) throw new ConflictError(FULL_REQUEST_CONFLICT);
    await client.query(
      'INSERT INTO assignments (request_id, truck_id, assigned_by) VALUES ($1,$2,$3)',
      [requestId, truckId, member.id],
    );
    await client.query("UPDATE trucks SET status = 'assigned', updated_at = now() WHERE id = $1", [truckId]);
    await insertActivity(client, requestId, 'truck_assigned', member.id, `${truckId} assigned`);
    return { status: 201, request: await store.readRequest(client, member, requestId) };
  });
}

async function releaseTruck(store, member, requestId, truckId) {
  return writeTransaction(async (client) => {
    const { rows: requestRows } = await client.query('SELECT * FROM logistics_requests WHERE id = $1', [requestId]);
    const request = requestRows[0];
    if (!request) return { notFound: true };
    const { rows: truckRows } = await client.query('SELECT * FROM trucks WHERE id = $1', [truckId]);
    const truck = truckRows[0];
    if (!truck) return { notFound: true };
    if (request.status !== 'submitted') throw new ConflictError(DECIDED_CONFLICT);
    const { rows: assignmentRows } = await client.query(
      'SELECT * FROM assignments WHERE request_id = $1 AND truck_id = $2', [requestId, truckId],
    );
    if (assignmentRows.length === 0) return { notFound: true };
    await client.query('DELETE FROM assignments WHERE request_id = $1 AND truck_id = $2', [requestId, truckId]);
    await client.query("UPDATE trucks SET status = 'available', updated_at = now() WHERE id = $1", [truckId]);
    await insertActivity(client, requestId, 'truck_released', member.id, `${truckId} released`);
    return { status: 204 };
  });
}

async function decideRequest(store, member, requestId, decision) {
  return writeTransaction(async (client) => {
    const { rows: requestRows } = await client.query('SELECT * FROM logistics_requests WHERE id = $1', [requestId]);
    const request = requestRows[0];
    if (!request) return { notFound: true };
    if (request.status !== 'submitted') throw new ConflictError(DECIDED_CONFLICT);
    const { rows: assignmentRows } = await client.query(
      'SELECT truck_id FROM assignments WHERE request_id = $1 ORDER BY truck_id', [requestId],
    );
    if (decision.decision === 'confirm' && assignmentRows.length < request.trucks_requested) {
      throw new ConflictError(EARLY_CONFIRM_CONFLICT);
    }
    if (decision.decision === 'decline') {
      for (const row of assignmentRows) {
        await client.query('DELETE FROM assignments WHERE request_id = $1 AND truck_id = $2', [requestId, row.truck_id]);
        await client.query("UPDATE trucks SET status = 'available', updated_at = now() WHERE id = $1", [row.truck_id]);
        await insertActivity(client, requestId, 'truck_released', member.id, `${row.truck_id} released`);
      }
    }
    await client.query(
      `UPDATE logistics_requests SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4 WHERE id = $1`,
      [requestId, decision.decision === 'confirm' ? 'confirmed' : 'declined', member.id, decision.note],
    );
    await insertActivity(client, requestId, decision.decision === 'confirm' ? 'confirmed' : 'declined', member.id, decision.note);
    return { status: 200, request: await store.readRequest(client, member, requestId) };
  });
}

async function setTruckStatus(store, member, truckId, status) {
  return writeTransaction(async (client) => {
    const { rows: truckRows } = await client.query('SELECT * FROM trucks WHERE id = $1', [truckId]);
    const truck = truckRows[0];
    if (!truck) return { notFound: true };
    const { rows: assignmentRows } = await client.query('SELECT * FROM assignments WHERE truck_id = $1', [truckId]);
    if (assignmentRows.length > 0) throw new ConflictError(TRUCK_ON_REQUEST_CONFLICT);
    await client.query('UPDATE trucks SET status = $2, updated_at = now() WHERE id = $1', [truckId, status]);
    const { rows } = await client.query(
      `SELECT t.id, t.depot, t.status, (SELECT a.request_id FROM assignments a WHERE a.truck_id = t.id) AS request_id FROM trucks t WHERE t.id = $1`,
      [truckId],
    );
    return { status: 200, truck: { id: rows[0].id, depot: rows[0].depot, status: rows[0].status, request_id: rows[0].request_id || null } };
  });
}

async function setMemberRole(store, member, memberId, role) {
  return writeTransaction(async (client) => {
    const { rows: memberRows } = await client.query('SELECT * FROM members WHERE id = $1', [memberId]);
    const target = memberRows[0];
    if (!target) return { notFound: true };
    const { rows: adminRows } = await client.query("SELECT count(*) AS n FROM members WHERE role = 'admin'");
    const adminsBefore = Number(adminRows[0].n);
    if (target.role === 'admin' && role !== 'admin' && adminsBefore <= 1) {
      throw new ConflictError(LAST_ADMIN_CONFLICT);
    }
    await client.query('UPDATE members SET role = $2 WHERE id = $1', [memberId, role]);
    const { rows } = await client.query('SELECT id, name, email, role FROM members WHERE id = $1', [memberId]);
    return { status: 200, member: rows[0] };
  });
}

module.exports = {
  submitRequest, assignTruck, releaseTruck, decideRequest, setTruckStatus,
  setMemberRole, ConflictError,
};
