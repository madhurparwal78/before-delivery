import { randomUUID } from "node:crypto";
import { type Db, query } from "../db";
import { dueLine, localDeadlineLabel, offsetHours, practiceDeadlineLabel, practiceMoment, toIso } from "../domain/labels";
import { fromCents } from "../domain/money";
import { isOverdue, isPast } from "../domain/overdue";
import { LEADS, reminderAt } from "../domain/reminders";
import { baseDueDate, editionFor, periodLabel, periodStart, schedule } from "../domain/schedule";
import { allowedActions, PACKET_WAITING, UNFILED } from "../domain/status";
import { zoneLabel } from "../domain/zone";
import { STATUS_LABELS } from "../../shared/types";
import { countsOf } from "../../shared/counts";
import type { Amendment, Approval, Edition, Frequency, ReturnList, ReturnView, StateInfo, Status, Tone } from "../../shared/types";
import { getPractice, nowOf, type Practice } from "./practice";
import { getStates } from "./states";

export interface ReturnRow {
  id: string; practice_id: string; client_id: string; registration_id: string; state_code: string;
  frequency: Frequency; period: string; period_start: string; status: Status; version: number;
  gross_cents: number | null; tax_cents: number | null; edition_effective: string; base_date: string;
  extension_days: number | null; nominal_date: string; due_date: string; due_at: string;
  ext_granted_at: string | null; ext_due_date_before: string | null; ext_due_at_before: string | null;
  awaiting_approval: boolean; filed_at: string | null; changed_by: string;
}

interface ViewRow extends ReturnRow {
  client_name: string; state_name: string; zone: string; due_day: number; carry: Edition["carry"]; rate: string;
  allowance: number; revisions: number;
}

export interface ReturnFilter {
  ids?: string[];
  clientId?: string;
  dueFrom?: string;
  dueBefore?: string;
  state?: string;
}

const TONES: Tone[] = ["orange", "sage", "yellow", "black"];

const VIEW_SQL = `
  SELECT r.*, c.name AS client_name, s.name AS state_name, s.zone, e.due_day, e.carry, e.rate,
         e.extension_days AS allowance,
         (SELECT count(*)::int FROM packet_revisions p WHERE p.return_id = r.id) AS revisions
  FROM returns r
  JOIN clients c ON c.id = r.client_id
  JOIN states s ON s.practice_id = r.practice_id AND s.code = r.state_code
  JOIN editions e ON e.practice_id = r.practice_id AND e.state_code = r.state_code AND e.effective_date = r.edition_effective`;

interface ApprovalRow { return_id: string; action: Approval["action"]; by_name: string; at: string; reason: string | null }
interface AmendmentRow {
  return_id: string; at: string; by_name: string; note: string | null; original_gross_cents: number;
  original_tax_cents: number; amended_gross_cents: number; amended_tax_cents: number;
}

export async function loadViews(db: Db, practice: Practice, filter: ReturnFilter = {}): Promise<ReturnView[]> {
  const where = ["r.practice_id = $1"];
  const params: unknown[] = [practice.id];
  const add = (clause: string, value: unknown) => {
    params.push(value);
    where.push(clause.replace("?", `$${params.length}`));
  };
  if (filter.ids) add("r.id = ANY(?)", filter.ids);
  if (filter.clientId) add("r.client_id = ?", filter.clientId);
  if (filter.dueFrom) add("r.due_date >= ?", filter.dueFrom);
  if (filter.dueBefore) add("r.due_date < ?", filter.dueBefore);
  if (filter.state) add("r.state_code = ?", filter.state);
  const rows = await query<ViewRow>(
    db, `${VIEW_SQL} WHERE ${where.join(" AND ")} ORDER BY r.due_at, c.name COLLATE "C", r.state_code, r.id`, params);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const approvals = await query<ApprovalRow>(db, "SELECT * FROM approvals WHERE return_id = ANY($1) ORDER BY id", [ids]);
  const amendments = await query<AmendmentRow>(db, "SELECT * FROM amendments WHERE return_id = ANY($1) ORDER BY id", [ids]);
  const codes = await query<{ code: string }>(db, `SELECT code FROM states WHERE practice_id = $1 ORDER BY code COLLATE "C"`, [practice.id]);
  const now = nowOf(practice);
  return rows.map((row) => toView(row, now,
    TONES[codes.findIndex((c) => c.code === row.state_code) % TONES.length],
    approvals.filter((a) => a.return_id === row.id)
      .map((a) => ({ action: a.action, by: a.by_name, at: a.at, when: practiceMoment(Date.parse(a.at)), reason: a.reason })),
    amendments.filter((a) => a.return_id === row.id).map(toAmendment)));
}

