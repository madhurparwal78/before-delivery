// Sanitation log entries (append-only) and monthly sanitation PDFs, queued while storage is down.

import { randomBytes } from "node:crypto";
import { pool, type Db } from "./db.js";
import { forbidden, notFound, refuseInvalid, route, type Reply } from "./http.js";
import { BODIES, bodyObject, keyErrors } from "./bodies.js";
import { boundedText } from "./text.js";
import { monthParam } from "./kitchen.js";
import { StorageDown, getObject, putObject, sanitationKey, storageUnavailable } from "./storage.js";
import { pdfDocument } from "./pdf.js";
import { SANITATION_AREAS } from "../shared/format.js";
import { fileReply } from "./documents.js";
import { addMonths, firstOfMonth, isMonth, isoWithOffset, localDateOf, localTimeOf, monthName, startOfDay, type Month } from "../shared/time.js";


interface EntryRow { id: string; area: string; task: string; sanitizer_ppm: number | null; initials: string; notes: string; logged_at: Date; logged_by: string }

export function entryJson(e: EntryRow, zone: string): Record<string, unknown> {
  const ms = e.logged_at.getTime();
  return {
    id: e.id, area: e.area, task: e.task, sanitizerPpm: e.sanitizer_ppm, initials: e.initials, notes: e.notes,
    loggedAt: isoWithOffset(ms, zone), localDate: localDateOf(ms, zone), localTime: localTimeOf(ms, zone), loggedBy: e.logged_by,
  };
}

export async function entriesBetween(db: Db, kitchenId: string, fromMs: number, toMs: number): Promise<EntryRow[]> {
  const { rows } = await db.query(
    "SELECT * FROM sanitation_entries WHERE kitchen_id = $1 AND logged_at >= $2 AND logged_at < $3 ORDER BY logged_at DESC, id DESC",
    [kitchenId, new Date(fromMs), new Date(toMs)],
  );
  return rows as EntryRow[];
}

const monthRange = (month: Month, zone: string): [number, number] =>
  [startOfDay(firstOfMonth(month), zone), startOfDay(firstOfMonth(addMonths(month, 1)), zone)];

const staffOnly = (role: string): void => {
  if (role === "member") throw forbidden();
};

