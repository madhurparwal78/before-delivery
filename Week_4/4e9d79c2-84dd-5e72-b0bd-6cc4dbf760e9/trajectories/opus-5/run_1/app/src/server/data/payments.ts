import { PoolClient } from 'pg';
import { inTransaction, makeId, one, query } from '../db.js';
import { Pennies } from '../../domain/money.js';
import { allocate, AllocationVehicle } from '../../domain/payments.js';
import { StatementRow, statementRowKey } from '../../domain/statement.js';
import { HireView, loadHire } from './hires.js';
import { writeMovement } from './ledger.js';

export type PreviewLists = {
  matched: StatementRow[];
  unmatched: StatementRow[];
  moneyOut: StatementRow[];
  alreadySeen: StatementRow[];
  refused: { row: number; message: string }[];
};

export async function seenRowKeys(deskId: string): Promise<Set<string>> {
  const rows = await query<{ row_key: string }>('select row_key from statement_rows where desk_id = $1', [deskId]);
  return new Set(rows.map((row) => row.row_key));
}

export async function hireExists(deskId: string, reference: string): Promise<boolean> {
  const row = await one<{ id: string }>('select id from enquiries where desk_id = $1 and id = $2', [deskId, reference]);
  return row !== null;
}

export async function savePreview(deskId: string, lists: PreviewLists): Promise<string> {
  const id = makeId('PV');
  await query('insert into statement_previews (desk_id, id, payload, created_at) values ($1,$2,$3,$4)', [
    deskId,
    id,
    JSON.stringify(lists),
    Date.now(),
  ]);
  return id;
}

export async function readPreview(deskId: string, id: string): Promise<{ lists: PreviewLists; broughtIn: boolean } | null> {
  const row = await one<{ payload: PreviewLists; brought_in: boolean }>(
    'select payload, brought_in from statement_previews where desk_id = $1 and id = $2',
    [deskId, id],
  );
  return row ? { lists: row.payload, broughtIn: row.brought_in } : null;
}

function allocationVehiclesOf(hire: HireView): AllocationVehicle[] {
  return hire.vehicles.map((vehicle) => ({
    id: vehicle.id,
    departInstant: vehicle.departInstant ?? hire.departInstant,
    position: vehicle.position,
    deposit: vehicle.deposit,
    total: vehicle.total,
    depositPaid: vehicle.depositPaid,
    balancePaid: vehicle.balancePaid,
  }));
}

/** Money in: plus on client money, minus on hire income, one movement per vehicle part and one for any credit. */
export async function takePayment(
  client: PoolClient,
  deskId: string,
  hire: HireView,
  amount: Pennies,
  description: string,
  at: number,
): Promise<void> {
  const allocation = allocate(amount, allocationVehiclesOf(hire));
  for (const part of allocation.parts) {
    await client.query(
      'insert into allocations (desk_id, id, hire_id, vehicle_id, kind, amount, at) values ($1,$2,$3,$4,$5,$6,$7)',
      [deskId, makeId('AL'), hire.id, part.vehicleId, part.kind, part.amount, at],
    );
    await writeMovement(
      client,
      deskId,
      hire.id,
      [
        { account: 'clientMoney', amount: part.amount, vehicleId: part.vehicleId, description },
        { account: 'hireIncome', amount: -part.amount, vehicleId: part.vehicleId, description },
      ],
      at,
    );
  }
  if (allocation.credit > 0) {
    await client.query(
      'insert into allocations (desk_id, id, hire_id, vehicle_id, kind, amount, at) values ($1,$2,$3,null,$4,$5,$6)',
      [deskId, makeId('AL'), hire.id, 'credit', allocation.credit, at],
    );
    await writeMovement(
      client,
      deskId,
      hire.id,
      [
        { account: 'clientMoney', amount: allocation.credit, description },
        { account: 'hireIncome', amount: -allocation.credit, description },
      ],
      at,
    );
  }
}

