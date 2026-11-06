import type { Tx } from "./db.js";
import { randomId } from "./config.js";
import { RESIDENTS } from "../shared/seed.js";
import { arcM, bearingDeg } from "../shared/geometry.js";
import { isoFromPgDate } from "./time.js";

// The rush board: posting, slot numbering, the one-winner claim rule, hold lapses and
// the rush count, all decided per request by the server clock.

export type MissionRow = {
  mission_id: string;
  title: string;
  resident_id: string;
  reward_stamps: number;
  kind: "standard" | "rush";
  rush_slots: number | null;
  status: "draft" | "scheduled" | "live" | "retired";
  version: number;
  revision: number;
  live_at: Date | null;
};

export type MissionVersionRow = {
  mission_id: string;
  version: number;
  title: string;
  resident_id: string;
  reward_stamps: number;
  offer: string[];
  thanks: string[];
};

/** Mission status as of the server clock: a scheduled mission whose time has come is live. */
export function effectiveStatus(m: MissionRow, now = Date.now()): MissionRow["status"] {
  if (m.status === "scheduled" && m.live_at && m.live_at.getTime() <= now) return "live";
  return m.status;
}

/** Builds a Parcel serialization from an acceptance row plus its bound mission version. */
export function parcelFromRow(row: {
  acceptance_id: string; mission_id: string; version: number; rush_id: string | null;
  hold_expires_at: Date | null; route_id: string; total_arc_m: number; initial_bearing_deg: number;
}, versionRow: MissionVersionRow): Record<string, unknown> {
  const resident = RESIDENTS.find((r) => r.resident_id === versionRow.resident_id)!;
  return {
    acceptance_id: row.acceptance_id,
    mission_id: row.mission_id,
    version: row.version,
    title: versionRow.title,
    reward_stamps: versionRow.reward_stamps,
    resident: { resident_id: resident.resident_id, name: resident.name, home: resident.home },
    rush_id: row.rush_id,
    hold_expires_at: row.hold_expires_at ? isoFromPgDate(row.hold_expires_at) : null,
    status: "open",
    route: {
      route_id: row.route_id,
      door: resident.door,
      total_arc_m: round1(row.total_arc_m),
      initial_bearing_deg: row.initial_bearing_deg,
    },
    dialogue: { offer: versionRow.offer },
  };
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Route facts measured from an accept or claim position to the resident's door. */
export function routeFacts(position: { lat: number; lon: number }, residentId: string): {
  route_id: string;
  door: { lat: number; lon: number };
  total_arc_m: number;
  initial_bearing_deg: number;
} {
  const resident = RESIDENTS.find((r) => r.resident_id === residentId)!;
  const total = arcM(position, resident.door);
  const bearing = Math.round(bearingDeg(position, resident.door)) % 360;
  return { route_id: randomId("rt_"), door: resident.door, total_arc_m: total, initial_bearing_deg: bearing };
}

export type RushRowOut = {
  rush_id: string;
  mission_id: string;
  slot: number;
  slots: number;
  title: string;
  resident_id: string;
  reward_stamps: number;
  version: number;
  status: "posted" | "taken" | "yours" | "delivered";
  hold_expires_at: string | null;
};

/**
 * Today's board read for a courier: posts the day's parcels exactly once, then returns
 * each rush parcel with its status from the caller's point of view and the rush count.
 */
export async function readDepot(
  tx: Tx,
  courierId: string,
  boardDay: string,
  now = Date.now(),
): Promise<{ rush: RushRowOut[]; rushLeft: number; missions: Array<Record<string, unknown>> }> {
  const { rows: allMissions } = await tx.query<MissionRow>(`SELECT * FROM missions`);
  const liveNow = (m: MissionRow) => effectiveStatus(m, now) === "live";

  // First read of a board date posts slots for every live rush mission, exactly once.
  await tx.query(`INSERT INTO board_days (board_date) VALUES ($1) ON CONFLICT DO NOTHING`, [boardDay]);
  for (const m of allMissions) {
    if (m.kind !== "rush" || !liveNow(m)) continue;
    const { rows: existing } = await tx.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM rush_parcels WHERE mission_id = $1 AND board_date = $2`,
      [m.mission_id, boardDay],
    );
    if (Number(existing[0].count) === 0) {
      for (let slot = 1; slot <= (m.rush_slots ?? 1); slot++) {
        await tx.query(
          `INSERT INTO rush_parcels (rush_id, mission_id, board_date, slot, slots, status)
           VALUES ($1,$2,$3,$4,$5,'posted')`,
          [randomId("rp_"), m.mission_id, boardDay, slot, m.rush_slots ?? 1],
        );
      }
    }
  }

  const { rows: parcels } = await tx.query<{
    rush_id: string; mission_id: string; slot: number; slots: number; status: string;
    claimed_by: string | null; claim_hold_expires_at: Date | null; claim_version: number | null;
  }>(
    `SELECT p.rush_id, p.mission_id, p.slot, p.slots, p.status, p.claimed_by,
            a.hold_expires_at AS claim_hold_expires_at, a.version AS claim_version
     FROM rush_parcels p
     LEFT JOIN acceptances a ON a.rush_id = p.rush_id AND a.status IN ('open','delivered')
     WHERE p.board_date = $1
     ORDER BY p.mission_id ASC, p.slot ASC`,
    [boardDay],
  );

  const myOpen = await tx.query<{ rush_id: string; hold_expires_at: Date }>(
    `SELECT rush_id, hold_expires_at FROM acceptances WHERE courier_id = $1 AND status = 'open' AND rush_id IS NOT NULL`,
    [courierId],
  );
  const myOpenByRush = new Map(myOpen.rows.map((r) => [r.rush_id, r.hold_expires_at]));

  const rush: RushRowOut[] = [];
  let rushLeft = 0;
  for (const p of parcels) {
    const mission = allMissions.find((m) => m.mission_id === p.mission_id);
    const missionLive = mission !== undefined && liveNow(mission);
    const lapsed = p.status === "claimed" && p.claim_hold_expires_at !== null && p.claim_hold_expires_at.getTime() <= now;

    // A posted or lapsed row of a retired mission is gone from the board.
    if (!missionLive && (p.status === "posted" || lapsed || p.status === "gone")) continue;

    let status: RushRowOut["status"];
    let holdExpires: string | null = null;
    if (p.status === "delivered") {
      status = p.claimed_by === courierId ? "delivered" : "taken";
    } else if (p.status === "posted" || lapsed) {
      status = "posted";
      if (missionLive) rushLeft += 1;
    } else if (p.claimed_by === courierId) {
      status = "yours";
      const hold = myOpenByRush.get(p.rush_id);
      holdExpires = hold ? isoFromPgDate(hold) : null;
    } else {
      status = "taken";
    }

    const version = p.status === "posted" || lapsed ? mission!.version : p.claim_version ?? mission!.version;
    const v = await latestVersion(tx, p.mission_id, version);
    rush.push({
      rush_id: p.rush_id,
      mission_id: p.mission_id,
      slot: p.slot,
      slots: p.slots,
      title: v.title,
      resident_id: v.resident_id,
      reward_stamps: v.reward_stamps,
      version: v.version,
      status,
      hold_expires_at: holdExpires,
    });
  }

  const missions: Array<{ mission_id: string } & Record<string, unknown>> = [];
  for (const m of allMissions.filter((m) => m.kind === "standard" && liveNow(m))) {
    const v = await latestVersion(tx, m.mission_id, m.version);
    missions.push({
      mission_id: m.mission_id,
      title: v.title,
      resident_id: v.resident_id,
      reward_stamps: v.reward_stamps,
      version: v.version,
      dialogue: { offer: v.offer },
    });
  }
  missions.sort((a, b) => (a.mission_id < b.mission_id ? -1 : a.mission_id > b.mission_id ? 1 : 0));
  return { rush, rushLeft, missions };
}

async function latestVersion(tx: Tx, missionId: string, version: number): Promise<MissionVersionRow> {
  const { rows } = await tx.query<MissionVersionRow>(
    `SELECT mission_id, version, title, resident_id, reward_stamps, offer, thanks
     FROM mission_versions WHERE mission_id = $1 AND version = $2`,
    [missionId, version],
  );
  return normalizeVersion(rows[0]);
}

export function normalizeVersion(row: { offer: unknown; thanks: unknown; title: string; resident_id: string; reward_stamps: number; version: number; mission_id: string }): MissionVersionRow {
  return {
    mission_id: row.mission_id,
    version: row.version,
    title: row.title,
    resident_id: row.resident_id,
    reward_stamps: row.reward_stamps,
    offer: row.offer as string[],
    thanks: row.thanks as string[],
  };
}
