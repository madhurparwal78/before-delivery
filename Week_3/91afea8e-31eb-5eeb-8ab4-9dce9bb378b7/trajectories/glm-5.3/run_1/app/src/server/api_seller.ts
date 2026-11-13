import { Router, type Ctx } from "./http.js";
import { ApiError, copy, forbidden, notFound, signedOut, validationFailed, invalidTransition } from "./errors.js";
import { config } from "./config.js";
import * as auth from "./auth.js";
import { one, query, withTransaction } from "./db.js";
import { buildQuote, loadCartSettings } from "./quote.js";
import { amount } from "./format.js";
import { id, sha256 } from "./crypto.js";
import { addDays, futureIso, istDateString } from "./time.js";
import { settlementLine, proratedRefund, GIFT_WRAP_Paise, COD_FEE_Paise } from "./domain.js";
import { divRound, allocate } from "./money.js";
import { buildInvoicePdf, buildLabelPdf } from "./documents.js";
import { putObject, getObject } from "./storage.js";
import { readBody, requireAccount, requireFields, str, codePoints, pinRow } from "./api_catalog.js";
import { sellerShipmentView, shipmentViewsForOrder } from "./api_orders.js";
import { kbRecordPurchase, kbRecordRefund, ensureKbAccount, kbRefundedAmount } from "./killbill.js";

const router = new Router();
export default router;

function currentSellerId(ctx: Ctx): string {
  return ctx.account!.id;
}

async function sellerOwnsListing(ctx: Ctx, listingId: string): Promise<boolean> {
  const row = await one<{ seller_id: string }>("SELECT seller_id FROM listings WHERE listing_id = $1", [listingId]);
  return row?.seller_id === currentSellerId(ctx);
}

// ---------- listings ----------

router.add("GET", "/api/seller/listings", async (ctx) => {
  requireAccount(ctx, ["seller"]);
  const q = (ctx.query.get("q") ?? "").trim();
  const category = ctx.query.get("category");
  const status = ctx.query.get("status");
  const limit = Number(ctx.query.get("limit") ?? "24");
  if (!Number.isInteger(limit) || limit < 1 || limit > 24) throw validationFailed({ limit: copy.field.badPageSize });
  const cursor = ctx.query.get("cursor");
  let offset = 0;
  if (cursor) offset = Number(Buffer.from(cursor, "base64url").toString("utf8")) || 0;
  const conds: string[] = ["l.seller_id = $1"];
  const params: unknown[] = [currentSellerId(ctx)];
  if (q) { conds.push("lower(p.title) LIKE $2"); params.push(`%${q.toLowerCase()}%`); }
  if (category) { conds.push("p.category = $3"); params.push(category); }
  if (status) { conds.push("l.status = $4"); params.push(status); }
  const rows = await query<{ listing_id: string; product_id: string; title: string; category: string; price_paise: string; cost_price_paise: string; stock: number; status: string; cod_allowed: boolean; no_cost_emi: boolean }>(`
    SELECT l.listing_id, l.product_id, p.title, p.category, l.price_paise, l.cost_price_paise, l.stock, l.status,
           l.cod_allowed, l.no_cost_emi
    FROM listings l JOIN products p ON p.product_id = l.product_id
    WHERE ${conds.join(" AND ")}
    ORDER BY l.created_seq DESC LIMIT ${limit} OFFSET ${offset}`, params);
  const photoCounts = rows.length ? await query<{ listing_id: string; n: string }>(
    "SELECT listing_id, count(*) AS n FROM listing_photos WHERE listing_id = ANY($1::text[]) GROUP BY listing_id",
    [rows.map((r) => r.listing_id)]) : [];
  const photoMap = new Map(photoCounts.map((p) => [p.listing_id, Number(p.n)]));
  const facetRows = await query<{ category: string; n: string }>(`
    SELECT p.category, count(*) AS n FROM listings l JOIN products p ON p.product_id = l.product_id
    WHERE l.seller_id = $1 GROUP BY p.category`, [currentSellerId(ctx)]);
  const facets: Record<string, number> = {};
  for (const f of facetRows) facets[f.category] = Number(f.n);
  return {
    listings: rows.map((r) => ({
      listing_id: r.listing_id, product_id: r.product_id, title: r.title, category: r.category,
      price_paise: Number(r.price_paise), cost_price_paise: Number(r.cost_price_paise), stock: r.stock,
      status: r.status, photo_count: photoMap.get(r.listing_id) ?? 0,
      cod_allowed: r.cod_allowed, no_cost_emi: r.no_cost_emi,
    })),
    facets: { category: facets },
    next_cursor: rows.length === limit ? Buffer.from(String(offset + limit)).toString("base64url") : null,
  };
});

