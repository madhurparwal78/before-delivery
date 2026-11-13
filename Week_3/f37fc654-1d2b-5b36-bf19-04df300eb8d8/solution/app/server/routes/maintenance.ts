// Maintenance retainer billed monthly in advance by Kill Bill (brief: API › Maintenance, Business rules › Maintenance).
import { PLANS, type Plan } from "../../shared/catalog.js";
import { requireCaller } from "../auth.js";
import { applyMove, commissionFor, storedMilestones, userById, type Commission } from "../commissions.js";
import { queueCrmEvent } from "../crm.js";
import { one, pool, tx, type Db } from "../db.js";
import { fail, invalid, jsonBody, ok, record, type Request, type Router } from "../http.js";
import {
  accountInvoices, awaitSubscriptionInvoice, changePlan, ensureAccount, getSubscription, latestInvoiceNumber, startSubscription, type KillbillInvoice,
} from "../providers/killbill.js";
import { localDate } from "../rules/calendar.js";
import { findMove } from "../rules/transitions.js";

function parsePlan(body: Record<string, unknown>): Plan {
  return typeof body.plan === "string" && body.plan in PLANS ? (body.plan as Plan) : invalid({ plan: "Pick Essential or Priority." });
}

const invoiceView = (i: KillbillInvoice) => ({
  killbillInvoiceId: i.invoiceId, invoiceNumber: i.invoiceNumber,
  items: i.items.map((item) => ({ description: item.description, amountCents: item.amountCents, startDate: item.startDate, endDate: item.endDate })),
  amountCents: i.amountCents,
});

async function maintenanceRow(db: Db, commissionId: string): Promise<{ plan: Plan; killbill_subscription_id: string } | null> {
  return one<{ plan: Plan; killbill_subscription_id: string }>("SELECT plan, killbill_subscription_id FROM maintenance WHERE commission_id = $1", [commissionId], db);
}

async function ownedForMaintenance(db: Db, req: Request): Promise<Commission> {
  const caller = await requireCaller(req);
  const c = await commissionFor(db, caller, req.params.id, ["owner", "producer"], true);
  if (c.clientId !== caller.id) fail(403, "forbidden");
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`maintenance:${c.id}`]);
  return c;
}

async function start(req: Request) {
  const body = record(jsonBody(req));
  return tx(async (db) => {
    const c = await ownedForMaintenance(db, req);
    const move = findMove(c.state, "maintained");
    if (!move || (await maintenanceRow(db, c.id))) fail(409, "illegal_state");
    const guard = (await storedMilestones(db, c.id)).find((m) => m.label === move.needsPaid);
    if (guard && guard.state !== "paid") fail(409, "milestone_unpaid", { milestoneId: guard.id });
    const plan = parsePlan(body);
    const accountId = await ensureAccount(await userById(db, c.clientId));
    const today = localDate(Date.now(), c.venue.timeZone);
    const before = await latestInvoiceNumber(accountId);
    const subscriptionId = await startSubscription(accountId, `maint-${c.id}`, PLANS[plan].planName, today);
    const invoice = await awaitSubscriptionInvoice(accountId, subscriptionId, before);
    const subscription = await getSubscription(subscriptionId);
    await db.query("INSERT INTO maintenance (commission_id, plan, killbill_subscription_id) VALUES ($1, $2, $3)", [c.id, plan, subscriptionId]);
    await applyMove(db, c, "maintained", "system");
    await queueCrmEvent(db, c, "maintenance.changed", { fromPlan: null, toPlan: plan, effectiveDate: today });
    return ok({
      plan, killbillSubscriptionId: subscriptionId, startDate: subscription.startDate?.slice(0, 10) ?? today,
      chargedThroughDate: subscription.chargedThroughDate, invoice: invoiceView(invoice),
    }, 201);
  });
}

async function change(req: Request) {
  const body = record(jsonBody(req));
  return tx(async (db) => {
    const c = await ownedForMaintenance(db, req);
    const current = (await maintenanceRow(db, c.id)) ?? fail(409, "illegal_state");
    const plan = parsePlan(body);
    if (plan === current.plan) fail(409, "same_plan");
    const accountId = await ensureAccount(await userById(db, c.clientId));
    const today = localDate(Date.now(), c.venue.timeZone);
    const before = await latestInvoiceNumber(accountId);
    await changePlan(current.killbill_subscription_id, PLANS[plan].planName, today);
    const invoice = await awaitSubscriptionInvoice(accountId, current.killbill_subscription_id, before);
    await db.query("UPDATE maintenance SET plan = $2 WHERE commission_id = $1", [c.id, plan]);
    await queueCrmEvent(db, c, "maintenance.changed", { fromPlan: current.plan, toPlan: plan, effectiveDate: today });
    return ok({ plan, previousPlan: current.plan, prorationDate: today, invoice: invoiceView(invoice) });
  });
}

async function read(req: Request) {
  const caller = await requireCaller(req);
  const c = await commissionFor(pool, caller, req.params.id, ["owner", "producer"]);
  const row = await maintenanceRow(pool, c.id);
  if (!row) return ok({ plan: null, chargedThroughDate: null, invoices: [] });
  const subscription = await getSubscription(row.killbill_subscription_id);
  const accountId = await ensureAccount(await userById(pool, c.clientId));
  const invoices = (await accountInvoices(accountId))
    .filter((i) => i.items.some((item) => item.subscriptionId === row.killbill_subscription_id))
    .sort((a, b) => Number(b.invoiceNumber) - Number(a.invoiceNumber));
  return ok({ plan: row.plan, chargedThroughDate: subscription.chargedThroughDate, invoices: invoices.map(invoiceView) });
}

export function registerMaintenance(router: Router): void {
  router.add("POST", "/api/commissions/:id/maintenance", start);
  router.add("PUT", "/api/commissions/:id/maintenance", change);
  router.add("GET", "/api/commissions/:id/maintenance", read);
}
