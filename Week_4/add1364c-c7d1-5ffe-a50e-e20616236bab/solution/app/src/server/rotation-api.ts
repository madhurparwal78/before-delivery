import type { Db } from "./db.js";
import { db, write } from "./db.js";
import { record } from "./audit.js";
import { now } from "./clock.js";
import { newId } from "./crypto.js";
import { Fields, checkBody, conflict, forbidden, invalid, notFound, type Spec } from "./http.js";
import { isDesk, type CredentialRow, type PersonRow, type RotationRow, type TurnRow } from "./model.js";
import { addDays, businessDaysAfter, isRealDate, officeDate, officeInstant, officeMidnight, officeMoment } from "./office-time.js";
import { actorOf } from "./people.js";
import { rotationJson, runJson, runsInDates } from "./rotations.js";
import { loginSubject } from "./drawer.js";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const ROTATION: Spec = {
  credential_id: { kind: "string" },
  interval_days: { kind: "integer" },
  at_time: { kind: "string" },
  first_run_on: { kind: "string" },
};
const ROTATION_CHANGE: Spec = {
  credential_id: { kind: "string" },
  interval_days: { kind: "integer" },
  at_time: { kind: "string" },
  first_run_on: { kind: "string" },
};

function checkSchedule(v: Record<string, unknown>, fields: Fields, at: Date): void {
  if (typeof v.interval_days === "number" && (v.interval_days < 1 || v.interval_days > 365)) fields.add("interval_days", "Use a whole number from 1 to 365.");
  if (typeof v.at_time === "string" && !TIME.test(v.at_time)) fields.add("at_time", "Use a time like 09:00.");
  if (typeof v.first_run_on === "string") {
    if (!isRealDate(v.first_run_on) || v.first_run_on < officeDate(at)) fields.add("first_run_on", "Pick today or a later date.");
    else if (typeof v.at_time === "string" && TIME.test(v.at_time) && officeInstant(v.first_run_on, v.at_time).at.getTime() <= at.getTime()) {
      fields.add("first_run_on", "The first run must be in the future.");
    }
  }
}

function requireOffice(actor: PersonRow): void {
  if (actor.role !== "office_manager") throw forbidden();
}

export async function scheduleRotation(actor: PersonRow, body: unknown): Promise<Record<string, unknown>> {
  return write(async (tx) => {
    requireOffice(actor);
    const fields = new Fields();
    const v = checkBody(body, ROTATION, fields);
    const at = now();
    const login = typeof v.credential_id === "string" ? await tx.one<CredentialRow>("SELECT * FROM credentials WHERE id = $1", [v.credential_id]) : null;
    if (v.credential_id !== undefined && !login) fields.add("credential_id", "Pick a login that exists.");
    if (login && (await tx.one("SELECT 1 FROM rotations WHERE credential_id = $1", [login.id]))) {
      throw conflict("rotation_exists", "This login already has a rotation.");
    }
    checkSchedule(v, fields, at);
    fields.throwIfAny();
    if (!login) throw new Error("login was validated");
    const id = newId();
    await tx.query(
      "INSERT INTO rotations (id, credential_id, interval_days, at_time, first_run_on, since, created_at) VALUES ($1,$2,$3,$4,$5,$6,$6)",
      [id, login.id, v.interval_days, v.at_time, v.first_run_on, at],
    );
    await record(tx, actorOf(actor), "rotation_schedule", loginSubject(login), { rotation_id: id, interval_days: v.interval_days, at_time: v.at_time, first_run_on: v.first_run_on });
    const row = await tx.one<RotationRow>("SELECT * FROM rotations WHERE id = $1", [id]);
    return row ? rotationJson(row, at) : {};
  });
}

export async function changeRotation(actor: PersonRow, id: string, body: unknown): Promise<Record<string, unknown>> {
  return write(async (tx) => {
    const rotation = await tx.one<RotationRow>("SELECT * FROM rotations WHERE id = $1", [id]);
    if (!rotation) throw notFound();
    requireOffice(actor);
    const login = await tx.one<CredentialRow>("SELECT * FROM credentials WHERE id = $1", [rotation.credential_id]);
    if (!login) throw notFound();
    const fields = new Fields();
    const v = checkBody(body, ROTATION_CHANGE, fields);
    const at = now();
    if (typeof v.credential_id === "string" && v.credential_id !== rotation.credential_id) fields.add("credential_id", "A rotation stays with its login.");
    checkSchedule(v, fields, at);
    fields.throwIfAny();
    await tx.query("UPDATE rotations SET interval_days = $2, at_time = $3, first_run_on = $4, since = $5 WHERE id = $1", [
      id,
      v.interval_days,
      v.at_time,
      v.first_run_on,
      at,
    ]);
    await record(tx, actorOf(actor), "rotation_change", loginSubject(login), { rotation_id: id, interval_days: v.interval_days, at_time: v.at_time, first_run_on: v.first_run_on });
    const row = await tx.one<RotationRow>("SELECT * FROM rotations WHERE id = $1", [id]);
    return row ? rotationJson(row, at) : {};
  });
}