router.add("POST", "/api/seller/listings", async (ctx) => {
  requireAccount(ctx, ["seller"]);
  const body = await readBody(ctx);
  requireFields(body, ["product_id", "title", "brand", "category", "description", "price_paise", "cost_price_paise", "stock", "cod_allowed", "no_cost_emi", "return_note"]);
  const live = await one<{ n: string }>("SELECT count(*) AS n FROM listings WHERE seller_id = $1 AND status = 'live'", [currentSellerId(ctx)]);
  if (Number(live?.n ?? 0) >= 200) throw new ApiError(409, "listing_quota", copy.listingQuota);

  const listingId = id("L");
  const fields: Record<string, string> = {};
  const title = str(body.title);
  if (codePoints(title) < 3 || codePoints(title) > 120) fields.title = copy.field.minLength("Title", 3);
  const description = str(body.description ?? "");
  if (codePoints(description) > 2000) fields.description = copy.field.maxLength("Description", 2000);
  const returnNote = str(body.return_note ?? "");
  if (codePoints(returnNote) > 500) fields["return note"] = copy.field.maxLength("Return note", 500);
  const pricePaise = Number(body.price_paise);
  const costPaise = Number(body.cost_price_paise ?? 0);
  const stock = Number(body.stock ?? 0);
  if (!Number.isInteger(pricePaise) || pricePaise < 0) fields.price_paise = "Enter a price.";
  if (!Number.isInteger(stock) || stock < 0 || stock > 9999) fields.stock = "Stock is 0 to 9,999.";
  if (Object.keys(fields).length) throw validationFailed(fields);

  let productId = str(body.product_id);
  if (productId) {
    const exists = await one<{ product_id: string }>("SELECT product_id FROM products WHERE product_id = $1", [productId]);
    if (!exists) throw validationFailed({ product_id: "Choose a product." });
  } else {
    productId = id("P");
    const brand = str(body.brand);
    const category = str(body.category);
    if (!brand) fields.brand = "Enter a brand.";
    if (!category || !(await one<{ slug: string }>("SELECT slug FROM categories WHERE slug = $1", [category]))) fields.category = "Choose a category.";
    if (Object.keys(fields).length) throw validationFailed(fields);
    await query(
      "INSERT INTO products (product_id, title, brand, category, rating, description, specs) VALUES ($1,$2,$3,$4,0,$5,'{}')",
      [productId, title, brand, category, description],
    );
  }
  const product = await one<{ category: string }>("SELECT category FROM products WHERE product_id = $1", [productId]);
  await query(
    `INSERT INTO listings (listing_id, product_id, seller_id, price_paise, cost_price_paise, stock, status,
       cod_allowed, no_cost_emi, return_note, description, created_seq)
     VALUES ($1,$2,$3,$4,$5,$6,'live',$7,$8,$9,$10,$11)`,
    [listingId, productId, currentSellerId(ctx), pricePaise, costPaise, stock, body.cod_allowed === true, body.no_cost_emi === true, returnNote, description, Date.now()],
  );
  void product;
  ctx.res.statusCode = 201;
  await syncListingToIndex(listingId);
  return listingView(listingId);
});

router.add("PATCH", "/api/seller/listings/:listing_id", async (ctx) => {
  requireAccount(ctx, ["seller"]);
  const body = await readBody(ctx);
  requireFields(body, ["title", "brand", "category", "description", "price_paise", "cost_price_paise", "stock", "cod_allowed", "no_cost_emi", "return_note", "status"]);
  if (!(await sellerOwnsListing(ctx, ctx.params.listing_id))) throw notFound();
  const listing = await one<{ status: string }>("SELECT status FROM listings WHERE listing_id = $1", [ctx.params.listing_id]);
  const newStatus = body.status === undefined ? undefined : str(body.status);
  if (newStatus === "live" && listing?.status !== "live") {
    const live = await one<{ n: string }>("SELECT count(*) AS n FROM listings WHERE seller_id = $1 AND status = 'live'", [currentSellerId(ctx)]);
    if (Number(live?.n ?? 0) >= 200) throw new ApiError(409, "listing_quota", copy.listingQuota);
  }
  const fields: Record<string, string> = {};
  const updates: string[] = [];
  const params: unknown[] = [ctx.params.listing_id];
  let pi = 1;
  const setIf = (column: string, value: unknown) => { updates.push(`${column} = $${++pi}`); params.push(value); };
  if (body.title !== undefined) {
    const title = str(body.title);
    if (codePoints(title) < 3 || codePoints(title) > 120) fields.title = copy.field.minLength("Title", 3);
    else setIf("title", title);
  }
  if (body.description !== undefined) {
    const description = str(body.description);
    if (codePoints(description) > 2000) fields.description = copy.field.maxLength("Description", 2000);
    else setIf("description", description);
  }
  if (body["return_note"] !== undefined) {
    const note = str(body["return_note"]);
    if (codePoints(note) > 500) fields["return note"] = copy.field.maxLength("Return note", 500);
    else setIf("return_note", note);
  }
  if (body.price_paise !== undefined) {
    const price = Number(body.price_paise);
    if (!Number.isInteger(price) || price < 0) fields.price_paise = "Enter a price.";
    else setIf("price_paise", price);
  }
  if (body.cost_price_paise !== undefined) setIf("cost_price_paise", Number(body.cost_price_paise));
  if (body.stock !== undefined) {
    const stock = Number(body.stock);
    if (!Number.isInteger(stock) || stock < 0 || stock > 9999) fields.stock = "Stock is 0 to 9,999.";
    else setIf("stock", stock);
  }
  if (body.cod_allowed !== undefined) setIf("cod_allowed", body.cod_allowed === true);
  if (body.no_cost_emi !== undefined) setIf("no_cost_emi", body.no_cost_emi === true);
  if (newStatus !== undefined) {
    if (!["live", "unlisted"].includes(newStatus)) fields.status = "Status is live or unlisted.";
    else setIf("status", newStatus);
  }
  if (Object.keys(fields).length) throw validationFailed(fields);
  if (updates.length > 0) {
    await query(`UPDATE listings SET ${updates.join(", ")} WHERE listing_id = $1`, params);
  }
  await syncListingToIndex(ctx.params.listing_id);
  return listingView(ctx.params.listing_id);
});

