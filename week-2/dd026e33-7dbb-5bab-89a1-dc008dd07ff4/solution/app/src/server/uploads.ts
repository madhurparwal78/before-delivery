// Condition reports and photos (brief: Business rules › Condition report, Photos, Abandoned
// uploads). A report upload claims its stay before the body is read; the body is received whole,
// written to storage with one PUT, and only then recorded. Every refusal releases the claim.
import { createHash } from "node:crypto";
import type { Photo, Report } from "../shared/api.js";
import type { Role } from "../shared/domain.js";
import { requireRole } from "./auth.js";
import { iso, many, newId, one, pool, transaction, type Db } from "./db.js";
import { conflict, FieldErrors, invalid, notFound, ProviderDown, storageUnavailable, unsupportedMediaType } from "./errors.js";
import type { Ctx, Reply } from "./http.js";
import { boundaryOf, parseForm, type FormData } from "./multipart.js";
import { presentActor, type Viewer } from "./projection.js";
import { getObject, photoKey, putObject, reportKey } from "./storage.js";
import { visibleCar } from "./cars.js";

/** A claim older than this belongs to a process that died mid-upload. */
const STALE_CLAIM = "15 minutes";

interface ReportRow {
  [key: string]: unknown;
  id: string;
  car_id: string;
  sha256: string;
  size_bytes: number;
  uploaded_at: Date;
  uploaded_by: string;
  by_name: string;
  by_role: Role;
}

function presentReport(viewer: Viewer, row: ReportRow): Report {
  return {
    id: row.id,
    car_id: row.car_id,
    sha256: row.sha256,
    size_bytes: row.size_bytes,
    uploaded_at: iso(row.uploaded_at),
    uploaded_by: presentActor(viewer, { id: row.uploaded_by, name: row.by_name, role: row.by_role }),
  };
}

const REPORT_SELECT = "SELECT r.*, u.name AS by_name, u.role AS by_role FROM condition_reports r JOIN users u ON u.id = r.uploaded_by";

export async function reportOf(db: Db, viewer: Viewer, carId: string): Promise<Report | null> {
  const row = await one<ReportRow>(db, `${REPORT_SELECT} WHERE r.car_id = $1`, [carId]);
  return row ? presentReport(viewer, row) : null;
}

interface PhotoRow {
  [key: string]: unknown;
  id: string;
  car_id: string;
  kind: "intake" | "stage";
  job_id: string | null;
  content_type: string;
  size_bytes: number;
  created_at: Date;
}

function presentPhoto(row: PhotoRow): Photo {
  return {
    id: row.id,
    car_id: row.car_id,
    kind: row.kind,
    job_id: row.job_id,
    content_type: row.content_type,
    size_bytes: row.size_bytes,
    attached: true,
    created_at: iso(row.created_at),
  };
}

export async function photosOf(db: Db, carId: string, jobId?: string): Promise<Photo[]> {
  const rows = await many<PhotoRow>(
    db,
    `SELECT * FROM photos WHERE car_id = $1 ${jobId ? "AND job_id = $2" : ""} ORDER BY created_at, id`,
    jobId ? [carId, jobId] : [carId],
  );
  return rows.map(presentPhoto);
}

async function receiveForm(ctx: Ctx): Promise<FormData> {
  const boundary = boundaryOf(ctx.req.headers["content-type"] ?? "");
  if (!boundary) throw unsupportedMediaType();
  return parseForm(await ctx.readUpload(), boundary);
}

async function releaseClaim(carId: string): Promise<void> {
  await pool.query("DELETE FROM stay_claims WHERE car_id = $1", [carId]);
}

