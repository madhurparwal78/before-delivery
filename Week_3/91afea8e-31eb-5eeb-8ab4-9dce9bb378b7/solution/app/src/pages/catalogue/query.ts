export type SortKey = "relevance" | "price_asc" | "price_desc" | "rating" | "newest";

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "relevance", label: "Relevance" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "rating", label: "Rating" },
  { value: "newest", label: "Newest" },
];

/** Everything the address bar says about a search. */
export interface SearchState {
  q: string;
  category: string;
  brand: string[];
  seller: string[];
  priceMin: string;
  priceMax: string;
  rating: "" | "3" | "4";
  pin: string;
  deliverable: boolean;
  sort: SortKey;
}

const csv = (raw: string | null): string[] => (raw ?? "").split(",").filter((value) => value !== "");
const whole = (raw: string | null): string => (/^\d{1,9}$/.test(raw ?? "") ? (raw as string) : "");

export function readSearch(params: URLSearchParams): SearchState {
  const rating = params.get("rating");
  const sort = params.get("sort");
  const pin = params.get("pin") ?? "";
  return {
    q: params.get("q") ?? "",
    category: params.get("category") ?? "",
    brand: csv(params.get("brand")),
    seller: csv(params.get("seller")),
    priceMin: whole(params.get("price_min")),
    priceMax: whole(params.get("price_max")),
    rating: rating === "3" || rating === "4" ? rating : "",
    pin: /^[1-9]\d{5}$/.test(pin) ? pin : "",
    deliverable: params.get("deliverable") === "1",
    sort: SORT_OPTIONS.some((option) => option.value === sort) ? (sort as SortKey) : "relevance",
  };
}

/** The address-bar order: q, category, brand, seller, price_min, price_max, rating, pin, deliverable, sort; empty ones left out. */
export function writeSearch(state: SearchState): string {
  const params = new URLSearchParams();
  if (state.q !== "") params.set("q", state.q);
  if (state.category !== "") params.set("category", state.category);
  if (state.brand.length > 0) params.set("brand", state.brand.join(","));
  if (state.seller.length > 0) params.set("seller", state.seller.join(","));
  if (state.priceMin !== "") params.set("price_min", state.priceMin);
  if (state.priceMax !== "") params.set("price_max", state.priceMax);
  if (state.rating !== "") params.set("rating", state.rating);
  if (state.pin !== "") params.set("pin", state.pin);
  if (state.deliverable && state.pin !== "") params.set("deliverable", "1");
  if (state.sort !== "relevance") params.set("sort", state.sort);
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

/** The API takes the same names; the page size is left to the server's default of 24. */
export function apiQuery(state: SearchState, cursor: string | null): string {
  const params = new URLSearchParams(writeSearch(state));
  if (!params.has("sort")) params.set("sort", state.sort);
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

export const hasFilters = (state: SearchState): boolean =>
  state.category !== "" || state.brand.length > 0 || state.seller.length > 0 || state.priceMin !== "" || state.priceMax !== "" || state.rating !== "" || state.deliverable;
