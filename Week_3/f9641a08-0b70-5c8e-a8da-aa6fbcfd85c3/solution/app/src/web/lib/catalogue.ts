import type { FacetGroup, FilterOptions } from "../../shared/api";
import { withQuery } from "./router";

// The catalogue state lives in the address: q, category, colour, size, material, price, fit, sort, page, compare.

export const GROUPS: FacetGroup[] = ["category", "colour", "size", "material", "price", "fit"];
export const GROUP_TITLES: Record<FacetGroup, string> = {
  category: "Category",
  colour: "Colour",
  size: "Size",
  material: "Material",
  price: "Price",
  fit: "Cabin fit",
};

export const SORTS: { value: string; label: string }[] = [
  { value: "featured", label: "Featured" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "price-desc", label: "Price: high to low" },
  { value: "newest", label: "Newest" },
];

export const COLLECTION_SLUGS = ["all", "luggage", "backpacks", "totes", "wallets", "accessories"];

export interface CatalogueState {
  q: string;
  filters: Record<FacetGroup, string[]>;
  sort: string;
  page: number;
  compare: string[];
}

function list(value: string | null): string[] {
  return value ? value.split(",").filter(Boolean) : [];
}

export function parseState(params: URLSearchParams): CatalogueState {
  const sort = params.get("sort") ?? "featured";
  const page = Number.parseInt(params.get("page") ?? "1", 10);
  return {
    q: params.get("q") ?? "",
    filters: {
      category: list(params.get("category")),
      colour: list(params.get("colour")),
      size: list(params.get("size")),
      material: list(params.get("material")),
      price: list(params.get("price")),
      fit: list(params.get("fit")),
    },
    sort: SORTS.some((s) => s.value === sort) ? sort : "featured",
    page: Number.isFinite(page) && page > 1 ? page : 1,
    compare: list(params.get("compare")),
  };
}

function toQuery(state: CatalogueState): Record<string, string | undefined> {
  return {
    q: state.q || undefined,
    category: state.filters.category.join(",") || undefined,
    colour: state.filters.colour.join(",") || undefined,
    size: state.filters.size.join(",") || undefined,
    material: state.filters.material.join(",") || undefined,
    price: state.filters.price.join(",") || undefined,
    fit: state.filters.fit.join(",") || undefined,
    sort: state.sort === "featured" ? undefined : state.sort,
    page: state.page > 1 ? String(state.page) : undefined,
    compare: state.compare.join(",") || undefined,
  };
}

/** The address of a collection page in `state`; parameters at their defaults are left out. */
export function collectionUrl(slug: string, state: CatalogueState): string {
  return withQuery(`/collections/${slug}`, toQuery(state));
}

/** The `/api/search` request for `state`, ignoring values the collection does not offer. */
export function searchPath(slug: string, state: CatalogueState, options: FilterOptions | null): string {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (slug !== "all") params.set("collection", slug);
  for (const group of GROUPS) {
    if (group === "category" && slug !== "all") continue;
    const known = options ? new Set(options[group].map((o) => o.value)) : null;
    const values = state.filters[group].filter((v) => !known || known.has(v));
    if (values.length) params.set(group, values.join(","));
  }
  if (state.sort !== "featured") params.set("sort", state.sort);
  if (state.page > 1) params.set("page", String(state.page));
  return `/api/search?${params.toString().replace(/%2C/g, ",")}`;
}

/** The current address with its `compare` parameter replaced (one history entry). */
export function compareUrl(set: string[]): string {
  const params = new URLSearchParams(window.location.search);
  if (set.length) params.set("compare", set.join(","));
  else params.delete("compare");
  const query = params.toString().replace(/%2C/g, ",");
  return window.location.pathname + (query ? `?${query}` : "");
}
