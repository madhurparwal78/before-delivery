import { Router, type Ctx } from "./http.js";
import { ApiError, copy, forbidden, notFound, signedOut, validationFailed } from "./errors.js";
import { config } from "./config.js";
import * as auth from "./auth.js";
import { one, query, withTransaction } from "./db.js";
import { buildQuote, loadCartSettings, type CartSettings } from "./quote.js";
import { id, shareToken, canonicalJson } from "./crypto.js";
import { unitPricePaise, deliversTo, promiseDate } from "./domain.js";
import { futureIso, istDateString } from "./time.js";
import { offersForProduct, pinRow, readBody, requireAccount, requireFields, str, codePoints, addressView, validateAddress, accountView, bankList } from "./api_catalog.js";

const router = new Router();
export default router;

interface CartLineRow {
  line_id: string; listing_id: string; quantity: number; selected: boolean;
  gift_wrap: boolean; gift_message: string; saved: boolean; created_seq: number;
  product_id: string; title: string; seller_id: string;
}

async function cartCount(accountId: string): Promise<number> {
  const row = await one<{ n: string }>("SELECT count(*) AS n FROM cart_lines WHERE account_id = $1 AND saved = false", [accountId]);
  return Number(row?.n ?? 0);
}

async function saveSettings(accountId: string, patch: Partial<CartSettings>): Promise<void> {
  const current = await loadCartSettings(accountId);
  const next: CartSettings = { ...current, ...patch };
  await query(
    `INSERT INTO cart_settings (account_id, destination, coupon_code, method, use_balance, emi_tenure_months, speeds)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (account_id) DO UPDATE SET destination = $2, coupon_code = $3, method = $4,
       use_balance = $5, emi_tenure_months = $6, speeds = $7`,
    [accountId, JSON.stringify(next.destination), next.coupon_code, next.method, next.use_balance, next.emi_tenure_months, JSON.stringify(next.speeds)],
  );
}

router.add("GET", "/api/cart", async (ctx) => {
  requireAccount(ctx, ["shopper"]);
  return buildQuote(ctx.account!.id, new Date());
});

router.add("POST", "/api/cart/lines", async (ctx) => {
  requireAccount(ctx, ["shopper"]);
  const body = await readBody(ctx);
  requireFields(body, ["listing_id", "quantity"]);
  const listingId = str(body.listing_id);
  const quantity = Number(body.quantity);
  const listing = await one<{ listing_id: string; seller_id: string; stock: number; status: string }>(
    "SELECT listing_id, seller_id, stock, status FROM listings WHERE listing_id = $1", [listingId],
  );
  if (!listing || listing.status !== "live" || listing.stock <= 0) {
    throw new ApiError(409, "sold_out", copy.soldOutCheckout);
  }
  const fields: Record<string, string> = {};
  if (!Number.isInteger(quantity) || quantity < 1) fields.quantity = copy.field.quantityOver10;
  else if (quantity > 10) fields.quantity = copy.field.quantityOver10;
  const existing = await one<{ line_id: string; quantity: number }>(
    "SELECT line_id, quantity FROM cart_lines WHERE account_id = $1 AND listing_id = $2 AND saved = false", [ctx.account!.id, listingId],
  );
  const newQuantity = (existing?.quantity ?? 0) + quantity;
  if (newQuantity > 10) fields.quantity = copy.field.quantityOver10;
  if (existing && newQuantity > listing.stock) fields.quantity = copy.field.quantityOverStock;
  if (!existing && (await cartCount(ctx.account!.id)) >= 10) fields.lines = copy.field.eleventhLine;
  if (Object.keys(fields).length) throw validationFailed(fields);

  if (existing) {
    await query("UPDATE cart_lines SET quantity = $3 WHERE line_id = $1 AND account_id = $2", [existing.line_id, ctx.account!.id, newQuantity]);
  } else {
    const seq = Date.now();
    await query(
      `INSERT INTO cart_lines (line_id, account_id, listing_id, quantity, selected, gift_wrap, gift_message, saved, created_seq)
       VALUES ($1,$2,$3,$4,true,false,'',false,$5)`,
      [id("CL"), ctx.account!.id, listingId, quantity, seq],
    );
  }
  ctx.res.statusCode = 201;
  return buildQuote(ctx.account!.id, new Date());
});

