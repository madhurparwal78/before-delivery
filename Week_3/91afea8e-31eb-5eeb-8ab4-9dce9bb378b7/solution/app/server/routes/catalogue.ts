import type { Hono } from "hono";
import { one, query } from "../db.js";
import { EMI_MINIMUM_PAISE } from "../domain/fees.js";
import { EMI_TENURES, emiPlan, MONTHLY_RATE_PERCENT } from "../domain/emi.js";
import { FIELD, notFound, validationFailed } from "../errors.js";
import { ok, route, type Request } from "../http.js";
import {
  imageUrl,
  loadCategories,
  loadDestination,
  loadProduct,
  PINCODE,
  rankedOffers,
  unitPrice,
  type ListingRow,
  type Offer,
} from "../services/catalogue.js";
import { search, type SortKey } from "../services/search.js";

const SORTS: readonly SortKey[] = ["relevance", "price_asc", "price_desc", "rating", "newest"];

function wholeNumber(raw: string | null, field: string, errors: Record<string, string>): number | undefined {
  if (raw === null || raw === "") return undefined;
  if (!/^\d{1,9}$/.test(raw)) {
    errors[field] = FIELD.needsWholeNumber;
    return undefined;
  }
  return Number(raw);
}

function csv(raw: string | null): string[] | undefined {
  const values = (raw ?? "").split(",").filter((value) => value !== "");
  return values.length > 0 ? values : undefined;
}

async function runSearch(req: Request) {
  const errors: Record<string, string> = {};
  const q = req.query.get("q") ?? "";
  if ([...q].length > 100) errors.q = "Search text can be up to 100 characters.";
  const limitRaw = req.query.get("limit");
  const limit = limitRaw === null || limitRaw === "" ? 24 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 24) errors.limit = FIELD.searchPageSize;
  const ratingRaw = req.query.get("rating");
  if (ratingRaw !== null && ratingRaw !== "" && ratingRaw !== "3" && ratingRaw !== "4") errors.rating = "Rating must be 3 or 4.";
  const sortRaw = req.query.get("sort") ?? "relevance";
  if (!SORTS.includes(sortRaw as SortKey)) errors.sort = FIELD.badChoice;
  const priceMinRupees = wholeNumber(req.query.get("price_min"), "price_min", errors);
  const priceMaxRupees = wholeNumber(req.query.get("price_max"), "price_max", errors);
  const pin = req.query.get("pin") ?? undefined;
  if (pin !== undefined && pin !== "" && !PINCODE.test(pin)) errors.pin = FIELD.badPincode;
  if (Object.keys(errors).length > 0) throw validationFailed(errors);
  const destination = pin ? await loadDestination(pin) : null;
  const category = req.query.get("category") || undefined;
  const result = await search(
    {
      q,
      category,
      brand: csv(req.query.get("brand")),
      seller: csv(req.query.get("seller")),
      priceMinRupees,
      priceMaxRupees,
      rating: ratingRaw === "3" || ratingRaw === "4" ? (Number(ratingRaw) as 3 | 4) : undefined,
      pin: pin || undefined,
      deliverable: req.query.get("deliverable") === "1",
      sort: sortRaw as SortKey,
      cursor: req.query.get("cursor") || null,
      limit,
    },
    destination,
    req.nowMs,
  );
  return ok({ ...result });
}

async function destinationFromQuery(req: Request) {
  const pin = req.query.get("pin");
  if (pin === null || pin === "") return null;
  if (!PINCODE.test(pin)) throw validationFailed({ pin: FIELD.badPincode });
  return loadDestination(pin);
}

async function product(req: Request) {
  const found = await loadProduct(req.params.id as string);
  const offers = await rankedOffers(found.id, await destinationFromQuery(req), req.nowMs);
  const category = (await loadCategories()).get(found.category);
  return ok({
    id: found.id,
    title: found.title,
    brand: found.brand,
    category: found.category,
    gst_rate: category?.gst_rate ?? 0,
    rating: found.rating,
    description: found.description,
    specs: found.specs,
    image_url: imageUrl(found.id, found.category),
    offers_count: offers.length,
    featured_offer: offers.find((offer) => offer.featured) ?? null,
  });
}

