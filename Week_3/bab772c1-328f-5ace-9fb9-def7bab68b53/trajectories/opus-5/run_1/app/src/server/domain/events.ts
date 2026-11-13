/** Pinned events: snapped to a sample, with a public title and a private note. */

import { formatMetLabel } from "../../shared/met.js";
import type { MissionEvent } from "../../shared/model.js";
import { withTransaction } from "../db/pool.js";
import { pool } from "../db/pool.js";
import { recordMissionChange } from "./changes.js";
import { newId } from "./ids.js";
import { keepRequestKey } from "./requestKeys.js";
import { eventDocument, indexOrPend, writePendingWrites } from "./searchWrites.js";
import { kickRelay } from "./outbox.js";
import type { MissionRow } from "./missionRead.js";

export type SnappedSample = {
  pass_id: string;
  met: number;
  lat_deg: number;
  lon_deg: number;
  altitude_m: number;
  speed_m_s: number;
  residual_m: number | null;
};

/** The sample at or before `met`, or null when the track starts later. */
export async function snapSample(
  missionId: string,
  met: number,
): Promise<SnappedSample | null> {
  const result = await pool.query<SnappedSample>(
    `select pass_id, met, lat_deg, lon_deg, altitude_m, speed_m_s, residual_m
     from samples where mission_id = $1 and met <= $2
     order by met desc, upload_seq desc, line_no desc limit 1`,
    [missionId, met],
  );
  return result.rows[0] ?? null;
}

export async function pinEvent(
  mission: MissionRow,
  requestKey: string,
  sample: SnappedSample,
  title: string,
  note: string | null,
  options: { seed?: boolean } = {},
): Promise<MissionEvent> {
  const seeded = options.seed === true;
  const eventId = newId();
  const pending = await indexOrPend(
    mission.id,
    sample.pass_id,
    [eventDocument(mission.id, sample.pass_id, { id: eventId, met: sample.met, title })],
    [{ op: "index_event", docId: `event-${eventId}`, refId: eventId }],
  );
  await withTransaction(async (tx) => {
    await tx.query(
      `insert into events (id, mission_id, pass_id, met, title, note, created_ms)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [eventId, mission.id, sample.pass_id, sample.met, title, note, Date.now()],
    );
    await writePendingWrites(tx, pending);
    await recordMissionChange(tx, {
      missionId: mission.id,
      kind: "event.pinned",
      data: {
        event_id: eventId,
        pass_id: sample.pass_id,
        met: sample.met,
        title,
      },
      bumpVersion: !seeded,
      ...(seeded
        ? {}
        : {
            webhook: {
              eventType: "event.pinned" as const,
              data: {
                event: {
                  id: eventId,
                  pass_id: sample.pass_id,
                  met: sample.met,
                  met_label: formatMetLabel(sample.met),
                  title,
                },
              },
            },
          }),
    });
    await keepRequestKey(tx, mission.id, "pin", requestKey, 201, { eventId });
  });
  kickRelay();
  return {
    id: eventId,
    pass_id: sample.pass_id,
    met: sample.met,
    met_label: formatMetLabel(sample.met),
    title,
    note,
    sample: {
      lat_deg: sample.lat_deg,
      lon_deg: sample.lon_deg,
      altitude_m: sample.altitude_m,
      speed_m_s: sample.speed_m_s,
      residual_m: sample.residual_m,
    },
  };
}

export async function findEvent(
  missionId: string,
  eventId: string,
): Promise<MissionEvent | null> {
  const result = await pool.query<{
    id: string;
    pass_id: string;
    met: number;
    title: string;
    note: string | null;
  }>("select id, pass_id, met, title, note from events where id = $1 and mission_id = $2", [
    eventId,
    missionId,
  ]);
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  const sample = await snapSample(missionId, row.met);
  return {
    id: row.id,
    pass_id: row.pass_id,
    met: row.met,
    met_label: formatMetLabel(row.met),
    title: row.title,
    note: row.note,
    sample: {
      lat_deg: sample?.lat_deg ?? 0,
      lon_deg: sample?.lon_deg ?? 0,
      altitude_m: sample?.altitude_m ?? 0,
      speed_m_s: sample?.speed_m_s ?? 0,
      residual_m: sample?.residual_m ?? null,
    },
  };
}
