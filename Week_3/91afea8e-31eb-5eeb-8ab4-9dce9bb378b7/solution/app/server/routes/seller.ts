import { randomBytes } from "node:crypto";
import type { Hono } from "hono";
import type { PoolClient } from "pg";
import { detach } from "../background.js";
import { one, query, transaction } from "../db.js";
import { nextShipmentState } from "../domain/state.js";
import { todayInIndia } from "../domain/promise.js";
import { ApiError, FIELD, notFound, validationFailed } from "../errors.js";
import { noContent, ok, route, type Reply, type Request } from "../http.js";
import { publicId } from "../id.js";
import { recordPendingPurchases, type LegRow } from "../services/ledger.js";
import { deleteObject, getObject, putObject } from "../services/s3.js";
import { ProviderUnavailable } from "../services/provider.js";
import { labelKey } from "../services/documents.js";
import { decline, loadReturn, pickUp, returnView } from "../services/returns.js";
import { queueListing } from "../services/search.js";
import { postSales } from "../services/settlement.js";
import { legsRecorded, paymentRecorded, sellerViews } from "../services/views.js";
import { Body, noFields } from "../validate.js";
import type { ListingRow } from "../services/catalogue.js";

const QUOTA = 200;
const PHOTO_MAX_BYTES = 2_000_000;
const CERTIFICATE_MAX_BYTES = 5_000_000;
const PHOTOS_PER_LISTING = 6;
const CATEGORIES = ["kitchen", "fashion", "electronics", "beverages"] as const;

function sellerOf(req: Request): string {
  return (req.actor as NonNullable<Request["actor"]>).sellerId as string;
}

interface ListingJoin extends ListingRow {
  title: string;
  category: string;
  photo_count: number;
}

const LISTING_SELECT = `SELECT l.*, p.title, p.category, (SELECT count(*)::int FROM listing_photos ph WHERE ph.listing_id = l.id) AS photo_count
  FROM listings l JOIN products p ON p.id = l.product_id`;

async function listingView(row: ListingJoin, executor?: PoolClient): Promise<Record<string, unknown>> {
  const photos = await query<{ id: string }>("SELECT id FROM listing_photos WHERE listing_id = $1 ORDER BY seq", [row.id], executor);
  return {
    listing_id: row.id,
    product_id: row.product_id,
    title: row.title,
    category: row.category,
    price_paise: row.price_paise,
    cost_price_paise: row.cost_price_paise,
    stock: row.stock,
    status: row.status,
    photo_count: row.photo_count,
    cod_allowed: row.cod_allowed,
    no_cost_emi: row.no_cost_emi,
    description: row.description,
    return_note: row.return_note,
    photos: photos.map((photo) => ({ photo_id: photo.id, url: `/api/seller/listings/${row.id}/photos/${photo.id}` })),
    deal: row.deal_price_paise !== null && row.deal_ends_at !== null ? { price_paise: row.deal_price_paise, ends_at: new Date(row.deal_ends_at).toISOString() } : null,
  };
}

async function ownListing(req: Request, id: string, client?: PoolClient): Promise<ListingJoin> {
  const row = await one<ListingJoin & Record<string, unknown>>(`${LISTING_SELECT} WHERE l.id = $1 AND l.seller_id = $2`, [id, sellerOf(req)], client);
  if (!row) throw notFound();
  return row;
}

async function reply(req: Request, id: string, status = 200): Promise<Reply> {
  return ok(await listingView(await ownListing(req, id)), status);
}

function pageCursor(raw: string | null): number | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    return Array.isArray(parsed) && typeof parsed[0] === "number" ? parsed[0] : null;
  } catch {
    return null;
  }
}

function pageLimit(req: Request): number {
  const raw = req.query.get("limit");
  const limit = raw === null || raw === "" ? 24 : Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 24) throw validationFailed({ limit: FIELD.searchPageSize });
  return limit;
}

function encodeCursor(value: number): string {
  return Buffer.from(JSON.stringify([value])).toString("base64url");
}

