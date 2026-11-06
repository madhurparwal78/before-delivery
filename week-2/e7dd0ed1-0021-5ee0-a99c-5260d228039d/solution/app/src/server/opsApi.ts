// The operator API (brief: API, Operator). Every /api/ops path is gated in server.ts before routing.
// Region transitions: online ⇄ offline. Workspace transitions: active → suspended → active.
import { appendAudit } from "./audit.js";
import { one, pool, query, tx } from "./db.js";
import { ApiError, invalid, transition } from "./errors.js";
import { fieldErrors, isoOrNull, readJson, sendJson, type Ctx } from "./http.js";
import { characters } from "./limits.js";
import { enqueueMail, ownersOf, wakeMail } from "./mail.js";
import { regionBacklog, requeueRegion } from "./replication.js";
import { sweepLifecycle } from "./lifecycle.js";
import { billingState, syncBilling } from "./billing.js";
import { wakeDeliveries } from "./webhooks.js";

export async function listRegions(ctx: Ctx): Promise<void> {
  sendJson(ctx, 200, { regions: await regionBacklog(pool) });
}

export async function setRegionState(ctx: Ctx): Promise<void> {
  const body = await readJson(ctx);
  const id = ctx.params.id ?? "";
  const region = await tx(async (client) => {
    const current = await one<{ state: string }>(client, "SELECT state FROM regions WHERE id = $1 FOR UPDATE", [id]);
    if (!current) throw new ApiError("not_found");
    const errors = fieldErrors(body, ["state"], ["state"]);
    if (!errors.state && body.state !== "online" && body.state !== "offline") errors.state = "Choose online or offline.";
    if (Object.keys(errors).length) throw invalid(errors);
    if (current.state === body.state) throw transition(current.state, body.state as string);
    await client.query("UPDATE regions SET state = $2 WHERE id = $1", [id, body.state]);
    if (body.state === "online") await requeueRegion(client, id);
    return id;
  });
  const row = (await regionBacklog(pool)).find((r) => r.id === region);
  sendJson(ctx, 200, row);
}

interface WorkspaceRow {
  id: string;
  slug: string;
  name: string;
  plan_id: string;
  status: string;
  suspended_reason: string | null;
  members: number;
  buckets: number;
}

const WORKSPACE_SQL = `SELECT w.id, w.slug, w.name, w.plan_id, w.status, w.suspended_reason,
  (SELECT count(*)::int FROM members m WHERE m.workspace_id = w.id) AS members,
  (SELECT count(*)::int FROM buckets b WHERE b.workspace_id = w.id) AS buckets FROM workspaces w`;

const workspaceJson = (w: WorkspaceRow): Record<string, unknown> => ({
  slug: w.slug, name: w.name, plan: w.plan_id, members: w.members, buckets: w.buckets, status: w.status,
  suspended_reason: w.suspended_reason,
});

export async function listWorkspaces(ctx: Ctx): Promise<void> {
  const rows = await query<WorkspaceRow>(pool, `${WORKSPACE_SQL} ORDER BY w.name, w.slug`);
  sendJson(ctx, 200, { workspaces: rows.map(workspaceJson) });
}

// POST /api/ops/workspaces/{ws}/suspend and …/reinstate: active → suspended → active, one at a time.
export async function setWorkspaceStatus(ctx: Ctx): Promise<void> {
  const to = ctx.path.endsWith("/suspend") ? "suspended" : "active";
  const slug = ctx.params.ws ?? "";
  const errors: Record<string, string> = {};
  let reason: string | null = null;
  if (to === "suspended") {
    const body = await readJson(ctx);
    Object.assign(errors, fieldErrors(body, ["reason"], ["reason"]));
    if (!errors.reason && !(typeof body.reason === "string" && body.reason.trim() !== "" && characters(body.reason) <= 280)) {
      errors.reason = "Give a reason of 1 to 280 characters.";
    }
    reason = typeof body.reason === "string" ? body.reason : null;
  }
  await tx(async (client) => {
    const ws = await one<{ id: string; slug: string; name: string; status: string }>(client,
      "SELECT id, slug, name, status FROM workspaces WHERE slug = $1 FOR UPDATE", [slug]);
    if (!ws) throw new ApiError("not_found");
    if (ws.status === to) throw transition(ws.status, to);
    if (Object.keys(errors).length) throw invalid(errors);
    await client.query("UPDATE workspaces SET status = $2, suspended_reason = $3 WHERE id = $1", [ws.id, to, reason]);
    await appendAudit(client, ws.slug, {
      actor: "operator", action: to === "suspended" ? "workspace.suspended" : "workspace.reinstated", target: ws.slug, detail: reason ?? "",
    }, ctx.now);
    if (to === "suspended") {
      for (const owner of await ownersOf(client, ws.id)) {
        await enqueueMail(client, owner.email, `${ws.name} is suspended on Farshore`, [
          `The Farshore operator suspended ${ws.name}.`, "", `Reason: ${reason ?? ""}`, "",
          "Uploads, downloads and share links are paused until the workspace is reinstated.",
        ].join("\n"));
      }
    }
  });
  if (to === "suspended") wakeMail();
  else wakeDeliveries();
  const row = await one<WorkspaceRow>(pool, `${WORKSPACE_SQL} WHERE w.slug = $1`, [slug]);
  if (!row) throw new ApiError("not_found");
  sendJson(ctx, 200, workspaceJson(row));
}


export async function runLifecycle(ctx: Ctx): Promise<void> {
  sendJson(ctx, 200, await sweepLifecycle());
}

export async function billingOverview(ctx: Ctx): Promise<void> {
  const row = await one<{ queued: number; posted: number; last_attempt_at: Date | null; last_attempt_ok: boolean | null; last_error: string | null }>(pool,
    `SELECT (SELECT count(*)::int FROM usage_rows WHERE billing_state = 'queued') AS queued,
            (SELECT count(*)::int FROM usage_rows WHERE billing_state = 'posted') AS posted, last_attempt_at, last_attempt_ok, last_error
     FROM billing_status WHERE id = 1`);
  sendJson(ctx, 200, {
    state: await billingState(null), queued_rows: row?.queued ?? 0, posted_rows: row?.posted ?? 0,
    last_attempt_at: isoOrNull(row?.last_attempt_at), last_error: row?.last_attempt_ok === false ? row.last_error : null,
  });
}

export async function syncBillingNow(ctx: Ctx): Promise<void> {
  const result = await syncBilling(true);
  sendJson(ctx, result.queued === 0 ? 200 : 202, result);
}
