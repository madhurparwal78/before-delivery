'use strict';

const { STOP_KINDS } = require('./domain');

const REQUEST_LIST_COLUMNS = `
  r.id, r.tour_name, r.transport_type, r.trucks_requested, r.status,
  r.requester_id, m.name AS requester_name, r.created_at,
  (SELECT s.date FROM stops s WHERE s.request_id = r.id AND s.kind = 'first_show') AS first_show_date,
  (SELECT count(*) FROM assignments a WHERE a.request_id = r.id) AS trucks_assigned`;

const REQUEST_DETAIL_COLUMNS = `
  r.*, m.name AS requester_name,
  (SELECT count(*) FROM assignments a WHERE a.request_id = r.id) AS trucks_assigned,
  (SELECT s.date FROM stops s WHERE s.request_id = r.id AND s.kind = 'first_show') AS first_show_date`;

function iso(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function listItem(row) {
  return {
    id: row.id,
    tour_name: row.tour_name,
    transport_type: row.transport_type,
    trucks_requested: row.trucks_requested,
    trucks_assigned: Number(row.trucks_assigned),
    status: row.status,
    requester: { id: row.requester_id, name: row.requester_name },
    first_show_date: row.first_show_date || null,
    created_at: iso(row.created_at),
  };
}

function detail(row, stops, trucks, deciderName) {
  const base = listItem(row);
  base.notes = row.notes || '';
  base.stops = STOP_KINDS.map((kind) => {
    const stop = stops.find((s) => s.kind === kind);
    return {
      kind,
      date: stop ? stop.date : null,
      address: stop ? stop.address : '',
      city: stop ? stop.city : '',
      region: stop ? stop.region : '',
      postal_code: stop ? stop.postal_code : '',
      country: stop ? stop.country : '',
    };
  });
  base.trucks = trucks.map((t) => ({ id: t.id, depot: t.depot })).sort((a, b) => (a.id < b.id ? -1 : 1));
  base.decided_by = row.decided_by ? { id: row.decided_by, name: deciderName } : null;
  base.decided_at = row.decided_at ? iso(row.decided_at) : null;
  base.decision_note = row.decision_note || null;
  return base;
}

class Store {
  constructor(pool) {
    this.pool = pool;
  }

  async memberById(client, id) {
    const { rows } = await client.query('SELECT id, name, email, role FROM members WHERE id = $1', [id]);
    return rows[0] || null;
  }

  async members() {
    const { rows } = await this.pool.query('SELECT id, name, email, role FROM members ORDER BY id');
    return rows;
  }

  // Ownership lives here only: a tour manager reads only their own rows, and
  // every derived surface applies the same clause.
  ownershipClause(member, params) {
    if (member.role === 'tour_manager') {
      params.push(member.id);
      return `r.requester_id = $${params.length}`;
    }
    return 'TRUE';
  }

  async listRequests(member, { status, q, limit, cursor }) {
    const parts = [];
    const params = [];
    parts.push(this.ownershipClause(member, params));
    if (status) { params.push(status); parts.push(`r.status = $${params.length}`); }
    if (q) { params.push(`%${q}%`); parts.push(`r.tour_name ILIKE $${params.length}`); }
    if (cursor) {
      params.push(cursor.createdAt, cursor.id);
      parts.push(`(r.created_at, r.id) < ($${params.length - 1}::timestamptz, $${params.length})`);
    }
    params.push(limit + 1);
    const { rows } = await this.pool.query(
      `SELECT ${REQUEST_LIST_COLUMNS}
       FROM logistics_requests r JOIN members m ON m.id = r.requester_id
       WHERE (${parts.join(' AND ')})
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT $${params.length}`,
      params,
    );
    return rows.map(listItem);
  }

  async getRequest(member, id) {
    return this.pool.connect().then(async (client) => {
      try {
        return await this.readRequest(client, member, id);
      } finally {
        client.release();
      }
    });
  }

  async readRequest(client, member, id) {
    const params = [id];
    const ownership = this.ownershipClause(member, params);
    const { rows } = await client.query(
      `SELECT ${REQUEST_DETAIL_COLUMNS}
       FROM logistics_requests r JOIN members m ON m.id = r.requester_id
       WHERE r.id = $1 AND (${ownership})`,
      params,
    );
    const row = rows[0];
    if (!row) return null;
    const stops = await client.query('SELECT * FROM stops WHERE request_id = $1 ORDER BY id', [id]);
    const trucks = await client.query(
      `SELECT t.id, t.depot FROM assignments a JOIN trucks t ON t.id = a.truck_id
       WHERE a.request_id = $1 ORDER BY t.id`, [id]);
    let deciderName = null;
    if (row.decided_by) {
      const decider = await client.query('SELECT name FROM members WHERE id = $1', [row.decided_by]);
      deciderName = decider.rows[0] ? decider.rows[0].name : null;
    }
    return detail(row, stops.rows, trucks.rows, deciderName);
  }

  async activity(member, requestId) {
    const params = [requestId];
    const ownership = this.ownershipClause(member, params);
    const visible = await this.pool.query(
      `SELECT 1 FROM logistics_requests r WHERE r.id = $1 AND (${ownership})`,
      params,
    );
    if (visible.rowCount === 0) return null;
    const { rows } = await this.pool.query(
      `SELECT a.id, a.kind, a.note, a.created_at, m.id AS actor_id, m.name AS actor_name
       FROM activity a JOIN members m ON m.id = a.actor_id
       WHERE a.request_id = $1 ORDER BY a.id`, [requestId],
    );
    return rows.map((row) => ({
      id: row.id, kind: row.kind, note: row.note,
      actor: { id: row.actor_id, name: row.actor_name },
      created_at: iso(row.created_at),
    }));
  }

  // One query decides every derived count: trucks assigned per request, the
  // board's waiting/needed/available and the fleet summary all read the same
  // assignment rows.
  async board() {
    const { rows } = await this.pool.query(
      `SELECT
         (SELECT count(*) FROM logistics_requests WHERE status = 'submitted') AS waiting,
         (SELECT COALESCE(sum(GREATEST(trucks_requested - assigned_count, 0)), 0)
            FROM (SELECT r.id, r.trucks_requested,
                         (SELECT count(*) FROM assignments a WHERE a.request_id = r.id) AS assigned_count
                  FROM logistics_requests r WHERE r.status = 'submitted') sub) AS trucks_needed,
         (SELECT count(*) FROM trucks WHERE status = 'available') AS trucks_available,
         (SELECT count(*) FROM trucks WHERE status = 'assigned') AS trucks_assigned_count,
         (SELECT count(*) FROM trucks WHERE status = 'maintenance') AS trucks_maintenance`,
    );
    return {
      waiting: Number(rows[0].waiting),
      trucks_needed: Number(rows[0].trucks_needed),
      trucks_available: Number(rows[0].trucks_available),
      trucks_assigned: Number(rows[0].trucks_assigned_count),
      trucks_maintenance: Number(rows[0].trucks_maintenance),
    };
  }

  async trucks(status) {
    const params = [];
    let clause = '';
    if (status) { params.push(status); clause = 'WHERE t.status = $1'; }
    const { rows } = await this.pool.query(
      `SELECT t.id, t.depot, t.status,
              (SELECT a.request_id FROM assignments a WHERE a.truck_id = t.id) AS request_id
       FROM trucks t ${clause} ORDER BY t.id`, params,
    );
    return rows.map((row) => ({ id: row.id, depot: row.depot, status: row.status, request_id: row.request_id || null }));
  }

  async availableTrucksForPanel() {
    const { rows } = await this.pool.query("SELECT id, depot FROM trucks WHERE status = 'available' ORDER BY id");
    return rows;
  }

  async dispatchBoard() {
    const { rows } = await this.pool.query(
      `SELECT ${REQUEST_LIST_COLUMNS}
       FROM logistics_requests r JOIN members m ON m.id = r.requester_id
       WHERE r.status = 'submitted'
       ORDER BY r.created_at ASC, r.id ASC`,
    );
    return rows.map(listItem);
  }
}

module.exports = { Store, listItem };
