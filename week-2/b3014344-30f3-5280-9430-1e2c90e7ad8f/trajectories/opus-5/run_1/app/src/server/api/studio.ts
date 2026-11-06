import { randomUUID } from "node:crypto";
import { type Ctx, readJson, sendJson } from "../http.js";
import { errors } from "../errors.js";
import { query } from "../db.js";
import { studioInstant } from "../time.js";
import * as killbill from "../services/killbill.js";
import * as cms from "../services/cms.js";
import { withIdempotency } from "../domain/idempotency.js";
import { requireUuid, projectById } from "../domain/access.js";
import { accountById, contractors, ownerOfAccount, userById } from "../domain/accounts.js";
import {
  type OrderState,
  allOrders,
  assertMove,
  orderById,
  orderView,
} from "../domain/orders.js";
import { invoiceLaunchBalance, refundPayment } from "../domain/billing.js";
import { allPriceRows, insertPriceRow } from "../domain/prices.js";
import { creditMessage, queueMessage } from "../mailer.js";
import { creditCurrencyRefusal } from "../../shared/copy.js";
import { isCurrency, parseAmount, toAmountString } from "../../shared/money.js";
import { isPlanId, type PlanId } from "../../shared/plans.js";

async function studioOrderView(orderId: string): Promise<Record<string, unknown>> {
  const order = await orderById(orderId);
  if (!order) throw errors.notFound();
  const account = order.accountId ? await accountById(order.accountId) : null;
  return orderView(order, { businessName: account?.businessName ?? null });
}

export async function listStudioOrders(ctx: Ctx): Promise<void> {
  const orders = await allOrders();
  const views = [];
  for (const order of orders) {
    const account = order.accountId ? await accountById(order.accountId) : null;
    views.push(await orderView(order, { businessName: account?.businessName ?? null }));
  }
  sendJson(ctx.res, 200, { orders: views });
}

export async function getStudioOrder(ctx: Ctx): Promise<void> {
  const order = await orderById(requireUuid(ctx.params.id));
  if (!order || !order.accountId) throw errors.notFound();
  sendJson(ctx.res, 200, await studioOrderView(order.id));
}

export async function transitionOrder(ctx: Ctx): Promise<void> {
  const body = await readJson(ctx);
  const order = await orderById(requireUuid(ctx.params.id));
  if (!order || !order.accountId) throw errors.notFound();
  const to = body.to;
  if (to !== "in_build" && to !== "balance_invoiced" && to !== "closed") {
    throw errors.validation({ to: "Choose in_build, balance_invoiced or closed." });
  }
  assertMove(order, to as OrderState);
  if (to === "in_build") {
    await query(`update orders set state = 'in_build' where id = $1`, [order.id]);
  } else if (to === "balance_invoiced") {
    await invoiceLaunchBalance(order);
  } else {
    await query(`update orders set state = 'closed' where id = $1`, [order.id]);
    await query(`update projects set closed_at = now() where order_id = $1 and closed_at is null`, [order.id]);
  }
  sendJson(ctx.res, 200, await studioOrderView(order.id));
}

export async function assignContractor(ctx: Ctx): Promise<void> {
  const body = await readJson(ctx);
  const project = await projectById(requireUuid(ctx.params.id));
  if (!project) throw errors.notFound();
  const contractorId = typeof body.contractorId === "string" ? body.contractorId : "";
  const contractor = await userById(requireUuid(contractorId));
  if (!contractor) throw errors.notFound();
  if (contractor.role !== "contractor") throw errors.validation({ contractorId: "That person is not a contractor." });
  if (project.closedAt) throw errors.projectClosed();
  const inserted = await query<{ project_id: string }>(
    `insert into project_assignments (project_id, contractor_id) values ($1, $2)
     on conflict do nothing returning project_id`,
    [project.id, contractor.id],
  );
  const rows = await query<{ id: string; name: string; email: string }>(
    `select u.id, u.name, u.email from project_assignments a join users u on u.id = a.contractor_id
      where a.project_id = $1 order by u.name asc`,
    [project.id],
  );
  sendJson(ctx.res, inserted.length > 0 ? 201 : 200, { contractors: rows });
}

