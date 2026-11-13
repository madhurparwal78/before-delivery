import type { FacetCounts, FacetGroup, FilterOptions, SearchResponse, SearchResult, SuggestResponse } from "../shared/api";
import { SIZE_LABELS, slugify } from "../shared/format";
import { config } from "./config";
import { airlines, cardVariant, fitsAirlines, loadCatalogue, productBadge, savePercent, sizeLabel, imagesFor, type CatalogueEntry } from "./catalogue";
import { rows, pool } from "./db";
import { INDEX, meili } from "./indexer";

// Storefront search: Meilisearch while it answers; a PostgreSQL listing, with a notice and no counts, when it does not.

const SEARCH_NOTICE = "Search is unavailable. You can still browse and filter, but typo matching and filter counts are off.";

const GROUPS: FacetGroup[] = ["category", "colour", "size", "material", "price", "fit"];
export const COLLECTIONS = ["all", "luggage", "backpacks", "totes", "wallets", "accessories"];
const SORTS = ["featured", "price-asc", "price-desc", "newest"] as const;
type Sort = (typeof SORTS)[number];

const PRICE_BANDS = [
  { slug: "under-5000", label: "Under ₹5,000", min: 0, max: 4999 },
  { slug: "5000-9999", label: "₹5,000 to ₹9,999", min: 5000, max: 9999 },
  { slug: "10000-19999", label: "₹10,000 to ₹19,999", min: 10000, max: 19999 },
  { slug: "20000-plus", label: "₹20,000 and over", min: 20000, max: Infinity },
];

const CATEGORY_LABELS: Record<string, string> = { luggage: "Luggage", backpacks: "Backpacks", totes: "Totes", wallets: "Wallets", accessories: "Accessories" };

export function bandsOf(prices: number[]): string[] {
  return PRICE_BANDS.filter((band) => prices.some((p) => p >= band.min && p <= band.max)).map((band) => band.slug);
}

interface SearchInput {
  q: string;
  collection: string;
  filters: Record<FacetGroup, string[]>;
  sort: Sort;
  page: number;
}

interface Universe {
  options: FilterOptions;
  known: Record<FacetGroup, Set<string>>;
}

/** Option lists of the collection (labels included) and every value the published catalogue holds. */
async function universe(collection: string): Promise<Universe> {
  const found = await rows<{ category: string; material: string; colour: string; colour_slug: string; size_slug: string; price: number }>(
    pool,
    `SELECT p.category, p.material, v.colour, v.colour_slug, v.size_slug, v.price
     FROM products p JOIN variants v ON v.product_id = p.id WHERE p.status = 'published' ORDER BY p.featured_rank, v.position`,
  );
  const frames = await airlines(pool);
  const entries = await loadCatalogue(pool, { published: true });
  const inCollection = (category: string) => collection === "all" || category === collection;
  const pick = (map: (r: (typeof found)[number]) => [string, string]): { value: string; label: string }[] => {
    const seen = new Map<string, string>();
    for (const row of found.filter((r) => inCollection(r.category))) {
      const [value, label] = map(row);
      if (!seen.has(value)) seen.set(value, label);
    }
    return [...seen].map(([value, label]) => ({ value, label }));
  };
  const everything = (map: (r: (typeof found)[number]) => string) => new Set(found.map(map));
  const fitCodes = new Set<string>();
  const fitHere = new Set<string>();
  for (const entry of entries) {
    for (const code of fitsAirlines(entry, frames)) {
      fitCodes.add(code);
      if (inCollection(entry.category)) fitHere.add(code);
    }
  }
  const sizeOrder = Object.keys(SIZE_LABELS);
  const options: FilterOptions = {
    category: Object.keys(CATEGORY_LABELS).filter((c) => found.some((r) => r.category === c)).map((value) => ({ value, label: CATEGORY_LABELS[value] ?? value })),
    colour: pick((r) => [r.colour_slug, r.colour]),
    size: pick((r) => [r.size_slug, sizeLabel(r.size_slug)]).sort((a, b) => sizeOrder.indexOf(a.value) - sizeOrder.indexOf(b.value)),
    material: pick((r) => [slugify(r.material), r.material]),
    price: PRICE_BANDS.filter((band) => found.some((r) => inCollection(r.category) && r.price >= band.min && r.price <= band.max)).map((b) => ({ value: b.slug, label: b.label })),
    fit: frames.filter((f) => fitHere.has(f.code)).map((f) => ({ value: f.code, label: f.name })),
  };
  const known: Universe["known"] = {
    category: everything((r) => r.category),
    colour: everything((r) => r.colour_slug),
    size: everything((r) => r.size_slug),
    material: everything((r) => slugify(r.material)),
    price: new Set(PRICE_BANDS.map((b) => b.slug)),
    fit: fitCodes,
  };
  return { options, known };
}

