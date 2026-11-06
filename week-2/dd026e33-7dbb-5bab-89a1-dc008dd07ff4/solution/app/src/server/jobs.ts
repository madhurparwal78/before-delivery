// Workshop jobs (brief: Business rules › Workshop job states, Job versions, Paint stages, Stages one
// at a time). Every change takes hold of the job row; the transition table and estimate expiry are
// decided here only.
import type { Job, JobStatus, Reading, StageSummary } from "../shared/api.js";
import { carName, LINE_KINDS, PANEL_NAME, PANELS, STAGES, type LineKind, type PanelId, type Role } from "../shared/domain.js";
import { decimalPlaces, parseDecimal, toScaled } from "../shared/decimal.js";
import { filmToMicrometres, type FilmUnit } from "../shared/units.js";
import { jobActionAllowed } from "../shared/transitions.js";
import { requireRole } from "./auth.js";
import { config } from "./config.js";
import { iso, isoOrNull, many, newId, one, type Db } from "./db.js";
import { conflict, estimateChanged, FieldErrors, notFound } from "./errors.js";
import type { Ctx, Reply } from "./http.js";
import { estimateSentEmail } from "./mail.js";
import { chf, LABOUR_RATE_CENTIMES, totals, type PricedLine } from "./money.js";
import { presentActor, type Viewer } from "./projection.js";
import { deriveCoatStack, type LoggedStage } from "./coatstack.js";
import { visibleCar } from "./cars.js";
import { enqueueEmail } from "./queue.js";

interface JobRow {
  [key: string]: unknown;
  id: string;
  number: string;
  car_id: string;
  title: string;
  status: Exclude<JobStatus, "expired">;
  version: number;
  sent_at: Date | null;
  expires_at: Date | null;
  approved_at: Date | null;
  declined_at: Date | null;
  finished_at: Date | null;
  car_year: number;
  car_make: string;
  car_model: string;
  owner_id: string;
  owner_name: string;
  owner_email: string;
  invoice_id: string | null;
}

const JOB_SELECT = `
  SELECT j.*, c.year AS car_year, c.make AS car_make, c.model AS car_model, c.owner_id,
         o.name AS owner_name, o.email AS owner_email, i.id AS invoice_id
    FROM jobs j JOIN cars c ON c.id = j.car_id JOIN users o ON o.id = c.owner_id
    LEFT JOIN invoices i ON i.job_id = j.id`;

/** A sent estimate is expired from expires_at on; expiry changes nothing stored. */
export function effectiveJobStatus(row: { status: string; expires_at: Date | null }, now = new Date()): JobStatus {
  if (row.status === "sent" && row.expires_at && now >= row.expires_at) return "expired";
  return row.status as JobStatus;
}

/** The job if the viewer may see it: owners see their own cars' jobs, never drafts. */
export async function visibleJob(db: Db, viewer: Viewer, id: string, lock = false): Promise<JobRow> {
  if (lock) await db.query("SELECT 1 FROM jobs WHERE id = $1 FOR UPDATE", [id]);
  const row = await one<JobRow>(db, `${JOB_SELECT} WHERE j.id = $1`, [id]);
  if (!row || (viewer.role === "owner" && (row.owner_id !== viewer.id || row.status === "draft"))) throw notFound();
  return row;
}

interface LineRow {
  [key: string]: unknown;
  id: string;
  kind: LineKind;
  description: string;
  quantity_hundredths: string;
  unit_price_centimes: string;
}

async function pricedLines(db: Db, jobId: string): Promise<PricedLine[]> {
  const rows = await many<LineRow>(db, "SELECT * FROM job_lines WHERE job_id = $1 ORDER BY position", [jobId]);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    description: r.description,
    quantityHundredths: BigInt(r.quantity_hundredths),
    unitPriceCentimes: BigInt(r.unit_price_centimes),
  }));
}

async function stageSummaries(db: Db, jobId: string): Promise<StageSummary[]> {
  const rows = await many<{ id: string; name: string; logged_at: Date; readings_count: number }>(
    db,
    `SELECT s.id, s.name, s.logged_at, (SELECT count(*)::int FROM readings r WHERE r.stage_id = s.id) AS readings_count
       FROM stages s WHERE s.job_id = $1 ORDER BY s.stage_order`,
    [jobId],
  );
  return rows.map((r, index) => ({ id: r.id, index, name: r.name, logged_at: iso(r.logged_at), readings_count: r.readings_count }));
}

