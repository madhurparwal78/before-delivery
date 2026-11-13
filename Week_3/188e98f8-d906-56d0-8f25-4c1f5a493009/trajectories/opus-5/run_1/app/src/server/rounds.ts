/** The one place the round transitions and their refusals are decided. */

import type { Role } from '../shared/desk.js';
import type { LeagueTable, Round, RoundKind, RoundStatus } from '../shared/model.js';
import type { Db } from './db.js';
import { one } from './db.js';
import { conflict, notFound, storageUnavailable } from './errors.js';
import { StorageUnreachable, type SheetStore } from './storage.js';
import { leagueTable } from './table.js';

export interface RoundRow {
  number: number;
  title: string;
  kind: RoundKind;
  status: RoundStatus;
  opened_at: Date | null;
  closes_at: Date | null;
  closed_at: Date | null;
  sheet_key: string | null;
  sheet_size: number | null;
  sheet_sha256: string | null;
  sheet_width: number | null;
  sheet_height: number | null;
}

const ROUND_COLUMNS = `number, title, kind, status, opened_at, closes_at, closed_at,
  sheet_key, sheet_size, sheet_sha256, sheet_width, sheet_height`;

export function isRoundNumber(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 8;
}

export function toRound(row: RoundRow, serverNow: Date): Round {
  const secondsLeft =
    row.status === 'open' && row.closes_at !== null
      ? Math.max(0, Math.ceil((row.closes_at.getTime() - serverNow.getTime()) / 1000))
      : null;
  return {
    number: row.number,
    title: row.title,
    kind: row.kind,
    status: row.status,
    opened_at: row.opened_at === null ? null : row.opened_at.toISOString(),
    closes_at: row.closes_at === null ? null : row.closes_at.toISOString(),
    closed_at: row.closed_at === null ? null : row.closed_at.toISOString(),
    seconds_left: secondsLeft,
    sheet:
      row.kind === 'standard'
        ? null
        : {
            status: row.sheet_key === null ? 'not_stored' : 'stored',
            key: row.sheet_key,
            size: row.sheet_size,
            sha256: row.sheet_sha256,
            width: row.sheet_width,
            height: row.sheet_height,
          },
  };
}

/** A sheet is stored only on a drafted picture round. */
export function refuseSheetUpload(kind: RoundKind, status: RoundStatus): void {
  if (kind !== 'picture') throw conflict('not_picture_round');
  if (status !== 'drafted') throw conflict('round_not_drafted');
}

/** Only the quizmaster may read a sheet before its round has opened. */
export function refuseSheetRead(status: RoundStatus, role: Role): void {
  if (status === 'drafted' && role !== 'quizmaster') throw conflict('round_not_open');
}

/** A submit is taken only while its round is open. */
export function refuseSubmitUnlessOpen(status: RoundStatus): void {
  if (status === 'drafted') throw conflict('round_not_open');
  if (status !== 'open') throw conflict('round_closed');
}

/** A mark is recorded only while its round is closed. */
export function refuseMarkUnlessClosed(status: RoundStatus): void {
  if (status !== 'closed') throw conflict('round_not_closed');
}

/** A dispute is taken only while its round is marked. */
export function refuseDisputeUnlessMarked(status: RoundStatus): void {
  if (status !== 'marked') throw conflict('dispute_window_closed');
}

/** Close every open round whose allowance has run out. Run before any read or write of rounds. */
export async function settleRounds(db: Db): Promise<void> {
  await db.query(
    `update rounds set status = 'closed', closed_at = closes_at
     where status = 'open' and closes_at <= clock_timestamp()`,
  );
}

export async function serverNow(db: Db): Promise<Date> {
  const result = await db.query<{ now: Date }>('select clock_timestamp() as now');
  return one(result).now;
}

export async function readRounds(db: Db): Promise<{ rounds: Round[]; serverTime: Date }> {
  await settleRounds(db);
  const now = await serverNow(db);
  const result = await db.query<RoundRow>(`select ${ROUND_COLUMNS} from rounds order by number`);
  return { rounds: result.rows.map((row) => toRound(row, now)), serverTime: now };
}

export async function readRound(db: Db, number: number): Promise<Round> {
  await settleRounds(db);
  const row = await roundRow(db, number);
  return toRound(row, await serverNow(db));
}

