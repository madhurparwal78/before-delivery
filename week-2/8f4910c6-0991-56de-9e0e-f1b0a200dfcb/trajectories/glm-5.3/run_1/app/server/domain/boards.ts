import { query, one } from "../db.js";
import { errors } from "../http/errors.js";
import { BOARDS, OFFICES, BOARD_TITLES, type Board } from "../../shared/domain.js";

/** Public board listing and profiles: only the published public fields. */

export interface TalentCardRow {
  id: string;
  slug: string;
  display_name: string;
  office: string;
  board: string;
  height_cm: number | null;
  chest_cm: number | null;
  waist_cm: number | null;
  hips_cm: number | null;
  instagram: number;
  tiktok: number;
  youtube: number;
  cover_photo_id: string | null;
}

const CARD_COLUMNS = `t.id, t.slug, t.display_name, t.office, t.board, t.height_cm, t.chest_cm, t.waist_cm, t.hips_cm, t.instagram, t.tiktok, t.youtube,
  (SELECT p.id FROM photos p WHERE p.talent_id = t.id ORDER BY p.position LIMIT 1) AS cover_photo_id`;

export interface TalentCard {
  slug: string;
  displayName: string;
  office: string;
  board: string;
  measurements: { heightCm: number | null; chestCm: number | null; waistCm: number | null; hipsCm: number | null };
  reach: { instagram: number; tiktok: number; youtube: number; total: number };
  coverPhotoUrl: string | null;
}

export function cardView(row: TalentCardRow): TalentCard {
  return {
    slug: row.slug,
    displayName: row.display_name,
    office: row.office,
    board: row.board,
    measurements: { heightCm: row.height_cm, chestCm: row.chest_cm, waistCm: row.waist_cm, hipsCm: row.hips_cm },
    reach: { instagram: row.instagram, tiktok: row.tiktok, youtube: row.youtube, total: row.instagram + row.tiktok + row.youtube },
    coverPhotoUrl: row.cover_photo_id ? `/api/photos/${row.cover_photo_id}` : null,
  };
}

export interface BoardIndex {
  boards: Array<{ board: string; title: string; count: number; coverPhotoUrl: string | null }>;
}

export async function boardIndex(): Promise<BoardIndex> {
  const rows = await query<{ board: string; count: string }>(
    `SELECT t.board, COUNT(*)::text AS count FROM talent t WHERE t.state = 'active' GROUP BY t.board`
  );
  const coverRows = await query<{ board: string; cover_photo_id: string | null }>(
    `SELECT DISTINCT ON (t.board) t.board, (SELECT p.id FROM photos p WHERE p.talent_id = t.id ORDER BY p.position LIMIT 1) AS cover_photo_id
     FROM talent t WHERE t.state = 'active' ORDER BY t.board, lower(t.display_name)`
  );
  const covers = new Map(coverRows.map((r) => [r.board, r.cover_photo_id]));
  const byBoard = new Map(rows.map((r) => [r.board, r]));
  return {
    boards: BOARDS.map((board) => {
      const row = byBoard.get(board);
      const cover = covers.get(board);
      return {
        board,
        title: BOARD_TITLES[board],
        count: row ? Number(row.count) : 0,
        coverPhotoUrl: cover ? `/api/photos/${cover}` : null,
      };
    }),
  };
}

export type BoardSort = "name" | "height" | "reach";

export interface BoardQuery {
  board: Board;
  office: string;
  q: string;
  sort: BoardSort;
  page: number;
}

export async function boardTalent(input: BoardQuery): Promise<{ page: number; pageSize: number; total: number; totalPages: number; talent: TalentCard[] }> {
  if (!(BOARDS as readonly string[]).includes(input.board)) throw errors.validation({ board: "Choose a board." });
  if (input.office !== "all" && !(OFFICES as readonly string[]).includes(input.office)) throw errors.validation({ office: "Choose an office." });
  if (!["name", "height", "reach"].includes(input.sort)) throw errors.validation({ sort: "Choose a sort." });
  const params: unknown[] = [input.board];
  let where = `t.state = 'active' AND t.board = $1`;
  if (input.office !== "all") {
    params.push(input.office);
    where += ` AND t.office = $${params.length}`;
  }
  if (input.q) {
    params.push(`%${input.q.toLowerCase()}%`);
    where += ` AND lower(t.display_name) LIKE $${params.length}`;
  }
  const order = input.sort === "height" ? `t.height_cm DESC NULLS LAST, lower(t.display_name) ASC` : input.sort === "reach" ? `(t.instagram + t.tiktok + t.youtube) DESC, lower(t.display_name) ASC` : `lower(t.display_name) ASC`;
  const totalRow = await one<{ total: number }>(`SELECT COUNT(*)::int AS total FROM talent t WHERE ${where}`, params);
  const total = totalRow?.total || 0;
  const pageSize = 6;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, input.page), totalPages);
  params.push(pageSize, (page - 1) * pageSize);
  const rows = await query<TalentCardRow>(
    `SELECT ${CARD_COLUMNS} FROM talent t WHERE ${where} ORDER BY ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return { page, pageSize, total, totalPages, talent: rows.map(cardView) };
}

export interface PublicProfile extends TalentCard {
  portfolio: Array<{ photoId: string; url: string; width: number; height: number }>;
}

export async function publicProfile(slug: string): Promise<PublicProfile> {
  const row = await one<TalentCardRow & { state: string }>(`SELECT ${CARD_COLUMNS}, t.state FROM talent t WHERE lower(t.slug) = lower($1)`, [slug]);
  if (!row || row.state !== "active") {
    if (row) throw errors.gone("gone");
    throw errors.notFound();
  }
  const photos = await query<{ id: string; width: number; height: number }>(`SELECT id, width, height FROM photos WHERE talent_id = $1 ORDER BY position`, [row.id]);
  return {
    ...cardView(row),
    portfolio: photos.map((p) => ({ photoId: p.id, url: `/api/photos/${p.id}`, width: p.width, height: p.height })),
  };
}

export async function photoTalent(photoId: string): Promise<{ talentId: string; state: string } | null> {
  return one<{ talentId: string; state: string }>(
    `SELECT t.id AS "talentId", t.state FROM photos p JOIN talent t ON t.id = p.talent_id WHERE p.id = $1`,
    [photoId]
  );
}