async function presentJob(db: Db, viewer: Viewer, row: JobRow): Promise<Job> {
  const [lines, stages] = await Promise.all([pricedLines(db, row.id), stageSummaries(db, row.id)]);
  const sums = totals(lines);
  return {
    id: row.id,
    number: row.number,
    version: row.version,
    car: { id: row.car_id, name: carName({ year: row.car_year, make: row.car_make, model: row.car_model }) },
    owner: presentActor(viewer, { id: row.owner_id, name: row.owner_name, role: "owner" }),
    title: row.title,
    status: effectiveJobStatus(row),
    lines: sums.lines,
    net_total: chf(sums.net),
    vat_total: chf(sums.vat),
    rounding: chf(sums.rounding),
    total: chf(sums.total),
    currency: "CHF",
    sent_at: isoOrNull(row.sent_at),
    expires_at: isoOrNull(row.expires_at),
    approved_at: isoOrNull(row.approved_at),
    declined_at: isoOrNull(row.declined_at),
    finished_at: isoOrNull(row.finished_at),
    stages,
    invoice_id: row.invoice_id,
  };
}

export async function jobTotals(db: Db, jobId: string): Promise<ReturnType<typeof totals>> {
  return totals(await pricedLines(db, jobId));
}

/** A reply carrying one job with its ETag. */
export async function jobReply(db: Db, viewer: Viewer, id: string, status = 200, extra: Record<string, unknown> = {}): Promise<Reply> {
  const job = await presentJob(db, viewer, await visibleJob(db, viewer, id));
  return { status, body: { ...extra, job }, headers: { ETag: `"${job.version}"` } };
}

async function bumpVersion(db: Db, jobId: string, set: string, params: unknown[] = []): Promise<void> {
  await db.query(`UPDATE jobs SET ${set}${set ? ", " : ""}version = version + 1 WHERE id = $1`, [jobId, ...params]);
}

const WORKSHOP: Role[] = ["workshop_lead", "house_manager"];

// ---- Estimate lines ------------------------------------------------------------------------------

interface LineInput {
  kind: LineKind;
  description: string;
  quantityHundredths: bigint;
  unitPriceCentimes: bigint;
}

function decimalInput(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && /^\d+(\.\d+)?$/.test(value.trim())) return value.trim();
  return null;
}

function validateEstimate(body: Record<string, unknown>, errors: FieldErrors): { title: string; lines: LineInput[] } {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title.length < 1 || title.length > 120) errors.add("title", "Enter 1 to 120 characters.");
  const raw = Array.isArray(body.lines) ? (body.lines as unknown[]) : [];
  if (raw.length === 0) errors.add("lines", "Add at least one line.");
  const lines: LineInput[] = [];
  raw.forEach((value, n) => {
    const line = (value ?? {}) as Record<string, unknown>;
    const kind = LINE_KINDS.find((k) => k === line.kind);
    if (!kind) errors.add(`lines[${n}].kind`, "Choose a line kind from the list.");
    const description = typeof line.description === "string" ? line.description.trim() : "";
    if (description.length < 1 || description.length > 120) errors.add(`lines[${n}].description`, "Enter 1 to 120 characters.");
    const quantityText = decimalInput(line.quantity);
    const quantity = quantityText !== null && decimalPlaces(quantityText) <= 2 ? toScaled(parseDecimal(quantityText) ?? { num: 0n, den: 1n }, 2) : null;
    if (kind === "part" && (quantity === null || quantity % 100n !== 0n || quantity < 100n || quantity > 99900n)) {
      errors.add(`lines[${n}].quantity`, "Enter a whole number of parts from 1 to 999.");
    } else if (kind === "labour" && (quantity === null || quantity % 25n !== 0n || quantity < 25n || quantity > 20000n)) {
      errors.add(`lines[${n}].quantity`, "Enter hours in quarter-hour steps from 0.25 to 200.00.");
    } else if (kind === "paint_materials" && (quantity === null || quantity <= 0n)) {
      errors.add(`lines[${n}].quantity`, "Enter a quantity greater than zero with up to two decimals.");
    }
    let price = LABOUR_RATE_CENTIMES;
    if (kind === "labour") {
      if (line.unit_price !== undefined && line.unit_price !== null) errors.add(`lines[${n}].unit_price`, "Labour is billed at the house rate.");
    } else {
      const priceText = decimalInput(line.unit_price);
      const cents = priceText !== null && decimalPlaces(priceText) <= 2 ? toScaled(parseDecimal(priceText) ?? { num: 0n, den: 1n }, 2) : null;
      if (cents === null || cents < 1n || cents > 9_999_999n) errors.add(`lines[${n}].unit_price`, "Enter a price in CHF from 0.01 to 99999.99.");
      else price = cents;
    }
    if (kind && quantity !== null) lines.push({ kind, description, quantityHundredths: quantity, unitPriceCentimes: price });
  });
  return { title, lines };
}