export async function bringInStatement(
  deskId: string,
  previewId: string,
  rows: StatementRow[],
): Promise<{ broughtIn: number }> {
  return inTransaction(async (client) => {
    const marked = await client.query('select brought_in from statement_previews where desk_id = $1 and id = $2', [
      deskId,
      previewId,
    ]);
    if (marked.rows[0]?.brought_in) return { broughtIn: 0 };
    await client.query('update statement_previews set brought_in = true where desk_id = $1 and id = $2', [
      deskId,
      previewId,
    ]);
    const seen = await seenRowKeys(deskId);
    let broughtIn = 0;
    const at = Date.now();
    for (const row of rows) {
      const key = statementRowKey(row);
      if (seen.has(key) || !row.reference) continue;
      const hire = await loadHire(deskId, row.reference);
      if (!hire) continue;
      await client.query(
        `insert into statement_rows (desk_id, id, row_key, date, description, amount, balance, reference, hire_id, at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [deskId, makeId('SR'), key, row.date, row.description, row.amount, row.balance, row.reference, hire.id, at],
      );
      seen.add(key);
      await takePayment(client, deskId, hire, row.amount, row.description, at);
      broughtIn += 1;
    }
    return { broughtIn };
  });
}

/** A charge accepted is plus on operator owed and minus on hire income, once. */
export async function acceptCharges(
  deskId: string,
  runId: string,
  vehicleId: string,
  hireId: string,
): Promise<{ added: Pennies }> {
  return inTransaction(async (client) => {
    const rows = await client.query<{ id: string; amount: number }>(
      'select id, amount from charges where desk_id = $1 and run_id = $2 and accepted = false for update',
      [deskId, runId],
    );
    const added = rows.rows.reduce((sum, row) => sum + Number(row.amount), 0);
    if (rows.rows.length === 0) return { added: 0 };
    await client.query('update charges set accepted = true where desk_id = $1 and run_id = $2 and accepted = false', [
      deskId,
      runId,
    ]);
    await client.query('update vehicles set extra_charges = extra_charges + $3 where desk_id = $1 and id = $2', [
      deskId,
      vehicleId,
      added,
    ]);
    if (added !== 0) {
      await writeMovement(
        client,
        deskId,
        hireId,
        [
          { account: 'operatorOwed', amount: added, vehicleId, description: 'Charge accepted' },
          { account: 'hireIncome', amount: -added, vehicleId, description: 'Charge accepted' },
        ],
        Date.now(),
      );
    }
    return { added };
  });
}

export async function addSecondDriverCharge(
  deskId: string,
  runId: string,
  vehicleId: string,
  hireId: string,
  charge: Pennies,
): Promise<boolean> {
  return inTransaction(async (client) => {
    const run = await client.query<{ second_driver: boolean }>(
      'select second_driver from runs where desk_id = $1 and id = $2 for update',
      [deskId, runId],
    );
    if (run.rows[0]?.second_driver) return false;
    await client.query('update runs set second_driver = true where desk_id = $1 and id = $2', [deskId, runId]);
    await client.query('update vehicles set extra_charges = extra_charges + $3 where desk_id = $1 and id = $2', [
      deskId,
      vehicleId,
      charge,
    ]);
    await writeMovement(
      client,
      deskId,
      hireId,
      [
        { account: 'operatorOwed', amount: charge, vehicleId, description: 'Second driver' },
        { account: 'hireIncome', amount: -charge, vehicleId, description: 'Second driver' },
      ],
      Date.now(),
    );
    return true;
  });
}

/** A refund falling due is plus on hire income and minus on refunds due. */
export async function recordRefundDue(
  client: PoolClient,
  deskId: string,
  hireId: string,
  vehicleId: string,
  amount: Pennies,
  at: number,
): Promise<void> {
  if (amount <= 0) return;
  await writeMovement(
    client,
    deskId,
    hireId,
    [
      { account: 'hireIncome', amount, vehicleId, description: 'Refund due' },
      { account: 'refundsDue', amount: -amount, vehicleId, description: 'Refund due' },
    ],
    at,
  );
}

/** A refund paid is minus on client money and plus on refunds due. */
export async function recordRefundPaid(
  deskId: string,
  hireId: string,
  vehicleId: string,
  amount: Pennies,
): Promise<void> {
  await inTransaction(async (client) => {
    await writeMovement(
      client,
      deskId,
      hireId,
      [
        { account: 'clientMoney', amount: -amount, vehicleId, description: 'Refund paid' },
        { account: 'refundsDue', amount, vehicleId, description: 'Refund paid' },
      ],
      Date.now(),
    );
  });
}
