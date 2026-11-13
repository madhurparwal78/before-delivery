import { Router, type Ctx } from "./http.js";
import { ApiError, copy, forbidden, notFound, signedOut, validationFailed } from "./errors.js";
import { one, query } from "./db.js";
import { landedPaise, compareOffers, unitPricePaise, deliversTo, promiseDate, FREE_DELIVERY_THRESHOLD_Paise, STANDARD_FEE_Paise } from "./domain.js";
import { emiPlans } from "./domain.js";
import { id } from "./crypto.js";
import * as auth from "./auth.js";

const router = new Router();
export default router;

export interface SharedHelpers {
  str(v: unknown): string;
  codePoints(s: string): number;
  requireFields(body: Record<string, unknown>, allowed: string[]): void;
  readBody(ctx: Ctx): Promise<Record<string, unknown>>;
  requireAccount(ctx: Ctx, roles?: string[]): void;
  bankList(): Array<{ code: string; name: string }>;
}

export function str(v: unknown): string { return typeof v === "string" ? v : ""; }
export function codePoints(s: string): number { return [...s].length; }
export function requireFields(body: Record<string, unknown>, allowed: string[]): void {
  const extras = Object.keys(body).filter((k) => !allowed.includes(k));
  if (extras.length > 0) {
    const fields: Record<string, string> = {};
    for (const k of extras) fields[k] = copy.field.cantSet;
    throw validationFailed(fields);
  }
}
export async function readBody(ctx: Ctx): Promise<Record<string, unknown>> {
  if (!ctx.body || typeof ctx.body !== "object") return {};
  return ctx.body as Record<string, unknown>;
}
export function requireAccount(ctx: Ctx, roles?: string[]): void {
  if (!ctx.account) throw signedOut();
  if (roles && !roles.includes(ctx.account.role)) throw forbidden();
}
export function bankList(): Array<{ code: string; name: string }> {
  return [
    { code: "SAFB", name: "Saffron Bank" },
    { code: "NILB", name: "Nilgiri Bank" },
    { code: "DECB", name: "Deccan Cooperative Bank" },
    { code: "KONB", name: "Konkan Bank" },
  ];
}
export function accountView(a: { account_id: string; name: string; role: string }): { id: string; name: string; first_name: string; role: string } {
  return { id: a.account_id, name: a.name, first_name: a.name.split(" ")[0], role: a.role };
}
export interface AddressView { address_id: string; label: string; name: string; line1: string; line2: string; city: string; state: string; pincode: string; phone: string }
export function addressView(a: Record<string, unknown>): AddressView {
  return {
    address_id: a.address_id as string, label: a.label as string, name: a.name as string,
    line1: a.line1 as string, line2: a.line2 as string, city: a.city as string,
    state: a.state as string, pincode: a.pincode as string, phone: a.phone as string,
  };
}
export async function validateAddress(body: Record<string, unknown>): Promise<AddressView> {
  const label = str(body.label), name = str(body.name), line1 = str(body.line1);
  const line2 = str(body.line2), city = str(body.city), pincode = str(body.pincode), phone = str(body.phone);
  const fields: Record<string, string> = {};
  if (!label) fields.label = "Enter a label.";
  if (!name) fields.name = "Enter a name.";
  if (!line1) fields.line1 = "Enter the street.";
  if (!city) fields.city = "Enter a city.";
  if (!/^\d{6}$/.test(pincode) || pincode.startsWith("0")) fields.pincode = copy.field.badPincode;
  if (!/^\+91[6-9]\d{9}$/.test(phone)) fields.phone = copy.field.badPhone;
  if (Object.keys(fields).length) throw validationFailed(fields);
  const pin = await one<{ state: string | null }>("SELECT state FROM pincodes WHERE pincode = $1", [pincode]);
  return { address_id: "", label, name, line1, line2, city, state: pin?.state ?? "", pincode, phone };
}

export interface PinRow { pincode: string; city: string | null; state: string | null; serviceable: boolean; cod_available: boolean; remote: boolean }

export async function pinRow(pin: string): Promise<PinRow | null> {
  if (!/^\d{6}$/.test(pin) || pin.startsWith("0")) return null;
  return one<PinRow>("SELECT * FROM pincodes WHERE pincode = $1", [pin]);
}

