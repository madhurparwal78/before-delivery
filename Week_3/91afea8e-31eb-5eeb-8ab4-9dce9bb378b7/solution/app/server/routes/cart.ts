import type { Hono } from "hono";
import type { PoolClient } from "pg";
import { one, query, transaction } from "../db.js";
import { EMI_TENURES, type EmiTenure } from "../domain/emi.js";
import { EMI_MINIMUM_PAISE, MAX_CART_LINES, MAX_LINE_QUANTITY, MAX_SAVED_LINES } from "../domain/fees.js";
import { oneDayAvailable } from "../domain/promise.js";
import { ApiError, FIELD, notFound, validationFailed } from "../errors.js";
import { ok, route, type Reply, type Request } from "../http.js";
import { publicId } from "../id.js";
import { emiPlansBody } from "./catalogue.js";
import { loadSellers, PINCODE, sellerLane, type ListingRow } from "../services/catalogue.js";
import { buildQuote, emiAmount, ensureCart, loadCoupon, quoteJson, type PaymentMethod } from "../services/quote.js";
import { couponDiscount } from "../domain/coupon.js";
import { Body, isRecord, noFields } from "../validate.js";

const METHODS: readonly PaymentMethod[] = ["upi", "card", "netbanking", "emi", "cod"];

interface LineRecord {
  id: string;
  listing_id: string;
  quantity: number;
  saved: boolean;
}

function accountId(req: Request): string {
  return (req.actor as NonNullable<Request["actor"]>).accountId;
}

async function quoteReply(req: Request, status = 200): Promise<Reply> {
  return ok(quoteJson(await buildQuote(accountId(req), req.nowMs)), status);
}

/** Serialises every mutation of one shopper's cart. */
async function lockedCart<T>(account: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
  return transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`cart:${account}`]);
    await ensureCart(account, client);
    return work(client);
  });
}

function quantityField(body: Body, optional: boolean): number | undefined {
  return body.int("quantity", { min: 1, max: MAX_LINE_QUANTITY, message: FIELD.needsWholeNumber, tooHigh: FIELD.quantityOverTen, optional });
}

async function listingOf(id: string, client: PoolClient): Promise<ListingRow> {
  const listing = await one<ListingRow & Record<string, unknown>>("SELECT * FROM listings WHERE id = $1", [id], client);
  if (!listing) throw notFound();
  return listing;
}

async function inCartCount(account: string, client: PoolClient): Promise<number> {
  return (await one<{ n: number }>("SELECT count(*)::int AS n FROM cart_lines WHERE account_id = $1 AND NOT saved", [account], client))?.n ?? 0;
}

async function addLine(req: Request): Promise<Reply> {
  const account = accountId(req);
  const body = new Body(req.json(), ["listing_id", "quantity"]);
  const listingId = body.text("listing_id", { label: "Listing", min: 1, max: 40 });
  const quantity = quantityField(body, false);
  body.done();
  if (listingId === undefined || quantity === undefined) throw validationFailed({});
  await lockedCart(account, async (client) => {
    const listing = await listingOf(listingId, client);
    if (listing.status !== "live" || listing.stock === 0) throw new ApiError(409, "sold_out", {}, { listing_ids: [listing.id] });
    const existing = await one<LineRecord>("SELECT id, listing_id, quantity, saved FROM cart_lines WHERE account_id = $1 AND listing_id = $2", [account, listingId], client);
    const total = (existing?.quantity ?? 0) + quantity;
    if (total > MAX_LINE_QUANTITY) throw validationFailed({ quantity: FIELD.quantityOverTen });
    if (total > listing.stock) throw validationFailed({ quantity: FIELD.quantityOverStock });
    const count = await inCartCount(account, client);
    if (!existing || existing.saved) {
      if (count >= MAX_CART_LINES) throw validationFailed({ lines: FIELD.cartLines });
    }
    if (existing) {
      await query(
        "UPDATE cart_lines SET quantity = $2, saved = false, seq = CASE WHEN saved THEN nextval(pg_get_serial_sequence('cart_lines', 'seq')) ELSE seq END WHERE id = $1",
        [existing.id, total],
        client,
      );
    } else {
      await query("INSERT INTO cart_lines (id, account_id, listing_id, quantity) VALUES ($1, $2, $3, $4)", [publicId("CL"), account, listingId, quantity], client);
    }
  });
  return quoteReply(req, 201);
}

async function ownLine(account: string, lineId: string, client: PoolClient, saved: boolean): Promise<LineRecord> {
  const line = await one<LineRecord>("SELECT id, listing_id, quantity, saved FROM cart_lines WHERE id = $1 AND account_id = $2 AND saved = $3", [lineId, account, saved], client);
  if (!line) throw notFound();
  return line;
}