export async function roundRow(db: Db, number: number, lock = false): Promise<RoundRow> {
  if (!isRoundNumber(number)) throw notFound();
  const result = await db.query<RoundRow>(
    `select ${ROUND_COLUMNS} from rounds where number = $1${lock ? ' for update' : ''}`,
    [number],
  );
  const row = result.rows[0];
  if (row === undefined) throw notFound();
  return row;
}

/** Lock the league row, so that opens, publishes and the table all take their turn. */
async function lockLeague(tx: Db): Promise<void> {
  await tx.query('select night from league where id = 1 for update');
}

export interface RoundDeps {
  db: Db;
  store: SheetStore;
  roundSeconds: number;
}

export async function openRound(deps: RoundDeps, number: number): Promise<Round> {
  const { db, store, roundSeconds } = deps;
  await settleRounds(db);
  return db.transaction(async (tx) => {
    await lockLeague(tx);
    const round = await roundRow(tx, number, true);
    if (round.status !== 'drafted') throw conflict('round_not_drafted');
    const open = await tx.query<{ number: number }>(`select number from rounds where status = 'open'`);
    if (open.rows.length > 0) throw conflict('another_round_open');
    if (round.kind === 'picture') {
      if (round.sheet_key === null) throw conflict('sheet_not_stored');
      try {
        const size = await store.size(round.sheet_key);
        if (size !== round.sheet_size) throw storageUnavailable();
      } catch (reason) {
        throw reason instanceof StorageUnreachable ? storageUnavailable() : reason;
      }
    }
    const updated = await tx.query<RoundRow>(
      `update rounds
         set status = 'open',
             opened_at = at.now,
             closes_at = at.now + ($2::int * interval '1 second'),
             closed_at = null
        from (select clock_timestamp() as now) at
       where number = $1
       returning ${ROUND_COLUMNS}`,
      [number, roundSeconds],
    );
    return toRound(one(updated), await serverNow(tx));
  });
}

export async function closeRound(db: Db, number: number): Promise<Round> {
  await settleRounds(db);
  return db.transaction(async (tx) => {
    const round = await roundRow(tx, number, true);
    if (round.status !== 'open') throw conflict('round_not_open');
    const updated = await tx.query<RoundRow>(
      `update rounds set status = 'closed', closed_at = clock_timestamp()
       where number = $1 returning ${ROUND_COLUMNS}`,
      [number],
    );
    return toRound(one(updated), await serverNow(tx));
  });
}

export async function markRound(db: Db, number: number): Promise<Round> {
  await settleRounds(db);
  return db.transaction(async (tx) => {
    const round = await roundRow(tx, number, true);
    if (round.status !== 'closed') throw conflict('round_not_closed');
    const unmarked = await tx.query<{ left: string }>(
      `select count(*)::text as left from answers where round = $1 and current and mark is null`,
      [number],
    );
    const left = Number(one(unmarked).left);
    if (left > 0) throw conflict('unmarked_answers', left);
    const updated = await tx.query<RoundRow>(
      `update rounds set status = 'marked' where number = $1 returning ${ROUND_COLUMNS}`,
      [number],
    );
    return toRound(one(updated), await serverNow(tx));
  });
}

export async function publishRound(
  db: Db,
  number: number,
): Promise<{ round: Round; table: LeagueTable }> {
  await settleRounds(db);
  return db.transaction(async (tx) => {
    await lockLeague(tx);
    const round = await roundRow(tx, number, true);
    if (round.status !== 'marked') throw conflict('round_not_marked');
    const raised = await tx.query<{ open: string }>(
      `select count(*)::text as open from disputes where round = $1 and status = 'raised'`,
      [number],
    );
    const open = Number(one(raised).open);
    if (open > 0) throw conflict('disputes_pending', open);
    await tx.query(
      `insert into published_scores (round, team_id, score)
       select $1, t.id, coalesce(sum(a.ruled), 0)::int
         from teams t
         left join answers a on a.team_id = t.id and a.round = $1 and a.current
        group by t.id
       on conflict (round, team_id) do update set score = excluded.score`,
      [number],
    );
    const updated = await tx.query<RoundRow>(
      `update rounds set status = 'published' where number = $1 returning ${ROUND_COLUMNS}`,
      [number],
    );
    const row = one(updated);
    await tx.query(
      `update league set table_version = table_version + 1, last_published_round = $1 where id = 1`,
      [number],
    );
    return { round: toRound(row, await serverNow(tx)), table: await leagueTable(tx) };
  });
}
