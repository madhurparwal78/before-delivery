// Schools, rosters and delivery-day notices. Roster status and counts are computed at request time from the rows.

import type { Roster, RosterRow, School, User } from "../../shared/api.js";
import { formatDate } from "../../shared/storeTime.js";
import { DELIVERY_STATUS_WORDS, instrumentLabel, type ContractStatus, type DeliveryStatus,
  type InstrumentType, type Size } from "../../shared/vocabulary.js";
import { now, serverNowStamp } from "../clock.js";
import { pool, query, transaction, type Queryable } from "../db/pool.js";
import { notFound, validationFailed } from "../http/errors.js";
import { fieldOf } from "../http/fields.js";
import { queueEmail } from "../services/mail.js";
import { csvText } from "../csv.js";
import { upcomingDeliveryDays } from "./deliveryDays.js";

interface SchoolRow { id: string; name: string; delivery_weekday: number }

function schoolBody(row: SchoolRow, at: Date): School {
  const days = upcomingDeliveryDays(row.delivery_weekday, at);
  return { id: row.id, name: row.name, delivery_weekday: row.delivery_weekday, next_delivery_date: days[0].date,
    cutoff_at: days[0].cutoff_at, upcoming_delivery_days: days };
}

export async function listSchools(): Promise<unknown> {
  const rows = await query<SchoolRow>(pool, "SELECT id, name, delivery_weekday FROM schools ORDER BY position");
  const at = now();
  return { schools: rows.map((row) => schoolBody(row, at)), server_now: serverNowStamp() };
}

/** The school a caller may see a roster for: directors only their own, the owner any; otherwise 404. */
async function rosterSchool(db: Queryable, user: User, id: string): Promise<SchoolRow> {
  const [school] = await query<SchoolRow>(db, "SELECT id, name, delivery_weekday FROM schools WHERE id = $1", [id]);
  if (school === undefined || (user.role === "director" && user.school_id !== id)) throw notFound();
  return school;
}

/** A roster status for a student's current contract (their newest that is not expired). */
function deliveryStatusOf(status: ContractStatus | null): DeliveryStatus {
  switch (status) {
    case "reserved": case "agreement_sent": return "awaiting_agreement";
    case "signed": return "scheduled";
    case "active": return "delivered";
    case "paid_off": return "owned";
    default: return "no_instrument";
  }
}

async function rosterRows(db: Queryable, schoolId: string): Promise<RosterRow[]> {
  const rows = await query<{ student_id: string; student_name: string; grade: number; status: ContractStatus | null;
    instrument_type: InstrumentType | null; size: Size | null; serial: string | null; delivery_date: string | null }>(db, `
    SELECT s.id AS student_id, s.name AS student_name, s.grade, c.status, i.instrument_type, i.size,
      c.instrument_serial AS serial, c.delivery_date
    FROM students s
    LEFT JOIN LATERAL (SELECT status, instrument_serial, delivery_date FROM contracts
      WHERE student_id = s.id AND status <> 'expired' ORDER BY created_order DESC LIMIT 1) c ON TRUE
    LEFT JOIN instruments i ON i.serial = c.instrument_serial
    WHERE s.school_id = $1`, [schoolId]);
  return rows.map((r) => {
    const delivery_status = deliveryStatusOf(r.status);
    const holds = delivery_status !== "no_instrument";
    return { student_id: r.student_id, student_name: r.student_name, grade: r.grade,
      instrument_type: holds ? r.instrument_type : null, size: holds ? r.size : null, serial: holds ? r.serial : null,
      delivery_date: holds ? r.delivery_date : null, delivery_status };
  }).sort((a, b) => (a.student_name < b.student_name ? -1 : a.student_name > b.student_name ? 1 : 0));
}

export async function roster(user: User, schoolId: string): Promise<Roster> {
  const school = await rosterSchool(pool, user, schoolId);
  const students = await rosterRows(pool, schoolId);
  const counts: Roster["counts"] = { no_instrument: 0, awaiting_agreement: 0, scheduled: 0, delivered: 0, owned: 0 };
  for (const row of students) counts[row.delivery_status] += 1;
  return { school, next_delivery_date: upcomingDeliveryDays(school.delivery_weekday, now(), 1)[0].date, counts, students };
}

export async function rosterCsv(user: User, schoolId: string): Promise<{ text: string }> {
  const { students } = await roster(user, schoolId);
  const header = ["Student", "Grade", "Instrument", "Size", "Serial", "Delivery date", "Delivery status"];
  return { text: csvText([header, ...students.map((r) => [r.student_name, r.grade,
    r.instrument_type !== null && r.size !== null ? instrumentLabel(r.instrument_type, r.size) : "", r.size ?? "",
    r.serial ?? "", r.delivery_date ?? "", DELIVERY_STATUS_WORDS[r.delivery_status]])]) };
}

export async function sendDeliveryNotice(schoolId: string, body: unknown): Promise<unknown> {
  return transaction(async (db) => {
    const [school] = await query<SchoolRow & { director_email: string }>(db, `SELECT sc.id, sc.name, sc.delivery_weekday,
      u.email AS director_email FROM schools sc JOIN users u ON u.school_id = sc.id AND u.role = 'director'
      WHERE sc.id = $1`, [schoolId]);
    if (school === undefined) throw notFound();
    const date = fieldOf(body, "delivery_date");
    if (typeof date !== "string" || !upcomingDeliveryDays(school.delivery_weekday, now()).some((d) => d.date === date)) {
      throw validationFailed({ delivery_date: "Pick one of this school's upcoming delivery days." });
    }
    const manifest = await query<{ student_name: string; instrument_type: InstrumentType; size: Size; serial: string }>(db, `
      SELECT s.name AS student_name, i.instrument_type, i.size, c.instrument_serial AS serial
      FROM contracts c JOIN students s ON s.id = c.student_id JOIN instruments i ON i.serial = c.instrument_serial
      WHERE s.school_id = $1 AND c.delivery_date = $2 AND c.status IN ('reserved', 'agreement_sent', 'signed', 'active')
      ORDER BY s.name COLLATE "C"`, [schoolId, date]);
    await queueEmail(db, {
      to: school.director_email, subject: `Delivery day ${formatDate(date)} — ${school.name}`,
      body: [`Instruments arriving at ${school.name} on ${formatDate(date)}:`, "",
        ...(manifest.length > 0 ? manifest.map((m) => `${m.student_name} — ${instrumentLabel(m.instrument_type, m.size)} — ${m.serial}`)
          : ["No instruments are scheduled for this day."]), "", "Keel & Bell Music"].join("\n"),
    });
    return { recipient: school.director_email, delivery_date: date, student_count: manifest.length };
  });
}