async function patchLine(req: Request): Promise<Reply> {
  const account = accountId(req);
  await lockedCart(account, async (client) => {
    const line = await ownLine(account, req.params.id as string, client, false);
    const body = new Body(req.json(), ["quantity", "selected", "gift_wrap", "gift_message"]);
    const quantity = quantityField(body, true);
    const selected = body.bool("selected", true);
    const giftWrap = body.bool("gift_wrap", true);
    const giftMessage = body.text("gift_message", { label: "Gift message", max: 240, optional: true });
    if (quantity !== undefined) {
      const listing = await listingOf(line.listing_id, client);
      if (quantity > listing.stock) body.fail("quantity", FIELD.quantityOverStock);
    }
    body.done();
    await query(
      `UPDATE cart_lines SET quantity = COALESCE($2, quantity), selected = COALESCE($3, selected),
              gift_wrap = COALESCE($4, gift_wrap), gift_message = COALESCE($5, gift_message) WHERE id = $1`,
      [line.id, quantity ?? null, selected ?? null, giftWrap ?? null, giftMessage ?? null],
      client,
    );
  });
  return quoteReply(req);
}

async function removeLine(req: Request): Promise<Reply> {
  const account = accountId(req);
  await lockedCart(account, async (client) => {
    const line = await one<{ id: string }>("SELECT id FROM cart_lines WHERE id = $1 AND account_id = $2", [req.params.id, account], client);
    if (!line) throw notFound();
    await query("DELETE FROM cart_lines WHERE id = $1", [line.id], client);
  });
  return quoteReply(req);
}

async function saveForLater(req: Request): Promise<Reply> {
  const account = accountId(req);
  noFields(req.json());
  await lockedCart(account, async (client) => {
    const line = await ownLine(account, req.params.id as string, client, false);
    const saved = (await one<{ n: number }>("SELECT count(*)::int AS n FROM cart_lines WHERE account_id = $1 AND saved", [account], client))?.n ?? 0;
    if (saved >= MAX_SAVED_LINES) throw validationFailed({ lines: FIELD.savedLines });
    await query("UPDATE cart_lines SET saved = true WHERE id = $1", [line.id], client);
  });
  return quoteReply(req);
}

async function moveToCart(req: Request): Promise<Reply> {
  const account = accountId(req);
  noFields(req.json());
  await lockedCart(account, async (client) => {
    const line = await ownLine(account, req.params.id as string, client, true);
    if ((await inCartCount(account, client)) >= MAX_CART_LINES) throw validationFailed({ lines: FIELD.cartLines });
    await query("UPDATE cart_lines SET saved = false, selected = true, seq = nextval(pg_get_serial_sequence('cart_lines', 'seq')) WHERE id = $1", [line.id], client);
  });
  return quoteReply(req);
}

async function moveToWishlist(req: Request): Promise<Reply> {
  const account = accountId(req);
  noFields(req.json());
  await lockedCart(account, async (client) => {
    const line = await ownLine(account, req.params.id as string, client, false);
    const listing = await listingOf(line.listing_id, client);
    const held = (await one<{ n: number }>("SELECT count(*)::int AS n FROM wishlist_items WHERE account_id = $1", [account], client))?.n ?? 0;
    const already = await one<{ id: string }>("SELECT id FROM wishlist_items WHERE account_id = $1 AND product_id = $2", [account, listing.product_id], client);
    if (!already && held >= 100) throw validationFailed({ lines: FIELD.wishlistFull });
    if (already) await query("UPDATE wishlist_items SET listing_id = $2 WHERE id = $1", [already.id, listing.id], client);
    else await query("INSERT INTO wishlist_items (id, account_id, product_id, listing_id) VALUES ($1, $2, $3, $4)", [publicId("WI"), account, listing.product_id, listing.id], client);
    await query("DELETE FROM cart_lines WHERE id = $1", [line.id], client);
  });
  return quoteReply(req);
}

