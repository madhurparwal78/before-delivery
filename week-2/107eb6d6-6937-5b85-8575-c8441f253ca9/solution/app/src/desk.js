'use strict';
// Every rule of the desk, decided on the server and shared by the JSON API and the
// server-rendered pages. Each write runs in one transaction that locks the rows it
// depends on; a refusal throws before or during it, so nothing partial is kept.
const { query, tx } = require('./db');
const { COPY, FIELD, FIELD_OTHER, LABELS, refuse } = require('./messages');

const TRANSPORT_TYPES = Object.keys(LABELS.type);
const REQUEST_STATUSES = Object.keys(LABELS.status);
const TRUCK_STATUSES = Object.keys(LABELS.truck);
const ROLES = Object.keys(LABELS.role);
const STOP_KINDS = Object.keys(LABELS.stop);
const STOP_FIELDS = ['address', 'city', 'region', 'postal_code', 'country'];
const STAFF = ['dispatcher', 'admin'];
const ADMIN = ['admin'];
const PAGE_DEFAULT = 50;
const PAGE_MAX = 100;

// ---------------------------------------------------------------- roles and ownership
// The role check: the member here is always the stored row read on this request.
const mayDispatch = (member) => STAFF.includes(member.role);
const isAdmin = (member) => ADMIN.includes(member.role);

function requireRole(member, roles) {
  if (!roles.includes(member.role)) throw refuse.forbidden();
}

// The ownership filter: a tour manager sees only their own requests. Appends its
// argument and returns the SQL condition on `r`.
function ownership(member, args) {
  if (mayDispatch(member)) return 'TRUE';
  args.push(member.id);
  return `r.requester_id = $${args.length}`;
}

// ---------------------------------------------------------------- validation
const text = (value) => (typeof value === 'string' ? value.replace(/\u0000/g, '').trim() : '');

function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function wholeNumber(value) {
  if (Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^\s*\d{1,3}\s*$/.test(value)) return Number(value);
  return NaN;
}

function checkTour(input) {
  const fields = {};
  const tourName = text(input.tour_name);
  if (!tourName) fields.tour_name = FIELD.tourRequired;
  else if (tourName.length > 80) fields.tour_name = FIELD.tourTooLong;
  if (!TRANSPORT_TYPES.includes(input.transport_type)) fields.transport_type = FIELD.typeRequired;
  const trucks = wholeNumber(input.trucks_requested);
  if (!(trucks >= 1 && trucks <= 8)) fields.trucks_requested = FIELD.trucksRange;
  return {
    value: { tour_name: tourName, transport_type: input.transport_type, trucks_requested: trucks },
    fields,
  };
}

// The four stops, keyed by kind, and the two date orders.
function checkStops(input) {
  const fields = {};
  const stops = {};
  const source = input && typeof input === 'object' ? input : {};
  for (const kind of STOP_KINDS) {
    const raw = source[kind];
    if (!raw || typeof raw !== 'object') {
      fields[`stops.${kind}`] = FIELD_OTHER.stopMissing(kind);
      continue;
    }
    const stop = { date: null };
    if (raw.date !== null && raw.date !== undefined && raw.date !== '') {
      if (typeof raw.date === 'string' && isCalendarDate(raw.date.trim())) stop.date = raw.date.trim();
      else fields[`stops.${kind}.date`] = FIELD.date;
    }
    for (const name of STOP_FIELDS) {
      stop[name] = text(raw[name]);
      if (!stop[name]) fields[`stops.${kind}.${name}`] = FIELD[name];
    }
    stops[kind] = stop;
  }
  const date = (kind) => stops[kind] && stops[kind].date;
  if (date('pickup') && date('delivery') && date('delivery') < date('pickup')) {
    fields['stops.delivery.date'] = FIELD.deliveryEarly;
  }
  if (date('first_show') && date('last_show') && date('last_show') < date('first_show')) {
    fields['stops.last_show.date'] = FIELD.lastShowEarly;
  }
  return { value: stops, fields };
}

