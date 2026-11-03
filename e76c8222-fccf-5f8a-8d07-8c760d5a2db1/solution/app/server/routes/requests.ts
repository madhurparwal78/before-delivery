// Requests: list, create (drafts, or logged-after by a coordinator), read, edit drafts, submit.
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { ORGANISATIONS, REQUEST_STATUSES, type RequestStatus } from "../../shared/domain.js";
import { audit } from "../audit.js";
import { type Db, pool, rows, transaction } from "../db.js";
import { assertDraft, seatCount } from "../domain/rules.js";
import { requestFields, type RequestFields } from "../domain/validation.js";
import { invalid } from "../errors.js";
import { json, route, type AuthedCtx } from "../http.js";
import { observe } from "../sweep.js";
import { requestRows, requestView, requestViews } from "../views.js";
import { idParam, visibleRequest } from "./common.js";

async function consumerIds(db: Db): Promise<Set<string>> {
  return new Set((await rows<{ id: string }>(db, "SELECT id FROM users WHERE role = 'consumer'")).map((u) => u.id));
}

/** Creates or removes seats so a draft always has the team rule's count. */
async function fitSeats(client: PoolClient, requestId: string, fields: RequestFields): Promise<void> {
  const wanted = seatCount(fields.setting, fields.start, fields.end);
  await client.query("DELETE FROM seats WHERE request_id = $1 AND position > $2", [requestId, wanted]);
  for (let position = 1; position <= wanted; position += 1) {
    await client.query("INSERT INTO seats (id, request_id, position) VALUES ($1, $2, $3) ON CONFLICT (request_id, position) DO NOTHING", [
      randomUUID(),
      requestId,
      position,
    ]);
  }
}

route("GET", "/api/requests", ["requester", "coordinator", "billing"], async (ctx) => {
  await observe();
  const status = ctx.url.searchParams.get("status");
  if (status !== null && !REQUEST_STATUSES.includes(status as RequestStatus)) throw invalid({ status: "Unknown status." });
  const own = ctx.user.role === "requester";
  const found = await requestRows(pool, own ? "r.org_id = $1" : "$1::text IS NULL", [own ? ctx.user.org_id : null], "r.start_at DESC");
  const views = await requestViews(pool, found);
  return json(200, { requests: status === null ? views : views.filter((r) => r.status === status) });
});

route("POST", "/api/requests", ["requester", "coordinator"], async (ctx) => {
  const now = new Date();
  const coordinator = ctx.user.role === "coordinator";
  const orgId = coordinator ? ctx.body.org_id : ctx.user.org_id;
  const extra: Record<string, string> = {};
  if (coordinator && ctx.body.logged_after !== true) extra.logged_after = "Coordinators log requests after the fact: send logged_after true.";
  if (!ORGANISATIONS.some((o) => o.id === orgId)) extra.org_id = "Choose a requesting organisation.";
  const fields = requestFields(ctx.body, coordinator, await consumerIds(pool), now, extra);
  const status: RequestStatus = coordinator ? "submitted" : "draft";
  const id = randomUUID();
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO requests (id, ref_no, org_id, title, setting, location, start_at, end_at, consumer_id, notes, status, logged_after)
       VALUES ($1, nextval('request_ref_seq'), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [id, orgId, fields.title, fields.setting, fields.location, fields.start, fields.end, fields.consumerId, fields.notes, status, coordinator],
    );
    await fitSeats(client, id, fields);
    await audit(client, { actorId: ctx.user.id, action: "request.created", entity: "request", entityId: id, requestId: id, from: null, to: status });
  });
  return json(201, { request: await requestView(pool, id) });
});

route("GET", "/api/requests/:id", ["requester", "coordinator", "billing"], async (ctx) => {
  await observe();
  const row = await visibleRequest(pool, ctx.user, idParam(ctx, "id"));
  return json(200, { request: (await requestViews(pool, [row]))[0] });
});

/** The stored fields as the create body would send them, so a patch validates the merged whole. */
function asBody(row: Awaited<ReturnType<typeof visibleRequest>>): Record<string, unknown> {
  return {
    title: row.title,
    setting: row.setting,
    location: row.location,
    start: row.start_at.toISOString(),
    end: row.end_at.toISOString(),
    consumer_id: row.consumer_id,
    notes: row.notes,
  };
}

const EDITABLE = ["title", "setting", "location", "start", "end", "consumer_id", "notes"] as const;

async function patch(ctx: AuthedCtx): Promise<string> {
  const id = idParam(ctx, "id");
  const consumers = await consumerIds(pool);
  return transaction(async (client) => {
    const row = await visibleRequest(client, ctx.user, id, true);
    assertDraft(row.status);
    const merged = asBody(row);
    for (const key of EDITABLE) if (key in ctx.body) merged[key] = ctx.body[key];
    const fields = requestFields(merged, false, consumers, new Date());
    await client.query(
      `UPDATE requests SET title = $2, setting = $3, location = $4, start_at = $5, end_at = $6, consumer_id = $7, notes = $8 WHERE id = $1`,
      [id, fields.title, fields.setting, fields.location, fields.start, fields.end, fields.consumerId, fields.notes],
    );
    await fitSeats(client, id, fields);
    await audit(client, {
      actorId: ctx.user.id,
      action: "request.updated",
      entity: "request",
      entityId: id,
      requestId: id,
      from: "draft",
      to: "draft",
      detail: { fields: EDITABLE.filter((key) => key in ctx.body) },
    });
    return id;
  });
}

route("PATCH", "/api/requests/:id", ["requester"], async (ctx) => json(200, { request: await requestView(pool, await patch(ctx)) }));

route("POST", "/api/requests/:id/submit", ["requester"], async (ctx) => {
  const id = idParam(ctx, "id");
  const consumers = await consumerIds(pool);
  await transaction(async (client) => {
    const row = await visibleRequest(client, ctx.user, id, true);
    assertDraft(row.status);
    requestFields(asBody(row), false, consumers, new Date());
    await client.query("UPDATE requests SET status = 'submitted' WHERE id = $1", [id]);
    await audit(client, { actorId: ctx.user.id, action: "request.submitted", entity: "request", entityId: id, requestId: id, from: "draft", to: "submitted" });
  });
  return json(200, { request: await requestView(pool, id) });
});

route("GET", "/api/consumers", ["requester", "coordinator"], async () =>
  json(200, { consumers: await rows(pool, "SELECT id, name FROM users WHERE role = 'consumer' ORDER BY name") }),
);
