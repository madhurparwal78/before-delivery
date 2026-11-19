import { Router } from "express";
import type { PoolClient } from "pg";
import { errors } from "../api-errors.js";
import type { AppLocals, StoreRecord } from "../auth-types.js";
import { loadStoreRecord } from "./stores.js";
import { loadOrderById, loadEvents } from "./orders.js";
import { appendOrderEvent, checkChain, lastDigest } from "../history.js";
import { lineTotalCents } from "../../shared/money.js";

export function catalogueRouter(): Router {
  const router = Router();

  router.get("/products", async (req, res, next) => {
    try {
      const { db } = res.locals as unknown as AppLocals;
      const auth = req.auth;
      if (!auth) {
        next(errors.unauthenticated());
        return;
      }
      const qRaw = typeof req.query.q === "string" ? req.query.q : undefined;
      if (qRaw !== undefined && qRaw.trim().length > 100) {
        next(errors.validationFailed({ q: "q must be at most 100 characters" }));
        return;
      }
      const rows = await db.withClient(async (client) => {
        const result = await client.query<{ sku: string; name: string; unit_price_milli: number }>(
          "SELECT sku, name, unit_price_milli FROM products WHERE operator_id = $1 ORDER BY sku",
          [auth.user.operatorId],
        );
        return result.rows;
      });
      const q = (qRaw ?? "").trim().toLowerCase();
      const normalize = (value: string): string => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const filtered = q === "" ? rows : rows.filter((row) => normalize(`${row.name} ${row.sku}`).includes(normalize(q)));
      res.json({ count: filtered.length, products: filtered });
    } catch (err) {
      next(err);
    }
  });

  router.get("/products/:sku", async (req, res, next) => {
    try {
      const { db } = res.locals as unknown as AppLocals;
      const auth = req.auth;
      if (!auth) {
        next(errors.unauthenticated());
        return;
      }
      const row = await db.withClient(async (client) => {
        const result = await client.query<{ sku: string; name: string; unit_price_milli: number }>(
          "SELECT sku, name, unit_price_milli FROM products WHERE operator_id = $1 AND sku = $2",
          [auth.user.operatorId, req.params.sku],
        );
        return result.rows[0] ?? null;
      });
      if (!row) {
        next(errors.notFound());
        return;
      }
      res.json(row);
    } catch (err) {
      next(err);
    }
  });

  router.get("/products/:sku/availability", async (req, res, next) => {
    try {
      const { db } = res.locals as unknown as AppLocals;
      const auth = req.auth;
      if (!auth) {
        next(errors.unauthenticated());
        return;
      }
      const lat = Number(req.query.lat);
      const lon = Number(req.query.lon);
      if (req.query.lat === undefined || req.query.lon === undefined || !Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        next(errors.validationFailed({ lat: "Give a point between -90 and 90.", lon: "Give a point between -180 and 180." }));
        return;
      }
      const answer = await db.withClient(async (client) => {
        const product = await client.query<{ sku: string; name: string }>(
          "SELECT sku, name FROM products WHERE operator_id = $1 AND sku = $2",
          [auth.user.operatorId, req.params.sku],
        );
        if (product.rows.length === 0) return null;
        const stores = await client.query<StoreRecord & { on_hand: number; held: number }>(
          `SELECT st.id, st.operator_id, st.name, st.city, st.region, st.lat, st.lon, st.timezone, st.suspended, st.suspension_reason,
                  COALESCE(s.on_hand, 0) as on_hand, COALESCE(s.held, 0) as held
             FROM stores st LEFT JOIN stock_lines s ON s.store_id = st.id AND s.sku = $2
            WHERE st.operator_id = $1`,
          [auth.user.operatorId, req.params.sku],
        );
        return stores.rows;
      });
      if (answer === null) {
        next(errors.notFound());
        return;
      }
      const { distanceKm } = await import("../../shared/ranking.js");
      const ranked = answer
        .map((store) => ({
          store_id: store.id,
          name: store.name,
          city: store.city,
          distance_km: distanceKm(lat, lon, store.lat, store.lon),
          on_hand: store.on_hand,
          held: store.held,
          available: store.on_hand - store.held,
          suspended: store.suspended,
        }))
        .sort((a, b) => {
          if (a.distance_km !== b.distance_km) return a.distance_km - b.distance_km;
          if (a.on_hand !== b.on_hand) return b.on_hand - a.on_hand;
          return a.store_id < b.store_id ? -1 : 1;
        })
        .map((entry) => ({
          store_id: entry.store_id,
          name: entry.name,
          city: entry.city,
          distance_km: entry.distance_km,
          on_hand: entry.on_hand,
          held: entry.held,
          available: entry.available,
          holdable: !entry.suspended,
        }));
      res.json({ sku: req.params.sku, lat, lon, shops: ranked });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export function stockRouter(): Router {
  const router = Router();

  router.post("/stores/:id/stock/:sku/count", async (req, res, next) => {
    try {
      const { db } = res.locals as unknown as AppLocals;
      const auth = req.auth;
      if (!auth) {
        next(errors.unauthenticated());
        return;
      }
      const onHand = (req.body as { on_hand?: unknown }).on_hand;
      if (typeof onHand !== "number" || !Number.isInteger(onHand) || onHand < 0 || onHand > 99999) {
        next(errors.validationFailed({ on_hand: "Enter a whole number from 0 to 99999." }));
        return;
      }
      const answer = await db.withClient(async (client) => {
        await client.query("BEGIN");
        const store = await loadStoreRecord(client, req.params.id, auth.user.operatorId);
        if (!store || !(auth.user.role === "manager" && auth.storeIds.includes(store.id))) {
          await client.query("COMMIT");
          return { notFound: true };
        }
        const stock = await client.query<{ on_hand: number; held: number }>(
          "SELECT on_hand, held FROM stock_lines WHERE store_id = $1 AND sku = $2 FOR UPDATE",
          [store.id, req.params.sku],
        );
        if (stock.rows.length === 0) {
          await client.query("COMMIT");
          return { notFound: true };
        }
        if (onHand < stock.rows[0].held) {
          await client.query("COMMIT");
          return { conflict: errors.conflict("below_held", { held: stock.rows[0].held }) };
        }
        await client.query("UPDATE stock_lines SET on_hand = $1 WHERE store_id = $2 AND sku = $3", [onHand, store.id, req.params.sku]);
        await client.query("COMMIT");
        return {
          answer: {
            sku: req.params.sku,
            on_hand: onHand,
            held: stock.rows[0].held,
            available: onHand - stock.rows[0].held,
            critical: onHand <= 2,
          },
        };
      });
      if ("notFound" in answer && answer.notFound) {
        next(errors.notFound());
        return;
      }
      if ("conflict" in answer && answer.conflict) {
        next(answer.conflict);
        return;
      }
      res.json(answer.answer);
    } catch (err) {
      next(err);
    }
  });

  router.post("/stores/:id/till-sales", async (req, res, next) => {
    try {
      const { db } = res.locals as unknown as AppLocals;
      const auth = req.auth;
      if (!auth) {
        next(errors.unauthenticated());
        return;
      }
      const requestKey = req.headers["request-key"];
      if (typeof requestKey !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(requestKey)) {
        next(errors.validationFailed({ request_key: "A request key of 8 to 64 letters, digits and hyphens is required." }));
        return;
      }
      const body = req.body as { sku?: unknown; quantity?: unknown };
      if (typeof body.sku !== "string" || typeof body.quantity !== "number" || !Number.isInteger(body.quantity) || body.quantity < 1 || body.quantity > 999) {
        next(errors.validationFailed({ sku: "Choose an item.", quantity: "Enter a whole number from 1 to 999." }));
        return;
      }
      const { requestKeyReplay, clearRequestKeyOn5xx, stableStringify } = await import("./orders.js");
      const replay = await requestKeyReplay(db, auth, "POST", `/api/stores/${req.params.id}/till-sales`, body, requestKey);
      if (replay.replayError) {
        next(replay.replayError);
        return;
      }
      if (replay.replayStatus !== null) {
        res.status(replay.replayStatus).json(replay.replayBody);
        return;
      }
      const answer = await db.withClient(async (client) => {
        await client.query("BEGIN");
        const store = await loadStoreRecord(client, req.params.id, auth.user.operatorId);
        if (!store || !(auth.user.role === "manager" && auth.storeIds.includes(store.id))) {
          await client.query("COMMIT");
          return { notFound: true };
        }
        const stock = await client.query<{ on_hand: number; held: number }>(
          "SELECT on_hand, held FROM stock_lines WHERE store_id = $1 AND sku = $2 FOR UPDATE",
          [store.id, body.sku],
        );
        if (stock.rows.length === 0) {
          await client.query("COMMIT");
          return { notFound: true };
        }
        const available = stock.rows[0].on_hand - stock.rows[0].held;
        if (available < (body.quantity as number)) {
          await storeRequestKeyInTx(client, auth, "POST", `/api/stores/${req.params.id}/till-sales`, body, requestKey, 409, {
            code: "stock_conflict",
            store_id: store.id,
            sku: body.sku,
            remaining: available,
          });
          await client.query("COMMIT");
          return { conflict: errors.conflict("stock_conflict", { store_id: store.id, sku: body.sku, remaining: available }) };
        }
        await client.query("UPDATE stock_lines SET on_hand = on_hand - $1 WHERE store_id = $2 AND sku = $3", [body.quantity, store.id, body.sku]);
        const updated = await client.query<{ on_hand: number; held: number }>(
          "SELECT on_hand, held FROM stock_lines WHERE store_id = $1 AND sku = $2",
          [store.id, body.sku],
        );
        await storeRequestKeyInTx(client, auth, "POST", `/api/stores/${req.params.id}/till-sales`, body, requestKey, 201, {
          store_id: store.id,
          sku: body.sku,
          on_hand: updated.rows[0].on_hand,
          held: updated.rows[0].held,
          available: updated.rows[0].on_hand - updated.rows[0].held,
        });
        await client.query("COMMIT");
        return {
          answer: {
            store_id: store.id,
            sku: body.sku,
            on_hand: updated.rows[0].on_hand,
            held: updated.rows[0].held,
            available: updated.rows[0].on_hand - updated.rows[0].held,
          },
        };
      });
      if ("notFound" in answer && answer.notFound) {
        await clearRequestKeyOn5xx(db, auth, requestKey);
        next(errors.notFound());
        return;
      }
      if ("conflict" in answer && answer.conflict) {
        next(answer.conflict);
        return;
      }
      res.status(201).json(answer.answer);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

async function storeRequestKeyInTx(
  client: PoolClient,
  auth: { user: { id: string; operatorId: string } },
  method: string,
  path: string,
  body: unknown,
  requestKey: string,
  status: number,
  responseBody: unknown,
): Promise<void> {
  await client.query(
    `UPDATE request_keys SET in_progress = false, response_status = $4, response_body = $5
      WHERE operator_id = $1 AND account_id = $2 AND request_key = $3`,
    [auth.user.operatorId, auth.user.id, requestKey, status, JSON.stringify(responseBody)],
  );
  void method;
  void path;
  void body;
}

export function returnsRouter(): Router {
  const router = Router();

  router.post("/orders/:id/returns", async (req, res, next) => {
    try {
      const { db } = res.locals as unknown as AppLocals;
      const auth = req.auth;
      if (!auth) {
        next(errors.unauthenticated());
        return;
      }
      const body = req.body as { lines?: { sku?: unknown; quantity?: unknown }[]; reason?: string };
      if (typeof body.reason !== "string" || body.reason.trim().length < 1 || body.reason.trim().length > 200) {
        next(errors.validationFailed({ reason: "Give a reason." }));
        return;
      }
      if (!Array.isArray(body.lines) || body.lines.length === 0) {
        next(errors.validationFailed({ lines: "Choose items to return." }));
        return;
      }
      const answer = await db.withClient(async (client) => {
        await client.query("BEGIN");
        const order = await loadOrderById(client, req.params.id);
        if (!order || order.operator_id !== auth.user.operatorId) {
          await client.query("COMMIT");
          return { notFound: true };
        }
        if (!(auth.user.role === "manager" && auth.storeIds.includes(order.store_id))) {
          await client.query("COMMIT");
          return order.person_id === auth.user.id || auth.user.role === "care" || auth.user.role === "lead" ? { forbidden: true } : { notFound: true };
        }
        if (order.status !== "collected") {
          await client.query("COMMIT");
          return { conflict: errors.invalidTransition(order.status, "returned") };
        }
        const chain = await loadEvents(client, order.id);
        const check = checkChain(chain);
        if (!check.ok) {
          await client.query("COMMIT");
          return { conflict: errors.conflict("sequence_broken", { first_bad_seq: check.firstBadSeq }) };
        }
        const lineErrors: Record<string, string> = {};
        const preparedLines: { sku: string; quantity: number; refund: number }[] = [];
        const requestLines = body.lines as { sku: string; quantity: unknown }[];
        for (const [index, line] of requestLines.entries()) {
          const row = await client.query<{ quantity: number; unit_price_milli: number; returned_quantity: number; line_total_cents: number }>(
            "SELECT quantity, unit_price_milli, returned_quantity, line_total_cents FROM order_lines WHERE order_id = $1 AND sku = $2",
            [order.id, line.sku],
          );
          if (row.rows.length === 0) {
            await client.query("COMMIT");
            return { notFound: true };
          }
          const quantity = line.quantity;
          if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1) {
            lineErrors[`lines.${index}.quantity`] = "Enter a whole number.";
            continue;
          }
          const returnable = row.rows[0].quantity - row.rows[0].returned_quantity;
          if (quantity > returnable) {
            lineErrors[`lines.${index}.quantity`] = "More than can be returned.";
            continue;
          }
          const newReturned = row.rows[0].returned_quantity + quantity;
          const isFull = newReturned === row.rows[0].quantity;
          const refund = isFull
            ? row.rows[0].line_total_cents - alreadyRefundedForLine(chain, line.sku as string)
            : lineTotalCents(quantity, row.rows[0].unit_price_milli);
          preparedLines.push({ sku: line.sku, quantity, refund });
        }
        if (Object.keys(lineErrors).length > 0) {
          await client.query("COMMIT");
          return { validation: errors.validationFailed(lineErrors) };
        }
        const returnId = crypto.randomUUID();
        const seqResult = await client.query<{ count: string }>("SELECT count(*) as count FROM returns WHERE order_id = $1", [order.id]);
        const returnNumber = `${order.number}-R${Number(seqResult.rows[0].count) + 1}`;
        const refundTotal = preparedLines.reduce((sum, line) => sum + line.refund, 0);
        await client.query(
          "INSERT INTO returns (id, order_id, number, status, reason, refund_cents, created_at, next_seq) VALUES ($1,$2,$3,'requested',$4,$5,$6,2)",
          [returnId, order.id, returnNumber, (body.reason as string).trim(), refundTotal, new Date()],
        );
        for (const line of preparedLines) {
          await client.query("INSERT INTO return_lines (return_id, sku, quantity, refund_cents) VALUES ($1,$2,$3,$4)", [returnId, line.sku, line.quantity, line.refund]);
          await client.query("UPDATE order_lines SET returned_quantity = returned_quantity + $1 WHERE order_id = $2 AND sku = $3", [line.quantity, order.id, line.sku]);
        }
        const last = await lastDigest(client, order.id);
        await appendOrderEvent(
          client,
          order.id,
          last.seq + 1,
          "return.requested",
          {
            return_id: returnId,
            number: returnNumber,
            refund_cents: refundTotal,
            lines: preparedLines.map((line) => ({ sku: line.sku, quantity: line.quantity, refund_cents: line.refund })),
          },
          new Date(),
          last.digest,
        );
        const { rebuildOrderView } = await import("./orders.js");
        await rebuildOrderView(client, order.id);
        await client.query("COMMIT");
        return {
          answer: {
            id: returnId,
            number: returnNumber,
            order_id: order.id,
            status: "requested",
            lines: preparedLines.map((line) => ({ sku: line.sku, quantity: line.quantity, refund_cents: line.refund })),
            refund_cents: refundTotal,
            reason: (body.reason as string).trim(),
            created_at: new Date().toISOString(),
          },
        };
      });
      if ("notFound" in answer && answer.notFound) {
        next(errors.notFound());
        return;
      }
      if ("forbidden" in answer && answer.forbidden) {
        next(errors.forbidden());
        return;
      }
      if ("conflict" in answer && answer.conflict) {
        next(answer.conflict);
        return;
      }
      if ("validation" in answer && answer.validation) {
        next(answer.validation);
        return;
      }
      res.status(201).json(answer.answer);
    } catch (err) {
      next(err);
    }
  });

  router.get("/returns", async (req, res, next) => {
    try {
      const { db } = res.locals as unknown as AppLocals;
      const auth = req.auth;
      if (!auth) {
        next(errors.unauthenticated());
        return;
      }
      const storeId = typeof req.query.store_id === "string" ? req.query.store_id : undefined;
      const rows = await db.withClient(async (client) => {
        if (storeId) {
          const store = await loadStoreRecord(client, storeId, auth.user.operatorId);
          if (!store) return null;
          if (!(auth.user.role === "lead" || (auth.user.role === "manager" && auth.storeIds.includes(store.id)))) return null;
        }
        const result = await client.query<{ id: string; number: string; order_id: string; status: string; reason: string; refund_cents: number; created_at: Date; store_id: string; lines: { sku: string; quantity: number; refund_cents: number }[] }>(
          `SELECT r.id, r.number, r.order_id, r.status, r.reason, r.refund_cents, r.created_at, o.store_id,
                  (SELECT json_agg(json_build_object('sku', rl.sku, 'quantity', rl.quantity, 'refund_cents', rl.refund_cents) ORDER BY rl.sku) FROM return_lines rl WHERE rl.return_id = r.id) AS lines
             FROM returns r JOIN orders o ON o.id = r.order_id
            WHERE o.operator_id = $1 ${storeId ? "AND o.store_id = $2" : ""}
            ORDER BY r.created_at DESC, r.id DESC`,
          storeId ? [auth.user.operatorId, storeId] : [auth.user.operatorId],
        );
        return result.rows;
      });
      if (rows === null) {
        next(errors.notFound());
        return;
      }
      res.json({
        returns: rows.map((row) => ({
          id: row.id,
          number: row.number,
          order_id: row.order_id,
          status: row.status,
          store_id: row.store_id,
          lines: row.lines ?? [],
          refund_cents: row.refund_cents,
          reason: row.reason,
          created_at: row.created_at.toISOString(),
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/returns/:id/transitions", async (req, res, next) => {
    try {
      const { db } = res.locals as unknown as AppLocals;
      const auth = req.auth;
      if (!auth) {
        next(errors.unauthenticated());
        return;
      }
      const to = (req.body as { to?: unknown }).to;
      if (typeof to !== "string" || !["received", "settled", "declined"].includes(to)) {
        next(errors.validationFailed({ to: "Unknown transition." }));
        return;
      }
      const answer = await db.withClient(async (client) => {
        await client.query("BEGIN");
        const row = await client.query<{ id: string; number: string; order_id: string; status: string; refund_cents: number }>(
          "SELECT id, number, order_id, status, refund_cents FROM returns WHERE id = $1",
          [req.params.id],
        );
        if (row.rows.length === 0) {
          await client.query("COMMIT");
          return { notFound: true };
        }
        const record = row.rows[0];
        const order = await loadOrderById(client, record.order_id);
        if (!order || order.operator_id !== auth.user.operatorId) {
          await client.query("COMMIT");
          return { notFound: true };
        }
        if (!(auth.user.role === "manager" && auth.storeIds.includes(order.store_id))) {
          await client.query("COMMIT");
          return { forbidden: true };
        }
        const transitions: Record<string, string[]> = { requested: ["received", "declined"], received: ["settled"], settled: [], declined: [] };
        if (!(transitions[record.status] ?? []).includes(to)) {
          await client.query("COMMIT");
          return { conflict: errors.invalidTransition(record.status, to) };
        }
        const chain = await loadEvents(client, order.id);
        const check = checkChain(chain);
        if (!check.ok) {
          await client.query("COMMIT");
          return { conflict: errors.conflict("sequence_broken", { first_bad_seq: check.firstBadSeq }) };
        }
        await client.query("UPDATE returns SET status = $1 WHERE id = $2", [to, record.id]);
        if (to === "received") {
          const lines = await client.query<{ sku: string; quantity: number }>("SELECT sku, quantity FROM return_lines WHERE return_id = $1", [record.id]);
          for (const line of lines.rows) {
            await client.query("UPDATE stock_lines SET on_hand = on_hand + $1 WHERE store_id = $2 AND sku = $3", [line.quantity, order.store_id, line.sku]);
          }
        }
        const last = await lastDigest(client, order.id);
        await appendOrderEvent(client, order.id, last.seq + 1, `return.${to}`, { return_id: record.id, from: record.status, to, by: auth.user.id }, new Date(), last.digest);
        const { rebuildOrderView } = await import("./orders.js");
        await rebuildOrderView(client, order.id);
        await client.query("COMMIT");
        return { record, order };
      });
      if ("notFound" in answer && answer.notFound) {
        next(errors.notFound());
        return;
      }
      if ("forbidden" in answer && answer.forbidden) {
        next(errors.forbidden());
        return;
      }
      if ("conflict" in answer && answer.conflict) {
        next(answer.conflict);
        return;
      }
      const full = await db.withClient(async (client) => {
        const row = await client.query<{ id: string; number: string; order_id: string; status: string; reason: string; refund_cents: number; created_at: Date; lines: { sku: string; quantity: number; refund_cents: number }[] }>(
          `SELECT r.id, r.number, r.order_id, r.status, r.reason, r.refund_cents, r.created_at,
                  (SELECT json_agg(json_build_object('sku', rl.sku, 'quantity', rl.quantity, 'refund_cents', rl.refund_cents) ORDER BY rl.sku) FROM return_lines rl WHERE rl.return_id = r.id) AS lines
             FROM returns r WHERE r.id = $1`,
          [req.params.id],
        );
        return row.rows[0];
      });
      res.json({
        id: full.id,
        number: full.number,
        order_id: full.order_id,
        status: full.status,
        lines: full.lines ?? [],
        refund_cents: full.refund_cents,
        reason: full.reason,
        created_at: full.created_at.toISOString(),
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/returns/:id/label", async (req, res, next) => {
    try {
      const { db, storage } = res.locals as unknown as AppLocals;
      const auth = req.auth;
      if (!auth) {
        next(errors.unauthenticated());
        return;
      }
      const found = await db.withClient(async (client) => {
        const row = await client.query<{ id: string; number: string; order_id: string; status: string }>(
          "SELECT id, number, order_id, status FROM returns WHERE id = $1",
          [req.params.id],
        );
        if (row.rows.length === 0) return null;
        const record = row.rows[0];
        const order = await loadOrderById(client, record.order_id);
        if (!order || order.operator_id !== auth.user.operatorId) return null;
        if (!(auth.user.role === "manager" && auth.storeIds.includes(order.store_id))) return "forbidden" as const;
        const store = await loadStoreRecord(client, order.store_id, auth.user.operatorId);
        const lines = await client.query<{ sku: string; quantity: number; name: string }>(
          `SELECT rl.sku, rl.quantity, ol.name FROM return_lines rl JOIN order_lines ol ON ol.order_id = $2 AND ol.sku = rl.sku WHERE rl.return_id = $1`,
          [record.id, record.order_id],
        );
        return { record, order, store, lines: lines.rows };
      });
      if (found === null || found === "forbidden") {
        next(found === "forbidden" ? errors.forbidden() : errors.notFound());
        return;
      }
      if (!storage.isUp()) {
        next(errors.storageUnavailable());
        return;
      }
      const key = `returns/${auth.user.operatorId}/${found.record.number}.txt`;
      const label =
        `Tramela return ${found.record.number}\n` +
        `Order ${found.order.number}\n` +
        `Shop ${found.store?.name ?? ""}\n` +
        found.lines.map((line) => `${line.quantity} x ${line.sku} ${line.name}`).join("\n");
      try {
        const existing = await storage.get(key);
        res.setHeader("Content-Type", "text/plain");
        res.send(existing.body);
        return;
      } catch {
        await storage.put(key, "text/plain", Buffer.from(`${label}\n`, "utf8"));
        res.setHeader("Content-Type", "text/plain");
        res.send(Buffer.from(`${label}\n`, "utf8"));
      }
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function alreadyRefundedForLine(chain: { type: string; data: unknown }[], sku: string): number {
  let refunded = 0;
  for (const entry of chain) {
    if (entry.type === "return.requested") {
      const data = entry.data as { lines?: { sku: string; refund_cents: number }[] };
      for (const line of data.lines ?? []) {
        if (line.sku === sku) refunded += line.refund_cents;
      }
    }
    if (entry.type === "return.declined") {
      void 0;
    }
  }
  return refunded;
}

export function reviewRouter(): Router {
  const router = Router();

  router.get("/estate/review", async (req, res, next) => {
    try {
      const { db } = res.locals as unknown as AppLocals;
      const auth = req.auth;
      if (!auth) {
        next(errors.unauthenticated());
        return;
      }
      if (auth.user.role !== "lead") {
        next(errors.forbidden());
        return;
      }
      const now = new Date();
      const windowStart = new Date(now.getTime() - 86400 * 1000);
      const rows = await db.withClient(async (client) => {
        const result = await client.query<{ seq: number; at: Date; order_id: string; order_number: string; store_id: string; type: string }>(
          `SELECT e.seq, e.at, e.order_id, o.number as order_number, o.store_id, e.type
             FROM order_events e JOIN orders o ON o.id = e.order_id
            WHERE o.operator_id = $1 AND e.type = 'order.placed' AND e.at >= $2
            ORDER BY e.at ASC`,
          [auth.user.operatorId, windowStart],
        );
        return result.rows;
      });
      res.json({
        window_start: windowStart.toISOString(),
        window_end: now.toISOString(),
        events: rows.map((row) => ({
          seq: row.seq,
          at: row.at.toISOString(),
          order_id: row.order_id,
          order_number: row.order_number,
          store_id: row.store_id,
          type: row.type,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
