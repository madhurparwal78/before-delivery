import type { EditionEntry, EditionsResponse, GalleryResponse, PieceCard } from '../../shared/api.js';
import { query } from '../db/pool.js';
import { editionSeedHash } from '../domain/editions.js';
import {
  COLLECTED_SQL,
  LIVE_HOLD_SQL,
  toPieceCard,
  type PieceRow,
} from './pieceRows.js';

const CARD_SELECT = `
  SELECT p.id, p.slug, p.title, p.creator_id, p.state, p.version, p.fragment_source,
         p.uniforms, p.timeline, p.remix_of_id, p.edition_count, p.price_cents,
         p.export_render_id, p.featured, p.published_at,
         creator.display_name AS creator_display_name,
         creator.seller_address AS creator_seller_address,
         source.slug AS remix_of_slug,
         source.title AS remix_of_title,
         source.creator_id AS remix_of_creator_id,
         source_creator.display_name AS remix_of_creator,
         (p.edition_count - (
           SELECT count(*) FROM edition_orders o
           WHERE o.piece_id = p.id AND (${LIVE_HOLD_SQL} OR ${COLLECTED_SQL})
         ))::int AS editions_left
  FROM pieces p
  JOIN app_users creator ON creator.id = p.creator_id
  LEFT JOIN pieces source ON source.id = p.remix_of_id
  LEFT JOIN app_users source_creator ON source_creator.id = source.creator_id
  WHERE p.state = 'published'
`;

async function publishedCards(
  isRemix: boolean,
  creatorUsername: string | null,
): Promise<PieceCard[]> {
  const result = await query<PieceRow>(
    `${CARD_SELECT}
       AND p.remix_of_id IS ${isRemix ? 'NOT NULL' : 'NULL'}
       AND ($1::text IS NULL OR creator.username = $1)
     ORDER BY p.published_at DESC, p.slug`,
    [creatorUsername],
  );
  return result.rows.map(toPieceCard);
}

/** The featured run is the featured piece while it is published, else the newest. */
async function featuredCard(creatorUsername: string | null): Promise<PieceCard | null> {
  const result = await query<PieceRow>(
    `${CARD_SELECT}
       AND ($1::text IS NULL OR creator.username = $1)
     ORDER BY p.featured DESC, p.published_at DESC
     LIMIT 1`,
    [creatorUsername],
  );
  const row = result.rows[0];
  return row ? toPieceCard(row) : null;
}

export async function buildGallery(creatorUsername: string | null): Promise<GalleryResponse> {
  const [featured, runs, remixes] = await Promise.all([
    featuredCard(creatorUsername),
    publishedCards(false, creatorUsername),
    publishedCards(true, creatorUsername),
  ]);

  return {
    featured,
    sections: [
      { id: 'runs', title: 'Fresh runs', total: runs.length, pieces: runs },
      { id: 'remixes', title: 'Remixes', total: remixes.length, pieces: remixes },
    ],
  };
}

interface ClaimRow {
  edition_number: number;
  collected: boolean;
  collector_id: string;
}

/** The only edition data public pages use. It names no collector. */
export async function buildEditions(
  piece: { id: string; slug: string; editionCount: number },
  viewerId: string | null,
): Promise<EditionsResponse> {
  const claims = await query<ClaimRow>(
    `SELECT o.edition_number, ${COLLECTED_SQL} AS collected, o.collector_id
     FROM edition_orders o
     WHERE o.piece_id = $1 AND (${LIVE_HOLD_SQL} OR ${COLLECTED_SQL})`,
    [piece.id],
  );

  const byNumber = new Map(claims.rows.map((row) => [row.edition_number, row]));
  const editions: EditionEntry[] = [];

  for (let number = 1; number <= piece.editionCount; number += 1) {
    const claim = byNumber.get(number);
    editions.push({
      number,
      status: claim ? (claim.collected ? 'collected' : 'held') : 'available',
      held_by_you:
        claim !== undefined && !claim.collected && viewerId !== null && claim.collector_id === viewerId,
      seed_hash: editionSeedHash(piece.slug, number),
    });
  }

  return { edition_count: piece.editionCount, editions };
}