export async function unassignContractor(ctx: Ctx): Promise<void> {
  const project = await projectById(requireUuid(ctx.params.id));
  if (!project) throw errors.notFound();
  const contractorId = requireUuid(ctx.params.contractorId);
  await query(`delete from project_assignments where project_id = $1 and contractor_id = $2`, [
    project.id,
    contractorId,
  ]);
  ctx.res.writeHead(204);
  ctx.res.end();
}

export async function listContractors(ctx: Ctx): Promise<void> {
  const people = await contractors();
  sendJson(ctx.res, 200, {
    contractors: people.map((person) => ({ id: person.id, name: person.name, email: person.email })),
  });
}

export async function issueRefund(ctx: Ctx): Promise<void> {
  const body = await readJson(ctx);
  const order = await orderById(requireUuid(ctx.params.id));
  if (!order || !order.accountId) throw errors.notFound();
  const outcome = await withIdempotency(ctx, body, async () => {
    if (body.payment !== "deposit" && body.payment !== "balance") {
      throw errors.validation({ payment: "Choose the deposit or the launch balance." });
    }
    const amountText = typeof body.amount === "string" ? body.amount : "";
    const amount = parseAmount(order.currency, amountText);
    if (!amount || amount.minor <= 0n) {
      throw errors.validation({ amount: "Enter an amount with at most two decimals." });
    }
    const reason = typeof body.reason === "string" ? body.reason : "";
    const refund = await refundPayment({
      order,
      paymentKind: body.payment,
      amount,
      reason,
    });
    return {
      status: 201,
      body: {
        refund: {
          id: refund.refundId,
          payment: refund.paymentKind,
          amount: toAmountString(refund.amount),
          currency: refund.amount.currency,
          killbillTransactionId: refund.killbillTransactionId,
        },
        payment: {
          kind: refund.paymentKind,
          amount: toAmountString(refund.paymentAmount),
          refunded: toAmountString(refund.refunded),
          remaining: toAmountString(refund.remaining),
        },
      },
    };
  });
  sendJson(ctx.res, outcome.status, outcome.body, outcome.replayed ? { "Idempotent-Replayed": "true" } : {});
}

export async function issueCredit(ctx: Ctx): Promise<void> {
  const body = await readJson(ctx);
  const account = await accountById(requireUuid(ctx.params.id));
  if (!account) throw errors.notFound();
  const outcome = await withIdempotency(ctx, body, async () => {
    if (!account.killbillAccountId) throw errors.noBillingAccount();
    if (!isCurrency(body.currency)) throw errors.validation({ currency: "Choose USD or ARS." });
    if (account.currency && body.currency !== account.currency) {
      throw errors.validation({ currency: creditCurrencyRefusal(account.currency) });
    }
    const amountText = typeof body.amount === "string" ? body.amount : "";
    const amount = parseAmount(body.currency, amountText);
    if (!amount || amount.minor <= 0n) {
      throw errors.validation({ amount: "Enter a positive amount with at most two decimals." });
    }
    const reason = typeof body.reason === "string" ? body.reason : "";
    const creditId = randomUUID();
    await killbill.createCredit(account.killbillAccountId, amount, reason || `Account credit ${creditId}`);
    await query(
      `insert into account_credits (id, account_id, amount_minor, currency, reason) values ($1, $2, $3, $4, $5)`,
      [creditId, account.id, amount.minor.toString(), amount.currency, reason],
    );
    const owner = await ownerOfAccount(account.id);
    if (owner) {
      await queueMessage(null, creditMessage({ to: owner.email, creditId, amount, reason }));
    }
    const total = await killbill.accountCredit(account.killbillAccountId, amount.currency);
    return {
      status: 201,
      body: {
        credit: { id: creditId, amount: toAmountString(amount), currency: amount.currency },
        accountCredit: toAmountString(total),
      },
    };
  });
  sendJson(ctx.res, outcome.status, outcome.body, outcome.replayed ? { "Idempotent-Replayed": "true" } : {});
}

export async function listPrices(ctx: Ctx): Promise<void> {
  const rows = await allPriceRows();
  sendJson(ctx.res, 200, {
    prices: rows.map((row) => ({
      id: row.id,
      plan: row.plan,
      currency: row.currency,
      amount: toAmountString(row.amount),
      effectiveAt: studioInstant(row.effectiveAt),
    })),
  });
}

