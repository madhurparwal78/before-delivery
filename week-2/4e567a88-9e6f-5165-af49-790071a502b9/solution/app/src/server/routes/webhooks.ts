// Webhook endpoints: registration (secret shown once), listing, removal, admin re-enable, delivery log.

import { randomBytes } from "node:crypto";
import { allow, authenticate, teamVisible, type Caller } from "../auth";
import { one, pool, rows, single, tx } from "../db";
import { fail, invalid } from "../errors";
import { json, noContent, route } from "../http";
import { checkAddress, Refused } from "../services/outbound";
import { FIELD_COPY } from "../services/media";

const ENDPOINT_LIMIT = 5;

interface EndpointRow {
  id: string;
  team_id: string;
  url: string;
  state: string;
  consecutive_failures: number;
  created_by: string;
  creator_name: string;
  created_at: Date;
  secret: string;
}

const ENDPOINT_SELECT = `
  SELECT e.id, e.team_id, e.url, e.state, e.consecutive_failures, e.created_by, m.name AS creator_name, e.created_at, e.secret
  FROM webhook_endpoints e JOIN members m ON m.id = e.created_by`;

function project(e: EndpointRow, withSecret = false): Record<string, unknown> {
  return {
    id: e.id,
    team_id: e.team_id,
    url: e.url,
    state: e.state,
    consecutive_failures: e.consecutive_failures,
    created_by: { id: e.created_by, name: e.creator_name },
    created_at: e.created_at.toISOString(),
    ...(withSecret ? { secret: e.secret } : {}),
  };
}

/** 404 for an unknown endpoint or one of another team (for a member). */
async function findEndpoint(caller: Caller, id: string): Promise<EndpointRow> {
  const endpoint = await one<EndpointRow>(pool, `${ENDPOINT_SELECT} WHERE e.id = $1`, [id]);
  if (!endpoint || !teamVisible(caller, endpoint.team_id)) fail("not_found");
  return endpoint;
}

route("POST", "/api/webhook-endpoints", "json", async (req) => {
  const caller = await authenticate(req);
  allow(caller, "member");
  const body = (req.json ?? {}) as { url?: unknown };
  const url = typeof body.url === "string" ? body.url.trim() : "";
  try {
    await checkAddress(url);
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    invalid({ url: url ? FIELD_COPY.refused : "Required." });
  }
  const teamId = caller.team_id as string;
  const created = await tx(async (client) => {
    await client.query("SELECT id FROM teams WHERE id = $1 FOR UPDATE", [teamId]);
    const { count } = await single<{ count: number }>(client,
      "SELECT count(*)::int AS count FROM webhook_endpoints WHERE team_id = $1", [teamId]);
    if (count >= ENDPOINT_LIMIT) fail("endpoint_limit_reached");
    const { id } = await single<{ id: string }>(client,
      `INSERT INTO webhook_endpoints (number, id, team_id, url, secret, state, consecutive_failures, created_by, created_at)
       SELECT n, 'we_' || n, $1, $2, $3, 'active', 0, $4, now() FROM nextval('endpoint_number') AS n RETURNING id`,
      [teamId, url, `whsec_${randomBytes(16).toString("hex")}`, caller.id]);
    return single<EndpointRow>(client, `${ENDPOINT_SELECT} WHERE e.id = $1`, [id]);
  });
  return json(201, { endpoint: project(created, true) });
});

route("GET", "/api/webhook-endpoints", "none", async (req) => {
  const caller = await authenticate(req);
  const team = req.query.get("team") ?? caller.team_id;
  if (team !== null && !teamVisible(caller, team)) fail("not_found");
  allow(caller, "member", "admin");
  const found = await rows<EndpointRow>(pool, `${ENDPOINT_SELECT} WHERE ($1::text IS NULL OR e.team_id = $1) ORDER BY e.number`, [team]);
  return json(200, { endpoints: found.map((e) => project(e)) });
});

route("POST", "/api/webhook-endpoints/{id}/enable", "none", async (req) => {
  const caller = await authenticate(req);
  const endpoint = await findEndpoint(caller, req.params.id);
  allow(caller, "admin");
  const enabled = await pool.query(
    "UPDATE webhook_endpoints SET state = 'active', consecutive_failures = 0 WHERE id = $1 AND state = 'disabled'", [endpoint.id]);
  if (enabled.rowCount === 0) fail("endpoint_not_disabled");
  return json(200, { endpoint: project(await findEndpoint(caller, endpoint.id)) });
});

route("DELETE", "/api/webhook-endpoints/{id}", "none", async (req) => {
  const caller = await authenticate(req);
  const endpoint = await findEndpoint(caller, req.params.id);
  allow(caller, "member", "admin");
  await pool.query("DELETE FROM webhook_endpoints WHERE id = $1", [endpoint.id]);
  return noContent;
});

route("GET", "/api/webhook-endpoints/{id}/deliveries", "none", async (req) => {
  const caller = await authenticate(req);
  const endpoint = await findEndpoint(caller, req.params.id);
  allow(caller, "member", "admin");
  const deliveries = await rows<{
    event_id: string; event_type: string; job_id: string; attempt: number; attempted_at: Date;
    status_code: number | null; outcome: string; next_attempt_at: Date | null;
  }>(pool,
    `SELECT d.event_id, v.type AS event_type, v.job_id, d.attempt, d.attempted_at, d.status_code, d.outcome, d.next_attempt_at
     FROM webhook_deliveries d JOIN webhook_events v ON v.id = d.event_id
     WHERE d.endpoint_id = $1 ORDER BY d.number DESC LIMIT 200`, [endpoint.id]);
  return json(200, {
    deliveries: deliveries.map((d) => ({
      ...d,
      attempted_at: d.attempted_at.toISOString(),
      next_attempt_at: d.next_attempt_at ? d.next_attempt_at.toISOString() : null,
    })),
  });
});
