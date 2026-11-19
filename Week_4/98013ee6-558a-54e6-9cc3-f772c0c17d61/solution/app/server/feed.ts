import { FEED_MAX } from "./config.js";
import { rootSql } from "./counts.js";
import { rows, type Db } from "./db.js";
import { visibleBoardSql } from "./access.js";
import { selectPins } from "./pins.js";
import type { FeedPin } from "../shared/types.js";

/**
 * The home feed rule, in one place: live pins on boards the viewer may see that are the viewer's own,
 * on public boards of followed people, on followed public boards, or on boards the viewer is a member of.
 */
const FEED_MEMBERSHIP = `
  p.state = 'live' AND ${visibleBoardSql("b", "$1")} AND (
    p.owner_id = $1
    OR (b.visibility = 'public' AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.user_id = b.owner_id))
    OR (b.visibility = 'public' AND EXISTS (SELECT 1 FROM board_follows bf WHERE bf.follower_id = $1 AND bf.board_id = b.id))
    OR EXISTS (SELECT 1 FROM board_members m WHERE m.board_id = b.id AND m.user_id = $1))`;

export async function feedPinIds(db: Db, viewerId: number, among: number[]): Promise<number[]> {
  const found = await rows<{ id: number }>(
    db,
    `SELECT p.id FROM pins p JOIN boards b ON b.id = p.board_id WHERE p.id = ANY($2) AND ${FEED_MEMBERSHIP}`,
    [viewerId, among],
  );
  return found.map((row) => row.id);
}

export async function loadFeed(db: Db, viewerId: number): Promise<FeedPin[]> {
  const eligible = `SELECT p.id, ${rootSql("p")} AS root, p.owner_id, u.name AS owner_name, p.created_at
       FROM pins p JOIN boards b ON b.id = p.board_id JOIN users u ON u.id = p.owner_id WHERE ${FEED_MEMBERSHIP}`;
  const cards = await rows<{ id: number; root: number; size: number }>(
    db,
    `WITH eligible AS (${eligible}),
          ranked AS (SELECT id, root, created_at, row_number() OVER (PARTITION BY root ORDER BY created_at DESC, id ASC) AS place,
                            count(*) OVER (PARTITION BY root)::int AS size FROM eligible)
     SELECT id, root, size FROM ranked WHERE place = 1 ORDER BY created_at DESC, id ASC LIMIT ${FEED_MAX}`,
    [viewerId],
  );
  const owners = await rows<{ root: number; owner_name: string }>(
    db,
    `WITH eligible AS (${eligible})
     SELECT root, owner_name FROM eligible WHERE root = ANY($2)
      GROUP BY root, owner_id, owner_name ORDER BY root, max(created_at) DESC, min(id) ASC`,
    [viewerId, cards.map((card) => card.root)],
  );
  const pins = await selectPins(db, viewerId, "p.id = ANY($2)", [cards.map((card) => card.id)]);
  const byId = new Map(pins.map((pin) => [pin.id, pin]));
  return cards.flatMap((card) => {
    const pin = byId.get(card.id);
    return pin ? [{ ...pin, group: { size: card.size, owners: owners.filter((owner) => owner.root === card.root).map((owner) => owner.owner_name) } }] : [];
  });
}
