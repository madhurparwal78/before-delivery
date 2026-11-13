import { randomUUID } from "node:crypto";
import { config } from "../config";
import { first, isUniqueViolation, rows } from "../db/pool";
import { inUnit, type Unit } from "../db/unit";
import { ApiError, invalidFields, refuse } from "../http/fail";
import { defineRoute, type Ctx, type Handler } from "../http/route";
import { applyFingerprint, IDEMPOTENCY_HEADER } from "../services/applyKey";
import { APPLICANT_SQL, type ApplicantRow } from "../services/applicantView";
import { consumeRate } from "../services/rate";
import { deleteObject, getObject, putObject, storedSize, StorageUnavailable } from "../services/storage";
import { FIELD_COPY } from "../../shared/errors";
import { applyShape, parseShape } from "../../shared/rules";
import type { ApplicationCreated, MyApplication } from "../../shared/api";
import { isTeam } from "../domain/viewer";

const PDF_SIGNATURE = Buffer.from("%PDF-");

type TargetJob = { id: string; status: string; company_id: string; company_slug: string };

const keyOf = (ctx: Ctx): string | undefined => {
  const header = ctx.req.headers[IDEMPOTENCY_HEADER];
  return typeof header === "string" && header.trim() !== "" ? header.trim() : undefined;
};

async function storedKey(unit: Pick<Unit, "first">, userId: string, key: string) {
  return unit.first<{ fingerprint: string; response: ApplicationCreated }>(
    `SELECT fingerprint, response FROM apply_keys
      WHERE user_id = $1 AND key = $2 AND created_at > app_now() - make_interval(secs => $3)`,
    [userId, key, config.limits.applyKeyTtlSeconds],
  );
}

const alreadyApplied = async (jobId: string, userId: string): Promise<boolean> =>
  (await first("SELECT 1 FROM applications WHERE job_id = $1 AND user_id = $2", [jobId, userId])) !== undefined;

const apply = defineRoute({
  method: "POST",
  path: "/api/jobs/:id/applications",
  auth: "session",
  roles: ["member"],
  body: "multipart",
  async load(ctx) {
    const job = await first<TargetJob>(
      "SELECT j.id, j.status, j.company_id, c.slug AS company_slug FROM jobs j JOIN companies c ON c.id = j.company_id WHERE j.id = $1 AND j.status <> 'draft'",
      [ctx.params["id"]],
    );
    if (!job) throw refuse("not_found");
    return job;
  },
  async limit(ctx) {
    await consumeRate(`upload:${ctx.viewer?.id}`, config.limits.uploadRatePerMinute, 60);
  },
  async conflicts(ctx, job) {
    const viewer = ctx.viewer;
    const key = keyOf(ctx);
    if (!viewer) return;
    const stored = key ? await storedKey({ first }, viewer.id, key) : undefined;
    if (stored) {
      if (stored.fingerprint !== applyFingerprint(job.id, ctx.form)) throw refuse("idempotency_mismatch");
      return;
    }
    if (job.status === "closed") throw refuse("job_closed");
    if (await alreadyApplied(job.id, viewer.id)) throw refuse("duplicate_application");
  },
  input(ctx) {
    const answers = parseShape(applyShape, ctx.form?.fields ?? {});
    const resume = ctx.form?.files.find((entry) => entry.field === "resume");
    const key = keyOf(ctx);
    const fields = {
      ...(answers.ok ? {} : answers.fields),
      ...(key ? {} : { idempotency_key: FIELD_COPY.idempotency_key }),
      ...(resume ? {} : { resume: FIELD_COPY.resume }),
    };
    if (!answers.ok || !resume || !key) throw invalidFields(fields);
    if (resume.data.length < PDF_SIGNATURE.length || !resume.data.subarray(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE)) {
      throw refuse("resume_not_pdf");
    }
    if (resume.data.length > config.limits.resumeMaxBytes) throw refuse("resume_too_large");
    return { key, answers: answers.value, resume: resume.data };
  },
  async run(ctx, job, input) {
    const viewer = ctx.viewer;
    if (!viewer) throw refuse("unauthenticated");
    const fileId = randomUUID();
    const objectKey = `resumes/${fileId}.pdf`;
    const fingerprint = applyFingerprint(job.id, ctx.form);
    let stored = false;
    try {
      const created = await inUnit(async (unit) => {
        await unit.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`apply:${viewer.id}:${input.key}`]);
        const replay = await storedKey(unit, viewer.id, input.key);
        if (replay) return replay.response;
        const current = await unit.first<{ status: string }>("SELECT status FROM jobs WHERE id = $1", [job.id]);
        if (current?.status === "closed") throw refuse("job_closed");
        await putObject(objectKey, input.resume, "application/pdf");
        stored = true;
        if ((await storedSize(objectKey)) !== input.resume.length) throw new StorageUnavailable("storage did not confirm the resume");
        await unit.query("INSERT INTO files (id, object_key, content_type, size_bytes) VALUES ($1, $2, 'application/pdf', $3)", [
          fileId, objectKey, input.resume.length,
        ]);
        const inserted = await unit.first<{ id: string; applied_on: string }>(
          `INSERT INTO applications (job_id, user_id, candidate_name, contact_email, phone, cover_note, stage, applied_at, updated_at, resume_file_id)
           VALUES ($1, $2, $3, $4, $5, $6, 'submitted', app_now(), app_now(), $7)
           RETURNING id, to_char(applied_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS applied_on`,
          [job.id, viewer.id, input.answers.candidate_name, input.answers.contact_email, input.answers.phone, input.answers.cover_note, fileId],
        ).catch((error: unknown) => {
          throw isUniqueViolation(error) ? refuse("duplicate_application") : error;
        });
        if (!inserted) throw refuse("not_found");
        const body: ApplicationCreated = {
          id: inserted.id, job_id: job.id, stage: "submitted", resume_file_id: fileId, applied_on: inserted.applied_on,
        };
        await unit.query(
          `INSERT INTO apply_keys (user_id, key, fingerprint, response, created_at) VALUES ($1, $2, $3, $4, app_now())
           ON CONFLICT (user_id, key) DO UPDATE SET fingerprint = EXCLUDED.fingerprint, response = EXCLUDED.response, created_at = EXCLUDED.created_at`,
          [viewer.id, input.key, fingerprint, JSON.stringify(body)],
        );
        unit.emit({
          type: "application.stage",
          audience: [`team:${job.company_id}`],
          data: { application_id: inserted.id, job_id: job.id, stage: "submitted" },
        });
        await unit.audit("applied", inserted.id, viewer.id, {});
        return body;
      });
      return { status: 201, body: created };
    } catch (error) {
      if (stored) await deleteObject(objectKey).catch(() => undefined);
      if (error instanceof StorageUnavailable) throw new ApiError("storage_unavailable");
      throw error;
    }
  },
});

