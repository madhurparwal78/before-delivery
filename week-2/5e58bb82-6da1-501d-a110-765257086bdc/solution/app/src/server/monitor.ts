// Link-state monitor: every second, re-decides each vessel's link state and raises link-lost alerts.
import type { Db } from "./db.js";
import { one, pool, tx } from "./db.js";
import { raiseAlert } from "./alerts.js";
import { ACTIVE } from "./fleet.js";
import { moveInfillOffLost } from "./missions.js";
import type { MissionRecord, PlacedVessel } from "./records.js";
import { linkState, loadVessel, loadVessels } from "./vessels.js";

/**
 * A lost spell is identified by the receipt time of the last fix before it. An afloat vessel on an active,
 * unheld mission that has sent a fix since launch raises one link-lost alert per spell, also after a resume.
 * Returns the mission the alert is due on, or null.
 */
function alertDue(v: PlacedVessel, mission: MissionRecord | null): MissionRecord | null {
  if (linkState(v.last_fix_received_at) !== "Lost" || !mission || !v.afloat) return null;
  if (!ACTIVE.includes(mission.status) || mission.hold_reason !== null) return null;
  const spell = v.last_fix_received_at;
  if (!spell || !mission.launched_at || spell < mission.launched_at) return null;
  return !v.lost_spell_alerted || v.lost_spell_alerted.getTime() !== spell.getTime() ? mission : null;
}

const missionOf = (db: Db, v: PlacedVessel, lock: boolean) =>
  v.mission_id ? one<MissionRecord>(db, `SELECT * FROM missions WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [v.mission_id]) : Promise.resolve(null);

async function checkVessel(seen: PlacedVessel): Promise<void> {
  const changed = linkState(seen.last_fix_received_at) !== seen.link_observed;
  if (!changed && !alertDue(seen, await missionOf(pool, seen, false))) return;
  await tx(async (db) => {
    const mission = await missionOf(db, seen, true);
    const v = await loadVessel(db, seen.id, true);
    const state = linkState(v.last_fix_received_at);
    if (state !== v.link_observed) {
      await db.query("UPDATE vessels SET link_observed = $2 WHERE id = $1", [v.id, state]);
      if (state === "Lost") await moveInfillOffLost(db, v.id);
    }
    const due = alertDue(v, mission);
    if (!due) return;
    await db.query("UPDATE vessels SET lost_spell_alerted = $2 WHERE id = $1", [v.id, v.last_fix_received_at]);
    await raiseAlert(db, "link_lost", v, due.id, v.last_fix_t ? { easting: v.last_easting, northing: v.last_northing } : null);
  });
}

export function startLinkMonitor(): void {
  let busy = false;
  setInterval(() => {
    if (busy) return;
    busy = true;
    loadVessels(pool)
      .then(async (vessels) => {
        for (const v of vessels) await checkVessel(v);
      })
      .catch((error) => console.error("link monitor:", error instanceof Error ? error.message : "failed"))
      .finally(() => {
        busy = false;
      });
  }, 1000);
}