async function setDestination(req: Request): Promise<Reply> {
  const account = accountId(req);
  const body = new Body(req.json(), ["address_id", "pincode"]);
  const addressId = body.text("address_id", { label: "Address", max: 40, optional: true });
  const pincode = body.text("pincode", { label: "Pincode", max: 6, optional: true });
  if (pincode !== undefined && !PINCODE.test(pincode)) body.fail("pincode", FIELD.badPincode);
  if (addressId === undefined && pincode === undefined) body.fail("pincode", FIELD.badPincode);
  body.done();
  await lockedCart(account, async (client) => {
    if (addressId !== undefined) {
      const found = await one<{ id: string }>("SELECT id FROM addresses WHERE id = $1 AND account_id = $2", [addressId, account], client);
      if (!found) throw validationFailed({ address_id: FIELD.badAddress });
    }
    await query("UPDATE carts SET destination_address_id = $2, destination_pincode = $3 WHERE account_id = $1", [account, addressId ?? null, addressId === undefined ? (pincode ?? null) : null], client);
  });
  return quoteReply(req);
}

async function setSpeed(req: Request): Promise<Reply> {
  const account = accountId(req);
  const body = new Body(req.json(), ["seller_id", "speed"]);
  const sellerId = body.text("seller_id", { label: "Seller", max: 40 });
  const speed = body.choice("speed", ["standard", "one_day"]);
  body.done();
  if (sellerId === undefined || speed === undefined) throw validationFailed({});
  const seller = (await loadSellers()).get(sellerId);
  if (!seller) throw validationFailed({ seller_id: FIELD.badChoice });
  const quote = await buildQuote(account, req.nowMs);
  if (speed === "one_day" && !(quote.destination.resolved && oneDayAvailable(sellerLane(seller), quote.destination.resolved))) {
    throw validationFailed({ speed: FIELD.oneDayUnavailable });
  }
  await lockedCart(account, async (client) => {
    await query(
      "INSERT INTO cart_speeds (account_id, seller_id, speed) VALUES ($1, $2, $3) ON CONFLICT (account_id, seller_id) DO UPDATE SET speed = EXCLUDED.speed",
      [account, sellerId, speed],
      client,
    );
  });
  return quoteReply(req);
}

async function applyCoupon(req: Request): Promise<Reply> {
  const account = accountId(req);
  const body = new Body(req.json(), ["code"]);
  const code = body.text("code", { label: "Coupon code", min: 1, max: 40 });
  body.done();
  if (code === undefined) throw validationFailed({});
  const coupon = await loadCoupon(code);
  const quote = await buildQuote(account, req.nowMs);
  if (!coupon || couponDiscount(coupon, quote.subtotalPaise) === null) throw validationFailed({ code: FIELD.badCoupon });
  await lockedCart(account, async (client) => {
    await query("UPDATE carts SET coupon_code = $2 WHERE account_id = $1", [account, coupon.code], client);
  });
  return quoteReply(req);
}

async function removeCoupon(req: Request): Promise<Reply> {
  await lockedCart(accountId(req), async (client) => {
    await query("UPDATE carts SET coupon_code = NULL WHERE account_id = $1", [accountId(req)], client);
  });
  return quoteReply(req);
}

async function setPayment(req: Request): Promise<Reply> {
  const account = accountId(req);
  const raw = req.json();
  const body = new Body(raw, ["method", "use_balance", "emi_tenure_months"]);
  const methodRaw = body.nested("method");
  const method = methodRaw === null ? null : ((METHODS as readonly unknown[]).includes(methodRaw) ? (methodRaw as PaymentMethod) : undefined);
  if (method === undefined) body.fail("method", FIELD.badChoice);
  const useBalance = body.bool("use_balance");
  const tenureRaw = body.nested("emi_tenure_months");
  const tenure = tenureRaw === null || tenureRaw === undefined ? null : ((EMI_TENURES as readonly unknown[]).includes(tenureRaw) ? (tenureRaw as EmiTenure) : undefined);
  if (tenure === undefined) body.fail("emi_tenure_months", FIELD.badTenure);
  body.done();
  if (method === undefined || useBalance === undefined || tenure === undefined) throw validationFailed({});
  const payment = { method, useBalance, emiTenureMonths: method === "emi" ? tenure : null };
  const quote = await buildQuote(account, req.nowMs, { payment });
  if (method === "emi") {
    if (useBalance) throw validationFailed({ use_balance: FIELD.emiNoBalance });
    if (tenure === null) throw validationFailed({ emi_tenure_months: FIELD.badTenure });
    if (emiAmount(quote) < EMI_MINIMUM_PAISE) throw validationFailed({ method: FIELD.emiMinimum });
  }
  if (method === "cod" && !quote.cod.eligible) throw validationFailed({ method: quote.cod.message as string });
  await lockedCart(account, async (client) => {
    await query(
      "UPDATE carts SET payment_method = $2, use_balance = $3, emi_tenure_months = $4 WHERE account_id = $1",
      [account, payment.method, payment.useBalance, payment.emiTenureMonths],
      client,
    );
  });
  return ok(quoteJson(quote));
}

