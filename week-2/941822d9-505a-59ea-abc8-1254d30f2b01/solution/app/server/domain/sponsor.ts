import { randomUUID } from "node:crypto";
import { db, one, tx } from "../db.js";
import { notFound, Validation } from "../http/errors.js";
import { getObject, putOnce } from "../services/storage.js";
import { formatHours, parsePercent } from "./amounts.js";
import { CERTIFICATE_SELECT, certificatesJson, certificateViews, type CertificateRow } from "./certificates.js";
import { coverageJson, scheduleCoverage } from "./coverage.js";
import { isId } from "./courses.js";
import { ENROLMENT_SELECT, enrolmentsJson, fundedBySql, type EnrolmentRow } from "./enrolments.js";
import { expireDuePacks, sponsorHospital } from "./packs.js";
import { providerToday } from "./provider.js";
import { inclusiveDays, isCalendarDate } from "./time.js";
import type { SessionUser } from "./users.js";

// Every sponsor figure is computed on each read from the coordinator's own hospital's ledger and certificate rows.

export async function dashboard(coordinator: SessionUser, at: Date): Promise<Record<string, unknown>> {
  const hospital = sponsorHospital(coordinator);
  await expireDuePacks(hospital.id, at);
  const seats = await one<{ purchased: number; assigned: number; available: number; expired: number }>(
    db,
    `SELECT coalesce(-sum(l.seats) FILTER (WHERE l.account = 'purchases'), 0) AS purchased,
            coalesce(sum(l.seats) FILTER (WHERE l.account LIKE 'nurse:%'), 0) AS assigned,
            coalesce(sum(l.seats) FILTER (WHERE l.account = 'pack'), 0) AS available,
            coalesce(sum(l.seats) FILTER (WHERE l.account = 'expired'), 0) AS expired
       FROM ledger_entries l JOIN seat_packs p ON p.id = l.pack_id WHERE p.hospital_id = $1`,
    [hospital.id],
  );
  const awarded = await one<{ completions: number; quarters: number }>(
    db,
    `SELECT count(*) AS completions, coalesce(sum(x.contact_quarters), 0) AS quarters
       FROM certificates x JOIN enrolments e ON e.id = x.enrolment_id
      WHERE x.state = 'sealed' AND ${fundedBySql("$1")}`,
    [hospital.id],
  );
  return {
    seats_purchased: seats?.purchased ?? 0,
    seats_assigned: seats?.assigned ?? 0,
    seats_available: seats?.available ?? 0,
    seats_expired: seats?.expired ?? 0,
    completions: awarded?.completions ?? 0,
    hours_awarded: formatHours(awarded?.quarters ?? 0),
    coverage: await coverageJson(db, hospital.id, at),
  };
}

export async function changeCoverage(coordinator: SessionUser, body: Record<string, unknown>, at: Date): Promise<Record<string, unknown>> {
  const hospital = sponsorHospital(coordinator);
  const v = new Validation(body, ["coverage_percent", "effective_on"]);
  const basisPoints = parsePercent(body.coverage_percent);
  if (basisPoints === null) v.add("coverage_percent", "Enter a percentage from 0 to 100 with at most two decimals.");
  const effectiveOn = body.effective_on;
  if (!isCalendarDate(effectiveOn) || effectiveOn < providerToday(at)) v.add("effective_on", "Choose today or a later date.");
  v.done();
  await tx((t) => scheduleCoverage(t, hospital.id, basisPoints ?? 0, String(effectiveOn), at));
  return coverageJson(db, hospital.id, at);
}

const SEARCH_LIMIT = 100;

/** Search text: matched literally and case-insensitively, at most 100 characters. */
export function searchText(query: URLSearchParams): string {
  const q = query.get("q") ?? "";
  const v = new Validation({}, []);
  if (q.length > SEARCH_LIMIT) v.add("q", "Search with at most 100 characters.");
  v.done();
  return q;
}

export async function searchNurses(coordinator: SessionUser, q: string): Promise<Record<string, unknown>[]> {
  const hospital = sponsorHospital(coordinator);
  const rows = await db.q<{ id: string; display_name: string; email: string; seats_held: number; quarters: number }>(
    `SELECT u.id, u.display_name, u.email,
            coalesce((SELECT sum(l.seats) FROM ledger_entries l JOIN seat_packs p ON p.id = l.pack_id
                       WHERE p.hospital_id = $1 AND l.account = 'nurse:' || u.id::text), 0) AS seats_held,
            (SELECT coalesce(sum(x.contact_quarters), 0) FROM certificates x JOIN enrolments e ON e.id = x.enrolment_id
              WHERE x.learner_id = u.id AND x.state = 'sealed' AND ${fundedBySql("$1")}) AS quarters
       FROM users u
      WHERE u.organisation_id = $1 AND u.role = 'learner'
        AND ($2 = '' OR strpos(lower(u.display_name), lower($2)) > 0 OR strpos(lower(u.email), lower($2)) > 0)
      ORDER BY u.display_name`,
    [hospital.id, q],
  );
  return rows.map((r) => ({ id: r.id, display_name: r.display_name, email: r.email, seats_held: r.seats_held, hours_completed: formatHours(r.quarters) }));
}


