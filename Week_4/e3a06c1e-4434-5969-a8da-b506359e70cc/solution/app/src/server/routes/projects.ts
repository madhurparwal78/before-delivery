// Projects with their quota, API keys, and speech synthesis jobs.
import { randomBytes, randomUUID } from "node:crypto";
import type { ApiKey, SynthesisJob, Voice } from "../../shared/types";
import { authenticate, authenticateKey, isUuid, permit, sha256, visibleProject, type Caller } from "../access";
import { ApiError, invalid, jsonFields, notFound, sendJson, type Request, type Router } from "../http";
import { codePoints, limited, nameKey } from "../../shared/text";
import { isUniqueViolation, one, pool, rows } from "../db";
import { period, projectQuota, quotaObject, usedSeconds } from "../quota";
import { synthesize } from "../audio";
import { getObject, putObject, synthesisKey, unavailableAs503 } from "../storage";
import { end, isLocal } from "../runtime";

const NAME_ERROR = "Enter a project name of up to 60 characters.";
const QUOTA_ERROR = "Enter a whole number of minutes from 1 to 1000000.";
const KEY_NAME_ERROR = "Enter a key name of up to 60 characters.";
const KEY_FIELD_ERROR = "Choose an active API key.";

const validQuota = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 1_000_000;

async function projectObjects(ids: readonly string[]): Promise<{ id: string; name: string; quota: ReturnType<typeof quotaObject>; sessions: number }[]> {
  const { start, resets } = period();
  const [projects, used, counts] = await Promise.all([
    rows<{ id: string; name: string; quota_minutes: number }>("SELECT id, name, quota_minutes FROM projects WHERE id = ANY($1::uuid[]) ORDER BY created_at, name", [ids]),
    usedSeconds(ids),
    rows<{ project_id: string; n: number }>(
      "SELECT project_id, COUNT(*)::int AS n FROM sessions WHERE project_id = ANY($1::uuid[]) AND billing_state IN ('pending', 'confirmed') AND ended_at >= $2 AND ended_at < $3 GROUP BY project_id",
      [ids, start, resets],
    ),
  ]);
  return projects.map((p) => ({
    id: p.id,
    name: p.name,
    quota: quotaObject(p.quota_minutes, used.get(p.id) ?? 0),
    sessions: counts.find((c) => c.project_id === p.id)?.n ?? 0,
  }));
}

const keyObject = (row: { id: string; name: string; prefix: string; created_at: Date; revoked_at: Date | null }): ApiKey => ({
  id: row.id,
  name: row.name,
  prefix: row.prefix,
  created_at: row.created_at.toISOString(),
  revoked_at: row.revoked_at?.toISOString() ?? null,
});

/** A key named in a body: unknown or outside the project is 404; empty or malformed is the key field error. */
export async function bodyKey(projectId: string, value: unknown): Promise<{ id: string; revoked_at: Date | null } | null> {
  if (!isUuid(value)) return null;
  const key = await one<{ id: string; revoked_at: Date | null }>("SELECT id, revoked_at FROM api_keys WHERE id = $1 AND project_id = $2", [value, projectId]);
  if (!key) throw notFound();
  return key;
}

const jobObject = (row: { id: string; project_id: string; voice: Voice; characters: number; duration_ms: number; created_at: Date }): SynthesisJob => ({
  id: row.id,
  project_id: row.project_id,
  voice: row.voice,
  characters: row.characters,
  duration_ms: row.duration_ms,
  audio_url: `/v1/speak/${row.id}/audio`,
  console_audio_url: `/api/projects/${row.project_id}/synthesis/${row.id}/audio`,
  created_at: row.created_at.toISOString(),
});