router.add("PATCH", "/api/cart/lines/:line_id", async (ctx) => {
  requireAccount(ctx, ["shopper"]);
  const body = await readBody(ctx);
  requireFields(body, ["quantity", "selected", "gift_wrap", "gift_message"]);
  const line = await one<{ line_id: string; listing_id: string; quantity: number }>(
    "SELECT line_id, listing_id, quantity FROM cart_lines WHERE line_id = $1 AND account_id = $2 AND saved = false", [ctx.params.line_id, ctx.account!.id],
  );
  if (!line) throw notFound();
  const fields: Record<string, string> = {};
  let quantity = line.quantity;
  let selected: boolean | undefined;
  let giftWrap: boolean | undefined;
  let giftMessage: string | undefined;
  if (body.quantity !== undefined) {
    const q = Number(body.quantity);
    if (!Number.isInteger(q) || q < 1) fields.quantity = copy.field.quantityOver10;
    else if (q > 10) fields.quantity = copy.field.quantityOver10;
    else {
      const listing = await one<{ stock: number; status: string }>("SELECT stock, status FROM listings WHERE listing_id = $1", [line.listing_id]);
      if (!listing || listing.status !== "live" || q > listing.stock) fields.quantity = copy.field.quantityOverStock;
      quantity = q;
    }
  }
  if (body.selected !== undefined) selected = body.selected === true;
  if (body.gift_wrap !== undefined) giftWrap = body.gift_wrap === true;
  if (body.gift_message !== undefined) {
    giftMessage = str(body.gift_message);
    if (codePoints(giftMessage) > 240) fields.gift_message = copy.field.maxLength("Gift message", 240);
  }
  if (Object.keys(fields).length) throw validationFailed(fields);
  await query(
    `UPDATE cart_lines SET quantity = $3, selected = coalesce($4, selected), gift_wrap = coalesce($5, gift_wrap),
       gift_message = coalesce($6, gift_message) WHERE line_id = $1 AND account_id = $2`,
    [line.line_id, ctx.account!.id, quantity, selected, giftWrap, giftMessage],
  );
  return buildQuote(ctx.account!.id, new Date());
});

router.add("DELETE", "/api/cart/lines/:line_id", async (ctx) => {
  requireAccount(ctx, ["shopper"]);
  const res = await query("DELETE FROM cart_lines WHERE line_id = $1 AND account_id = $2 RETURNING line_id", [ctx.params.line_id, ctx.account!.id]);
  if (res.length === 0) throw notFound();
  return buildQuote(ctx.account!.id, new Date());
});

router.add("POST", "/api/cart/lines/:line_id/save-for-later", async (ctx) => {
  requireAccount(ctx, ["shopper"]);
  const res = await query(
    "UPDATE cart_lines SET saved = true, selected = false WHERE line_id = $1 AND account_id = $2 AND saved = false RETURNING line_id",
    [ctx.params.line_id, ctx.account!.id],
  );
  if (res.length === 0) throw notFound();
  return buildQuote(ctx.account!.id, new Date());
});

router.add("POST", "/api/cart/saved/:line_id/move-to-cart", async (ctx) => {
  requireAccount(ctx, ["shopper"]);
  const res = await query(
    "UPDATE cart_lines SET saved = false, selected = true WHERE line_id = $1 AND account_id = $2 AND saved = true RETURNING line_id",
    [ctx.params.line_id, ctx.account!.id],
  );
  if (res.length === 0) throw notFound();
  if ((await cartCount(ctx.account!.id)) > 10) throw validationFailed({ lines: copy.field.eleventhLine });
  return buildQuote(ctx.account!.id, new Date());
});