export async function showRotation(viewer: PersonRow, id: string): Promise<Record<string, unknown>> {
  const rotation = await db.one<RotationRow>("SELECT * FROM rotations WHERE id = $1", [id]);
  if (!rotation) throw notFound();
  if (!isDesk(viewer.role)) throw forbidden();
  return rotationJson(rotation, now());
}

// ---- the rotation calendar ----

interface CalendarTurn extends TurnRow {
  label: string;
  vendor_name: string;
  vendor_formerly: string | null;
}

async function calendarTurns(reader: Db, from: string, to: string): Promise<CalendarTurn[]> {
  return reader.query<CalendarTurn>(
    `SELECT t.*, c.label, v.name AS vendor_name, v.formerly AS vendor_formerly
     FROM turns t JOIN credentials c ON c.id = t.credential_id JOIN vendors v ON v.id = c.vendor_id
     WHERE (t.kind = 'scheduled' AND t.run_date BETWEEN $1 AND $2) OR (t.kind = 'scope_loss' AND t.due_by BETWEEN $1 AND $2)
     ORDER BY t.ord`,
    [from, to],
  );
}

function monthBounds(month: string): { from: string; to: string } {
  const from = `${month}-01`;
  const next = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 10);
  return { from, to: addDays(next, -1) };
}

export async function calendar(viewer: PersonRow, month: string | null): Promise<Record<string, unknown>> {
  if (!isDesk(viewer.role)) throw forbidden();
  const chosen = month ?? officeDate(now()).slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(chosen)) throw invalid({ month: "Use a month like 2027-03." });
  const { from, to } = monthBounds(chosen);
  const [turns, rotations, logins] = await Promise.all([
    calendarTurns(db, from, to),
    db.query<RotationRow>("SELECT * FROM rotations"),
    db.query<CredentialRow & { vendor_name: string; vendor_formerly: string | null }>(
      "SELECT c.*, v.name AS vendor_name, v.formerly AS vendor_formerly FROM credentials c JOIN vendors v ON v.id = c.vendor_id",
    ),
  ]);
  const days: Array<{ office_date: string; offset: string; entries: Array<Record<string, unknown>> }> = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    days.push({ office_date: date, offset: officeMoment(officeMidnight(date)).offset, entries: [] });
  }
  const dayOf = (date: string): { entries: Array<Record<string, unknown>> } | undefined => days.find((day) => day.office_date === date);
  for (const turn of turns) {
    const scheduled = turn.kind === "scheduled" && turn.run_at && turn.run_date;
    const moment = turn.run_at ? officeMoment(turn.run_at) : null;
    dayOf(scheduled ? (turn.run_date ?? from) : turn.due_by)?.entries.push({
      turn_id: turn.id,
      rotation_id: turn.rotation_id,
      credential_id: turn.credential_id,
      label: turn.label,
      vendor: { name: turn.vendor_name, formerly: turn.vendor_formerly },
      kind: turn.kind,
      office_time: scheduled && moment ? moment.time : null,
      offset: scheduled && moment ? moment.offset : officeMoment(officeMidnight(turn.due_by)).offset,
      at: scheduled && turn.run_at ? turn.run_at.toISOString() : null,
      shifted: scheduled ? turn.shifted : false,
      due_by: turn.due_by,
      state: turn.state,
    });
  }
  for (const rotation of rotations) {
    const login = logins.find((candidate) => candidate.id === rotation.credential_id);
    if (!login) continue;
    for (const run of runsInDates(rotation, from, to)) {
      if (run.at.getTime() <= rotation.since.getTime()) continue;
      if (turns.some((turn) => turn.rotation_id === rotation.id && turn.run_at?.getTime() === run.at.getTime())) continue;
      dayOf(run.office_date)?.entries.push({
        turn_id: null,
        rotation_id: rotation.id,
        credential_id: rotation.credential_id,
        label: login.label,
        vendor: { name: login.vendor_name, formerly: login.vendor_formerly },
        kind: "scheduled",
        office_time: run.office_time,
        offset: run.offset,
        at: runJson(run).at,
        shifted: run.shifted,
        due_by: businessDaysAfter(run.office_date, 2),
        state: "scheduled",
      });
    }
  }
  for (const day of days) {
    day.entries.sort((a, b) => String(a.office_time ?? "99:99").localeCompare(String(b.office_time ?? "99:99")) || String(a.label).localeCompare(String(b.label)));
  }
  return { month: chosen, days };
}