async function listings(req: Request): Promise<Reply> {
  const limit = pageLimit(req);
  const q = req.query.get("q") ?? "";
  const status = req.query.get("status");
  const category = req.query.get("category");
  const args: unknown[] = [sellerOf(req)];
  const base = ["l.seller_id = $1"];
  if (q !== "") {
    args.push(`%${q.replace(/[\\%_]/g, "\\$&")}%`, q);
    base.push(`(p.title ILIKE $${args.length - 1} OR l.id = $${args.length})`);
  }
  if (status === "live" || status === "unlisted") {
    args.push(status);
    base.push(`l.status = $${args.length}`);
  }
  const facets = await query<{ category: string; n: number }>(
    `SELECT p.category, count(*)::int AS n FROM listings l JOIN products p ON p.id = l.product_id WHERE ${base.join(" AND ")} GROUP BY p.category`,
    args,
  );
  const rowArgs = [...args];
  const clauses = [...base];
  if (category) {
    rowArgs.push(category);
    clauses.push(`p.category = $${rowArgs.length}`);
  }
  const after = pageCursor(req.query.get("cursor"));
  if (after !== null) {
    rowArgs.push(after);
    clauses.push(`l.created_seq < $${rowArgs.length}`);
  }
  const rows = await query<ListingJoin & Record<string, unknown>>(`${LISTING_SELECT} WHERE ${clauses.join(" AND ")} ORDER BY l.created_seq DESC LIMIT ${limit + 1}`, rowArgs);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return ok({
    listings: await Promise.all(page.map((row) => listingView(row))),
    facets: { category: Object.fromEntries(facets.map((row) => [row.category, row.n])) },
    next_cursor: rows.length > limit && last ? encodeCursor(last.created_seq) : null,
  });
}

const slug = (title: string): string => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "product";

async function liveCount(sellerId: string, client?: PoolClient): Promise<number> {
  return (await one<{ n: number }>("SELECT count(*)::int AS n FROM listings WHERE seller_id = $1 AND status = 'live'", [sellerId], client))?.n ?? 0;
}

function descriptionFields(body: Body) {
  return {
    description: body.text("description", { label: "Description", max: 2000, optional: true }),
    returnNote: body.text("return_note", { label: "Return note", max: 500, optional: true }),
    price: body.int("price_paise", { min: 1, max: 10_000_000_000, message: FIELD.badPrice, optional: true }),
    cost: body.int("cost_price_paise", { min: 0, max: 10_000_000_000, message: FIELD.badPrice, optional: true }),
    stock: body.int("stock", { min: 0, max: 9999, message: FIELD.badStock, optional: true }),
    cod: body.bool("cod_allowed", true),
    noCostEmi: body.bool("no_cost_emi", true),
  };
}