async function listingView(listingId: string): Promise<Record<string, unknown>> {
  const row = await one<{ listing_id: string; product_id: string; title: string; category: string; price_paise: string; cost_price_paise: string; stock: number; status: string; cod_allowed: boolean; no_cost_emi: boolean; return_note: string; description: string }>(`
    SELECT l.*, p.title, p.category, p.description AS product_description FROM listings l
    JOIN products p ON p.product_id = l.product_id WHERE l.listing_id = $1`, [listingId]);
  if (!row) throw notFound();
  const photos = await query<{ photo_id: string; url: string }>(`
    SELECT photo_id, '/img/photos/' || object_key AS url FROM listing_photos WHERE listing_id = $1 ORDER BY position`, [listingId]);
  return {
    listing_id: row.listing_id, product_id: row.product_id, title: row.title, category: row.category,
    price_paise: Number(row.price_paise), cost_price_paise: Number(row.cost_price_paise), stock: row.stock,
    status: row.status, cod_allowed: row.cod_allowed, no_cost_emi: row.no_cost_emi,
    return_note: row.return_note, description: row.description, photos,
  };
}

router.add("PUT", "/api/seller/listings/:listing_id/stock", async (ctx) => {
  requireAccount(ctx, ["seller"]);
  const body = await readBody(ctx);
  requireFields(body, ["stock"]);
  if (!(await sellerOwnsListing(ctx, ctx.params.listing_id))) throw notFound();
  const stock = Number(body.stock);
  if (!Number.isInteger(stock) || stock < 0 || stock > 9999) throw validationFailed({ stock: "Stock is 0 to 9,999." });
  await query("UPDATE listings SET stock = $2 WHERE listing_id = $1", [ctx.params.listing_id, stock]);
  await syncListingToIndex(ctx.params.listing_id);
  return listingView(ctx.params.listing_id);
});

router.add("PUT", "/api/seller/listings/:listing_id/deal", async (ctx) => {
  requireAccount(ctx, ["seller"]);
  const body = await readBody(ctx);
  requireFields(body, ["deal_price_paise", "ends_at"]);
  if (!(await sellerOwnsListing(ctx, ctx.params.listing_id))) throw notFound();
  const listing = await one<{ price_paise: string }>("SELECT price_paise FROM listings WHERE listing_id = $1", [ctx.params.listing_id]);
  const dealPrice = Number(body.deal_price_paise);
  const endsAt = str(body.ends_at);
  const fields: Record<string, string> = {};
  if (!Number.isInteger(dealPrice) || dealPrice >= Number(listing!.price_paise)) fields.deal_price_paise = "A deal price is below the listing price.";
  if (!endsAt || new Date(endsAt).getTime() <= Date.now()) fields.ends_at = "A deal ends in the future.";
  if (Object.keys(fields).length) throw validationFailed(fields);
  await query("UPDATE listings SET deal_price_paise = $2, deal_ends_at = $3 WHERE listing_id = $1", [ctx.params.listing_id, dealPrice, endsAt]);
  await syncListingToIndex(ctx.params.listing_id);
  return listingView(ctx.params.listing_id);
});

router.add("DELETE", "/api/seller/listings/:listing_id/deal", async (ctx) => {
  requireAccount(ctx, ["seller"]);
  if (!(await sellerOwnsListing(ctx, ctx.params.listing_id))) throw notFound();
  await query("UPDATE listings SET deal_price_paise = NULL, deal_ends_at = NULL WHERE listing_id = $1", [ctx.params.listing_id]);
  await syncListingToIndex(ctx.params.listing_id);
  ctx.res.statusCode = 204;
  return null;
});

router.add("POST", "/api/seller/listings/:listing_id/photos", async (ctx) => {
  requireAccount(ctx, ["seller"]);
  if (!(await sellerOwnsListing(ctx, ctx.params.listing_id))) throw notFound();
  const file = (ctx.body as { file?: { data: Buffer; filename: string } } | null)?.file;
  if (!file || !Buffer.isBuffer(file.data)) throw validationFailed({ file: "Choose a photo." });
  const count = await one<{ n: string }>("SELECT count(*) AS n FROM listing_photos WHERE listing_id = $1", [ctx.params.listing_id]);
  if (Number(count?.n ?? 0) >= 6) throw new ApiError(409, "photo_limit", copy.photoLimit);
  if (file.data.length > 2000000) throw new ApiError(413, "file_too_large", copy.fileTooLargePhoto);
  const type = sniffImage(file.data, ["jpeg", "png", "webp"]);
  if (!type) throw new ApiError(415, "unsupported_type", copy.unsupportedPhoto);
  const photoId = id("PH");
  const key = `listings/${ctx.params.listing_id}/${photoId}.${type}`;
  const stored = await putObject(key, file.data, `image/${type}`);
  if (!stored) throw new ApiError(503, "storage_unavailable", copy.storageUnavailable);
  await query(
    "INSERT INTO listing_photos (photo_id, listing_id, object_key, position) VALUES ($1,$2,$3,$4)",
    [photoId, ctx.params.listing_id, key, Number(count?.n ?? 0)],
  );
  ctx.res.statusCode = 201;
  return { photo_id: photoId, url: `/img/photos/${key}` };
});

router.add("DELETE", "/api/seller/listings/:listing_id/photos/:photo_id", async (ctx) => {
  requireAccount(ctx, ["seller"]);
  if (!(await sellerOwnsListing(ctx, ctx.params.listing_id))) throw notFound();
  await query("DELETE FROM listing_photos WHERE photo_id = $1 AND listing_id = $2", [ctx.params.photo_id, ctx.params.listing_id]);
  ctx.res.statusCode = 204;
  return null;
});

