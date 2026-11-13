/** The one place a mission change raises its version, appends its audit entry and queues its webhook. */

import type { JsonValue } from "../../shared/canonical.js";
import { notifyMissionChange, type Queryable } from "../db/pool.js";
import { appendAuditEntry, type AuditKind } from "./audit.js";
import { newId } from "./ids.js";
import type { WebhookEventType } from "../services/webhooks.js";

export type WebhookSpec = {
  eventType: WebhookEventType;
  data: Record<string, JsonValue>;
};

export type MissionChange = {
  missionId: string;
  kind: AuditKind;
  data: JsonValue;
  bumpVersion: boolean;
  webhook?: WebhookSpec;
  atMs?: number;
};

export async function recordMissionChange(
  tx: Queryable,
  change: MissionChange,
): Promise<number> {
  const atMs = change.atMs ?? Date.now();
  let version: number;
  if (change.bumpVersion) {
    const bumped = await tx.query<{ change_version: number }>(
      "update missions set change_version = change_version + 1 where id = $1 returning change_version",
      [change.missionId],
    );
    version = bumped.rows[0].change_version;
  } else {
    const current = await tx.query<{ change_version: number }>(
      "select change_version from missions where id = $1",
      [change.missionId],
    );
    version = current.rows[0].change_version;
  }
  await appendAuditEntry(tx, change.missionId, change.kind, change.data, atMs);
  if (change.webhook) {
    const payload = {
      type: change.webhook.eventType,
      mission_id: change.missionId,
      version,
      occurred_at: Math.floor(atMs / 1000),
      data: change.webhook.data,
    };
    await tx.query(
      `insert into outbox (id, kind, event_id, payload) values ($1, 'webhook.send', $2, $3)`,
      [newId(), `${change.missionId}:${version}`, JSON.stringify(payload)],
    );
  }
  if (change.bumpVersion) {
    await notifyMissionChange(tx, change.missionId, version);
  }
  return version;
}
