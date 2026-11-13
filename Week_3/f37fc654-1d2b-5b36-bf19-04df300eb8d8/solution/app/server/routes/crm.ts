// CRM endpoint settings and the delivery log, read from Svix (brief: API › CRM webhooks).
import { requireCaller } from "../auth.js";
import { commissionFor, userById } from "../commissions.js";
import { one, pool, query } from "../db.js";
import { fail, invalid, jsonBody, ok, record, type Request, type Router } from "../http.js";
import { delivery, upsertEndpoint } from "../providers/svix.js";
import { ServiceDown } from "../providers/reach.js";

function absoluteHttpUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value.trim());
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname ? value.trim() : null;
  } catch {
    return null;
  }
}

async function saveEndpoint(req: Request) {
  const caller = await requireCaller(req);
  if (!caller.roles.includes("client")) fail(403, "forbidden");
  const url = absoluteHttpUrl(record(jsonBody(req)).url);
  if (!url) invalid({ url: "Enter a full http or https address." });
  try {
    const endpoint = await upsertEndpoint(caller.id, caller.name, url);
    await query(
      `INSERT INTO crm_endpoints (user_id, url, svix_endpoint_id, signing_secret) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET url = EXCLUDED.url, svix_endpoint_id = EXCLUDED.svix_endpoint_id, signing_secret = EXCLUDED.signing_secret, updated_at = now()`,
      [caller.id, url, endpoint.id, endpoint.secret],
    );
    return ok({ url, signingSecret: endpoint.secret });
  } catch (error) {
    if (error instanceof ServiceDown) fail(503, "webhooks_unavailable", { message: "Couldn't save the endpoint — our webhook service isn't answering. Try again in a minute." });
    throw error;
  }
}

async function readEndpoint(req: Request) {
  const caller = await requireCaller(req);
  const row = await one<{ url: string; signing_secret: string }>("SELECT url, signing_secret FROM crm_endpoints WHERE user_id = $1", [caller.id]);
  return ok(row ? { url: row.url, signingSecret: row.signing_secret } : { url: null });
}

async function deliveries(req: Request) {
  const caller = await requireCaller(req);
  const c = await commissionFor(pool, caller, req.params.id, ["owner", "producer"]);
  const client = await userById(pool, c.clientId);
  const hasEndpoint = Boolean(await one("SELECT 1 FROM crm_endpoints WHERE user_id = $1", [client.id]));
  const events = await query<{ event_id: string; type: string; created_at: Date }>(
    "SELECT event_id, type, created_at FROM crm_events WHERE commission_id = $1 ORDER BY created_at", [c.id],
  );
  const rows = [];
  for (const e of events) {
    const found = await delivery(client.id, e.event_id, hasEndpoint);
    rows.push({
      eventId: e.event_id, eventType: e.type, createdAt: e.created_at.toISOString(),
      finalState: found ? found.finalState : hasEndpoint ? "pending" : "no_endpoint",
      attempts: found ? found.attempts : [],
    });
  }
  return ok({ deliveries: rows });
}

export function registerCrm(router: Router): void {
  router.add("PUT", "/api/me/crm-endpoint", saveEndpoint);
  router.add("GET", "/api/me/crm-endpoint", readEndpoint);
  router.add("GET", "/api/commissions/:id/webhook-deliveries", deliveries);
}
