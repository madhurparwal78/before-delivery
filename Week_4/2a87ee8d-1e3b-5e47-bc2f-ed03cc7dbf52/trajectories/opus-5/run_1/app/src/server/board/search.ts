import { pool } from '../db/pool.js';
import type { Viewer } from '../domain/views.js';

export interface SearchResult {
  readonly noteId: string;
  readonly frameId: string;
  readonly text: string;
}

const RESULT_LIMIT = 20;

/**
 * Postgres full-text search with the `simple` configuration and web-search query syntax,
 * ordered by cover-density rank, then the earlier-created note, then the lower id.
 *
 * Nobody ever finds another person's unrevealed note. A participant searches revealed,
 * non-facilitator-only notes and their own unrevealed notes; the facilitator searches
 * revealed notes, including facilitator-only ones, and their own.
 */
export async function searchNotes(
  workshopId: string,
  query: string,
  viewer: Viewer,
): Promise<SearchResult[]> {
  const visibility =
    viewer.role === 'facilitator'
      ? `(n.revealed = true OR n.author_kind = 'facilitator')`
      : `((n.revealed = true AND n.facilitator_only = false) OR n.author_participant_id = $3)`;

  const parameters: Array<string | null> = [workshopId, query];
  if (viewer.role === 'participant') parameters.push(viewer.participantId);

  const result = await pool.query<{ id: string; frame_id: string; text: string }>(
    `SELECT n.id, n.frame_id, n.text
       FROM notes n
       JOIN frames f ON f.id = n.frame_id
      WHERE n.workshop_id = $1
        AND n.kind = 'text'
        AND n.text IS NOT NULL
        AND f.trashed_at IS NULL
        AND f.purged_at IS NULL
        AND ${visibility}
        AND to_tsvector('simple', n.text) @@ websearch_to_tsquery('simple', $2)
      ORDER BY ts_rank_cd(to_tsvector('simple', n.text), websearch_to_tsquery('simple', $2)) DESC,
               n.created_seq ASC,
               n.id ASC
      LIMIT ${RESULT_LIMIT}`,
    parameters,
  );
  return result.rows.map((row) => ({ noteId: row.id, frameId: row.frame_id, text: row.text }));
}