// ---------- health ----------

router.add("GET", "/api/health", async (ctx) => {
  const state = await one<{ schema_ready: boolean }>("SELECT schema_ready FROM health_state WHERE id = 1");
  if (state?.schema_ready) return { status: "ok" };
  ctx.res.statusCode = 503;
  return { status: "starting" };
});

// ---------- catalogue (public) ----------

router.add("GET", "/api/pincodes/:pincode", async (ctx) => {
  const pin = ctx.params.pincode;
  if (!/^\d{6}$/.test(pin) || pin.startsWith("0")) throw validationFailed({ pincode: copy.field.badPincode });
  const rl = await auth.rateLimit(`pin:${ctx.account?.id ?? ctx.ip}`, 30);
  if (!rl.allowed) throw new ApiError(429, "rate_limited", copy.rateLimited(rl.retryAfter), { retryAfter: rl.retryAfter });
  const row = await one<PinRow>("SELECT * FROM pincodes WHERE pincode = $1", [pin]);
  if (!row) return { pincode: pin, city: null, state: null, serviceable: false, cod_available: false };
  return { pincode: row.pincode, city: row.city, state: row.state, serviceable: row.serviceable, cod_available: row.cod_available };
});

interface SearchHitRow {
  listing_id: string; product_id: string; title: string; brand: string; category: string;
  seller_id: string; seller_name: string; price_paise: string; deal_price_paise: string | null;
  deal_ends_at: string | null; rating: string; stock: number; status: string;
  seller_pickup_city: string; seller_pickup_state: string; seller_dispatch_days: number;
  seller_ship_states: string[]; seller_ship_all_states: boolean;
}

