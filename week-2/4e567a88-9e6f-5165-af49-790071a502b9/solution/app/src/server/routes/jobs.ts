// Jobs: submission, reads, cancellation, the jobs CSV and the queue lanes.

import { allow, authenticate, teamVisible, type Caller } from "../auth";
import { csvText } from "../csv";
import { one, pool, rows, tx } from "../db";
import { finishJob, isFinal } from "../domain/lifecycle";
import { currentPolicy } from "../domain/policy";
import { submitJob } from "../domain/submission";
import { loadJobs, projectJob, visiblePrompt, type JobStatus } from "../domain/visibility";
import { fail, invalid } from "../errors";
import { json, route, type Req } from "../http";
import { storageDown } from "../services/status";
import { unitsText } from "../../shared/units";
import { nudgeDispatcher } from "../workers/dispatcher";
import { nudgeWebhooks } from "../workers/webhooks";

const STATUSES: readonly JobStatus[] = ["queued", "leased", "running", "succeeded", "failed", "cancelled"];

/** The team a read is scoped to: a member's own team (another team is 404), any team for org roles. */
async function scopedTeam(req: Req, caller: Caller, required: boolean): Promise<string | null> {
  const team = req.query.get("team");
  if (team === null) {
    if (caller.team_id === null && required) invalid({ team: "Choose a team." });
    return caller.team_id;
  }
  const known = await one<{ id: string }>(pool, "SELECT id FROM teams WHERE id = $1", [team]);
  if (!known || !teamVisible(caller, team)) fail("not_found");
  return team;
}

route("POST", "/api/jobs", "json", async (req) => {
  const caller = await authenticate(req);
  const { reply, created } = await submitJob(req, caller);
  if (created) nudgeDispatcher();
  return reply;
});

route("GET", "/api/jobs", "none", async (req) => {
  const caller = await authenticate(req);
  const team = await scopedTeam(req, caller, false);
  const errors: Record<string, string> = {};
  const status = req.query.get("status");
  if (status !== null && !STATUSES.includes(status as JobStatus)) errors.status = "Choose a job status.";
  const limitText = req.query.get("limit") ?? "50";
  const limit = /^\d{1,3}$/.test(limitText) ? Number(limitText) : 0;
  if (limit < 1 || limit > 200) errors.limit = "Use a limit from 1 to 200.";
  const cursor = req.query.get("cursor");
  if (cursor !== null && !/^\d{1,18}$/.test(cursor)) errors.cursor = "Use the next_cursor of the previous page.";
  if (Object.keys(errors).length) invalid(errors);
  const found = await loadJobs(pool,
    "($1::text IS NULL OR j.team_id = $1) AND ($2::text IS NULL OR j.status = $2) AND ($3::bigint IS NULL OR j.number < $3)",
    [team, status, cursor], `ORDER BY j.number DESC LIMIT ${limit + 1}`);
  const policy = await currentPolicy(pool);
  const page = found.slice(0, limit);
  return json(200, {
    jobs: page.map((j) => projectJob(j, caller, policy, storageDown())),
    next_cursor: found.length > limit ? String(page[page.length - 1].number) : null,
  });
});

route("GET", "/api/jobs.csv", "none", async (req) => {
  const caller = await authenticate(req);
  const team = await scopedTeam(req, caller, false);
  const policy = await currentPolicy(pool);
  const jobs = await loadJobs(pool, "($1::text IS NULL OR j.team_id = $1)", [team], "ORDER BY j.number DESC");
  const header = ["job_id", "team", "model", "status", "submitted_by", "submitted_at", "finished_at", "unit", "billed_units",
    "rate_micro_per_unit", "charged_micro", "prompt"];
  const lines = jobs.map((j) => [
    j.id, j.team_id, j.model, j.status, j.submitted_by, j.submitted_at.toISOString(), j.finished_at?.toISOString() ?? null,
    j.unit, j.billed_units_micro === null ? null : unitsText(j.billed_units_micro), j.rate_micro, j.charged_micro,
    visiblePrompt(j, caller, policy),
  ]);
  return {
    status: 200,
    text: csvText([header, ...lines]),
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="jobs-${team ?? "all-teams"}.csv"`,
    },
  };
});

async function readJob(caller: Caller, id: string) {
  const [job] = await loadJobs(pool, "j.id = $1", [id]);
  if (!job || !teamVisible(caller, job.team_id)) fail("not_found");
  return job;
}

route("GET", "/api/jobs/{id}", "none", async (req) => {
  const caller = await authenticate(req);
  const job = await readJob(caller, req.params.id);
  return json(200, { job: projectJob(job, caller, await currentPolicy(pool), storageDown()) });
});

route("POST", "/api/jobs/{id}/cancel", "none", async (req) => {
  const caller = await authenticate(req);
  const seen = await readJob(caller, req.params.id);
  allow(caller, "member", "admin");
  const notify = await tx(async (client) => {
    const [job] = await loadJobs(client, "j.id = $1", [seen.id], "FOR UPDATE OF j");
    if (job.status === "cancelled") return false;
    if (isFinal(job.status)) fail("job_not_cancellable", { status: job.status });
    return finishJob(client, job, { status: "cancelled" }, new Date());
  });
  if (notify) nudgeWebhooks();
  nudgeDispatcher();
  const [job] = await loadJobs(pool, "j.id = $1", [seen.id]);
  return json(200, { job: projectJob(job, caller, await currentPolicy(pool), storageDown()) });
});

route("GET", "/api/queue", "none", async (req) => {
  const caller = await authenticate(req);
  const team = await scopedTeam(req, caller, true) as string;
  const policy = await currentPolicy(pool);
  const models = await rows<{ slug: string }>(pool, "SELECT slug FROM models ORDER BY position");
  const jobs = await loadJobs(pool, "j.team_id = $1 AND j.status IN ('queued', 'leased', 'running')", [team],
    "ORDER BY j.priority_rank, j.submitted_at, j.number");
  const down = storageDown();
  return json(200, {
    lanes: models.map(({ slug }) => ({
      model: slug,
      queued: jobs.filter((j) => j.model === slug && j.status === "queued").map((j) => projectJob(j, caller, policy, down)),
      running: jobs.filter((j) => j.model === slug && j.status !== "queued").map((j) => projectJob(j, caller, policy, down)),
    })),
  });
});
