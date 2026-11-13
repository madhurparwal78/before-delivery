import type pg from 'pg';

/**
 * Rank placement: the card goes immediately before the visible card that holds `position`; past the last
 * visible card it goes after the list's last card. `listIds` excludes the moving card.
 */
export function insertionIndex(listIds: string[], visibleIds: string[], position: number): number {
  const anchor = visibleIds[position - 1];
  return anchor === undefined ? listIds.length : listIds.indexOf(anchor);
}

/** Writes a list's order back as dense ranks 1..N, optionally moving cards into the list. */
export async function renumber(client: pg.PoolClient, listId: string, orderedIds: string[]): Promise<void> {
  if (orderedIds.length === 0) return;
  await client.query(
    `UPDATE cards SET list_id = $1, rank = v.rank
       FROM unnest($2::uuid[]) WITH ORDINALITY AS v(id, rank) WHERE cards.id = v.id`,
    [listId, orderedIds],
  );
}
