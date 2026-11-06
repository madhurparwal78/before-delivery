import { db, writeTx } from '../db.ts';
import { conflict, storageUnavailable, paymentsPaused } from '../http/errors.ts';
import type { ApiResult } from '../http/context.ts';
import { toIsoSeconds } from '../domain/clubTime.ts';
import { householdAccount } from '../domain/credit.ts';
import { CLUB_PLEDGER } from '../domain/lines.ts';
import { shareOfUnit } from '../domain/shares.ts';
import { formatDollars } from '../../shared/money.ts';
import * as killbill from '../providers/killbill.ts';
import { PaymentsUnavailableError } from '../providers/killbill.ts';
import { StorageUnavailableError, objectExists } from '../providers/storage.ts';
import { deliverQueuedSoon, queueMail } from '../providers/mailQueue.ts';
import {
  balanceCents,
  buildCycle,
  getCycleRow,
  getHousehold,
  listLineRows,
  listPledges,
  listProducts,
  shortUnitNumbers,
  type CycleRow,
  type Viewer,
} from '../store.ts';

const LOCK_STALE_MS = 60_000;

interface CaseCharge {
  productId: string;
  caseName: string;
  units: number;
  shareCents: number;
  shortUnits: number;
  creditCents: number;
  netCents: number;
}

interface PledgerCharges {
  pledger: string;
  cases: CaseCharge[];
}

/** Every household's and the club's money for one cycle, derived from its lines. */
function chargesFor(cycle: CycleRow): PledgerCharges[] {
  const products = new Map(listProducts().map((product) => [product.id, product]));
  const byPledger = new Map<string, CaseCharge[]>();
  for (const lineRow of listLineRows(cycle.id)) {
    if (lineRow.status === 'dropped') continue;
    const product = products.get(lineRow.product_id)!;
    const pledges = listPledges(cycle.id, product.id);
    const shorts = shortUnitNumbers(cycle.id, product.id);
    let unit = 1;
    for (const pledge of pledges) {
      let shareCents = 0;
      let creditCents = 0;
      let shortUnits = 0;
      for (let index = 0; index < pledge.units; index += 1) {
        const unitNumber = unit + index;
        const unitShare = shareOfUnit(product.price_cents, product.pack, unitNumber);
        shareCents += unitShare;
        if (shorts.has(unitNumber)) {
          creditCents += unitShare;
          shortUnits += 1;
        }
      }
      unit += pledge.units;
      const list = byPledger.get(pledge.pledger) ?? [];
      list.push({
        productId: product.id,
        caseName: product.case_name,
        units: pledge.units,
        shareCents,
        shortUnits,
        creditCents,
        netCents: shareCents - creditCents,
      });
      byPledger.set(pledge.pledger, list);
    }
  }
  return [...byPledger.entries()].map(([pledger, cases]) => ({ pledger, cases }));
}

function acquireLock(cycleId: string, key: string): void {
  writeTx(() => {
    const row = db.prepare('SELECT idempotency_key, started_at FROM close_locks WHERE cycle_id = ?').get(cycleId) as
      | { idempotency_key: string; started_at: number }
      | undefined;
    if (row && row.idempotency_key !== key && Date.now() - row.started_at < LOCK_STALE_MS) {
      throw conflict('close_in_progress', 'A close of this cycle is already running.');
    }
    db.prepare(
      'INSERT INTO close_locks (cycle_id, idempotency_key, started_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT (cycle_id) DO UPDATE SET idempotency_key = excluded.idempotency_key, started_at = excluded.started_at',
    ).run(cycleId, key, Date.now());
  });
}

function releaseLock(cycleId: string, key: string): void {
  writeTx(() => {
    db.prepare('DELETE FROM close_locks WHERE cycle_id = ? AND idempotency_key = ?').run(cycleId, key);
  });
}

async function confirmInvoice(cycleId: string): Promise<void> {
  const document = db
    .prepare("SELECT key FROM documents WHERE cycle_id = ? AND kind = 'invoice'")
    .get(cycleId) as { key: string } | undefined;
  if (!document) throw conflict('invoice_missing', 'Upload the distributor invoice before closing.');
  try {
    const exists = await objectExists(document.key);
    if (!exists) throw conflict('invoice_missing', 'Upload the distributor invoice before closing.');
  } catch (error) {
    if (error instanceof StorageUnavailableError) throw storageUnavailable();
    throw error;
  }
}

interface WantedCharge {
  description: string;
  storable: string;
  amountCents: number;
}

/** The items each household still needs, judged against what Kill Bill already holds. */
async function missingCharges(accountId: string, wanted: WantedCharge[]): Promise<WantedCharge[]> {
  const existing = await killbill.listExternalCharges(accountId);
  const missing: WantedCharge[] = [];
  for (const item of wanted) {
    const matches = existing.filter(
      (charge) => charge.description === item.description || charge.description === item.storable,
    );
    if (matches.length === 0) {
      missing.push(item);
      continue;
    }
    if (!matches.some((charge) => charge.amountCents === item.amountCents)) {
      throw conflict('charge_mismatch', 'A charge for this cycle in billing does not match.');
    }
  }
  return missing;
}

