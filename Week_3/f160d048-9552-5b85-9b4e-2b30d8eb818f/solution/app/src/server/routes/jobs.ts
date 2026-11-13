import { first, pool, rows } from "../db/pool";
import { inUnit } from "../db/unit";
import { alertLabel, alertSearch, type AlertFilters } from "../domain/alertLabel";
import { isTeam } from "../domain/viewer";
import { invalidFields, refuse } from "../http/fail";
import { defineRoute, requireJsonObject, type Ctx, type Handler } from "../http/route";
import { JOB_SQL, toJobDetail, toJobSummary, type JobRow } from "../services/jobView";
import { filterClause, search, SearchUnavailable, type Document } from "../services/search";
import { config } from "../config";
import { alertShape, parseShape } from "../../shared/rules";
import { CITIES, type CityId, type RoleFamilyId, type WorkPatternId, type PayBandId } from "../../shared/reference";
import type { AlertRow, JobSearch, JobSummary } from "../../shared/api";

function summaryOf(document: Document): JobSummary {
  return {
    id: String(document["id"]),
    title: String(document["title"]),
    company_name: String(document["company_name"]),
    company_slug: String(document["company_slug"]),
    city: document["city"] as CityId,
    city_name: String(document["city_name"]),
    role_family: document["role_family"] as RoleFamilyId,
    remote: document["remote"] as WorkPatternId,
    pay_low: Number(document["pay_low"]),
    pay_high: Number(document["pay_high"]),
    pay_band: document["pay_band"] as PayBandId,
    listed_at: new Date(Number(document["listed_at"]) * 1000).toISOString(),
  };
}

const emptyFacets = { city: {}, role_family: {}, remote: {}, pay_band: {} };

async function jobsByCity(): Promise<JobSearch> {
  const listed = await rows<JobRow>(`${JOB_SQL} WHERE j.status = 'listed' ORDER BY j.listed_at DESC, j.id`);
  const summaries = listed.map(toJobSummary);
  const cities = CITIES.map((city) => ({
    city: city.id,
    city_name: city.name,
    jobs: summaries.filter((job) => job.city === city.id),
  }))
    .filter((entry) => entry.jobs.length > 0)
    .sort((a, b) => a.city_name.localeCompare(b.city_name))
    .map((entry) => ({ ...entry, total: entry.jobs.length }));
  return { fallback: "by_city", cities };
}

const jobSearch = defineRoute({
  method: "GET",
  path: "/api/jobs/search",
  auth: "public",
  async run(ctx) {
    const params = ctx.url.searchParams;
    const text = params.get("q") ?? "";
    const page = Math.max(1, Number(params.get("page")) || 1);
    const filter = [
      filterClause("city", params.getAll("city")),
      filterClause("role_family", params.getAll("role")),
      filterClause("remote", params.getAll("remote")),
      filterClause("pay_band", params.getAll("band")),
    ].filter((group) => group.length > 0);
    try {
      const result = await search("jobs", {
        q: text,
        filter,
        facets: ["city", "role_family", "remote", "pay_band"],
        page,
        hitsPerPage: config.limits.searchPageSize,
        ...(text.trim() === "" ? { sort: ["listed_at:desc"] } : {}),
      });
      const body: JobSearch = {
        total: result.totalHits,
        page,
        page_size: config.limits.searchPageSize,
        hits: result.hits.map(summaryOf),
        facets: { ...emptyFacets, ...result.facetDistribution },
      };
      return { status: 200, body };
    } catch (error) {
      if (!(error instanceof SearchUnavailable)) throw error;
      return { status: 200, body: await jobsByCity() };
    }
  },
});

const suggest = defineRoute({
  method: "GET",
  path: "/api/jobs/suggest",
  auth: "public",
  async run(ctx) {
    const text = (ctx.url.searchParams.get("q") ?? "").trim();
    if (text === "") return { status: 200, body: { options: [] } };
    try {
      const result = await search("jobs", { q: text, limit: 20 });
      const titles = [...new Set(result.hits.map((hit) => String(hit["title"])))];
      return { status: 200, body: { options: titles.slice(0, 8) } };
    } catch (error) {
      if (!(error instanceof SearchUnavailable)) throw error;
      return { status: 200, body: { options: [] } };
    }
  },
});

/** A job this caller may see: draft jobs only for the owning company's team. */
async function loadVisibleJob(ctx: Ctx): Promise<JobRow> {
  const job = await first<JobRow>(`${JOB_SQL} WHERE j.id = $1`, [ctx.params["id"]]);
  const viewer = ctx.viewer;
  const team = viewer !== null && isTeam(viewer) && viewer.companyId === job?.company_id;
  if (!job || (job.status === "draft" && !team)) throw refuse("not_found");
  return job;
}

