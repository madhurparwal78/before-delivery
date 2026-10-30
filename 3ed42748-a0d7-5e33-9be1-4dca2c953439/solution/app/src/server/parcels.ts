// Parcels: the open-parcel check with its repeated accept and claim answers, acceptance
// ownership, the rush claim winner and hold lapse, drops and hand-overs.
import type pg from "pg";
import { arcMetres, bearingDegrees } from "../shared/geo";
import { effectiveState, holdLapsed, parcelRow, releaseParcel, today } from "./board";
import { one, type Db } from "./db";
import { conflict, notFound, validation, type Fields } from "./errors";
import { iso, randomId } from "./ids";
import { balanceOf, writeMovement } from "./ledger";
import { loadMission, missionVersion, type Mission } from "./missions";
import { config } from "./config";
import { DOOR_DISTANCE_M, RADIUS_M, residentById } from "./seed";

interface Acceptance {
  id: string;
  courier_id: string;
  mission_id: string;
  version: number;
  rush_id: string | null;
  hold_expires_at: Date | null;
  status: "open" | "delivered" | "dropped" | "expired";
  first_answer: string;
}

const lapsed = (a: Acceptance): boolean =>
  a.rush_id !== null && a.status === "open" && holdLapsed(a.hold_expires_at!, Date.now());

const openAcceptance = (db: Db, courierId: string): Promise<Acceptance | undefined> =>
  one<Acceptance>(db, "SELECT * FROM acceptances WHERE courier_id = $1 AND status = 'open'", [courierId]);

/** The courier's open parcel as of now; a rush parcel whose hold has lapsed is not open. */
export async function openParcel(db: Db, courierId: string): Promise<Acceptance | null> {
  const a = await openAcceptance(db, courierId);
  return a && !lapsed(a) ? a : null;
}

const markExpired = (db: pg.PoolClient, acceptanceId: string) =>
  db.query("UPDATE acceptances SET status = 'expired' WHERE id = $1 AND status = 'open'", [acceptanceId]);

/**
 * Step 9's first check for accept and claim, with the courier's row locked: a repeat of the
 * parcel they carry answers its first 201 unchanged; any other request with full hands is refused.
 */
async function openParcelCheck(
  db: pg.PoolClient,
  courierId: string,
  repeats: (a: Acceptance) => boolean,
): Promise<string | null> {
  const a = await openAcceptance(db, courierId);
  if (!a) return null;
  if (lapsed(a)) {
    // the lapse is written down now, and the parcel goes back on the board once
    await db.query("SELECT 1 FROM rush_parcels WHERE id = $1 FOR UPDATE", [a.rush_id]);
    await markExpired(db, a.id);
    await releaseParcel(db, a.rush_id!, a.id);
    return null;
  }
  if (repeats(a)) return a.first_answer;
  throw conflict("hands_full");
}

// ---- positions ----

export function positionReasons(value: unknown, path: string, withHeading: boolean, fields: Fields): void {
  if (value === undefined) {
    fields[path] = "required";
    return;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fields[path] = "invalid";
    return;
  }
  const p = value as Record<string, unknown>;
  const ranges: Array<[string, (n: number) => boolean]> = [
    ["lat", (n) => n >= -90 && n <= 90],
    ["lon", (n) => n >= -180 && n <= 180],
  ];
  if (withHeading) ranges.push(["heading_deg", (n) => n >= 0 && n < 360]);
  for (const [key, inRange] of ranges) {
    const v = p[key];
    if (v === undefined) fields[`${path}.${key}`] = "required";
    else if (typeof v !== "number" || !Number.isFinite(v)) fields[`${path}.${key}`] = "invalid";
    else if (!inRange(v)) fields[`${path}.${key}`] = "out_of_range";
  }
}

function checkedPosition(body: Record<string, unknown>): { lat: number; lon: number } {
  const fields: Fields = {};
  positionReasons(body.position, "position", false, fields);
  if (Object.keys(fields).length) throw validation(fields);
  return body.position as { lat: number; lon: number };
}

// ---- creating acceptances ----

async function createAcceptance(
  db: pg.PoolClient,
  courierId: string,
  m: Mission,
  from: { lat: number; lon: number },
  rushId: string | null,
): Promise<string> {
  const resident = residentById(m.resident_id)!;
  const id = randomId("acc_");
  const now = Date.now();
  const hold = rushId ? new Date(now + config.rushHoldSeconds * 1000) : null;
  const parcel = {
    acceptance_id: id,
    mission_id: m.id,
    version: m.version,
    title: m.title,
    reward_stamps: m.reward_stamps,
    resident: { resident_id: resident.id, name: resident.name, home: resident.home },
    rush_id: rushId,
    hold_expires_at: hold ? iso(hold) : null,
    status: "open",
    route: {
      route_id: randomId("rt_"),
      door: { lat: resident.door.lat, lon: resident.door.lon },
      total_arc_m: Math.round(arcMetres(RADIUS_M, from, resident.door) * 10) / 10,
      initial_bearing_deg: bearingDegrees(from, resident.door),
    },
    dialogue: { offer: m.offer },
  };
  const firstAnswer = JSON.stringify(parcel);
  await db.query(
    `INSERT INTO acceptances (id, courier_id, mission_id, version, rush_id, hold_expires_at, status, first_answer, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8)`,
    [id, courierId, m.id, m.version, rushId, hold, firstAnswer, new Date(now)],
  );
  return firstAnswer;
}