async function postCharges(cycle: CycleRow, charges: PledgerCharges[]): Promise<void> {
  for (const entry of charges) {
    if (entry.pledger === CLUB_PLEDGER) continue;
    const wanted: WantedCharge[] = entry.cases
      .filter((item) => item.netCents > 0)
      .map((item) => {
        const description = killbill.chargeDescription(cycle.name, item.caseName, cycle.id);
        return { description, storable: killbill.storableDescription(description), amountCents: item.netCents };
      });
    if (wanted.length === 0) continue;
    const household = getHousehold(entry.pledger)!;
    const accountId = await killbill.ensureAccount(household);
    const missing = await missingCharges(accountId, wanted);
    if (missing.length === 0) continue;
    try {
      await killbill.postExternalCharges(
        accountId,
        missing.map((item) => ({ description: item.description, amountCents: item.amountCents })),
      );
    } catch (error) {
      const needsStorableForm = missing.some((item) => item.storable !== item.description);
      if (!(error instanceof PaymentsUnavailableError) || !needsStorableForm) throw error;
      const stillMissing = await missingCharges(accountId, wanted);
      if (stillMissing.length === 0) continue;
      await killbill.postExternalCharges(
        accountId,
        stillMissing.map((item) => ({ description: item.storable, amountCents: item.amountCents })),
      );
    }
  }
}

function writeLedgerAndReceipts(cycle: CycleRow, charges: PledgerCharges[]): number {
  const createdAt = toIsoSeconds(new Date());
  let receipts = 0;
  const lineOrder = listLineRows(cycle.id).map((line) => line.product_id);
  for (const entry of charges) {
    if (entry.pledger === CLUB_PLEDGER) {
      for (const item of entry.cases) {
        const amount = item.netCents;
        if (amount === 0) continue;
        insertMovement('take_up_charge', cycle, item.caseName, createdAt, [
          { account: 'club:stock', amount_cents: -amount },
          { account: 'club:distributor', amount_cents: amount },
        ]);
      }
      continue;
    }
    for (const item of entry.cases) {
      if (item.shareCents > 0) {
        insertMovement('pledge_charge', cycle, item.caseName, createdAt, [
          { account: householdAccount(entry.pledger), amount_cents: -item.shareCents },
          { account: 'club:distributor', amount_cents: item.shareCents },
        ]);
      }
      if (item.creditCents > 0) {
        insertMovement('short_credit', cycle, item.caseName, createdAt, [
          { account: householdAccount(entry.pledger), amount_cents: item.creditCents },
          { account: 'club:distributor', amount_cents: -item.creditCents },
        ]);
      }
    }
    const household = getHousehold(entry.pledger)!;
    const ordered = [...entry.cases].sort(
      (left, right) => lineOrder.indexOf(left.productId) - lineOrder.indexOf(right.productId),
    );
    const net = ordered.reduce((total, item) => total + item.netCents, 0);
    const lines = [`Pickup receipt for ${household.name}, ${cycle.name}`];
    for (const item of ordered) {
      const short =
        item.shortUnits > 0 ? `, short ${item.shortUnits} units, credit $${formatDollars(item.creditCents)}` : '';
      lines.push(`${item.caseName}: ${item.units} units, $${formatDollars(item.shareCents)}${short}`);
    }
    lines.push(`Charged this cycle: $${formatDollars(net)}`);
    lines.push(`New balance: $${formatDollars(balanceCents(entry.pledger))}`);
    queueMail({
      kind: 'receipt',
      cycleId: cycle.id,
      householdCode: entry.pledger,
      to: household.email,
      subject: `Pickup receipt: ${cycle.name}`,
      body: lines.join('\n'),
      messageId: `<receipt-${cycle.id}-${entry.pledger}@tare-and-tally.example>`,
    });
    receipts += 1;
  }
  return receipts;
}

function insertMovement(
  kind: string,
  cycle: CycleRow,
  caseName: string,
  createdAt: string,
  legs: { account: string; amount_cents: number }[],
): void {
  const info = db
    .prepare('INSERT INTO movements (kind, cycle_id, memo, created_at) VALUES (?, ?, ?, ?)')
    .run(kind, cycle.id, `${cycle.name}: ${caseName}`, createdAt);
  const movementId = Number(info.lastInsertRowid);
  const insertLeg = db.prepare('INSERT INTO legs (movement_id, account, amount_cents) VALUES (?, ?, ?)');
  for (const leg of legs) insertLeg.run(movementId, leg.account, leg.amount_cents);
}

export async function closeCycle(
  cycle: CycleRow,
  viewer: Viewer,
  idempotencyKey: string,
  nowMs: number,
): Promise<ApiResult> {
  acquireLock(cycle.id, idempotencyKey);
  try {
    await confirmInvoice(cycle.id);
    writeTx(() => {
      db.prepare("UPDATE cycles SET status = 'closing', revision = revision + 1 WHERE id = ? AND status = 'breakdown'").run(
        cycle.id,
      );
    });
    const charges = chargesFor(cycle);
    try {
      await postCharges(cycle, charges);
    } catch (error) {
      if (error instanceof PaymentsUnavailableError) throw paymentsPaused();
      throw error;
    }
    const receiptsQueued = writeTx(() => {
      const queued = writeLedgerAndReceipts(cycle, charges);
      db.prepare("UPDATE cycles SET status = 'closed', revision = revision + 1 WHERE id = ?").run(cycle.id);
      return queued;
    });
    deliverQueuedSoon();
    const closed = getCycleRow(cycle.id)!;
    return {
      status: 200,
      body: { cycle: buildCycle(closed, viewer, nowMs), receipts_queued: receiptsQueued },
      headers: { ETag: `"r${closed.revision}"` },
    };
  } finally {
    releaseLock(cycle.id, idempotencyKey);
  }
}
