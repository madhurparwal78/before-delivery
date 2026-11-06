import { pool, withTransaction } from './db.js';
import { decideLinkState } from './domain/linkState.js';
import { isMissionActive } from './domain/transitions.js';
import { recordEvent } from './events.js';
import { latestFix, listMissions, listVessels } from './repo.js';
import { infillCandidates, loadMissionState } from './state.js';
import { midpoint, nearestEligible } from './domain/infill.js';
import { SYSTEM_ACTOR } from './domain/transitions.js';

/**
 * When a vessel becomes Lost, each of its Assigned infill lines moves to the
 * nearest eligible vessel and joins the end of that vessel's queue. Mainscheme
 * lines and crosslines never move.
 */
export async function moveInfillOffLostVessels(now: Date): Promise<void> {
  const missions = (await listMissions(pool, null)).filter((mission) =>
    isMissionActive(mission.status),
  );
  if (missions.length === 0) return;
  const vessels = await listVessels(pool);
  const lost = new Set<string>();
  for (const vessel of vessels) {
    const fix = await latestFix(pool, vessel.id);
    if (decideLinkState(fix ? fix.received_at : null, now) === 'Lost') lost.add(vessel.id);
  }
  if (lost.size === 0) return;

  for (const mission of missions) {
    const state = await loadMissionState(pool, mission.id, now);
    if (!state) continue;
    const stranded = state.lines.filter(
      (line) =>
        line.kind === 'infill' &&
        line.status === 'Assigned' &&
        line.vessel_id !== null &&
        lost.has(line.vessel_id),
    );
    if (stranded.length === 0) continue;
    const candidates = infillCandidates(state);
    for (const line of stranded) {
      const target = nearestEligible(
        candidates,
        midpoint(
          { easting: line.start_e, northing: line.start_n },
          { easting: line.end_e, northing: line.end_n },
        ),
      );
      if (!target || target.id === line.vessel_id) continue;
      await withTransaction(async (client) => {
        const order = await client.query<{ next: number }>(
          `SELECT COALESCE(max(infill_order), 0) + 1 AS next FROM lines
           WHERE mission_id = $1 AND vessel_id = $2 AND kind = 'infill' AND status = 'Assigned'`,
          [mission.id, target.id],
        );
        const moved = await client.query(
          `UPDATE lines SET vessel_id = $2, infill_order = $3
           WHERE id = $1 AND status = 'Assigned' AND vessel_id = $4`,
          [line.id, target.id, order.rows[0]!.next, line.vessel_id],
        );
        if (moved.rowCount === 0) return;
        await recordEvent(
          client,
          mission.id,
          'infill',
          SYSTEM_ACTOR,
          `${line.label} moved to ${target.name}`,
          now,
        );
      });
    }
  }
}
