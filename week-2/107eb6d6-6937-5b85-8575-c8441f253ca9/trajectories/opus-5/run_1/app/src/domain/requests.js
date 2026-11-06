import { db, withTransaction } from '../db.js';
import { badRequest, COPY, notFound } from './errors.js';
import { canDispatch } from './roles.js';
import { STOP_KINDS, submittedActivityNote } from './labels.js';
import { buildNewRequest, parseDraftId } from './validation.js';

const REQUEST_ID_LOCK = 915231002;

const LIST_COLUMNS = `
  SELECT r.id, r.tour_name, r.transport_type, r.trucks_requested, r.status, r.created_at,
         m.id AS requester_id, m.name AS requester_name,
         (SELECT count(*) FROM assignments a WHERE a.request_id = r.id)::int AS trucks_assigned,
         (SELECT s.date FROM stops s WHERE s.request_id = r.id AND s.kind = 'first_show') AS first_show_date
  FROM logistics_requests r
  JOIN members m ON m.id = r.requester_id`;

const DETAIL_COLUMNS = `
  SELECT r.id, r.tour_name, r.transport_type, r.trucks_requested, r.status, r.created_at,
         r.notes, r.decided_at, r.decision_note,
         m.id AS requester_id, m.name AS requester_name,
         d.id AS decided_by_id, d.name AS decided_by_name,
         (SELECT count(*) FROM assignments a WHERE a.request_id = r.id)::int AS trucks_assigned,
         (SELECT s.date FROM stops s WHERE s.request_id = r.id AND s.kind = 'first_show') AS first_show_date
  FROM logistics_requests r
  JOIN members m ON m.id = r.requester_id
  LEFT JOIN members d ON d.id = r.decided_by`;

/** The one ownership filter: tour managers only ever reach their own requests. */
function ownershipClause(member, params) {
  if (canDispatch(member)) return '';
  params.push(member.id);
  return ` AND r.requester_id = $${params.length}`;
}

const toListItem = (row) => ({
  id: row.id,
  tour_name: row.tour_name,
  transport_type: row.transport_type,
  trucks_requested: row.trucks_requested,
  trucks_assigned: row.trucks_assigned,
  status: row.status,
  requester: { id: row.requester_id, name: row.requester_name },
  first_show_date: row.first_show_date ?? null,
  created_at: row.created_at.toISOString()
});

const encodeCursor = (row) => Buffer.from(`${row.created_at.toISOString()}|${row.id}`, 'utf8').toString('base64url');