router.add("POST", "/api/cart/lines/:line_id/move-to-wishlist", async (ctx) => {
  requireAccount(ctx, ["shopper"]);
  const line = await one<{ line_id: string; listing_id: string; product_id: string }>(`
    SELECT cl.line_id, cl.listing_id, p.product_id FROM cart_lines cl
    JOIN listings l ON l.listing_id = cl.listing_id JOIN products p ON p.product_id = l.product_id
    WHERE cl.line_id = $1 AND cl.account_id = $2`, [ctx.params.line_id, ctx.account!.id]);
  if (!line) throw notFound();
  const existing = await one<{ item_id: string }>(
    "SELECT item_id FROM wishlist_items WHERE account_id = $1 AND product_id = $2", [ctx.account!.id, line.product_id],
  );
  if (!existing) {
    const count = await one<{ n: string }>("SELECT count(*) AS n FROM wishlist_items WHERE account_id = $1", [ctx.account!.id]);
    if (Number(count?.n ?? 0) >= 100) throw validationFailed({ items: "Wishlist can hold up to 100 items." });
    await query(
      "INSERT INTO wishlist_items (item_id, account_id, product_id, listing_id, created_seq) VALUES ($1,$2,$3,$4,$5)",
      [id("WI"), ctx.account!.id, line.product_id, line.listing_id, Date.now()],
    );
  }
  await query("DELETE FROM cart_lines WHERE line_id = $1 AND account_id = $2", [line.line_id, ctx.account!.id]);
  return buildQuote(ctx.account!.id, new Date());
});

router.add("PUT", "/api/cart/destination", async (ctx) => {
  requireAccount(ctx, ["shopper"]);
  const body = await readBody(ctx);
  requireFields(body, ["address_id", "pincode"]);
  if (body.address_id !== undefined) {
    const addressId = str(body.address_id);
    const address = await one<{ address_id: string; pincode: string }>(
      "SELECT address_id, pincode FROM addresses WHERE address_id = $1 AND account_id = $2", [addressId, ctx.account!.id],
    );
    if (!address) throw validationFailed({ address_id: "Choose one of your addresses." });
    await saveSettings(ctx.account!.id, { destination: { address_id: address.address_id, pincode: address.pincode } });
  } else if (body.pincode !== undefined) {
    const pin = str(body.pincode);
    if (!/^\d{6}$/.test(pin) || pin.startsWith("0")) throw validationFailed({ pincode: copy.field.badPincode });
    await saveSettings(ctx.account!.id, { destination: { address_id: null, pincode: pin } });
  } else {
    throw validationFailed({ pincode: copy.field.badPincode });
  }
  return buildQuote(ctx.account!.id, new Date());
});

router.add("PUT", "/api/cart/delivery-speed", async (ctx) => {
  requireAccount(ctx, ["shopper"]);
  const body = await readBody(ctx);
  requireFields(body, ["seller_id", "speed"]);
  const sellerId = str(body.seller_id);
  const speed = str(body.speed);
  if (speed !== "standard" && speed !== "one_day") throw validationFailed({ speed: "Speed is standard or one day." });
  const settings = await loadCartSettings(ctx.account!.id);
  const speeds = { ...settings.speeds, [sellerId]: speed };
  await saveSettings(ctx.account!.id, { speeds });
  const quote = await buildQuote(ctx.account!.id, new Date());
  const parcel = quote.parcels.find((p) => p.seller_id === sellerId);
  if (speed === "one_day" && parcel && !parcel.one_day_available) {
    throw validationFailed({ speed: copy.field.oneDayUnavailable });
  }
  return quote;
});

