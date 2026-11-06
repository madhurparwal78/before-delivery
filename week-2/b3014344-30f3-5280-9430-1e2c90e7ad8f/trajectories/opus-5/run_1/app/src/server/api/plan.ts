import { type Ctx, readJson, sendJson } from "../http.js";
import { errors } from "../errors.js";
import { query } from "../db.js";
import { studioDate } from "../time.js";
import * as killbill from "../services/killbill.js";
import { withIdempotency } from "../domain/idempotency.js";
import { accountById, ownerOfAccount, setAccountCard, type UserRow } from "../domain/accounts.js";
import { cardApproves, checkCard } from "../domain/cards.js";
import { chargeOpenInvoice, invoiceViews, registerInvoice, serializeInvoice } from "../domain/billing.js";
import {
  type CarePlanContext,
  type PlanView,
  carePlanContext,
  createPreview,
  markPreviewUsed,
  newTierPrice,
  planView,
  relockCarePrice,
  serializePlan,
  serializePreview,
  storedPreview,
} from "../domain/plan.js";
import { COPY } from "../../shared/copy.js";
import { type CareTier } from "../../shared/plans.js";

function requireClientOwner(ctx: Ctx): UserRow {
  if (!ctx.user) throw errors.unauthenticated();
  if (ctx.user.role !== "client_owner") throw errors.forbidden();
  return ctx.user;
}

async function loadPlan(ctx: Ctx): Promise<{ context: CarePlanContext; plan: PlanView; killbillAccountId: string; ownerEmail: string }> {
  const user = requireClientOwner(ctx);
  const accountId = user.accountId ?? "";
  const context = await carePlanContext(accountId);
  if (!context) throw errors.notFound();
  const account = await accountById(accountId);
  const owner = await ownerOfAccount(accountId);
  if (!account?.killbillAccountId || !owner) throw errors.notFound();
  const plan = await planView(context);
  return { context, plan, killbillAccountId: account.killbillAccountId, ownerEmail: owner.email };
}

export async function getPlan(ctx: Ctx): Promise<void> {
  const { plan } = await loadPlan(ctx);
  sendJson(ctx.res, 200, { plan: serializePlan(plan) });
}

function readTier(body: Record<string, unknown>): CareTier {
  if (body.tier !== "lite" && body.tier !== "plus") {
    throw errors.validation({ tier: "Choose the Lite or Plus care tier." });
  }
  return body.tier;
}

export async function createPlanPreview(ctx: Ctx): Promise<void> {
  const body = await readJson(ctx);
  const { plan } = await loadPlan(ctx);
  const user = requireClientOwner(ctx);
  const tier = readTier(body);
  if (tier === plan.tier) throw errors.validation({ tier: "That is your current care tier." });
  if (plan.status !== "active" || plan.pauseOn) throw errors.invalidPlanTransition(plan.status);
  const account = await accountById(user.accountId ?? "");
  if (!account?.killbillAccountId) throw errors.notFound();
  const preview = await createPreview({
    accountId: account.id,
    killbillAccountId: account.killbillAccountId,
    plan,
    toTier: tier,
  });
  sendJson(ctx.res, 201, serializePreview(preview));
}

