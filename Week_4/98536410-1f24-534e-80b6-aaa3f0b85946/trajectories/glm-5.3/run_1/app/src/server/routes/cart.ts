import { Router, type Request, type Response } from "express";
import type { PoolClient } from "pg";
import { errors } from "../api-errors.js";
import type { AppLocals, StoreRecord } from "../auth-types.js";
import { loadStoreRecord } from "./stores.js";
import { localDateInZone, planForDate } from "../time-slots.js";
import { distanceKm } from "../../shared/ranking.js";
import { lineTotalCents, vatCents } from "../../shared/money.js";

export interface CartLineRecord {
  sku: string;
  name: string;
  quantity: number;
  unit_price_milli: number;
}

export interface HoldRecord {
  id: string;
  person_id: string;
  store_id: string;
  status: string;
  created_at: Date;
  expires_at: Date;
  released_at: Date | null;
  release_reason: string | null;
  lines: { sku: string; quantity: number }[];
}

export async function loadActiveHold(client: PoolClient, personId: string): Promise<HoldRecord | null> {
  const result = await client.query<{ id: string; person_id: string; store_id: string; status: string; created_at: Date; expires_at: Date; released_at: Date | null; release_reason: string | null; lines: { sku: string; quantity: number }[] | null }>(
    `SELECT h.id, h.person_id, h.store_id, h.status, h.created_at, h.expires_at, h.released_at, h.release_reason,
            (SELECT json_agg(json_build_object('sku', hl.sku, 'quantity', hl.quantity) ORDER BY hl.sku) FROM hold_lines hl WHERE hl.hold_id = h.id) AS lines
       FROM holds h WHERE h.person_id = $1 AND h.status = 'active' LIMIT 1`,
    [personId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { ...row, lines: row.lines ?? [] };
}

export async function loadHoldById(client: PoolClient, holdId: string, personId: string): Promise<HoldRecord | null> {
  const result = await client.query<{ id: string; person_id: string; store_id: string; status: string; created_at: Date; expires_at: Date; released_at: Date | null; release_reason: string | null; lines: { sku: string; quantity: number }[] | null }>(
    `SELECT h.id, h.person_id, h.store_id, h.status, h.created_at, h.expires_at, h.released_at, h.release_reason,
            (SELECT json_agg(json_build_object('sku', hl.sku, 'quantity', hl.quantity) ORDER BY hl.sku) FROM hold_lines hl WHERE hl.hold_id = h.id) AS lines
       FROM holds h WHERE h.id = $1`,
    [holdId],
  );
  const row = result.rows[0];
  if (!row || row.person_id !== personId) return null;
  return { ...row, lines: row.lines ?? [] };
}

export async function releaseHold(client: PoolClient, hold: HoldRecord, reason: string, now: Date): Promise<void> {
  const update = await client.query<{ id: string }>(
    "UPDATE holds SET status = 'released', released_at = $2, release_reason = $3 WHERE id = $1 AND status = 'active' RETURNING id",
    [hold.id, now, reason],
  );
  if (update.rows.length === 0) return;
  const lines = await client.query<{ sku: string; quantity: number }>("SELECT sku, quantity FROM hold_lines WHERE hold_id = $1", [hold.id]);
  for (const line of lines.rows) {
    await client.query(
      "UPDATE stock_lines SET held = held - $1 WHERE store_id = $2 AND sku = $3 AND held >= $1",
      [line.quantity, hold.store_id, line.sku],
    );
  }
}

export async function releaseExpiredHolds(client: PoolClient, now: Date): Promise<void> {
  const rows = await client.query<{ id: string; person_id: string }>(
    "SELECT id, person_id FROM holds WHERE status = 'active' AND expires_at <= $1",
    [now],
  );
  for (const row of rows.rows) {
    const hold = await loadHoldById(client, row.id, row.person_id);
    if (hold) await releaseHold(client, hold, "window ended", now);
  }
}

export function holdAnswer(hold: HoldRecord, now: Date): Record<string, unknown> {
  const secondsLeft = Math.max(0, Math.ceil((hold.expires_at.getTime() - now.getTime()) / 1000));
  return {
    id: hold.id,
    status: hold.status,
    store_id: hold.store_id,
    lines: hold.lines,
    created_at: hold.created_at.toISOString(),
    expires_at: hold.expires_at.toISOString(),
    seconds_left: secondsLeft,
    released_at: hold.released_at === null ? null : hold.released_at.toISOString(),
  };
}

export async function cartAnswer(client: PoolClient, personId: string, operatorId: string, now: Date): Promise<Record<string, unknown>> {
  const cart = await client.query<{ store_id: string | null; area_lat: number | null; area_lon: number | null }>(
    "SELECT store_id, area_lat, area_lon FROM carts WHERE person_id = $1",
    [personId],
  );
  const lines = await client.query<CartLineRecord & { sku: string }>(
    `SELECT c.sku, p.name, c.quantity, p.unit_price_milli
       FROM cart_lines c JOIN products p ON p.operator_id = $2 AND p.sku = c.sku
      WHERE c.person_id = $1 ORDER BY c.sku`,
    [personId, operatorId],
  );
  const storeId = cart.rows[0]?.store_id ?? null;
  const area = cart.rows[0] && cart.rows[0].area_lat !== null ? { lat: cart.rows[0].area_lat, lon: cart.rows[0].area_lon } : null;
  let store: StoreRecord | null = null;
  if (storeId) {
    store = await loadStoreRecord(client, storeId, operatorId);
  }
  const hold = await loadActiveHold(client, personId);
  const holdLines = new Map<string, number>();
  if (hold) {
    for (const line of hold.lines) holdLines.set(line.sku, line.quantity);
  }
  const stockBySku = new Map<string, { on_hand: number; held: number }>();
  if (store) {
    const stock = await client.query<{ sku: string; on_hand: number; held: number }>("SELECT sku, on_hand, held FROM stock_lines WHERE store_id = $1", [store.id]);
    for (const row of stock.rows) stockBySku.set(row.sku, { on_hand: row.on_hand, held: row.held });
  }
  const vatRate = store ? (store.timezone === "Atlantic/Azores" ? 16 : 23) : null;
  let totalCents = 0;
  let totalVat = 0;
  let units = 0;
  const lineAnswers = lines.rows.map((row) => {
    const lineTotal = lineTotalCents(row.quantity, row.unit_price_milli);
    const vat = vatRate === null ? null : vatCents(lineTotal, vatRate);
    let available: number | null = null;
    let status: "ok" | "short" = "ok";
    if (store) {
      const stock = stockBySku.get(row.sku);
      const availableUnits = (stock ? stock.on_hand - stock.held : 0) + (holdLines.get(row.sku) ?? 0);
      available = availableUnits;
      status = availableUnits < row.quantity ? "short" : "ok";
    }
    if (status === "ok") {
      totalCents += lineTotal;
      units += row.quantity;
      if (vat !== null) totalVat += vat;
    }
    return {
      sku: row.sku,
      name: row.name,
      quantity: row.quantity,
      unit_price_milli: row.unit_price_milli,
      line_total_cents: lineTotal,
      vat_cents: vat,
      available,
      status,
    };
  });
  return {
    store_id: store ? store.id : null,
    store_name: store ? store.name : null,
    area,
    lines: lineAnswers,
    total_cents: totalCents,
    vat_cents: vatRate === null ? null : totalVat,
    units,
    hold: hold ? holdAnswer(hold, now) : null,
  };
}

export async function cartShopsAnswer(client: PoolClient, personId: string, operatorId: string): Promise<Record<string, unknown> | { error: "area" }> {
  const cart = await client.query<{ area_lat: number | null; area_lon: number | null; store_id: string | null }>(
    "SELECT area_lat, area_lon, store_id FROM carts WHERE person_id = $1",
    [personId],
  );
  const row = cart.rows[0];
  if (!row || row.area_lat === null || row.area_lon === null) {
    return { error: "area" };
  }
  const lines = await client.query<{ sku: string }>(
    "SELECT sku FROM cart_lines WHERE person_id = $1 ORDER BY sku",
    [personId],
  );
  const stores = await client.query<StoreRecord>(
    "SELECT id, operator_id, name, city, region, lat, lon, timezone, suspended, suspension_reason FROM stores WHERE operator_id = $1",
    [operatorId],
  );
  const ranked = stores.rows.map((store) => {
    const distance = distanceKm(row.area_lat as number, row.area_lon as number, store.lat, store.lon);
    return { store, distance };
  });
  const withUnits = await Promise.all(
    ranked.map(async (entry) => {
      let onHandSum = 0;
      for (const line of lines.rows) {
        const stock = await client.query<{ on_hand: number }>("SELECT on_hand FROM stock_lines WHERE store_id = $1 AND sku = $2", [entry.store.id, line.sku]);
        onHandSum += stock.rows[0]?.on_hand ?? 0;
      }
      const complete = await shopComplete(client, entry.store, lines.rows.map((l) => l.sku));
      return { store: entry.store, distance: entry.distance, onHandSum, complete };
    }),
  );
  withUnits.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    if (a.onHandSum !== b.onHandSum) return b.onHandSum - a.onHandSum;
    return a.store.id < b.store.id ? -1 : 1;
  });
  return {
    shops: withUnits.map((entry, index) => ({
      store_id: entry.store.id,
      name: entry.store.name,
      distance_km: entry.distance,
      complete: entry.complete,
      rank: index + 1,
    })),
  };
}