async function createListing(req: Request): Promise<Reply> {
  const sellerId = sellerOf(req);
  const body = new Body(req.json(), ["product_id", "title", "brand", "category", "description", "price_paise", "cost_price_paise", "stock", "cod_allowed", "no_cost_emi", "return_note"]);
  const productId = body.text("product_id", { label: "Product", max: 80, optional: true });
  const fields = descriptionFields(body);
  const title = body.text("title", { label: "Title", min: 3, max: 120, optional: productId !== undefined });
  const brand = body.text("brand", { label: "Brand", min: 1, max: 60, optional: productId !== undefined });
  const category = body.choice("category", CATEGORIES, productId !== undefined);
  if (fields.price === undefined) body.fail("price_paise", FIELD.badPrice);
  if (fields.stock === undefined) body.fail("stock", FIELD.badStock);
  if (productId !== undefined && (title !== undefined || brand !== undefined || category !== undefined)) body.fail("product_id", FIELD.cantSet);
  if ((await liveCount(sellerId)) >= QUOTA) throw new ApiError(409, "listing_quota");
  body.done();
  const id = await transaction(async (client) => {
    let product = productId;
    if (product === undefined) {
      product = `${slug(title as string)}-${randomBytes(3).toString("hex")}`;
      await client.query("INSERT INTO products (id, title, brand, category, rating, description) VALUES ($1, $2, $3, $4, 0, $5)", [
        product, title, brand, category, fields.description ?? "",
      ]);
    } else if (!(await one("SELECT 1 FROM products WHERE id = $1", [product], client))) {
      throw validationFailed({ product_id: FIELD.badChoice });
    }
    const listingId = `L-${(await client.query("SELECT nextval('listing_ids') AS n")).rows[0].n}`;
    await client.query(
      `INSERT INTO listings (id, product_id, seller_id, price_paise, cost_price_paise, stock, status, description, return_note, cod_allowed, no_cost_emi)
       VALUES ($1, $2, $3, $4, $5, $6, 'live', $7, $8, $9, $10)`,
      [listingId, product, sellerId, fields.price, fields.cost ?? 0, fields.stock, fields.description ?? "", fields.returnNote ?? "", fields.cod ?? true, fields.noCostEmi ?? false],
    );
    await queueListing(listingId, req.nowMs, client);
    return listingId;
  });
  return reply(req, id, 201);
}

async function patchListing(req: Request): Promise<Reply> {
  const existing = await ownListing(req, req.params.id as string);
  const body = new Body(req.json(), ["title", "description", "price_paise", "cost_price_paise", "stock", "cod_allowed", "no_cost_emi", "return_note", "status"]);
  const title = body.text("title", { label: "Title", min: 3, max: 120, optional: true });
  const fields = descriptionFields(body);
  const status = body.choice("status", ["live", "unlisted"], true);
  const sole = (await one<{ n: number }>("SELECT count(*)::int AS n FROM listings WHERE product_id = $1", [existing.product_id]))?.n === 1;
  if (title !== undefined && !sole) body.fail("title", FIELD.cantSet);
  if (status === "live" && existing.status !== "live" && (await liveCount(sellerOf(req))) >= QUOTA) throw new ApiError(409, "listing_quota");
  body.done();
  await transaction(async (client) => {
    if (title !== undefined) await client.query("UPDATE products SET title = $2 WHERE id = $1", [existing.product_id, title]);
    await client.query(
      `UPDATE listings SET description = COALESCE($2, description), return_note = COALESCE($3, return_note), price_paise = COALESCE($4, price_paise),
              cost_price_paise = COALESCE($5, cost_price_paise), stock = COALESCE($6, stock), cod_allowed = COALESCE($7, cod_allowed),
              no_cost_emi = COALESCE($8, no_cost_emi), status = COALESCE($9, status) WHERE id = $1`,
      [existing.id, fields.description ?? null, fields.returnNote ?? null, fields.price ?? null, fields.cost ?? null, fields.stock ?? null, fields.cod ?? null, fields.noCostEmi ?? null, status ?? null],
    );
    await queueListing(existing.id, req.nowMs, client);
  });
  return reply(req, existing.id);
}

async function setStock(req: Request): Promise<Reply> {
  const existing = await ownListing(req, req.params.id as string);
  const body = new Body(req.json(), ["stock"]);
  const stock = body.int("stock", { min: 0, max: 9999, message: FIELD.badStock });
  body.done();
  await transaction(async (client) => {
    await client.query("UPDATE listings SET stock = $2 WHERE id = $1", [existing.id, stock]);
    await queueListing(existing.id, req.nowMs, client);
  });
  return reply(req, existing.id);
}

async function setDeal(req: Request): Promise<Reply> {
  const existing = await ownListing(req, req.params.id as string);
  const body = new Body(req.json(), ["deal_price_paise", "ends_at"]);
  const price = body.int("deal_price_paise", { min: 1, max: 10_000_000_000, message: FIELD.badDealPrice });
  const endsRaw = body.text("ends_at", { label: "Deal end", max: 40 });
  const ends = endsRaw === undefined ? Number.NaN : Date.parse(endsRaw);
  if (price !== undefined && price >= existing.price_paise) body.fail("deal_price_paise", FIELD.badDealPrice);
  if (endsRaw !== undefined && !(ends > req.nowMs)) body.fail("ends_at", FIELD.badDealEnd);
  body.done();
  await query("UPDATE listings SET deal_price_paise = $2, deal_ends_at = $3 WHERE id = $1", [existing.id, price, ends]);
  return reply(req, existing.id);
}