/** Search the index; when it is unreachable answer in basic mode from a title match. */
router.add("GET", "/api/search", async (ctx) => {
  const q = (ctx.query.get("q") ?? "").trim();
  const limit = Number(ctx.query.get("limit") ?? "24");
  const fields: Record<string, string> = {};
  if (codePoints(q) > 100) fields.q = "Query can be up to 100 characters.";
  const rating = ctx.query.get("rating");
  if (rating !== null && rating !== "3" && rating !== "4") fields.rating = "Rating filter is 3 or 4.";
  if (!Number.isInteger(limit) || limit < 1 || limit > 24) fields.limit = copy.field.badPageSize;
  if (Object.keys(fields).length) throw validationFailed(fields);

  const category = ctx.query.get("category");
  const brands = (ctx.query.get("brand") ?? "").split(",").filter(Boolean);
  const sellers = (ctx.query.get("seller") ?? "").split(",").filter(Boolean);
  const priceMin = ctx.query.get("price_min");
  const priceMax = ctx.query.get("price_max");
  const pin = ctx.query.get("pin");
  const deliverable = ctx.query.get("deliverable") === "1";
  const sort = ctx.query.get("sort") ?? (q ? "relevance" : "newest");
  const cursor = ctx.query.get("cursor");

  if (pin && (!/^\d{6}$/.test(pin) || pin.startsWith("0"))) throw validationFailed({ pin: copy.field.badPincode });
  const pinR = pin ? await pinRow(pin) : null;
  if (deliverable && (!pinR || !pinR.serviceable)) {
    return { hits: [], facets: emptyFacets(), total: 0, next_cursor: null, degraded: false };
  }

  let offset = 0;
  if (cursor) offset = Number(Buffer.from(cursor, "base64url").toString("utf8")) || 0;

  const filterParts: string[] = [];
  if (category) filterParts.push(`category = "${category}"`);
  if (brands.length) filterParts.push(`brand IN [${brands.map((b) => `"${b}"`).join(", ")}]`);
  if (sellers.length) filterParts.push(`seller_id IN [${sellers.map((s) => `"${s}"`).join(", ")}]`);
  if (priceMin !== null && priceMin !== "") filterParts.push(`price_paise >= ${Math.round(Number(priceMin) * 100)}`);
  if (priceMax !== null && priceMax !== "") filterParts.push(`price_paise <= ${Math.round(Number(priceMax) * 100)}`);
  if (rating) filterParts.push(`rating >= ${rating}`);
  if (deliverable && pin) filterParts.push(`pincodes CONTAINS "${pin}"`);
  const sortSpec = sort === "price_asc" ? "price_paise:asc"
    : sort === "price_desc" ? "price_paise:desc"
    : sort === "rating" ? "rating:desc"
    : sort === "newest" ? "created_seq:desc"
    : null; // relevance: index order

  const { msSearch } = await import("./search.js");
  const search = await msSearch({
    q, filter: filterParts.length ? filterParts.join(" AND ") : undefined,
    sort: sortSpec ? [sortSpec] : undefined,
    limit, offset, facets: ["category", "brand", "seller_id"],
  });

  const noIndex = search === null;
  if (noIndex) {
    const like = `%${q.toLowerCase()}%`;
    const rows = await query<SearchHitRow>(`
      SELECT l.listing_id, l.product_id, p.title, p.brand, p.category, l.seller_id, s.name AS seller_name,
             l.price_paise, l.deal_price_paise, l.deal_ends_at, p.rating, l.stock, l.status,
             s.pickup_city AS seller_pickup_city, s.pickup_state AS seller_pickup_state,
             s.dispatch_days AS seller_dispatch_days, s.ship_states AS seller_ship_states, s.ship_all_states AS seller_ship_all_states
      FROM listings l JOIN products p ON p.product_id = l.product_id JOIN sellers s ON s.seller_id = l.seller_id
      WHERE l.status = 'live' AND lower(p.title) LIKE $1
      ORDER BY l.created_seq DESC LIMIT ${limit} OFFSET ${offset}`, [like]);
    return {
      hits: rows.map((r) => hitFromRow(r, pinR)),
      facets: emptyFacets(),
      total: rows.length,
      next_cursor: rows.length === limit ? Buffer.from(String(offset + limit)).toString("base64url") : null,
      degraded: true,
    };
  }

  const hitRows = search.hits;
  // promise dates need seller data; fetch in one pass
  const sellerRows = hitRows.length ? await query<{ listing_id: string; pickup_city: string; pickup_state: string; dispatch_days: number; ship_states: string[]; ship_all_states: boolean }>(`
    SELECT l.listing_id, s.pickup_city, s.pickup_state, s.dispatch_days, s.ship_states, s.ship_all_states
    FROM listings l JOIN sellers s ON s.seller_id = l.seller_id
    WHERE l.listing_id = ANY($1::text[])`, [hitRows.map((h) => h.listing_id)]) : [];
  const sellerByListing = new Map(sellerRows.map((s) => [s.listing_id, s]));
  const ratingFacets: Record<string, number> = { "4": 0, "3": 0 };
  const facetAll = await msSearch({
    q, filter: filterParts.length ? filterParts.join(" AND ") : undefined,
    limit: 0, offset: 0, facets: ["category", "brand", "seller_id", "rating"],
  });
  if (facetAll) {
    for (const [value, count] of Object.entries(facetAll.facetDistribution.rating ?? {})) {
      if (Number(value) >= 4) ratingFacets["4"] += count;
      if (Number(value) >= 3) ratingFacets["3"] += count;
    }
  } else {
    for (const h of hitRows) {
      if (h.rating >= 4) ratingFacets["4"] += 1;
      if (h.rating >= 3) ratingFacets["3"] += 1;
    }
  }
  const facets = {
    category: facetAll?.facetDistribution.category ?? {},
    brand: facetAll?.facetDistribution.brand ?? {},
    seller: facetAll?.facetDistribution.seller_id ?? {},
    rating: ratingFacets,
  };

  const hits = hitRows.map((h) => {
    const seller = sellerByListing.get(h.listing_id);
    const delivers = !!pinR && pinR.serviceable && h.pincodes.includes(pinR.pincode);
    return {
      listing_id: h.listing_id, product_id: h.product_id, title: h.title, brand: h.brand,
      category: h.category, seller_id: h.seller_id, seller_name: h.seller_name,
      price_paise: h.price_paise, rating: h.rating, image_url: `/img/listings/${h.listing_id}.svg`,
      in_stock: h.in_stock, delivers,
      promise_date: delivers && seller ? promiseDate(seller as never, pinR as never, false) : null,
    };
  });
  const total = search.estimatedTotalHits;
  return {
    hits, facets, total,
    next_cursor: offset + hitRows.length < total ? Buffer.from(String(offset + hitRows.length)).toString("base64url") : null,
    degraded: false,
  };
});

