import { config } from "../config.js";
import { pool, query, transaction } from "../db.js";
import { promiseDate, sellerDelivers, type Destination } from "../domain/promise.js";
import { imageUrl, loadSellers, sellerLane, type ListingRow, type ProductRow, type SellerRow } from "./catalogue.js";
import { ProviderUnavailable, providerFetch } from "./provider.js";

const INDEX = config.meilisearch.index;
const SEARCH_TIMEOUT_MS = 3000;
export type SortKey = "relevance" | "price_asc" | "price_desc" | "rating" | "newest";

interface IndexDocument {
  listing_id: string;
  product_id: string;
  title: string;
  brand: string;
  category: string;
  description: string;
  seller_id: string;
  seller_name: string;
  price_paise: number;
  rating: number;
  in_stock: boolean;
  pincodes: string[];
  created_seq: number;
}

async function meili(method: string, path: string, body?: unknown, timeoutMs?: number): Promise<Response> {
  return providerFetch(
    `${config.meilisearch.url}${path}`,
    {
      method,
      headers: { Authorization: `Bearer ${config.meilisearch.apiKey}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    timeoutMs,
  );
}

async function settled(taskUid: number): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const task = (await (await meili("GET", `/tasks/${taskUid}`)).json()) as { status: string };
    if (task.status === "succeeded" || task.status === "failed" || task.status === "canceled") return task.status;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new ProviderUnavailable("search task did not settle");
}

export async function queueListing(listingId: string, nowMs: number, executor: { query: typeof pool.query } = pool): Promise<void> {
  await executor.query(
    "INSERT INTO search_outbox (listing_id, queued_at) VALUES ($1, $2) ON CONFLICT (listing_id) DO UPDATE SET queued_at = EXCLUDED.queued_at",
    [listingId, nowMs],
  );
}

let indexReady = false;

/** Creates the index with its published settings the first time, and queues every live listing into it. */
async function ensureIndex(): Promise<void> {
  if (indexReady) return;
  const found = await meili("GET", `/indexes/${INDEX}`).then(
    () => true,
    () => false,
  );
  if (!found) {
    const created = (await (await meili("POST", "/indexes", { uid: INDEX, primaryKey: "listing_id" })).json()) as { taskUid: number };
    if ((await settled(created.taskUid)) === "succeeded") {
      const configured = (await (
        await meili("PATCH", `/indexes/${INDEX}/settings`, {
          searchableAttributes: ["title", "brand", "description", "seller_name"],
          filterableAttributes: ["category", "brand", "seller_id", "price_paise", "rating", "pincodes", "in_stock"],
          sortableAttributes: ["price_paise", "rating", "created_seq"],
        })
      ).json()) as { taskUid: number };
      await settled(configured.taskUid);
      await query("INSERT INTO search_outbox (listing_id, queued_at) SELECT id, $1 FROM listings ON CONFLICT (listing_id) DO NOTHING", [Date.now()]);
    }
  }
  indexReady = true;
}

async function documentsFor(ids: readonly string[]): Promise<Map<string, IndexDocument>> {
  const rows = await query<{ listing: ListingRow; product: ProductRow; seller: SellerRow }>(
    `SELECT to_jsonb(l) AS listing, to_jsonb(p) AS product, to_jsonb(s) AS seller
       FROM listings l JOIN products p ON p.id = l.product_id JOIN sellers s ON s.id = l.seller_id
      WHERE l.id = ANY($1) AND l.status = 'live'`,
    [ids],
  );
  const serviceable = await query<{ pincode: string; state: string }>("SELECT pincode, state FROM pincodes WHERE serviceable");
  return new Map(
    rows.map(({ listing, product, seller }) => [
      listing.id,
      {
        listing_id: listing.id,
        product_id: product.id,
        title: product.title,
        brand: product.brand,
        category: product.category,
        description: listing.description,
        seller_id: seller.id,
        seller_name: seller.name,
        price_paise: listing.price_paise,
        rating: product.rating,
        in_stock: listing.stock > 0,
        pincodes: serviceable.filter((p) => seller.ship_to_states.includes(p.state)).map((p) => p.pincode),
        created_seq: listing.created_seq,
      },
    ]),
  );
}

/** One pass over the outbox: Postgres is committed already; the index catches up. */
export async function syncIndex(): Promise<void> {
  await ensureIndex();
  await transaction(async (client) => {
    const queued = await query<{ listing_id: string }>("SELECT listing_id FROM search_outbox ORDER BY queued_at LIMIT 200 FOR UPDATE SKIP LOCKED", [], client);
    if (queued.length === 0) return;
    const ids = queued.map((row) => row.listing_id);
    const documents = await documentsFor(ids);
    const stale = ids.filter((id) => !documents.has(id));
    if (documents.size > 0) await meili("POST", `/indexes/${INDEX}/documents`, [...documents.values()]);
    if (stale.length > 0) await meili("POST", `/indexes/${INDEX}/documents/delete-batch`, stale);
    await query("DELETE FROM search_outbox WHERE listing_id = ANY($1)", [ids], client);
  });
}

interface SearchParams {
  q: string;
  category?: string;
  brand?: string[];
  seller?: string[];
  priceMinRupees?: number;
  priceMaxRupees?: number;
  rating?: 3 | 4;
  pin?: string;
  deliverable: boolean;
  sort: SortKey;
  cursor: string | null;
  limit: number;
}

interface Hit {
  listing_id: string;
  product_id: string;
  title: string;
  brand: string;
  category: string;
  seller_id: string;
  seller_name: string;
  price_paise: number;
  rating: number;
  image_url: string;
  in_stock: boolean;
  delivers: boolean | null;
  promise_date: string | null;
}

interface SearchResult {
  hits: Hit[];
  facets: Record<string, Record<string, number>>;
  total: number;
  next_cursor: string | null;
  degraded: boolean;
}

const quoted = (value: string): string => JSON.stringify(value);

function filters(params: SearchParams, skip: "category" | "brand" | "seller" | "rating" | null): string[] {
  const list: string[] = [];
  if (params.category !== undefined && skip !== "category") list.push(`category = ${quoted(params.category)}`);
  if (params.brand && skip !== "brand") list.push(`brand IN [${params.brand.map(quoted).join(", ")}]`);
  if (params.seller && skip !== "seller") list.push(`seller_id IN [${params.seller.map(quoted).join(", ")}]`);
  if (params.priceMinRupees !== undefined) list.push(`price_paise >= ${params.priceMinRupees * 100}`);
  if (params.priceMaxRupees !== undefined) list.push(`price_paise <= ${params.priceMaxRupees * 100}`);
  if (params.rating !== undefined && skip !== "rating") list.push(`rating >= ${params.rating}`);
  if (params.deliverable && params.pin) list.push(`pincodes = ${quoted(params.pin)}`);
  return list;
}

function effectiveSort(params: SearchParams): SortKey {
  return params.sort === "relevance" && params.q === "" ? "newest" : params.sort;
}

function sortSpec(sort: SortKey): string[] {
  switch (sort) {
    case "price_asc":
      return ["price_paise:asc", "created_seq:asc"];
    case "price_desc":
      return ["price_paise:desc", "created_seq:asc"];
    case "rating":
      return ["rating:desc", "created_seq:desc"];
    default:
      return ["created_seq:desc"];
  }
}

function encodeCursor(value: unknown[]): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeCursor(cursor: string | null): unknown[] | null {
  if (cursor === null) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** The keyset condition after a cursor for a fixed sort key plus the unique created_seq. */
function cursorFilter(sort: SortKey, cursor: unknown[]): string | null {
  const [value, seq] = cursor;
  if (typeof seq !== "number") return null;
  switch (sort) {
    case "price_asc":
      return typeof value === "number" ? `(price_paise > ${value} OR (price_paise = ${value} AND created_seq > ${seq}))` : null;
    case "price_desc":
      return typeof value === "number" ? `(price_paise < ${value} OR (price_paise = ${value} AND created_seq > ${seq}))` : null;
    case "rating":
      return typeof value === "number" ? `(rating < ${value} OR (rating = ${value} AND created_seq < ${seq}))` : null;
    default:
      return `created_seq < ${seq}`;
  }
}

function cursorOf(sort: SortKey, doc: Pick<IndexDocument, "price_paise" | "rating" | "created_seq">): unknown[] {
  switch (sort) {
    case "price_asc":
    case "price_desc":
      return [doc.price_paise, doc.created_seq];
    case "rating":
      return [doc.rating, doc.created_seq];
    default:
      return [null, doc.created_seq];
  }
}

async function searchIndex(body: Record<string, unknown>): Promise<{ hits: IndexDocument[]; totalHits?: number; facetDistribution?: Record<string, Record<string, number>> }> {
  return (await (await meili("POST", `/indexes/${INDEX}/search`, body, SEARCH_TIMEOUT_MS)).json()) as {
    hits: IndexDocument[];
    totalHits?: number;
    facetDistribution?: Record<string, Record<string, number>>;
  };
}

async function decorate(
  docs: Pick<IndexDocument, "listing_id" | "product_id" | "title" | "brand" | "category" | "seller_id" | "seller_name" | "price_paise" | "rating" | "in_stock">[],
  destination: Destination | null,
  nowMs: number,
): Promise<Hit[]> {
  const sellers = await loadSellers();
  return docs.map((doc) => {
    const seller = sellers.get(doc.seller_id) as SellerRow;
    return {
      listing_id: doc.listing_id,
      product_id: doc.product_id,
      title: doc.title,
      brand: doc.brand,
      category: doc.category,
      seller_id: doc.seller_id,
      seller_name: doc.seller_name,
      price_paise: doc.price_paise,
      rating: doc.rating,
      image_url: imageUrl(doc.product_id, doc.category),
      in_stock: doc.in_stock,
      delivers: destination ? sellerDelivers(sellerLane(seller), destination) : null,
      promise_date: destination ? promiseDate(nowMs, sellerLane(seller), destination, "standard") : null,
    };
  });
}

async function viaIndex(params: SearchParams, destination: Destination | null, nowMs: number): Promise<SearchResult> {
  const sort = effectiveSort(params);
  const byRelevance = sort === "relevance";
  const cursor = decodeCursor(params.cursor);
  const base = filters(params, null);
  const hitFilter = [...base];
  let offset = 0;
  if (cursor) {
    if (byRelevance) offset = typeof cursor[0] === "number" ? cursor[0] : 0;
    else {
      const after = cursorFilter(sort, cursor);
      if (after) hitFilter.push(after);
    }
  }
  const [main, total, category, brand, seller, four, three] = await Promise.all([
    searchIndex({
      q: params.q,
      filter: hitFilter,
      sort: byRelevance ? undefined : sortSpec(sort),
      limit: params.limit + 1,
      offset,
    }),
    searchIndex({ q: params.q, filter: base, hitsPerPage: 1, page: 1 }),
    searchIndex({ q: params.q, filter: filters(params, "category"), facets: ["category"], limit: 0 }),
    searchIndex({ q: params.q, filter: filters(params, "brand"), facets: ["brand"], limit: 0 }),
    searchIndex({ q: params.q, filter: filters(params, "seller"), facets: ["seller_id"], limit: 0 }),
    searchIndex({ q: params.q, filter: [...filters(params, "rating"), "rating >= 4"], hitsPerPage: 1, page: 1 }),
    searchIndex({ q: params.q, filter: [...filters(params, "rating"), "rating >= 3"], hitsPerPage: 1, page: 1 }),
  ]);
  const page = main.hits.slice(0, params.limit);
  const last = page[page.length - 1];
  const more = main.hits.length > params.limit && last !== undefined;
  const next = more ? encodeCursor(byRelevance ? [offset + params.limit] : cursorOf(sort, last)) : null;
  return {
    hits: await decorate(page, destination, nowMs),
    facets: {
      category: category.facetDistribution?.category ?? {},
      brand: brand.facetDistribution?.brand ?? {},
      seller: seller.facetDistribution?.seller_id ?? {},
      rating: { "4": four.totalHits ?? 0, "3": three.totalHits ?? 0 },
    },
    total: total.totalHits ?? 0,
    next_cursor: next,
    degraded: false,
  };
}

const SQL_ORDER: Record<SortKey, string> = {
  relevance: "l.created_seq DESC",
  newest: "l.created_seq DESC",
  price_asc: "l.price_paise ASC, l.created_seq ASC",
  price_desc: "l.price_paise DESC, l.created_seq ASC",
  rating: "p.rating DESC, l.created_seq DESC",
};

/** The keyset condition after a cursor, with its values appended to `args`. */
function sqlAfter(sort: SortKey, cursor: unknown[], args: unknown[]): string | null {
  const [value, seq] = cursor;
  if (typeof seq !== "number") return null;
  if (sort === "newest" || sort === "relevance") {
    args.push(seq);
    return `l.created_seq < $${args.length}`;
  }
  if (typeof value !== "number") return null;
  args.push(value, seq);
  const [v, q] = [`$${args.length - 1}`, `$${args.length}`];
  if (sort === "price_asc") return `(l.price_paise > ${v} OR (l.price_paise = ${v} AND l.created_seq > ${q}))`;
  if (sort === "price_desc") return `(l.price_paise < ${v} OR (l.price_paise = ${v} AND l.created_seq > ${q}))`;
  return `(p.rating < ${v} OR (p.rating = ${v} AND l.created_seq < ${q}))`;
}

/** The basic mode: a case-insensitive title match in Postgres; filters other than sort are ignored. */
async function viaPostgres(params: SearchParams, destination: Destination | null, nowMs: number): Promise<SearchResult> {
  const sort = effectiveSort(params);
  const pattern = `%${params.q.replace(/[\\%_]/g, "\\$&")}%`;
  const args: unknown[] = [pattern];
  const clauses = ["l.status = 'live'", "p.title ILIKE $1"];
  const cursor = decodeCursor(params.cursor);
  const after = cursor ? sqlAfter(sort, cursor, args) : null;
  if (after) clauses.push(after);
  const rows = await query<{ doc: IndexDocument }>(
    `SELECT jsonb_build_object('listing_id', l.id, 'product_id', p.id, 'title', p.title, 'brand', p.brand, 'category', p.category,
              'seller_id', s.id, 'seller_name', s.name, 'price_paise', l.price_paise, 'rating', p.rating,
              'in_stock', l.stock > 0, 'created_seq', l.created_seq) AS doc
       FROM listings l JOIN products p ON p.id = l.product_id JOIN sellers s ON s.id = l.seller_id
      WHERE ${clauses.join(" AND ")} ORDER BY ${SQL_ORDER[sort]} LIMIT ${params.limit + 1}`,
    args,
  );
  const count = await query<{ total: number }>(
    "SELECT count(*)::int AS total FROM listings l JOIN products p ON p.id = l.product_id WHERE l.status = 'live' AND p.title ILIKE $1",
    [pattern],
  );
  const docs = rows.map((row) => row.doc);
  const page = docs.slice(0, params.limit);
  const last = page[page.length - 1];
  return {
    hits: await decorate(page, destination, nowMs),
    facets: {},
    total: count[0]?.total ?? 0,
    next_cursor: docs.length > params.limit && last ? encodeCursor(cursorOf(sort, last)) : null,
    degraded: true,
  };
}

export async function search(params: SearchParams, destination: Destination | null, nowMs: number): Promise<SearchResult> {
  try {
    return await viaIndex(params, destination, nowMs);
  } catch (error) {
    if (!(error instanceof ProviderUnavailable)) throw error;
    return viaPostgres(params, destination, nowMs);
  }
}
