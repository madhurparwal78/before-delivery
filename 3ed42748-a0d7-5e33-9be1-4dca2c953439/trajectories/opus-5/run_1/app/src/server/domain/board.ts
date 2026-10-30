import { query, queryOne, withTransaction, type Transaction } from '../db/pool.js';
import { newRushId } from '../db/ids.js';
import { config } from '../config.js';
import { boardDateFor, isAcceptedTimeZone } from '../../shared/studioClock.js';
import { fail, validation } from '../http/errors.js';
import { isoTime } from './time.js';
import { promoteDueMissions, type Dialogue } from './missions.js';

export interface BoardDay {
  board_date: string;
  time_zone: string;
}

export async function studioTimeZone(): Promise<string> {
  const row = await queryOne<{ time_zone: string }>('select time_zone from studio where only_row = 1');
  if (row === null) throw fail('internal');
  return row.time_zone;
}

export async function setStudioTimeZone(raw: unknown): Promise<BoardDay> {
  if (!isAcceptedTimeZone(raw)) throw validation({ time_zone: 'invalid' });
  await query('update studio set time_zone = $1 where only_row = 1', [raw]);
  return { time_zone: raw, board_date: boardDateFor(new Date(), raw) };
}

/** The board day now, by the studio time zone's own wall clock. */
export async function boardDayNow(now: Date): Promise<BoardDay> {
  const zone = await studioTimeZone();
  return { time_zone: zone, board_date: boardDateFor(now, zone) };
}

interface LiveRushMission {
  mission_id: string;
  rush_slots: number;
  live_at: Date;
}

/** Posts each live rush mission's parcels onto a board date exactly once. */
export async function ensureBoardPosted(day: BoardDay): Promise<void> {
  const pending = await query<LiveRushMission>(
    `select m.mission_id, m.rush_slots, m.live_at from missions m
     where m.kind = 'rush' and m.status = 'live' and m.rush_slots is not null
       and not exists (
         select 1 from board_days b
         where b.board_date = $1::date and b.mission_id = m.mission_id
       )`,
    [day.board_date],
  );
  const due = pending.filter(
    (mission) => boardDateFor(mission.live_at, day.time_zone) <= day.board_date,
  );
  if (due.length === 0) return;
  await withTransaction(async (tx) => {
    await tx.lock(`board:${day.board_date}`);
    for (const mission of due) {
      const claimed = await tx.one<{ mission_id: string }>(
        'insert into board_days (board_date, mission_id) values ($1, $2) on conflict do nothing returning mission_id',
        [day.board_date, mission.mission_id],
      );
      if (claimed === null) continue;
      for (let slot = 1; slot <= mission.rush_slots; slot += 1) {
        await tx.query(
          `insert into rush_parcels (rush_id, board_date, mission_id, slot, slots, status)
           values ($1, $2, $3, $4, $5, 'posted')`,
          [newRushId(), day.board_date, mission.mission_id, slot, mission.rush_slots],
        );
      }
    }
  });
}

export type RushStatus = 'posted' | 'taken' | 'yours' | 'delivered';

export interface RushRow {
  rush_id: string;
  mission_id: string;
  slot: number;
  slots: number;
  title: string;
  resident_id: string;
  reward_stamps: number;
  version: number;
  status: RushStatus;
  hold_expires_at: string | null;
}

interface RushParcelRow {
  rush_id: string;
  mission_id: string;
  slot: number;
  slots: number;
  parcel_status: 'posted' | 'claimed' | 'delivered';
  mission_status: string;
  current_version: number;
  claimant: string | null;
  bound_version: number | null;
  hold_expires_at: Date | null;
}

const RUSH_PARCELS_SQL = `
  select p.rush_id, p.mission_id, p.slot, p.slots, p.status as parcel_status,
         m.status as mission_status, m.version as current_version,
         a.courier_id as claimant, a.version as bound_version, a.hold_expires_at
  from rush_parcels p
  join missions m on m.mission_id = p.mission_id
  left join acceptances a on a.acceptance_id = p.acceptance_id
  where p.board_date = $1::date
  order by p.mission_id, p.slot`;

interface Claimable {
  row: RushParcelRow;
  lapsed: boolean;
  retired: boolean;
}

function judge(row: RushParcelRow, now: Date): Claimable {
  const lapsed =
    row.parcel_status === 'claimed' &&
    row.hold_expires_at !== null &&
    now.getTime() >= row.hold_expires_at.getTime();
  return { row, lapsed, retired: row.mission_status === 'retired' };
}

function effectiveStatus(judged: Claimable, courierId: string): RushStatus {
  const { row, lapsed } = judged;
  if (row.parcel_status === 'delivered') {
    return row.claimant === courierId ? 'delivered' : 'taken';
  }
  if (row.parcel_status === 'claimed' && !lapsed) {
    return row.claimant === courierId ? 'yours' : 'taken';
  }
  return 'posted';
}

function listed(judged: Claimable, courierId: string): boolean {
  if (!judged.retired) return true;
  const status = effectiveStatus(judged, courierId);
  return status === 'yours' || status === 'taken' || status === 'delivered';
}

function countsTowardRushLeft(judged: Claimable): boolean {
  if (judged.retired) return false;
  return judged.row.parcel_status === 'posted' || judged.lapsed;
}

