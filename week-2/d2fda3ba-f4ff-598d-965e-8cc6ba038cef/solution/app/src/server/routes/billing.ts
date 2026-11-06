// The Sync and Publish add-ons (API: "Billing").
import { billingFor } from "../billing.ts";
import { pool } from "../db.ts";
import { ApiError, jsonBody, notFound, route, sendJson, validationError, type Ctx } from "../http.ts";
import { cancelSubscription, createAccount, createSubscription, current, findAccount, subscriptions } from "../killbill.ts";
import { requireSession } from "../session.ts";
import type { AddonName } from "../../shared/types.ts";

const isAddon = (value: unknown): value is AddonName => value === "sync" || value === "publish";

route("GET", "/api/billing", async (ctx: Ctx) => {
  const session = await requireSession(ctx);
  sendJson(ctx.res, 200, await billingFor(session.account));
});

route("POST", "/api/billing/subscriptions", async (ctx: Ctx) => {
  const session = await requireSession(ctx);
  const body = jsonBody(ctx);
  if (!isAddon(body.addon)) throw validationError({ addon: "Choose sync or publish." });
  const addon = body.addon;
  const kbId = await findAccount(session.account.id) ?? await createAccount(session.account);
  await pool.query("UPDATE accounts SET kb_account_id = $2 WHERE id = $1", [session.account.id, kbId]);
  const sub = current(await subscriptions(kbId), addon);
  if (sub && sub.state !== "CANCELLED") throw new ApiError(409, "already_subscribed", `The ${addon === "sync" ? "Sync" : "Publish"} add-on is already on this account.`);
  await createSubscription(kbId, session.account.id, addon);
  sendJson(ctx.res, 201, await billingFor(session.account));
});

route("DELETE", "/api/billing/subscriptions/:addon", async (ctx: Ctx) => {
  const session = await requireSession(ctx);
  const addon = ctx.params.addon;
  if (!isAddon(addon)) throw notFound();
  const kbId = await findAccount(session.account.id);
  const sub = kbId ? current(await subscriptions(kbId), addon) : null;
  if (!sub || sub.state === "CANCELLED" || sub.billingEndDate) {
    throw new ApiError(409, "not_subscribed", `There is no ${addon === "sync" ? "Sync" : "Publish"} subscription to cancel.`);
  }
  await cancelSubscription(sub.subscriptionId);
  sendJson(ctx.res, 200, await billingFor(session.account));
});
