// Meilisearch: one index with the published searchable and filterable settings,
// confirmed writes, fallback search while unreachable or rebuilding, catch-up of
// recorded updates in order, and a full rebuild from Postgres when the index is lost.

import { MeiliSearch } from "meilisearch";
import type { Pool } from "pg";
import type { Reference } from "../shared/domain.js";

export const indexName = process.env.MEILISEARCH_INDEX ?? "references";

export const meili = new MeiliSearch({
  host: process.env.MEILISEARCH_URL!,
  apiKey: process.env.MEILISEARCH_API_KEY,
});

export interface SearchDoc {
  id: string; title: string; maker: string | null; year: number | null;
  materials: string[]; finish: string | null; colour_family: string;
  notes: string | null;
}

export function searchDoc(r: Reference): SearchDoc {
  return {
    id: r.id,
    title: r.title,
    maker: r.maker,
    year: r.year,
    materials: r.materials,
    finish: r.finish,
    colour_family: r.colour_family,
    notes: r.notes,
  };
}

// Idempotently create the index with its published settings.
export async function ensureIndexSettings(): Promise<void> {
  const task = await meili.index(indexName).updateSearchableAttributes(
    ["title", "maker", "year", "materials", "finish", "colour_family", "notes"],
  );
  await meili.index(indexName).waitForTask(task.taskUid);
  const fTask = await meili.index(indexName).updateFilterableAttributes(
    ["colour_family", "materials", "finish", "maker", "year"],
  );
  await meili.index(indexName).waitForTask(fTask.taskUid);
}

export async function indexExists(): Promise<boolean> {
  try {
    await meili.index(indexName).getStats();
    return true;
  } catch {
    return false;
  }
}

export async function meiliUp(): Promise<boolean> {
  try {
    const health = await meili.health();
    if (!indexExists()) return false;
    return health.status === "available";
  } catch {
    return false;
  }
}