function decodeCursor(cursor) {
  const [createdAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (!createdAt || !id || Number.isNaN(Date.parse(createdAt))) throw badRequest(COPY.badCursor);
  return { createdAt, id };
}

const likePattern = (value) => `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

export async function listRequests({ member, status, q, limit, cursor }) {
  const params = [];
  let sql = `${LIST_COLUMNS} WHERE true${ownershipClause(member, params)}`;

  if (status) {
    params.push(status);
    sql += ` AND r.status = $${params.length}`;
  }
  if (q) {
    params.push(likePattern(q));
    sql += ` AND r.tour_name ILIKE $${params.length}`;
  }
  if (cursor) {
    const { createdAt, id } = decodeCursor(cursor);
    params.push(createdAt, id);
    sql += ` AND (r.created_at, r.id) < ($${params.length - 1}::timestamptz, $${params.length})`;
  }
  params.push(limit + 1);
  sql += ` ORDER BY r.created_at DESC, r.id DESC LIMIT $${params.length}`;

  const { rows } = await db.query(sql, params);
  const page = rows.slice(0, limit);
  return {
    items: page.map(toListItem),
    nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]) : null
  };
}

export async function listSubmittedRequests() {
  const { rows } = await db.query(
    `${LIST_COLUMNS} WHERE r.status = 'submitted' ORDER BY r.created_at, r.id`
  );
  return rows.map(toListItem);
}

export async function loadRequest({ member, id, executor = db }) {
  const params = [id];
  const { rows } = await executor.query(
    `${DETAIL_COLUMNS} WHERE r.id = $1${ownershipClause(member, params)}`,
    params
  );
  const row = rows[0];
  if (!row) throw notFound();

  const [stops, trucks] = await Promise.all([
    executor.query(
      `SELECT kind, date, address, city, region, postal_code, country
       FROM stops WHERE request_id = $1`,
      [id]
    ),
    executor.query(
      `SELECT t.id, t.depot
       FROM assignments a JOIN trucks t ON t.id = a.truck_id
       WHERE a.request_id = $1 ORDER BY t.id`,
      [id]
    )
  ]);

  const byKind = new Map(stops.rows.map((stop) => [stop.kind, stop]));
  return {
    ...toListItem(row),
    trucks_assigned: trucks.rows.length,
    notes: row.notes ?? null,
    stops: STOP_KINDS.map((kind) => byKind.get(kind)),
    trucks: trucks.rows,
    decided_by: row.decided_by_id ? { id: row.decided_by_id, name: row.decided_by_name } : null,
    decided_at: row.decided_at ? row.decided_at.toISOString() : null,
    decision_note: row.decision_note ?? null
  };
}

export async function loadActivity({ member, id }) {
  await loadRequest({ member, id });
  const { rows } = await db.query(
    `SELECT a.id, a.kind, a.note, a.created_at, m.id AS actor_id, m.name AS actor_name
     FROM activity a JOIN members m ON m.id = a.actor_id
     WHERE a.request_id = $1
     ORDER BY a.created_at, a.id`,
    [id]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    kind: row.kind,
    actor: { id: row.actor_id, name: row.actor_name },
    note: row.note ?? null,
    created_at: row.created_at.toISOString()
  }));
}

async function nextRequestId(client) {
  const { rows } = await client.query(
    `SELECT coalesce(max(substring(id from 4)::int), 0) + 1 AS next FROM logistics_requests`
  );
  return `LR-${String(rows[0].next).padStart(4, '0')}`;
}

async function findDraftRequest({ member, draftId, executor = db }) {
  const { rows } = await executor.query(
    'SELECT id FROM logistics_requests WHERE requester_id = $1 AND draft_id = $2',
    [member.id, draftId]
  );
  return rows[0]?.id ?? null;
}

export async function createRequest({ member, body }) {
  const draftId = parseDraftId(body);
  if (draftId) {
    const replayedId = await findDraftRequest({ member, draftId });
    if (replayedId) {
      return { request: await loadRequest({ member, id: replayedId }), replayed: true };
    }
  }

  const payload = buildNewRequest(body);

  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [REQUEST_ID_LOCK]);
    const id = await nextRequestId(client);
    const inserted = await client.query(
      `INSERT INTO logistics_requests
         (id, tour_name, transport_type, trucks_requested, notes, requester_id, status, draft_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'submitted', $7)
       ON CONFLICT (requester_id, draft_id) DO NOTHING
       RETURNING id`,
      [
        id,
        payload.tour_name,
        payload.transport_type,
        payload.trucks_requested,
        payload.notes,
        member.id,
        draftId
      ]
    );

    if (inserted.rowCount === 0) {
      const replayedId = await findDraftRequest({ member, draftId, executor: client });
      return { request: await loadRequest({ member, id: replayedId, executor: client }), replayed: true };
    }

    for (const stop of payload.stops) {
      await client.query(
        `INSERT INTO stops (request_id, kind, date, address, city, region, postal_code, country)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, stop.kind, stop.date, stop.address, stop.city, stop.region, stop.postal_code, stop.country]
      );
    }
    await client.query(
      `INSERT INTO activity (request_id, kind, actor_id, note) VALUES ($1, 'submitted', $2, $3)`,
      [id, member.id, submittedActivityNote(payload.trucks_requested)]
    );

    return { request: await loadRequest({ member, id, executor: client }), replayed: false };
  });
}
