// The depot board: board days, rush parcel posting and slot numbering, each row's status from
// the caller's point of view, and the rush count. A hold has lapsed when the server clock at
// the moment of the read is at or after its end, whether or not anything has written it down.
import type pg from "pg";
import { all, type Db } from "./db";
import { iso, randomId } from "./ids";
import { boardDate, studioZone } from "./studio";

export async function today(db: Db): Promise<{ date: string; zone: string }> {
  const zone = await studioZone(db);
  return { date: boardDate(Date.now(), zone), zone };
}

async function insertSlots(db: pg.PoolClient, date: string, missionId: string, slots: number): Promise<void> {
  for (let slot = 1; slot <= slots; slot++) {
    await db.query(
      `INSERT INTO rush_parcels (id, board_date, mission_id, slot, slots, state)
       VALUES ($1, $2, $3, $4, $5, 'posted') ON CONFLICT (board_date, mission_id, slot) DO NOTHING`,
      [randomId("rp_"), date, missionId, slot, slots],
    );
  }
}

/** The first read of a board date posts every live rush mission's slots, exactly once. */
async function ensureBoardPosted(db: pg.PoolClient, date: string): Promise<void> {
  const created = await db.query(
    "INSERT INTO board_days (board_date, posted_at) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [date, new Date()],
  );
  if (created.rowCount === 0) return;
  const live = await all<{ id: string; rush_slots: number }>(
    db,
    `SELECT m.id, v.rush_slots FROM missions m JOIN mission_versions v ON v.mission_id = m.id AND v.version = m.version
      WHERE m.status = 'live' AND m.kind = 'rush' ORDER BY m.id`,
  );
  for (const m of live) await insertSlots(db, date, m.id, m.rush_slots);
}

/** A rush mission going live posts its slots on the current board. */
export async function postMissionOnBoard(db: pg.PoolClient, missionId: string): Promise<void> {
  const { date } = await today(db);
  await ensureBoardPosted(db, date);
  const [m] = await all<{ rush_slots: number }>(
    db,
    `SELECT v.rush_slots FROM missions m JOIN mission_versions v ON v.mission_id = m.id AND v.version = m.version
      WHERE m.id = $1`,
    [missionId],
  );
  await insertSlots(db, date, missionId, m!.rush_slots);
}

/** Retiring removes a mission's posted, unclaimed parcels; held claims carry on. */
export async function removePostedParcels(db: pg.PoolClient, missionId: string): Promise<void> {
  await db.query("UPDATE rush_parcels SET state = 'removed' WHERE mission_id = $1 AND state = 'posted'", [missionId]);
}

/** A parcel whose claim ended without delivery goes back on the board, or off it if its mission retired. */
export async function releaseParcel(db: pg.PoolClient, rushId: string, acceptanceId: string): Promise<void> {
  await db.query(
    `UPDATE rush_parcels p
        SET state = CASE WHEN m.status = 'retired' THEN 'removed' ELSE 'posted' END, acceptance_id = NULL
       FROM missions m
      WHERE p.id = $1 AND p.acceptance_id = $2 AND p.state = 'claimed' AND m.id = p.mission_id`,
    [rushId, acceptanceId],
  );
}

type RushStatus = "posted" | "taken" | "yours" | "delivered";

interface ParcelRow {
  id: string;
  board_date: string;
  mission_id: string;
  slot: number;
  slots: number;
  state: "posted" | "claimed" | "delivered" | "removed";
  acceptance_id: string | null;
  mission_status: string;
  latest_version: number;
  holder: string | null;
  acceptance_status: string | null;
  hold_expires_at: Date | null;
  bound_version: number | null;
}

const PARCEL_SELECT = `
  SELECT p.id, p.board_date, p.mission_id, p.slot, p.slots, p.state, p.acceptance_id,
         m.status AS mission_status, m.version AS latest_version,
         a.courier_id AS holder, a.status AS acceptance_status, a.hold_expires_at, a.version AS bound_version
    FROM rush_parcels p
    JOIN missions m ON m.id = p.mission_id
    LEFT JOIN acceptances a ON a.id = p.acceptance_id`;

type Effective = "posted" | "held" | "delivered" | "gone";

/** The one hold-lapse rule: an open rush acceptance has lapsed once the server clock reaches its hold end. */
export const holdLapsed = (holdExpiresAt: Date, now: number): boolean => holdExpiresAt.getTime() <= now;

/** A parcel's state as of now: a claim whose hold has lapsed counts as posted again. */
export function effectiveState(p: ParcelRow, now: number): Effective {
  if (p.state === "removed") return "gone";
  if (p.state === "delivered") return "delivered";
  const held = p.state === "claimed" && p.acceptance_status === "open" && !holdLapsed(p.hold_expires_at!, now);
  if (held) return "held";
  return p.mission_status === "retired" ? "gone" : "posted";
}

export async function parcelRow(db: Db, rushId: string, forUpdate = false): Promise<ParcelRow | undefined> {
  if (forUpdate) await db.query("SELECT 1 FROM rush_parcels WHERE id = $1 FOR UPDATE", [rushId]);
  const [row] = await all<ParcelRow>(db, `${PARCEL_SELECT} WHERE p.id = $1`, [rushId]);
  return row;
}

export async function depotView(db: pg.PoolClient, courierId: string): Promise<object> {
  const { date, zone } = await today(db);
  await ensureBoardPosted(db, date);
  const now = Date.now();
  const versions = await all<{
    mission_id: string;
    version: number;
    title: string;
    resident_id: string;
    reward_stamps: number;
    offer: string[];
  }>(
    db,
    "SELECT mission_id, version, title, resident_id, reward_stamps, offer FROM mission_versions",
  );
  const versionOf = (id: string, v: number) => versions.find((x) => x.mission_id === id && x.version === v)!;
  const standard = await all<{ id: string; version: number }>(
    db,
    "SELECT id, version FROM missions WHERE status = 'live' AND kind = 'standard' ORDER BY created_seq",
  );
  const parcels = await all<ParcelRow>(db, `${PARCEL_SELECT} WHERE p.board_date = $1 ORDER BY p.mission_id, p.slot`, [
    date,
  ]);
  const rush = [];
  let rushLeft = 0;
  for (const p of parcels) {
    const state = effectiveState(p, now);
    if (state === "gone") continue;
    const mine = p.holder === courierId;
    let status: RushStatus;
    if (state === "posted") status = "posted";
    else if (state === "held") status = mine ? "yours" : "taken";
    else status = mine ? "delivered" : "taken";
    if (status === "posted") rushLeft++;
    const v = versionOf(p.mission_id, status === "posted" ? p.latest_version : p.bound_version!);
    rush.push({
      rush_id: p.id,
      mission_id: p.mission_id,
      slot: p.slot,
      slots: p.slots,
      title: v.title,
      resident_id: v.resident_id,
      reward_stamps: v.reward_stamps,
      version: status === "posted" ? p.latest_version : p.bound_version,
      status,
      hold_expires_at: status === "yours" ? iso(p.hold_expires_at!) : null,
    });
  }
  return {
    board_date: date,
    time_zone: zone,
    rush_left: rushLeft,
    missions: standard.map((m) => {
      const v = versionOf(m.id, m.version);
      return {
        mission_id: m.id,
        title: v.title,
        resident_id: v.resident_id,
        reward_stamps: v.reward_stamps,
        version: m.version,
        dialogue: { offer: v.offer },
      };
    }),
    rush,
  };
}