router.add("POST", "/api/cart/coupon", async (ctx) => {
  requireAccount(ctx, ["shopper"]);
  const body = await readBody(ctx);
  requireFields(body, ["code"]);
  const code = str(body.code);
  const rl = await auth.rateLimit(`coupon:${ctx.account!.id}`, 10);
  if (!rl.allowed) throw new ApiError(429, "rate_limited", copy.rateLimited(rl.retryAfter), { retryAfter: rl.retryAfter });
  const coupon = await one<{ code: string; kind: string; value: string; min_subtotal_paise: string; max_discount_paise: string | null; expires_at: string | null; active: boolean }>(
    "SELECT * FROM coupons WHERE code = $1", [code],
  );
  const settings = await loadCartSettings(ctx.account!.id);
  await saveSettings(ctx.account!.id, { coupon_code: code });
  const quote = await buildQuote(ctx.account!.id, new Date());
  if (!coupon || !coupon.active || quote.discount_paise === 0) {
    await saveSettings(ctx.account!.id, { coupon_code: null });
    throw validationFailed({ code: copy.field.badCoupon });
  }
  return quote;
});

router.add("DELETE", "/api/cart/coupon", async (ctx) => {
  requireAccount(ctx, ["shopper"]);
  await saveSettings(ctx.account!.id, { coupon_code: null });
  return buildQuote(ctx.account!.id, new Date());
});

router.add("PUT", "/api/cart/payment", async (ctx) => {
  requireAccount(ctx, ["shopper"]);
  const body = await readBody(ctx);
  requireFields(body, ["method", "use_balance", "emi_tenure_months"]);
  const method = body.method === null ? null : str(body.method);
  const useBalance = body.use_balance === true;
  const tenure = body.emi_tenure_months === null || body.emi_tenure_months === undefined ? null : Number(body.emi_tenure_months);
  if (method !== null && !["upi", "card", "netbanking", "emi", "cod"].includes(method)) {
    throw validationFailed({ method: "Choose a published payment method." });
  }
  if (tenure !== null && ![3, 6, 9, 12].includes(tenure)) {
    throw validationFailed({ method: "Tenure is 3, 6, 9 or 12 months." });
  }
  if (method === "emi" && useBalance) {
    throw validationFailed({ method: "EMI cannot be combined with balance." });
  }
  await saveSettings(ctx.account!.id, { method, use_balance: useBalance, emi_tenure_months: tenure });
  const quote = await buildQuote(ctx.account!.id, new Date());
  if (method === "cod") {
    await checkCodEligibility(ctx.account!.id, quote);
  }
  return quote;
});

async function checkCodEligibility(accountId: string, quote: Awaited<ReturnType<typeof buildQuote>>): Promise<void> {
  const settings = await loadCartSettings(accountId);
  const pin = settings.destination.pincode;
  const pinR = await pinRow(pin);
  const open = await countOpenCod(accountId);
  let reason: string | null = null;
  let message: string | null = null;
  for (const p of quote.parcels) {
    if (!p.serviceable) continue;
  }
  const sellerRows = await query<{ seller_id: string; name: string; cod_allowed: boolean }>("SELECT seller_id, name, cod_allowed FROM sellers");
  const sellerMap = new Map(sellerRows.map((s) => [s.seller_id, s]));
  for (const line of quote.lines.filter((l) => l.selected && l.in_stock)) {
    const listing = await one<{ seller_id: string; cod_allowed: boolean }>("SELECT seller_id, cod_allowed FROM listings WHERE listing_id = $1", [line.listing_id]);
    const seller = sellerMap.get(listing?.seller_id ?? "");
    if (listing && (!listing.cod_allowed || !seller?.cod_allowed)) {
      reason = "cod_seller"; message = copy.codSeller(seller?.name ?? ""); break;
    }
  }
  if (!reason && (!pinR || !pinR.cod_available)) {
    reason = "cod_pincode"; message = copy.codPincode(pin);
  }
  if (!reason && open >= 3) {
    reason = "cod_open_orders"; message = copy.codOpenOrders;
  }
  if (!reason && quote.due_paise > 5000000) {
    reason = "cod_over_cap"; message = copy.codOverCap;
  }
  if (reason) {
    await saveSettings(accountId, { method: null });
    throw validationFailed({ method: message ?? "" });
  }
}

