// Partner access: case creation with a partner key and request keys (adapted from kit/modules/idempotency, keyed on
// the exact body bytes), the partner rate limit, and the officer's key management.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { allow, digest, staff } from "../auth.js";
import { config } from "../config.js";
import { lockName, one, pool, rows, tx } from "../db.js";
import { ApiError, refuse } from "../errors.js";
import { stringifyMoneyJson } from "../../shared/json.js";
import { errorReply, objectBody, type Ctx, type Reply, type Router } from "../http.js";
import { codePoints } from "../names.js";
import { spend } from "../ratelimit.js";
import { deliverLater } from "../smtp.js";
import { workspaceBySlug, type Workspace } from "../workspaces.js";
import { createCase, validateCaseInput } from "../cases/decide.js";
import { isUuid } from "../cases/transitions.js";
import { caseBodies } from "./cases.js";
import { findCase } from "../cases/transitions.js";
import { isoInstant } from "../../shared/format.js";

interface PartnerKeyRow {
  id: string;
  workspace_slug: string;
  label: string;
  starts_with: string;
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
}

const keyBody = (k: PartnerKeyRow) => ({
  id: k.id, label: k.label, startsWith: k.starts_with, createdAt: isoInstant(k.created_at.getTime()),
  lastUsedAt: k.last_used_at ? isoInstant(k.last_used_at.getTime()) : null,
  revokedAt: k.revoked_at ? isoInstant(k.revoked_at.getTime()) : null,
});

/** Rungs 6 to 10 for a partner case request, as a reply (refusals included) so it can be stored for the key. */
async function partnerCase(ctx: Ctx, workspace: Workspace, key: PartnerKeyRow, requestKey: string | undefined): Promise<Reply> {
  try {
    const body = objectBody(ctx.json());
    const missingKey = requestKey === undefined || requestKey.length < 1 || requestKey.length > 100;
    const input = await validateCaseInput(pool, workspace, body).catch((error: unknown) => {
      if (missingKey && error instanceof ApiError && error.status === 422) {
        throw refuse.invalid({ requestKey: "Send a Request-Key header.", ...error.fields });
      }
      throw error;
    });
    if (missingKey) throw refuse.invalid({ requestKey: "Send a Request-Key header." });
    const created = await tx((db) => createCase(db, workspace, input, { kind: "partner_key", name: key.label }));
    if (created.mail) deliverLater(created.mail);
    const [kase] = await caseBodies(pool, [await findCase(pool, workspace, created.id)], false);
    return { status: 201, json: { case: kase } };
  } catch (error) {
    if (error instanceof ApiError) return errorReply(error);
    throw error;
  }
}

export function registerPartner(router: Router): void {
  router.add("POST", "/api/partner/v1/cases", async (ctx) => {
    const bearer = /^Bearer\s+(\S+)$/.exec(ctx.header("authorization") ?? "");
    const key = bearer
      ? await one<PartnerKeyRow>(pool, "SELECT * FROM partner_keys WHERE key_hash = $1 AND revoked_at IS NULL", [digest(bearer[1])])
      : null;
    if (!key) throw refuse.badPartnerKey();
    await spend({ name: `partner:${key.id}`, max: 30, windowSeconds: config.timers.partnerRateWindow }, true);
    await pool.query("UPDATE partner_keys SET last_used_at = now() WHERE id = $1", [key.id]);
    const workspace = workspaceBySlug(key.workspace_slug)!;
    const requestKey = ctx.header("request-key");
    if (requestKey === undefined || requestKey.length < 1 || requestKey.length > 100) return partnerCase(ctx, workspace, key, undefined);
    const bodyHash = createHash("sha256").update(ctx.body).digest("hex");
    return tx(async (db) => {
      await lockName(db, `request-key:${key.id}:${requestKey}`);
      const stored = await one<{ body_sha256: string; status: number; body: string }>(db,
        "SELECT * FROM partner_requests WHERE partner_key_id = $1 AND request_key = $2 AND created_at > now() - interval '24 hours'",
        [key.id, requestKey]);
      if (stored) {
        if (stored.body_sha256 !== bodyHash) {
          throw refuse.conflict("request_key_reused", "This request key was already used with a different body.");
        }
        return { status: stored.status, body: stored.body, headers: { "Content-Type": "application/json; charset=utf-8" } };
      }
      const reply = await partnerCase(ctx, workspace, key, requestKey);
      if (reply.status !== 503) {
        await db.query(
          `INSERT INTO partner_requests (partner_key_id, request_key, body_sha256, status, body, created_at) VALUES ($1, $2, $3, $4, $5, now())
           ON CONFLICT (partner_key_id, request_key) DO UPDATE SET body_sha256 = $3, status = $4, body = $5, created_at = now()`,
          [key.id, requestKey, bodyHash, reply.status, stringifyMoneyJson(reply.json)]);
      }
      return reply;
    });
  });

  router.add("GET", "/api/w/:slug/partner-keys", async (ctx) => {
    const who = await staff(ctx);
    allow(who, "compliance_officer");
    const found = await rows<PartnerKeyRow>(pool, "SELECT * FROM partner_keys WHERE workspace_slug = $1 ORDER BY created_at, id", [who.workspace.slug]);
    return { status: 200, json: { keys: found.map(keyBody) } };
  });

  router.add("POST", "/api/w/:slug/partner-keys", async (ctx) => {
    const who = await staff(ctx);
    allow(who, "compliance_officer");
    const body = objectBody(ctx.json());
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (label === "" || codePoints(label) > 80) throw refuse.invalid({ label: "Enter a label of up to 80 characters." });
    const secret = `lnlk_${randomBytes(16).toString("hex")}`;
    const created = await one<PartnerKeyRow>(pool,
      "INSERT INTO partner_keys (id, workspace_slug, label, key_hash, starts_with, created_at) VALUES ($1, $2, $3, $4, $5, now()) RETURNING *",
      [randomUUID(), who.workspace.slug, label, digest(secret), secret.slice(0, 9)]);
    return { status: 201, json: { key: keyBody(created!), secret } };
  });

  router.add("DELETE", "/api/w/:slug/partner-keys/:keyId", async (ctx) => {
    const who = await staff(ctx);
    const key = isUuid(ctx.params.keyId)
      ? await one<PartnerKeyRow>(pool, "SELECT * FROM partner_keys WHERE id = $1 AND workspace_slug = $2", [ctx.params.keyId, who.workspace.slug])
      : null;
    if (!key) throw refuse.notFound();
    allow(who, "compliance_officer");
    const revoked = await one<PartnerKeyRow>(pool,
      "UPDATE partner_keys SET revoked_at = date_trunc('second', now()) WHERE id = $1 AND revoked_at IS NULL RETURNING *", [key.id]);
    if (!revoked) throw refuse.conflict("key_revoked", "This key is already revoked.");
    return { status: 200, json: { key: keyBody(revoked) } };
  });
}
