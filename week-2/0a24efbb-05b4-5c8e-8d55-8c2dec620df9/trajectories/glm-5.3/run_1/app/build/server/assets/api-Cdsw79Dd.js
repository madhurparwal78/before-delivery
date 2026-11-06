import { query } from "./pg-C3ev9-Vg.js";
import { errors } from "./errors-DELaVzSn.js";
import { f as formatTimestamp } from "./server-build-BR0xWWlP.js";
import { s as scopeSql, L as LEAVE_LABELS, p as projectLeaveKind } from "./data.server-Bjfv_yW6.js";
import "./sessions-BB3wZhcQ.js";
import "pg";
import "react/jsx-runtime";
import "node:stream";
import "@react-router/node";
import "react-router";
import "react-dom/server";
import "react";
import "node:crypto";
function ts(date) {
  return date ? formatTimestamp(date) : null;
}
function requestShape(r, viewer) {
  return {
    id: Number(r.id),
    person: r.person_name,
    work_address: r.work_address,
    manager: r.manager_name ?? null,
    day: typeof r.day === "string" ? r.day : r.day.toISOString().slice(0, 10),
    correction_type: r.correction_type,
    claimed_in: r.claimed_in,
    claimed_out: r.claimed_out,
    reason: r.reason,
    state: r.state,
    raised_at: ts(r.raised_at),
    decided_by: r.decided_by_name ?? null,
    decided_at: ts(r.decided_at),
    decision_note: r.decision_note ?? null
  };
}
async function getRequestFull(id) {
  const rows = await query(
    `SELECT r.*, p.name AS person_name, p.work_address, p.role AS raiser_role,
            m.name AS manager_name,
            d.name AS decided_by_name
     FROM regularisation_request r
     JOIN person p ON p.id = r.person_id
     LEFT JOIN person m ON m.id = p.manager_id
     LEFT JOIN person d ON d.id = r.decided_by
     WHERE r.id = $1`,
    [id]
  );
  return rows[0] || null;
}
function dayString(d) {
  return typeof d === "string" ? d : d.toISOString().slice(0, 10);
}
async function requestDetail(viewer, id) {
  const full = await getRequestFull(id);
  if (!full) throw errors.noSuchRequest();
  const scope = scopeSql(viewer);
  const visible = await query(
    `SELECT 1 FROM regularisation_request r WHERE r.id = $${scope.params.length + 1} AND ${scope.sql}`,
    [...scope.params, id]
  );
  if (visible.length === 0) throw errors.noSuchRequest();
  dayString(full.day);
  const att = await query(
    "SELECT recorded_in, recorded_out, source FROM attendance_day WHERE person_id = $1 AND day = $2",
    [full.person_id, full.day]
  );
  const leave = await query(
    "SELECT kind, status FROM leave_day WHERE person_id = $1 AND day = $2",
    [full.person_id, full.day]
  );
  const audit = await query(
    `SELECT a.seq, a.verb, a.occurred_at, a.note, p.name AS actor_name, a.actor_role
     FROM audit_event a JOIN person p ON p.id = a.actor_id
     WHERE a.request_id = $1 ORDER BY a.seq ASC`,
    [id]
  );
  const out = {
    request: requestShape(full),
    evidence: {
      recorded_in: att[0]?.recorded_in ? ts(att[0].recorded_in) : null,
      recorded_out: att[0]?.recorded_out ? ts(att[0].recorded_out) : null,
      source: att[0]?.source ?? null
    },
    leave: leave[0] ? {
      kind: projectLeaveKind(leave[0].kind, viewer, full.person_id),
      status: leave[0].status,
      label: LEAVE_LABELS[projectLeaveKind(leave[0].kind, viewer, full.person_id)]
    } : null,
    audit: audit.map((a) => ({
      seq: Number(a.seq),
      actor: a.actor_name,
      actor_role: a.actor_role,
      verb: a.verb,
      occurred_at: ts(a.occurred_at),
      note: a.note ?? null
    }))
  };
  if (viewer.role === "admin") {
    const raiser = await query(
      "SELECT phone, private_note FROM person WHERE id = $1",
      [full.person_id]
    );
    out.contact = { phone: raiser[0]?.phone ?? null, private_note: raiser[0]?.private_note ?? null };
  }
  return out;
}
export {
  requestDetail
};
