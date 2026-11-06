import { Pool } from "pg";
import { ApiError, validationError } from "./errors";
import { sendJson } from "./httpio";
import { Ctx, Router, readJson } from "./router";
import { Config, withTx } from "./config";
import { hashPassword } from "./db";
import { LANGUAGES } from "../shared/domain";
import { centralToInstant as centralToInstantMidnight, centralDateISO, isoCentral, parseInstant, partsCentral } from "../shared/time";
import { UNCOVERED_STATUSES } from "./rules";
import { loadAssignment, loadSeats } from "./assignments";
import { getObject, StorageUnavailable } from "./s3";
import { loadBilling } from "./assignments";
import { chargesForAssignment } from "./billing_routes";

interface Deps {
  db: Pool;
  config: Config;
}

// ── Coverage board ────────────────────────────────────────────────────────────

async function handleCoverage(ctx: Ctx, deps: Deps): Promise<void> {
  const weekParam = ctx.query.get("week") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekParam) || !parseInstant(`${weekParam}T12:00:00Z`)) {
    throw validationError({ week: "Pick a Monday as YYYY-MM-DD." });
  }
  const weekDate = parseInstant(`${weekParam}T12:00:00Z`)!;
  // The date must itself be a Monday in Central time.
  if (partsCentral(weekDate).weekday !== 1) {
    throw validationError({ week: "Pick a Monday as YYYY-MM-DD." });
  }
  const weekStart = centralToInstantMidnight(weekParam, 0);
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 3600 * 1000);
  await withTx(deps.db, async (tx) => {
    const res = await tx.query(
      `SELECT a.number FROM assignments a
        WHERE a.start_at >= $1 AND a.start_at < $2 AND a.status <> 'cancelled'
        ORDER BY a.start_at ASC, a.id ASC`,
      [weekStart, weekEnd],
    );
    const byLanguage = new Map<string, { number: string; start_at: Date; duration_minutes: number; status: string; org_code: string; setting: string; seats: { seat: number; status: string; interpreter_initials: string | null }[] }[]>();
    for (const lang of LANGUAGES) byLanguage.set(lang.code, []);
    for (const row of res.rows as { number: string }[]) {
      const a = await loadAssignment(tx, row.number);
      const seats = await loadSeats(tx, a.id);
      const entry = {
        number: a.number,
        status: a.status,
        org_code: a.org_code,
        setting: a.setting,
        start_at: a.start_at,
        duration_minutes: a.duration_minutes,
        seats: seats.map((s) => ({ seat: s.seat, status: s.status, interpreter_initials: s.holder_initials })),
      };
      byLanguage.get(a.language_code)!.push(entry);
    }
    const languages = LANGUAGES.map((lang) => {
      const assignments = byLanguage.get(lang.code)!;
      let uncovered = 0;
      const languageAssignments = [] as Record<string, unknown>[];
      for (const a of assignments) {
        const openSeats = a.seats.filter((s) => s.status === "open").length;
        if (UNCOVERED_STATUSES.includes(a.status)) {
          uncovered += a.duration_minutes * openSeats;
        }
        languageAssignments.push({
          number: a.number,
          status: a.status,
          org_code: a.org_code,
          setting: a.setting,
          start_at: isoCentral(a.start_at),
          end_at: isoCentral(new Date(a.start_at.getTime() + a.duration_minutes * 60000)),
          duration_minutes: a.duration_minutes,
          seats: a.seats,
        });
      }
      return {
        code: lang.code,
        name: lang.name,
        uncovered_minutes: uncovered,
        assignments: languageAssignments,
      };
    });
    sendJson(ctx.res, 200, {
      week_start: centralDateISO(weekStart),
      languages,
    });
  });
}

// ── Org schedulers ─────────────────────────────────────────────────────────────

async function handleSchedulersList(ctx: Ctx, deps: Deps): Promise<void> {
  const caller = ctx.session!;
  await withTx(deps.db, async (tx) => {
    const res = await tx.query(
      `SELECT id, name, email, phone FROM people
        WHERE org_code = $1 AND role = 'scheduler' AND active = true ORDER BY id`,
      [caller.orgCode],
    );
    sendJson(ctx.res, 200, { schedulers: res.rows });
  });
}

