import { CATEGORIES, PRICE_BANDS, SIZES } from "../../shared/catalog";
import { reply, type Context, type Reply } from "../pipeline";
import { pool } from "../db";
import { notFound, pieceGone } from "../errors";
import { loadPiece, loadPieces, onRailToday, pieceRowExists, publicPieceView, railPieceView, type PieceRecord } from "../pieces";
import { priceAt, soldPageEnds } from "../rules/piece";
import { FieldProblems } from "../validate";

const BAND_LIMITS: Record<string, [number, number]> = {
  "under-50": [0, 4_999],
  "50-100": [5_000, 9_999],
  "100-200": [10_000, 19_999],
  "200-plus": [20_000, Number.MAX_SAFE_INTEGER],
};

const compact = (text: string): string => text.replaceAll("-", "").toLowerCase();

function matchesSearch(piece: PieceRecord, q: string): boolean {
  const needle = q.toLowerCase();
  return piece.description.toLowerCase().includes(needle) || piece.brand.toLowerCase().includes(needle) || compact(piece.tagCode).includes(compact(q));
}

export async function listRail({ query, now }: Context): Promise<Reply> {
  const category = query.get("category") ?? "";
  const size = query.get("size") ?? "";
  const brand = query.get("brand") ?? "";
  const price = query.get("price") ?? "";
  const q = query.get("q") ?? "";
  const problems = new FieldProblems();
  if (category && !CATEGORIES.some((option) => option.value === category)) problems.add("category", "Choose a published category.");
  if (size && !SIZES.some((option) => option.value === size)) problems.add("size", "Choose a published size.");
  if (price && !PRICE_BANDS.some((option) => option.value === price)) problems.add("price", "Choose a published price band.");
  problems.check();
  const band = BAND_LIMITS[price];
  const pieces = (await loadPieces(pool, now, "p.archived_at IS NULL"))
    .filter((piece) => onRailToday(piece, now))
    .filter((piece) => !category || piece.category === category)
    .filter((piece) => !size || piece.size === size)
    .filter((piece) => !brand || piece.brand === brand)
    .filter((piece) => !band || (priceAt(piece, now) >= band[0] && priceAt(piece, now) <= band[1]))
    .filter((piece) => !q || matchesSearch(piece, q))
    .sort((a, b) => (a.intakeDate === b.intakeDate ? a.tagNumber - b.tagNumber : a.intakeDate < b.intakeDate ? 1 : -1));
  return reply(200, { pieces: pieces.map((piece) => railPieceView(piece, now)) });
}

export const shownToPublic = (piece: PieceRecord): boolean => piece.status === "on_rail" || piece.status === "on_hold" || piece.status === "sold";

export async function publicPieceExists({ params, now }: Context): Promise<void> {
  if (!(await pieceRowExists(pool, params.id))) throw notFound();
  const piece = await loadPiece(pool, now, params.id);
  if (!shownToPublic(piece)) throw notFound();
  if (piece.liveSale && now >= soldPageEnds(piece.liveSale.soldAt)) throw pieceGone();
}

export async function publicPiece({ params, now }: Context): Promise<Reply> {
  return reply(200, { piece: publicPieceView(await loadPiece(pool, now, params.id), now) });
}
