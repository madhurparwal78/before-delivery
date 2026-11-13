import { randomInt } from "node:crypto";
import { config } from "../config";
import { first, rows } from "../db/pool";
import { inUnit } from "../db/unit";
import { applicantsCsv } from "../domain/applicantsCsv";
import { findContactDetail } from "../domain/contact";
import { postedMonth } from "../domain/anonymity";
import { isLegalStageMove } from "../domain/stages";
import { ApiError, invalidFields, refuse } from "../http/fail";
import { defineRoute, jsonField, requireJsonObject, type Ctx, type Handler } from "../http/route";
import { digest } from "../services/passwords";
import { consumeRate } from "../services/rate";
import { publishDraftJob } from "../services/publishJob";
import { APPLICANT_SQL, toApplicant, type ApplicantRow } from "../services/applicantView";
import { JOB_SQL, toJobDetail, type JobRow } from "../services/jobView";
import { putObject, StorageUnavailable } from "../services/storage";
import { replyShape, parseJob, parseShape, verificationEmailShape } from "../../shared/rules";
import { FIELD_COPY } from "../../shared/errors";
import { STAGES, type StageId } from "../../shared/reference";

const TEAM = ["employer_admin", "recruiter"] as const;
const MARK_MAX_BYTES = 1048576;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CODE_REQUESTS = 3;

type TeamCompany = { id: string; slug: string; name: string; email_domain: string };

/** The caller's own company; only team roles reach it, because the role check runs first. */
async function teamCompany(ctx: Ctx): Promise<TeamCompany> {
  const company = await first<TeamCompany>("SELECT id, slug, name, email_domain FROM companies WHERE id = $1", [ctx.viewer?.companyId]);
  if (!company) throw refuse("forbidden");
  return company;
}

/** A record of another company's team is not visible to the caller. */
const foreignTo = (ctx: Ctx, companyId: string): boolean => ctx.viewer?.companyId != null && ctx.viewer.companyId !== companyId;

const requestCode = defineRoute({
  method: "POST",
  path: "/api/employer/verification/request",
  auth: "session",
  roles: ["employer_admin"],
  body: "json",
  async limit(ctx) {
    await consumeRate(`code:${(await teamCompany(ctx)).id}`, CODE_REQUESTS, config.limits.emailCodeTtlSeconds);
  },
  async input(ctx) {
    const parsed = parseShape(verificationEmailShape((await teamCompany(ctx)).email_domain), requireJsonObject(ctx));
    if (!parsed.ok) throw invalidFields(parsed.fields);
    return parsed.value;
  },
  async run(ctx, _loaded, input) {
    const company = await teamCompany(ctx);
    const code = String(randomInt(0, 1000000)).padStart(6, "0");
    await inUnit(async (unit) => {
      await unit.query(
        `INSERT INTO verification_codes (company_id, code_hash, issued_at) VALUES ($1, $2, app_now())
         ON CONFLICT (company_id) DO UPDATE SET code_hash = EXCLUDED.code_hash, issued_at = EXCLUDED.issued_at`,
        [company.id, digest(code)],
      );
      await unit.mail(
        input.email,
        "Your Candour Bench verification code",
        `Your code is ${code}. It expires in ${Math.ceil(config.limits.emailCodeTtlSeconds / 60)} minutes.\n`,
      );
    });
    return { status: 202, body: { status: "queued" } };
  },
});

const confirmCode = defineRoute({
  method: "POST",
  path: "/api/employer/verification/confirm",
  auth: "session",
  roles: ["employer_admin"],
  body: "json",
  async run(ctx) {
    const company = await teamCompany(ctx);
    requireJsonObject(ctx);
    const code = jsonField(ctx, "code");
    await inUnit(async (unit) => {
      const issued = await unit.first<{ code_hash: string; expired: boolean }>(
        `SELECT code_hash, issued_at + make_interval(secs => $2) <= app_now() AS expired
           FROM verification_codes WHERE company_id = $1 FOR UPDATE`,
        [company.id, config.limits.emailCodeTtlSeconds],
      );
      if (!issued || typeof code !== "string" || issued.code_hash !== digest(code.trim())) throw refuse("code_invalid");
      if (issued.expired) throw refuse("code_expired");
      await unit.query("DELETE FROM verification_codes WHERE company_id = $1", [company.id]);
      await unit.query("UPDATE companies SET verified = true WHERE id = $1", [company.id]);
      await unit.syncSearch("companies", company.id);
      unit.emit({ type: "company.changed", audience: ["all"], data: { slug: company.slug } });
      await unit.audit("company_verified", company.id, ctx.viewer?.id ?? null, {});
    });
    return { status: 200, body: { verified: true } };
  },
});

type ReviewTarget = { id: string; company_id: string; company_name: string; company_slug: string; replied: boolean };

