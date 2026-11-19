import { visibleBoardSql, visiblePinSql } from "./access.js";
import { coversOf } from "./boards.js";
import { pinCountSql, userFollowersSql, userFollowingSql } from "./counts.js";
import { exactlyOne, one, pool, rows } from "./db.js";
import { notFound } from "./errors.js";
import { selectPins } from "./pins.js";
import type { BoardCard, Pin, Profile, UserRef, Visibility } from "../shared/types.js";

const SORTS = {
  last_saved: "b.last_saved_at DESC NULLS LAST, b.id ASC",
  az: "lower(b.name) ASC, b.id ASC",
  newest: "b.created_at DESC, b.id ASC",
} as const;

type SortKey = keyof typeof SORTS;
const isSort = (value: string): value is SortKey => value in SORTS;

export async function profileOf(viewerId: number, handle: string, sortValue: string): Promise<Profile> {
  const user = await one<UserRef>(pool, "SELECT id, name, handle FROM users WHERE handle = $1", [handle]);
  if (!user) throw notFound();
  const sort = isSort(sortValue) ? sortValue : "last_saved";
  const boardRows = await rows<{ id: number; name: string; visibility: Visibility; cover_pin_id: number | null; pin_count: number }>(
    pool,
    `SELECT b.id, b.name, b.visibility, b.cover_pin_id,
            ${pinCountSql("b.id")} AS pin_count
       FROM boards b WHERE b.owner_id = $2 AND ${visibleBoardSql("b", "$1")} ORDER BY ${SORTS[sort]}`,
    [viewerId, user.id],
  );
  const covers = await coversOf(pool, boardRows);
  const boards = boardRows.map(
    (board): BoardCard => ({ id: board.id, name: board.name, visibility: board.visibility, pin_count: board.pin_count, cover: covers.get(board.id) ?? null }),
  );
  const counts = await exactlyOne<{ followers: number; following: number; pin_total: number; following_user: boolean }>(
    pool,
    `SELECT ${userFollowersSql("$2")} AS followers,
            ${userFollowingSql("$2")} AS following,
            (SELECT count(*)::int FROM pins p JOIN boards b ON b.id = p.board_id WHERE p.owner_id = $2 AND ${visiblePinSql("p", "b", "$1")}) AS pin_total,
            EXISTS (SELECT 1 FROM follows WHERE follower_id = $1 AND user_id = $2) AS following_user`,
    [viewerId, user.id],
  );
  return {
    user,
    followers: counts.followers,
    following: counts.following,
    pin_total: counts.pin_total,
    board_total: boards.length,
    boards,
    following_user: counts.following_user,
  };
}

export async function pinsOf(viewerId: number, handle: string): Promise<Pin[]> {
  const user = await one<{ id: number }>(pool, "SELECT id FROM users WHERE handle = $1", [handle]);
  if (!user) throw notFound();
  return selectPins(pool, viewerId, "p.owner_id = $2", [user.id]);
}