route("POST", "/api/sanitation-entries", async (ctx) => {
  const s = ctx.session!;
  staffOnly(s.person.role);
  const body = bodyObject(ctx.body);
  const errors = keyErrors(Object.keys(body), BODIES.sanitationEntry);
  if (!errors.area && (typeof body.area !== "string" || !SANITATION_AREAS.includes(body.area))) errors.area = "Choose an area.";
  const task = boundedText(body.task, 1, 120);
  if (!errors.task && task === null) errors.task = "Describe the task in 1 to 120 characters.";
  const ppm = body.sanitizerPpm ?? null;
  if (ppm !== null && !(Number.isInteger(ppm) && (ppm as number) >= 0 && (ppm as number) <= 400)) errors.sanitizerPpm = "Sanitizer strength is 0 to 400 ppm.";
  if (!errors.initials && (typeof body.initials !== "string" || !/^\p{L}{1,4}$/u.test(body.initials.normalize("NFC")))) errors.initials = "Initials are 1 to 4 letters.";
  const notes = boundedText(body.notes ?? "", 0, 500);
  if (notes === null) errors.notes = "Notes can be at most 500 characters.";
  refuseInvalid(errors);
  const { rows } = await pool.query(
    `INSERT INTO sanitation_entries (id, kitchen_id, area, task, sanitizer_ppm, initials, notes, logged_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [`san_${randomBytes(8).toString("hex")}`, s.kitchen.id, body.area, task, ppm, (body.initials as string).normalize("NFC"), notes, s.person.name],
  );
  return { status: 201, body: { entry: entryJson(rows[0], s.kitchen.timeZone) } };
});

route("GET", "/api/sanitation-entries", async (ctx) => {
  const s = ctx.session!;
  staffOnly(s.person.role);
  const [from, to] = monthRange(monthParam(ctx), s.kitchen.timeZone);
  const entries = await entriesBetween(pool, s.kitchen.id, from, to);
  return { status: 200, body: { entries: entries.map((e) => entryJson(e, s.kitchen.timeZone)) } };
});

async function renderMonth(kitchenId: string, month: Month): Promise<Buffer> {
  const { rows } = await pool.query("SELECT name, time_zone FROM kitchens WHERE id = $1", [kitchenId]);
  const { name, time_zone: zone } = rows[0];
  const [from, to] = monthRange(month, zone);
  const entries = (await entriesBetween(pool, kitchenId, from, to)).reverse();
  const lines = [`Sanitation log, ${name}, ${monthName(month)}`, `Kitchen time: ${zone}`, ""];
  if (!entries.length) lines.push("No entries were logged this month.");
  for (const e of entries) {
    const ms = e.logged_at.getTime();
    const ppm = e.sanitizer_ppm === null ? "" : `  ${e.sanitizer_ppm} ppm`;
    lines.push(`${localDateOf(ms, zone)} ${localTimeOf(ms, zone)}  ${e.area}  ${e.initials}${ppm}`);
    lines.push(`    ${e.task}${e.notes ? `  (${e.notes})` : ""}`.slice(0, 110));
  }
  return pdfDocument(lines);
}

async function storeMonth(kitchenId: string, month: Month): Promise<void> {
  await putObject(sanitationKey(kitchenId, month), await renderMonth(kitchenId, month), "application/pdf");
  await pool.query(
    `INSERT INTO sanitation_reports (kitchen_id, month, status, stored_at) VALUES ($1, $2, 'stored', now())
     ON CONFLICT (kitchen_id, month) DO UPDATE SET status = 'stored', stored_at = now()`,
    [kitchenId, month],
  );
}

/** Saves queued monthly PDFs; stops at the first storage failure. */
export async function storeQueuedReports(): Promise<void> {
  const { rows } = await pool.query("SELECT kitchen_id, month FROM sanitation_reports WHERE status = 'queued'");
  for (const r of rows) {
    try {
      await storeMonth(r.kitchen_id, r.month);
    } catch (error) {
      if (error instanceof StorageDown) return;
      throw error;
    }
  }
}

const reportJson = (r: { month: string; status: string; stored_at: Date | null }, zone: string): Record<string, unknown> =>
  ({ month: r.month, status: r.status, storedAt: r.stored_at ? isoWithOffset(r.stored_at.getTime(), zone) : null });

route("POST", "/api/sanitation-reports", async (ctx) => {
  const s = ctx.session!;
  if (s.person.role !== "operator") throw forbidden();
  const body = bodyObject(ctx.body);
  const errors = keyErrors(Object.keys(body), BODIES.sanitationReport);
  if (!errors.month && !isMonth(body.month)) errors.month = "Use a month in the form YYYY-MM.";
  refuseInvalid(errors);
  const month = body.month as Month;
  try {
    await storeMonth(s.kitchen.id, month);
  } catch (error) {
    if (!(error instanceof StorageDown)) throw error;
    await pool.query(
      `INSERT INTO sanitation_reports (kitchen_id, month, status) VALUES ($1, $2, 'queued')
       ON CONFLICT (kitchen_id, month) DO UPDATE SET status = 'queued'`,
      [s.kitchen.id, month],
    );
  }
  const { rows } = await pool.query("SELECT * FROM sanitation_reports WHERE kitchen_id = $1 AND month = $2", [s.kitchen.id, month]);
  return { status: rows[0].status === "stored" ? 201 : 202, body: { report: reportJson(rows[0], s.kitchen.timeZone) } };
});

route("GET", "/api/sanitation-reports", async (ctx) => {
  const s = ctx.session!;
  staffOnly(s.person.role);
  const { rows } = await pool.query("SELECT * FROM sanitation_reports WHERE kitchen_id = $1 ORDER BY month DESC", [s.kitchen.id]);
  return { status: 200, body: { reports: rows.map((r) => reportJson(r, s.kitchen.timeZone)) } };
});

/**
 * Streams a month's sanitation PDF. Staff reach every month they saved or queued (storage decides
 * between the file and 503); an inspector link opens only months already stored.
 */
export async function reportFile(kitchenId: string, month: string | undefined, storedOnly: boolean): Promise<Reply> {
  const { rows } = await pool.query(
    "SELECT 1 FROM sanitation_reports WHERE kitchen_id = $1 AND month = $2 AND ($3::boolean IS FALSE OR stored_at IS NOT NULL)",
    [kitchenId, month, storedOnly],
  );
  if (!rows.length || !isMonth(month)) throw notFound();
  let data: Buffer | null;
  try {
    data = await getObject(sanitationKey(kitchenId, month));
  } catch (error) {
    if (error instanceof StorageDown) throw storageUnavailable("storage_unavailable_download");
    throw error;
  }
  if (!data) throw notFound();
  return fileReply(data, "application/pdf", `sanitation-${month}.pdf`);
}

route("GET", "/api/sanitation-reports/:month/file", async (ctx) => {
  const s = ctx.session!;
  staffOnly(s.person.role);
  return reportFile(s.kitchen.id, ctx.params.month, false);
});

export async function queuedStorageCount(kitchenId: string): Promise<number> {
  const { rows } = await pool.query(
    "SELECT count(*)::int AS n FROM sanitation_reports WHERE kitchen_id = $1 AND status = 'queued'",
    [kitchenId],
  );
  return rows[0].n;
}
