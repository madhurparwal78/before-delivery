/** Cancellation policy versions and the hour pack. */

import { uuid } from "../../db.js";
import { err, validation } from "../errors.js";
import type { App, RouteContext } from "../server.js";
import { int, json, readJson, requireIdempotencyKey, requireRole, requireUser, str } from "./helpers.js";
import { policyJson } from "./booking-json.js";
import type { UserRow } from "./helpers.js";

export function registerPolicyRoutes(app: App): void {
  app.route("GET", "/api/cancellation-policy", "signed_in", async ({ db }) => {
    const history = await db.query<{
      version: number;
      free_window_hours: number;
      late_fee_percent: number;
      effective_at: Date;
    }>("SELECT version, free_window_hours, late_fee_percent, effective_at FROM policy_versions ORDER BY version DESC");
    return json(200, { current: policyJson(history[0]), history: history.map(policyJson) });
  });

  app.route("PUT", "/api/cancellation-policy", "signed_in", async (rc) => {
    const user = await requireUser(rc);
    requireRole(user, ["operator"]);
    const body = await readJson(rc.ctx);
    const freeWindowHours = int(body["free_window_hours"]);
    const lateFeePercent = int(body["late_fee_percent"]);
    const basedOnVersion = int(body["based_on_version"]);
    const details: Record<string, string> = {};
    if (freeWindowHours === undefined || freeWindowHours < 0 || freeWindowHours > 168) {
      details["free_window_hours"] = "The free window is 0 to 168 hours.";
    }
    if (lateFeePercent === undefined || lateFeePercent < 0 || lateFeePercent > 100) {
      details["late_fee_percent"] = "The late charge is 0 to 100 percent.";
    }
    if (basedOnVersion === undefined) {
      details["based_on_version"] = "Send the version this change is based on.";
    }
    if (Object.keys(details).length > 0) {
      throw validation(details);
    }
    const current = await rc.db.query<{ version: number }>(
      "SELECT version FROM policy_versions ORDER BY version DESC LIMIT 1"
    );
    if (basedOnVersion !== current[0].version) {
      throw err(412, "stale_version", "The policy changed since you opened it. Reload to see the latest.", {
        current_version: current[0].version
      });
    }
    const next = current[0].version + 1;
    const created = await rc.db.query<{
      version: number;
      free_window_hours: number;
      late_fee_percent: number;
      effective_at: Date;
    }>(
      `INSERT INTO policy_versions (version, free_window_hours, late_fee_percent, effective_at)
       VALUES ($1,$2,$3, now()) RETURNING version, free_window_hours, late_fee_percent, effective_at`,
      [next, freeWindowHours, lateFeePercent]
    );
    await rc.db.audit(user.id, "save_policy", "policy_version", String(next), {
      free_window_hours: freeWindowHours,
      late_fee_percent: lateFeePercent
    });
    return json(201, policyJson(created[0]));
  });
}