export async function countOpenCod(accountId: string): Promise<number> {
  const rows = await query<{ n: string }>(`
    SELECT count(*) AS n FROM orders o
    JOIN payments pm ON pm.order_id = o.order_id
    WHERE o.account_id = $1 AND pm.method = 'cod'
      AND EXISTS (SELECT 1 FROM shipments sh WHERE sh.order_id = o.order_id AND sh.state IN ('placed','packed','shipped'))`,
    [accountId]);
  return Number(rows[0]?.n ?? 0);
}

router.add("GET", "/api/cart/emi-plans", async (ctx) => {
  requireAccount(ctx, ["shopper"]);
  const quote = await buildQuote(ctx.account!.id, new Date());
  const settings = await loadCartSettings(ctx.account!.id);
  const selected = quote.lines.filter((l) => l.selected && l.in_stock);
  const amount = selected.reduce((a, l) => a + l.line_total_paise, 0) - quote.discount_paise;
  if (amount < 300000) throw validationFailed({ amount: copy.field.emiTooSmall });
  const noCost = [3, 6].includes(settings.emi_tenure_months ?? 0);
  const allNoCost = await query<{ ok: boolean }>(
    "SELECT bool_and(no_cost_emi) AS ok FROM listings WHERE listing_id = ANY($1::text[])",
    [selected.map((l) => l.listing_id)],
  );
  const emiAvailable = noCost && (allNoCost[0]?.ok ?? false);
  const { emiPlans } = await import("./domain.js");
  return { amount_paise: amount, monthly_rate_percent: "1.25", plans: emiPlans(emiAvailable, amount) };
});

// ---------- wishlist ----------

router.add("GET", "/api/wishlist", async (ctx) => {
  requireAccount(ctx, ["shopper"]);
  const rows = await query<{ item_id: string; product_id: string; listing_id: string; title: string; brand: string; price_paise: string; deal_price_paise: string | null; deal_ends_at: string | null; stock: number; status: string }>(`
    SELECT w.item_id, w.product_id, w.listing_id, p.title, p.brand, l.price_paise, l.deal_price_paise, l.deal_ends_at, l.stock, l.status
    FROM wishlist_items w JOIN products p ON p.product_id = w.product_id JOIN listings l ON l.listing_id = w.listing_id
    WHERE w.account_id = $1 ORDER BY w.created_seq`, [ctx.account!.id]);
  const now = new Date();
  return {
    items: rows.map((r) => ({
      item_id: r.item_id, product_id: r.product_id, listing_id: r.listing_id, title: r.title, brand: r.brand,
      image_url: `/img/listings/${r.listing_id}.svg`,
      price_paise: unitPricePaise({ price_paise: Number(r.price_paise), deal_price_paise: r.deal_price_paise ? Number(r.deal_price_paise) : null, deal_ends_at: r.deal_ends_at }, now),
      in_stock: r.status === "live" && r.stock > 0,
    })),
  };
});

