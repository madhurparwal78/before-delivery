/** Mission subscribers: one webhook endpoint each, at most three per mission. */

import { isoInstant } from "../../shared/doy.js";
import type { Subscriber } from "../../shared/model.js";
import { SUBSCRIBER_LOCK, withAdvisoryLock } from "../db/locks.js";
import { pool, withTransaction } from "../db/pool.js";
import { conflict, subscriberNotFound } from "../errors.js";
import { createEndpoint, deleteEndpoint } from "../services/webhooks.js";
import { recordMissionChange } from "./changes.js";
import type { MissionRow } from "./missionRead.js";

const SUBSCRIBER_LIMIT = 3;

export async function addSubscriber(mission: MissionRow, url: string): Promise<Subscriber> {
  return withAdvisoryLock(SUBSCRIBER_LOCK, mission.id, async () => {
    const held = await pool.query<{ count: number }>(
      "select count(*)::int as count from subscribers where mission_id = $1",
      [mission.id],
    );
    if (held.rows[0].count >= SUBSCRIBER_LIMIT) {
      throw conflict("subscriber_limit", { message: "A mission has at most 3 subscribers." });
    }
    const existing = await pool.query(
      "select id from subscribers where mission_id = $1 and url = $2",
      [mission.id, url],
    );
    if (existing.rowCount && existing.rowCount > 0) {
      throw conflict("subscriber_exists", { message: "This URL is already subscribed." });
    }
    const endpointId = await createEndpoint(mission.id, mission.name, url);
    const createdMs = Date.now();
    await withTransaction(async (tx) => {
      await tx.query(
        `insert into subscribers (id, mission_id, url, created_ms) values ($1, $2, $3, $4)
         on conflict (id) do nothing`,
        [endpointId, mission.id, url, createdMs],
      );
      await recordMissionChange(tx, {
        missionId: mission.id,
        kind: "subscriber.added",
        data: { subscriber_id: endpointId, url },
        bumpVersion: false,
        atMs: createdMs,
      });
    });
    return { id: endpointId, url, created_at: isoInstant(createdMs) };
  });
}

export async function removeSubscriber(
  mission: MissionRow,
  subscriberId: string,
): Promise<void> {
  await withAdvisoryLock(SUBSCRIBER_LOCK, mission.id, async () => {
    const existing = await pool.query(
      "select id from subscribers where id = $1 and mission_id = $2",
      [subscriberId, mission.id],
    );
    if (existing.rowCount !== 1) {
      throw subscriberNotFound();
    }
    await deleteEndpoint(mission.id, mission.name, subscriberId);
    await withTransaction(async (tx) => {
      const removed = await tx.query(
        "delete from subscribers where id = $1 and mission_id = $2 returning id",
        [subscriberId, mission.id],
      );
      if (removed.rowCount !== 1) {
        throw subscriberNotFound();
      }
      await recordMissionChange(tx, {
        missionId: mission.id,
        kind: "subscriber.removed",
        data: { subscriber_id: subscriberId },
        bumpVersion: false,
      });
    });
  });
}