const toAmendment = (a: AmendmentRow): Amendment => ({
  at: a.at, when: practiceMoment(Date.parse(a.at)), by: a.by_name, note: a.note,
  original: { gross_sales: fromCents(a.original_gross_cents)!, tax_due: fromCents(a.original_tax_cents)! },
  amended: { gross_sales: fromCents(a.amended_gross_cents)!, tax_due: fromCents(a.amended_tax_cents)! },
});

function toView(row: ViewRow, now: number, stateTone: Tone, approvals: Approval[], amendments: Amendment[]): ReturnView {
  const dueAt = Date.parse(row.due_at);
  const overdue = isOverdue(row.status, dueAt, now);
  return {
    id: row.id, client: { id: row.client_id, name: row.client_name }, registration_id: row.registration_id,
    state: row.state_code, state_name: row.state_name, zone: row.zone, zone_label: zoneLabel(row.zone),
    frequency: row.frequency, period: row.period, period_label: periodLabel(row.frequency, row.period),
    status: row.status, status_label: STATUS_LABELS[row.status], overdue, awaiting_approval: row.awaiting_approval,
    version: row.version, gross_sales: fromCents(row.gross_cents), tax_due: fromCents(row.tax_cents),
    nominal_due_date: row.nominal_date, due_date: row.due_date,
    carried_from: row.due_date === row.nominal_date ? null : row.nominal_date,
    due_at: row.due_at, due_line: dueLine(row.due_date, row.zone),
    local_deadline_label: localDeadlineLabel(dueAt, row.zone), practice_deadline_label: practiceDeadlineLabel(dueAt),
    offset_hours: offsetHours(dueAt, row.zone),
    edition: { effective_date: row.edition_effective, due_day: row.due_day, carry: row.carry, rate: row.rate,
      extension_days: row.allowance },
    approvals,
    extension: row.ext_granted_at && row.extension_days !== null ? {
      granted_at: row.ext_granted_at, extension_days: row.extension_days,
      due_date_before: row.ext_due_date_before!, due_at_before: row.ext_due_at_before!,
    } : null,
    amendments, filed_at: row.filed_at,
    packet: row.status === "packeted" ? "ready" : PACKET_WAITING.includes(row.status) ? "pending" : "none",
    packet_revisions: row.revisions, changed_by: row.changed_by,
    past: isPast(dueAt, now),
    tone: overdue ? "black" : stateTone,
    allowed: allowedActions(row.status, { awaitingApproval: row.awaiting_approval, extended: row.ext_granted_at !== null }),
  };
}

export async function loadView(db: Db, id: string): Promise<ReturnView> {
  const [owner] = await query<{ practice_id: string }>(db, "SELECT practice_id FROM returns WHERE id = $1", [id]);
  const practice = await getPractice(db, owner.practice_id);
  return (await loadViews(db, practice, { ids: [id] }))[0];
}

export const listOf = (returns: ReturnView[]): ReturnList => ({ returns, counts: countsOf(returns) });

/** A status filter: an API status, or `overdue`. */
export const matchesStatus = (view: ReturnView, status: string): boolean =>
  status === "overdue" ? view.overdue : view.status === status;

export async function lockReturn(db: Db, id: string): Promise<ReturnRow> {
  const [row] = await query<ReturnRow>(db, "SELECT * FROM returns WHERE id = $1 FOR UPDATE", [id]);
  return row;
}

/** Filing cancels every reminder that was not sent yet; the sent ones stay. */
export async function cancelPendingReminders(db: Db, returnId: string): Promise<void> {
  await db.query("DELETE FROM reminders WHERE return_id = $1 AND status = 'pending'", [returnId]);
}

/** Creates or moves the 7-day and 1-day reminders; a reminder that was already sent keeps its time. */
async function syncReminders(db: Db, returnId: string, dueDate: string, hour: number): Promise<void> {
  for (const lead of LEADS) {
    await db.query(
      `INSERT INTO reminders (return_id, lead_days, scheduled_for) VALUES ($1, $2, $3)
       ON CONFLICT (return_id, lead_days) DO UPDATE SET scheduled_for = EXCLUDED.scheduled_for
       WHERE reminders.status = 'pending'`,
      [returnId, lead, toIso(reminderAt(dueDate, lead, hour))]);
  }
}

