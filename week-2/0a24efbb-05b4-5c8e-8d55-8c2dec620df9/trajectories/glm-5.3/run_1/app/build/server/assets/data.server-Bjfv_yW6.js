import { query, run } from "./pg-C3ev9-Vg.js";
import { SESSION_COOKIE, loadSession, touchSession, hashToken } from "./sessions-BB3wZhcQ.js";
import { ApiError } from "./errors-DELaVzSn.js";
import { i as isValidMonth, d as daysOfMonth, a as dayToUtcDate, f as formatTimestamp } from "./server-build-BR0xWWlP.js";
function foldAddress(address) {
  if (typeof address !== "string") return address;
  return address.normalize("NFKC").toLowerCase();
}
function trimGraphemes(text) {
  if (typeof text !== "string") return text;
  return text.replace(/^[\s\u0085]+|[\s\u0085]+$/g, "");
}
async function currentManagerIds(personId) {
  const rows = await query(
    "SELECT id FROM person WHERE manager_id = $1 AND active = true",
    [personId]
  );
  return rows.map((r) => r.id);
}
async function resolveViewer(request) {
  const authHeader = request.headers?.get ? request.headers.get("authorization") : request.headers?.authorization;
  const token = bearerFromAuth(authHeader) ?? request.cookies?.[SESSION_COOKIE] ?? null;
  if (!token) return { token: null, state: "none" };
  const loaded = await loadSession(token);
  if (!loaded || loaded.kind === "unknown") return { token, state: "none" };
  if (loaded.kind === "ended") return { token, state: "ended" };
  await touchSession(loaded.session.id);
  const person = await getPerson(loaded.person.id);
  if (!person) return { token, state: "ended" };
  const directReportIds = person.role === "manager" ? await currentManagerIds(person.id) : [];
  return {
    token,
    state: "ok",
    viewer: {
      id: person.id,
      name: person.name,
      work_address: person.work_address,
      role: person.role,
      active: person.active,
      directReportIds
    },
    session: loaded.session
  };
}
function bearerFromAuth(header) {
  if (header && /^Bearer /i.test(header)) return header.slice(7);
  return null;
}
async function getPerson(id) {
  const rows = await query("SELECT * FROM person WHERE id = $1", [id]);
  return rows[0] || null;
}
const PEOPLE = [
  { id: 1, work_address: "admin@example.com", name: "Priya Sahni", role: "admin", manager: null, active: true },
  { id: 2, work_address: "manager@example.com", name: "Dara Finch", role: "manager", manager: 1, active: true },
  { id: 3, work_address: "manager2@example.com", name: "Omar Vance", role: "manager", manager: 1, active: true },
  { id: 4, work_address: "manager3@example.com", name: "Lena Roth", role: "manager", manager: 1, active: true },
  { id: 5, work_address: "employee@example.com", name: "Iris Calder", role: "employee", manager: 2, active: true },
  { id: 6, work_address: "employee2@example.com", name: "Tomas Berg", role: "employee", manager: 2, active: true },
  { id: 7, work_address: "employee3@example.com", name: "Nadia Kerr", role: "employee", manager: 2, active: true },
  { id: 8, work_address: "employee4@example.com", name: "Felix Arno", role: "employee", manager: 2, active: true },
  { id: 9, work_address: "employee5@example.com", name: "Suri Patel", role: "employee", manager: 3, active: true },
  { id: 10, work_address: "employee6@example.com", name: "Jonas Vale", role: "employee", manager: 3, active: true },
  { id: 11, work_address: "employee7@example.com", name: "Mira Okoye", role: "employee", manager: 3, active: true },
  { id: 12, work_address: "employee8@example.com", name: "Ravi Setu", role: "employee", manager: 3, active: true },
  { id: 13, work_address: "employee9@example.com", name: "Clara Mendt", role: "employee", manager: 4, active: true },
  { id: 14, work_address: "employee10@example.com", name: "Bo Lindqvist", role: "employee", manager: 4, active: true },
  { id: 15, work_address: "employee11@example.com", name: "Ayaan Qureshi", role: "employee", manager: 4, active: true },
  { id: 16, work_address: "employee12@example.com", name: "Greta Solis", role: "employee", manager: 4, active: false }
];
const TYPE_CODES = ["missed_in", "missed_out", "offsite", "whole_day", "night_shift"];
new Map(PEOPLE.map((p) => [p.id, p]));
const STATE_VALUES = ["pending", "approved", "rejected", "cancelled"];
const SORT_VALUES = ["day", "raised", "person"];
const PAGE_SIZE = 25;
async function currentPolicy(client) {
  const rows = await run(client, "SELECT * FROM policy ORDER BY version DESC LIMIT 1");
  return rows[0] || null;
}
function scopeSql(person) {
  if (person.role === "admin") {
    return { sql: "TRUE", params: [] };
  }
  if (person.role === "manager") {
    return {
      sql: "(r.person_id = ANY($1))",
      params: [[person.id, ...person.directReportIds]]
    };
  }
  return { sql: "(r.person_id = $1)", params: [person.id] };
}
function projectLeaveKind(storedKind, viewer, raiserId) {
  if (viewer.role === "admin" || viewer.id === raiserId) return storedKind;
  if (storedKind === "sickness") return "absence";
  return storedKind;
}
const LEAVE_LABELS = {
  annual: "Annual leave",
  sickness: "Sickness",
  absence: "Absence"
};
async function isLinkDead(client, link) {
  const now = Date.now();
  if (now >= link.expires_at.getTime()) return true;
  if (link.revoked_at) return true;
  if (link.replaced_at) return true;
  const rows = await run(
    client,
    `SELECT p.active, p.manager_id, p.role FROM person p WHERE p.id = $1`,
    [link.person_id]
  );
  const person = rows[0];
  if (!person || !person.active) return true;
  const minterRows = await run(
    client,
    "SELECT id, role, active FROM person WHERE id = $1",
    [link.minted_by]
  );
  const minter = minterRows[0];
  if (!minter || !minter.active) return true;
  if (minter.role !== "admin" && minter.role !== "manager") return true;
  if (minter.role === "manager" && person.manager_id !== minter.id) return true;
  return false;
}
function canonicalQueueQuery(q) {
  const parts = [];
  if (q.state && q.state !== "all") parts.push(`state=${encodeURIComponent(q.state)}`);
  if (q.type) parts.push(`type=${encodeURIComponent(q.type)}`);
  if (q.person) parts.push(`person=${encodeURIComponent(q.person)}`);
  if (q.month) parts.push(`month=${encodeURIComponent(q.month)}`);
  if (q.q) parts.push(`q=${encodeURIComponent(q.q)}`);
  if (q.sort) parts.push(`sort=${encodeURIComponent(q.sort)}`);
  if (q.page && q.page > 1) parts.push(`page=${q.page}`);
  return parts.join("&");
}
function parseQueueQuery(searchParams, viewer) {
  const single = (name) => {
    if (!searchParams.has(name)) return void 0;
    const v = searchParams.get(name);
    if (v === "") return void 0;
    return v;
  };
  for (const name of ["state", "type", "person", "month", "q", "sort", "page"]) {
    const raw = searchParams.has(name) ? searchParams.get(name) : void 0;
    if (raw !== void 0 && raw.includes("\0")) {
      throw new ApiError(400, `${name} cannot contain a NUL character.`, { field: name });
    }
  }
  const state = single("state");
  if (state !== void 0 && !STATE_VALUES.includes(state)) {
    throw new ApiError(400, `Unknown state value: ${state}.`, { field: "state" });
  }
  const type = single("type");
  if (type !== void 0 && !TYPE_CODES.includes(type)) {
    throw new ApiError(400, `Unknown type value: ${type}.`, { field: "type" });
  }
  const person = single("person");
  const month = single("month");
  if (month !== void 0 && !isValidMonth(month)) {
    throw new ApiError(400, `Unknown month value: ${month}.`, { field: "month" });
  }
  const qText = single("q");
  if (qText !== void 0 && trimGraphemes(qText).length > 100) {
    throw new ApiError(400, "Search is limited to 100 characters.", { field: "q" });
  }
  const sort = single("sort");
  if (sort !== void 0 && !SORT_VALUES.includes(sort)) {
    throw new ApiError(400, `Unknown sort value: ${sort}.`, { field: "sort" });
  }
  const pageRaw = single("page");
  let page = 1;
  if (pageRaw !== void 0) {
    if (!/^[1-9][0-9]*$/.test(pageRaw)) {
      throw new ApiError(400, `Unknown page value: ${pageRaw}.`, { field: "page" });
    }
    page = Number(pageRaw);
  }
  return {
    state,
    type,
    person,
    month,
    q: qText !== void 0 ? trimGraphemes(qText) : void 0,
    sort,
    page
  };
}
async function queueQuery(person, q) {
  const scope = scopeSql(person);
  const params = [...scope.params];
  const param = (v) => {
    params.push(v);
    return `$${params.length}`;
  };
  const where = [scope.sql];
  if (q.state) where.push(`r.state = ${param(q.state)}`);
  if (q.type) where.push(`r.correction_type = ${param(q.type)}`);
  if (q.month) where.push(`to_char(r.day, 'YYYY-MM') = ${param(q.month)}`);
  if (q.person) {
    const folded = foldAddress(q.person);
    where.push(`EXISTS (SELECT 1 FROM person fp WHERE fp.id = r.person_id AND lower(fp.work_address) = lower(${param(folded)}))`);
  }
  if (q.q) {
    const escaped = q.q.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
    where.push(`r.reason ILIKE ${param("%" + escaped + "%")} ESCAPE '\\'`);
  }
  const whereSql = where.join(" AND ");
  const totalRows = await query(
    `SELECT COUNT(*)::int AS n FROM regularisation_request r WHERE ${scope.sql}`,
    scope.params
  );
  const matchedRows = await query(
    `SELECT COUNT(*)::int AS n FROM regularisation_request r WHERE ${whereSql}`,
    params
  );
  const total = totalRows[0].n;
  const matched = matchedRows[0].n;
  const pages = Math.max(1, Math.ceil(matched / PAGE_SIZE));
  const page = Math.min(q.page || 1, pages);
  let orderBy;
  if (q.sort === "day") orderBy = "r.day DESC, r.id ASC";
  else if (q.sort === "raised") orderBy = "r.raised_at ASC, r.id ASC";
  else if (q.sort === "person") orderBy = "lower(p.name) ASC, r.id ASC";
  else orderBy = "CASE WHEN r.state = 'pending' THEN 0 ELSE 1 END, r.raised_at ASC, r.id ASC";
  const rows = await query(
    `SELECT r.*, p.name AS person_name, p.work_address AS work_address,
            m.name AS manager_name,
            a.recorded_in AS recorded_in_ts, a.recorded_out AS recorded_out_ts
     FROM regularisation_request r
     JOIN person p ON p.id = r.person_id
     LEFT JOIN person m ON m.id = p.manager_id
     LEFT JOIN attendance_day a ON a.person_id = r.person_id AND a.day = r.day
     WHERE ${whereSql}
     ORDER BY ${orderBy}
     LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
    params
  );
  return { rows, matched, total, page, pages };
}
async function calendarScope(viewer) {
  if (viewer.role === "admin") {
    const rows2 = await query(
      "SELECT id, name, work_address FROM person ORDER BY name"
    );
    return rows2;
  }
  const rows = await query(
    "SELECT id, name, work_address FROM person WHERE manager_id = $1 ORDER BY name",
    [viewer.id]
  );
  return rows;
}
async function calendarCounts(month, scopePeople, personParam) {
  const people = scopePeople;
  let personFilter = null;
  if (personParam) {
    const folded = foldAddress(personParam);
    const match = people.find((p) => foldAddress(p.work_address) === folded);
    personFilter = match ? match.id : "outside";
  }
  const ids = personFilter && personFilter !== "outside" ? [personFilter] : people.map((p) => p.id);
  const days = daysOfMonth(month);
  if (personFilter === "outside" || ids.length === 0) {
    return days.map((day) => ({ day, counts: zeroCounts() }));
  }
  const first = days[0];
  const last = days[days.length - 1];
  const attendance = await query(
    `SELECT day, recorded_in, recorded_out FROM attendance_day
     WHERE person_id = ANY($1) AND day >= $2 AND day <= $3`,
    [ids, first, last]
  );
  const leave = await query(
    `SELECT day, status FROM leave_day WHERE person_id = ANY($1) AND day >= $2 AND day <= $3`,
    [ids, first, last]
  );
  const waiting = await query(
    `SELECT day FROM regularisation_request
     WHERE person_id = ANY($1) AND state = 'pending' AND day >= $2 AND day <= $3`,
    [ids, first, last]
  );
  const seededRows = await query("SELECT seeded_on FROM employer WHERE id = 1");
  const seededOn = seededRows[0].seeded_on.toISOString().slice(0, 10);
  const dayMap = /* @__PURE__ */ new Map();
  for (const row of attendance) {
    const key = row.day.toISOString().slice(0, 10);
    if (!dayMap.has(key)) dayMap.set(key, []);
    dayMap.get(key).push(row);
  }
  const leaveMap = /* @__PURE__ */ new Map();
  for (const row of leave) {
    const key = row.day.toISOString().slice(0, 10);
    if (!leaveMap.has(key)) leaveMap.set(key, []);
    leaveMap.get(key).push(row);
  }
  const waitingMap = /* @__PURE__ */ new Map();
  for (const row of waiting) {
    const key = row.day.toISOString().slice(0, 10);
    waitingMap.set(key, (waitingMap.get(key) || 0) + 1);
  }
  return days.map((day) => {
    const counts = zeroCounts();
    const attRows = dayMap.get(day) || [];
    const rowsWithBoth = attRows.filter((r) => r.recorded_in && r.recorded_out).length;
    counts.recorded = rowsWithBoth;
    const rowsPartial = attRows.filter((r) => (r.recorded_in || r.recorded_out) && !(r.recorded_in && r.recorded_out)).length;
    const offset = dayDiff(day, seededOn);
    const seededDay = offset >= 0 && offset <= 89;
    if (seededDay) {
      counts.incomplete = rowsPartial + Math.max(0, ids.length - attRows.length);
    }
    for (const row of leaveMap.get(day) || []) {
      if (row.status === "approved") counts.leave_approved++;
      else counts.leave_pending++;
    }
    counts.waiting = waitingMap.get(day) || 0;
    return { day, counts };
  });
}
function dayDiff(a, b) {
  return Math.round((dayToUtcDate(a) - dayToUtcDate(b)) / 864e5);
}
function zeroCounts() {
  return { recorded: 0, incomplete: 0, leave_approved: 0, leave_pending: 0, waiting: 0 };
}
async function readShareMonth(token) {
  const rows = await query("SELECT * FROM share_link WHERE token_hash = $1", [hashToken(token)]);
  const link = rows[0];
  if (!link) return { kind: "unknown" };
  const dead = await isLinkDead(null, link);
  if (dead) return { kind: "dead" };
  const personRows = await query("SELECT name FROM person WHERE id = $1", [link.person_id]);
  const days = await calendarCounts(link.month, [{ id: link.person_id, name: personRows[0].name, work_address: "x" }], null);
  return {
    kind: "live",
    name: personRows[0].name,
    month: link.month,
    days
  };
}
async function viewerFromRequest(request) {
  const cookies = {};
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > -1) cookies[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  const resolved = await resolveViewer({ cookies, headers: request.headers });
  return resolved.state === "ok" ? resolved.viewer : null;
}
async function loadQueue(viewer, url) {
  const params = url.searchParams;
  const q = parseQueueQuery(params);
  const out = await queueQuery(viewer, q);
  const scopePeople = await scopePeopleFor(viewer);
  return {
    queueQuery: canonicalQueueQuery(q),
    parsedQuery: q,
    rows: out.rows.map((r) => ({
      id: Number(r.id),
      person: r.person_name,
      day: r.day.toISOString().slice(0, 10),
      correction_type: r.correction_type,
      claimed_in: r.claimed_in,
      claimed_out: r.claimed_out,
      reason: r.reason,
      state: r.state,
      raised_at: formatTimestamp(r.raised_at),
      recorded_in: r.recorded_in_ts ? formatTimestamp(r.recorded_in_ts) : null,
      recorded_out: r.recorded_out_ts ? formatTimestamp(r.recorded_out_ts) : null
    })),
    matched: out.matched,
    total: out.total,
    page: out.page,
    pages: out.pages,
    scopePeople
  };
}
async function scopePeopleFor(viewer) {
  if (viewer.role === "admin") {
    const rows2 = await query("SELECT id, name, work_address FROM person ORDER BY name");
    return rows2.map((r) => ({ id: r.id, name: r.name, work_address: r.work_address }));
  }
  if (viewer.role === "manager") {
    const rows2 = await query(
      `SELECT id, name, work_address FROM person
       WHERE id = $1 OR (manager_id = $1 AND active = true) ORDER BY name`,
      [viewer.id]
    );
    return rows2.map((r) => ({ id: r.id, name: r.name, work_address: r.work_address }));
  }
  const rows = await query("SELECT id, name, work_address FROM person WHERE id = $1", [viewer.id]);
  return rows.map((r) => ({ id: r.id, name: r.name, work_address: r.work_address }));
}
async function loadPolicyVersion() {
  const p = await currentPolicy();
  return p.version;
}
async function loadPolicyFull() {
  const p = await currentPolicy();
  const creator = await query("SELECT name FROM person WHERE id = $1", [p.created_by]);
  const history = await query("SELECT * FROM policy ORDER BY version DESC");
  const trail = await query(
    `SELECT a.*, p.name AS actor_name FROM audit_event a
     JOIN person p ON p.id = a.actor_id ORDER BY a.seq DESC`
  );
  const TYPE_CODES2 = ["missed_in", "missed_out", "offsite", "whole_day", "night_shift"];
  const shape = (v) => ({
    version: v.version,
    monthly_cap: v.monthly_cap,
    lookback_days: v.lookback_days,
    enabled_types: TYPE_CODES2.filter((t) => v.enabled_types.includes(t)),
    require_note_on_approve: v.require_note_on_approve,
    self_approval_allowed: false,
    created_by: v.created_by_name ?? creator[0]?.name,
    created_at: formatTimestamp(v.created_at)
  });
  return {
    policy: shape(p),
    history: history.map(shape),
    trail: trail.map((a) => ({
      seq: Number(a.seq),
      actor: a.actor_name,
      actor_role: a.actor_role,
      verb: a.verb,
      subject_type: a.subject_type,
      subject_id: Number(a.subject_id),
      request_id: a.request_id ?? null,
      occurred_at: formatTimestamp(a.occurred_at),
      note: a.note ?? null
    }))
  };
}
async function loadCalendar(viewer, month, person) {
  const scopePeople = await calendarScope(viewer);
  const days = await calendarCounts(month, scopePeople, person || null);
  return {
    month,
    days,
    people: scopePeople.map((p) => ({ id: p.id, name: p.name, work_address: p.work_address }))
  };
}
async function loadDetail(viewer, id) {
  const { requestDetail } = await import("./api-Cdsw79Dd.js");
  return requestDetail(viewer, id);
}
async function loadShareMonth(token) {
  return readShareMonth(token);
}
const data_server = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  loadCalendar,
  loadDetail,
  loadPolicyFull,
  loadPolicyVersion,
  loadQueue,
  loadShareMonth,
  resolveViewer,
  viewerFromRequest
}, Symbol.toStringTag, { value: "Module" }));
export {
  LEAVE_LABELS as L,
  data_server as d,
  projectLeaveKind as p,
  scopeSql as s
};
