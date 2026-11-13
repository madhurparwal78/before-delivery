import type { Product, SearchResult } from "../../shared/api";

/** A product card built from a product's detail (the wishlist lists products, not search results). */
export function cardFromProduct(product: Product): SearchResult {
  const cheapest = product.variants.reduce((best, v) => (v.price < best.price ? v : best), product.variants[0]!);
  const colours: SearchResult["colours"] = [];
  const first_skus: Record<string, string> = {};
  for (const v of product.variants) {
    if (first_skus[v.colour_slug]) continue;
    first_skus[v.colour_slug] = v.sku;
    colours.push({ name: v.colour, slug: v.colour_slug, image_url: v.images[0]?.url ?? "" });
  }
  return {
    slug: product.slug,
    name: product.name,
    category: product.category,
    min_price: cheapest.price,
    compare_at: cheapest.compare_at,
    save_percent: cheapest.save_percent,
    colours,
    badge: product.badge,
    first_skus,
    skus: product.variants.map((v) => v.sku),
    price_varies: product.variants.some((v) => v.price !== cheapest.price),
  };
}
