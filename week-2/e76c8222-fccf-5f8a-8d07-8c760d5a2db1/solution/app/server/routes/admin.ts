// Rates, invoices, consumer preferences and the audit log.
import type { Invoice, Named, Rates } from "../../shared/api.js";
import { SETTINGS, type Setting } from "../../shared/domain.js";
import { audit } from "../audit.js";
import { chargeAccount } from "../billing.js";
import { one, pool, rows, transaction } from "../db.js";
import { ApiError, invalid } from "../errors.js";
import { json, route } from "../http.js";
import { deadlineFromNow, listInvoices } from "../killbill.js";
import { formatCents, parseMoney } from "../money.js";
import { idParam, isId } from "./common.js";

async function currentRates(): Promise<Rates> {
  const found = await rows<{ setting: Setting; cents: number }>(pool, "SELECT setting, cents FROM rates");
  const rate = (s: Setting): string => formatCents(found.find((r) => r.setting === s)?.cents ?? 0);
  return { medical: rate("medical"), legal: rate("legal"), education: rate("education"), community: rate("community") };
}

route("GET", "/api/rates", ["billing", "coordinator"], async () => json(200, { rates: await currentRates() }));

route("PUT", "/api/rates", ["billing"], async (ctx) => {
  const fields: Record<string, string> = {};
  const changes: [Setting, number][] = [];
  for (const [key, value] of Object.entries(ctx.body)) {
    const setting = SETTINGS.find((s) => s === key);
    const cents = typeof value === "string" ? parseMoney(value) : null;
    if (!setting) fields[key] = "Not a setting.";
    else if (cents === null || cents <= 0 || cents > 100_000) fields[key] = "Enter an hourly rate above 0.00 and no more than 1000.00.";
    else changes.push([setting, cents]);
  }
  if (Object.keys(fields).length) throw invalid(fields);
  const before = await currentRates();
  await transaction(async (client) => {
    for (const [setting, cents] of changes) await client.query("UPDATE rates SET cents = $2 WHERE setting = $1", [setting, cents]);
    const after = { ...before, ...Object.fromEntries(changes.map(([s, c]) => [s, formatCents(c)])) };
    await audit(client, { actorId: ctx.user.id, action: "rates.updated", entity: "rates", entityId: "rates", requestId: null, detail: { before, after } });
  });
  return json(200, { rates: await currentRates() });
});

route("GET", "/api/orgs/:org/invoices", ["requester", "billing"], async (ctx) => {
  const orgId = ctx.params.org ?? "";
  if (!/^[a-z0-9-]{1,64}$/.test(orgId)) throw new ApiError("not_found");
  const org = await one(pool, "SELECT 1 FROM orgs WHERE id = $1", [orgId]);
  if (!org || (ctx.user.role === "requester" && ctx.user.org_id !== orgId)) throw new ApiError("not_found");
  const deadline = deadlineFromNow();
  const account = await chargeAccount(orgId, deadline);
  const found = await listInvoices(account.accountId, deadline);
  found.sort((a, b) => (a.invoiceDate === b.invoiceDate ? Number.parseInt(b.invoiceNumber, 10) - Number.parseInt(a.invoiceNumber, 10) : a.invoiceDate < b.invoiceDate ? 1 : -1));
  const invoices: Invoice[] = found.map((i) => ({
    invoice_id: i.invoiceId,
    invoice_number: i.invoiceNumber,
    invoice_date: i.invoiceDate,
    amount: formatCents(i.amountCents),
    balance: formatCents(i.balanceCents),
    currency: "USD",
    items: i.items.map((item) => ({ description: item.description, amount: formatCents(item.amountCents) })),
  }));
  const total = formatCents(found.reduce((sum, i) => sum + i.amountCents, 0));
  return json(200, { org_id: orgId, killbill_account_id: account.accountId, invoices, total });
});

async function interpreterIds(): Promise<Set<string>> {
  return new Set((await rows<{ id: string }>(pool, "SELECT id FROM users WHERE role = 'interpreter'")).map((u) => u.id));
}