export async function schedulePrice(ctx: Ctx): Promise<void> {
  const body = await readJson(ctx);
  const fields: Record<string, string> = {};
  if (!isPlanId(body.plan)) fields.plan = "Choose one of the published plans.";
  if (body.currency !== "ARS") fields.currency = "Only peso prices can be scheduled.";
  const amount = typeof body.amount === "string" ? parseAmount("ARS", body.amount) : null;
  if (!amount || amount.minor <= 0n) fields.amount = "Enter a positive amount with at most two decimals.";
  let effectiveAt = new Date();
  if (body.effectiveAt !== undefined && body.effectiveAt !== null && body.effectiveAt !== "") {
    const parsed = new Date(String(body.effectiveAt));
    if (Number.isNaN(parsed.getTime())) {
      fields.effectiveAt = "Enter an instant such as 2026-12-01T09:00:00-03:00.";
    } else if (parsed.getTime() < Date.now()) {
      fields.effectiveAt = "Choose an instant that has not passed.";
    } else {
      effectiveAt = parsed;
    }
  }
  if (Object.keys(fields).length > 0 || !amount) throw errors.validation(fields);
  const row = await insertPriceRow({
    plan: body.plan as PlanId,
    currency: "ARS",
    amount,
    effectiveAt,
  });
  sendJson(ctx.res, 201, {
    id: row.id,
    plan: row.plan,
    currency: row.currency,
    amount: toAmountString(row.amount),
    effectiveAt: studioInstant(row.effectiveAt),
  });
}

function serializeEntry(entry: cms.CmsEntry): Record<string, unknown> {
  return {
    id: entry.id,
    kind: entry.kind,
    slug: entry.slug,
    title: entry.title,
    client: entry.client,
    year: entry.year,
    summary: entry.summary,
    body: entry.body,
    status: entry.status,
    publishedAt: entry.publishedAt,
  };
}

export async function listEntries(ctx: Ctx): Promise<void> {
  const entries = await cms.allEntries();
  sendJson(ctx.res, 200, { entries: entries.map(serializeEntry) });
}

export async function createEntry(ctx: Ctx): Promise<void> {
  const body = await readJson(ctx);
  const fields: Record<string, string> = {};
  if (body.kind !== "case_study" && body.kind !== "journal") fields.kind = "Choose case_study or journal.";
  const slug = typeof body.slug === "string" ? body.slug : "";
  if (!/^[a-z0-9-]+$/.test(slug)) fields.slug = "Use lowercase letters, digits and hyphens.";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title.length < 1) fields.title = "Enter a title.";
  if (Object.keys(fields).length === 0 && (await cms.entryBySlug(slug))) {
    fields.slug = "That slug is already in use.";
  }
  if (Object.keys(fields).length > 0) throw errors.validation(fields);
  const entry = await cms.createEntry({
    kind: body.kind as cms.EntryKind,
    slug,
    title,
    client: typeof body.client === "string" ? body.client : "",
    year: typeof body.year === "number" ? body.year : Number(body.year ?? 0),
    summary: typeof body.summary === "string" ? body.summary : "",
    body: typeof body.body === "string" ? body.body : "",
  });
  sendJson(ctx.res, 201, serializeEntry(entry));
}

export async function publishEntry(ctx: Ctx): Promise<void> {
  const entry = await cms.entryById(ctx.params.id ?? "");
  if (!entry) throw errors.notFound();
  if (entry.status !== "draft") throw errors.invalidEntryTransition(entry.status);
  const updated = await cms.setEntryStatus(entry.id, "published", new Date().toISOString().slice(0, 10));
  sendJson(ctx.res, 200, serializeEntry(updated));
}

export async function withdrawEntry(ctx: Ctx): Promise<void> {
  const entry = await cms.entryById(ctx.params.id ?? "");
  if (!entry) throw errors.notFound();
  if (entry.status !== "published") throw errors.invalidEntryTransition(entry.status);
  const updated = await cms.setEntryStatus(entry.id, "withdrawn", entry.publishedAt);
  sendJson(ctx.res, 200, serializeEntry(updated));
}