type ImageKind = { ext: "jpg" | "png" | "webp"; type: string };

/** The kind of image judged by the file's leading bytes, never by its name or declared type. */
function imageKind(data: Uint8Array): ImageKind | null {
  const head = Buffer.from(data.subarray(0, 12));
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { ext: "jpg", type: "image/jpeg" };
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: "png", type: "image/png" };
  if (head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP") return { ext: "webp", type: "image/webp" };
  return null;
}

function certificateKind(data: Uint8Array): { ext: "pdf" | "jpg" | "png"; type: string } | null {
  if (Buffer.from(data.subarray(0, 4)).toString("latin1") === "%PDF") return { ext: "pdf", type: "application/pdf" };
  const image = imageKind(data);
  return image && image.ext !== "webp" ? { ext: image.ext, type: image.type } : null;
}

async function storeUpload(key: string, data: Uint8Array, type: string): Promise<void> {
  try {
    await putObject(key, data, type);
  } catch (error) {
    if (error instanceof ProviderUnavailable) throw new ApiError(503, "storage_unavailable");
    throw error;
  }
}

async function uploadPhoto(req: Request): Promise<Reply> {
  const listing = await ownListing(req, req.params.id as string);
  if (listing.photo_count >= PHOTOS_PER_LISTING) throw new ApiError(409, "photo_limit");
  const file = req.file();
  if (!file) throw validationFailed({ file: FIELD.badFile });
  if (file.data.byteLength > PHOTO_MAX_BYTES) throw new ApiError(413, "file_too_large");
  const kind = imageKind(file.data);
  if (!kind) throw new ApiError(415, "unsupported_type");
  const photoId = publicId("PH");
  await storeUpload(`listings/${listing.id}/${photoId}.${kind.ext}`, file.data, kind.type);
  await query("INSERT INTO listing_photos (id, listing_id, ext) VALUES ($1, $2, $3)", [photoId, listing.id, kind.ext]);
  return ok({ photo_id: photoId, url: `/api/seller/listings/${listing.id}/photos/${photoId}` }, 201);
}

async function photoOf(req: Request): Promise<{ id: string; ext: "jpg" | "png" | "webp"; listing: string }> {
  const listing = await ownListing(req, req.params.id as string);
  const photo = await one<{ id: string; ext: "jpg" | "png" | "webp" }>("SELECT id, ext FROM listing_photos WHERE id = $1 AND listing_id = $2", [req.params.photo, listing.id]);
  if (!photo) throw notFound();
  return { ...photo, listing: listing.id };
}

async function uploadCertificate(req: Request): Promise<Reply> {
  const file = req.file();
  if (!file) throw validationFailed({ file: FIELD.badFile });
  if (file.data.byteLength > CERTIFICATE_MAX_BYTES) throw new ApiError(413, "file_too_large", { certificate: true });
  const kind = certificateKind(file.data);
  if (!kind) throw new ApiError(415, "unsupported_type", { certificate: true });
  const sellerId = sellerOf(req);
  await storeUpload(`sellers/${sellerId}/gst-certificate.${kind.ext}`, file.data, kind.type);
  for (const other of ["pdf", "jpg", "png"].filter((ext) => ext !== kind.ext)) {
    try {
      await deleteObject(`sellers/${sellerId}/gst-certificate.${other}`);
    } catch (error) {
      if (!(error instanceof ProviderUnavailable)) throw error;
    }
  }
  await query("UPDATE sellers SET gst_certificate_key = $2 WHERE id = $1", [sellerId, `sellers/${sellerId}/gst-certificate.${kind.ext}`]);
  return ok({ status: "stored" }, 201);
}