async function cartEmiPlans(req: Request): Promise<Reply> {
  const quote = await buildQuote(accountId(req), req.nowMs);
  const selected = quote.lines.filter((line) => line.selected);
  return ok(emiPlansBody(emiAmount(quote), selected.length > 0 && selected.every((line) => line.listing.no_cost_emi)));
}

type MergeOutcome = "added" | "combined" | "capped" | "saved_for_later" | "unavailable";

async function merge(req: Request): Promise<Reply> {
  const account = accountId(req);
  const body = new Body(req.json(), ["lines"]);
  const raw = body.nested("lines");
  body.done();
  if (!Array.isArray(raw)) throw validationFailed({ lines: FIELD.badChoice });
  if (raw.length > 20) throw validationFailed({ lines: FIELD.mergeTooMany });
  const wanted = raw.map((entry: unknown, index) => {
    const item = isRecord(entry) ? entry : {};
    const check = new Body(item, ["listing_id", "quantity"]);
    const listingId = check.text("listing_id", { label: "Listing", min: 1, max: 40 });
    const quantity = quantityField(check, false);
    try {
      check.done();
    } catch {
      throw validationFailed({ [`lines.${index}`]: FIELD.badChoice });
    }
    return { listingId: listingId as string, quantity: quantity as number };
  });
  const results = await lockedCart(account, async (client) => {
    const out: { listing_id: string; title: string; outcome: MergeOutcome; quantity: number }[] = [];
    for (const { listingId, quantity } of wanted) {
      const found = await one<{ listing: ListingRow; title: string }>(
        "SELECT to_jsonb(l) AS listing, p.title FROM listings l JOIN products p ON p.id = l.product_id WHERE l.id = $1",
        [listingId],
        client,
      );
      if (!found || found.listing.status !== "live" || found.listing.stock === 0) {
        out.push({ listing_id: listingId, title: found?.title ?? listingId, outcome: "unavailable", quantity: 0 });
        continue;
      }
      const { listing, title } = found;
      const cap = Math.min(MAX_LINE_QUANTITY, listing.stock);
      const existing = await one<LineRecord>("SELECT id, listing_id, quantity, saved FROM cart_lines WHERE account_id = $1 AND listing_id = $2", [account, listingId], client);
      if (existing) {
        const total = existing.quantity + quantity;
        const next = Math.min(total, cap);
        await query("UPDATE cart_lines SET quantity = $2 WHERE id = $1", [existing.id, next], client);
        out.push({ listing_id: listingId, title, outcome: total > cap ? "capped" : "combined", quantity: next });
        continue;
      }
      const next = Math.min(quantity, cap);
      const full = (await inCartCount(account, client)) >= MAX_CART_LINES;
      await query("INSERT INTO cart_lines (id, account_id, listing_id, quantity, saved) VALUES ($1, $2, $3, $4, $5)", [publicId("CL"), account, listingId, next, full], client);
      out.push({ listing_id: listingId, title, outcome: full ? "saved_for_later" : next < quantity ? "capped" : "added", quantity: next });
    }
    return out;
  });
  return ok({ results, cart: quoteJson(await buildQuote(account, req.nowMs)) });
}

export function registerCart(app: Hono): void {
  const shopper = { access: ["shopper"] } as const;
  route(app, ["GET"], "/api/cart", shopper, (req) => quoteReply(req));
  route(app, ["POST"], "/api/cart/lines", shopper, addLine);
  route(app, ["PATCH"], "/api/cart/lines/:id", shopper, patchLine);
  route(app, ["DELETE"], "/api/cart/lines/:id", shopper, removeLine);
  route(app, ["POST"], "/api/cart/lines/:id/save-for-later", shopper, saveForLater);
  route(app, ["POST"], "/api/cart/saved/:id/move-to-cart", shopper, moveToCart);
  route(app, ["POST"], "/api/cart/lines/:id/move-to-wishlist", shopper, moveToWishlist);
  route(app, ["PUT"], "/api/cart/destination", shopper, setDestination);
  route(app, ["PUT"], "/api/cart/delivery-speed", shopper, setSpeed);
  route(app, ["POST"], "/api/cart/coupon", { access: ["shopper"], rate: { bucket: "coupon", limit: 10 } }, applyCoupon);
  route(app, ["DELETE"], "/api/cart/coupon", shopper, removeCoupon);
  route(app, ["PUT"], "/api/cart/payment", shopper, setPayment);
  route(app, ["GET"], "/api/cart/emi-plans", shopper, cartEmiPlans);
  route(app, ["POST"], "/api/cart/merge", shopper, merge);
}