/** Renders and stores a job: text 1..1000 characters, voice lumen or basalt. */
async function render(orgId: string, projectId: string, keyId: string | null, body: Record<string, unknown>): Promise<SynthesisJob> {
  const text = limited(body.text, 1, 1000);
  const fields: Record<string, string> = {};
  if (!keyId) fields.key_id = KEY_FIELD_ERROR;
  if (text === null) fields.text = "Enter 1 to 1000 characters.";
  if (body.voice !== "lumen" && body.voice !== "basalt") fields.voice = "Choose a voice.";
  if (Object.keys(fields).length) throw invalid(fields);
  const voice = body.voice as Voice;
  const { wav, durationMs } = synthesize(text!, voice);
  const id = randomUUID();
  await unavailableAs503(putObject(synthesisKey(orgId, projectId, id), wav, "audio/wav"));
  const row = (await one<{ id: string; project_id: string; voice: Voice; characters: number; duration_ms: number; created_at: Date }>(
    "INSERT INTO synthesis_jobs (id, project_id, key_id, voice, characters, duration_ms) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, project_id, voice, characters, duration_ms, created_at",
    [id, projectId, keyId, voice, codePoints(text!), durationMs],
  ))!;
  return jobObject(row);
}

/** A synthesis job of this project, else 404. */
async function projectJob(projectId: string, jobId: string): Promise<{ id: string; project_id: string }> {
  const job = isUuid(jobId) ? await one<{ id: string; project_id: string }>("SELECT id, project_id FROM synthesis_jobs WHERE id = $1 AND project_id = $2", [jobId, projectId]) : undefined;
  if (!job) throw notFound();
  return job;
}

/** The job's stored render, byte for byte. */
async function sendRender(request: Request, orgId: string, projectId: string, jobId: string): Promise<void> {
  const wav = await unavailableAs503(getObject(synthesisKey(orgId, projectId, jobId)));
  if (!wav) throw notFound();
  request.res.writeHead(200, { "content-type": "audio/wav", "content-length": wav.length, "cache-control": "no-store" });
  request.res.end(wav);
}

async function projectFor(request: Request): Promise<{ caller: Caller; project: Awaited<ReturnType<typeof visibleProject>> }> {
  const caller = await authenticate(request.req);
  return { caller, project: await visibleProject(caller, request.params.project) };
}

