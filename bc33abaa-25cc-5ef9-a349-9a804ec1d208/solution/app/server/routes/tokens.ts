// Agent tokens: issue (secret shown once), list and revoke.
import type { Scope } from "../../shared/api-types.js";
import { isoSecond } from "../../shared/format.js";
import { isName, type FieldErrors } from "../../shared/graph.js";
import { agentSecret, authorOf, secretHash } from "../auth.js";
import { audit } from "../audit.js";
import { config } from "../config.js";
import { one, pool, rows, transaction } from "../db.js";
import { conflict, invalid, invalidTransition, notFound } from "../errors.js";
import { json, noContent, route } from "../http.js";
import { announce } from "../events.js";
import { authorize } from "../domain/permissions.js";
import { clearAuthor } from "../domain/locks.js";
import { assertWritable, tokenLimit, currentSubscription } from "../domain/subscription.js";
import { bodyOf, newId } from "./account.js";

const DAY_MS = 86_400_000;

interface TokenRow {
  id: string; workspace_id: string; name: string; scope: Scope; expires_at: Date; revoked_at: Date | null;
  issued_by_id: string; issued_by_name: string; created_at: Date;
}

const status = (t: TokenRow, now: Date) => (t.revoked_at ? "revoked" : t.expires_at <= now ? "expired" : "active");

const tokenOut = (t: TokenRow, now: Date) => ({
  id: t.id, name: t.name, scope: t.scope, expiresAt: isoSecond(t.expires_at), status: status(t, now),
  issuedBy: { kind: "member", id: t.issued_by_id, name: t.issued_by_name },
});

route("GET", "/api/agent-tokens", async ({ caller }) => {
  authorize(caller, "member.manage");
  const now = new Date();
  const tokens = await rows<TokenRow>(pool, "SELECT * FROM agent_tokens WHERE workspace_id = $1 ORDER BY created_at, id", [caller.workspaceId]);
  return json(200, { tokens: tokens.map((t) => tokenOut(t, now)) });
});

route("POST", "/api/agent-tokens", async (ctx) => {
  const { caller } = ctx;
  authorize(caller, "member.manage");
  await assertWritable(caller.workspaceId);
  const body = bodyOf(ctx);
  const now = new Date();
  const errors: FieldErrors = {};
  if (!isName(body.name, 60)) errors.name = "Use 1 to 60 characters";
  if (body.scope !== "read" && body.scope !== "edit") errors.scope = "Choose read or edit";
  const expiresAt = typeof body.expiresAt === "string" ? new Date(body.expiresAt) : new Date(Number.NaN);
  const lead = expiresAt.getTime() - now.getTime();
  if (Number.isNaN(lead) || lead < 10_000 || lead > 365 * DAY_MS) errors.expiresAt = "Pick a time between 10 seconds and 365 days from now";
  const active = await one<{ n: number }>(pool, "SELECT count(*)::int AS n FROM agent_tokens WHERE workspace_id = $1 AND revoked_at IS NULL AND expires_at > $2", [caller.workspaceId, now]);
  if ((active?.n ?? 0) >= tokenLimit(await currentSubscription(caller.workspaceId))) throw conflict("token_limit_reached");
  if (Object.keys(errors).length > 0) throw invalid(errors);
  const secret = agentSecret();
  const expiry = new Date(Math.floor(expiresAt.getTime() / 1000) * 1000);
  const warnAt = new Date(Math.max(now.getTime(), expiry.getTime() - config.tokenWarningLeadSeconds * 1000));
  const token = await transaction(async (client) => {
    const [row] = await rows<TokenRow>(client,
      `INSERT INTO agent_tokens (id, workspace_id, name, scope, secret_hash, expires_at, issued_by_id, issued_by_name, created_at, warn_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [newId("tok"), caller.workspaceId, body.name, body.scope, secretHash(secret), expiry, caller.id, caller.name, now, warnAt]);
    await audit(client, caller.workspaceId, authorOf(caller), "token.issued", { type: "agent_token", id: row.id });
    return row;
  });
  return json(201, { ...tokenOut(token, now), token: secret });
});

route("DELETE", "/api/agent-tokens/:tokenId", async ({ caller, params }) => {
  const token = await one<TokenRow>(pool, "SELECT * FROM agent_tokens WHERE id = $1 AND workspace_id = $2", [params.tokenId, caller.workspaceId]);
  if (!token) throw notFound();
  authorize(caller, "member.manage");
  const current = status(token, new Date());
  if (current !== "active") throw invalidTransition(current, "revoked");
  await transaction(async (client) => {
    await client.query("UPDATE agent_tokens SET revoked_at = now() WHERE id = $1", [token.id]);
    await audit(client, caller.workspaceId, authorOf(caller), "token.revoked", { type: "agent_token", id: token.id });
  });
  const scenes = await clearAuthor({ kind: "agent", id: token.id, name: token.name });
  await Promise.all(scenes.flatMap((scene) => [announce(scene, "lock"), announce(scene, "presence")]));
  return noContent();
});
