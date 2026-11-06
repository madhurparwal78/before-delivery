// Client org admins: their schedulers and the monthly statement of posted charges.
import { AGENCY_ZONE, agencyDate } from "../shared/time.js";
import { requireRole } from "./auth.js";
import { chargesFor } from "./charges.js";
import { pool, transaction } from "./db.js";
import { ApiError, type FieldErrors, type Reply, type SignedInContext, route } from "./http.js";
import { hashPassword } from "./passwords.js";
import { loadAssignments } from "./records.js";
import { asObject } from "./validation.js";

interface SchedulerRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
}

async function listSchedulers(ctx: SignedInContext): Promise<Reply> {
  const admin = requireRole(ctx, "org_admin");
  const rows = await pool.query<SchedulerRow>(
    `SELECT id, name, email, phone FROM people
      WHERE org_code = $1 AND role = 'scheduler' AND active ORDER BY name, email`,
    [admin.orgCode],
  );
  return { status: 200, json: { schedulers: rows.rows } };
}

async function addScheduler(ctx: SignedInContext): Promise<Reply> {
  const admin = requireRole(ctx, "org_admin");
  const body = asObject(ctx.body) ?? {};
  const field = (name: string): string => (typeof body[name] === "string" ? (body[name] as string).trim() : "");
  const name = field("name");
  const email = field("email").toLowerCase();
  const phone = field("phone");
  const password = typeof body.password === "string" ? body.password : "";
  return transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`person-email-${email}`]);
    const taken = await db.query("SELECT 1 FROM people WHERE lower(email) = $1", [email]);
    if (email && taken.rowCount) throw new ApiError("email_taken");
    const errors: FieldErrors = {};
    if (name.length < 1 || name.length > 80) errors.name = "Enter a name of 1 to 80 characters.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) errors.email = "Enter a valid email address.";
    if (phone.length < 7 || phone.length > 20) errors.phone = "Enter a phone number of 7 to 20 characters.";
    if (password.length < 12) errors.password = "Use at least 12 characters.";
    if (Object.keys(errors).length > 0) throw new ApiError("validation", errors);
    const inserted = await db.query<SchedulerRow>(
      `INSERT INTO people (name, email, phone, role, org_code, password_hash)
       VALUES ($1, $2, $3, 'scheduler', $4, $5) RETURNING id, name, email, phone`,
      [name, email, phone, admin.orgCode, await hashPassword(password)],
    );
    return { status: 201, json: inserted.rows[0] };
  });
}

async function removeScheduler(ctx: SignedInContext): Promise<Reply> {
  const admin = ctx.session.person;
  const id = ctx.params.id ?? "";
  return transaction(async (db) => {
    const found = /^[0-9a-f-]{36}$/i.test(id)
      ? await db.query(
          "SELECT 1 FROM people WHERE id = $1 AND org_code = $2 AND role = 'scheduler' AND active FOR UPDATE",
          [id, admin.orgCode],
        )
      : null;
    if (!found?.rowCount) throw new ApiError("not_found");
    requireRole(ctx, "org_admin");
    await db.query("UPDATE people SET active = false WHERE id = $1", [id]);
    await db.query("DELETE FROM sessions WHERE person_id = $1", [id]);
    return { status: 204 };
  });
}

const STATEMENT_HEADER = "number,date,kind,language,setting,seats,billable_minutes,mileage_cents,total_cents,invoice_id";

async function statement(ctx: SignedInContext): Promise<Reply> {
  const admin = requireRole(ctx, "org_admin");
  const month = ctx.query.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new ApiError("validation", { month: "Give the month as YYYY-MM." });
  }
  const records = await loadAssignments(
    `a.org_code = $1 AND a.billing_status = 'posted' AND to_char(a.start_at AT TIME ZONE $2, 'YYYY-MM') = $3`,
    [admin.orgCode, AGENCY_ZONE, month],
  );
  const rows = await Promise.all(
    records.map(async (record) => {
      const charges = await chargesFor(record);
      const sum = (pick: (line: (typeof charges.lines)[number]) => number) =>
        charges.lines.reduce((total, line) => total + pick(line), 0);
      return [
        record.number,
        agencyDate(record.startAt.toISOString()),
        charges.kind,
        record.languageName,
        record.setting,
        record.seats.length,
        sum((line) => line.billable_minutes),
        sum((line) => line.mileage_cents),
        charges.total_cents,
        record.invoiceId ?? "",
      ].join(",");
    }),
  );
  return {
    status: 200,
    text: `${[STATEMENT_HEADER, ...rows].join("\r\n")}\r\n`,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="teamseat-${admin.orgCode}-${month}.csv"`,
    },
  };
}

export function registerOrgRoutes(): void {
  route("GET", "/api/org/schedulers", listSchedulers);
  route("POST", "/api/org/schedulers", addScheduler);
  route("DELETE", "/api/org/schedulers/{id}", removeScheduler);
  route("GET", "/api/org/statement", statement);
}
