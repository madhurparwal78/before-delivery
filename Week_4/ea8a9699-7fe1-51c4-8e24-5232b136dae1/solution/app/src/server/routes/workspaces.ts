// Workspace, seats, invites, plan and collaborator offboarding (brief: API > Endpoints; Business rules > Seats,
// Plans, Upgrades, Idempotency of upgrades).
import { createHash } from "node:crypto";
import { memberWorkspace, newToken, requireAccount, requireOpsLead, tokenHash, type Account, type Workspace } from "../access.js";
import { changePlan, dollars, isPlanId, PLAN_IDS, PLANS, readPlan, recordPlan, restorePlan, type PlanId } from "../billing.js";
import { many, one, pool, returning, transaction } from "../db.js";
import { invalid, refuse } from "../errors.js";
import { route, send, type Context, type JsonObject } from "../http.js";
import { sendMail } from "../mail.js";
import { config } from "../config.js";
import { linkState, LINK_COLUMNS, type LinkRow } from "../reviewLinks.js";
import { Fields, isEmail, isName, isUuid, MESSAGES, normalEmail, text } from "../validate.js";

async function seatsUsed(workspaceId: string): Promise<number> {
  return (await returning<{ n: number }>(pool, "SELECT count(*)::int AS n FROM seats WHERE workspace_id = $1", [workspaceId])).n;
}

async function opsWorkspace(ctx: Context): Promise<{ account: Account; ws: Workspace }> {
  const account = await requireAccount(ctx);
  const ws = await memberWorkspace(account, ctx.params.ws ?? "");
  requireOpsLead(account);
  return { account, ws };
}

function planView(plan: PlanId, used: number) {
  const p = PLANS[plan];
  return { plan, planName: p.planName, seatCap: p.seatCap, seatsUsed: used, monthlyPrice: dollars(p.monthlyCents), currency: "USD" as const };
}

route("GET", "/api/workspaces/:ws", async (ctx) => {
  const account = await requireAccount(ctx);
  const ws = await memberWorkspace(account, ctx.params.ws ?? "");
  const { plan, seatCap } = await readPlan(ws.id);
  send(ctx.res, 200, { slug: ws.slug, name: ws.name, timeZone: ws.time_zone, plan, planName: PLANS[plan].planName, seatCap, seatsUsed: await seatsUsed(ws.id) });
});

interface MemberRow {
  id: string;
  display_name: string;
  email: string;
  handle: string;
  has_seat: boolean;
}

const designers = (workspaceId: string): Promise<MemberRow[]> =>
  many<MemberRow>(
    pool,
    `SELECT a.id, a.display_name, a.email, a.handle, (s.account_id IS NOT NULL) AS has_seat
       FROM accounts a LEFT JOIN seats s ON s.account_id = a.id AND s.workspace_id = a.workspace_id
      WHERE a.workspace_id = $1 AND a.role = 'designer' ORDER BY lower(a.display_name), a.id`,
    [workspaceId],
  );

route("GET", "/api/workspaces/:ws/seats", async (ctx) => {
  const { ws } = await opsWorkspace(ctx);
  const { plan, seatCap } = await readPlan(ws.id);
  const members = await designers(ws.id);
  send(ctx.res, 200, {
    plan,
    seatCap,
    seatsUsed: members.filter((m) => m.has_seat).length,
    members: members.map((m) => ({ id: m.id, displayName: m.display_name, email: m.email, handle: m.handle, hasSeat: m.has_seat })),
  });
});

async function designerOf(ws: Workspace, memberId: string | null): Promise<string> {
  if (!isUuid(memberId)) throw invalid({ memberId: MESSAGES.memberId });
  const member = await one(pool, "SELECT 1 FROM accounts WHERE id = $1 AND workspace_id = $2 AND role = 'designer'", [memberId, ws.id]);
  if (!member) throw refuse("not_found");
  return memberId;
}

