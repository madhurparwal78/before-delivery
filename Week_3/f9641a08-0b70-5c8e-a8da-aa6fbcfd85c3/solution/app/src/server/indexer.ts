import { Meilisearch } from "meilisearch";
import type { SearchResult } from "../shared/api";
import { SIZE_LABELS, slugify } from "../shared/format";
import { airlines, loadCatalogue, fitsAirlines, type CatalogueEntry } from "./catalogue";
import { config } from "./config";
import { pool, rows } from "./db";
import { onKickIndexer } from "./stock";
import { bandsOf, cardFor } from "./search";

export const INDEX = "products";

export const meili = new Meilisearch({ host: config.meilisearchUrl, apiKey: config.meilisearchKey, timeout: 4000 });

const SYNONYMS: Record<string, string[]> = {
  "carry-on": ["carry on", "cabin"],
  "carry on": ["carry-on", "cabin"],
  cabin: ["carry-on", "carry on"],
  "check-in": ["hold"],
  hold: ["check-in"],
  suitcase: ["luggage"],
  luggage: ["suitcase"],
  rucksack: ["backpack"],
  backpack: ["rucksack"],
  duffle: ["duffel"],
  duffel: ["duffle"],
};

const SETTINGS = {
  searchableAttributes: ["name", "skus", "colours", "sizes", "size_cm", "category", "material", "description"],
  filterableAttributes: ["collection", "category", "colour", "size", "material", "price", "fit"],
  sortableAttributes: ["min_price", "published_at", "featured_rank", "name"],
  synonyms: SYNONYMS,
  typoTolerance: { enabled: true, disableOnAttributes: ["skus"] },
  faceting: { maxValuesPerFacet: 10_000 },
};

interface Document {
  id: string;
  name: string;
  skus: string[];
  colours: string[];
  sizes: string[];
  size_cm: string[];
  category: string;
  material: string;
  description: string;
  collection: string;
  colour: string[];
  size: string[];
  price: string[];
  fit: string[];
  min_price: number;
  published_at: number;
  featured_rank: number;
  card: SearchResult;
}

async function documentFor(entry: CatalogueEntry, frames: Awaited<ReturnType<typeof airlines>>): Promise<Document> {
  const card = await cardFor(entry);
  const unique = <T>(values: T[]): T[] => [...new Set(values)];
  return {
    id: entry.slug,
    name: entry.name,
    skus: entry.variants.map((v) => v.sku),
    colours: unique(entry.variants.map((v) => v.colour)),
    sizes: unique(entry.variants.map((v) => SIZE_LABELS[v.size_slug] ?? v.size_slug)),
    size_cm: unique(entry.variants.map((v) => `${v.height_cm} cm`)),
    category: entry.category,
    material: slugify(entry.material),
    description: entry.description,
    collection: entry.category,
    colour: unique(entry.variants.map((v) => v.colour_slug)),
    size: unique(entry.variants.map((v) => v.size_slug)),
    price: bandsOf(entry.variants.map((v) => v.price)),
    fit: fitsAirlines(entry, frames),
    min_price: card.min_price,
    published_at: Math.floor((entry.published_at?.getTime() ?? 0) / 1000),
    featured_rank: entry.featured_rank,
    card,
  };
}

let ready = false;
let running = false;
let again = false;

async function ensureIndex(): Promise<void> {
  if (ready) return;
  await meili.createIndex(INDEX, { primaryKey: "id" }).then((task) => meili.tasks.waitForTask(task.taskUid, { timeout: 30_000 })).catch(() => undefined);
  const index = meili.index(INDEX);
  const current = await index.getSettings();
  const same =
    JSON.stringify(current.searchableAttributes) === JSON.stringify(SETTINGS.searchableAttributes) &&
    JSON.stringify([...(current.filterableAttributes ?? [])].sort()) === JSON.stringify([...SETTINGS.filterableAttributes].sort()) &&
    JSON.stringify([...(current.sortableAttributes ?? [])].sort()) === JSON.stringify([...SETTINGS.sortableAttributes].sort()) &&
    JSON.stringify(current.synonyms) === JSON.stringify(SETTINGS.synonyms) &&
    current.faceting?.maxValuesPerFacet === SETTINGS.faceting.maxValuesPerFacet;
  if (!same) {
    const task = await index.updateSettings(SETTINGS);
    await meili.tasks.waitForTask(task.taskUid, { timeout: 60_000 });
  }
  ready = true;
}

/** Pushes every dirty product (and deletes the ones no longer published). A failed push stays dirty and is retried. */
async function syncDirty(): Promise<void> {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    do {
      again = false;
      const dirty = await rows<{ slug: string; marked_at: Date }>(pool, "SELECT slug, marked_at FROM search_dirty ORDER BY marked_at LIMIT 200");
      if (dirty.length === 0) break;
      await ensureIndex();
      const slugs = dirty.map((d) => d.slug);
      const entries = await loadCatalogue(pool, { slugs, published: true });
      const frames = await airlines(pool);
      const index = meili.index(INDEX);
      const documents = await Promise.all(entries.map((entry) => documentFor(entry, frames)));
      const gone = slugs.filter((slug) => !entries.some((e) => e.slug === slug));
      if (documents.length > 0) await meili.tasks.waitForTask((await index.addDocuments(documents)).taskUid, { timeout: 60_000 });
      if (gone.length > 0) await meili.tasks.waitForTask((await index.deleteDocuments(gone)).taskUid, { timeout: 60_000 });
      for (const d of dirty) await pool.query("DELETE FROM search_dirty WHERE slug = $1 AND date_trunc('milliseconds', marked_at) <= $2", [d.slug, d.marked_at]);
    } while (again);
  } finally {
    running = false;
  }
}

export async function searchReachable(): Promise<boolean> {
  try {
    await meili.health();
    return true;
  } catch {
    return false;
  }
}

/** On start every product is marked dirty; then the retry loop keeps the index following the catalogue. */
export function startIndexer(): void {
  const attempt = (): void => void syncDirty().catch((failure) => console.error("search index push failed", failure instanceof Error ? failure.message : failure));
  onKickIndexer(attempt);
  void pool.query("INSERT INTO search_dirty (slug) SELECT slug FROM products ON CONFLICT (slug) DO UPDATE SET marked_at = now()").then(attempt).catch(() => undefined);
  setInterval(attempt, 2000);
}
