import { PoolClient } from 'pg';
import { makeId, makeToken, one, query } from '../db.js';
import { Pennies } from '../../domain/money.js';
import { Block, DutyRun, breachesOf, drivingMinutesOf, spreadMinutesOf } from '../../domain/hours.js';
import { FREE_AIRPORT_MINUTES, FREE_WAITING_MINUTES, waitingCharge } from '../../domain/payments.js';
import { LocalDateTime, formatUkDate, readWall, ukDateOf, ukTimeOf } from '../../domain/time.js';
import { foldTelephone } from '../../domain/text.js';
import { readFlight } from '../providers/wiremock.js';

export type PressKind = 'arrived' | 'boarded' | 'left' | 'comfortStop' | 'backOnTheRoad';
export const PRESS_KINDS: PressKind[] = ['arrived', 'boarded', 'left', 'comfortStop', 'backOnTheRoad'];

export type RunStop = {
  id: string;
  position: number;
  text: string;
  flightCode: string | null;
  flightActual: number | null;
  flightCheckedAt: number | null;
  flightOk: boolean | null;
};

export type ChargeRecord = {
  id: string;
  stopId: string | null;
  vehicleId: string;
  kind: 'waiting' | 'comfortStop';
  minutes: number;
  amount: Pennies;
  accepted: boolean;
};

export type RunRecord = {
  id: string;
  deskId: string;
  hireId: string;
  vehicleId: string;
  number: number;
  seats: number;
  driverName: string | null;
  driverTelephone: string | null;
  toldAt: number | null;
  confirmed: boolean;
  sheetToken: string;
  departAt: LocalDateTime;
  departInstant: number;
  secondDriver: boolean;
  blocks: Block[] | null;
  blocksStart: LocalDateTime | null;
  stops: RunStop[];
  charges: ChargeRecord[];
};

type RunRow = {
  id: string;
  desk_id: string;
  hire_id: string;
  vehicle_id: string;
  number: number;
  seats: number;
  driver_name: string | null;
  driver_telephone: string | null;
  told_at: string | null;
  confirmed: boolean;
  sheet_token: string;
  depart_date: string;
  depart_time: string;
  depart_instant: string;
  second_driver: boolean;
  blocks: Block[] | null;
  blocks_start_date: string | null;
  blocks_start_time: string | null;
};

const COLUMNS = `id, desk_id, hire_id, vehicle_id, number, seats, driver_name, driver_telephone, told_at, confirmed,
  sheet_token, depart_date, depart_time, depart_instant, second_driver, blocks, blocks_start_date, blocks_start_time`;

async function build(row: RunRow): Promise<RunRecord> {
  const stops = await query<{
    id: string;
    position: number;
    text: string;
    flight_code: string | null;
    flight_actual: string | null;
    flight_checked_at: string | null;
    flight_ok: boolean | null;
  }>(
    `select id, position, text, flight_code, flight_actual, flight_checked_at, flight_ok from run_stops
     where desk_id = $1 and run_id = $2 order by position`,
    [row.desk_id, row.id],
  );
  const charges = await query<{
    id: string;
    stop_id: string | null;
    vehicle_id: string;
    kind: 'waiting' | 'comfortStop';
    minutes: number;
    amount: number;
    accepted: boolean;
  }>(
    `select id, stop_id, vehicle_id, kind, minutes, amount, accepted from charges
     where desk_id = $1 and run_id = $2 order by id`,
    [row.desk_id, row.id],
  );
  return {
    id: row.id,
    deskId: row.desk_id,
    hireId: row.hire_id,
    vehicleId: row.vehicle_id,
    number: Number(row.number),
    seats: Number(row.seats),
    driverName: row.driver_name,
    driverTelephone: row.driver_telephone,
    toldAt: row.told_at === null ? null : Number(row.told_at),
    confirmed: row.confirmed,
    sheetToken: row.sheet_token,
    departAt: { date: row.depart_date, time: row.depart_time },
    departInstant: Number(row.depart_instant),
    secondDriver: row.second_driver,
    blocks: row.blocks,
    blocksStart:
      row.blocks_start_date && row.blocks_start_time
        ? { date: row.blocks_start_date, time: row.blocks_start_time }
        : null,
    stops: stops.map((stop) => ({
      id: stop.id,
      position: Number(stop.position),
      text: stop.text,
      flightCode: stop.flight_code,
      flightActual: stop.flight_actual === null ? null : Number(stop.flight_actual),
      flightCheckedAt: stop.flight_checked_at === null ? null : Number(stop.flight_checked_at),
      flightOk: stop.flight_ok,
    })),
    charges: charges.map((charge) => ({
      id: charge.id,
      stopId: charge.stop_id,
      vehicleId: charge.vehicle_id,
      kind: charge.kind,
      minutes: Number(charge.minutes),
      amount: Number(charge.amount),
      accepted: charge.accepted,
    })),
  };
}