async function writeLines(db: Db, jobId: string, lines: LineInput[]): Promise<void> {
  await db.query("DELETE FROM job_lines WHERE job_id = $1", [jobId]);
  for (const [position, line] of lines.entries()) {
    await db.query(
      `INSERT INTO job_lines (id, job_id, position, kind, description, quantity_hundredths, unit_price_centimes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [newId("l"), jobId, position, line.kind, line.description, line.quantityHundredths.toString(), line.unitPriceCentimes.toString()],
    );
  }
}

/** If-Match against the job's version: missing → field error, different → 412. */
function checkVersion(ctx: Ctx, job: JobRow, errors: FieldErrors): void {
  const header = ctx.req.headers["if-match"];
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined || value.trim() === "") {
    errors.add("if_match", "Send the estimate version you edited.");
    return;
  }
  if (value.trim().replace(/^W\//, "") !== `"${job.version}"`) throw estimateChanged();
}

// ---- Endpoints -----------------------------------------------------------------------------------

export async function listJobs(ctx: Ctx): Promise<Reply> {
  const owner = ctx.user.role === "owner";
  const rows = await many<JobRow>(
    ctx.db,
    `${JOB_SELECT} ${owner ? "WHERE c.owner_id = $1 AND j.status <> 'draft'" : ""} ORDER BY j.number`,
    owner ? [ctx.user.id] : [],
  );
  return { status: 200, body: { jobs: await Promise.all(rows.map((r) => presentJob(ctx.db, ctx.user, r))) } };
}

export async function getJob(ctx: Ctx): Promise<Reply> {
  return jobReply(ctx.db, ctx.user, ctx.params.id ?? "");
}

export async function createJob(ctx: Ctx): Promise<Reply> {
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const carId = typeof body.car_id === "string" ? body.car_id : null;
  if (carId !== null) await visibleCar(ctx.db, ctx.user, carId);
  requireRole(ctx.user, ...WORKSHOP);
  const errors = new FieldErrors();
  if (carId !== null) {
    const car = await visibleCar(ctx.db, ctx.user, carId, true);
    if (car.status !== "stored") throw conflict("car_not_stored");
    const open = await one(
      ctx.db,
      "SELECT 1 FROM jobs WHERE car_id = $1 AND status IN ('draft', 'sent', 'approved', 'declined', 'in_progress', 'finished')",
      [carId],
    );
    if (open) throw conflict("job_already_open");
  } else {
    errors.add("car_id", "Choose a car from the list.");
  }
  const estimate = validateEstimate(body, errors);
  errors.throwIfAny();
  const id = newId("j");
  const number = await one<{ n: string }>(ctx.db, "SELECT nextval('job_number_seq')::text AS n");
  await ctx.db.query("INSERT INTO jobs (id, number, car_id, title, status, version) VALUES ($1, $2, $3, $4, 'draft', 1)", [
    id,
    `J-${number?.n ?? ""}`,
    carId,
    estimate.title,
  ]);
  await writeLines(ctx.db, id, estimate.lines);
  return jobReply(ctx.db, ctx.user, id, 201);
}

export async function editEstimate(ctx: Ctx): Promise<Reply> {
  const id = ctx.params.id ?? "";
  await visibleJob(ctx.db, ctx.user, id);
  requireRole(ctx.user, ...WORKSHOP);
  const job = await visibleJob(ctx.db, ctx.user, id, true);
  if (!jobActionAllowed("edit", effectiveJobStatus(job))) throw conflict("invalid_transition");
  const errors = new FieldErrors();
  checkVersion(ctx, job, errors);
  const estimate = validateEstimate((ctx.body ?? {}) as Record<string, unknown>, errors);
  errors.throwIfAny();
  await writeLines(ctx.db, id, estimate.lines);
  await bumpVersion(ctx.db, id, "title = $2", [estimate.title]);
  return jobReply(ctx.db, ctx.user, id);
}

export async function sendEstimate(ctx: Ctx): Promise<Reply> {
  const id = ctx.params.id ?? "";
  await visibleJob(ctx.db, ctx.user, id);
  requireRole(ctx.user, ...WORKSHOP);
  const job = await visibleJob(ctx.db, ctx.user, id, true);
  const lineCount = await one<{ n: number }>(ctx.db, "SELECT count(*)::int AS n FROM job_lines WHERE job_id = $1", [id]);
  if (!jobActionAllowed("send", effectiveJobStatus(job)) || (lineCount?.n ?? 0) < 1) throw conflict("invalid_transition");
  const errors = new FieldErrors();
  checkVersion(ctx, job, errors);
  errors.throwIfAny();
  await bumpVersion(
    ctx.db,
    id,
    "status = 'sent', sent_at = clock_timestamp(), expires_at = clock_timestamp() + make_interval(secs => $2)",
    [config.timers.estimateExpirySeconds],
  );
  const sent = await visibleJob(ctx.db, ctx.user, id);
  const sums = await jobTotals(ctx.db, id);
  await enqueueEmail(
    ctx.db,
    estimateSentEmail({
      owner: { name: sent.owner_name, email: sent.owner_email },
      carName: carName({ year: sent.car_year, make: sent.car_make, model: sent.car_model }),
      jobId: id,
      jobNumber: sent.number,
      title: sent.title,
      total: chf(sums.total),
      expiresAt: iso(sent.expires_at),
    }),
  );
  return jobReply(ctx.db, ctx.user, id);
}

export async function reviseEstimate(ctx: Ctx): Promise<Reply> {
  const id = ctx.params.id ?? "";
  await visibleJob(ctx.db, ctx.user, id);
  requireRole(ctx.user, ...WORKSHOP);
  const job = await visibleJob(ctx.db, ctx.user, id, true);
  const status = effectiveJobStatus(job);
  if (!jobActionAllowed("revise", status)) throw conflict("invalid_transition");
  await bumpVersion(ctx.db, id, "status = 'draft', sent_at = NULL, expires_at = NULL");
  return jobReply(ctx.db, ctx.user, id);
}

async function answerEstimate(ctx: Ctx, answer: "approved" | "declined"): Promise<Reply> {
  const id = ctx.params.id ?? "";
  await visibleJob(ctx.db, ctx.user, id);
  requireRole(ctx.user, "owner");
  const job = await visibleJob(ctx.db, ctx.user, id, true);
  const now = await one<{ now: Date }>(ctx.db, "SELECT clock_timestamp() AS now");
  const status = effectiveJobStatus(job, now?.now ?? new Date());
  if (status === "expired") throw conflict("estimate_expired");
  if (!jobActionAllowed("answer", status)) throw conflict("invalid_transition");
  await bumpVersion(ctx.db, id, answer === "approved" ? "status = 'approved', approved_at = $2" : "status = 'declined', declined_at = $2", [
    now?.now,
  ]);
  return jobReply(ctx.db, ctx.user, id);
}

export const approveEstimate = (ctx: Ctx): Promise<Reply> => answerEstimate(ctx, "approved");
export const declineEstimate = (ctx: Ctx): Promise<Reply> => answerEstimate(ctx, "declined");

// ---- Stages and readings -------------------------------------------------------------------------

function readingInput(value: unknown, unitValue: unknown): { um: number | null; unit: FilmUnit } {
  const unit: FilmUnit = unitValue === "mil" ? "mil" : "um";
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "string" ? value.trim() : "";
  const um = text === "" ? null : filmToMicrometres(text, unit);
  return { um: um !== null && um >= 0 && um <= 2000 ? um : null, unit };
}

const READING_MESSAGE: Record<FilmUnit, string> = {
  um: "Enter a reading from 0 to 2000 µm.",
  mil: "Enter a reading from 0.0 to 78.7 mil.",
};

export async function logStage(ctx: Ctx): Promise<Reply> {
  const id = ctx.params.id ?? "";
  await visibleJob(ctx.db, ctx.user, id);
  requireRole(ctx.user, ...WORKSHOP);
  const job = await visibleJob(ctx.db, ctx.user, id, true);
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const order = STAGES.findIndex((s) => s === body.name);
  if (!jobActionAllowed("log_stage", job.status)) throw conflict("invalid_transition");
  if (order >= 0) {
    const logged = await many<{ stage_order: number }>(ctx.db, "SELECT stage_order FROM stages WHERE job_id = $1", [id]);
    if (logged.some((s) => s.stage_order === order)) throw conflict("stage_already_logged");
    if (logged.some((s) => s.stage_order > order)) throw conflict("stage_out_of_order");
  }
  const errors = new FieldErrors();
  if (order < 0) errors.add("name", "Choose a stage from the list.");
  const raw = Array.isArray(body.readings) ? (body.readings as unknown[]) : [];
  const seen = new Set<string>();
  const readings: { panel: PanelId; um: number }[] = [];
  raw.forEach((value, n) => {
    const reading = (value ?? {}) as Record<string, unknown>;
    const panel = PANELS.find((p) => p.id === reading.panel)?.id;
    if (!panel || seen.has(panel)) errors.add(`readings[${n}].panel`, "Choose a panel from the list.");
    if (panel) seen.add(panel);
    const { um, unit } = readingInput(reading.value, reading.unit);
    if (um === null) errors.add(`readings[${n}].value`, READING_MESSAGE[unit]);
    if (panel && um !== null) readings.push({ panel, um });
  });
  if (order === 0 && (raw.length < PANELS.length || PANELS.some((p) => !seen.has(p.id)))) {
    errors.add("readings", "Intake needs a reading for every panel.");
  } else if (order !== 0 && raw.length === 0) {
    errors.add("readings", "Add at least one reading.");
  }
  errors.throwIfAny();

  const stageId = newId("s");
  await ctx.db.query(
    "INSERT INTO stages (id, job_id, stage_order, name, logged_at, logged_by) VALUES ($1, $2, $3, $4, clock_timestamp(), $5)",
    [stageId, id, order, STAGES[order], ctx.user.id],
  );
  for (const reading of readings) {
    await ctx.db.query(
      `INSERT INTO readings (id, job_id, stage_id, panel, film_um, logged_at, logged_by)
       SELECT $1, $2, $3, $4, $5, s.logged_at, $6 FROM stages s WHERE s.id = $3`,
      [newId("r"), id, stageId, reading.panel, reading.um, ctx.user.id],
    );
  }
  await bumpVersion(ctx.db, id, "status = 'in_progress'");
  const stages = await stageSummaries(ctx.db, id);
  const stage = stages.find((s) => s.id === stageId);
  return jobReply(ctx.db, ctx.user, id, 201, { stage });
}

interface ReadingRow {
  [key: string]: unknown;
  id: string;
  panel: PanelId;
  stage_name: string;
  film_um: number;
  logged_at: Date;
  logged_by: string;
  by_name: string;
  by_role: Role;
}

const READING_SELECT = `
  SELECT r.*, s.name AS stage_name, u.name AS by_name, u.role AS by_role
    FROM readings r JOIN stages s ON s.id = r.stage_id JOIN users u ON u.id = r.logged_by`;

function presentReading(viewer: Viewer, row: ReadingRow): Reading & { panel: PanelId } {
  return {
    id: row.id,
    panel: row.panel,
    stage: row.stage_name,
    film_um: row.film_um,
    logged_at: iso(row.logged_at),
    logged_by: presentActor(viewer, { id: row.logged_by, name: row.by_name, role: row.by_role }),
  };
}

export async function addReading(ctx: Ctx): Promise<Reply> {
  const id = ctx.params.id ?? "";
  await visibleJob(ctx.db, ctx.user, id);
  const stage = await one<{ id: string }>(ctx.db, "SELECT id FROM stages WHERE id = $1 AND job_id = $2", [ctx.params.stage ?? "", id]);
  if (!stage) throw notFound();
  requireRole(ctx.user, ...WORKSHOP);
  const job = await visibleJob(ctx.db, ctx.user, id, true);
  if (!jobActionAllowed("add_reading", job.status)) throw conflict("invalid_transition");
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const errors = new FieldErrors();
  const panel = PANELS.find((p) => p.id === body.panel)?.id;
  if (!panel) errors.add("panel", "Choose a panel from the list.");
  const { um, unit } = readingInput(body.value, body.unit);
  if (um === null) errors.add("value", READING_MESSAGE[unit]);
  errors.throwIfAny();
  const readingId = newId("r");
  await ctx.db.query(
    "INSERT INTO readings (id, job_id, stage_id, panel, film_um, logged_at, logged_by) VALUES ($1, $2, $3, $4, $5, clock_timestamp(), $6)",
    [readingId, id, stage.id, panel, um, ctx.user.id],
  );
  await bumpVersion(ctx.db, id, "");
  const row = await one<ReadingRow>(ctx.db, `${READING_SELECT} WHERE r.id = $1`, [readingId]);
  if (!row) throw new Error("reading vanished");
  return { status: 201, body: { reading: presentReading(ctx.user, row) } };
}

export async function finishJob(ctx: Ctx): Promise<Reply> {
  const id = ctx.params.id ?? "";
  await visibleJob(ctx.db, ctx.user, id);
  requireRole(ctx.user, ...WORKSHOP);
  const job = await visibleJob(ctx.db, ctx.user, id, true);
  const stages = await one<{ n: number }>(ctx.db, "SELECT count(*)::int AS n FROM stages WHERE job_id = $1", [id]);
  if (!jobActionAllowed("finish", job.status) || (stages?.n ?? 0) < 1) throw conflict("invalid_transition");
  await bumpVersion(ctx.db, id, "status = 'finished', finished_at = clock_timestamp()");
  return jobReply(ctx.db, ctx.user, id);
}

async function loggedStages(db: Db, jobId: string): Promise<LoggedStage[]> {
  const stages = await many<{ id: string; name: string; logged_at: Date }>(
    db,
    "SELECT id, name, logged_at FROM stages WHERE job_id = $1 ORDER BY stage_order",
    [jobId],
  );
  const readings = await many<{ stage_id: string; panel: PanelId; film_um: number }>(
    db,
    "SELECT stage_id, panel, film_um FROM readings WHERE job_id = $1 ORDER BY logged_at, seq",
    [jobId],
  );
  return stages.map((s, index) => {
    const values: Partial<Record<PanelId, number>> = {};
    for (const r of readings) if (r.stage_id === s.id) values[r.panel] = r.film_um;
    return { index, name: s.name, loggedAt: iso(s.logged_at), values };
  });
}

export async function coatStack(ctx: Ctx): Promise<Reply> {
  const job = await visibleJob(ctx.db, ctx.user, ctx.params.id ?? "");
  return { status: 200, body: deriveCoatStack(job.id, await loggedStages(ctx.db, job.id)) };
}

export async function panelReadings(ctx: Ctx): Promise<Reply> {
  const job = await visibleJob(ctx.db, ctx.user, ctx.params.id ?? "");
  const panel = ctx.params.panel as PanelId;
  if (!(panel in PANEL_NAME)) throw notFound();
  const rows = await many<ReadingRow>(ctx.db, `${READING_SELECT} WHERE r.job_id = $1 AND r.panel = $2 ORDER BY r.logged_at, r.seq`, [
    job.id,
    panel,
  ]);
  return { status: 200, body: { panel, readings: rows.map((r) => presentReading(ctx.user, r)).map(({ panel: _p, ...rest }) => rest) } };
}
