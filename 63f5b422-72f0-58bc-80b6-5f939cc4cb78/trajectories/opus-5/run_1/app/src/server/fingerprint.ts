import { allNodes } from '../shared/tree.js';
import { pageHasCollectionList, pageUsesToken } from '../shared/usage.js';
import type { PlinthDocument } from '../shared/types.js';

/**
 * Everything a published page is rendered from. A live page becomes
 * live_changed when its fingerprint changes.
 */
export function pageFingerprints(doc: PlinthDocument): Map<string, string> {
  const out = new Map<string, string>();
  for (const page of doc.pages) {
    const componentIds = new Set(
      allNodes(page.root)
        .map((node) => node.shared?.componentId)
        .filter((id): id is string => id !== undefined),
    );
    out.set(
      page.id,
      JSON.stringify({
        name: doc.name,
        page,
        tokens: doc.tokens.filter((token) => pageUsesToken(doc, page, token.name)),
        components: doc.components.filter((component) => componentIds.has(component.id)),
        collection: pageHasCollectionList(page) ? doc.collection : null,
      }),
    );
  }
  return out;
}