route("POST", "/api/workspaces/:ws/seats", async (ctx) => {
  const { ws } = await opsWorkspace(ctx);
  const memberId = await designerOf(ws, text(ctx.json, "memberId"));
  const { seatCap } = await readPlan(ws.id);
  // The workspace row lock serialises every assignment on any instance: the seat cap check.
  const result = await transaction(async (client) => {
    await client.query("SELECT 1 FROM workspaces WHERE id = $1 FOR UPDATE", [ws.id]);
    const used = (await returning<{ n: number }>(client, "SELECT count(*)::int AS n FROM seats WHERE workspace_id = $1", [ws.id])).n;
    if (await one(client, "SELECT 1 FROM seats WHERE account_id = $1", [memberId])) return { status: 200, used };
    if (used >= seatCap) throw refuse("no_seats_left");
    await client.query("INSERT INTO seats (account_id, workspace_id) VALUES ($1, $2)", [memberId, ws.id]);
    return { status: 201, used: used + 1 };
  });
  send(ctx.res, result.status, { memberId, seatsUsed: result.used, seatCap });
});

route("DELETE", "/api/workspaces/:ws/seats/:memberId", async (ctx) => {
  const { ws } = await opsWorkspace(ctx);
  const memberId = await designerOf(ws, ctx.params.memberId ?? null);
  await pool.query("DELETE FROM seats WHERE account_id = $1 AND workspace_id = $2", [memberId, ws.id]);
  const { seatCap } = await readPlan(ws.id);
  send(ctx.res, 200, { memberId, seatsUsed: await seatsUsed(ws.id), seatCap });
});

route("POST", "/api/workspaces/:ws/invites", async (ctx) => {
  const { account, ws } = await opsWorkspace(ctx);
  const email = normalEmail(text(ctx.json, "email"));
  const displayName = text(ctx.json, "displayName");
  const fields = new Fields().check(isEmail(email), "email", MESSAGES.email).check(isName(displayName), "displayName", MESSAGES.name);
  if (!fields.errors.email && (await one(pool, "SELECT 1 FROM accounts WHERE email = $1", [email]))) fields.check(false, "email", MESSAGES.emailTaken);
  if (fields.failed || !isName(displayName)) throw invalid(fields.errors);
  const token = newToken();
  const invite = await transaction(async (client) => {
    const row = await returning<{ id: string }>(
      client,
      "INSERT INTO invites (token_hash, workspace_id, email, display_name, invited_by) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [tokenHash(token), ws.id, email, displayName.trim(), account.id],
    );
    await sendMail({
      to: email,
      subject: `You're invited to ${ws.name} on Rushes`,
      lines: [
        `${account.display_name} invited you to join ${ws.name} on Rushes.`,
        "",
        "Accept the invite and choose your handle and password here:",
        `${config.publicUrl}/invite/${token}`,
      ],
    });
    return row;
  });
  send(ctx.res, 201, { id: invite.id, email, displayName: displayName.trim() });
});

function upgradesFrom(plan: PlanId) {
  return PLAN_IDS.filter((id) => PLANS[id].seatCap > PLANS[plan].seatCap).map((id) => ({
    plan: id,
    planName: PLANS[id].planName,
    seatCap: PLANS[id].seatCap,
    monthlyPrice: dollars(PLANS[id].monthlyCents),
  }));
}

route("GET", "/api/workspaces/:ws/plan", async (ctx) => {
  const { ws } = await opsWorkspace(ctx);
  const { plan } = await readPlan(ws.id);
  send(ctx.res, 200, { ...planView(plan, await seatsUsed(ws.id)), upgrades: upgradesFrom(plan) });
});

/** sha256 of the canonical body (adapted from kit/modules/idempotency). */
const fingerprint = (body: JsonObject): string =>
  createHash("sha256").update(JSON.stringify({ plan: typeof body.plan === "string" ? body.plan : null })).digest("hex");

interface IdempotencyRow {
  fingerprint: string;
  response: Record<string, unknown> | null;
}