async function ownShipment(req: Request, client?: PoolClient): Promise<{ id: string; order_id: string; state: "placed" | "packed" | "shipped" | "delivered" | "cancelled"; label_stored: boolean; payment_method: string | null }> {
  const row = await one<{ id: string; order_id: string; state: "placed" | "packed" | "shipped" | "delivered" | "cancelled"; label_stored: boolean; payment_method: string | null }>(
    `SELECT s.id, s.order_id, s.state, s.label_stored, p.method AS payment_method FROM shipments s JOIN orders o ON o.id = s.order_id JOIN payments p ON p.id = o.payment_id
      WHERE s.id = $1 AND s.seller_id = $2`,
    [req.params.id, sellerOf(req)],
    client,
  );
  if (!row) throw notFound();
  return row;
}

async function move(req: Request, action: "pack" | "ship" | "deliver"): Promise<Reply> {
  noFields(req.json());
  const id = (await ownShipment(req)).id;
  await transaction(async (client) => {
    await client.query("SELECT id FROM shipments WHERE id = $1 FOR UPDATE", [id]);
    const shipment = await ownShipment(req, client);
    const next = nextShipmentState(shipment.state, action);
    if (action === "pack" && shipment.payment_method !== "cod") {
      const legs = await query<LegRow & Record<string, unknown>>("SELECT * FROM payment_legs WHERE order_id = $1", [shipment.order_id], client);
      if (!legsRecorded(shipment.id, legs)) throw new ApiError(409, "payment_pending");
    }
    if (action === "ship" && !shipment.label_stored) throw new ApiError(409, "label_pending");
    await client.query("UPDATE shipments SET state = $2, delivered_on = CASE WHEN $2 = 'delivered' THEN $3 ELSE delivered_on END WHERE id = $1", [id, next, todayInIndia(req.nowMs)]);
    await client.query("INSERT INTO shipment_events (shipment_id, state, at) VALUES ($1, $2, $3)", [id, next, req.nowMs]);
    if (action === "deliver") await postSales(id, req.nowMs, client);
  });
  if (action === "deliver") detach(recordPendingPurchases());
  return ok((await sellerViews([id])).get(id) as Record<string, unknown>);
}

async function shipmentLabel(req: Request): Promise<Reply> {
  const shipment = await ownShipment(req);
  if (shipment.label_stored) {
    try {
      const data = await getObject(labelKey(shipment.order_id, shipment.id));
      if (data) return { status: 200, file: { data, contentType: "application/pdf" } };
    } catch (error) {
      if (!(error instanceof ProviderUnavailable)) throw error;
    }
  }
  throw new ApiError(409, "document_pending");
}

async function shipments(req: Request): Promise<Reply> {
  const limit = pageLimit(req);
  const state = req.query.get("state");
  const after = pageCursor(req.query.get("cursor"));
  const rows = await query<{ id: string; seq: number }>(
    `SELECT id, seq FROM shipments WHERE seller_id = $1 AND ($2::text IS NULL OR state = $2) AND ($3::bigint IS NULL OR seq < $3) ORDER BY seq DESC LIMIT $4`,
    [sellerOf(req), state, after, limit + 1],
  );
  const page = rows.slice(0, limit);
  const views = await sellerViews(page.map((row) => row.id));
  const last = page[page.length - 1];
  return ok({
    shipments: page.map((row) => views.get(row.id) as Record<string, unknown>),
    next_cursor: rows.length > limit && last ? encodeCursor(last.seq) : null,
  });
}

async function sellerReturns(req: Request): Promise<Reply> {
  const ids = await query<{ id: string }>(
    `SELECT r.id FROM returns r JOIN shipment_lines sl ON sl.id = r.shipment_line_id JOIN shipments s ON s.id = sl.shipment_id
      WHERE s.seller_id = $1 ORDER BY r.seq DESC`,
    [sellerOf(req)],
  );
  return ok({ returns: await Promise.all(ids.map(async (row) => returnView(await loadReturn(row.id)))) });
}