function emptyFacets(): { category: Record<string, number>; brand: Record<string, number>; seller: Record<string, number>; rating: Record<string, number> } {
  return { category: {}, brand: {}, seller: {}, rating: {} };
}

function hitFromRow(r: SearchHitRow, pinR: PinRow | null): Record<string, unknown> {
  const seller = { pickup_city: r.seller_pickup_city, pickup_state: r.seller_pickup_state, dispatch_days: r.seller_dispatch_days, ship_states: r.seller_ship_states, ship_all_states: r.seller_ship_all_states };
  const delivers = !!pinR && pinR.serviceable && (r.seller_ship_all_states || r.seller_ship_states.includes(pinR.state!));
  const price = unitPricePaise({ price_paise: Number(r.price_paise), deal_price_paise: r.deal_price_paise ? Number(r.deal_price_paise) : null, deal_ends_at: r.deal_ends_at }, new Date());
  return {
    listing_id: r.listing_id, product_id: r.product_id, title: r.title, brand: r.brand,
    category: r.category, seller_id: r.seller_id, seller_name: r.seller_name,
    price_paise: price, rating: Number(r.rating), image_url: `/img/listings/${r.listing_id}.svg`,
    in_stock: r.status === "live" && r.stock > 0, delivers,
    promise_date: delivers ? promiseDate(seller as never, pinR as never, false) : null,
  };
}

router.add("GET", "/api/products/:id", async (ctx) => {
  const product = await one<{ product_id: string; title: string; brand: string; category: string; rating: string; description: string; specs: Record<string, unknown> }>(
    "SELECT * FROM products WHERE product_id = $1", [ctx.params.id],
  );
  if (!product) throw notFound();
  const offers = await offersForProduct(product.product_id, ctx.query.get("pin"));
  const featured = offers.find((o) => o.featured) ?? offers[0] ?? null;
  const gst = await one<{ gst_rate: number }>("SELECT gst_rate FROM categories WHERE slug = $1", [product.category]);
  return {
    id: product.product_id, title: product.title, brand: product.brand, category: product.category,
    gst_rate: gst?.gst_rate ?? 0, rating: Number(product.rating),
    description: product.description, specs: product.specs,
    offers_count: offers.length, featured_offer: featured,
  };
});

router.add("GET", "/api/products/:id/offers", async (ctx) => {
  const limit = Number(ctx.query.get("limit") ?? "10");
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw validationFailed({ limit: copy.field.badOffersPageSize });
  const offers = await offersForProduct(ctx.params.id, ctx.query.get("pin"));
  return { offers: offers.slice(0, limit), total: offers.length };
});

interface OfferRow {
  listing_id: string; seller_id: string; seller_name: string; seller_rating: string;
  price_paise: string; deal_price_paise: string | null; deal_ends_at: string | null;
  stock: number; status: string; seller_cod_allowed: boolean;
  pickup_city: string; pickup_state: string; dispatch_days: number;
  ship_states: string[]; ship_all_states: boolean;
}