function checkNotes(input) {
  if (input === null || input === undefined) return { value: '', fields: {} };
  const notes = text(input);
  const fine = typeof input === 'string' && notes.length <= 500;
  return { value: notes, fields: fine ? {} : { notes: FIELD.notesTooLong } };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function checkDraftId(input) {
  if (input === null || input === undefined) return null;
  if (typeof input !== 'string' || !UUID.test(input)) throw refuse.validation({ draft_id: FIELD_OTHER.draftId });
  return input.toLowerCase();
}

// The request validation: tour details, stops and notes together.
function checkRequest(body) {
  const tour = checkTour(body);
  const stops = checkStops(body.stops);
  const notes = checkNotes(body.notes);
  const fields = { ...tour.fields, ...stops.fields, ...notes.fields };
  if (Object.keys(fields).length) throw refuse.validation(fields);
  return { ...tour.value, stops: stops.value, notes: notes.value };
}

function checkDecision(body) {
  const fields = {};
  if (!['confirm', 'decline'].includes(body.decision)) fields.decision = FIELD_OTHER.decision;
  const note = text(body.note);
  if (!note) fields.note = FIELD.noteRequired;
  else if (note.length > 500) fields.note = FIELD.noteTooLong;
  if (Object.keys(fields).length) throw refuse.validation(fields);
  return { decision: body.decision, note };
}

// ---------------------------------------------------------------- shapes
const iso = (value) => (value ? new Date(value).toISOString() : null);

// One count of the fleet: a request's trucks are its assignment rows.
const ASSIGNED = '(SELECT count(*)::int FROM assignments a WHERE a.request_id = r.id)';

const LIST_SELECT = `
  SELECT r.id, r.tour_name, r.transport_type, r.trucks_requested, r.status, r.created_at,
         r.requester_id, m.name AS requester_name, ${ASSIGNED} AS trucks_assigned,
         (SELECT s.date FROM stops s WHERE s.request_id = r.id AND s.kind = 'first_show') AS first_show_date
  FROM logistics_requests r JOIN members m ON m.id = r.requester_id`;

const listItem = (row) => ({
  id: row.id,
  tour_name: row.tour_name,
  transport_type: row.transport_type,
  trucks_requested: row.trucks_requested,
  trucks_assigned: row.trucks_assigned,
  status: row.status,
  requester: { id: row.requester_id, name: row.requester_name },
  first_show_date: row.first_show_date,
  created_at: iso(row.created_at),
});

const TRUCK_SELECT = `SELECT t.id, t.depot, t.status, a.request_id
  FROM trucks t LEFT JOIN assignments a ON a.truck_id = t.id`;

const truckShape = (row) => ({ id: row.id, depot: row.depot, status: row.status, request_id: row.request_id });

// ---------------------------------------------------------------- requests: reads
function parseLimit(value) {
  if (value === undefined) return PAGE_DEFAULT;
  const limit = typeof value === 'string' && /^\d{1,3}$/.test(value) ? Number(value) : NaN;
  if (!(limit >= 1 && limit <= PAGE_MAX)) throw refuse.badRequest(COPY.badLimit);
  return limit;
}

const encodeCursor = (id) => Buffer.from(id).toString('base64url');

function decodeCursor(value) {
  const id = typeof value === 'string' ? Buffer.from(value, 'base64url').toString('utf8') : '';
  if (!/^LR-\d{4}$/.test(id) || encodeCursor(id) !== value) throw refuse.badRequest(COPY.badCursor);
  return id;
}

const single = (value) => (Array.isArray(value) ? value[value.length - 1] : value);

// One page of the list, newest first. The cursor is the last row already shown, so
// each page continues strictly after it however many requests arrive meanwhile.
async function listRequests(member, params) {
  const status = single(params.status);
  const q = single(params.q);
  const limit = parseLimit(single(params.limit));
  const args = [];
  const where = [ownership(member, args)];
  if (status !== undefined && status !== '') {
    if (!REQUEST_STATUSES.includes(status)) throw refuse.badRequest(COPY.badRequestStatus);
    args.push(status);
    where.push(`r.status = $${args.length}`);
  }
  if (typeof q === 'string' && q.trim()) {
    args.push(`%${q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    where.push(`r.tour_name ILIKE $${args.length}`);
  }
  const cursor = single(params.cursor);
  if (cursor !== undefined && cursor !== '') {
    args.push(decodeCursor(cursor));
    // A cursor names a row this member may page past; any other id is not a cursor.
    const seen = [args[args.length - 1]];
    const { rowCount } = await query(
      `SELECT 1 FROM logistics_requests r WHERE r.id = $1 AND ${ownership(member, seen)}`, seen);
    if (!rowCount) throw refuse.badRequest(COPY.badCursor);
    where.push(`(r.created_at, r.id) < (SELECT created_at, id FROM logistics_requests WHERE id = $${args.length})`);
  }
  args.push(limit + 1);
  const { rows } = await query(
    `${LIST_SELECT} WHERE ${where.join(' AND ')} ORDER BY r.created_at DESC, r.id DESC LIMIT $${args.length}`, args);
  const page = rows.slice(0, limit).map(listItem);
  return { requests: page, nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1].id) : null };
}

// The request row if the member may see it; otherwise 404, exactly as if it did not exist.
async function visibleRequest(member, id) {
  if (!/^LR-\d{4}$/.test(id)) throw refuse.notFound();
  const args = [id];
  const { rows } = await query(`SELECT r.id FROM logistics_requests r WHERE r.id = $1 AND ${ownership(member, args)}`,
    args);
  if (!rows[0]) throw refuse.notFound();
  return rows[0];
}

// One request read from a single snapshot, so its trucks and its count always agree.
async function getRequest(member, id) {
  await visibleRequest(member, id);
  const [base, stops, trucks, decision] = await tx(async (c) => {
    await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    return [
      await c.query(`${LIST_SELECT} WHERE r.id = $1`, [id]),
      await c.query(`SELECT kind, date, address, city, region, postal_code, country FROM stops WHERE request_id = $1
                     ORDER BY array_position($2::text[], kind)`, [id, STOP_KINDS]),
      await c.query(`SELECT t.id, t.depot FROM assignments a JOIN trucks t ON t.id = a.truck_id
                     WHERE a.request_id = $1 ORDER BY t.id`, [id]),
      (await c.query(
        `SELECT r.notes, r.decided_at, r.decision_note, m.id AS decider_id, m.name AS decider_name
         FROM logistics_requests r LEFT JOIN members m ON m.id = r.decided_by WHERE r.id = $1`, [id])).rows[0],
    ];
  });
  return {
    ...listItem(base.rows[0]),
    notes: decision.notes,
    stops: stops.rows,
    trucks: trucks.rows,
    decided_by: decision.decider_id ? { id: decision.decider_id, name: decision.decider_name } : null,
    decided_at: iso(decision.decided_at),
    decision_note: decision.decision_note,
  };
}

async function listActivity(member, id) {
  await visibleRequest(member, id);
  const { rows } = await query(
    `SELECT a.id, a.kind, a.note, a.created_at, m.id AS actor_id, m.name AS actor_name
     FROM activity a JOIN members m ON m.id = a.actor_id WHERE a.request_id = $1
     ORDER BY a.created_at, a.id`, [id]);
  return rows.map((row) => ({ id: row.id, kind: row.kind, actor: { id: row.actor_id, name: row.actor_name },
    note: row.note, created_at: iso(row.created_at) }));
}

// ---------------------------------------------------------------- board and fleet
async function dispatchBoard(member) {
  requireRole(member, STAFF);
  const [requests, demand, counts] = await Promise.all([
    query(`${LIST_SELECT} WHERE r.status = 'submitted' ORDER BY r.created_at, r.id`),
    query(`SELECT count(*)::int AS waiting,
                  coalesce(sum(greatest(r.trucks_requested - ${ASSIGNED}, 0)), 0)::int AS trucks_needed
           FROM logistics_requests r WHERE r.status = 'submitted'`),
    fleetCounts(),
  ]);
  return { requests: requests.rows.map(listItem),
    summary: { ...demand.rows[0], trucks_available: counts.available } };
}

// The count of trucks in each state: the one place the board and the fleet summary read it from.
async function fleetCounts() {
  const { rows } = await query(
    `SELECT count(*) FILTER (WHERE status = 'available')::int AS available,
            count(*) FILTER (WHERE status = 'assigned')::int AS assigned,
            count(*) FILTER (WHERE status = 'maintenance')::int AS maintenance FROM trucks`);
  return rows[0];
}

// Truck availability is the stored truck status, kept in step with the assignment
// rows by every write below.
async function trucksIn(status) {
  const { rows } = status
    ? await query(`${TRUCK_SELECT} WHERE t.status = $1 ORDER BY t.id`, [status])
    : await query(`${TRUCK_SELECT} ORDER BY t.id`);
  return rows.map(truckShape);
}

async function listTrucks(member, params) {
  requireRole(member, STAFF);
  const status = single(params.status);
  if (status !== undefined && status !== '' && !TRUCK_STATUSES.includes(status)) {
    throw refuse.badRequest(COPY.badTruckStatus);
  }
  return trucksIn(status);
}

// The fleet page: every truck and the fleet summary line.
async function fleet(member) {
  requireRole(member, STAFF);
  const [trucks, summary] = await Promise.all([trucksIn(''), fleetCounts()]);
  return { trucks, summary };
}

// The request page: the request, and the dispatch panel with the trucks available
// now when the member may dispatch and the request is still open.
async function requestPage(member, id) {
  const request = await getRequest(member, id);
  const dispatching = mayDispatch(member) && request.status === 'submitted';
  return { request, dispatching, available: dispatching ? await trucksIn('available') : [] };
}

// The decision confirmation is for dispatchers and admins, whatever the id.
async function decidedRequest(member, id) {
  requireRole(member, STAFF);
  return getRequest(member, id);
}

async function listMembers(member) {
  requireRole(member, ADMIN);
  const { rows } = await query('SELECT id, name, email, role FROM members ORDER BY id');
  return rows;
}

// ---------------------------------------------------------------- requests: writes
const requestedNote = (n) => (n === 1 ? 'Requested 1 truck' : `Requested ${n} trucks`);

async function storedDraft(run, member, draftId) {
  const { rows } = await run('SELECT id FROM logistics_requests WHERE requester_id = $1 AND draft_id = $2',
    [member.id, draftId]);
  return rows[0] ? rows[0].id : null;
}

// Store a new request, or answer with the one this member's draft already made.
// The id lock serializes every submission, so ids are consecutive and a draft is
// stored once however many posts of it race.
async function createRequest(member, body) {
  const draftId = checkDraftId(body.draft_id);
  const replay = draftId && await storedDraft(query, member, draftId);
  if (replay) return { request: await getRequest(member, replay), replayed: true };
  const value = checkRequest(body);
  const { id, replayed } = await tx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(4173100)');
    const raced = draftId && await storedDraft(c.query.bind(c), member, draftId);
    if (raced) return { id: raced, replayed: true };
    const { rows: [{ next }] } = await c.query(
      'SELECT coalesce(max(substring(id FROM 4)::int), 0) + 1 AS next FROM logistics_requests');
    const newId = `LR-${String(next).padStart(4, '0')}`;
    await c.query(
      `INSERT INTO logistics_requests (id, tour_name, transport_type, trucks_requested, notes, requester_id, draft_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [newId, value.tour_name, value.transport_type, value.trucks_requested, value.notes, member.id, draftId]);
    for (const kind of STOP_KINDS) {
      const s = value.stops[kind];
      await c.query(
        `INSERT INTO stops (request_id, kind, date, address, city, region, postal_code, country)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [newId, kind, s.date, s.address, s.city, s.region, s.postal_code, s.country]);
    }
    await c.query("INSERT INTO activity (request_id, kind, actor_id, note) VALUES ($1, 'submitted', $2, $3)",
      [newId, member.id, requestedNote(value.trucks_requested)]);
    return { id: newId, replayed: false };
  });
  return { request: await getRequest(member, id), replayed };
}

// Lock a request for a dispatch write; a decided request takes no more writes.
async function lockSubmitted(c, id) {
  const { rows: [request] } = await c.query('SELECT * FROM logistics_requests WHERE id = $1 FOR UPDATE', [id]);
  if (request.status !== 'submitted') throw refuse.conflict(COPY.decided);
  return request;
}

async function truckExists(id) {
  if (typeof id !== 'string') return false;
  return (await query('SELECT 1 FROM trucks WHERE id = $1', [id])).rowCount > 0;
}

async function assignTruck(member, id, body) {
  requireRole(member, STAFF);
  await visibleRequest(member, id);
  const truckId = body.truck_id;
  if (!(await truckExists(truckId))) throw refuse.validation({ truck_id: FIELD.truckUnknown });
  await tx(async (c) => {
    const request = await lockSubmitted(c, id);
    const { rows: [truck] } = await c.query('SELECT status FROM trucks WHERE id = $1 FOR UPDATE', [truckId]);
    if (truck.status !== 'available') throw refuse.conflict(COPY.truckUnavailable);
    const { rows: [held] } = await c.query('SELECT count(*)::int AS n FROM assignments WHERE request_id = $1', [id]);
    if (held.n >= request.trucks_requested) throw refuse.conflict(COPY.requestFull);
    await c.query("UPDATE trucks SET status = 'assigned', updated_at = now() WHERE id = $1", [truckId]);
    await c.query('INSERT INTO assignments (request_id, truck_id, assigned_by) VALUES ($1, $2, $3)',
      [id, truckId, member.id]);
    await c.query("INSERT INTO activity (request_id, kind, actor_id, note) VALUES ($1, 'truck_assigned', $2, $3)",
      [id, member.id, `${truckId} assigned`]);
  });
  return getRequest(member, id);
}

// Hand one truck back to the fleet inside a locked request; false when it was not on it.
async function releaseLocked(c, member, id, truckId) {
  const removed = await c.query('DELETE FROM assignments WHERE request_id = $1 AND truck_id = $2', [id, truckId]);
  if (!removed.rowCount) return false;
  await c.query("UPDATE trucks SET status = 'available', updated_at = now() WHERE id = $1", [truckId]);
  await c.query("INSERT INTO activity (request_id, kind, actor_id, note) VALUES ($1, 'truck_released', $2, $3)",
    [id, member.id, `${truckId} released`]);
  return true;
}

async function releaseTruck(member, id, truckId) {
  requireRole(member, STAFF);
  await visibleRequest(member, id);
  if (!(await truckExists(truckId))) throw refuse.notFound();
  await tx(async (c) => {
    await lockSubmitted(c, id);
    if (!(await releaseLocked(c, member, id, truckId))) throw refuse.notFound();
  });
}

async function decide(member, id, body) {
  requireRole(member, STAFF);
  await visibleRequest(member, id);
  const { decision, note } = checkDecision(body);
  await tx(async (c) => {
    const request = await lockSubmitted(c, id);
    const { rows: held } = await c.query(
      'SELECT truck_id FROM assignments WHERE request_id = $1 ORDER BY truck_id FOR UPDATE', [id]);
    if (decision === 'confirm' && held.length < request.trucks_requested) throw refuse.conflict(COPY.confirmEarly);
    if (decision === 'decline') {
      for (const { truck_id: truckId } of held) await releaseLocked(c, member, id, truckId);
    }
    const status = decision === 'confirm' ? 'confirmed' : 'declined';
    await c.query(
      `UPDATE logistics_requests SET status = $2, decided_by = $3, decided_at = clock_timestamp(), decision_note = $4
       WHERE id = $1`, [id, status, member.id, note]);
    await c.query('INSERT INTO activity (request_id, kind, actor_id, note) VALUES ($1, $2, $3, $4)',
      [id, status, member.id, note]);
  });
  return getRequest(member, id);
}

// ---------------------------------------------------------------- fleet and members: writes
async function setTruckStatus(member, truckId, body) {
  requireRole(member, ADMIN);
  if (!(await truckExists(truckId))) throw refuse.notFound();
  const { status } = body;
  if (!['available', 'maintenance'].includes(status)) throw refuse.validation({ status: FIELD_OTHER.truckStatus });
  return tx(async (c) => {
    const { rows: [truck] } = await c.query('SELECT status FROM trucks WHERE id = $1 FOR UPDATE', [truckId]);
    if (truck.status === 'assigned') throw refuse.conflict(COPY.truckOnRequest);
    await c.query('UPDATE trucks SET status = $2, updated_at = now() WHERE id = $1 AND status <> $2',
      [truckId, status]);
    return truckShape((await c.query(`${TRUCK_SELECT} WHERE t.id = $1`, [truckId])).rows[0]);
  });
}

// One member row by its path id, or null.
async function findMember(memberId) {
  const id = /^\d{1,9}$/.test(memberId) ? Number(memberId) : 0;
  const { rows } = await query('SELECT id, name, email, role FROM members WHERE id = $1', [id]);
  return rows[0] || null;
}

async function setRole(member, memberId, body) {
  requireRole(member, ADMIN);
  const target = await findMember(memberId);
  if (!target) throw refuse.notFound();
  const { id } = target;
  const { role } = body;
  if (!ROLES.includes(role)) throw refuse.validation({ role: FIELD.role });
  return tx(async (c) => {
    // Every admin row is locked, so two demotions at once cannot both see a spare admin.
    const { rows: admins } = await c.query("SELECT id FROM members WHERE role = 'admin' ORDER BY id FOR UPDATE");
    const { rows: [locked] } = await c.query('SELECT role FROM members WHERE id = $1 FOR UPDATE', [id]);
    if (locked.role === 'admin' && role !== 'admin' && admins.length === 1) throw refuse.conflict(COPY.lastAdmin);
    const { rows } = await c.query('UPDATE members SET role = $2 WHERE id = $1 RETURNING id, name, email, role',
      [id, role]);
    return rows[0];
  });
}

module.exports = {
  STOP_KINDS, STOP_FIELDS, requestedNote, mayDispatch, isAdmin,
  checkTour, checkStops, listRequests, getRequest, requestPage, decidedRequest, listActivity, dispatchBoard,
  listTrucks, fleet,
  listMembers, findMember, createRequest, assignTruck, releaseTruck, decide, setTruckStatus, setRole,
};
