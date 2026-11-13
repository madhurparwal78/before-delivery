/** Shared reads: pincodes, sellers, categories and listings with everything a quote needs. */

import { one, query } from './db.js';
import type { PincodeRecord, SellerRecord } from './domain/promise.js';

export type CategoryRecord = {
  slug: string;
  name: string;
  gst_rate: number;
  commission_percent: number;
  return_days: number;
};

export type ListingRecord = {
  listing_id: string;
  product_id: string;
  title: string;
  brand: string;
  category_slug: string;
  product_rating: number;
  price_paise: number;
  cost_price_paise: number;
  stock: number;
  status: 'live' | 'unlisted';
  cod_allowed: boolean;
  no_cost_emi: boolean;
  deal_price_paise: number | null;
  deal_ends_at: string | null;
  seller_id: string;
  seller_name: string;
  seller_rating: number;
  seller_cod_allowed: boolean;
  pickup_city: string;
  pickup_state: string;
  dispatch_days: number;
  ship_states: string[];
  gst_rate: number;
  commission_percent: number;
  return_days: number;
};

const LISTING_SELECT = `
  SELECT l.id AS listing_id, l.product_id, p.title, p.brand, p.category_slug, p.rating AS product_rating,
         l.price_paise, l.cost_price_paise, l.stock, l.status, l.cod_allowed, l.no_cost_emi,
         l.deal_price_paise, l.deal_ends_at,
         s.id AS seller_id, s.display_name AS seller_name, s.rating AS seller_rating,
         s.cod_allowed AS seller_cod_allowed, s.pickup_city, s.pickup_state, s.dispatch_days, s.ship_states,
         c.gst_rate, c.commission_percent, c.return_days
    FROM listings l
    JOIN products p ON p.id = l.product_id
    JOIN sellers s ON s.id = l.seller_id
    JOIN categories c ON c.slug = p.category_slug`;

export async function getListing(listingId: string): Promise<ListingRecord | null> {
  return one<ListingRecord>(`${LISTING_SELECT} WHERE l.id = $1`, [listingId]);
}

export async function getListings(listingIds: readonly string[]): Promise<ListingRecord[]> {
  if (listingIds.length === 0) return [];
  return query<ListingRecord>(`${LISTING_SELECT} WHERE l.id = ANY($1)`, [listingIds]);
}

export async function getListingsForProduct(productId: string): Promise<ListingRecord[]> {
  return query<ListingRecord>(`${LISTING_SELECT} WHERE l.product_id = $1 AND l.status = 'live'`, [
    productId,
  ]);
}

export async function getPincode(pincode: string | null): Promise<PincodeRecord | null> {
  if (pincode === null) return null;
  const row = await one<PincodeRecord>(
    `SELECT pincode, city, state, serviceable, cod, remote FROM pincodes WHERE pincode = $1`,
    [pincode],
  );
  if (row !== null) return row;
  return {
    pincode,
    city: '',
    state: '',
    serviceable: false,
    cod: false,
    remote: false,
  };
}

export function sellerOf(listing: ListingRecord): SellerRecord {
  return {
    id: listing.seller_id,
    display_name: listing.seller_name,
    pickup_city: listing.pickup_city,
    pickup_state: listing.pickup_state,
    dispatch_days: listing.dispatch_days,
    rating: listing.seller_rating,
    cod_allowed: listing.seller_cod_allowed && listing.cod_allowed,
    ship_states: listing.ship_states,
  };
}

/** The unit price a shopper pays now: the deal price while the server clock is before its end. */
export function effectivePrice(listing: ListingRecord, now: Date): number {
  if (listing.deal_price_paise === null || listing.deal_ends_at === null) return listing.price_paise;
  return new Date(listing.deal_ends_at).getTime() > now.getTime()
    ? listing.deal_price_paise
    : listing.price_paise;
}

export function activeDeal(
  listing: ListingRecord,
  now: Date,
): { price_paise: number; ends_at: string } | null {
  if (listing.deal_price_paise === null || listing.deal_ends_at === null) return null;
  if (new Date(listing.deal_ends_at).getTime() <= now.getTime()) return null;
  return {
    price_paise: listing.deal_price_paise,
    ends_at: new Date(listing.deal_ends_at).toISOString(),
  };
}




export async function accountBalance(accountId: string): Promise<number> {
  const row = await one<{ balance_paise: number }>(
    `SELECT balance_paise FROM accounts WHERE id = $1`,
    [accountId],
  );
  return row === null ? 0 : row.balance_paise;
}

export const productImageUrl = (productId: string): string => `/art/${productId}.svg`;
