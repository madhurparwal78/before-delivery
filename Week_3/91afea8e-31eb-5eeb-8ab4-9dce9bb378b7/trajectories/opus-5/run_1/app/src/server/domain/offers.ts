/** Seller offer ranking and the featured-offer rule. */

import type { Offer } from '../../shared/types.js';

export function rankOffers(offers: Offer[]): Offer[] {
  return [...offers].sort((left, right) => {
    if (left.in_stock !== right.in_stock) return left.in_stock ? -1 : 1;
    if (left.landed_paise !== right.landed_paise) return left.landed_paise - right.landed_paise;
    if (left.promise_date !== right.promise_date) {
      if (left.promise_date === null) return 1;
      if (right.promise_date === null) return -1;
      return left.promise_date < right.promise_date ? -1 : 1;
    }
    if (left.seller_rating !== right.seller_rating) return right.seller_rating - left.seller_rating;
    return left.listing_id < right.listing_id ? -1 : left.listing_id > right.listing_id ? 1 : 0;
  });
}

export function markFeatured(ranked: Offer[]): Offer[] {
  const inStock = ranked.filter((offer) => offer.in_stock);
  const featured =
    inStock.find((offer) => offer.seller_rating >= 4.0) ?? (inStock.length > 0 ? inStock[0] : null);
  return ranked.map((offer) => ({
    ...offer,
    featured: featured !== null && offer.listing_id === featured.listing_id,
  }));
}