export function registerHourPackRoutes(
  app: App,
  killbill: import("../../providers/killbill.js").KillBillClient
): void {
  app.route("GET", "/api/hour-packs", "signed_in", async (rc) => {
    const user = await requireUser(rc);
    requireRole(user, ["operator", "owner"]);
    const packs = await rc.db.query<{ id: string; name: string; minutes: number; price_cents: number }>(
      "SELECT id, name, minutes, price_cents FROM hour_packs ORDER BY minutes"
    );
    return json(200, { packs });
  });

  app.route("POST", "/api/hour-packs/purchase", "signed_in", async (rc) => {
    const user = await requireUser(rc);
    requireRole(user, ["operator", "owner"]);
    requireRole(user, ["owner"]);
    requireIdempotencyKey(rc.ctx);
    const body = await readJson(rc.ctx);
    const packId = str(body["pack_id"]) ?? "";
    const packs = await rc.db.query<{ id: string; name: string; minutes: number; price_cents: number }>(
      "SELECT id, name, minutes, price_cents FROM hour_packs WHERE id = $1",
      [packId]
    );
    if (packs.length === 0) {
      throw validation({ pack_id: "Choose an hour pack." });
    }
    const pack = packs[0];
    const tenantId = user.tenant_id as string;
    const tenantRows = await rc.db.query<{ business_name: string }>(
      "SELECT business_name FROM tenants WHERE id = $1",
      [tenantId]
    );

    // The purchase id must exist before Kill Bill records the payment keyed by it.
    const purchaseId = uuid();
    await rc.db.withTransaction(async (client) => {
      await client.query(
        "INSERT INTO purchases (id, tenant_id, pack_id, created_at) VALUES ($1,$2,$3, now())",
        [purchaseId, tenantId, pack.id]
      );
      const accountId = await killbill.ensureAccount(tenantId, tenantRows[0].business_name);
      const paymentMethodId = await killbill.ensurePaymentMethod(accountId, tenantId);
      await killbill.createPurchasePayment(
        accountId,
        paymentMethodId,
        pack.price_cents,
        `pack-${purchaseId}`
      );
      // The movement is written only after Kill Bill has recorded the payment.
      await client.query(
        "INSERT INTO hour_ledger_entries (id, movement_id, tenant_id, account, minutes, reason, booking_id, created_at) VALUES ($1,$2,$3,'tenant_pack',$4,'pack_purchase',NULL, now())",
        [uuid(), purchaseId, tenantId, pack.minutes]
      );
      await client.query(
        "INSERT INTO hour_ledger_entries (id, movement_id, tenant_id, account, minutes, reason, booking_id, created_at) VALUES ($1,$2,$3,'kitchen_hours',$4,'pack_purchase',NULL, now())",
        [uuid(), purchaseId, tenantId, -pack.minutes]
      );
    });
    await rc.db.audit(user.id, "purchase_hour_pack", "purchase", purchaseId, {
      pack_id: pack.id,
      price_cents: pack.price_cents
    });
    const balance = await rc.db.query<{ balance: string }>(
      "SELECT coalesce(sum(minutes),0)::text AS balance FROM hour_ledger_entries WHERE tenant_id = $1 AND account = 'tenant_pack'",
      [tenantId]
    );
    return json(201, {
      purchase_id: purchaseId,
      pack_id: pack.id,
      minutes: pack.minutes,
      price_cents: pack.price_cents,
      balance_minutes: Number(balance[0].balance)
    });
  });

  app.route("GET", "/api/hour-ledger", "signed_in", async (rc: RouteContext) => {
    const user: UserRow = await requireUser(rc);
    let tenantId: string;
    if (user.role === "operator") {
      tenantId = rc.ctx.url.searchParams.get("tenant_id") ?? "";
      if (tenantId === "") {
        throw validation({ tenant_id: "Choose the tenant to read." });
      }
    } else {
      tenantId = user.tenant_id as string;
    }
    const exists = await rc.db.query<{ id: string }>("SELECT id FROM tenants WHERE id = $1", [tenantId]);
    if (exists.length === 0 || (user.tenant_id !== null && tenantId !== user.tenant_id)) {
      throw err(404, "not_found", "That record isn't available.");
    }
    const entries = await rc.db.query<{
      id: string;
      movement_id: string;
      account: "tenant_pack" | "kitchen_hours";
      minutes: number;
      reason: string;
      booking_id: string | null;
      created_at: Date;
    }>(
      "SELECT id, movement_id, account, minutes, reason, booking_id, created_at FROM hour_ledger_entries WHERE tenant_id = $1 ORDER BY created_at, id",
      [tenantId]
    );
    const balance = await rc.db.query<{ balance: string }>(
      "SELECT coalesce(sum(minutes),0)::text AS balance FROM hour_ledger_entries WHERE tenant_id = $1 AND account = 'tenant_pack'",
      [tenantId]
    );
    const clock = rc.db.clock;
    return json(200, {
      tenant_id: tenantId,
      balance_minutes: Number(balance[0].balance),
      entries: entries.map((e) => ({
        id: e.id,
        movement_id: e.movement_id,
        account: e.account,
        minutes: e.minutes,
        reason: e.reason,
        booking_id: e.booking_id,
        created_at: clock.isoOf(e.created_at.getTime())
      }))
    });
  });
}
