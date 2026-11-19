import { randomBytes } from "node:crypto";
import { PLANS } from "../../shared/rules.js";
import { hash, requireRole, signedIn } from "../auth.js";
import { changePlan, currentRate, payOutstanding, readBilling } from "../billing.js";
import { Check } from "../body.js";
import { one, pool, rows } from "../db.js";
import { notFound, ProviderDown } from "../errors.js";
import { json, type Ctx, type Route } from "../http.js";
import * as svix from "../svix.js";
import { createBucket, deleteBucket } from "../valkey.js";
import { iso, venueById } from "../views.js";

interface KeyRow {
  id: string;
  name: string;
  created_at: Date;
  revoked_at: Date | null;
}

const keyView = (k: KeyRow) => ({ id: k.id, name: k.name, created_at: iso(k.created_at), revoked_at: iso(k.revoked_at) });

async function listKeys(ctx: Ctx) {
  const auth = signedIn(ctx);
  requireRole(auth, "builder");
  const keys = await rows<KeyRow>(pool, "SELECT id, name, created_at, revoked_at FROM api_keys WHERE member_id = $1 ORDER BY created_at DESC", [auth.memberId]);
  return json(200, { keys: keys.map(keyView) });
}

async function createKey(ctx: Ctx) {
  const auth = signedIn(ctx);
  requireRole(auth, "builder");
  const check = new Check(ctx.body, ["name"]);
  const name = check.text("name", 1, 40);
  check.done();
  const id = randomBytes(6).toString("hex");
  const secret = `pv_${id}_${randomBytes(20).toString("hex")}`;
  await createBucket(id, await currentRate(auth.memberId));
  const row = (await one<KeyRow>(pool, "INSERT INTO api_keys (id, member_id, name, secret_hash) VALUES ($1, $2, $3, $4) RETURNING *", [id, auth.memberId, name, hash(secret)])) as KeyRow;
  return json(201, { id, name, secret, created_at: iso(row.created_at) });
}

async function revokeKey(ctx: Ctx) {
  const auth = signedIn(ctx);
  const key = await one<{ id: string }>(pool, "SELECT id FROM api_keys WHERE id = $1 AND member_id = $2", [ctx.params.id ?? "", auth.memberId]);
  if (!key) throw notFound();
  requireRole(auth, "builder");
  await pool.query("UPDATE api_keys SET revoked_at = coalesce(revoked_at, now()) WHERE id = $1", [key.id]);
  await deleteBucket(key.id);
  return { status: 204 };
}

async function getBilling(ctx: Ctx) {
  const auth = signedIn(ctx);
  requireRole(auth, "builder");
  return json(200, await readBilling(auth.memberId));
}

async function postPlan(ctx: Ctx) {
  const auth = signedIn(ctx);
  requireRole(auth, "builder");
  const check = new Check(ctx.body, ["plan"]);
  const plan = check.oneOf("plan", PLANS);
  check.done();
  return json(200, await changePlan(auth.memberId, plan));
}

async function postPay(ctx: Ctx) {
  const auth = signedIn(ctx);
  requireRole(auth, "builder");
  return json(200, await payOutstanding(auth.memberId));
}

interface EndpointRow {
  url: string;
  svix_endpoint_id: string;
  signing_secret: string;
}

async function getWebhooks(ctx: Ctx) {
  const auth = signedIn(ctx);
  const venueId = requireRole(auth, "builder");
  const endpoint = await one<EndpointRow>(pool, "SELECT url, svix_endpoint_id, signing_secret FROM webhook_endpoints WHERE member_id = $1", [auth.memberId]);
  if (!endpoint) return json(200, { endpoint: null, delivery: (await svix.reachable()) ? "ok" : "delayed", attempts: [] });
  const venue = await venueById(pool, venueId);
  try {
    return json(200, { endpoint, delivery: "ok", attempts: await svix.attempts(venue.slug, endpoint.svix_endpoint_id) });
  } catch (error) {
    if (!(error instanceof ProviderDown)) throw error;
    return json(200, { endpoint, delivery: "delayed", attempts: [] });
  }
}

async function putEndpoint(ctx: Ctx) {
  const auth = signedIn(ctx);
  const venueId = requireRole(auth, "builder");
  const check = new Check(ctx.body, ["url"]);
  const url = check.text("url", 1, 500, false);
  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    parsed = null;
  }
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) check.fail("url", "invalid");
  check.done();
  const venue = await venueById(pool, venueId);
  await svix.ensureApp(venue.slug, venue.name);
  const endpoint = await svix.upsertEndpoint(venue.slug, auth.memberId, url);
  await pool.query(
    `INSERT INTO webhook_endpoints (member_id, url, svix_endpoint_id, signing_secret) VALUES ($1, $2, $3, $4)
     ON CONFLICT (member_id) DO UPDATE SET url = EXCLUDED.url, svix_endpoint_id = EXCLUDED.svix_endpoint_id, signing_secret = EXCLUDED.signing_secret`,
    [auth.memberId, url, endpoint.id, endpoint.secret],
  );
  return json(200, { url, svix_endpoint_id: endpoint.id, signing_secret: endpoint.secret });
}

async function deleteEndpoint(ctx: Ctx) {
  const auth = signedIn(ctx);
  const venueId = requireRole(auth, "builder");
  const venue = await venueById(pool, venueId);
  await svix.deleteEndpoint(venue.slug, auth.memberId);
  await pool.query("DELETE FROM webhook_endpoints WHERE member_id = $1", [auth.memberId]);
  return { status: 204 };
}

export const builderRoutes: Route[] = [
  { method: "GET", pattern: "/api/keys", auth: "session", handler: listKeys },
  { method: "POST", pattern: "/api/keys", auth: "session", handler: createKey },
  { method: "DELETE", pattern: "/api/keys/{id}", auth: "session", handler: revokeKey },
  { method: "GET", pattern: "/api/billing", auth: "session", handler: getBilling },
  { method: "POST", pattern: "/api/billing/plan", auth: "session", handler: postPlan, outage: "billing_unavailable" },
  { method: "POST", pattern: "/api/billing/pay", auth: "session", handler: postPay, outage: "billing_unavailable" },
  { method: "GET", pattern: "/api/webhooks", auth: "session", handler: getWebhooks },
  { method: "PUT", pattern: "/api/webhooks/endpoint", auth: "session", handler: putEndpoint, outage: "webhooks_unavailable" },
  { method: "DELETE", pattern: "/api/webhooks/endpoint", auth: "session", handler: deleteEndpoint, outage: "webhooks_unavailable" },
];