/** Precedence 5: a stored replay, a reused key or a key still running anywhere is answered here. */
function decideKey(stored: IdempotencyRow, print: string): Record<string, unknown> {
  if (stored.fingerprint !== print) throw refuse("idempotency_conflict");
  if (!stored.response) throw refuse("idempotency_in_progress");
  return stored.response;
}

route("POST", "/api/workspaces/:ws/plan", async (ctx) => {
  const { account, ws } = await opsWorkspace(ctx);
  const header = ctx.req.headers["idempotency-key"];
  const key = typeof header === "string" ? header : "";
  const keyValid = key.length >= 1 && key.length <= 64;
  const print = fingerprint(ctx.json);
  if (keyValid) {
    const stored = await one<IdempotencyRow>(pool, "SELECT fingerprint, response FROM idempotency_records WHERE workspace_id = $1 AND key = $2", [ws.id, key]);
    if (stored) return send(ctx.res, 200, decideKey(stored, print));
  }
  const requested = text(ctx.json, "plan");
  const fields = new Fields().check(keyValid, "idempotencyKey", MESSAGES.idempotencyKey);
  const { plan: current } = await readPlan(ws.id);
  if (requested === null || requested === "") fields.check(false, "plan", MESSAGES.planMissing);
  else if (!isPlanId(requested)) fields.check(false, "plan", MESSAGES.planUnknown);
  else if (PLANS[requested].seatCap <= PLANS[current].seatCap) fields.check(false, "plan", MESSAGES.planSmaller);
  if (fields.failed || requested === null || !isPlanId(requested)) throw invalid(fields.errors);

  const claimed = await one(pool, "INSERT INTO idempotency_records (workspace_id, key, fingerprint) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING key", [ws.id, key, print]);
  if (!claimed) {
    const stored = await one<IdempotencyRow>(pool, "SELECT fingerprint, response FROM idempotency_records WHERE workspace_id = $1 AND key = $2", [ws.id, key]);
    if (stored) return send(ctx.res, 200, decideKey(stored, print));
  }
  try {
    const { previous, current: after } = await changePlan(ws.id, requested);
    const p = PLANS[after];
    try {
      await sendMail({
        to: account.email,
        subject: `Rushes receipt: ${ws.name} is now on ${p.planName}`,
        lines: [
          `${ws.name} is now on ${p.planName}.`,
          "",
          `Plan: ${p.planName}`,
          `Seats: ${p.seatCap}`,
          `Price: $${dollars(p.monthlyCents)} per month`,
        ],
      });
    } catch (error) {
      await restorePlan(ws.id, previous);
      throw error;
    }
    await recordPlan(ws.id, after);
    const response = { ...planView(after, await seatsUsed(ws.id)), receiptSentTo: account.email };
    await pool.query("UPDATE idempotency_records SET response = $3 WHERE workspace_id = $1 AND key = $2", [ws.id, key, response]);
    send(ctx.res, 200, response);
  } catch (error) {
    await pool.query("DELETE FROM idempotency_records WHERE workspace_id = $1 AND key = $2", [ws.id, key]);
    throw error;
  }
});

route("POST", "/api/workspaces/:ws/collaborators/offboard", async (ctx) => {
  const { ws } = await opsWorkspace(ctx);
  const email = normalEmail(text(ctx.json, "email"));
  if (!isEmail(email)) throw invalid({ email: MESSAGES.email });
  const links = await many<LinkRow>(
    pool,
    `SELECT ${LINK_COLUMNS} FROM review_links l JOIN clusters c ON c.id = l.cluster_id WHERE c.workspace_id = $1 AND l.email = $2`,
    [ws.id, email],
  );
  const live = links.filter((link) => linkState(link, ctx.now) === "live").map((link) => link.id);
  await pool.query("UPDATE review_links SET revoked_at = $2 WHERE id = ANY($1::uuid[]) AND revoked_at IS NULL", [live, ctx.now]);
  send(ctx.res, 200, { email, revoked: live.length });
});