async function ownReturn(req: Request) {
  const record = await loadReturn(req.params.id as string);
  if (record.seller_id !== sellerOf(req)) throw notFound();
  return record;
}

async function settlements(req: Request): Promise<Reply> {
  const date = /^\d{4}-\d{2}-\d{2}$/;
  const from = req.query.get("from");
  const to = req.query.get("to");
  const errors: Record<string, string> = {};
  if (from !== null && from !== "" && !date.test(from)) errors.from = FIELD.badChoice;
  if (to !== null && to !== "" && !date.test(to)) errors.to = FIELD.badChoice;
  if (Object.keys(errors).length > 0) throw validationFailed(errors);
  const rows = await query<Record<string, unknown> & { shipment_id: string }>(
    `SELECT st.*, sl.title FROM settlement_lines st JOIN shipment_lines sl ON sl.id = st.line_id
      WHERE st.seller_id = $1 AND ($2::text IS NULL OR $2 = '' OR st.posted_on >= $2) AND ($3::text IS NULL OR $3 = '' OR st.posted_on <= $3)
      ORDER BY st.posted_on, st.seq`,
    [sellerOf(req), from, to],
  );
  const recorded = new Map<string, boolean>();
  for (const shipmentId of new Set(rows.map((row) => row.shipment_id))) recorded.set(shipmentId, await paymentRecorded(shipmentId));
  const lines = rows.map((row) => ({
    settlement_line_id: row.id,
    shipment_id: row.shipment_id,
    line_id: row.line_id,
    title: row.title,
    kind: row.kind,
    posted_on: row.posted_on,
    gross_paise: row.gross_paise as number,
    commission_percent: row.commission_percent as number,
    commission_paise: row.commission_paise as number,
    commission_gst_paise: row.commission_gst_paise as number,
    tcs_paise: row.tcs_paise as number,
    tds_paise: row.tds_paise as number,
    emi_subvention_paise: row.emi_subvention_paise as number,
    net_paise: row.net_paise as number,
    status: recorded.get(row.shipment_id) ? "payment_confirmed" : "payment_pending",
  }));
  const sum = (key: "gross_paise" | "commission_paise" | "commission_gst_paise" | "tcs_paise" | "tds_paise" | "emi_subvention_paise" | "net_paise"): number =>
    lines.reduce((total, line) => total + line[key], 0);
  return ok({
    lines,
    totals: {
      gross_paise: sum("gross_paise"),
      commission_paise: sum("commission_paise"),
      commission_gst_paise: sum("commission_gst_paise"),
      tcs_paise: sum("tcs_paise"),
      tds_paise: sum("tds_paise"),
      emi_subvention_paise: sum("emi_subvention_paise"),
      net_paise: sum("net_paise"),
    },
  });
}

async function payoutAccount(req: Request): Promise<Reply> {
  const body = new Body(req.json(), ["account_holder", "ifsc", "account_number"]);
  const holder = body.text("account_holder", { label: "Name", min: 1, max: 80 });
  const ifsc = body.text("ifsc", { label: "IFSC", max: 11 });
  const number = body.text("account_number", { label: "Account number", max: 18 });
  if (ifsc !== undefined && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) body.fail("ifsc", FIELD.badIfsc);
  if (number !== undefined && !/^\d{9,18}$/.test(number)) body.fail("account_number", FIELD.badAccountNumber);
  body.done();
  const masked = `${"*".repeat((number as string).length - 4)}${(number as string).slice(-4)}`;
  await query("UPDATE sellers SET payout_holder = $2, payout_ifsc = $3, payout_masked = $4 WHERE id = $1", [sellerOf(req), holder, ifsc, masked]);
  return ok({ account_holder: holder, ifsc, account_number_masked: masked });
}