export async function runById(deskId: string, id: string): Promise<RunRecord | null> {
  const row = await one<RunRow>(`select ${COLUMNS} from runs where desk_id = $1 and id = $2`, [deskId, id]);
  return row ? build(row) : null;
}

export async function runByToken(token: string): Promise<RunRecord | null> {
  const row = await one<RunRow>(`select ${COLUMNS} from runs where sheet_token = $1`, [token]);
  return row ? build(row) : null;
}

export async function runsOfHire(deskId: string, hireId: string): Promise<RunRecord[]> {
  const rows = await query<RunRow>(`select ${COLUMNS} from runs where desk_id = $1 and hire_id = $2 order by number`, [
    deskId,
    hireId,
  ]);
  return Promise.all(rows.map(build));
}

export async function runsOfDesk(deskId: string): Promise<RunRecord[]> {
  const rows = await query<RunRow>(`select ${COLUMNS} from runs where desk_id = $1 order by number`, [deskId]);
  return Promise.all(rows.map(build));
}

export async function runsBetween(deskId: string, from: number, to: number): Promise<RunRecord[]> {
  const rows = await query<RunRow>(
    `select ${COLUMNS} from runs where desk_id = $1 and depart_instant >= $2 and depart_instant < $3
     order by depart_instant, number`,
    [deskId, from, to],
  );
  return Promise.all(rows.map(build));
}

export const NO_BLOCKS_DUTY_MINUTES = 60;

export function dutyBlocksOf(run: RunRecord): Block[] {
  return run.blocks ?? [{ kind: 'drive', minutes: NO_BLOCKS_DUTY_MINUTES }];
}

export function dutyStartOf(run: RunRecord): number {
  if (run.blocksStart) {
    const reading = readWall(run.blocksStart);
    if (reading) return reading.instant;
  }
  return run.departInstant;
}

export function dutyRunOf(run: RunRecord): DutyRun {
  const start = dutyStartOf(run);
  return {
    id: run.id,
    driverKey: run.driverTelephone ? foldTelephone(run.driverTelephone) : null,
    dutyDate: ukDateOf(start),
    dutyStart: start,
    blocks: dutyBlocksOf(run),
    secondDriver: run.secondDriver,
  };
}

export type HoursAnswer = {
  drivingMinutes: number;
  spreadMinutes: number;
  breaches: { rule: string; atMinute: number; atLocal: LocalDateTime }[];
};

export async function hoursOf(run: RunRecord): Promise<HoursAnswer> {
  const deskRuns = (await runsOfDesk(run.deskId)).map(dutyRunOf);
  const asked = dutyRunOf(run);
  const start = dutyStartOf(run);
  const blocks = dutyBlocksOf(run);
  return {
    drivingMinutes: drivingMinutesOf(blocks),
    spreadMinutes: spreadMinutesOf(blocks),
    breaches: breachesOf(asked, deskRuns).map((breach) => {
      const at = start + breach.atMinute * 60000;
      return {
        rule: breach.rule,
        atMinute: breach.atMinute,
        atLocal: { date: ukDateOf(at), time: ukTimeOf(at) },
      };
    }),
  };
}

export type DutySpan = { from: number; to: number };

export function dutySpanOf(run: RunRecord): DutySpan {
  const start = dutyStartOf(run);
  return { from: start, to: start + spreadMinutesOf(dutyBlocksOf(run)) * 60000 };
}

/** A move whose duty would overlap the same driver's other run is refused. */
export async function driverClashOf(
  run: RunRecord,
  telephone: string | null,
  span: DutySpan,
): Promise<RunRecord | null> {
  if (!telephone) return null;
  const folded = foldTelephone(telephone);
  const runs = await runsOfDesk(run.deskId);
  for (const other of runs) {
    if (other.id === run.id) continue;
    if (!other.driverTelephone || foldTelephone(other.driverTelephone) !== folded) continue;
    const otherSpan = dutySpanOf(other);
    if (span.from < otherSpan.to && otherSpan.from < span.to) return other;
  }
  return null;
}