interface VersionFacts {
  title: string;
  resident_id: string;
  reward_stamps: number;
  dialogue: Dialogue;
}

async function versionFacts(
  pairs: Array<{ mission_id: string; version: number }>,
): Promise<Map<string, VersionFacts>> {
  const facts = new Map<string, VersionFacts>();
  if (pairs.length === 0) return facts;
  const rows = await query<{
    mission_id: string;
    version: number;
    title: string;
    resident_id: string;
    reward_stamps: number;
    dialogue: Dialogue;
  }>(
    `select mission_id, version, title, resident_id, reward_stamps, dialogue
     from mission_versions
     where (mission_id, version) in (
       select * from unnest($1::text[], $2::int[])
     )`,
    [pairs.map((pair) => pair.mission_id), pairs.map((pair) => pair.version)],
  );
  for (const row of rows) {
    facts.set(`${row.mission_id}@${row.version}`, {
      title: row.title,
      resident_id: row.resident_id,
      reward_stamps: row.reward_stamps,
      dialogue: row.dialogue,
    });
  }
  return facts;
}

export interface DepotRead extends BoardDay {
  rush_left: number;
  missions: Array<{
    mission_id: string;
    title: string;
    resident_id: string;
    reward_stamps: number;
    version: number;
    dialogue: { offer: string[] };
  }>;
  rush: RushRow[];
}

/** The day's board, with each rush row's status from one courier's point of view. */
export async function readDepot(courierId: string, now: Date): Promise<DepotRead> {
  await promoteDueMissions();
  const day = await boardDayNow(now);
  await ensureBoardPosted(day);

  const standard = await query<{
    mission_id: string;
    title: string;
    resident_id: string;
    reward_stamps: number;
    version: number;
    dialogue: Dialogue;
  }>(
    `select m.mission_id, m.version, v.title, v.resident_id, v.reward_stamps, v.dialogue
     from missions m
     join mission_versions v on v.mission_id = m.mission_id and v.version = m.version
     where m.kind = 'standard' and m.status = 'live'
     order by m.created_at, m.mission_id`,
  );

  const parcels = await query<RushParcelRow>(RUSH_PARCELS_SQL, [day.board_date]);
  const judged = parcels.map((row) => judge(row, now));
  const shown = judged.filter((candidate) => listed(candidate, courierId));
  const facts = await versionFacts(
    shown.map((candidate) => ({
      mission_id: candidate.row.mission_id,
      version:
        effectiveStatus(candidate, courierId) === 'posted'
          ? candidate.row.current_version
          : candidate.row.bound_version ?? candidate.row.current_version,
    })),
  );

  const rush: RushRow[] = shown.map((candidate) => {
    const status = effectiveStatus(candidate, courierId);
    const version =
      status === 'posted'
        ? candidate.row.current_version
        : candidate.row.bound_version ?? candidate.row.current_version;
    const fact = facts.get(`${candidate.row.mission_id}@${version}`)!;
    return {
      rush_id: candidate.row.rush_id,
      mission_id: candidate.row.mission_id,
      slot: candidate.row.slot,
      slots: candidate.row.slots,
      title: fact.title,
      resident_id: fact.resident_id,
      reward_stamps: fact.reward_stamps,
      version,
      status,
      hold_expires_at:
        status === 'yours' && candidate.row.hold_expires_at !== null
          ? isoTime(candidate.row.hold_expires_at)
          : null,
    };
  });

  return {
    ...day,
    rush_left: judged.filter(countsTowardRushLeft).length,
    missions: standard.map((row) => ({
      mission_id: row.mission_id,
      title: row.title,
      resident_id: row.resident_id,
      reward_stamps: row.reward_stamps,
      version: row.version,
      dialogue: { offer: row.dialogue.offer },
    })),
    rush,
  };
}

export interface LockedRushParcel {
  rush_id: string;
  board_date: string;
  mission_id: string;
  slot: number;
  slots: number;
  status: 'posted' | 'claimed' | 'delivered';
  acceptance_id: string | null;
}

export async function lockRushParcel(
  tx: Transaction,
  rushId: string,
): Promise<LockedRushParcel | null> {
  return tx.one<LockedRushParcel>(
    `select rush_id, to_char(board_date, 'YYYY-MM-DD') as board_date, mission_id, slot, slots,
            status, acceptance_id
     from rush_parcels where rush_id = $1 for update`,
    [rushId],
  );
}

export async function bindRushParcel(
  tx: Transaction,
  rushId: string,
  acceptanceId: string,
): Promise<void> {
  await tx.query(
    `update rush_parcels set status = 'claimed', acceptance_id = $2 where rush_id = $1`,
    [rushId, acceptanceId],
  );
}

export async function releaseRushParcel(tx: Transaction, rushId: string): Promise<void> {
  await tx.query(
    `update rush_parcels set status = 'posted', acceptance_id = null where rush_id = $1`,
    [rushId],
  );
}

export async function markRushDelivered(tx: Transaction, rushId: string): Promise<void> {
  await tx.query(`update rush_parcels set status = 'delivered' where rush_id = $1`, [rushId]);
}

export function holdEndFor(now: Date): Date {
  return new Date(now.getTime() + config.rushHoldSeconds * 1000);
}
