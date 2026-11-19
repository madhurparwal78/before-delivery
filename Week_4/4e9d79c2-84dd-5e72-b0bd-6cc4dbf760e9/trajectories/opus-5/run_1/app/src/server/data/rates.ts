import { makeId, one, query } from '../db.js';
import { Pennies } from '../../domain/money.js';

export type RateTable = {
  id: string;
  effectiveFrom: string;
  defaultMarginTenths: number;
  waitingRatePerHour: Pennies;
  secondDriverCharge: Pennies;
  depositMinibus: Pennies;
  depositMinibusHigher: Pennies;
  depositCoach: Pennies;
  depositCoachHigher: Pennies;
};

type RateRow = {
  id: string;
  effective_from: string;
  default_margin_tenths: number;
  waiting_rate: number;
  second_driver_charge: number;
  deposit_minibus: number;
  deposit_minibus_higher: number;
  deposit_coach: number;
  deposit_coach_higher: number;
};

function fromRow(row: RateRow): RateTable {
  return {
    id: row.id,
    effectiveFrom: row.effective_from,
    defaultMarginTenths: Number(row.default_margin_tenths),
    waitingRatePerHour: Number(row.waiting_rate),
    secondDriverCharge: Number(row.second_driver_charge),
    depositMinibus: Number(row.deposit_minibus),
    depositMinibusHigher: Number(row.deposit_minibus_higher),
    depositCoach: Number(row.deposit_coach),
    depositCoachHigher: Number(row.deposit_coach_higher),
  };
}

const COLUMNS =
  'id, effective_from, default_margin_tenths, waiting_rate, second_driver_charge, deposit_minibus, deposit_minibus_higher, deposit_coach, deposit_coach_higher';

export async function rateTables(deskId: string): Promise<RateTable[]> {
  const rows = await query<RateRow>(
    `select ${COLUMNS} from rate_tables where desk_id = $1 order by effective_from, id`,
    [deskId],
  );
  return rows.map(fromRow);
}

/** The table in force on a date is the latest whose date is not after it. */
export async function rateTableInForce(deskId: string, date: string): Promise<RateTable> {
  const row = await one<RateRow>(
    `select ${COLUMNS} from rate_tables where desk_id = $1 and effective_from <= $2
     order by effective_from desc, id desc limit 1`,
    [deskId, date],
  );
  if (row) return fromRow(row);
  const earliest = await one<RateRow>(
    `select ${COLUMNS} from rate_tables where desk_id = $1 order by effective_from limit 1`,
    [deskId],
  );
  if (!earliest) throw new Error(`desk ${deskId} has no rate table`);
  return fromRow(earliest);
}

export async function rateTableById(deskId: string, id: string): Promise<RateTable | null> {
  const row = await one<RateRow>(`select ${COLUMNS} from rate_tables where desk_id = $1 and id = $2`, [deskId, id]);
  return row ? fromRow(row) : null;
}

export const DEFAULT_RATES = {
  effectiveFrom: '2000-01-01',
  defaultMarginTenths: 150,
  waitingRatePerHour: 2000,
  secondDriverCharge: 15000,
  depositMinibus: 5000,
  depositMinibusHigher: 10000,
  depositCoach: 10000,
  depositCoachHigher: 15000,
};

export async function addRateTable(deskId: string, table: Omit<RateTable, 'id'>): Promise<RateTable> {
  const id = makeId('RT');
  await query(
    `insert into rate_tables (desk_id, id, effective_from, default_margin_tenths, waiting_rate, second_driver_charge,
      deposit_minibus, deposit_minibus_higher, deposit_coach, deposit_coach_higher)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      deskId,
      id,
      table.effectiveFrom,
      table.defaultMarginTenths,
      table.waitingRatePerHour,
      table.secondDriverCharge,
      table.depositMinibus,
      table.depositMinibusHigher,
      table.depositCoach,
      table.depositCoachHigher,
    ],
  );
  return { id, ...table };
}

export async function makeDefaultRateTable(deskId: string): Promise<RateTable> {
  return addRateTable(deskId, DEFAULT_RATES);
}
