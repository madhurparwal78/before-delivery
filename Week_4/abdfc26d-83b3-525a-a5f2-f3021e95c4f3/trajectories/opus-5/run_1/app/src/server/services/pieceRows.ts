import type { Piece, PieceCard, PieceTimeline, PieceUniform, RemixCredit } from '../../shared/api.js';
import { query, type Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import type { PieceState } from '../domain/states.js';

/**
 * Orders that hold a number right now: `paying`, or `held` and still in time.
 * Both predicates expect the orders table aliased as `o`.
 */
export const LIVE_HOLD_SQL = `(o.state = 'paying' OR (o.state = 'held' AND o.expires_at > now()))`;
/** Orders that have collected a number, including partially refunded ones. */
export const COLLECTED_SQL = `(o.state IN ('paid', 'invoiced', 'receipted'))`;

export interface PieceRow {
  id: string;
  slug: string;
  title: string;
  creator_id: string;
  creator_display_name: string;
  creator_seller_address: string | null;
  state: PieceState;
  version: number;
  fragment_source: string;
  uniforms: PieceUniform[];
  timeline: PieceTimeline;
  remix_of_id: string | null;
  remix_of_slug: string | null;
  remix_of_title: string | null;
  remix_of_creator: string | null;
  remix_of_creator_id: string | null;
  edition_count: number | null;
  price_cents: number | null;
  export_render_id: string | null;
  featured: boolean;
  published_at: Date | null;
  editions_left: number;
}

const PIECE_SELECT = `
  SELECT p.id, p.slug, p.title, p.creator_id, p.state, p.version, p.fragment_source,
         p.uniforms, p.timeline, p.remix_of_id, p.edition_count, p.price_cents,
         p.export_render_id, p.featured, p.published_at,
         creator.display_name AS creator_display_name,
         creator.seller_address AS creator_seller_address,
         source.slug AS remix_of_slug,
         source.title AS remix_of_title,
         source.creator_id AS remix_of_creator_id,
         source_creator.display_name AS remix_of_creator,
         CASE WHEN p.edition_count IS NULL THEN 0 ELSE p.edition_count - (
           SELECT count(*) FROM edition_orders o
           WHERE o.piece_id = p.id AND (${LIVE_HOLD_SQL} OR ${COLLECTED_SQL})
         ) END::int AS editions_left
  FROM pieces p
  JOIN app_users creator ON creator.id = p.creator_id
  LEFT JOIN pieces source ON source.id = p.remix_of_id
  LEFT JOIN app_users source_creator ON source_creator.id = source.creator_id
`;

export async function loadPieceBySlug(slug: string): Promise<PieceRow | null> {
  const result = await query<PieceRow>(`${PIECE_SELECT} WHERE p.slug = $1`, [slug]);
  return result.rows[0] ?? null;
}

export async function loadPieceBySlugFor(
  client: Queryable,
  slug: string,
  forUpdate: boolean,
): Promise<PieceRow | null> {
  const result = await client.query<PieceRow>(
    `${PIECE_SELECT} WHERE p.slug = $1${forUpdate ? ' FOR UPDATE OF p' : ''}`,
    [slug],
  );
  return result.rows[0] ?? null;
}

export function remixCredit(row: PieceRow): RemixCredit | null {
  if (!row.remix_of_slug || !row.remix_of_title || !row.remix_of_creator) return null;
  return {
    slug: row.remix_of_slug,
    title: row.remix_of_title,
    creator_display_name: row.remix_of_creator,
  };
}

/** Public card body. It carries no collector data of any kind. */
export function toPieceCard(row: PieceRow): PieceCard {
  return {
    slug: row.slug,
    title: row.title,
    creator_display_name: row.creator_display_name,
    engine: 'GLSL',
    edition_count: row.edition_count ?? 0,
    editions_left: row.editions_left,
    price_cents: row.price_cents ?? 0,
    remix_of: remixCredit(row),
    published_at: (row.published_at ?? new Date(0)).toISOString(),
  };
}

/** `fragment_source` and `assets` appear only to the owner. */
export async function toPiece(row: PieceRow, viewerId: string | null): Promise<Piece> {
  const isOwner = viewerId !== null && viewerId === row.creator_id;
  const piece: Piece = {
    slug: row.slug,
    title: row.title,
    state: row.state,
    version: row.version,
    engine: 'GLSL',
    creator: { id: row.creator_id, display_name: row.creator_display_name },
    uniforms: row.uniforms,
    timeline: row.timeline,
    remix_of: remixCredit(row),
    edition_count: row.edition_count,
    price_cents: row.price_cents,
    editions_left: row.edition_count === null ? null : row.editions_left,
    export_render_id: row.export_render_id,
  };

  if (!isOwner) return piece;

  const assets = await query<{ id: string; kind: 'font' | 'model' | 'audio'; filename: string; bytes: number }>(
    'SELECT id, kind, filename, bytes FROM piece_assets WHERE piece_id = $1 ORDER BY created_at',
    [row.id],
  );
  return { ...piece, fragment_source: row.fragment_source, assets: assets.rows };
}

/**
 * Drafts are visible to their owner only and withdrawn pieces to their owner and
 * the founder-operator; anyone else gets the same 404 as for a missing piece.
 */
export function requireVisible(
  row: PieceRow | null,
  viewer: { id: string; isFounder: boolean } | null,
): PieceRow {
  if (!row) throw ApiError.notFound();
  if (row.state === 'published') return row;
  if (viewer && viewer.id === row.creator_id) return row;
  if (row.state === 'withdrawn' && viewer?.isFounder) return row;
  throw ApiError.notFound();
}

export function requireOwnedPiece(row: PieceRow | null, viewerId: string): PieceRow {
  if (!row || row.creator_id !== viewerId) throw ApiError.notFound();
  return row;
}