/** Offers ranked by landed price, then promise, then rating, per the Offers rule. */
export async function offersForProduct(productId: string, pin: string | null): Promise<Array<Record<string, unknown> & { in_stock: boolean; seller_rating: number; featured: boolean }>> {
  const pinR = pin ? await pinRow(pin) : null;
  const rows = await query<OfferRow>(`
    SELECT l.listing_id, l.seller_id, s.name AS seller_name, s.rating AS seller_rating,
           l.price_paise, l.deal_price_paise, l.deal_ends_at, l.stock, l.status,
           s.cod_allowed AS seller_cod_allowed, s.pickup_city, s.pickup_state, s.dispatch_days,
           s.ship_states, s.ship_all_states
    FROM listings l JOIN sellers s ON s.seller_id = l.seller_id
    WHERE l.product_id = $1 AND l.status = 'live'`, [productId]);
  const now = new Date();
  const offers = rows.map((r) => {
    const seller = { seller_id: r.seller_id, name: r.seller_name, pickup_city: r.pickup_city, pickup_state: r.pickup_state, dispatch_days: r.dispatch_days, ship_states: r.ship_states, ship_all_states: r.ship_all_states, rating: Number(r.seller_rating), cod_allowed: r.seller_cod_allowed };
    const delivers = deliversTo(seller, pinR as never);
    const price = unitPricePaise({ price_paise: Number(r.price_paise), deal_price_paise: r.deal_price_paise ? Number(r.deal_price_paise) : null, deal_ends_at: r.deal_ends_at }, now);
    const fee = price >= FREE_DELIVERY_THRESHOLD_Paise ? 0 : STANDARD_FEE_Paise;
    const inStock = r.stock > 0;
    return {
      listing_id: r.listing_id, seller_id: r.seller_id, seller_name: r.seller_name,
      seller_rating: Number(r.seller_rating), price_paise: price,
      delivery_fee_paise: fee, landed_paise: landedPaise(price, fee),
      promise_date: delivers ? promiseDate(seller, pinR as never, false) : null,
      cod_available: delivers && r.seller_cod_allowed && (pinR?.cod_available ?? true) && inStock,
      in_stock: inStock, featured: false,
    };
  });
  offers.sort(compareOffers as never);
  const qualified = offers.find((o) => o.in_stock && o.seller_rating >= 4.0);
  const featured = qualified ?? offers.find((o) => o.in_stock) ?? null;
  if (featured) featured.featured = true;
  return offers;
}

router.add("GET", "/api/compare", async (ctx) => {
  const ids = (ctx.query.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length < 2 || ids.length > 4) throw validationFailed({ ids: ids.length < 2 ? copy.compareUnder2 : copy.compareOver4 });
  const products = await query<{ product_id: string; title: string; brand: string; category: string; rating: string; specs: Record<string, unknown> }>(
    "SELECT * FROM products WHERE product_id = ANY($1::text[])", [ids],
  );
  if (products.length !== ids.length) throw notFound();
  const categories = new Set(products.map((p) => p.category));
  if (categories.size > 1) throw validationFailed({ ids: copy.compareMixed });
  const priceRows = await query<{ product_id: string; price: string }>(
    "SELECT product_id, min(price_paise)::text AS price FROM listings WHERE status = 'live' GROUP BY product_id");
  const priceMap = new Map(priceRows.map((r) => [r.product_id, Number(r.price)]));
  const ordered = ids.map((pid) => products.find((p) => p.product_id === pid)!);
  const attributeNames = [...new Set(ordered.flatMap((p) => Object.keys(p.specs)))];
  const attributes = attributeNames.map((name) => {
    const values = ordered.map((p) => p.specs[name] ?? null);
    return { name, values, differs: new Set(values.map((v) => JSON.stringify(v))).size > 1 };
  });
  return {
    category: ordered[0].category,
    products: ordered.map((p) => ({ id: p.product_id, title: p.title, brand: p.brand, rating: Number(p.rating), best_price_paise: priceMap.get(p.product_id) ?? 0, specs: p.specs })),
    attributes,
  };
});

router.add("GET", "/api/emi-plans", async (ctx) => {
  const listingId = ctx.query.get("listing_id");
  if (!listingId) throw validationFailed({ listing_id: "Choose a listing." });
  const listing = await one<{ price_paise: string; deal_price_paise: string | null; deal_ends_at: string | null; no_cost_emi: boolean; status: string }>(
    "SELECT * FROM listings WHERE listing_id = $1", [listingId],
  );
  if (!listing || listing.status !== "live") throw notFound();
  const price = unitPricePaise({ price_paise: Number(listing.price_paise), deal_price_paise: listing.deal_price_paise ? Number(listing.deal_price_paise) : null, deal_ends_at: listing.deal_ends_at }, new Date());
  if (price < 300000) throw validationFailed({ amount: copy.field.emiTooSmall });
  return { amount_paise: price, monthly_rate_percent: "1.25", plans: emiPlans(listing.no_cost_emi, price) };
});

router.add("GET", "/api/banks", async () => ({ banks: bankList() }));
