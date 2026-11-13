import { one, pool, query, type Executor } from "../db.js";
import { parcelDeliveryFee } from "../domain/fees.js";
import { promiseDate, type Destination, type SellerLane } from "../domain/promise.js";
import { notFound } from "../errors.js";

export const PINCODE = /^[1-9]\d{5}$/;

export interface SellerRow {
  id: string;
  name: string;
  gstin: string;
  pickup_city: string;
  pickup_state: string;
  dispatch_days: number;
  rating: number;
  cod: boolean;
  ship_to_states: string[];
}

export interface ListingRow {
  id: string;
  product_id: string;
  seller_id: string;
  price_paise: number;
  cost_price_paise: number;
  stock: number;
  status: "live" | "unlisted";
  description: string;
  return_note: string;
  cod_allowed: boolean;
  no_cost_emi: boolean;
  deal_price_paise: number | null;
  deal_ends_at: number | null;
  created_seq: number;
}

export interface ProductRow {
  id: string;
  title: string;
  brand: string;
  category: string;
  rating: number;
  description: string;
  specs: Record<string, string | number>;
}

interface CategoryRow {
  slug: string;
  name: string;
  gst_rate: number;
  commission_percent: number;
  return_days: number;
}

export function sellerLane(seller: SellerRow): SellerLane {
  return { pickupCity: seller.pickup_city, pickupState: seller.pickup_state, dispatchDays: seller.dispatch_days, shipToStates: seller.ship_to_states };
}

export async function loadSellers(executor: Executor = pool): Promise<Map<string, SellerRow>> {
  const rows = await query<SellerRow & Record<string, unknown>>("SELECT * FROM sellers", [], executor);
  return new Map(rows.map((row) => [row.id, row]));
}

export async function loadDestination(pincode: string): Promise<Destination> {
  const row = await one<{ pincode: string; city: string; state: string; serviceable: boolean; cod: boolean; remote: boolean }>(
    "SELECT * FROM pincodes WHERE pincode = $1",
    [pincode],
  );
  if (!row) return { pincode, city: "", state: "", serviceable: false, remote: false, codAvailable: false };
  return { pincode, city: row.city, state: row.state, serviceable: row.serviceable, remote: row.remote, codAvailable: row.cod };
}

export async function loadCategories(): Promise<Map<string, CategoryRow>> {
  const rows = await query<CategoryRow & Record<string, unknown>>("SELECT * FROM categories");
  return new Map(rows.map((row) => [row.slug, row]));
}

/** A deal price applies only while the server's clock is strictly before the deal end. */
export function unitPrice(listing: Pick<ListingRow, "price_paise" | "deal_price_paise" | "deal_ends_at">, nowMs: number): number {
  return listing.deal_price_paise !== null && listing.deal_ends_at !== null && nowMs < listing.deal_ends_at ? listing.deal_price_paise : listing.price_paise;
}

export function activeDeal(listing: Pick<ListingRow, "deal_price_paise" | "deal_ends_at">, nowMs: number): { price_paise: number; ends_at: string } | null {
  if (listing.deal_price_paise === null || listing.deal_ends_at === null || nowMs >= listing.deal_ends_at) return null;
  return { price_paise: listing.deal_price_paise, ends_at: new Date(listing.deal_ends_at).toISOString() };
}

const SEEDED_ART = new Set([
  "steel-tiffin-3",
  "pressure-cooker-5l",
  "copper-bottle-1l",
  "ilkal-saree",
  "cotton-kurta",
  "dhwani-speaker",
  "tara-smartwatch",
  "lehar-earbuds",
  "jugnu-powerbank",
  "pankha-desk-fan",
  "jaljeera-fizz-24",
]);

export function imageUrl(productId: string, category: string): string {
  return SEEDED_ART.has(productId) ? `/art/${productId}.svg` : `/art/category-${category}.svg`;
}

export async function loadProduct(productId: string): Promise<ProductRow> {
  const product = await one<ProductRow & Record<string, unknown>>("SELECT * FROM products WHERE id = $1", [productId]);
  if (!product) throw notFound();
  return product;
}

export interface Offer {
  listing_id: string;
  seller_id: string;
  seller_name: string;
  seller_rating: number;
  price_paise: number;
  delivery_fee_paise: number;
  landed_paise: number;
  promise_date: string | null;
  cod_available: boolean;
  in_stock: boolean;
  featured: boolean;
}

/** Every live offer for a product, ranked by landed price, then promise date, then seller rating, then listing id. */
export async function rankedOffers(productId: string, destination: Destination | null, nowMs: number): Promise<Offer[]> {
  const listings = await query<ListingRow & Record<string, unknown>>("SELECT * FROM listings WHERE product_id = $1 AND status = 'live'", [productId]);
  const sellers = await loadSellers();
  const offers = listings.map((listing) => {
    const seller = sellers.get(listing.seller_id) as SellerRow;
    const price = unitPrice(listing, nowMs);
    const fee = parcelDeliveryFee(price, "standard");
    return {
      listing_id: listing.id,
      seller_id: seller.id,
      seller_name: seller.name,
      seller_rating: seller.rating,
      price_paise: price,
      delivery_fee_paise: fee,
      landed_paise: price + fee,
      promise_date: destination ? promiseDate(nowMs, sellerLane(seller), destination, "standard") : null,
      cod_available: seller.cod && listing.cod_allowed && (destination ? destination.codAvailable : true),
      in_stock: listing.stock > 0,
      featured: false,
    };
  });
  offers.sort(
    (a, b) =>
      Number(b.in_stock) - Number(a.in_stock) ||
      a.landed_paise - b.landed_paise ||
      (a.promise_date === null ? 1 : 0) - (b.promise_date === null ? 1 : 0) ||
      (a.promise_date ?? "").localeCompare(b.promise_date ?? "") ||
      b.seller_rating - a.seller_rating ||
      a.listing_id.localeCompare(b.listing_id),
  );
  const inStock = offers.filter((offer) => offer.in_stock);
  const featured = inStock.find((offer) => offer.seller_rating >= 4.0) ?? inStock[0];
  if (featured) featured.featured = true;
  return offers;
}
