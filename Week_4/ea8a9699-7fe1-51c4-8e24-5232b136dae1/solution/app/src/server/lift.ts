// The lift (brief: Business rules > Lift, Digest). The one place an embargoed cluster becomes public:
// every request runs it with its own instant before reading or writing, and a ticker runs it each second,
// so the status is right on every instance whether or not the ticker ran. The same statement creates one
// digest per follower of the owner, counted at the lift.
import type { Db } from "./db.js";

export async function applyDueLifts(db: Db, now: Date): Promise<void> {
  await db.query(
    `WITH lifted AS (
       UPDATE clusters
          SET status = 'public', published_at = lifts_at, changed_at = lifts_at
        WHERE status = 'embargoed' AND lifts_at <= $1
       RETURNING id, owner_id, lifts_at
     )
     INSERT INTO digests (cluster_id, follower_id, lifts_at)
     SELECT lifted.id, follows.follower_id, lifted.lifts_at
       FROM lifted JOIN follows ON follows.curator_id = lifted.owner_id
     ON CONFLICT DO NOTHING`,
    [now],
  );
}