export async function confirmPlanChange(ctx: Ctx): Promise<void> {
  const body = await readJson(ctx);
  const loaded = await loadPlan(ctx);
  const user = requireClientOwner(ctx);
  const outcome = await withIdempotency(ctx, body, async () => {
    const previewId = typeof body.previewId === "string" ? body.previewId : "";
    const preview = await storedPreview(previewId, user.accountId ?? "");
    if (!preview) throw errors.notFound();
    if (preview.usedAt || preview.expiresAt.getTime() < Date.now()) throw errors.previewExpired();
    const plan = loaded.plan;
    if (plan.status !== "active" || plan.pauseOn) throw errors.invalidPlanTransition(plan.status);

    const price = await newTierPrice(preview.toTier, plan.currency);
    const proration = await killbill.dryRunChange({
      accountId: loaded.killbillAccountId,
      bundleId: plan.bundleId,
      subscriptionId: plan.subscriptionId,
      tier: preview.toTier,
      price,
    });
    if (
      proration.credit.minor !== preview.credit.minor ||
      proration.charge.minor !== preview.charge.minor ||
      proration.total.minor !== preview.total.minor
    ) {
      const fresh = await createPreview({
        accountId: user.accountId ?? "",
        killbillAccountId: loaded.killbillAccountId,
        plan,
        toTier: preview.toTier,
      });
      return {
        status: 409,
        body: { error: "preview_stale", message: COPY.previewStale, preview: serializePreview(fresh) },
      };
    }

    const account = await accountById(user.accountId ?? "");
    if (preview.total.minor > 0n && !cardApproves(account?.cardLast4 ?? null)) throw errors.cardDeclined();

    const before = await killbill.listInvoices(loaded.killbillAccountId);
    const seen = new Set(before.map((invoice) => invoice.invoiceId));
    await killbill.changePlan({ subscriptionId: plan.subscriptionId, tier: preview.toTier, price });
    let changeInvoice: killbill.KbInvoice | null = null;
    for (let attempt = 0; attempt < 20 && !changeInvoice; attempt += 1) {
      const after = await killbill.listInvoices(loaded.killbillAccountId);
      changeInvoice =
        after.find(
          (invoice) =>
            !seen.has(invoice.invoiceId) &&
            invoice.items.some((item) => item.itemType === "REPAIR_ADJ" || item.subscriptionId === plan.subscriptionId),
        ) ?? null;
      if (!changeInvoice) await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (!changeInvoice) throw errors.billingUnavailable();

    await registerInvoice({
      invoice: changeInvoice,
      accountId: user.accountId ?? "",
      orderId: plan.orderId,
      kind: "change",
    });
    if (changeInvoice.balance.minor > 0n) {
      await chargeOpenInvoice({
        order: loaded.context.order,
        killbillAccountId: loaded.killbillAccountId,
        ownerEmail: loaded.ownerEmail,
        invoice: changeInvoice,
        kind: "change",
        paymentExternalKey: `${preview.id}-change`,
      });
    }
    await relockCarePrice(plan.orderId, preview.toTier, price);
    await markPreviewUsed(preview.id);

    const context = await carePlanContext(user.accountId ?? "");
    if (!context) throw errors.notFound();
    const updated = await planView(context);
    const invoices = await invoiceViews(user.accountId ?? "");
    const view = invoices.find((invoice) => invoice.id === changeInvoice?.invoiceId);
    return {
      status: 200,
      body: {
        plan: serializePlan(updated),
        invoice: view ? serializeInvoice(view) : null,
      },
    };
  });
  sendJson(ctx.res, outcome.status, outcome.body, outcome.replayed ? { "Idempotent-Replayed": "true" } : {});
}

export async function pausePlan(ctx: Ctx): Promise<void> {
  const body = await readJson(ctx);
  const loaded = await loadPlan(ctx);
  const outcome = await withIdempotency(ctx, body, async () => {
    const plan = loaded.plan;
    if (plan.status !== "active" || plan.pauseOn) throw errors.invalidPlanTransition(plan.status);
    const pauseDate = plan.chargedThrough;
    if (!pauseDate) throw errors.billingUnavailable();
    await killbill.pauseBundle(plan.bundleId, pauseDate);
    const updated = await planView(loaded.context);
    return { status: 200, body: { plan: serializePlan(updated) } };
  });
  sendJson(ctx.res, outcome.status, outcome.body, outcome.replayed ? { "Idempotent-Replayed": "true" } : {});
}

export async function resumePlan(ctx: Ctx): Promise<void> {
  const body = await readJson(ctx);
  const loaded = await loadPlan(ctx);
  const outcome = await withIdempotency(ctx, body, async () => {
    const plan = loaded.plan;
    if (plan.status === "active" && plan.pauseOn) {
      await killbill.resumeBundle(plan.bundleId, plan.pauseOn);
      const updated = await planView(loaded.context);
      return { status: 200, body: { plan: serializePlan(updated) } };
    }
    if (plan.status !== "paused") throw errors.invalidPlanTransition(plan.status);
    const account = await accountById(loaded.context.order.accountId ?? "");
    if (!cardApproves(account?.cardLast4 ?? null)) throw errors.cardDeclined();
    const today = studioDate(new Date());
    await killbill.resumeBundle(plan.bundleId, today);
    let open: killbill.KbInvoice | undefined;
    for (let attempt = 0; attempt < 12 && !open; attempt += 1) {
      const invoices = await killbill.listInvoices(loaded.killbillAccountId);
      open = invoices.find(
        (invoice) =>
          invoice.status !== "VOID" &&
          invoice.balance.minor > 0n &&
          invoice.items.some((item) => item.subscriptionId === plan.subscriptionId),
      );
      if (!open) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (open) {
      await registerInvoice({
        invoice: open,
        accountId: loaded.context.order.accountId ?? "",
        orderId: plan.orderId,
        kind: "renewal",
      });
      await chargeOpenInvoice({
        order: loaded.context.order,
        killbillAccountId: loaded.killbillAccountId,
        ownerEmail: loaded.ownerEmail,
        invoice: open,
        kind: "renewal",
        paymentExternalKey: `${open.invoiceId}-renewal`,
      });
    }
    const updated = await planView(loaded.context);
    return { status: 200, body: { plan: serializePlan(updated) } };
  });
  sendJson(ctx.res, outcome.status, outcome.body, outcome.replayed ? { "Idempotent-Replayed": "true" } : {});
}

export async function cancelPlan(ctx: Ctx): Promise<void> {
  const body = await readJson(ctx);
  const loaded = await loadPlan(ctx);
  const outcome = await withIdempotency(ctx, body, async () => {
    const plan = loaded.plan;
    if (plan.status !== "active" || plan.pauseOn) throw errors.invalidPlanTransition(plan.status);
    await killbill.cancelSubscription(plan.subscriptionId, false);
    const updated = await planView(loaded.context);
    return { status: 200, body: { plan: serializePlan(updated) } };
  });
  sendJson(ctx.res, outcome.status, outcome.body, outcome.replayed ? { "Idempotent-Replayed": "true" } : {});
}

export async function updatePlanCard(ctx: Ctx): Promise<void> {
  const body = await readJson(ctx);
  const loaded = await loadPlan(ctx);
  const outcome = await withIdempotency(ctx, body, async () => {
    const checked = checkCard((body.card ?? {}) as Record<string, unknown>, new Date());
    if (Object.keys(checked.fields).length > 0) throw errors.validation(checked.fields);
    if (!checked.card) throw errors.validation({ "Card number": "Enter the card number." });
    if (!checked.card.approves) throw errors.cardDeclined();
    const accountId = loaded.context.order.accountId ?? "";
    await setAccountCard(accountId, checked.card.last4);
    const open = loaded.plan.openRenewalInvoice;
    if (open) {
      await registerInvoice({
        invoice: open,
        accountId,
        orderId: loaded.plan.orderId,
        kind: "renewal",
      });
      await chargeOpenInvoice({
        order: loaded.context.order,
        killbillAccountId: loaded.killbillAccountId,
        ownerEmail: loaded.ownerEmail,
        invoice: open,
        kind: "renewal",
        paymentExternalKey: `${open.invoiceId}-renewal`,
      });
      await query(
        `delete from dunning_attempts where killbill_invoice_id = $1 and ran_at is null`,
        [open.invoiceId],
      );
    }
    const updated = await planView(loaded.context);
    return { status: 200, body: { plan: serializePlan(updated) } };
  });
  sendJson(ctx.res, outcome.status, outcome.body, outcome.replayed ? { "Idempotent-Replayed": "true" } : {});
}