export function registerProjects(router: Router): void {
  router.add("GET", "/api/projects", async (request) => {
    const caller = await authenticate(request.req);
    permit(caller, "projects.read");
    sendJson(request.res, 200, { projects: await projectObjects(caller.projectIds) });
  });

  router.add("POST", "/api/projects", async (request) => {
    const caller = await authenticate(request.req);
    permit(caller, "admin");
    const body = jsonFields(request);
    const name = limited(body.name, 1, 60);
    const taken = () => new ApiError(409, "name_taken", "A project with this name already exists.");
    if (name !== null && (await one("SELECT 1 AS taken FROM projects WHERE org_id = $1 AND name_key = $2", [caller.org_id, nameKey(name)]))) throw taken();
    const fields: Record<string, string> = {};
    if (name === null) fields.name = NAME_ERROR;
    if (!validQuota(body.monthly_quota_minutes)) fields.monthly_quota_minutes = QUOTA_ERROR;
    if (Object.keys(fields).length) throw invalid(fields);
    try {
      const created = (await one<{ id: string }>("INSERT INTO projects (org_id, name, name_key, quota_minutes) VALUES ($1, $2, $3, $4) RETURNING id", [caller.org_id, name, nameKey(name!), body.monthly_quota_minutes]))!;
      const [project] = await projectObjects([created.id]);
      sendJson(request.res, 201, { project });
    } catch (error) {
      if (isUniqueViolation(error)) throw taken();
      throw error;
    }
  });

  router.add("GET", "/api/projects/:project", async (request) => {
    const { caller, project } = await projectFor(request);
    permit(caller, "projects.read");
    const [object] = await projectObjects([project.id]);
    sendJson(request.res, 200, { project: object });
  });

  router.add("PATCH", "/api/projects/:project/quota", async (request) => {
    const { caller, project } = await projectFor(request);
    permit(caller, "admin");
    const value = jsonFields(request).monthly_quota_minutes;
    if (!validQuota(value)) throw invalid({ monthly_quota_minutes: QUOTA_ERROR });
    await pool.query("UPDATE projects SET quota_minutes = $2 WHERE id = $1", [project.id, value]);
    sendJson(request.res, 200, { quota: await projectQuota(project.id, value) });
  });

  router.add("GET", "/api/projects/:project/keys", async (request) => {
    const { caller, project } = await projectFor(request);
    permit(caller, "keys.list");
    const keys = await rows<Parameters<typeof keyObject>[0]>("SELECT id, name, prefix, created_at, revoked_at FROM api_keys WHERE project_id = $1 ORDER BY created_at DESC", [project.id]);
    sendJson(request.res, 200, { keys: keys.map(keyObject) });
  });

  router.add("POST", "/api/projects/:project/keys", async (request) => {
    const { caller, project } = await projectFor(request);
    permit(caller, "sessions.operate");
    const name = limited(jsonFields(request).name, 1, 60);
    if (name === null) throw invalid({ name: KEY_NAME_ERROR });
    const secret = `lf_live_${randomBytes(16).toString("hex")}`;
    const row = (await one<Parameters<typeof keyObject>[0]>(
      "INSERT INTO api_keys (project_id, name, prefix, secret_hash) VALUES ($1, $2, $3, $4) RETURNING id, name, prefix, created_at, revoked_at",
      [project.id, name, secret.slice(0, 12), sha256(secret)],
    ))!;
    sendJson(request.res, 201, { key: keyObject(row), secret });
  });

  router.add("DELETE", "/api/projects/:project/keys/:key", async (request) => {
    const { caller, project } = await projectFor(request);
    const key = isUuid(request.params.key) ? await one<{ id: string }>("SELECT id FROM api_keys WHERE id = $1 AND project_id = $2", [request.params.key, project.id]) : undefined;
    if (!key) throw notFound();
    permit(caller, "sessions.operate");
    const revoked = await one<Parameters<typeof keyObject>[0]>(
      "UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING id, name, prefix, created_at, revoked_at",
      [key.id],
    );
    if (!revoked) throw new ApiError(409, "already_revoked", "This key is already revoked.");
    const open = await rows<{ id: string }>("SELECT id FROM sessions WHERE key_id = $1 AND ended_at IS NULL ORDER BY started_at", [key.id]);
    // Sessions this instance runs end now; any other instance's ticker ends its own within 250 ms.
    for (const session of open) if (isLocal(session.id)) void end(session.id, "revoked", null);
    sendJson(request.res, 200, { key: keyObject(revoked), closed_sessions: open.map((s) => s.id) });
  });

  router.add("POST", "/api/projects/:project/synthesis", async (request) => {
    const { caller, project } = await projectFor(request);
    const body = jsonFields(request);
    const key = await bodyKey(project.id, body.key_id);
    permit(caller, "sessions.operate");
    if (key?.revoked_at) throw new ApiError(409, "key_revoked", "This key is revoked.");
    sendJson(request.res, 201, { job: await render(project.org_id, project.id, key?.id ?? null, body) });
  });

  router.add("POST", "/v1/speak", async (request) => {
    const key = await authenticateKey(request.req);
    sendJson(request.res, 201, { job: await render(key.org_id, key.project_id, key.id, jsonFields(request)) });
  });

  router.add("GET", "/api/projects/:project/synthesis/:job/audio", async (request) => {
    const { caller, project } = await projectFor(request);
    const job = await projectJob(project.id, request.params.job);
    permit(caller, "sessions.operate");
    await sendRender(request, project.org_id, job.project_id, job.id);
  });

  router.add("GET", "/v1/speak/:job/audio", async (request) => {
    const key = await authenticateKey(request.req);
    const job = await projectJob(key.project_id, request.params.job);
    await sendRender(request, key.org_id, job.project_id, job.id);
  });
}