async function offers(req: Request) {
  const limitRaw = req.query.get("limit");
  const limit = limitRaw === null || limitRaw === "" ? 10 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw validationFailed({ limit: FIELD.offersPageSize });
  const found = await loadProduct(req.params.id as string);
  const ranked = await rankedOffers(found.id, await destinationFromQuery(req), req.nowMs);
  return ok({ offers: ranked.slice(0, limit) satisfies Offer[], total: ranked.length });
}

async function compare(req: Request) {
  const ids = [...new Set((req.query.get("ids") ?? "").split(",").filter((id) => id !== ""))];
  if (ids.length < 2) throw validationFailed({ ids: FIELD.comparePick });
  if (ids.length > 4) throw validationFailed({ ids: FIELD.compareOver });
  const found = await Promise.all(ids.map(loadProduct));
  if (new Set(found.map((p) => p.category)).size > 1) throw validationFailed({ ids: FIELD.compareMixed });
  const prices = await query<{ product_id: string; best: number }>(
    `SELECT product_id, min(CASE WHEN deal_price_paise IS NOT NULL AND deal_ends_at > $2 THEN deal_price_paise ELSE price_paise END)::bigint AS best
       FROM listings WHERE product_id = ANY($1) AND status = 'live' GROUP BY product_id`,
    [ids, req.nowMs],
  );
  const names = [...new Set(found.flatMap((p) => Object.keys(p.specs)))];
  return ok({
    category: found[0]?.category,
    products: found.map((p) => ({
      id: p.id,
      title: p.title,
      brand: p.brand,
      rating: p.rating,
      image_url: imageUrl(p.id, p.category),
      best_price_paise: prices.find((row) => row.product_id === p.id)?.best ?? null,
      specs: p.specs,
    })),
    attributes: names.map((name) => {
      const values = found.map((p) => p.specs[name] ?? null);
      return { name, values, differs: new Set(values.map((value) => JSON.stringify(value))).size > 1 };
    }),
  });
}

function emiBody(amountPaise: number, noCostAllowed: boolean): Record<string, unknown> {
  return {
    amount_paise: amountPaise,
    monthly_rate_percent: MONTHLY_RATE_PERCENT,
    plans: EMI_TENURES.map((tenure) => {
      const plan = emiPlan(amountPaise, tenure, noCostAllowed);
      return {
        tenure_months: plan.tenureMonths,
        no_cost: plan.noCost,
        upfront_discount_paise: plan.upfrontDiscountPaise,
        principal_paise: plan.principalPaise,
        instalment_paise: plan.instalmentPaise,
        total_interest_paise: plan.totalInterestPaise,
        total_payable_paise: plan.totalPayablePaise,
      };
    }),
  };
}

/** The EMI plans for an amount; shared with the cart's plans. */
export function emiPlansBody(amountPaise: number, noCostAllowed: boolean): Record<string, unknown> {
  if (amountPaise < EMI_MINIMUM_PAISE) throw validationFailed({ amount: FIELD.emiMinimum });
  return emiBody(amountPaise, noCostAllowed);
}

async function emiPlans(req: Request) {
  const listing = await one<ListingRow & Record<string, unknown>>("SELECT * FROM listings WHERE id = $1", [req.query.get("listing_id") ?? ""]);
  if (!listing) throw notFound();
  return ok(emiPlansBody(unitPrice(listing, req.nowMs), listing.no_cost_emi));
}

export function registerCatalogue(app: Hono): void {
  route(app, ["GET"], "/api/pincodes/:pincode", { access: "public", rate: { bucket: "pincode", limit: 30 } }, async (req) => {
    const pincode = req.params.pincode as string;
    if (!PINCODE.test(pincode)) throw validationFailed({ pincode: FIELD.badPincode });
    const destination = await loadDestination(pincode);
    const known = destination.city !== "";
    return ok({
      pincode,
      city: known ? destination.city : null,
      state: known ? destination.state : null,
      serviceable: destination.serviceable,
      cod_available: destination.codAvailable,
    });
  });
  route(app, ["GET"], "/api/search", { access: "public" }, runSearch);
  route(app, ["GET"], "/api/products/:id", { access: "public" }, product);
  route(app, ["GET"], "/api/products/:id/offers", { access: "public" }, offers);
  route(app, ["GET"], "/api/compare", { access: "public" }, compare);
  route(app, ["GET"], "/api/emi-plans", { access: "public" }, emiPlans);
  route(app, ["GET"], "/api/banks", { access: "public" }, async () =>
    ok({ banks: await query<{ code: string; name: string }>("SELECT code, name FROM banks ORDER BY code") }),
  );
}