export async function uploadReport(ctx: Ctx): Promise<Reply> {
  const car = await visibleCar(pool, ctx.user, ctx.params.id ?? "");
  requireRole(ctx.user, "concierge", "house_manager");

  // Claim the stay before reading the body: a second upload answers at once.
  const claimed = await transaction(async (client) => {
    if (await one(client, "SELECT 1 FROM condition_reports WHERE car_id = $1", [car.id])) return false;
    const result = await client.query(
      `INSERT INTO stay_claims (car_id) VALUES ($1)
       ON CONFLICT (car_id) DO UPDATE SET claimed_at = clock_timestamp()
         WHERE stay_claims.claimed_at < clock_timestamp() - interval '${STALE_CLAIM}'`,
      [car.id],
    );
    return result.rowCount === 1;
  });
  if (!claimed) throw conflict("report_already_signed");

  try {
    const form = await receiveForm(ctx);
    const file = form.file;
    if (!file || !file.data.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw invalid("file", "Upload a PDF.");
    const id = newId("cr");
    try {
      await putObject(reportKey(car.id, id), file.data, "application/pdf");
    } catch (error) {
      if (error instanceof ProviderDown) throw storageUnavailable();
      throw error;
    }
    const sha256 = createHash("sha256").update(file.data).digest("hex");
    await transaction(async (client) => {
      await client.query(
        "INSERT INTO condition_reports (id, car_id, sha256, size_bytes, uploaded_at, uploaded_by) VALUES ($1, $2, $3, $4, clock_timestamp(), $5)",
        [id, car.id, sha256, file.data.length, ctx.user.id],
      );
      await client.query("DELETE FROM stay_claims WHERE car_id = $1", [car.id]);
    });
    const row = await one<ReportRow>(pool, `${REPORT_SELECT} WHERE r.id = $1`, [id]);
    if (!row) throw new Error("report vanished");
    return { status: 201, body: { report: presentReport(ctx.user, row) } };
  } catch (error) {
    await releaseClaim(car.id);
    throw error;
  }
}

function imageType(data: Buffer): "image/jpeg" | "image/png" | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  return null;
}

export async function uploadPhoto(ctx: Ctx): Promise<Reply> {
  const car = await visibleCar(pool, ctx.user, ctx.params.id ?? "");
  requireRole(ctx.user, "concierge", "workshop_lead", "house_manager");
  const form = await receiveForm(ctx);
  const kind = form.fields.kind === "stage" ? "stage" : form.fields.kind === "intake" ? "intake" : null;
  const jobId = kind === "stage" ? (form.fields.job_id ?? null) : null;
  if (jobId !== null && !(await one(pool, "SELECT 1 FROM jobs WHERE id = $1 AND car_id = $2", [jobId, car.id]))) throw notFound();
  if (kind === "stage") requireRole(ctx.user, "workshop_lead", "house_manager");
  else requireRole(ctx.user, "concierge", "house_manager");

  const errors = new FieldErrors();
  if (!kind) errors.add("kind", "Choose intake or stage.");
  if (kind === "stage" && jobId === null) errors.add("job_id", "Choose the job this photo belongs to.");
  const contentType = form.file ? imageType(form.file.data) : null;
  if (!contentType) errors.add("file", "Upload a JPEG or PNG image.");
  errors.throwIfAny();
  const data = form.file?.data ?? Buffer.alloc(0);
  const type = contentType ?? "image/png";

  const id = newId("p");
  try {
    await putObject(photoKey(car.id, id, type), data, type);
  } catch (error) {
    if (error instanceof ProviderDown) throw storageUnavailable();
    throw error;
  }
  await pool.query(
    "INSERT INTO photos (id, car_id, kind, job_id, content_type, size_bytes, created_at, created_by) VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp(), $7)",
    [id, car.id, kind, jobId, type, data.length, ctx.user.id],
  );
  const row = await one<PhotoRow>(pool, "SELECT * FROM photos WHERE id = $1", [id]);
  if (!row) throw new Error("photo vanished");
  return { status: 201, body: { photo: presentPhoto(row) } };
}

export async function downloadReport(ctx: Ctx): Promise<Reply> {
  const row = await one<ReportRow>(ctx.db, `${REPORT_SELECT} WHERE r.id = $1`, [ctx.params.id ?? ""]);
  if (!row) throw notFound();
  await visibleCar(ctx.db, ctx.user, row.car_id);
  try {
    const data = await getObject(reportKey(row.car_id, row.id));
    return {
      status: 200,
      file: { contentType: "application/pdf", data },
      headers: { "Content-Disposition": `attachment; filename="condition-report-${row.car_id}.pdf"` },
    };
  } catch (error) {
    if (error instanceof ProviderDown) throw storageUnavailable();
    throw error;
  }
}

export async function photoContent(ctx: Ctx): Promise<Reply> {
  const row = await one<PhotoRow>(ctx.db, "SELECT * FROM photos WHERE id = $1", [ctx.params.id ?? ""]);
  if (!row) throw notFound();
  await visibleCar(ctx.db, ctx.user, row.car_id);
  if (ctx.user.role === "owner" && row.job_id && (await one(ctx.db, "SELECT 1 FROM jobs WHERE id = $1 AND status = 'draft'", [row.job_id]))) {
    throw notFound();
  }
  try {
    const data = await getObject(photoKey(row.car_id, row.id, row.content_type));
    return { status: 200, file: { contentType: row.content_type, data } };
  } catch (error) {
    if (error instanceof ProviderDown) throw storageUnavailable();
    throw error;
  }
}
