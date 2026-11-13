// Clusters, sync windows, their openings and freeze policy versions.
import { type Cluster, DAYS, type Day, type Freeze, type FreezeVersion, type SyncWindow } from "../../shared/api.js";
import { type Membership, authorize, isUuid, notFound, projectFor } from "../access.js";
import { sessionUser } from "../auth.js";
import { pool, withTx } from "../db.js";
import { policyInForce, policyVersions } from "../domain/freeze.js";
import { windowsOf } from "../domain/promotions.js";
import { openings } from "../domain/windows.js";
import { ApiError, invalid } from "../errors.js";
import { body, json, type Ctx, type Reply } from "../http.js";
import { MESSAGES, isRecord, parseInstant } from "../validate.js";

async function clusterOf(ctx: Ctx, slug: string, name: string): Promise<{ member: Membership; cluster: { id: string; time_zone: string } }> {
  const member = await projectFor(pool, await sessionUser(pool, ctx), slug);
  const { rows } = await pool.query<{ id: string; time_zone: string }>(
    "SELECT id, time_zone FROM clusters WHERE project_id = $1 AND name = $2", [member.id, name]);
  if (!rows[0]) throw notFound("The cluster");
  return { member, cluster: rows[0] };
}

export async function listClusters(ctx: Ctx, [slug = ""]: string[]): Promise<Reply> {
  const member = await projectFor(pool, await sessionUser(pool, ctx), slug);
  const { rows } = await pool.query<{ id: string; name: string; time_zone: string; stages: string[] }>(
    `SELECT c.id, c.name, c.time_zone, coalesce(array_agg(s.name ORDER BY s.position) FILTER (WHERE s.id IS NOT NULL), '{}') AS stages
       FROM clusters c LEFT JOIN stages s ON s.cluster_id = c.id
      WHERE c.project_id = $1 GROUP BY c.id ORDER BY c.position`, [member.id]);
  const clusters: Cluster[] = await Promise.all(rows.map(async ({ id, ...c }) => ({ ...c, windows: await windowsOf(pool, id) })));
  return json(200, { clusters });
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function addWindow(ctx: Ctx, [slug = "", name = ""]: string[]): Promise<Reply> {
  const { member, cluster } = await clusterOf(ctx, slug, name);
  authorize(member, "edit_windows");
  const input = body(ctx);
  const record = isRecord(input) ? input : {};
  const fields: Record<string, string> = {};
  const { label, days, start, end } = record;
  if (typeof label !== "string" || label.trim().length < 1 || label.length > 80) fields.label = "Use 1 to 80 characters.";
  if (!Array.isArray(days) || days.length === 0 || !days.every((d) => DAYS.includes(d as Day))) fields.days = "Pick at least one day.";
  const timeMessage = "Use 24-hour time like 09:00.";
  if (typeof start !== "string" || !TIME.test(start)) fields.start = timeMessage;
  if (typeof end !== "string" || !(TIME.test(end) || end === "24:00") || end === "00:00") fields.end = timeMessage;
  else if (!fields.start && (end as string) <= (start as string)) fields.end = "Closes must be after opens.";
  if (Object.keys(fields).length) throw invalid(fields);
  const ordered = DAYS.filter((d) => (days as string[]).includes(d));
  const { rows } = await pool.query<SyncWindow>(
    `INSERT INTO sync_windows (cluster_id, label, days, start_time, end_time, created_at) VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, label, days, start_time AS start, end_time AS "end"`, [cluster.id, label, ordered, start, end, ctx.now]);
  return json(201, rows[0]);
}

export async function deleteWindow(ctx: Ctx, [slug = "", name = "", id = ""]: string[]): Promise<Reply> {
  const { member, cluster } = await clusterOf(ctx, slug, name);
  if (!isUuid(id)) throw notFound("The window");
  const { rows } = await pool.query("SELECT 1 FROM sync_windows WHERE id = $1 AND cluster_id = $2", [id, cluster.id]);
  if (!rows.length) throw notFound("The window");
  authorize(member, "edit_windows");
  await pool.query("DELETE FROM sync_windows WHERE id = $1", [id]);
  return json(204);
}

export async function listOpenings(ctx: Ctx, [slug = "", name = ""]: string[]): Promise<Reply> {
  const { cluster } = await clusterOf(ctx, slug, name);
  const rawFrom = ctx.query.get("from");
  const rawCount = ctx.query.get("count");
  const from = rawFrom === null ? ctx.now.getTime() : parseInstant(rawFrom);
  const count = rawCount === null ? 5 : Number(rawCount);
  const fields: Record<string, string> = {};
  if (from === null) fields.from = MESSAGES.instant;
  if (!Number.isInteger(count) || count < 1 || count > 20 || (rawCount !== null && !/^\d+$/.test(rawCount))) {
    fields.count = "Use a whole number from 1 to 20.";
  }
  if (from === null || Object.keys(fields).length) throw invalid(fields);
  return json(200, { time_zone: cluster.time_zone, openings: openings(await windowsOf(pool, cluster.id), cluster.time_zone, from, count) });
}

export async function readFreezePolicy(ctx: Ctx, [slug = ""]: string[]): Promise<Reply> {
  const member = await projectFor(pool, await sessionUser(pool, ctx), slug);
  const [inForce, versions] = await Promise.all([policyInForce(pool, member.id, ctx.now), policyVersions(pool, member.id)]);
  return json(200, { in_force_version: inForce.version, versions });
}

export async function scheduleFreezeVersion(ctx: Ctx, [slug = ""]: string[]): Promise<Reply> {
  const user = await sessionUser(pool, ctx);
  const member = await projectFor(pool, user, slug);
  authorize(member, "schedule_freeze");
  const input = body(ctx);
  const record = isRecord(input) ? input : {};
  const { rows: stageRows } = await pool.query<{ name: string }>("SELECT name FROM stages WHERE project_id = $1", [member.id]);
  const stageNames = new Set(stageRows.map((s) => s.name));
  const version = await withTx(async (tx) => {
    await tx.query("SELECT id FROM projects WHERE id = $1 FOR UPDATE", [member.id]);
    const { rows: [latest] } = await tx.query<{ version: number; effective_from: Date }>(
      "SELECT version, effective_from FROM freeze_policy_versions WHERE project_id = $1 ORDER BY version DESC LIMIT 1", [member.id]);
    const fields: Record<string, string> = {};
    if (!Number.isInteger(record.based_on_version)) fields.based_on_version = "Name the version this one is based on.";
    const effective = parseInstant(record.effective_from);
    if (effective === null) fields.effective_from = MESSAGES.instant;
    else if (effective < ctx.now.getTime()) fields.effective_from = "Effective time cannot be in the past.";
    else if (latest && effective <= latest.effective_from.getTime()) {
      fields.effective_from = `Must be later than when version ${latest.version} takes effect.`;
    }
    const freezes: Freeze[] = [];
    if (!Array.isArray(record.freezes)) fields.freezes = "List the freezes of this version.";
    for (const f of Array.isArray(record.freezes) ? record.freezes : []) {
      const startsAt = isRecord(f) ? parseInstant(f.starts_at) : null;
      const endsAt = isRecord(f) ? parseInstant(f.ends_at) : null;
      if (!isRecord(f) || typeof f.name !== "string" || f.name.trim().length < 1 || f.name.length > 80) {
        fields.freezes = "Give each freeze a name of 1 to 80 characters.";
      } else if (!Array.isArray(f.stages) || f.stages.length === 0 || !f.stages.every((s) => typeof s === "string")) {
        fields.freezes = "Pick at least one stage for each freeze.";
      } else if (f.stages.find((s) => !stageNames.has(s as string))) {
        fields.freezes = `Unknown stage ${String(f.stages.find((s) => !stageNames.has(s as string)))}.`;
      } else if (startsAt === null || endsAt === null) {
        fields.freezes = MESSAGES.instant;
      } else if (endsAt <= startsAt) {
        fields.freezes = "Ends must be after starts.";
      } else {
        freezes.push({ name: f.name, stages: f.stages as string[], starts_at: new Date(startsAt).toISOString(), ends_at: new Date(endsAt).toISOString() });
      }
    }
    if (Object.keys(fields).length) throw invalid(fields);
    const current = latest?.version ?? 0;
    if (record.based_on_version !== current) {
      throw new ApiError("stale_version", `Version ${current} is the latest.`, { current_version: current });
    }
    await tx.query(
      `INSERT INTO freeze_policy_versions (project_id, version, effective_from, created_by, created_at, freezes)
       VALUES ($1, $2, $3, $4, $5, $6)`, [member.id, current + 1, new Date(effective as number), user.id, ctx.now, JSON.stringify(freezes)]);
    return current + 1;
  });
  const created = (await policyVersions(pool, member.id)).find((v) => v.version === version) as FreezeVersion;
  return json(201, created);
}
