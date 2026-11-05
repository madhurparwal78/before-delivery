import type { ModelRecord } from '../db/models.js';
import { allModels, isRebuilding } from '../db/models.js';
import { query, queryOne } from '../db/pool.js';
import { belongsInSearchIndex } from '../domain/model.js';
import type { CatalogueLicence } from '../domain/money.js';
import { discountedPriceCents } from '../domain/money.js';
import type { PlanName } from '../domain/plans.js';
import type { SearchDocument } from './search.js';
import { deleteAllDocuments, deleteDocument, putDocuments } from './search.js';

export function licencesOffered(model: ModelRecord): readonly CatalogueLicence[] {
  const out: CatalogueLicence[] = ['personal'];
  if (model.commercialCents !== null) out.push('commercial');
  if (model.studioCents !== null) out.push('studio');
  return out;
}

/** The "from" price is the discounted personal price. */
export function priceFromCents(model: ModelRecord): number {
  return discountedPriceCents(model.personalCents, model.discountPercent);
}

export function buildDocument(model: ModelRecord, rebuilding: boolean): SearchDocument {
  return {
    slug: model.slug,
    title: model.title,
    description: model.description,
    category: model.category,
    licences: licencesOffered(model),
    formats: model.formats,
    price_from_cents: priceFromCents(model),
    published_at: Math.floor((model.firstPublishedAt?.getTime() ?? model.createdAt.getTime()) / 1000),
    rebuilding,
  };
}

/**
 * Writes or deletes a model's search document. A removal is recorded first and
 * cleared only once Meilisearch confirms it, so no stale entry can be served.
 */
export async function syncModel(model: ModelRecord): Promise<void> {
  if (belongsInSearchIndex(model)) {
    await query(`DELETE FROM search_removals WHERE slug = $1`, [model.slug]);
    await query(
      `INSERT INTO search_writes (slug) VALUES ($1) ON CONFLICT (slug) DO NOTHING`,
      [model.slug],
    );
    await putDocuments([buildDocument(model, await isRebuilding(model.id))]);
    await query(`DELETE FROM search_writes WHERE slug = $1`, [model.slug]);
    return;
  }
  await query(`DELETE FROM search_writes WHERE slug = $1`, [model.slug]);
  await query(
    `INSERT INTO search_removals (slug) VALUES ($1) ON CONFLICT (slug) DO NOTHING`,
    [model.slug],
  );
  await deleteDocument(model.slug);
  await query(`DELETE FROM search_removals WHERE slug = $1`, [model.slug]);
}

/** Records the removal without failing the caller when search is unreachable. */
export async function syncModelQuietly(model: ModelRecord): Promise<void> {
  await syncModel(model).catch(() => undefined);
}

/** True while a removal has not been confirmed by Meilisearch. */
export async function hasUnconfirmedRemoval(): Promise<boolean> {
  return (await queryOne<{ slug: string }>(`SELECT slug FROM search_removals LIMIT 1`)) !== null;
}

/**
 * Makes the index match the database exactly at start, so a document for a
 * model the database no longer holds can never be served.
 */
export async function reindexAll(planName: PlanName): Promise<void> {
  const models = await allModels(planName);
  const documents: SearchDocument[] = [];
  for (const model of models) {
    if (belongsInSearchIndex(model)) {
      documents.push(buildDocument(model, await isRebuilding(model.id)));
    }
  }
  await deleteAllDocuments();
  await putDocuments(documents);
  await query(`DELETE FROM search_removals`);
  await query(`DELETE FROM search_writes`);
}