const reply = defineRoute({
  method: "POST",
  path: "/api/employer/reviews/:id/reply",
  auth: "session",
  roles: TEAM,
  verified: true,
  body: "json",
  async load(ctx) {
    const review = await first<ReviewTarget>(
      `SELECT p.id, p.company_id, c.name AS company_name, c.slug AS company_slug,
              EXISTS (SELECT 1 FROM replies r WHERE r.review_id = p.id) AS replied
         FROM posts p JOIN companies c ON c.id = p.company_id
        WHERE p.id = $1 AND p.kind = 'review' AND p.state = 'approved' AND p.deleted_at IS NULL`,
      [ctx.params["id"]],
    );
    if (!review || foreignTo(ctx, review.company_id)) throw refuse("not_found");
    return review;
  },
  async conflicts(_ctx, review) {
    if (review.replied) throw refuse("already_replied");
  },
  input(ctx) {
    const parsed = parseShape(replyShape, requireJsonObject(ctx));
    if (!parsed.ok) throw invalidFields(parsed.fields);
    const finding = findContactDetail([["body", parsed.value.body]]);
    if (finding) throw new ApiError(finding.code, {}, { field: finding.field });
    return parsed.value;
  },
  async run(_ctx, review, input) {
    const created = await inUnit(async (unit) => {
      const inserted = await unit.first<{ created_at: Date }>(
        `INSERT INTO replies (review_id, company_id, body, created_at) VALUES ($1, $2, $3, app_now())
         ON CONFLICT DO NOTHING RETURNING created_at`,
        [review.id, review.company_id, input.body],
      );
      if (!inserted) throw refuse("already_replied");
      unit.emit({ type: "company.changed", audience: ["all"], data: { slug: review.company_slug } });
      await unit.syncSearch("companies", review.company_id);
      return inserted.created_at;
    });
    return {
      status: 201,
      body: { review_id: review.id, company_name: review.company_name, body: input.body, posted_month: postedMonth(created) },
    };
  },
});

const createJob = defineRoute({
  method: "POST",
  path: "/api/employer/jobs",
  auth: "session",
  roles: TEAM,
  verified: true,
  body: "json",
  input(ctx) {
    const parsed = parseJob(requireJsonObject(ctx));
    if (!parsed.ok) throw invalidFields(parsed.fields);
    return parsed.value;
  },
  async run(ctx, _loaded, input) {
    const created = await first<{ id: string }>(
      `INSERT INTO jobs (company_id, title, role_family, city, remote, pay_low, pay_high, description, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft') RETURNING id`,
      [ctx.viewer?.companyId, input.title, input.role_family, input.city, input.remote, input.pay_low, input.pay_high, input.description],
    );
    if (!created) throw refuse("not_found");
    await publishDraftJob(created.id);
    return { status: 201, body: await jobDetail(created.id) };
  },
});

async function jobDetail(id: string) {
  const job = await first<JobRow>(`${JOB_SQL} WHERE j.id = $1`, [id]);
  if (!job) throw refuse("not_found");
  return toJobDetail(job);
}

async function loadTeamJob(ctx: Ctx): Promise<JobRow> {
  const job = await first<JobRow>(`${JOB_SQL} WHERE j.id = $1`, [ctx.params["id"]]);
  if (!job || foreignTo(ctx, job.company_id)) throw refuse("not_found");
  return job;
}

const listJob = defineRoute({
  method: "POST",
  path: "/api/employer/jobs/:id/list",
  auth: "session",
  roles: TEAM,
  verified: true,
  load: loadTeamJob,
  async conflicts(_ctx, job) {
    if (job.status === "closed") throw refuse("invalid_transition");
  },
  async run(_ctx, job) {
    if (job.status === "draft") await publishDraftJob(job.id);
    return { status: 200, body: await jobDetail(job.id) };
  },
});

const closeJob = defineRoute({
  method: "POST",
  path: "/api/employer/jobs/:id/close",
  auth: "session",
  roles: TEAM,
  verified: true,
  load: loadTeamJob,
  async run(_ctx, job) {
    await inUnit(async (unit) => {
      const closed = await unit.first<{ id: string }>("UPDATE jobs SET status = 'closed' WHERE id = $1 AND status <> 'closed' RETURNING id", [job.id]);
      if (!closed) return;
      await unit.syncSearch("jobs", job.id);
      unit.emit({ type: "company.changed", audience: ["all"], data: { slug: job.company_slug } });
      await unit.audit("job_closed", job.id, null, {});
    });
    return { status: 200, body: await jobDetail(job.id) };
  },
});

const myJobs = defineRoute({
  method: "GET",
  path: "/api/employer/jobs",
  auth: "session",
  roles: TEAM,
  async run(ctx) {
    const jobs = await rows<JobRow>(`${JOB_SQL} WHERE j.company_id = $1 ORDER BY j.created_at DESC, j.id`, [ctx.viewer?.companyId]);
    return { status: 200, body: { jobs: jobs.map(toJobDetail) } };
  },
});

const APPLICANT_ORDER = `ORDER BY a.applied_at DESC, a.id COLLATE "C"`;

