// Stage defaults, promotion requests and lists, rollback, stage health and the window decision.
import { type Membership, authorize, notFound, projectFor } from "../access.js";
import { sessionUser, type User } from "../auth.js";
import { pool, withTx } from "../db.js";
import { refOf, type Manifest } from "../domain/diff.js";
import { policyInForce } from "../domain/freeze.js";
import { stageHealth } from "../domain/health.js";
import { type StageRow, frozenOverrides, requestPromotion, rollback, stageByName, windowsOf } from "../domain/promotions.js";
import { loadPromotions } from "../domain/records.js";
import { checkWindow } from "../domain/windows.js";
import { invalid } from "../errors.js";
import { body, json, type Ctx, type Reply } from "../http.js";
import { keyed } from "../requestKeys.js";
import { MESSAGES, isReason, isRecord, parseInstant, readOverrides } from "../validate.js";

async function stageOf(ctx: Ctx, slug: string, name: string): Promise<{ user: User; member: Membership; stage: StageRow }> {
  const user = await sessionUser(pool, ctx);
  const member = await projectFor(pool, user, slug);
  const stage = await stageByName(pool, member.id, name);
  if (!stage) throw notFound("The stage");
  return { user, member, stage };
}

async function promotionReply(status: number, id: string): Promise<Reply> {
  const [loaded] = await loadPromotions(pool, [id]);
  return json(status, loaded?.view);
}

export async function editDefaults(ctx: Ctx, [slug = "", name = ""]: string[]): Promise<Reply> {
  const { member, stage } = await stageOf(ctx, slug, name);
  authorize(member, "edit_defaults");
  const input = body(ctx);
  const fields: Record<string, string> = {};
  const defaults = readOverrides(isRecord(input) ? input.defaults : undefined, fields);
  if (Object.keys(fields).length) throw invalid(fields);
  await pool.query("UPDATE stages SET defaults = $2 WHERE id = $1", [stage.id, JSON.stringify(defaults)]);
  return json(200, { stage: stage.name, defaults });
}

const REPLICA_KINDS = new Set(["Deployment", "StatefulSet"]);

export async function promote(ctx: Ctx, [slug = "", name = ""]: string[]): Promise<Reply> {
  const { user, member, stage } = await stageOf(ctx, slug, name);
  authorize(member, "promote");
  return keyed(ctx, user, async () => {
    const input = body(ctx);
    const record = isRecord(input) ? input : {};
    const fields: Record<string, string> = {};
    const { rows } = typeof record.bundle_version === "string"
      ? await pool.query<{ id: string; version: string; digest: string; object: Buffer }>(
        "SELECT id, version, digest, object FROM bundles WHERE project_id = $1 AND version = $2", [member.id, record.bundle_version])
      : { rows: [] };
    const bundle = rows[0];
    if (!bundle) fields.bundle_version = "Unknown bundle version.";
    const requested = readOverrides(record.overrides ?? {}, fields);
    const manifests = bundle ? (JSON.parse(bundle.object.toString("utf8")) as { manifests: Manifest[] }).manifests : [];
    const scalable = new Set(manifests.filter((m) => REPLICA_KINDS.has(m.kind)).map(refOf));
    if (bundle && !fields.replicas && Object.keys(requested.replicas).some((ref) => !scalable.has(ref))) {
      fields.replicas = "Only Deployments and StatefulSets in this bundle can take replica counts.";
    }
    if (!bundle || Object.keys(fields).length) throw invalid(fields);
    const overrides = frozenOverrides(stage.defaults, requested, new Set(manifests.map(refOf)));
    const id = await withTx((tx) => requestPromotion(tx, stage, bundle, overrides, user, ctx.now));
    return promotionReply(201, id);
  });
}

export async function listPromotions(ctx: Ctx, [slug = ""]: string[]): Promise<Reply> {
  const member = await projectFor(pool, await sessionUser(pool, ctx), slug);
  const stageName = ctx.query.get("stage");
  const stage = stageName === null ? null : await stageByName(pool, member.id, stageName);
  if (stage === undefined) throw notFound("The stage");
  const rawLimit = ctx.query.get("limit");
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (rawLimit !== null && !/^\d+$/.test(rawLimit))) {
    throw invalid({ limit: "Use a whole number from 1 to 100." });
  }
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM promotions WHERE project_id = $1 AND ($2::uuid IS NULL OR stage_id = $2)
      ORDER BY requested_at DESC, id LIMIT $3`, [member.id, stage?.id ?? null, limit]);
  const loaded = await loadPromotions(pool, rows.map((r) => r.id));
  return json(200, { promotions: loaded.map((l) => l.view) });
}

export async function rollBack(ctx: Ctx, [slug = "", name = ""]: string[]): Promise<Reply> {
  const { user, member, stage } = await stageOf(ctx, slug, name);
  authorize(member, "rollback");
  return keyed(ctx, user, async () => {
    const input = body(ctx);
    const reason = isRecord(input) ? input.reason : undefined;
    if (!isReason(reason)) throw invalid({ reason: MESSAGES.reason });
    const id = await withTx((tx) => rollback(tx, stage, user, reason, ctx.now));
    return promotionReply(201, id);
  });
}

export async function readStageHealth(ctx: Ctx, [slug = "", name = ""]: string[]): Promise<Reply> {
  const { stage } = await stageOf(ctx, slug, name);
  return json(200, await stageHealth(pool, stage.id));
}

export async function windowDecision(ctx: Ctx, [slug = "", name = ""]: string[]): Promise<Reply> {
  const { stage } = await stageOf(ctx, slug, name);
  const raw = ctx.query.get("at");
  const at = raw === null ? ctx.now.getTime() : parseInstant(raw);
  if (at === null) throw invalid({ at: MESSAGES.instant });
  const policy = await policyInForce(pool, stage.project_id, new Date(at));
  return json(200, checkWindow(at, stage.name, stage.time_zone, await windowsOf(pool, stage.cluster_id), policy));
}