async function handleSchedulerAdd(ctx: Ctx, deps: Deps): Promise<void> {
  const caller = ctx.session!;
  const body = readJson(ctx);
  const fields: Record<string, string> = {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (name.length < 1 || name.length > 80) fields.name = "Enter a name of 1 to 80 characters.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.email = "Enter a valid email address.";
  if (phone.length < 7 || phone.length > 20) fields.phone = "Enter a phone of 7 to 20 characters.";
  if (password.length < 12) fields.password = "Choose a password of at least 12 characters.";
  if (Object.keys(fields).length > 0) throw validationError(fields);

  await withTx(deps.db, async (tx) => {
    const existing = await tx.query(`SELECT id FROM people WHERE lower(email) = $1`, [email]);
    if (existing.rows.length > 0) throw new ApiError("email_taken", "That email is already in use.");
    const res = await tx.query(
      `INSERT INTO people (email, password_hash, name, role, initials, org_code, phone, active)
       VALUES ($1,$2,$3,'scheduler',NULL,$4,$5,true) RETURNING id, name, email, phone`,
      [email, hashPassword(password), name, caller.orgCode, phone],
    );
    sendJson(ctx.res, 201, res.rows[0]);
  });
}

async function handleSchedulerRemove(ctx: Ctx, deps: Deps): Promise<void> {
  const caller = ctx.session!;
  const id = Number(ctx.params.id);
  await withTx(deps.db, async (tx) => {
    const res = await tx.query(
      `SELECT id FROM people WHERE id = $1 AND org_code = $2 AND role = 'scheduler'`,
      [id, caller.orgCode],
    );
    if (res.rows.length === 0) throw new ApiError("not_found", "No such scheduler.");
    // Deactivate and end their sessions at once; their assignments stay visible to the org.
    await tx.query(`UPDATE people SET active = false WHERE id = $1`, [id]);
    await tx.query(`DELETE FROM sessions WHERE person_id = $1`, [id]);
    ctx.res.writeHead(204);
    ctx.res.end();
  });
}

// ── Monthly statement ───────────────────────────────────────────────────────────

async function handleStatement(ctx: Ctx, deps: Deps): Promise<void> {
  const caller = ctx.session!;
  const month = ctx.query.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw validationError({ month: "Pick a month as YYYY-MM." });
  }
  await withTx(deps.db, async (tx) => {
    const res = await tx.query(
      `SELECT a.number FROM assignments a
         JOIN billing b ON b.assignment_id = a.id AND b.status = 'posted'
        WHERE a.org_code = $1
        ORDER BY a.start_at ASC, a.id ASC`,
      [caller.orgCode],
    );
    const langNames = new Map(LANGUAGES.map((l) => [l.code, l.name]));
    const rows: string[] = ["number,date,kind,language,setting,seats,billable_minutes,mileage_cents,total_cents,invoice_id"];
    for (const row of res.rows as { number: string }[]) {
      const a = await loadAssignment(tx, row.number);
      const date = centralDateISO(a.start_at);
      if (!date.startsWith(month)) continue;
      const seats = await loadSeats(tx, a.id);
      const billing = await loadBilling(tx, a.id);
      // The posted charge lines are the same computation that went to Kill Bill.
      const computation = await chargesForAssignment(tx, a.number);
      const billableMinutes = computation.lines.reduce((sum: number, l) => sum + l.billable_minutes, 0);
      const mileageCentsSum = computation.lines.reduce((sum: number, l) => sum + l.mileage_cents, 0);
      rows.push([
        a.number,
        date,
        computation.kind,
        langNames.get(a.language_code) ?? a.language_code,
        a.setting,
        seats.length,
        billableMinutes,
        mileageCentsSum,
        billing.total_cents ?? 0,
        billing.invoice_id ?? "",
      ].join(","));
    }
    const csv = rows.join("\n") + "\n";
    ctx.res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="statement-${month}-${caller.orgCode}.csv"`,
      "Cache-Control": "no-store",
    });
    ctx.res.end(csv);
  });
}

export function registerCoverageAndOrgRoutes(router: Router, deps: Deps): void {
  router.add("GET", "/api/coverage", {
    roles: ["dispatcher"],
    handler: (ctx) => handleCoverage(ctx, deps),
  });
  router.add("GET", "/api/org/schedulers", {
    roles: ["org_admin"],
    handler: (ctx) => handleSchedulersList(ctx, deps),
  });
  router.add("POST", "/api/org/schedulers", {
    body: "json", roles: ["org_admin"],
    handler: (ctx) => handleSchedulerAdd(ctx, deps),
  });
  router.add("DELETE", "/api/org/schedulers/:id", {
    roles: ["org_admin"],
    handler: (ctx) => handleSchedulerRemove(ctx, deps),
  });
  router.add("GET", "/api/org/statement", {
    roles: ["org_admin"],
    handler: (ctx) => handleStatement(ctx, deps),
  });
}

// ── /files/{token} ─────────────────────────────────────────────────────────────

export async function serveFileByToken(ctx: Ctx, deps: Deps): Promise<void> {
  const token = ctx.params.token;
  const res = await deps.db.query(
    `SELECT fl.token, st.form_object_key, st.form_content_type
       FROM form_links fl
       JOIN seats st ON st.id = fl.seat_id
      WHERE fl.token = $1 AND fl.session_token = $2 AND fl.expires_at > now()`,
    [token, ctx.session?.sessionToken],
  );
  if (res.rows.length === 0) throw new ApiError("not_found", "No such file.");
  const row = res.rows[0] as { form_object_key: string; form_content_type: string };
  try {
    const object = await getObject(deps.config, row.form_object_key);
    ctx.res.writeHead(200, {
      "Content-Type": object.contentType,
      "Content-Disposition": "attachment",
      "Cache-Control": "no-store",
      "Content-Length": object.data.length,
    });
    ctx.res.end(object.data);
  } catch (e) {
    if (e instanceof StorageUnavailable) throw new ApiError("storage_unavailable", "File storage is unavailable.");
    throw e;
  }
}

export function registerFilesRoute(router: Router, deps: Deps): void {
  router.add("GET", "/files/:token", {
    roles: "any",
    handler: (ctx) => serveFileByToken(ctx, deps),
  });
}
