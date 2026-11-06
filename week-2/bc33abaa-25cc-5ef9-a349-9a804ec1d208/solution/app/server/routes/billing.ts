// Billing routes. Every billing POST except the webhook carries an Idempotency-Key and runs serially per workspace.
import type { Action } from "../../shared/permissions.js";
import { one, pool } from "../db.js";
import { notFound } from "../errors.js";
import { bytes, json, publicRoute, route, type AuthedContext, type Reply } from "../http.js";
import { authorize } from "../domain/permissions.js";
import { toSubscription, currentSubscription } from "../domain/subscription.js";
import { idempotent } from "../idempotency.js";
import { getObject, keys } from "../services/storage.js";
import { loadWorkspace } from "../workspace.js";
import * as billing from "../billing.js";

/** A billing POST: permission first, then the idempotency key, then the work, one at a time per workspace. */
function billingPost(path: string, action: Action, work: (ctx: AuthedContext, key: string) => Promise<Reply>): void {
  route("POST", path, async (ctx) => {
    authorize(ctx.caller, action);
    return idempotent(ctx, () => billing.serially(ctx.caller.workspaceId, () => work(ctx, String(ctx.headers["idempotency-key"]))));
  });
}

route("GET", "/api/billing", async ({ caller }) => {
  authorize(caller, "billing");
  const sub = await currentSubscription(caller.workspaceId);
  return json(200, { subscription: toSubscription(sub, new Date()), card: sub.card_last4 ? { last4: sub.card_last4 } : null });
});

billingPost("/api/billing/checkout", "billing", (ctx, key) => billing.checkout(ctx.caller, ctx.body(), key));
billingPost("/api/billing/plan", "billing", (ctx, key) => billing.changePlan(ctx.caller, ctx.body(), key));
billingPost("/api/billing/seats", "billing", (ctx, key) => billing.changeSeats(ctx.caller, ctx.body(), key));
billingPost("/api/billing/cancel", "subscription.cancel", (ctx) => billing.cancelSubscription(ctx.caller));

route("POST", "/api/billing/invoices/:invoiceId/pay", async (ctx) => {
  await billing.ownInvoice(await loadWorkspace(pool, ctx.caller.workspaceId), ctx.params.invoiceId);
  authorize(ctx.caller, "billing");
  return idempotent(ctx, () => billing.serially(ctx.caller.workspaceId,
    () => billing.payInvoice(ctx.caller, ctx.params.invoiceId, ctx.body(), String(ctx.headers["idempotency-key"]))));
});

route("POST", "/api/billing/payments/:paymentId/refund", async (ctx) => {
  const payment = await one(pool, "SELECT 1 FROM payments WHERE id = $1 AND workspace_id = $2", [ctx.params.paymentId, ctx.caller.workspaceId]);
  if (!payment) throw notFound();
  authorize(ctx.caller, "billing");
  return idempotent(ctx, () => billing.serially(ctx.caller.workspaceId,
    () => billing.refund(ctx.caller, ctx.params.paymentId, ctx.body(), String(ctx.headers["idempotency-key"]))));
});

route("GET", "/api/billing/plan/preview", async ({ caller, query }) => {
  authorize(caller, "billing");
  return billing.previewPlan(caller, query);
});

route("GET", "/api/billing/invoices", async ({ caller }) => {
  authorize(caller, "billing");
  return billing.listInvoices(caller);
});

route("GET", "/api/billing/invoices/:invoiceId/pdf", async ({ caller, params }) => {
  const document = await one(pool, "SELECT 1 FROM invoice_documents WHERE invoice_id = $1 AND workspace_id = $2", [params.invoiceId, caller.workspaceId]);
  if (!document) throw notFound();
  authorize(caller, "billing");
  const pdf = await getObject(keys.invoice(caller.workspaceId, params.invoiceId));
  if (!pdf) throw notFound();
  return bytes(pdf, "application/pdf", { "Content-Disposition": `attachment; filename="invoice-${params.invoiceId}.pdf"` });
});

route("GET", "/api/billing/gateway", async ({ caller }) => {
  authorize(caller, "gateway.read");
  return json(200, { signingSecret: (await loadWorkspace(pool, caller.workspaceId)).signing_secret });
});

publicRoute("POST", "/api/billing/webhook", async ({ raw, headers }) => {
  const signature = headers["orrery-signature"];
  return billing.webhook(raw, typeof signature === "string" ? signature : undefined);
}, { anyOrigin: true });