router.add("POST", "/api/wishlist", async (ctx) => {
  requireAccount(ctx, ["shopper"]);
  const body = await readBody(ctx);
  requireFields(body, ["product_id", "listing_id"]);
  const productId = str(body.product_id);
  let listingId = body.listing_id === undefined || body.listing_id === null ? null : str(body.listing_id);
  const product = await one<{ product_id: string }>("SELECT product_id FROM products WHERE product_id = $1", [productId]);
  if (!product) throw validationFailed({ product_id: "Choose a product." });
  if (listingId === null) {
    const offers = await offersForProduct(productId, null);
    const featured = offers.find((o) => o.featured) ?? offers.find((o) => o.in_stock);
    if (!featured) throw validationFailed({ listing_id: "No live listing." });
    listingId = featured.listing_id as string;
  } else {
    const listing = await one<{ listing_id: string; product_id: string }>(
      "SELECT listing_id, product_id FROM listings WHERE listing_id = $1", [listingId]);
    if (!listing) throw validationFailed({ listing_id: "Choose a live listing." });
    if (listing.product_id !== productId) throw validationFailed({ listing_id: "That listing belongs to another product." });
  }
  const existing = await one<{ item_id: string }>(
    "SELECT item_id FROM wishlist_items WHERE account_id = $1 AND product_id = $2", [ctx.account!.id, productId]);
  if (existing) {
    await query("UPDATE wishlist_items SET listing_id = $3 WHERE item_id = $1", [existing.item_id, ctx.account!.id, listingId]);
    ctx.res.statusCode = 200;
  } else {
    const count = await one<{ n: string }>("SELECT count(*) AS n FROM wishlist_items WHERE account_id = $1", [ctx.account!.id]);
    if (Number(count?.n ?? 0) >= 100) throw validationFailed({ items: "Wishlist can hold up to 100 items." });
    await query(
      "INSERT INTO wishlist_items (item_id, account_id, product_id, listing_id, created_seq) VALUES ($1,$2,$3,$4,$5)",
      [id("WI"), ctx.account!.id, productId, listingId, Date.now()],
    );
    ctx.res.statusCode = 201;
  }
  return { item_id: (await one<{ item_id: string }>("SELECT item_id FROM wishlist_items WHERE account_id = $1 AND product_id = $2", [ctx.account!.id, productId]))!.item_id };
});

router.add("DELETE", "/api/wishlist/:item_id", async (ctx) => {
  requireAccount(ctx, ["shopper"]);
  const res = await query("DELETE FROM wishlist_items WHERE item_id = $1 AND account_id = $2 RETURNING item_id", [ctx.params.item_id, ctx.account!.id]);
  if (res.length === 0) throw notFound();
  ctx.res.statusCode = 204;
  return null;
});

// ---------- share links ----------

router.add("POST", "/api/wishlist/share", async (ctx) => {
  return shareCreate(ctx, "wishlist");
});
router.add("POST", "/api/cart/share", async (ctx) => {
  return shareCreate(ctx, "cart");
});

async function shareCreate(ctx: Ctx, kind: "wishlist" | "cart"): Promise<unknown> {
  requireAccount(ctx, ["shopper"]);
  const body = await readBody(ctx);
  requireFields(body, ["display_name"]);
  const displayName = str(body.display_name);
  if (codePoints(displayName) < 1 || codePoints(displayName) > 40) throw validationFailed({ display_name: copy.field.maxLength("Name to show", 40) });
  const existing = await one<{ token: string; display_name: string; expires_at: string; created_at: string }>(
    "SELECT * FROM share_links WHERE account_id = $1 AND kind = $2", [ctx.account!.id, kind],
  );
  const expiresAt = new Date(Date.now() + config.timing.shareTtlSeconds * 1000);
  if (existing) {
    ctx.res.statusCode = 200;
    return { token: existing.token, url: `/s/${existing.token}`, display_name: existing.display_name, expires_at: futureIso(new Date(existing.expires_at).getTime()) };
  }
  const token = shareToken();
  await query(
    "INSERT INTO share_links (token, kind, account_id, display_name, expires_at) VALUES ($1,$2,$3,$4,$5)",
    [token, kind, ctx.account!.id, displayName, expiresAt],
  );
  ctx.res.statusCode = 201;
  return { token, url: `/s/${token}`, display_name: displayName, expires_at: futureIso(expiresAt.getTime()) };
}

router.add("POST", "/api/wishlist/share/regenerate", async (ctx) => {
  return shareRegenerate(ctx, "wishlist");
});
router.add("POST", "/api/cart/share/regenerate", async (ctx) => {
  return shareRegenerate(ctx, "cart");
});