async function preferencesOf(consumerId: string): Promise<{ preferred: string[]; blocked: string[] }> {
  const found = await rows<{ interpreter_id: string; kind: "preferred" | "blocked" }>(
    pool,
    "SELECT interpreter_id, kind FROM preferences WHERE consumer_id = $1 ORDER BY position",
    [consumerId],
  );
  return {
    preferred: found.filter((p) => p.kind === "preferred").map((p) => p.interpreter_id),
    blocked: found.filter((p) => p.kind === "blocked").map((p) => p.interpreter_id),
  };
}

route("GET", "/api/consumers/me/preferences", ["consumer"], async (ctx) => {
  const interpreters = await rows<Named>(pool, "SELECT id, name FROM users WHERE role = 'interpreter' ORDER BY name");
  return json(200, { ...(await preferencesOf(ctx.user.id)), interpreters });
});

route("PUT", "/api/consumers/me/preferences", ["consumer"], async (ctx) => {
  const known = await interpreterIds();
  const fields: Record<string, string> = {};
  const lists: Record<"preferred" | "blocked", string[]> = { preferred: [], blocked: [] };
  for (const kind of ["preferred", "blocked"] as const) {
    const value = ctx.body[kind] ?? [];
    if (!Array.isArray(value) || !value.every((id): id is string => typeof id === "string")) fields[kind] = "Send a list of interpreter ids.";
    else if (!value.every((id) => known.has(id))) fields[kind] = "Unknown interpreter.";
    else lists[kind] = [...new Set(value)];
  }
  if (!fields.blocked && lists.preferred.some((id) => lists.blocked.includes(id))) fields.blocked = "An interpreter cannot be both preferred and blocked.";
  if (Object.keys(fields).length) throw invalid(fields);
  const before = await preferencesOf(ctx.user.id);
  await transaction(async (client) => {
    await client.query("DELETE FROM preferences WHERE consumer_id = $1", [ctx.user.id]);
    for (const kind of ["preferred", "blocked"] as const) {
      for (const [position, id] of lists[kind].entries()) {
        await client.query("INSERT INTO preferences (consumer_id, interpreter_id, kind, position) VALUES ($1, $2, $3, $4)", [ctx.user.id, id, kind, position]);
      }
    }
    await audit(client, {
      actorId: ctx.user.id,
      action: "preferences.updated",
      entity: "preferences",
      entityId: ctx.user.id,
      requestId: null,
      detail: { before, after: lists },
    });
  });
  return json(200, lists);
});

route("GET", "/api/consumers/:id/preferences", ["coordinator"], async (ctx) => {
  const consumer = await one<Named>(pool, "SELECT id, name FROM users WHERE id = $1 AND role = 'consumer'", [idParam(ctx, "id")]);
  if (!consumer) throw new ApiError("not_found");
  return json(200, { consumer, ...(await preferencesOf(consumer.id)) });
});

route("GET", "/api/audit", ["coordinator", "billing"], async (ctx) => {
  const requestId = ctx.url.searchParams.get("request_id");
  if (!isId(requestId)) throw new ApiError("not_found");
  const found = await rows<{
    at: Date;
    actor_id: string | null;
    actor_name: string | null;
    actor_role: string | null;
    action: string;
    entity: string;
    entity_id: string;
    from_status: string | null;
    to_status: string | null;
    detail: Record<string, unknown>;
  }>(
    pool,
    `SELECT a.at, a.actor_id, u.name AS actor_name, u.role AS actor_role, a.action, a.entity, a.entity_id, a.from_status, a.to_status, a.detail
     FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id WHERE a.request_id = $1 ORDER BY a.id`,
    [requestId],
  );
  const entries = found.map((e) => ({
    at: e.at.toISOString(),
    actor: e.actor_id ? { id: e.actor_id, name: e.actor_name, role: e.actor_role } : null,
    action: e.action,
    entity: e.entity,
    entity_id: e.entity_id,
    from: e.from_status,
    to: e.to_status,
    detail: e.detail,
  }));
  return json(200, { entries });
});
