import type { PriceItem, PriceType, Service } from "./types";

export interface PriceFilter {
  category: string | null;
  type: PriceType | null;
}

interface PriceCounts {
  categories: Record<string, number>;
  allCategories: number;
  types: Record<PriceType, number>;
  allTypes: number;
}

export const EMPTY_PRICE_FILTER: PriceFilter = { category: null, type: null };
export const PRICE_TYPES: { id: PriceType; label: string }[] = [
  { id: "fixed", label: "Fixed price" },
  { id: "custom", label: "Custom quote" },
];

/** A price item can be attached to an enquiry only for its own service. */
export function belongsToService(item: PriceItem, serviceId: unknown): boolean {
  return item.category === serviceId;
}

export function filterPrices(items: PriceItem[], filter: PriceFilter): PriceItem[] {
  return items.filter((item) => (filter.category === null || item.category === filter.category) && (filter.type === null || item.type === filter.type));
}

/** A category count honours the type filter; a type count honours the category filter. */
export function priceCounts(items: PriceItem[], services: Service[], filter: PriceFilter): PriceCounts {
  const byType = filterPrices(items, { ...filter, category: null });
  const byCategory = filterPrices(items, { ...filter, type: null });
  return {
    categories: Object.fromEntries(services.map((service) => [service.id, byType.filter((item) => item.category === service.id).length])),
    allCategories: byType.length,
    types: { fixed: byCategory.filter((item) => item.type === "fixed").length, custom: byCategory.filter((item) => item.type === "custom").length },
    allTypes: byCategory.length,
  };
}

export function queryOfPrices(filter: PriceFilter): string {
  const params = new URLSearchParams();
  if (filter.category) params.set("category", filter.category);
  if (filter.type) params.set("type", filter.type);
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function parsePriceQuery(search: string, services: Service[]): PriceFilter {
  const params = new URLSearchParams(search);
  const category = params.get("category");
  const type = params.get("type");
  return {
    category: services.some((service) => service.id === category) ? category : null,
    type: type === "fixed" || type === "custom" ? type : null,
  };
}
