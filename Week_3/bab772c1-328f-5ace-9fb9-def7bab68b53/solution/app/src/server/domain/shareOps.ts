/** Creating, replacing and revoking a mission's share link. */

import { isoInstant } from "../../shared/doy.js";
import type { ShareLink } from "../../shared/model.js";
import { withTransaction, type Queryable } from "../db/pool.js";
import { ApiError } from "../errors.js";
import { recordMissionChange } from "./changes.js";
import { newId } from "./ids.js";
import { kickRelay } from "./outbox.js";
import { newShareToken, shareUrlPath } from "./share.js";
import type { MissionRow } from "./missionRead.js";

async function revokeActive(
  tx: Queryable,
  missionId: string,
  nowMs: number,
): Promise<boolean> {
  const active = await tx.query<{ id: string }>(
    `update share_links set revoked = true
     where mission_id = $1 and revoked = false and expires_ms > $2 returning id`,
    [missionId, nowMs],
  );
  if (active.rowCount === 0) {
    return false;
  }
  await recordMissionChange(tx, {
    missionId,
    kind: "share.revoked",
    data: {},
    bumpVersion: true,
    webhook: { eventType: "share.revoked", data: {} },
    atMs: nowMs,
  });
  return true;
}

export async function createShareLink(
  mission: MissionRow,
  expiresMs: number,
  nowMs: number,
): Promise<{ link: ShareLink; replaced: boolean }> {
  const result = await withTransaction(async (tx) => {
    await tx.query("select pg_advisory_xact_lock(hashtext($1))", [`share:${mission.id}`]);
    const replaced = await revokeActive(tx, mission.id, nowMs);
    const token = newShareToken();
    const createdMs = Math.floor(nowMs / 1000) * 1000;
    await tx.query(
      `insert into share_links (id, mission_id, token, created_ms, expires_ms)
       values ($1, $2, $3, $4, $5)`,
      [newId(), mission.id, token, createdMs, expiresMs],
    );
    await recordMissionChange(tx, {
      missionId: mission.id,
      kind: "share.created",
      data: { expires_utc: isoInstant(expiresMs) },
      bumpVersion: true,
      atMs: nowMs,
    });
    return {
      link: {
        token,
        url: shareUrlPath(token),
        created_at: isoInstant(createdMs),
        expires_utc: isoInstant(expiresMs),
      },
      replaced,
    };
  });
  kickRelay();
  return result;
}

export async function revokeShareLink(mission: MissionRow, nowMs: number): Promise<void> {
  await withTransaction(async (tx) => {
    await tx.query("select pg_advisory_xact_lock(hashtext($1))", [`share:${mission.id}`]);
    const revoked = await revokeActive(tx, mission.id, nowMs);
    if (!revoked) {
      throw new ApiError(404, "no_active_link");
    }
  });
  kickRelay();
}