function parseInput(query: URLSearchParams): SearchInput {
  const list = (name: string): string[] => (query.get(name) ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  const sort = SORTS.find((s) => s === query.get("sort")) ?? "featured";
  const page = Number(query.get("page"));
  return {
    q: (query.get("q") ?? "").trim(),
    collection: query.get("collection") ?? "all",
    filters: { category: list("category"), colour: list("colour"), size: list("size"), material: list("material"), price: list("price"), fit: list("fit") },
    sort,
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

function withoutUnknown(input: SearchInput, known: Universe["known"]): SearchInput {
  const filters = { ...input.filters };
  for (const group of GROUPS) filters[group] = filters[group].filter((value) => known[group].has(value));
  return { ...input, filters, collection: COLLECTIONS.includes(input.collection) ? input.collection : "all" };
}

// ---- Meilisearch ---------------------------------------------------------------------------

type Clause = string | string[];

function clauses(input: SearchInput, skip?: FacetGroup): Clause[] {
  const out: Clause[] = [];
  if (input.collection !== "all") out.push(`collection = "${input.collection}"`);
  for (const group of GROUPS) {
    if (group === skip || input.filters[group].length === 0) continue;
    out.push(input.filters[group].map((value) => `${group} = "${value}"`));
  }
  return out;
}

function sortOf(input: SearchInput): string[] {
  switch (input.sort) {
    case "price-asc":
      return ["min_price:asc", "name:asc"];
    case "price-desc":
      return ["min_price:desc", "name:asc"];
    case "newest":
      return ["published_at:desc", "name:asc"];
    default:
      return input.q ? ["min_price:asc", "name:asc"] : ["featured_rank:asc"];
  }
}

interface Hit {
  card: SearchResult;
}

async function fromMeilisearch(input: SearchInput, options: FilterOptions): Promise<SearchResponse> {
  const queries = [
    { indexUid: INDEX, q: input.q, filter: clauses(input), sort: sortOf(input), page: input.page, hitsPerPage: config.pageSize, attributesToRetrieve: ["card"] },
    ...GROUPS.map((group) => ({ indexUid: INDEX, q: input.q, filter: clauses(input, group), facets: [group], limit: 0 })),
  ];
  const { results } = await meili.multiSearch<{ queries: typeof queries }, Hit>({ queries });
  const [main, ...rest] = results;
  if (!main) throw new Error("empty search answer");
  const facets = Object.fromEntries(
    GROUPS.map((group, index) => {
      const distribution = rest[index]?.facetDistribution?.[group] ?? {};
      return [group, Object.fromEntries(options[group].map((o) => [o.value, distribution[o.value] ?? 0]))];
    }),
  ) as FacetCounts;
  return {
    mode: "search",
    total: main.totalHits ?? 0,
    page: input.page,
    page_size: config.pageSize,
    results: main.hits.map((hit) => hit.card),
    facets,
    notice: null,
    options,
  };
}

// ---- PostgreSQL fallback ----------------------------------------------------------------------

export async function cardFor(entry: CatalogueEntry): Promise<SearchResult> {
  const images = await imagesFor(pool, entry);
  const cheapest = cardVariant(entry.variants);
  const colours = new Map<string, { name: string; slug: string; image_url: string }>();
  const firstSkus: Record<string, string> = {};
  for (const v of entry.variants) {
    if (colours.has(v.colour_slug)) continue;
    colours.set(v.colour_slug, { name: v.colour, slug: v.colour_slug, image_url: images.get(v.colour_slug)?.[0]?.url ?? "" });
    firstSkus[v.colour_slug] = v.sku;
  }
  return {
    slug: entry.slug,
    name: entry.name,
    category: entry.category,
    min_price: cheapest.price,
    compare_at: cheapest.compare_at,
    save_percent: savePercent(cheapest.price, cheapest.compare_at),
    price_varies: entry.variants.some((v) => v.price !== cheapest.price),
    colours: [...colours.values()],
    badge: productBadge(entry),
    skus: entry.variants.map((v) => v.sku),
    first_skus: firstSkus,
  };
}

async function fromDatabase(input: SearchInput, options: FilterOptions): Promise<SearchResponse> {
  const frames = await airlines(pool);
  const entries = await loadCatalogue(pool, { published: true });
  const text = input.q.toLowerCase();
  const matching: CatalogueEntry[] = [];
  for (const entry of entries) {
    const f = input.filters;
    if (input.collection !== "all" && entry.category !== input.collection) continue;
    if (f.category.length && !f.category.includes(entry.category)) continue;
    if (f.colour.length && !entry.variants.some((v) => f.colour.includes(v.colour_slug))) continue;
    if (f.size.length && !entry.variants.some((v) => f.size.includes(v.size_slug))) continue;
    if (f.material.length && !f.material.includes(slugify(entry.material))) continue;
    if (f.price.length && !bandsOf(entry.variants.map((v) => v.price)).some((band) => f.price.includes(band))) continue;
    if (f.fit.length && !fitsAirlines(entry, frames).some((code) => f.fit.includes(code))) continue;
    if (text && !entry.name.toLowerCase().includes(text) && !entry.variants.some((v) => v.sku.toLowerCase().includes(text))) continue;
    matching.push(entry);
  }
  const price = (e: CatalogueEntry) => cardVariant(e.variants).price;
  const byName = (a: CatalogueEntry, b: CatalogueEntry) => a.name.localeCompare(b.name);
  matching.sort((a, b) => {
    switch (input.sort) {
      case "price-asc":
        return price(a) - price(b) || byName(a, b);
      case "price-desc":
        return price(b) - price(a) || byName(a, b);
      case "newest":
        return (b.published_at?.getTime() ?? 0) - (a.published_at?.getTime() ?? 0) || byName(a, b);
      default:
        return input.q ? price(a) - price(b) || byName(a, b) : a.featured_rank - b.featured_rank;
    }
  });
  const start = (input.page - 1) * config.pageSize;
  const results = await Promise.all(matching.slice(start, start + config.pageSize).map(cardFor));
  return { mode: "fallback", total: matching.length, page: input.page, page_size: config.pageSize, results, facets: null, notice: SEARCH_NOTICE, options };
}

export async function searchProducts(query: URLSearchParams): Promise<SearchResponse> {
  const raw = parseInput(query);
  const { options, known } = await universe(COLLECTIONS.includes(raw.collection) ? raw.collection : "all");
  const input = withoutUnknown(raw, known);
  try {
    return await fromMeilisearch(input, options);
  } catch {
    return fromDatabase(input, options);
  }
}

export async function suggest(q: string): Promise<SuggestResponse> {
  if (!q.trim()) return { mode: "search", suggestions: [] };
  try {
    const found = await meili.index(INDEX).search<{ name: string; id: string }>(q, { limit: 6, attributesToRetrieve: ["name", "id"] });
    return { mode: "search", suggestions: found.hits.map((h) => ({ name: h.name, slug: h.id })) };
  } catch {
    return { mode: "fallback", suggestions: [] };
  }
}