export async function insertReturn(db: Db, input: {
  practiceId: string; clientId: string; registrationId: string; state: StateInfo; frequency: Frequency;
  period: string; reminderHour: number; changedBy: string;
}): Promise<string> {
  const id = randomUUID();
  const start = periodStart(input.frequency, input.period);
  const edition = editionFor(input.state.editions, start);
  const base = baseDueDate(input.frequency, input.period, edition.due_day);
  const due = schedule(base, null, edition.carry, input.state.holidays, input.state.zone);
  await db.query(
    `INSERT INTO returns (id, practice_id, client_id, registration_id, state_code, frequency, period, period_start,
       status, edition_effective, base_date, nominal_date, due_date, due_at, changed_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'not_started',$9,$10,$11,$12,$13,$14)`,
    [id, input.practiceId, input.clientId, input.registrationId, input.state.code, input.frequency, input.period, start,
      edition.effective_date, base, due.nominalDate, due.dueDate, toIso(due.dueAt), input.changedBy]);
  await syncReminders(db, id, due.dueDate, input.reminderHour);
  return id;
}

/** Recomputes a return's dates from an edition, extension and holiday list; true when anything moved. */
export async function applySchedule(db: Db, row: ReturnRow, input: {
  edition: Edition; extensionDays: number | null; state: Pick<StateInfo, "zone" | "holidays">; hour: number;
  changedBy: string; grantedAt?: number;
}): Promise<boolean> {
  const base = baseDueDate(row.frequency, row.period, input.edition.due_day);
  const due = schedule(base, input.extensionDays, input.edition.carry, input.state.holidays, input.state.zone);
  const moved = input.edition.effective_date !== row.edition_effective || base !== row.base_date
    || due.nominalDate !== row.nominal_date || due.dueDate !== row.due_date || due.dueAt !== Date.parse(row.due_at);
  if (!moved && input.grantedAt === undefined) return false;
  const granted = input.grantedAt === undefined ? [null, null, null] : [toIso(input.grantedAt), row.due_date, row.due_at];
  await db.query(
    `UPDATE returns SET edition_effective = $2, base_date = $3, extension_days = $4, nominal_date = $5, due_date = $6,
       due_at = $7, version = version + 1, changed_by = $8,
       ext_granted_at = COALESCE($9, ext_granted_at), ext_due_date_before = COALESCE($10, ext_due_date_before),
       ext_due_at_before = COALESCE($11, ext_due_at_before)
     WHERE id = $1`,
    [row.id, input.edition.effective_date, base, input.extensionDays, due.nominalDate, due.dueDate, toIso(due.dueAt),
      input.changedBy, ...granted]);
  await syncReminders(db, row.id, due.dueDate, input.hour);
  return true;
}

/** Recalculates the `not_started` returns of a state after an edition or a holiday change. */
export async function recalculate(db: Db, practice: Practice, code: string, changedBy: string,
  since?: string): Promise<{ matching: string[]; moved: string[] }> {
  const state = (await getStates(db, practice.id)).find((s) => s.code === code)!;
  const rows = await query<ReturnRow>(
    db, `SELECT * FROM returns WHERE practice_id = $1 AND state_code = $2 AND status = 'not_started'
         ${since ? "AND period_start >= $3" : ""} ORDER BY id FOR UPDATE`,
    since ? [practice.id, code, since] : [practice.id, code]);
  const moved: string[] = [];
  for (const row of rows) {
    const edition = since ? editionFor(state.editions, row.period_start)
      : state.editions.find((e) => e.effective_date === row.edition_effective)!;
    if (await applySchedule(db, row, { edition, extensionDays: row.extension_days, state, hour: practice.reminderHour, changedBy })) {
      moved.push(row.id);
    }
  }
  return { matching: rows.map((r) => r.id), moved };
}

/** Moves every unsent reminder of an unfiled return to the practice's reminder hour. */
export async function rescheduleReminders(db: Db, practiceId: string, hour: number): Promise<void> {
  const rows = await query<{ id: string; due_date: string }>(
    db, "SELECT id, due_date FROM returns WHERE practice_id = $1 AND status = ANY($2)", [practiceId, [...UNFILED]]);
  for (const row of rows) await syncReminders(db, row.id, row.due_date, hour);
}