async function shareRegenerate(ctx: Ctx, kind: "wishlist" | "cart"): Promise<unknown> {
  requireAccount(ctx, ["shopper"]);
  const body = await readBody(ctx);
  requireFields(body, ["display_name"]);
  const displayName = str(body.display_name);
  if (codePoints(displayName) < 1 || codePoints(displayName) > 40) throw validationFailed({ display_name: copy.field.maxLength("Name to show", 40) });
  await query("DELETE FROM share_links WHERE account_id = $1 AND kind = $2", [ctx.account!.id, kind]);
  const token = shareToken();
  const expiresAt = new Date(Date.now() + config.timing.shareTtlSeconds * 1000);
  await query(
    "INSERT INTO share_links (token, kind, account_id, display_name, expires_at) VALUES ($1,$2,$3,$4,$5)",
    [token, kind, ctx.account!.id, displayName, expiresAt],
  );
  ctx.res.statusCode = 201;
  return { token, url: `/s/${token}`, display_name: displayName, expires_at: futureIso(expiresAt.getTime()) };
}

router.add("DELETE", "/api/wishlist/share", async (ctx) => {
  return shareDelete(ctx, "wishlist");
});
router.add("DELETE", "/api/cart/share", async (ctx) => {
  return shareDelete(ctx, "cart");
});

async function shareDelete(ctx: Ctx, kind: "wishlist" | "cart"): Promise<unknown> {
  requireAccount(ctx, ["shopper"]);
  await query("DELETE FROM share_links WHERE account_id = $1 AND kind = $2", [ctx.account!.id, kind]);
  ctx.res.statusCode = 204;
  return null;
}

router.add("GET", "/api/shared/:token", async (ctx) => {
  const rl = await auth.rateLimit(`shared:${ctx.ip}`, 30);
  if (!rl.allowed) throw new ApiError(429, "rate_limited", copy.rateLimited(rl.retryAfter), { retryAfter: rl.retryAfter });
  const link = await one<{ token: string; kind: string; account_id: string; display_name: string; expires_at: string }>(
    "SELECT * FROM share_links WHERE token = $1", [ctx.params.token],
  );
  if (!link || new Date(link.expires_at).getTime() <= Date.now()) {
    throw new ApiError(404, "link_not_found", copy.linkNotFound);
  }
  const items = await sharedItems(link.kind, link.account_id);
  return { kind: link.kind, display_name: link.display_name, items };
});

async function sharedItems(kind: string, ownerId: string): Promise<Array<{ product_id: string; listing_id: string; title: string; image_url: string; price_paise: number }>> {
  const now = new Date();
  if (kind === "wishlist") {
    const rows = await query<{ product_id: string; listing_id: string; title: string; price_paise: string; deal_price_paise: string | null; deal_ends_at: string | null }>(`
      SELECT w.product_id, w.listing_id, p.title, l.price_paise, l.deal_price_paise, l.deal_ends_at
      FROM wishlist_items w JOIN products p ON p.product_id = w.product_id JOIN listings l ON l.listing_id = w.listing_id
      WHERE w.account_id = $1 ORDER BY w.created_seq`, [ownerId]);
    return rows.map((r) => ({
      product_id: r.product_id, listing_id: r.listing_id, title: r.title,
      image_url: `/img/listings/${r.listing_id}.svg`,
      price_paise: unitPricePaise({ price_paise: Number(r.price_paise), deal_price_paise: r.deal_price_paise ? Number(r.deal_price_paise) : null, deal_ends_at: r.deal_ends_at }, now),
    }));
  }
  const rows = await query<{ product_id: string; listing_id: string; title: string; price_paise: string; deal_price_paise: string | null; deal_ends_at: string | null }>(`
    SELECT l.product_id, cl.listing_id, p.title, l.price_paise, l.deal_price_paise, l.deal_ends_at
    FROM cart_lines cl JOIN listings l ON l.listing_id = cl.listing_id JOIN products p ON p.product_id = l.product_id
    WHERE cl.account_id = $1 AND cl.saved = false AND cl.selected = true ORDER BY cl.created_seq`, [ownerId]);
  return rows.map((r) => ({
    product_id: r.product_id, listing_id: r.listing_id, title: r.title,
    image_url: `/img/listings/${r.listing_id}.svg`,
    price_paise: unitPricePaise({ price_paise: Number(r.price_paise), deal_price_paise: r.deal_price_paise ? Number(r.deal_price_paise) : null, deal_ends_at: r.deal_ends_at }, now),
  }));
}