const jobPage = defineRoute({
  method: "GET",
  path: "/api/jobs/:id",
  auth: "public",
  load: loadVisibleJob,
  async run(_ctx, job) {
    return { status: 200, body: toJobDetail(job) };
  },
});

const saveJob = defineRoute({
  method: "PUT",
  path: "/api/saved-jobs/:id",
  auth: "session",
  roles: ["member"],
  load: loadVisibleJob,
  async run(ctx, job) {
    await pool.query("INSERT INTO saved_jobs (user_id, job_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [ctx.viewer?.id, job.id]);
    return { status: 200, body: { saved: true } };
  },
});

const unsaveJob = defineRoute({
  method: "DELETE",
  path: "/api/saved-jobs/:id",
  auth: "session",
  roles: ["member"],
  load: loadVisibleJob,
  async run(ctx, job) {
    await pool.query("DELETE FROM saved_jobs WHERE user_id = $1 AND job_id = $2", [ctx.viewer?.id, job.id]);
    return { status: 200, body: { saved: false } };
  },
});

const savedJobs = defineRoute({
  method: "GET",
  path: "/api/saved-jobs",
  auth: "session",
  roles: ["member"],
  async run(ctx) {
    const saved = await rows<JobRow>(
      `${JOB_SQL} JOIN saved_jobs s ON s.job_id = j.id WHERE s.user_id = $1 ORDER BY s.saved_at DESC, j.id`,
      [ctx.viewer?.id],
    );
    return { status: 200, body: { jobs: saved.map(toJobSummary) } };
  },
});

type AlertRecord = AlertFilters & { id: string; label: string; new_count: number };

const alertRow = (alert: AlertRecord): AlertRow => ({
  id: alert.id,
  label: alert.label,
  new_count: alert.new_count,
  search: alertSearch(alert),
});

const ALERT_COLUMNS = "id, q, city, role, remote, band, label, new_count";

const createAlert = defineRoute({
  method: "POST",
  path: "/api/alerts",
  auth: "session",
  roles: ["member"],
  body: "json",
  input(ctx) {
    const parsed = parseShape(alertShape, requireJsonObject(ctx));
    if (!parsed.ok) throw invalidFields(parsed.fields);
    return parsed.value;
  },
  async run(ctx, _loaded, input) {
    const label = alertLabel(input);
    const created = await first<AlertRecord>(
      `INSERT INTO alerts (user_id, q, city, role, remote, band, label) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${ALERT_COLUMNS}`,
      [ctx.viewer?.id, input.q, input.city, input.role, input.remote, input.band, label],
    );
    return { status: 201, body: { id: created?.id, label, new_count: 0 } };
  },
});

const listAlerts = defineRoute({
  method: "GET",
  path: "/api/alerts",
  auth: "session",
  roles: ["member"],
  async run(ctx) {
    const alerts = await rows<AlertRecord>(`SELECT ${ALERT_COLUMNS} FROM alerts WHERE user_id = $1 ORDER BY created_at DESC, id`, [ctx.viewer?.id]);
    return { status: 200, body: { alerts: alerts.map(alertRow) } };
  },
});

async function loadAlert(ctx: Ctx): Promise<AlertRecord> {
  const alert = ctx.viewer
    ? await first<AlertRecord>(`SELECT ${ALERT_COLUMNS} FROM alerts WHERE id = $1 AND user_id = $2`, [ctx.params["id"], ctx.viewer.id])
    : undefined;
  if (!alert) throw refuse("not_found");
  return alert;
}

const seenAlert = defineRoute({
  method: "POST",
  path: "/api/alerts/:id/seen",
  auth: "session",
  roles: ["member"],
  load: loadAlert,
  async run(_ctx, alert) {
    await inUnit(async (unit) => {
      await unit.query("UPDATE alerts SET new_count = 0 WHERE id = $1", [alert.id]);
    });
    return { status: 200, body: { id: alert.id, label: alert.label, new_count: 0 } };
  },
});

const deleteAlert = defineRoute({
  method: "DELETE",
  path: "/api/alerts/:id",
  auth: "session",
  roles: ["member"],
  load: loadAlert,
  async run(_ctx, alert) {
    await pool.query("DELETE FROM alerts WHERE id = $1", [alert.id]);
    return { status: 204 };
  },
});

export const jobRoutes: Handler[] = [
  jobSearch, suggest, jobPage, saveJob, unsaveJob, savedJobs, createAlert, listAlerts, seenAlert, deleteAlert,
];