/** A nurse's record limited to the enrolments this hospital funded; a nurse with none answers 404. */
export async function nurseRecord(coordinator: SessionUser, id: unknown): Promise<Record<string, unknown>> {
  if (!isId(id) || coordinator.role !== "coordinator") throw notFound();
  const hospital = sponsorHospital(coordinator);
  const nurse = await one<{ id: string; display_name: string; email: string }>(db, "SELECT id, display_name, email FROM users WHERE id = $1", [id]);
  const enrolments = await db.q<EnrolmentRow>(`${ENROLMENT_SELECT} WHERE e.learner_id = $1 AND ${fundedBySql("$2")} ORDER BY e.enrolled_at DESC`, [id, hospital.id]);
  if (!nurse || enrolments.length === 0) throw notFound();
  const certificates = await db.q<CertificateRow>(`${CERTIFICATE_SELECT} WHERE x.learner_id = $1 AND ${fundedBySql("$2")} ORDER BY x.created_at DESC`, [id, hospital.id]);
  return {
    learner: nurse,
    enrolments: await enrolmentsJson(db, enrolments),
    certificates: await certificatesJson(db, certificates),
  };
}

export async function monthlyReport(coordinator: SessionUser, query: URLSearchParams): Promise<Record<string, unknown>> {
  const hospital = sponsorHospital(coordinator);
  const raw = query.get("year") ?? "";
  const year = /^\d{4}$/.test(raw) ? parseInt(raw, 10) : 0;
  const v = new Validation({}, []);
  if (year < 2000 || year > 2100) v.add("year", "Choose a year from 2000 to 2100.");
  v.done();
  const rows = await db.q<{ month: string; completions: number; quarters: number }>(
    `SELECT to_char(x.issued_on, 'YYYY-MM') AS month, count(*) AS completions, sum(x.contact_quarters) AS quarters
       FROM certificates x JOIN enrolments e ON e.id = x.enrolment_id
      WHERE x.state = 'sealed' AND ${fundedBySql("$1")}
        AND x.issued_on BETWEEN make_date($2, 1, 1) AND make_date($2, 12, 31)
      GROUP BY 1`,
    [hospital.id, year],
  );
  const months = Array.from({ length: 12 }, (_, index) => {
    const month = `${year}-${String(index + 1).padStart(2, "0")}`;
    const found = rows.find((r) => r.month === month);
    return { month, completions: found?.completions ?? 0, hours: formatHours(found?.quarters ?? 0) };
  });
  return { year, months };
}

const FORMULA_START = /^[=+\-@\t\r]/;

/** One CSV cell: a leading apostrophe on anything a spreadsheet would run, then RFC 4180 quoting. */
function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

const CSV_HEADER = ["nurse_name", "nurse_email", "course_title", "serial", "issued_on", "contact_hours", "funding"];

export async function createExport(coordinator: SessionUser, body: Record<string, unknown>, at: Date): Promise<Record<string, unknown>> {
  const hospital = sponsorHospital(coordinator);
  const v = new Validation(body, ["from", "to"]);
  const { from, to } = body;
  if (!isCalendarDate(from)) v.add("from", "Enter a start date as YYYY-MM-DD.");
  if (!isCalendarDate(to)) v.add("to", "Enter an end date as YYYY-MM-DD.");
  else if (isCalendarDate(from) && from > to) v.add("to", "The end date must be on or after the start date.");
  else if (isCalendarDate(from) && inclusiveDays(from, to) > 366) v.add("to", "Export at most 366 days at a time.");
  v.done();
  const rows = await db.q<CertificateRow>(
    `${CERTIFICATE_SELECT} WHERE x.state = 'sealed' AND x.issued_on BETWEEN $1 AND $3 AND ${fundedBySql("$2")} ORDER BY x.issued_on, x.serial`,
    [from, hospital.id, to],
  );
  const lines = [CSV_HEADER.join(",")];
  for (const view of await certificateViews(db, rows)) {
    lines.push(
      [view.current.nurse_name, view.row.learner_email, view.row.course_title, view.row.serial, view.row.issued_on ?? "", formatHours(view.row.contact_quarters), view.row.funding]
        .map(csvCell)
        .join(","),
    );
  }
  const id = randomUUID();
  const key = `exports/${hospital.slug}/${id}.csv`;
  await putOnce(key, Buffer.from(`${lines.join("\n")}\n`, "utf8"), "text/csv");
  await db.q("INSERT INTO completion_exports (id, hospital_id, from_date, to_date, row_count, object_key, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", [
    id,
    hospital.id,
    from,
    to,
    rows.length,
    key,
    coordinator.id,
    at,
  ]);
  return { id, rows: rows.length, download_url: `/api/sponsor/exports/${id}.csv` };
}

export async function readExport(coordinator: SessionUser, id: unknown): Promise<Buffer> {
  const hospital = coordinator.role === "coordinator" ? sponsorHospital(coordinator) : null;
  const found = isId(id) ? await one<{ object_key: string; hospital_id: string }>(db, "SELECT object_key, hospital_id FROM completion_exports WHERE id = $1", [id]) : undefined;
  if (!found || found.hospital_id !== hospital?.id) throw notFound();
  return getObject(found.object_key);
}