export async function acceptMission(
  db: pg.PoolClient,
  courierId: string,
  missionId: string,
  body: () => Record<string, unknown>,
): Promise<{ status: number; body: string }> {
  const repeat = await openParcelCheck(db, courierId, (a) => a.rush_id === null && a.mission_id === missionId);
  if (repeat) return { status: 200, body: repeat };
  const m = (await loadMission(db, missionId))!;
  if (m.status !== "live") throw conflict("mission_not_live");
  if (m.kind === "rush") throw conflict("rush_claim_required");
  const position = checkedPosition(body());
  return { status: 201, body: await createAcceptance(db, courierId, m, position, null) };
}

export async function claimRushParcel(
  db: pg.PoolClient,
  courierId: string,
  rushId: string,
  body: () => Record<string, unknown>,
): Promise<{ status: number; body: string }> {
  const repeat = await openParcelCheck(db, courierId, (a) => a.rush_id === rushId);
  if (repeat) return { status: 200, body: repeat };
  const p = (await parcelRow(db, rushId, true))!;
  const now = Date.now();
  const state = effectiveState(p, now);
  if (p.mission_status !== "live") throw conflict("mission_not_live");
  if (p.board_date !== (await today(db)).date) throw conflict("board_closed");
  if (state !== "posted") throw conflict("parcel_taken");
  const position = checkedPosition(body());
  if (p.state === "claimed") await markExpired(db, p.acceptance_id!);
  const m = (await loadMission(db, p.mission_id))!;
  const answer = await createAcceptance(db, courierId, m, position, rushId);
  const acceptanceId = (JSON.parse(answer) as { acceptance_id: string }).acceptance_id;
  await db.query("UPDATE rush_parcels SET state = 'claimed', acceptance_id = $2 WHERE id = $1", [rushId, acceptanceId]);
  return { status: 201, body: answer };
}

// ---- ownership, drops and hand-overs ----

/** Step 6: an acceptance that is not the caller's answers exactly like one that never existed. */
export async function ownAcceptance(db: Db, courierId: string, acceptanceId: string): Promise<Acceptance> {
  const a = await one<Acceptance>(db, "SELECT * FROM acceptances WHERE id = $1", [acceptanceId]);
  if (!a || a.courier_id !== courierId) throw notFound();
  return a;
}

/** Locks the acceptance and its rush parcel (parcel first) and rereads the acceptance. */
async function lockAcceptance(db: pg.PoolClient, a: Acceptance): Promise<Acceptance> {
  if (a.rush_id) await db.query("SELECT 1 FROM rush_parcels WHERE id = $1 FOR UPDATE", [a.rush_id]);
  return (await one<Acceptance>(db, "SELECT * FROM acceptances WHERE id = $1 FOR UPDATE", [a.id]))!;
}

export async function dropParcel(
  db: pg.PoolClient,
  found: Acceptance,
  body: () => Record<string, unknown>,
): Promise<object> {
  const a = await lockAcceptance(db, found);
  if (a.status !== "open" || lapsed(a)) throw conflict("parcel_closed");
  body();
  await db.query("UPDATE acceptances SET status = 'dropped' WHERE id = $1", [a.id]);
  if (a.rush_id) await releaseParcel(db, a.rush_id, a.id);
  return { acceptance_id: a.id, status: "dropped" };
}

export async function handOver(
  db: pg.PoolClient,
  courierId: string,
  found: Acceptance,
  body: () => Record<string, unknown>,
): Promise<string> {
  const a = await lockAcceptance(db, found);
  if (a.status === "delivered") throw conflict("already_delivered");
  if (a.status === "dropped") throw conflict("parcel_dropped");
  if (a.status === "expired" || lapsed(a)) throw conflict("hold_expired");
  const position = checkedPosition(body());
  const version = await missionVersion(db, a.mission_id, a.version);
  const door = residentById(version.resident_id)!.door;
  if (arcMetres(RADIUS_M, position, door) > DOOR_DISTANCE_M) throw validation({ position: "too_far" });
  const movementId = await writeMovement(db, courierId, "delivery", a.mission_id, version.reward_stamps);
  const deliveryId = randomId("dl_");
  await db.query("INSERT INTO deliveries (id, acceptance_id, movement_id, created_at) VALUES ($1, $2, $3, $4)", [
    deliveryId,
    a.id,
    movementId,
    new Date(),
  ]);
  await db.query("UPDATE acceptances SET status = 'delivered' WHERE id = $1", [a.id]);
  if (a.rush_id) await db.query("UPDATE rush_parcels SET state = 'delivered' WHERE id = $1", [a.rush_id]);
  return JSON.stringify({
    delivery_id: deliveryId,
    acceptance_id: a.id,
    mission_id: a.mission_id,
    version: a.version,
    stamps_awarded: version.reward_stamps,
    balance: await balanceOf(db, courierId),
    movement_id: movementId,
    dialogue: { thanks: version.thanks },
  });
}

