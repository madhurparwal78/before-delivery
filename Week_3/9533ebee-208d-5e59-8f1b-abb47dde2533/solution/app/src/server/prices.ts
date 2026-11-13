import { randomUUID } from "node:crypto";
import { one, type Tx } from "./db.js";
import { isStale, isStaleAt, type Asset, type Market } from "./pools.js";
import { listPositions, positionFigures, positionsBelowOne, sync } from "./positions.js";
import { storeAll } from "./storage.js";
import { toInstant } from "./time.js";
import { plainPrice } from "../shared/format.js";

// Recording a posted price: the one place a manual post and an oracle reading both land. A price post stores its
// evidence object before it counts, re-evaluates every open position, and reopens a stale market with a recovery
// grace. If the evidence cannot be stored, the request fails and nothing is recorded.

interface Post {
  source: "manual" | "oracle";
  postedBy: string;
  /** A manual post's `posted_at` is the server's now; an oracle reading's is its publication instant. */
  postedAt: Date;
  oracleRound: number | null;
  /** What the evidence holds beside the price itself: the submitted fields, or the raw oracle response. */
  evidence: { submitted: Record<string, unknown> } | { oracle_response: string };
}

interface RecordedPrice {
  pricePostId: string;
  evidenceKey: string;
  previousPrice: bigint;
  positionsBelowOne: number;
  market: Market;
}

/** True when moving from `current` to `next` is a move of more than 60%: the boundary itself is allowed. */
export function isLargeMove(current: bigint, next: bigint): boolean {
  return (next > current ? next - current : current - next) * 10n > current * 6n;
}

export async function recordPrice(
  tx: Tx,
  now: Date,
  stored: string[],
  asset: Asset,
  price: bigint,
  post: Post,
): Promise<RecordedPrice> {
  const pricePostId = randomUUID();
  const seq = (await one<{ seq: string }>(tx, "SELECT nextval('price_post_seq')::text AS seq"))?.seq ?? "";
  const evidenceKey = `evidence/prices/${pricePostId}.json`;
  // A post that takes a stale market to open grants every position still below health factor 1 a recovery grace.
  const reopened = isStale(asset, now) && !isStaleAt(post.postedAt, now);
  await tx.query(
    `INSERT INTO price_posts (price_post_id, seq, asset, price, previous_price, posted_at, posted_by, source, oracle_round, positions_below_one, evidence_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, $10)`,
    [pricePostId, seq, asset.asset, price.toString(), asset.price.toString(), post.postedAt, post.postedBy, post.source, post.oracleRound, evidenceKey],
  );
  const market = await sync(tx, now, reopened ? asset.asset : undefined);
  const below = await positionsBelowOne(tx, market);
  await tx.query("UPDATE price_posts SET positions_below_one = $2 WHERE price_post_id = $1", [pricePostId, below]);
  const involved = (await listPositions(tx)).filter((p) => p.collateralAsset === asset.asset || p.debtAsset === asset.asset);
  const evidence = {
    price_post_id: pricePostId,
    asset: asset.asset,
    price: plainPrice(price),
    previous_price: plainPrice(asset.price),
    posted_at: toInstant(post.postedAt),
    posted_by: post.postedBy,
    source: post.source,
    positions_below_one: below,
    positions: involved.map((p) => {
      const figures = positionFigures(p, market);
      return { position_id: p.positionId, health_factor: figures.health_factor, liquidation_price: figures.liquidation_price };
    }),
    ...post.evidence,
  };
  await storeAll([{ key: evidenceKey, data: JSON.stringify(evidence, null, 2), contentType: "application/json" }]);
  stored.push(evidenceKey);
  return { pricePostId, evidenceKey, previousPrice: asset.price, positionsBelowOne: below, market };
}