router.add("POST", "/api/seller/gst-certificate", async (ctx) => {
  requireAccount(ctx, ["seller"]);
  const file = (ctx.body as { file?: { data: Buffer; filename: string } } | null)?.file;
  if (!file || !Buffer.isBuffer(file.data)) throw validationFailed({ file: "Choose a certificate." });
  if (file.data.length > 5000000) throw new ApiError(413, "file_too_large", copy.fileTooLargeCertificate);
  const type = sniffImage(file.data, ["pdf", "jpeg", "png"]);
  if (!type) throw new ApiError(415, "unsupported_type", copy.unsupportedCertificate);
  const key = `sellers/${currentSellerId(ctx)}/gst-certificate.${type}`;
  const stored = await putObject(key, file.data, type === "pdf" ? "application/pdf" : `image/${type}`);
  if (!stored) throw new ApiError(503, "storage_unavailable", copy.storageUnavailable);
  await query(
    `INSERT INTO seller_gst (seller_id, object_key, stored_at) VALUES ($1,$2,now())
     ON CONFLICT (seller_id) DO UPDATE SET object_key = $2, stored_at = now()`,
    [currentSellerId(ctx), key],
  );
  ctx.res.statusCode = 201;
  return { status: "stored" };
});

/** Judge a file by its leading bytes, never by its name or declared type. */
function sniffImage(data: Buffer, allowed: string[]): string | null {
  if (data.length < 12) return null;
  if (allowed.includes("pdf") && data.subarray(0, 5).toString("binary") === "%PDF-") return "pdf";
  if (allowed.includes("jpeg") && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpeg";
  if (allowed.includes("png") && data.subarray(1, 4).toString("binary") === "PNG") return "png";
  if (allowed.includes("webp") && data.subarray(0, 4).toString("binary") === "RIFF" && data.subarray(8, 12).toString("binary") === "WEBP") return "webp";
  return null;
}

router.add("GET", "/api/seller/low-stock", async (ctx) => {
  requireAccount(ctx, ["seller"]);
  const rows = await query<{ listing_id: string; title: string; stock: number }>(`
    SELECT l.listing_id, p.title, l.stock FROM listings l JOIN products p ON p.product_id = l.product_id
    WHERE l.seller_id = $1 AND l.status = 'live' AND l.stock BETWEEN 1 AND 5 ORDER BY l.stock, l.listing_id`,
    [currentSellerId(ctx)]);
  return { listings: rows };
});

router.add("GET", "/api/seller/commission-rates", async (ctx) => {
  requireAccount(ctx, ["seller"]);
  const rows = await query<{ category: string; commission_percent: string }>(
    "SELECT slug AS category, commission_percent FROM categories ORDER BY slug");
  return { rates: rows.map((r) => ({ category: r.category, commission_percent: Number(r.commission_percent) })) };
});

async function syncListingToIndex(listingId: string): Promise<void> {
  const { msUpsert, msDelete } = await import("./search.js");
  const row = await one<{ listing_id: string; product_id: string; title: string; brand: string; category: string; description: string; seller_id: string; seller_name: string; price_paise: string; rating: string; stock: number; status: string; created_seq: string; pincodes: string[] }>(`
    SELECT l.listing_id, l.product_id, p.title, p.brand, p.category, l.description, l.seller_id, s.name AS seller_name,
           l.price_paise, p.rating, l.stock, l.status, l.created_seq,
           (SELECT array_agg(pincode) FROM pincodes pin WHERE pin.serviceable AND (s.ship_all_states OR s.ship_states @> ARRAY[pin.state])) AS pincodes
    FROM listings l JOIN products p ON p.product_id = l.product_id JOIN sellers s ON s.seller_id = l.seller_id
    WHERE l.listing_id = $1`, [listingId]);
  if (!row) return;
  if (row.status !== "live") {
    await msDelete([listingId]);
    return;
  }
  await msUpsert([{
    listing_id: row.listing_id, product_id: row.product_id, title: row.title, brand: row.brand,
    category: row.category, description: row.description, seller_id: row.seller_id, seller_name: row.seller_name,
    price_paise: Number(row.price_paise), rating: Number(row.rating), in_stock: row.stock > 0,
    pincodes: (row.pincodes ?? []).filter(Boolean), created_seq: Number(row.created_seq),
  }]);
}

// ---------- shipments ----------

router.add("GET", "/api/seller/shipments", async (ctx) => {
  requireAccount(ctx, ["seller"]);
  const state = ctx.query.get("state");
  const limit = Number(ctx.query.get("limit") ?? "24");
  if (!Number.isInteger(limit) || limit < 1 || limit > 24) throw validationFailed({ limit: copy.field.badPageSize });
  const cursor = ctx.query.get("cursor");
  let offset = 0;
  if (cursor) offset = Number(Buffer.from(cursor, "base64url").toString("utf8")) || 0;
  const conds: string[] = ["seller_id = $1"];
  const params: unknown[] = [currentSellerId(ctx)];
  if (state) { conds.push("state = $2"); params.push(state); }
  const rows = await query<{ shipment_id: string }>(
    `SELECT shipment_id FROM shipments WHERE ${conds.join(" AND ")} ORDER BY created_seq DESC LIMIT ${limit} OFFSET ${offset}`, params);
  const views = [];
  for (const r of rows) views.push(await sellerShipmentView(r.shipment_id));
  return { shipments: views, next_cursor: rows.length === limit ? Buffer.from(String(offset + limit)).toString("base64url") : null };
});

const LEGAL_MOVES: Record<string, Record<string, string[]>> = {
  placed: { packed: ["seller"], cancelled: ["shopper"] },
  packed: { shipped: ["seller"], cancelled: ["shopper"] },
  shipped: { delivered: ["seller"] },
};

router.add("POST", "/api/seller/shipments/:shipment_id/pack", async (ctx) => {
  await transitionShipment(ctx, "packed");
});
router.add("POST", "/api/seller/shipments/:shipment_id/ship", async (ctx) => {
  await transitionShipment(ctx, "shipped");
});
router.add("POST", "/api/seller/shipments/:shipment_id/deliver", async (ctx) => {
  await transitionShipment(ctx, "delivered");
});

async function transitionShipment(ctx: Ctx, to: string): Promise<unknown> {
  requireAccount(ctx, ["seller"]);
  const shipment = await one<{ shipment_id: string; order_id: string; seller_id: string; state: string; label_status: string }>(
    "SELECT * FROM shipments WHERE shipment_id = $1", [ctx.params.shipment_id]);
  if (!shipment) throw notFound();
  if (shipment.seller_id !== currentSellerId(ctx)) throw notFound();
  const legal = LEGAL_MOVES[shipment.state]?.[to];
  if (!legal) throw invalidTransition(shipment.state, to);
  if (to === "packed") {
    const status = await shipmentPaid(shipment);
    if (status !== "paid" && !(await isCodShipment(shipment))) {
      throw new ApiError(409, "payment_pending", copy.paymentPendingPack);
    }
  }
  if (to === "shipped") {
    if (shipment.label_status !== "ready") {
      throw new ApiError(409, "label_pending", copy.labelPending);
    }
  }
  await withTransaction(async (client) => {
    await client.query("UPDATE shipments SET state = $2 WHERE shipment_id = $1", [shipment.shipment_id, to]);
    await client.query("INSERT INTO shipment_timeline (shipment_id, state, at) VALUES ($1,$2,now()) ON CONFLICT DO NOTHING", [shipment.shipment_id, to]);
    if (to === "delivered") {
      await client.query("UPDATE shipments SET delivered_on = $2 WHERE shipment_id = $1", [shipment.shipment_id, istDateString()]);
      await postSettlementLines(client, shipment.shipment_id);
      await recordCodCollection(shipment.shipment_id);
    }
  });
  return sellerShipmentView(shipment.shipment_id);
}

async function isCodShipment(shipment: { order_id: string }): Promise<boolean> {
  const payment = await one<{ method: string }>("SELECT method FROM payments WHERE order_id = $1", [shipment.order_id]);
  return payment?.method === "cod";
}

async function shipmentPaid(shipment: { shipment_id: string; order_id: string }): Promise<string> {
  const legs = await query<{ status: string }>(
    "SELECT status FROM payment_legs WHERE payment_id = (SELECT payment_id FROM payments WHERE order_id = $1)",
    [shipment.order_id]);
  if (legs.length === 0) return "pending";
  return legs.every((l) => l.status === "confirmed") ? "paid" : "pending";
}

/** Settlement lines for each delivered shipment line. */
async function postSettlementLines(client: import("./db.js").PoolClient, shipmentId: string): Promise<void> {
  const shipment = (await client.query("SELECT * FROM shipments WHERE shipment_id = $1", [shipmentId])).rows[0] as
    { shipment_id: string; order_id: string; seller_id: string; delivered_on: string } | undefined;
  if (!shipment) return;
  const lines = (await client.query(`
    SELECT sl.*, l.product_id, p.category FROM shipment_lines sl
    JOIN listings l ON l.listing_id = sl.listing_id
    JOIN products p ON p.product_id = l.product_id
    WHERE sl.shipment_id = $1`, [shipmentId])).rows as Array<{
    line_id: string; quantity: number; unit_price_paise: string; coupon_share_paise: string; line_total_paise: string; gst_rate: number; category: string;
  }>;
  const rateRows = (await client.query("SELECT slug, commission_percent, gst_rate FROM categories")).rows as Array<{ slug: string; commission_percent: string; gst_rate: number }>;
  const rateMap = new Map(rateRows.map((r) => [r.slug, Number(r.commission_percent)]));
  const gstMap = new Map(rateRows.map((r) => [r.slug, r.gst_rate]));
  const emiDiscount = (await client.query("SELECT emi_discount_paise FROM orders WHERE order_id = $1", [shipment.order_id])).rows[0] as { emi_discount_paise: string } | undefined;
  const totalLines = lines.reduce((a, l) => a + l.line_total_paise as unknown as number, 0);
  for (const line of lines) {
    const gross = Number(line.unit_price_paise) * line.quantity;
    const emiShare = Number(emiDiscount?.emi_discount_paise ?? 0) > 0 && totalLines > 0
      ? divRound((Number(emiDiscount!.emi_discount_paise) * Number(line.line_total_paise)) / totalLines, 1) : 0;
    const commissionPercent = rateMap.get(line.category) ?? 0;
    const parts = settlementLine(gross, commissionPercent, line.gst_rate, emiShare);
    await client.query(
      `INSERT INTO settlements (settlement_line_id, shipment_id, shipment_line_id, seller_id, kind, posted_on,
        gross_paise, commission_percent, commission_paise, commission_gst_paise, tcs_paise, tds_paise,
        emi_subvention_paise, net_paise, status, quantity, line_quantity)
       VALUES ($1,$2,$3,$4,'sale',$5,$6,$7,$8,$9,$10,$11,$12,$13,'payment_confirmed',$14,$14)`,
      [id("SET"), shipmentId, line.line_id, shipment.seller_id, shipment.delivered_on, gross, commissionPercent,
        parts.commission, parts.commissionGst, parts.tcs, parts.tds, emiShare, parts.net, line.quantity],
    );
  }
}

async function recordCodCollection(shipmentId: string): Promise<void> {
  const shipment = await one<{ shipment_id: string; order_id: string; cod_fee_paise: string; seller_id: string }>(
    "SELECT * FROM shipments WHERE shipment_id = $1", [shipmentId]);
  if (!shipment || Number(shipment.cod_fee_paise) === 0) return;
  const payment = await one<{ method: string }>("SELECT method FROM payments WHERE order_id = $1", [shipment.order_id]);
  if (payment?.method !== "cod") return;
  const order = await one<{ account_id: string; name: string; due_paise: string }>(`
    SELECT o.*, sh.name FROM orders o JOIN shoppers sh ON sh.account_id = o.account_id WHERE o.order_id = $1`, [shipment.order_id]);
  const kbAccount = await ensureKbAccount(order!.account_id, order!.name);
  if (!kbAccount) return;
  const amount = Number(order!.due_paise);
  if (amount <= 0) return;
  await kbRecordPurchase(kbAccount, amount, `${shipment.order_id}-cod-${shipmentId}`, `${shipment.order_id}-cod-${shipmentId}`);
}

router.add("GET", "/api/seller/shipments/:shipment_id/label", async (ctx) => {
  requireAccount(ctx, ["seller"]);
  const shipment = await one<{ shipment_id: string; order_id: string; seller_id: string }>(
    "SELECT * FROM shipments WHERE shipment_id = $1", [ctx.params.shipment_id]);
  if (!shipment || shipment.seller_id !== currentSellerId(ctx)) throw notFound();
  const key = `labels/${shipment.order_id}/${shipment.shipment_id}.pdf`;
  const doc = await one<{ object_key: string }>("SELECT object_key FROM documents WHERE object_key = $1", [key]);
  if (!doc) throw new ApiError(409, "document_pending", copy.labelPending);
  const bytes = await getObject(key);
  if (!bytes) throw new ApiError(409, "document_pending", copy.labelPending);
  ctx.res.setHeader("Content-Type", "application/pdf");
  return bytes;
});

// ---------- returns ----------

router.add("GET", "/api/seller/returns", async (ctx) => {
  requireAccount(ctx, ["seller"]);
  const rows = await query<{ return_id: string }>(`
    SELECT r.return_id FROM returns r JOIN shipments s ON s.shipment_id = r.shipment_id
    WHERE s.seller_id = $1 ORDER BY r.created_at DESC`, [currentSellerId(ctx)]);
  const views = [];
  for (const r of rows) views.push(await returnView(r.return_id));
  return { returns: views };
});

async function returnView(returnId: string): Promise<Record<string, unknown>> {
  const ret = await one<{ return_id: string; shipment_line_id: string; state: string; quantity: number; reason: string; decline_reason: string; refund_estimate_paise: string; created_at: string }>(
    "SELECT * FROM returns WHERE return_id = $1", [returnId]);
  if (!ret) throw notFound();
  const line = await one<{ title: string; quantity: number; line_total_paise: string }>(
    "SELECT title, quantity, line_total_paise FROM shipment_lines WHERE line_id = $1", [ret.shipment_line_id]);
  const legs = await query<{ method: string; amount_paise: string; status: string }>(
    "SELECT method, amount_paise, status FROM refund_legs WHERE refund_id = $1", [ret.return_id]);
  const confirmed = legs.filter((l) => l.status === "confirmed").reduce((a, l) => a + Number(l.amount_paise), 0);
  return {
    return_id: ret.return_id, state: ret.state, quantity: ret.quantity,
    line_title: line?.title, reason: ret.reason, decline_reason: ret.decline_reason,
    refund_paise: confirmed > 0 ? confirmed : Number(ret.refund_estimate_paise),
    refund_legs: legs.map((l) => ({ method: l.method, amount_paise: Number(l.amount_paise), status: l.status })),
  };
}

router.add("POST", "/api/seller/returns/:return_id/pickup", async (ctx) => {
  requireAccount(ctx, ["seller"]);
  const ret = await one<{ return_id: string; shipment_id: string; shipment_line_id: string; quantity: number; refund_estimate_paise: string; state: string }>(
    "SELECT * FROM returns WHERE return_id = $1", [ctx.params.return_id]);
  if (!ret) throw notFound();
  const shipment = await one<{ seller_id: string; order_id: string }>("SELECT seller_id, order_id FROM shipments WHERE shipment_id = $1", [ret.shipment_id]);
  if (!shipment || shipment.seller_id !== currentSellerId(ctx)) throw notFound();
  if (ret.state !== "requested") throw invalidTransition(ret.state, "picked");
  await startRefund(ret.return_id, ret.shipment_line_id, ret.quantity, "return");
  await query("UPDATE returns SET state = 'picked', updated_at = now() WHERE return_id = $1", [ret.return_id]);
  return returnView(ret.return_id);
});

router.add("POST", "/api/seller/returns/:return_id/decline", async (ctx) => {
  requireAccount(ctx, ["seller"]);
  const body = await readBody(ctx);
  requireFields(body, ["reason"]);
  const reason = str(body.reason);
  if (codePoints(reason) < 10 || codePoints(reason) > 500) throw validationFailed({ reason: copy.field.minLength("Reason", 10) });
  const ret = await one<{ return_id: string; shipment_id: string; state: string }>(
    "SELECT * FROM returns WHERE return_id = $1", [ctx.params.return_id]);
  if (!ret) throw notFound();
  const shipment = await one<{ seller_id: string }>("SELECT seller_id FROM shipments WHERE shipment_id = $1", [ret.shipment_id]);
  if (!shipment || shipment.seller_id !== currentSellerId(ctx)) throw notFound();
  if (ret.state !== "requested") throw invalidTransition(ret.state, "declined");
  await query("UPDATE returns SET state = 'declined', decline_reason = $2, updated_at = now() WHERE return_id = $1", [ret.return_id, reason]);
  return returnView(ret.return_id);
});

// ---------- settlements ----------

router.add("GET", "/api/seller/settlements", async (ctx) => {
  requireAccount(ctx, ["seller"]);
  const from = ctx.query.get("from") ?? "0001-01-01";
  const to = ctx.query.get("to") ?? "9999-12-31";
  const rows = await query<{ settlement_line_id: string; shipment_id: string; shipment_line_id: string; kind: string; posted_on: string; gross_paise: string; commission_percent: string; commission_paise: string; commission_gst_paise: string; tcs_paise: string; tds_paise: string; emi_subvention_paise: string; net_paise: string; status: string }>(`
    SELECT * FROM settlements WHERE seller_id = $1 AND posted_on >= $2 AND posted_on <= $3 ORDER BY posted_on, settlement_line_id`,
    [currentSellerId(ctx), from, to]);
  const totals = {
    gross_paise: 0, commission_paise: 0, commission_gst_paise: 0, tcs_paise: 0, tds_paise: 0, emi_subvention_paise: 0, net_paise: 0,
  };
  for (const r of rows) {
    totals.gross_paise += Number(r.gross_paise);
    totals.commission_paise += Number(r.commission_paise);
    totals.commission_gst_paise += Number(r.commission_gst_paise);
    totals.tcs_paise += Number(r.tcs_paise);
    totals.tds_paise += Number(r.tds_paise);
    totals.emi_subvention_paise += Number(r.emi_subvention_paise);
    totals.net_paise += Number(r.net_paise);
  }
  return {
    lines: rows.map((r) => ({
      settlement_line_id: r.settlement_line_id, shipment_id: r.shipment_id, shipment_line_id: r.shipment_line_id,
      kind: r.kind, posted_on: dateOnly(r.posted_on), gross_paise: Number(r.gross_paise),
      commission_percent: Number(r.commission_percent), commission_paise: Number(r.commission_paise),
      commission_gst_paise: Number(r.commission_gst_paise), tcs_paise: Number(r.tcs_paise),
      tds_paise: Number(r.tds_paise), emi_subvention_paise: Number(r.emi_subvention_paise),
      net_paise: Number(r.net_paise), status: r.status,
    })),
    totals,
  };
});

/** Postgres date columns arrive with a time part; the API publishes plain YYYY-MM-DD. */
function dateOnly(value: string | Date | null): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.slice(0, 10);
  const d = new Date(value.getTime() + 5.5 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

router.add("PUT", "/api/seller/payout-account", async (ctx) => {
  requireAccount(ctx, ["seller"]);
  const body = await readBody(ctx);
  requireFields(body, ["account_holder", "ifsc", "account_number"]);
  const holder = str(body.account_holder);
  const ifsc = str(body.ifsc);
  const accountNumber = str(body.account_number);
  const fields: Record<string, string> = {};
  if (!holder) fields.account_holder = "Enter the account holder.";
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) fields.ifsc = "Enter an IFSC.";
  if (!/^\d{6,18}$/.test(accountNumber)) fields.account_number = "Enter an account number.";
  if (Object.keys(fields).length) throw validationFailed(fields);
  await query(
    `INSERT INTO payout_accounts (seller_id, account_holder, ifsc, account_number) VALUES ($1,$2,$3,$4)
     ON CONFLICT (seller_id) DO UPDATE SET account_holder = $2, ifsc = $3, account_number = $4`,
    [currentSellerId(ctx), holder, ifsc, accountNumber],
  );
  return { account_holder: holder, ifsc, account_number_masked: "*".repeat(Math.max(accountNumber.length - 4, 0)) + accountNumber.slice(-4) };
});

// ---------- refunds (shared with support) ----------

/** Refund routing: non-balance leg first, then the balance leg. COD refunds credit the balance. */
export async function startRefund(returnId: string, shipmentLineId: string, quantity: number, kind: "return" | "support", reason = ""): Promise<void> {
  const line = await one<{ line_id: string; shipment_id: string; quantity: number; line_total_paise: string; order_id: string }>(`
    SELECT sl.*, s.order_id FROM shipment_lines sl JOIN shipments s ON s.shipment_id = sl.shipment_id
    WHERE sl.line_id = $1`, [shipmentLineId]);
  if (!line) throw notFound();
  const order = await one<{ account_id: string; payable_paise: string }>("SELECT account_id, payable_paise FROM orders WHERE order_id = $1", [line.order_id]);
  const payment = await one<{ payment_id: string; method: string }>("SELECT * FROM payments WHERE order_id = $1", [line.order_id]);
  const existingRefunds = await query<{ amount_paise: string }>(
    "SELECT amount_paise FROM refunds WHERE shipment_line_id = $1 AND state = 'confirmed'", [shipmentLineId]);
  const already = existingRefunds.reduce((a, r) => a + Number(r.amount_paise), 0);
  const refundAmount = proratedRefund(Number(line.line_total_paise), quantity, line.quantity, already);
  const legs = await query<{ leg_id: string; method: string; amount_paise: string; refunded: string; kb_payment_id: string | null; kb_txn_key: string }>(
    "SELECT * FROM payment_legs WHERE payment_id = $1", [payment!.payment_id]);
  const cod = payment?.method === "cod";
  const refundId = returnId;
  const targets: Array<{ method: string; amount: number; kbPaymentId: string | null }> = [];
  if (cod) {
    targets.push({ method: "balance", amount: refundAmount, kbPaymentId: null });
  } else {
    const nonBalance = legs.filter((l) => l.method !== "balance");
    const balanceLeg = legs.find((l) => l.method === "balance");
    let remaining = refundAmount;
    for (const leg of nonBalance) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, Number(leg.amount_paise));
      targets.push({ method: leg.method, amount: take, kbPaymentId: leg.kb_payment_id });
      remaining -= take;
    }
    if (remaining > 0 && balanceLeg) {
      targets.push({ method: "balance", amount: remaining, kbPaymentId: balanceLeg.kb_payment_id });
    }
  }
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO refunds (refund_id, order_id, payment_id, kind, state, amount_paise, reason, shipment_line_id, quantity)
       VALUES ($1,$2,$3,$4,'pending',$5,$6,$7,$8)`,
      [refundId, line.order_id, payment!.payment_id, kind, refundAmount, reason, shipmentLineId, quantity],
    );
    for (const target of targets) {
      await client.query(
        `INSERT INTO refund_legs (refund_leg_id, refund_id, method, amount_paise, status, kb_payment_id, kb_txn_key)
         VALUES ($1,$2,$3,$4,'pending',$5,$6)`,
        [id("RL"), refundId, target.method, target.amount, target.kbPaymentId, `${refundId}-${target.method}`],
      );
      if (target.kbPaymentId) {
        const ok = await kbRecordRefund(target.kbPaymentId, target.amount, `${refundId}-${target.method}`);
        if (ok) {
          await client.query("UPDATE refund_legs SET status = 'confirmed' WHERE refund_id = $1 AND method = $2", [refundId, target.method]);
          await client.query("UPDATE refunds SET state = 'confirmed' WHERE refund_id = $1", [refundId]);
        }
      } else {
        // balance leg: credit at once
        await client.query("UPDATE shoppers SET balance_paise = balance_paise + $2 WHERE account_id = $1", [order!.account_id, target.amount]);
        await client.query("UPDATE refund_legs SET status = 'confirmed' WHERE refund_id = $1 AND method = $2", [refundId, target.method]);
        await client.query("UPDATE refunds SET state = 'confirmed' WHERE refund_id = $1", [refundId]);
      }
    }
    if (kind === "return") {
      await client.query("UPDATE returns SET state = 'picked' WHERE return_id = $1", [refundId]);
    }
    // post the return settlement line
    await postReturnSettlement(client, shipmentLineId, quantity, refundId);
  });
  void order;
}

async function postReturnSettlement(client: import("./db.js").PoolClient, shipmentLineId: string, quantity: number, refundId: string): Promise<void> {
  const line = (await client.query(`
    SELECT sl.*, s.seller_id, s.delivered_on, p.category FROM shipment_lines sl
    JOIN shipments s ON s.shipment_id = sl.shipment_id
    JOIN listings l ON l.listing_id = sl.listing_id
    JOIN products p ON p.product_id = l.product_id
    WHERE sl.line_id = $1`, [shipmentLineId])).rows[0] as
    { line_id: string; shipment_id: string; seller_id: string; quantity: number; unit_price_paise: string; gst_rate: number; category: string; delivered_on: string } | undefined;
  if (!line) return;
  const sale = (await client.query("SELECT * FROM settlements WHERE shipment_line_id = $1 AND kind = 'sale'", [shipmentLineId])).rows[0] as
    { gross_paise: string; commission_percent: string; commission_paise: string; commission_gst_paise: string; tcs_paise: string; tds_paise: string; emi_subvention_paise: string; net_paise: string; quantity: number } | undefined;
  if (!sale) return;
  const k = quantity;
  const q = line.quantity;
  const negate = (v: number) => -divRound((v * k), q);
  await client.query(
    `INSERT INTO settlements (settlement_line_id, shipment_id, shipment_line_id, seller_id, kind, posted_on,
      gross_paise, commission_percent, commission_paise, commission_gst_paise, tcs_paise, tds_paise,
      emi_subvention_paise, net_paise, status, quantity, line_quantity, refund_id)
     VALUES ($1,$2,$3,$4,'return',$5,$6,$7,$8,$9,$10,$11,$12,$13,'payment_pending',$14,$15,$16)`,
    [id("SET"), line.shipment_id, shipmentLineId, line.seller_id, line.delivered_on,
      negate(Number(sale.gross_paise)), Number(sale.commission_percent),
      negate(Number(sale.commission_paise)), negate(Number(sale.commission_gst_paise)),
      negate(Number(sale.tcs_paise)), negate(Number(sale.tds_paise)), negate(Number(sale.emi_subvention_paise)),
      negate(Number(sale.net_paise)), k, q, refundId],
  );
}
