import type { AppContext } from '../app.js';
import { initializeSearch } from '../app.js';
import { SearchUnavailableError } from '../search.js';
import type { Store } from '../store.js';

/**
 * Applies committed discovery work to the provider and confirms it, leaving work pending when the
 * provider is unavailable.
 */
export async function reconcileDiscovery(context: AppContext): Promise<void> {
  const store = context.store;
  const search = context.search;
  if (store === null || search === null) return;
  try {
    await initializeSearch(context);
    const pending = await store.pendingIndexWork();
    for (const work of pending) {
      if (work.operation === 'upsert') {
        const challenge = await store.challenge(work.digest);
        if (challenge === null || !challenge.listed) {
          await search.remove(work.digest);
        } else {
          await search.upsert({
            digest: challenge.digest,
            ruleset: challenge.ruleset,
            title: challenge.title,
            description: challenge.description,
            difficulty: challenge.difficulty,
            creatorName: challenge.creatorName,
          });
        }
      } else {
        await search.remove(work.digest);
      }
      await store.confirmIndexWork(work.digest, work.operation);
    }
  } catch (error) {
    if (!(error instanceof SearchUnavailableError)) throw error;
  }
}

/** Removes index documents that are no longer published. */
export async function sweepStaleDocuments(context: AppContext): Promise<void> {
  const store = context.store;
  const search = context.search;
  if (store === null || search === null) return;
  try {
    await initializeSearch(context);
    const indexed = await search.listDigests();
    if (indexed.length === 0) return;
    const listed = new Set(await store.listedDigests());
    for (const digest of indexed) {
      if (!listed.has(digest)) await search.remove(digest);
    }
  } catch (error) {
    if (!(error instanceof SearchUnavailableError)) throw error;
  }
}

export async function indexingState(store: Store): Promise<'pending' | 'current'> {
  return (await store.indexingPending()) ? 'pending' : 'current';
}