export async function makeRun(
  client: PoolClient,
  deskId: string,
  hireId: string,
  vehicleId: string,
  seats: number,
  number: number,
  departAt: LocalDateTime,
  departInstant: number,
  stops: string[],
): Promise<{ id: string; number: number; sheetToken: string }> {
  const id = makeId('RN');
  const sheetToken = makeToken();
  await client.query(
    `insert into runs (desk_id, id, hire_id, vehicle_id, number, seats, sheet_token, depart_date, depart_time,
       depart_instant) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [deskId, id, hireId, vehicleId, number, seats, sheetToken, departAt.date, departAt.time, departInstant],
  );
  for (let index = 0; index < stops.length; index += 1) {
    await client.query(
      'insert into run_stops (desk_id, id, run_id, position, text) values ($1,$2,$3,$4,$5)',
      [deskId, makeId('RS'), id, index, stops[index]],
    );
  }
  return { id, number, sheetToken };
}

export async function pressesOf(deskId: string, runId: string): Promise<{ stopId: string; kind: PressKind; at: number; repeatKey: string; id: string }[]> {
  const rows = await query<{ id: string; stop_id: string; kind: PressKind; at: string; repeat_key: string }>(
    'select id, stop_id, kind, at, repeat_key from presses where desk_id = $1 and run_id = $2 order by at, id',
    [deskId, runId],
  );
  return rows.map((row) => ({
    id: row.id,
    stopId: row.stop_id,
    kind: row.kind,
    at: Number(row.at),
    repeatKey: row.repeat_key,
  }));
}

export const PRESS_ORDER: Record<PressKind, PressKind | null> = {
  arrived: null,
  boarded: 'arrived',
  left: 'boarded',
  comfortStop: null,
  backOnTheRoad: 'comfortStop',
};

/** The waiting or comfort-stop charge a press completes, with the airport rule. */
export async function chargeForPress(
  run: RunRecord,
  stop: RunStop,
  kind: PressKind,
  at: number,
  presses: { stopId: string; kind: PressKind; at: number }[],
  ratePerHour: Pennies,
): Promise<{ kind: 'waiting' | 'comfortStop'; minutes: number; amount: Pennies } | null> {
  if (kind === 'boarded') {
    const arrived = presses.find((press) => press.stopId === stop.id && press.kind === 'arrived');
    if (!arrived) return null;
    if (stop.flightCode) {
      const landing = await flightLanding(run, stop, at);
      const base = landing ?? run.departInstant;
      const minutes = Math.max(0, Math.floor((at - base) / 60000));
      return {
        kind: 'waiting',
        minutes,
        amount: waitingCharge(minutes, FREE_AIRPORT_MINUTES, ratePerHour),
      };
    }
    const minutes = Math.max(0, Math.floor((at - arrived.at) / 60000));
    return { kind: 'waiting', minutes, amount: waitingCharge(minutes, FREE_WAITING_MINUTES, ratePerHour) };
  }
  if (kind === 'backOnTheRoad') {
    const started = presses.find((press) => press.stopId === stop.id && press.kind === 'comfortStop');
    if (!started) return null;
    const minutes = Math.max(0, Math.floor((at - started.at) / 60000));
    return { kind: 'comfortStop', minutes, amount: waitingCharge(minutes, FREE_WAITING_MINUTES, ratePerHour) };
  }
  return null;
}

const FLIGHT_READ_GAP_MS = 5 * 60 * 1000;

/** The flight is read at the first press at that stop and at most once per five minutes after. */
export async function flightLanding(run: RunRecord, stop: RunStop, now: number): Promise<number | null> {
  if (!stop.flightCode) return null;
  const fresh = stop.flightCheckedAt !== null && now - stop.flightCheckedAt < FLIGHT_READ_GAP_MS;
  if (fresh || stop.flightActual !== null) return stop.flightActual;
  try {
    const status = await readFlight(stop.flightCode, run.departAt.date);
    const actual = status.actualArrival ? Date.parse(status.actualArrival) : null;
    await query(
      'update run_stops set flight_checked_at = $3, flight_actual = $4, flight_ok = true where desk_id = $1 and id = $2',
      [run.deskId, stop.id, now, actual],
    );
    return actual;
  } catch {
    await query(
      'update run_stops set flight_checked_at = $3, flight_ok = false where desk_id = $1 and id = $2',
      [run.deskId, stop.id, now],
    );
    return null;
  }
}

export function runMessage(run: RunRecord, changed: boolean): string {
  const firstStop = run.stops[0]?.text.split(',')[0] ?? '';
  const when = `${run.departAt.time} ${formatUkDate(run.departAt.date)}`;
  return changed
    ? `Run ${run.number} changed: ${when}, ${firstStop}.`
    : `Run ${run.number}: ${when}, ${firstStop}.`;
}

export function runTitle(run: RunRecord): string {
  return `Run ${run.number}`;
}

export function chargesTotal(run: RunRecord): Pennies {
  return run.charges.reduce((sum, charge) => sum + charge.amount, 0);
}
