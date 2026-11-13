// Cluster agent reports (bearer agent token) and approval link pages (no session).
import type { ApprovalLink, HealthValue, SyncValue } from "../../shared/api.js";
import { isUuid, notFound } from "../access.js";
import { sha256Hex } from "../auth.js";
import { pool, withTx } from "../db.js";
import { type ResourceReport, applyReport, hasLapsed } from "../domain/promotions.js";
import { type Loaded, type PromotionRow, loadPromotions, lockPromotion } from "../domain/records.js";
import { ApiError, invalid } from "../errors.js";
import { body, json, type Ctx, type Reply } from "../http.js";
import { isRecord } from "../validate.js";

const SYNC: readonly SyncValue[] = ["Synced", "OutOfSync"];
const HEALTH: readonly HealthValue[] = ["Healthy", "Progressing", "Degraded", "Missing"];

export async function agentReport(ctx: Ctx): Promise<Reply> {
  const bearer = /^Bearer (.+)$/.exec(ctx.req.headers.authorization ?? "")?.[1];
  const { rows: clusters } = bearer
    ? await pool.query<{ id: string; name: string }>("SELECT id, name FROM clusters WHERE agent_token_hash = $1", [sha256Hex(bearer)])
    : { rows: [] };
  const cluster = clusters[0];
  if (!cluster) throw new ApiError("unauthenticated", "Send a valid cluster agent token.");
  const input = body(ctx);
  const record = isRecord(input) ? input : {};
  const id = typeof record.promotion_id === "string" ? record.promotion_id : "";
  const { rows } = isUuid(id)
    ? await pool.query<{ bundle_id: string }>(
      "SELECT x.bundle_id FROM promotions x JOIN stages s ON s.id = x.stage_id WHERE x.id = $1 AND s.cluster_id = $2", [id, cluster.id])
    : { rows: [] };
  if (!rows[0]) throw notFound("The promotion");
  const { rows: [bundle] } = await pool.query<{ refs: string[] }>(
    "SELECT array(SELECT r->>'ref' FROM jsonb_array_elements(resources) r) AS refs FROM bundles WHERE id = $1", [rows[0].bundle_id]);
  const refs = new Set(bundle?.refs ?? []);
  const fields: Record<string, string> = {};
  const phase = record.phase;
  if (phase !== "applying" && phase !== "health_wait") fields.phase = "Report applying or health_wait.";
  const resources = record.resources;
  if (!Array.isArray(resources) || resources.length < 1 || resources.length > 200
    || !resources.every((r) => isRecord(r) && typeof r.ref === "string" && SYNC.includes(r.sync as SyncValue) && HEALTH.includes(r.health as HealthValue))) {
    fields.resources = "Report 1 to 200 resources, each with a ref, a sync value and a health value.";
  } else {
    const unknown = (resources as ResourceReport[]).find((r) => !refs.has(r.ref));
    if (unknown) fields.resources = `Unknown resource ${unknown.ref}.`;
  }
  if (Object.keys(fields).length) throw invalid(fields);
  const result = await withTx(async (tx) =>
    applyReport(tx, await lockPromotion(tx, id), cluster.name, phase as "applying" | "health_wait", resources as ResourceReport[], ctx.now));
  return json(200, result);
}

export async function approvalLink(ctx: Ctx, [token = ""]: string[]): Promise<Reply> {
  const { rows } = await pool.query<PromotionRow>("SELECT * FROM promotions WHERE approval_token_hash = $1", [sha256Hex(token)]);
  const found = rows[0];
  if (!found) throw notFound("The approval link");
  if (found.state !== "awaiting_approval" || hasLapsed(found, ctx.now)) {
    throw new ApiError("link_expired", "This approval link has expired.");
  }
  const p = ((await loadPromotions(pool, [found.id]))[0] as Loaded).view;
  const link: ApprovalLink = {
    project: p.project,
    stage: p.stage,
    bundle: { version: p.bundle.version, short_digest: p.bundle.short_digest },
    requested_by: p.requested_by,
    request_expires_at: p.approval?.request_expires_at ?? "",
    time_zone: p.time_zone,
    diff: p.diff,
    promotion_id: p.id,
  };
  return json(200, link);
}
