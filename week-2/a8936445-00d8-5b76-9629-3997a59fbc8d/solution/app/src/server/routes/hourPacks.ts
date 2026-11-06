// Hour packs and the hour ledger (brief: Hour packs, Hour ledger).
import { randomUUID } from "node:crypto";
import type { HourPack, LedgerEntry } from "../../shared/api";
import type { LedgerAccount, LedgerReason } from "../../shared/kitchen";
import { kitchenIso } from "../../shared/time";
import { audit, one, pool, rows, transaction } from "../db";
import { validation } from "../errors";
import { route } from "../http";
import * as killbill from "../killbill";
import { recordMovement } from "../ledger";
import { hourBalance, loadTenant, tenantRows } from "../records";

interface EntryRow {
  id: string;
  movement_id: string;
  account: LedgerAccount;
  minutes: number;
  reason: LedgerReason;
  booking_id: string | null;
  created_at: Date;
}

export const hourPackRoutes = [
  route({
    method: "GET",
    path: "/api/hour-packs",
    roles: ["operator", "owner"],
    async handle() {
      const packs = await rows<HourPack>(pool, "SELECT id, name, minutes, price_cents FROM hour_packs ORDER BY position");
      return { status: 200, json: { packs } };
    },
  }),
  route({
    method: "POST",
    path: "/api/hour-packs/purchase",
    roles: ["owner"],
    body: "json",
    idempotent: true,
    async handle(ctx) {
      const pack = typeof ctx.json.pack_id === "string" ? await one<HourPack>(pool, "SELECT id, name, minutes, price_cents FROM hour_packs WHERE id = $1", [ctx.json.pack_id]) : undefined;
      if (!pack) throw validation({ pack_id: "Choose an hour pack." });
      const [tenant] = await tenantRows(pool, ctx.user.tenant_id as string);
      const purchaseId = randomUUID();
      // The payment is recorded in Kill Bill before any hours appear.
      await killbill.purchase(await killbill.accountFor(tenant), pack.price_cents, `pack-${purchaseId}`);
      const balance = await transaction(async (db) => {
        const at = new Date(ctx.nowMs);
        await db.query("INSERT INTO hour_purchases (id, tenant_id, pack_id, minutes, price_cents, created_at) VALUES ($1, $2, $3, $4, $5, $6)", [
          purchaseId,
          tenant.id,
          pack.id,
          pack.minutes,
          pack.price_cents,
          at,
        ]);
        await recordMovement(db, tenant.id, pack.minutes, "pack_purchase", null, at);
        await audit(db, ctx.user.id, "hour_purchase", purchaseId, "purchased", { pack_id: pack.id });
        return hourBalance(db, tenant.id);
      });
      return {
        status: 201,
        json: { purchase_id: purchaseId, pack_id: pack.id, minutes: pack.minutes, price_cents: pack.price_cents, balance_minutes: balance },
      };
    },
  }),
  route({
    method: "GET",
    path: "/api/hour-ledger",
    roles: ["operator", "owner"],
    async handle(ctx) {
      let tenantId = ctx.user.tenant_id;
      if (ctx.user.role === "operator") {
        const requested = ctx.query.get("tenant_id");
        if (!requested) throw validation({ tenant_id: "Choose a tenant." });
        tenantId = (await loadTenant(pool, ctx.user, requested)).id;
      }
      const entries = await rows<EntryRow>(
        pool,
        "SELECT id, movement_id, account, minutes, reason, booking_id, created_at FROM ledger_entries WHERE tenant_id = $1 ORDER BY position",
        [tenantId],
      );
      return {
        status: 200,
        json: {
          tenant_id: tenantId,
          balance_minutes: await hourBalance(pool, tenantId as string),
          entries: entries.map((e): LedgerEntry => ({ ...e, created_at: kitchenIso(e.created_at.getTime()) })),
        },
      };
    },
  }),
];
