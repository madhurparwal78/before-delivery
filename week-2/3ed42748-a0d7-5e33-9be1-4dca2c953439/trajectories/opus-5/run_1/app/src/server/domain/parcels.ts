import { queryOne, type Transaction } from '../db/pool.js';
import { newAcceptanceId, newRouteId } from '../db/ids.js';
import { BRAMBLE_RADIUS_M } from '../db/seed.js';
import { arcMetres, initialBearingDeg, type LatLon } from '../../shared/geo.js';
import { fail } from '../http/errors.js';
import { isoTime } from './time.js';
import { loadMissionVersion, type MissionRecord } from './missions.js';
import { resident } from './residents.js';

export const DOOR_DISTANCE_M = 4;

export type AcceptanceStatus = 'open' | 'delivered' | 'dropped' | 'expired';

export interface ParcelBody {
  acceptance_id: string;
  mission_id: string;
  version: number;
  title: string;
  reward_stamps: number;
  resident: { resident_id: string; name: string; home: string };
  rush_id: string | null;
  hold_expires_at: string | null;
  status: 'open';
  route: {
    route_id: string;
    door: { lat: number; lon: number };
    total_arc_m: number;
    initial_bearing_deg: number;
  };
  dialogue: { offer: string[] };
}

export interface AcceptanceRow {
  acceptance_id: string;
  courier_id: string;
  mission_id: string;
  version: number;
  rush_id: string | null;
  status: AcceptanceStatus;
  hold_expires_at: Date | null;
  accepted_at: Date;
  door_lat: number;
  door_lon: number;
  answer: ParcelBody;
}

const ACCEPTANCE_COLUMNS = `acceptance_id, courier_id, mission_id, version, rush_id, status,
                            hold_expires_at, accepted_at, door_lat, door_lon, answer`;

/** A rush hold has lapsed when the moment this request is processed is at or after its end. */
export function holdHasLapsed(row: AcceptanceRow, now: Date): boolean {
  return row.hold_expires_at !== null && now.getTime() >= row.hold_expires_at.getTime();
}

export function isCarried(row: AcceptanceRow, now: Date): boolean {
  return row.status === 'open' && !holdHasLapsed(row, now);
}

export async function openAcceptanceOf(
  tx: Transaction,
  courierId: string,
): Promise<AcceptanceRow | null> {
  return tx.one<AcceptanceRow>(
    `select ${ACCEPTANCE_COLUMNS} from acceptances
     where courier_id = $1 and status = 'open' for update`,
    [courierId],
  );
}

export async function carriedParcelOf(courierId: string, now: Date): Promise<ParcelBody | null> {
  const row = await queryOne<AcceptanceRow>(
    `select ${ACCEPTANCE_COLUMNS} from acceptances where courier_id = $1 and status = 'open'`,
    [courierId],
  );
  return row !== null && isCarried(row, now) ? row.answer : null;
}

export async function loadAcceptanceIn(
  tx: Transaction,
  acceptanceId: string,
): Promise<AcceptanceRow | null> {
  return tx.one<AcceptanceRow>(
    `select ${ACCEPTANCE_COLUMNS} from acceptances where acceptance_id = $1 for update`,
    [acceptanceId],
  );
}

/**
 * The open-parcel check, the first state check for an accept or a claim: a repeat of what the
 * courier already carries answers with that parcel, and anything else refuses with full hands.
 */
export async function checkOpenParcel(
  tx: Transaction,
  courierId: string,
  wanted: { missionId: string } | { rushId: string },
  now: Date,
): Promise<ParcelBody | null> {
  const open = await openAcceptanceOf(tx, courierId);
  if (open === null || !isCarried(open, now)) return null;
  if ('rushId' in wanted) {
    if (open.rush_id === wanted.rushId) return open.answer;
  } else if (open.rush_id === null && open.mission_id === wanted.missionId) {
    return open.answer;
  }
  throw fail('hands_full');
}

export interface NewAcceptance {
  courierId: string;
  mission: MissionRecord;
  version: number;
  rushId: string | null;
  holdExpiresAt: Date | null;
  from: LatLon;
  now: Date;
}

/** Records an acceptance and the one answer it will always give. */
export async function createAcceptance(
  tx: Transaction,
  details: NewAcceptance,
): Promise<ParcelBody> {
  const version = await loadMissionVersion(tx, details.mission.mission_id, details.version);
  const home = await resident(version.resident_id);
  const acceptanceId = newAcceptanceId();
  const totalArc = arcMetres(details.from, home.door, BRAMBLE_RADIUS_M);
  const parcel: ParcelBody = {
    acceptance_id: acceptanceId,
    mission_id: details.mission.mission_id,
    version: details.version,
    title: version.title,
    reward_stamps: version.reward_stamps,
    resident: { resident_id: home.resident_id, name: home.name, home: home.home },
    rush_id: details.rushId,
    hold_expires_at: details.holdExpiresAt === null ? null : isoTime(details.holdExpiresAt),
    status: 'open',
    route: {
      route_id: newRouteId(),
      door: { lat: home.door.lat, lon: home.door.lon },
      total_arc_m: Number(totalArc.toFixed(1)),
      initial_bearing_deg: initialBearingDeg(details.from, home.door),
    },
    dialogue: { offer: version.dialogue.offer },
  };
  await tx.query(
    `insert into acceptances (acceptance_id, courier_id, mission_id, version, rush_id, status,
                              hold_expires_at, accepted_at, door_lat, door_lon, answer)
     values ($1, $2, $3, $4, $5, 'open', $6, $7, $8, $9, $10)`,
    [
      acceptanceId,
      details.courierId,
      details.mission.mission_id,
      details.version,
      details.rushId,
      details.holdExpiresAt,
      details.now,
      home.door.lat,
      home.door.lon,
      JSON.stringify(parcel),
    ],
  );
  return parcel;
}

export async function closeAcceptance(
  tx: Transaction,
  acceptanceId: string,
  status: Exclude<AcceptanceStatus, 'open'>,
): Promise<void> {
  await tx.query('update acceptances set status = $2 where acceptance_id = $1', [
    acceptanceId,
    status,
  ]);
}

export function doorOf(row: AcceptanceRow): LatLon {
  return { lat: row.door_lat, lon: row.door_lon };
}

export function refuseIfTooFar(row: AcceptanceRow, from: LatLon): void {
  if (arcMetres(from, doorOf(row), BRAMBLE_RADIUS_M) > DOOR_DISTANCE_M) {
    throw fail('validation', { fields: { position: 'too_far' } });
  }
}
