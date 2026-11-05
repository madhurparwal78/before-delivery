import { query } from '../db/pool.js';
import { findModelBySlug, isRebuilding } from '../db/models.js';
import { activePlan } from '../db/plan.js';
import { belongsInSearchIndex } from '../domain/model.js';
import { buildDocument } from '../services/indexer.js';
import { deleteDocument, putDocuments } from '../services/search.js';

/**
 * Finishes index work that an outage left unconfirmed. Until a removal clears,
 * every derived surface answers `search_unavailable`.
 */
export async function retryPendingSearchWork(): Promise<void> {
  const removals = await query<{ slug: string }>(`SELECT slug FROM search_removals LIMIT 20`);
  for (const { slug } of removals) {
    await deleteDocument(slug);
    await query(`DELETE FROM search_removals WHERE slug = $1`, [slug]);
  }

  const writes = await query<{ slug: string }>(`SELECT slug FROM search_writes LIMIT 20`);
  if (writes.length === 0) return;
  const planName = await activePlan();
  for (const { slug } of writes) {
    const model = await findModelBySlug(slug, planName);
    if (model !== null && belongsInSearchIndex(model)) {
      await putDocuments([buildDocument(model, await isRebuilding(model.id))]);
    }
    await query(`DELETE FROM search_writes WHERE slug = $1`, [slug]);
  }
}
