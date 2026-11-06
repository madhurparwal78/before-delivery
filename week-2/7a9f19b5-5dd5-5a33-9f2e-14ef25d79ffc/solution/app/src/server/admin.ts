// Admin-only routes. The router has already refused every non-admin on /api/admin/ (403 forbidden).
import type { ServiceHealth, StockItem, StockMovement, TradeApplication, TradeStatus } from "../shared/types.js";
import { HEALTH_TIMEOUT_MS } from "./config.js";
import { isClearance, variantByCode, variantRows, type VariantRow } from "./catalogue.js";
import { pool, transaction, type Queryable } from "./db.js";
import { apiError, invalidState, notFound } from "./errors.js";
import { Fields } from "./fields.js";
import { json, type Route } from "./http.js";
import * as killbill from "./killbill.js";
import * as mail from "./mail.js";
import * as pocketbase from "./pocketbase.js";
import * as storage from "./storage.js";
import { onHand } from "./stock.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ApplicationRow extends Omit<TradeApplication, "submitted_at" | "decided_at"> {
  user_id: string;
  submitted_at: Date;
  decided_at: Date | null;
}

const APPLICATION_SELECT = `
  SELECT a.id, a.user_id, u.name AS applicant_name, u.email AS applicant_email, a.business_name, a.nzbn, a.occupation,
         a.status, a.submitted_at, a.decided_at, a.decline_reason
  FROM trade_applications a JOIN users u ON u.id = a.user_id`;

function application(row: ApplicationRow): TradeApplication {
  const { user_id: _user, ...rest } = row;
  return { ...rest, submitted_at: row.submitted_at.toISOString(), decided_at: row.decided_at?.toISOString() ?? null };
}

/** Approve or decline; either decision is final. The applicant gets one email with the outcome. */
async function decide(id: string, status: Exclude<TradeStatus, "submitted">, reason: string | null) {
  if (!UUID.test(id)) throw notFound();
  const decided = await transaction(async (client) => {
    const found = await client.query<ApplicationRow>(`${APPLICATION_SELECT} WHERE a.id = $1 FOR UPDATE OF a`, [id]);
    const row = found.rows[0];
    if (!row) throw notFound();
    if (row.status !== "submitted") throw invalidState(row.status);
    await client.query(
      "UPDATE trade_applications SET status = $2, decided_at = now(), decline_reason = $3 WHERE id = $1",
      [id, status, reason],
    );
    await client.query("UPDATE users SET trade_status = $2 WHERE id = $1", [row.user_id, status]);
    return (await client.query<ApplicationRow>(`${APPLICATION_SELECT} WHERE a.id = $1`, [id])).rows[0]!;
  });
  mail.sendInBackground(
    mail.tradeDecisionMail({
      to: decided.applicant_email,
      name: decided.applicant_name,
      approved: status === "approved",
      reason,
    }),
  );
  return json(200, { application: application(decided) });
}

async function stockItem(db: Queryable, variant: VariantRow): Promise<StockItem> {
  const movements = await db.query<StockMovement & { created_at: Date }>(
    "SELECT delta, reason, order_key, note, created_at FROM stock_movements WHERE variant_code = $1 ORDER BY id",
    [variant.code],
  );
  return {
    variant_code: variant.code,
    product_name: variant.product_name,
    clearance_price_cents: variant.clearance_price_cents,
    stock_on_hand: movements.rows.reduce((sum, m) => sum + m.delta, 0),
    movements: movements.rows.map((m) => ({ ...m, created_at: m.created_at.toISOString() })),
  };
}

async function postgresHealthy(): Promise<boolean> {
  try {
    await Promise.race([
      pool.query("SELECT 1"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), HEALTH_TIMEOUT_MS)),
    ]);
    return true;
  } catch {
    return false;
  }
}

export const adminRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/admin/trade-applications",
    access: "user",
    async handler({ url }) {
      const status = url.searchParams.get("status");
      if (status?.includes("\u0000")) return json(200, { applications: [] });
      const rows = await pool.query<ApplicationRow>(
        `${APPLICATION_SELECT} WHERE ($1::text IS NULL OR a.status = $1) ORDER BY a.submitted_at DESC`,
        [status || null],
      );
      return json(200, { applications: rows.rows.map(application) });
    },
  },
  {
    method: "POST",
    path: "/api/admin/trade-applications/:id/approve",
    access: "user",
    handler: ({ params }) => decide(params.id!, "approved", null),
  },
  {
    method: "POST",
    path: "/api/admin/trade-applications/:id/decline",
    access: "user",
    async handler({ params, body }) {
      const fields = new Fields(body);
      const reason = fields.text("reason", { max: 500 });
      fields.done();
      return decide(params.id!, "declined", reason);
    },
  },
  {
    method: "GET",
    path: "/api/admin/stock",
    access: "user",
    async handler() {
      const clearance = (await variantRows()).filter(isClearance);
      return json(200, { items: await Promise.all(clearance.map((variant) => stockItem(pool, variant))) });
    },
  },
  {
    method: "PATCH",
    path: "/api/admin/variants/:code",
    access: "user",
    async handler({ params, body }) {
      const item = await transaction(async (client) => {
        const locked = await client.query("SELECT 1 FROM variants WHERE code = $1 FOR UPDATE", [params.code]);
        if (!locked.rowCount) throw notFound();
        const fields = new Fields(body);
        const adjust = fields.optionalInt("stock_adjust", { min: -100_000, max: 100_000 });
        const note = fields.optionalText("note", 200);
        const endsClearance = "clearance_price_cents" in body && body.clearance_price_cents === null;
        const price = endsClearance ? null : fields.optionalInt("clearance_price_cents", { min: 1, max: 100_000_000 });
        const variant = (await variantByCode(params.code!, client))!;
        if (adjust !== null && !isClearance(variant) && price === null) fields.fail("stock_adjust", "invalid");
        if (adjust !== null && adjust !== 0 && (await onHand(client, variant.code)) + adjust < 0) {
          throw apiError(409, "stock_below_zero");
        }
        fields.done();
        if (price !== null || endsClearance) {
          await client.query("UPDATE variants SET clearance_price_cents = $2 WHERE code = $1", [variant.code, price]);
        }
        if (adjust) {
          await client.query(
            "INSERT INTO stock_movements (variant_code, delta, reason, note) VALUES ($1, $2, 'adjust', $3)",
            [variant.code, adjust, note],
          );
        }
        return stockItem(client, (await variantByCode(variant.code, client))!);
      });
      return json(200, { item });
    },
  },
  {
    method: "GET",
    path: "/api/admin/health",
    access: "user",
    async handler() {
      const [postgres, kb, mailpit, minio, pb] = await Promise.all([
        postgresHealthy(),
        killbill.healthy(HEALTH_TIMEOUT_MS),
        mail.healthy(HEALTH_TIMEOUT_MS),
        storage.healthy(HEALTH_TIMEOUT_MS),
        pocketbase.healthy(HEALTH_TIMEOUT_MS),
      ]);
      const state = (up: boolean): "up" | "down" => (up ? "up" : "down");
      const services: ServiceHealth = {
        postgres: state(postgres),
        killbill: state(kb),
        mailpit: state(mailpit),
        minio: state(minio),
        pocketbase: state(pb),
      };
      return json(200, { services });
    },
  },
];