const myApplications = defineRoute({
  method: "GET",
  path: "/api/me/applications",
  auth: "session",
  roles: ["member"],
  async run(ctx) {
    const found = await rows<ApplicantRow>(`${APPLICANT_SQL} WHERE a.user_id = $1 ORDER BY a.applied_at DESC, a.id COLLATE "C"`, [ctx.viewer?.id]);
    const applications: MyApplication[] = found.map(summary);
    return { status: 200, body: { applications } };
  },
});

const summary = (row: ApplicantRow): MyApplication => ({
  id: row.id,
  job_id: row.job_id,
  job_title: row.job_title,
  company_name: row.company_name,
  stage: row.stage,
  applied_on: row.applied_at.toISOString().slice(0, 10),
  updated_on: row.updated_at.toISOString().slice(0, 10),
});

const myApplication = defineRoute({
  method: "GET",
  path: "/api/applications/:id",
  auth: "session",
  roles: ["member"],
  async load(ctx) {
    const found = await first<ApplicantRow>(`${APPLICANT_SQL} WHERE a.id = $1 AND a.user_id = $2`, [ctx.params["id"], ctx.viewer?.id]);
    if (!found) throw refuse("not_found");
    return found;
  },
  async run(_ctx, row) {
    return {
      status: 200,
      body: {
        ...summary(row),
        candidate_name: row.candidate_name,
        contact_email: row.contact_email,
        phone: row.phone,
        cover_note: row.cover_note,
        resume_file_id: row.resume_file_id,
      },
    };
  },
});

type StoredFile = { object_key: string; content_type: string };

const file = defineRoute({
  method: "GET",
  path: "/api/files/:id",
  auth: "public",
  async load(ctx) {
    const stored = await first<StoredFile & { mark_owner: string | null; candidate_id: string | null; job_company_id: string | null }>(
      `SELECT f.object_key, f.content_type,
              (SELECT c.id FROM companies c WHERE c.mark_file_id = f.id) AS mark_owner,
              a.user_id AS candidate_id, j.company_id AS job_company_id
         FROM files f LEFT JOIN applications a ON a.resume_file_id = f.id LEFT JOIN jobs j ON j.id = a.job_id
        WHERE f.id = $1`,
      [ctx.params["id"]],
    );
    const viewer = ctx.viewer;
    const mayOpen =
      stored !== undefined &&
      (stored.mark_owner !== null ||
        (viewer !== null &&
          (viewer.id === stored.candidate_id || (isTeam(viewer) && viewer.companyId === stored.job_company_id))));
    if (!stored || !mayOpen) throw refuse("not_found");
    return stored;
  },
  async run(_ctx, stored) {
    try {
      return { status: 200, file: { contentType: stored.content_type, data: await getObject(stored.object_key) } };
    } catch (error) {
      if (error instanceof StorageUnavailable) throw new ApiError("storage_unavailable");
      throw error;
    }
  },
});

export const applicationRoutes: Handler[] = [apply, myApplications, myApplication, file];
