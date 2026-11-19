import { PoolClient } from 'pg';
import { makeId, query } from '../db.js';
import { Pennies } from '../../domain/money.js';

export type Account = 'clientMoney' | 'hireIncome' | 'refundsDue' | 'operatorOwed';

const ACCOUNT_LABELS: Record<Account, string> = {
  clientMoney: 'Client money',
  hireIncome: 'Hire income',
  refundsDue: 'Refunds due',
  operatorOwed: 'Operator owed',
};

export function accountLabel(account: Account): string {
  return ACCOUNT_LABELS[account];
}

export type LedgerLine = {
  id: string;
  movementId: string;
  account: Account;
  amount: Pennies;
  at: number;
  vehicleId: string | null;
  description: string;
};

export type MovementLine = { account: Account; amount: Pennies; vehicleId?: string | null; description?: string };

/** Every movement writes its lines in one transaction, and they always sum to zero. */
export async function writeMovement(
  client: PoolClient,
  deskId: string,
  hireId: string,
  lines: MovementLine[],
  at: number,
): Promise<string> {
  const sum = lines.reduce((total, line) => total + line.amount, 0);
  if (sum !== 0) throw new Error(`movement does not sum to zero: ${sum}`);
  const movementId = makeId('MV');
  for (const line of lines) {
    await client.query(
      `insert into ledger_lines (desk_id, hire_id, movement_id, account, amount, at, vehicle_id, description)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [deskId, hireId, movementId, line.account, line.amount, at, line.vehicleId ?? null, line.description ?? ''],
    );
  }
  return movementId;
}

type LineRow = {
  id: string;
  movement_id: string;
  account: Account;
  amount: number;
  at: string;
  vehicle_id: string | null;
  description: string;
};

export async function ledgerLines(deskId: string, hireId?: string): Promise<LedgerLine[]> {
  const rows = hireId
    ? await query<LineRow>(
        `select id, movement_id, account, amount, at, vehicle_id, description from ledger_lines
         where desk_id = $1 and hire_id = $2 order by at, id`,
        [deskId, hireId],
      )
    : await query<LineRow>(
        `select id, movement_id, account, amount, at, vehicle_id, description from ledger_lines
         where desk_id = $1 order by at, id`,
        [deskId],
      );
  return rows.map((row) => ({
    id: String(row.id),
    movementId: row.movement_id,
    account: row.account,
    amount: Number(row.amount),
    at: Number(row.at),
    vehicleId: row.vehicle_id,
    description: row.description,
  }));
}

/** Always the sum of the desk's client money lines. */
export async function moneyHeld(deskId: string): Promise<Pennies> {
  const rows = await query<{ sum: string | null }>(
    "select sum(amount)::text as sum from ledger_lines where desk_id = $1 and account = 'clientMoney'",
    [deskId],
  );
  return Number(rows[0]?.sum ?? 0);
}
