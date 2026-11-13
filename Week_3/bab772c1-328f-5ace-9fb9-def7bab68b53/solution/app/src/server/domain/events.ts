/** Pinned events: snapped to a sample, with a public title and a private note. */

import { snapIndex } from "../../shared/frames.js";
import { PASS_LOCK, withAdvisoryLock } from "../db/locks.js";
import { validation } from "../errors.js";
import { formatMetLabel } from "../../shared/met.js";
import type { MissionEvent } from "../../shared/model.js";
import { withTransaction } from "../db/pool.js";
import { pool } from "../db/pool.js";
import { recordMissionChange } from "./changes.js";
import { newId } from "./ids.js";
import { keepRequestKey } from "./requestKeys.js";
import { eventDocument, indexOrPend, writePendingWrites } from "./searchWrites.js";
import { kickRelay } from "./outbox.js";
import { findPassRow, loadTrack, type MissionRow } from "./missionRead.js";

type SnappedSample = {
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
  const samples = await loadTrack(pool, missionId);
  if (samples.length === 0 || met < samples[0].met) return null;
  return samples[snapIndex(samples, met)];
}

export async function pinEvent(
  mission: MissionRow,
  requestKey: string,
  sample: SnappedSample,
  title: string,
  note: string | null,
  options: { seed?: boolean } = {},
): Promise<MissionEvent> {
  return withAdvisoryLock(PASS_LOCK, sample.pass_id, async () => {
    if ((await findPassRow(pool, sample.pass_id))?.state !== "parsed") {
      throw validation({ met: "No sample at or before this time." });
    }
    const seeded = options.seed === true;
    const eventId = newId();
    const pending = await indexOrPend(
      mission.id,
      sample.pass_id,
      [eventDocument(mission.id, sample.pass_id, { id: eventId, met: sample.met, title })],
      [{ op: "index_event", docId: `event-${eventId}`, refId: eventId }],
    );
    await withTransaction(async (tx) => {
      await tx.query("select id from missions where id = $1 for no key update", [mission.id]);
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
  });
}