// ---------- guest cart merge ----------

router.add("POST", "/api/cart/merge", async (ctx) => {
  requireAccount(ctx, ["shopper"]);
  const body = await readBody(ctx);
  requireFields(body, ["lines"]);
  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (lines.length > 20) throw validationFailed({ lines: "Merge up to 20 lines." });
  const results: Array<{ listing_id: string; title: string; outcome: string; quantity: number }> = [];
  for (const raw of lines) {
    const item = raw as Record<string, unknown>;
    const listingId = str(item.listing_id);
    const quantity = Number(item.quantity);
    if (!listingId || !Number.isInteger(quantity) || quantity < 1) {
      throw validationFailed({ lines: "Each line needs a listing and a quantity." });
    }
    const listing = await one<{ listing_id: string; title: string; stock: number; status: string; seller_id: string }>(
      "SELECT l.listing_id, p.title, l.stock, l.status, l.seller_id FROM listings l JOIN products p ON p.product_id = l.product_id WHERE l.listing_id = $1", [listingId],
    );
    if (!listing || listing.status !== "live" || listing.stock <= 0) {
      results.push({ listing_id: listingId, title: listing?.title ?? "", outcome: "unavailable", quantity: 0 });
      continue;
    }
    const existing = await one<{ line_id: string; quantity: number }>(
      "SELECT line_id, quantity FROM cart_lines WHERE account_id = $1 AND listing_id = $2 AND saved = false", [ctx.account!.id, listingId],
    );
    if (existing) {
      const combined = Math.min(existing.quantity + quantity, 10);
      const capped = existing.quantity + quantity > 10;
      await query("UPDATE cart_lines SET quantity = $3, selected = true WHERE line_id = $1", [existing.line_id, ctx.account!.id, combined]);
      results.push({ listing_id: listingId, title: listing.title, outcome: capped ? "capped" : "combined", quantity: combined });
    } else {
      const count = await one<{ n: string }>("SELECT count(*) AS n FROM cart_lines WHERE account_id = $1 AND saved = false", [ctx.account!.id]);
      if (Number(count?.n ?? 0) >= 10) {
        const saved = await one<{ line_id: string }>(
          "SELECT line_id FROM cart_lines WHERE account_id = $1 AND listing_id = $2 AND saved = true", [ctx.account!.id, listingId]);
        if (saved) {
          await query("UPDATE cart_lines SET quantity = $3 WHERE line_id = $1", [saved.line_id, ctx.account!.id, Math.min(quantity, 10)]);
        } else {
          await query(
            `INSERT INTO cart_lines (line_id, account_id, listing_id, quantity, selected, gift_wrap, gift_message, saved, created_seq)
             VALUES ($1,$2,$3,$4,false,false,'',true,$5)`,
            [id("CL"), ctx.account!.id, listingId, Math.min(quantity, 10), Date.now()],
          );
        }
        results.push({ listing_id: listingId, title: listing.title, outcome: "saved_for_later", quantity });
      } else {
        await query(
          `INSERT INTO cart_lines (line_id, account_id, listing_id, quantity, selected, gift_wrap, gift_message, saved, created_seq)
           VALUES ($1,$2,$3,$4,true,false,'',false,$5)`,
          [id("CL"), ctx.account!.id, listingId, Math.min(quantity, 10), Date.now()],
        );
        results.push({ listing_id: listingId, title: listing.title, outcome: "added", quantity: Math.min(quantity, 10) });
      }
    }
  }
  return { results, cart: await buildQuote(ctx.account!.id, new Date()) };
});
