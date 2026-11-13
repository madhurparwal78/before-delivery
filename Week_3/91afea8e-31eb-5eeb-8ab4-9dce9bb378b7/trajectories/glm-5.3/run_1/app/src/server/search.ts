import { config } from "./config.js";

const BASE = config.meilisearch.url;
const KEY = config.meilisearch.apiKey;

async function req(method: string, path: string, body?: unknown): Promise<{ status: number; json: any } | null> {
  if (!BASE) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { status: res.status, json };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface ListingDoc {
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

let settingsApplied = false;

async function ensureIndex(): Promise<void> {
  if (settingsApplied) return;
  const create = await req("POST", "/indexes", { uid: config.meilisearch.index, primaryKey: "listing_id" });
  if (create && (create.status === 202 || create.status === 200)) {
    await req("PATCH", `/indexes/${config.meilisearch.index}/settings`, {
      searchableAttributes: ["title", "brand", "description", "seller_name"],
      filterableAttributes: ["category", "brand", "seller_id", "price_paise", "rating", "pincodes", "in_stock"],
      sortableAttributes: ["price_paise", "rating", "created_seq"],
      typoTolerance: { minWordSizeForTypos: { oneTypo: 5 } },
    });
  } else if (create && create.status === 400) {
    // index exists; still apply settings once per process
    await req("PATCH", `/indexes/${config.meilisearch.index}/settings`, {
      searchableAttributes: ["title", "brand", "description", "seller_name"],
      filterableAttributes: ["category", "brand", "seller_id", "price_paise", "rating", "pincodes", "in_stock"],
      sortableAttributes: ["price_paise", "rating", "created_seq"],
      typoTolerance: { minWordSizeForTypos: { oneTypo: 5 } },
    });
  }
  settingsApplied = true;
}

export async function msUpsert(docs: ListingDoc[]): Promise<boolean> {
  if (docs.length === 0) return true;
  await ensureIndex();
  const res = await req("POST", `/indexes/${config.meilisearch.index}/documents?primaryKey=listing_id`, docs);
  return res !== null && res.status < 300;
}

export async function msDelete(ids: string[]): Promise<boolean> {
  if (ids.length === 0) return true;
  await ensureIndex();
  const res = await req("POST", `/indexes/${config.meilisearch.index}/documents/delete-batch`, ids);
  return res !== null && res.status < 300;
}

export interface MsHit {
  listing_id: string;
  product_id: string;
  title: string;
  brand: string;
  category: string;
  seller_id: string;
  seller_name: string;
  price_paise: number;
  rating: number;
  in_stock: boolean;
  pincodes: string[];
  created_seq: number;
}

export async function msSearch(params: {
  q: string;
  filter?: string;
  sort?: string[];
  limit: number;
  offset: number;
  facets?: string[];
}): Promise<{ hits: MsHit[]; estimatedTotalHits: number; facetDistribution: Record<string, Record<string, number>> } | null> {
  await ensureIndex();
  const body: Record<string, unknown> = {
    q: params.q,
    limit: params.limit,
    offset: params.offset,
    showRankingScore: false,
  };
  if (params.filter) body.filter = params.filter;
  if (params.sort) body.sort = params.sort;
  if (params.facets) body.facets = params.facets;
  const res = await req("POST", `/indexes/${config.meilisearch.index}/search`, body);
  if (!res || res.status >= 300) return null;
  const json = res.json;
  return {
    hits: json.hits ?? [],
    estimatedTotalHits: json.estimatedTotalHits ?? 0,
    facetDistribution: json.facetDistribution ?? {},
  };
}

export async function msWaitHealthy(): Promise<boolean> {
  const res = await req("GET", "/health");
  return res !== null && res.status === 200;
}

export function resetSettingsFlag(): void {
  settingsApplied = false;
}