export function registerSeller(app: Hono): void {
  const seller = { access: ["seller"] } as const;
  route(app, ["GET"], "/api/seller/listings", seller, listings);
  route(app, ["POST"], "/api/seller/listings", seller, createListing);
  route(app, ["PATCH"], "/api/seller/listings/:id", seller, patchListing);
  route(app, ["PUT"], "/api/seller/listings/:id/stock", seller, setStock);
  route(app, ["PUT"], "/api/seller/listings/:id/deal", seller, setDeal);
  route(app, ["DELETE"], "/api/seller/listings/:id/deal", seller, async (req) => {
    const existing = await ownListing(req, req.params.id as string);
    await query("UPDATE listings SET deal_price_paise = NULL, deal_ends_at = NULL WHERE id = $1", [existing.id]);
    return noContent();
  });
  route(app, ["POST"], "/api/seller/listings/:id/photos", seller, uploadPhoto);
  route(app, ["GET"], "/api/seller/listings/:id/photos/:photo", seller, async (req) => {
    const photo = await photoOf(req);
    const data = await getObject(`listings/${photo.listing}/${photo.id}.${photo.ext}`).catch(() => null);
    if (!data) throw notFound();
    return { status: 200, file: { data, contentType: photo.ext === "jpg" ? "image/jpeg" : `image/${photo.ext}` } };
  });
  route(app, ["DELETE"], "/api/seller/listings/:id/photos/:photo", seller, async (req) => {
    const photo = await photoOf(req);
    try {
      await deleteObject(`listings/${photo.listing}/${photo.id}.${photo.ext}`);
    } catch (error) {
      if (error instanceof ProviderUnavailable) throw new ApiError(503, "storage_unavailable");
      throw error;
    }
    await query("DELETE FROM listing_photos WHERE id = $1", [photo.id]);
    return noContent();
  });
  route(app, ["POST"], "/api/seller/gst-certificate", seller, uploadCertificate);
  route(app, ["GET"], "/api/seller/low-stock", seller, async (req) =>
    ok({
      listings: (
        await query<{ id: string; title: string; stock: number }>(
          `SELECT l.id, p.title, l.stock FROM listings l JOIN products p ON p.id = l.product_id
            WHERE l.seller_id = $1 AND l.status = 'live' AND l.stock BETWEEN 1 AND 5 ORDER BY l.stock, l.created_seq DESC`,
          [sellerOf(req)],
        )
      ).map((row) => ({ listing_id: row.id, title: row.title, stock: row.stock })),
    }),
  );
  route(app, ["GET"], "/api/seller/commission-rates", seller, async () =>
    ok({ rates: (await query<{ slug: string; commission_percent: number }>("SELECT slug, commission_percent FROM categories ORDER BY slug")).map((row) => ({ category: row.slug, commission_percent: row.commission_percent })) }),
  );
  route(app, ["GET"], "/api/seller/shipments", seller, shipments);
  for (const action of ["pack", "ship", "deliver"] as const) route(app, ["POST"], `/api/seller/shipments/:id/${action}`, seller, (req) => move(req, action));
  route(app, ["GET"], "/api/seller/shipments/:id/label", seller, shipmentLabel);
  route(app, ["GET"], "/api/seller/returns", seller, sellerReturns);
  route(app, ["POST"], "/api/seller/returns/:id/pickup", seller, async (req) => {
    noFields(req.json());
    await ownReturn(req);
    return ok(await returnView(await pickUp(req.params.id as string, req.nowMs)));
  });
  route(app, ["POST"], "/api/seller/returns/:id/decline", seller, async (req) => {
    const record = await ownReturn(req);
    const body = new Body(req.json(), ["reason"]);
    const reason = body.text("reason", { label: "Reason", min: 10, max: 500 });
    body.done();
    return ok(await returnView(await decline(record.id, reason as string)));
  });
  route(app, ["GET"], "/api/seller/settlements", seller, settlements);
  route(app, ["PUT"], "/api/seller/payout-account", seller, payoutAccount);
}