const applicants = defineRoute({
  method: "GET",
  path: "/api/employer/jobs/:id/applicants",
  auth: "session",
  roles: TEAM,
  load: loadTeamJob,
  async run(_ctx, job) {
    const found = await rows<ApplicantRow>(`${APPLICANT_SQL} WHERE a.job_id = $1 ${APPLICANT_ORDER}`, [job.id]);
    return { status: 200, body: { applicants: found.map(toApplicant) } };
  },
});

const applicantsCsvRoute = defineRoute({
  method: "GET",
  path: "/api/employer/jobs/:id/applicants.csv",
  auth: "session",
  roles: TEAM,
  load: loadTeamJob,
  async run(_ctx, job) {
    const found = await rows<ApplicantRow>(`${APPLICANT_SQL} WHERE a.job_id = $1 ${APPLICANT_ORDER}`, [job.id]);
    return {
      status: 200,
      headers: { "Content-Disposition": `attachment; filename="applicants-${job.id}.csv"` },
      file: { contentType: "text/csv; charset=utf-8", data: Buffer.from(applicantsCsv(found), "utf8") },
    };
  },
});

async function loadTeamApplicant(ctx: Ctx): Promise<ApplicantRow> {
  const found = await first<ApplicantRow>(`${APPLICANT_SQL} WHERE a.id = $1`, [ctx.params["id"]]);
  if (!found || foreignTo(ctx, found.company_id)) throw refuse("not_found");
  return found;
}

const applicantDetail = defineRoute({
  method: "GET",
  path: "/api/employer/applications/:id",
  auth: "session",
  roles: TEAM,
  load: loadTeamApplicant,
  async run(_ctx, application) {
    return { status: 200, body: toApplicant(application) };
  },
});

const moveStage = defineRoute({
  method: "POST",
  path: "/api/employer/applications/:id/stage",
  auth: "session",
  roles: TEAM,
  verified: true,
  body: "json",
  load: loadTeamApplicant,
  input(ctx) {
    requireJsonObject(ctx);
    const stage = STAGES.find((entry) => entry.id === jsonField(ctx, "stage"));
    if (!stage) throw invalidFields({ stage: FIELD_COPY.stage });
    return stage;
  },
  async run(ctx, application, stage) {
    const moved = await inUnit(async (unit) => {
      const locked = await unit.first<{ stage: StageId }>("SELECT stage FROM applications WHERE id = $1 FOR UPDATE", [application.id]);
      if (!locked || !isLegalStageMove(locked.stage, stage.id)) throw refuse("invalid_transition");
      await unit.query("UPDATE applications SET stage = $2, updated_at = app_now() WHERE id = $1", [application.id, stage.id]);
      await unit.audit("stage_moved", application.id, ctx.viewer?.id ?? null, { from: locked.stage, to: stage.id });
      unit.emit({
        type: "application.stage",
        audience: [`user:${application.user_id}`, `team:${application.company_id}`],
        data: { application_id: application.id, job_id: application.job_id, stage: stage.id },
      });
      await unit.mail(
        application.contact_email,
        `Your application for ${application.job_title} at ${application.company_name}`,
        `Your application is now at the ${stage.name} stage.\n`,
      );
      return unit.first<ApplicantRow>(`${APPLICANT_SQL} WHERE a.id = $1`, [application.id]);
    });
    if (!moved) throw refuse("not_found");
    return { status: 200, body: toApplicant(moved) };
  },
});

const putMark = defineRoute({
  method: "PUT",
  path: "/api/employer/company/mark",
  auth: "session",
  roles: TEAM,
  body: "png",
  async limit(ctx) {
    await consumeRate(`upload:${ctx.viewer?.id}`, config.limits.uploadRatePerMinute, 60);
  },
  input(ctx) {
    const image = ctx.raw ?? Buffer.alloc(0);
    if (image.length < PNG_SIGNATURE.length || !image.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) throw refuse("mark_not_png");
    if (image.length > MARK_MAX_BYTES) throw refuse("mark_too_large");
    return image;
  },
  async run(ctx, _loaded, image) {
    const company = await teamCompany(ctx);
    const key = `marks/${company.id}.png`;
    try {
      await putObject(key, image, "image/png");
    } catch (error) {
      if (error instanceof StorageUnavailable) throw refuse("storage_unavailable");
      throw error;
    }
    const markFileId = await inUnit(async (unit) => {
      const file = await unit.first<{ id: string }>(
        "INSERT INTO files (object_key, content_type, size_bytes) VALUES ($1, 'image/png', $2) RETURNING id",
        [key, image.length],
      );
      await unit.query("UPDATE companies SET mark_file_id = $2 WHERE id = $1", [company.id, file?.id]);
      unit.emit({ type: "company.changed", audience: ["all"], data: { slug: company.slug } });
      return file?.id;
    });
    return { status: 200, body: { mark_url: `/api/files/${markFileId}` } };
  },
});

export const employerRoutes: Handler[] = [
  requestCode, confirmCode, reply, createJob, listJob, closeJob, myJobs, applicantsCsvRoute, applicants, applicantDetail, moveStage, putMark,
];