async function shopComplete(client: PoolClient, store: StoreRecord, skus: string[]): Promise<boolean> {
  for (const sku of skus) {
    const stock = await client.query<{ on_hand: number; held: number }>(
      "SELECT on_hand, held FROM stock_lines WHERE store_id = $1 AND sku = $2",
      [store.id, sku],
    );
    const row = stock.rows[0];
    if (!row || row.on_hand - row.held <= 0) return false;
  }
  return true;
}

export function holdsRouter(): Router {
  const router = Router();

  router.post("/holds", async (req, res, next) => {
    try {
      const { db, cfg } = res.locals as unknown as AppLocals;
      const auth = req.auth;
      if (!auth) {
        next(errors.unauthenticated());
        return;
      }
      if (auth.user.role !== "shopper") {
        next(errors.forbidden());
        return;
      }
      const now = new Date();
      const result = await db.withClient(async (client) => {
        await client.query("BEGIN");
        try {
          await releaseExpiredHolds(client, now);
          const existing = await loadActiveHold(client, auth.user.id);
          if (existing) {
            await client.query("ROLLBACK");
            return { conflict: errors.conflict("hold_active", { hold_id: existing.id }) };
          }
          const cart = await client.query<{ store_id: string | null }>("SELECT store_id FROM carts WHERE person_id = $1 FOR UPDATE", [auth.user.id]);
          const storeId = cart.rows[0]?.store_id ?? null;
          if (!storeId) {
            await client.query("ROLLBACK");
            return { conflict: errors.validationFailed({ store_id: "Choose a shop first." }) };
          }
          const store = await loadStoreRecord(client, storeId, auth.user.operatorId);
          if (!store) {
            await client.query("ROLLBACK");
            return { notFound: true };
          }
          const lines = await client.query<{ sku: string; quantity: number }>(
            "SELECT sku, quantity FROM cart_lines WHERE person_id = $1 ORDER BY sku",
            [auth.user.id],
          );
          if (lines.rows.length === 0) {
            await client.query("ROLLBACK");
            return { conflict: errors.validationFailed({ cart: "Your cart is empty." }) };
          }
          if (store.suspended) {
            await client.query("ROLLBACK");
            return { conflict: errors.conflict("store_suspended", { store_id: store.id }) };
          }
          for (const line of lines.rows) {
            const stock = await client.query<{ on_hand: number; held: number }>(
              "SELECT on_hand, held FROM stock_lines WHERE store_id = $1 AND sku = $2 FOR UPDATE",
              [store.id, line.sku],
            );
            const row = stock.rows[0];
            const available = row ? row.on_hand - row.held : 0;
            if (available < line.quantity) {
              await client.query("ROLLBACK");
              return { conflict: errors.conflict("stock_conflict", { store_id: store.id, sku: line.sku, remaining: available }) };
            }
          }
          const holdId = crypto.randomUUID();
          const expiresAt = new Date(now.getTime() + cfg.hold_seconds * 1000);
          await client.query(
            "INSERT INTO holds (id, person_id, store_id, status, created_at, expires_at) VALUES ($1,$2,$3,'active',$4,$5)",
            [holdId, auth.user.id, store.id, now, expiresAt],
          );
          for (const line of lines.rows) {
            await client.query("INSERT INTO hold_lines (hold_id, sku, quantity) VALUES ($1,$2,$3)", [holdId, line.sku, line.quantity]);
            await client.query("UPDATE stock_lines SET held = held + $1 WHERE store_id = $2 AND sku = $3", [line.quantity, store.id, line.sku]);
          }
          await client.query("COMMIT");
          const hold = await db.withClient(async (client2) => loadHoldById(client2, holdId, auth.user.id));
          return { hold };
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        }
      });
      if ("notFound" in result && result.notFound) {
        next(errors.notFound());
        return;
      }
      if ("conflict" in result && result.conflict) {
        next(result.conflict);
        return;
      }
      if (!result.hold) {
        next(errors.notFound());
        return;
      }
      res.status(201).json(holdAnswer(result.hold, new Date()));
    } catch (err) {
      next(err);
    }
  });

  router.get("/holds/:id", async (req, res, next) => {
    try {
      const { db } = res.locals as unknown as AppLocals;
      const auth = req.auth;
      if (!auth) {
        next(errors.unauthenticated());
        return;
      }
      const now = new Date();
      const hold = await db.withClient(async (client) => {
        const record = await loadHoldById(client, req.params.id, auth.user.id);
        if (!record) return null;
        if (record.status === "active" && record.expires_at.getTime() <= now.getTime()) {
          await client.query("BEGIN");
          await releaseHold(client, record, "window ended", now);
          await client.query("COMMIT");
          return await loadHoldById(client, req.params.id, auth.user.id);
        }
        return record;
      });
      if (!hold) {
        next(errors.notFound());
        return;
      }
      res.json(holdAnswer(hold, now));
    } catch (err) {
      next(err);
    }
  });

  router.delete("/holds/:id", async (req, res, next) => {
    try {
      const { db } = res.locals as unknown as AppLocals;
      const auth = req.auth;
      if (!auth) {
        next(errors.unauthenticated());
        return;
      }
      const now = new Date();
      const hold = await db.withClient(async (client) => {
        await client.query("BEGIN");
        const record = await loadHoldById(client, req.params.id, auth.user.id);
        if (!record) {
          await client.query("COMMIT");
          return null;
        }
        if (record.status !== "active") {
          await client.query("COMMIT");
          return { invalid: true, record };
        }
        await releaseHold(client, record, "delete", now);
        await client.query("COMMIT");
        return { record: await loadHoldById(client, req.params.id, auth.user.id) };
      });
      if (!hold) {
        next(errors.notFound());
        return;
      }
      if ("invalid" in hold) {
        const record = hold.record as HoldRecord;
        next(errors.invalidTransition(record.status, "released"));
        return;
      }
      const released = await db.withClient(async (client) => loadHoldById(client, req.params.id, auth.user.id));
      if (!released) {
        next(errors.notFound());
        return;
      }
      res.json(holdAnswer(released, now));
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export function cartRouter(): Router {
  const router = Router();

  const shopperOnly = (req: Request, res: Response, next: (err: unknown) => void): void => {
    const auth = req.auth;
    if (!auth) {
      next(errors.unauthenticated());
      return;
    }
    if (auth.user.role !== "shopper") {
      next(errors.forbidden());
      return;
    }
    next(undefined);
  };

  router.use("/cart", (req, res, next) => shopperOnly(req, res, next));

  router.get("/cart", async (req, res, next) => {
    try {
      const { db } = res.locals as unknown as AppLocals;
      const auth = req.auth;
      if (!auth) {
        next(errors.unauthenticated());
        return;
      }
      const answer = await db.withClient(async (client) => {
        await releaseExpiredHolds(client, new Date());
        return cartAnswer(client, auth.user.id, auth.user.operatorId, new Date());
      });
      res.json(answer);
    } catch (err) {
      next(err);
    }
  });

  router.put("/cart/lines/:sku", async (req, res, next) => {
    try {
      const { db } = res.locals as unknown as AppLocals;
      const auth = req.auth;
      if (!auth) {
        next(errors.unauthenticated());
        return;
      }
      const quantity = (req.body as { quantity?: unknown }).quantity;
      if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 0 || quantity > 999) {
        next(errors.validationFailed({ quantity: "Enter a whole number from 0 to 999." }));
        return;
      }
      const answer = await db.withClient(async (client) => {
        await client.query("BEGIN");
        await releaseExpiredHolds(client, new Date());
        const hold = await loadActiveHold(client, auth.user.id);
        if (hold) await releaseHold(client, hold, "cart change", new Date());
        const product = await client.query<{ sku: string }>(
          "SELECT sku FROM products WHERE operator_id = $1 AND sku = $2",
          [auth.user.operatorId, req.params.sku],
        );
        if (product.rows.length === 0) {
          await client.query("COMMIT");
          return { notFound: true };
        }
        if (quantity === 0) {
          await client.query("DELETE FROM cart_lines WHERE person_id = $1 AND sku = $2", [auth.user.id, req.params.sku]);
        } else {
          await client.query(
            `INSERT INTO cart_lines (person_id, sku, quantity) VALUES ($1,$2,$3)
             ON CONFLICT (person_id, sku) DO UPDATE SET quantity = EXCLUDED.quantity`,
            [auth.user.id, req.params.sku, quantity],
          );
        }
        const count = await client.query<{ count: string }>("SELECT count(*) as count FROM cart_lines WHERE person_id = $1", [auth.user.id]);
        if (Number(count.rows[0].count) > 20) {
          await client.query("ROLLBACK");
          return { validation: errors.validationFailed({ lines: "A cart holds at most 20 lines." }) };
        }
        await client.query("COMMIT");
        return {};
      });
      if ("notFound" in answer && answer.notFound) {
        next(errors.notFound());
        return;
      }
      if ("validation" in answer && answer.validation) {
        next(answer.validation);
        return;
      }
      const cart = await db.withClient(async (client) => cartAnswer(client, auth.user.id, auth.user.operatorId, new Date()));
      res.json(cart);
    } catch (err) {
      next(err);
    }
  });

  router.put("/cart/store", async (req, res, next) => {
    try {
      const { db } = res.locals as unknown as AppLocals;
      const auth = req.auth;
      if (!auth) {
        next(errors.unauthenticated());
        return;
      }
      const storeId = (req.body as { store_id?: unknown }).store_id;
      if (typeof storeId !== "string") {
        next(errors.validationFailed({ store_id: "Choose a shop." }));
        return;
      }
      const answer = await db.withClient(async (client) => {
        await client.query("BEGIN");
        await releaseExpiredHolds(client, new Date());
        const hold = await loadActiveHold(client, auth.user.id);
        if (hold) await releaseHold(client, hold, "cart change", new Date());
        const store = await loadStoreRecord(client, storeId, auth.user.operatorId);
        if (!store) {
          await client.query("COMMIT");
          return { notFound: true };
        }
        await client.query("UPDATE carts SET store_id = $1 WHERE person_id = $2", [store.id, auth.user.id]);
        await client.query("COMMIT");
        return {};
      });
      if ("notFound" in answer && answer.notFound) {
        next(errors.notFound());
        return;
      }
      const cart = await db.withClient(async (client) => cartAnswer(client, auth.user.id, auth.user.operatorId, new Date()));
      res.json(cart);
    } catch (err) {
      next(err);
    }
  });

  router.put("/cart/area", async (req, res, next) => {
    try {
      const { db } = res.locals as unknown as AppLocals;
      const auth = req.auth;
      if (!auth) {
        next(errors.unauthenticated());
        return;
      }
      const body = req.body as { lat?: unknown; lon?: unknown };
      if (
        typeof body.lat !== "number" ||
        typeof body.lon !== "number" ||
        !Number.isFinite(body.lat) ||
        !Number.isFinite(body.lon) ||
        body.lat < -90 ||
        body.lat > 90 ||
        body.lon < -180 ||
        body.lon > 180
      ) {
        next(errors.validationFailed({ lat: "Pick a point on the map.", lon: "Pick a point on the map." }));
        return;
      }
      await db.withClient(async (client) => {
        await client.query("UPDATE carts SET area_lat = $1, area_lon = $2 WHERE person_id = $3", [body.lat as number, body.lon as number, auth.user.id]);
      });
      const cart = await db.withClient(async (client) => cartAnswer(client, auth.user.id, auth.user.operatorId, new Date()));
      res.json(cart);
    } catch (err) {
      next(err);
    }
  });

  router.get("/cart/shops", async (req, res, next) => {
    try {
      const { db } = res.locals as unknown as AppLocals;
      const auth = req.auth;
      if (!auth) {
        next(errors.unauthenticated());
        return;
      }
      const answer = await db.withClient(async (client) => cartShopsAnswer(client, auth.user.id, auth.user.operatorId));
      if ("error" in answer) {
        next(errors.validationFailed({ area: "Choose your area first." }));
        return;
      }
      res.json(answer);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export { loadStoreRecord, localDateInZone, planForDate };
