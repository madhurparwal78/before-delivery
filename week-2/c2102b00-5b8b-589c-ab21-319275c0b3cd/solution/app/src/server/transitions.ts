// Cycle transitions and their guards, including the close: Kill Bill charges first, then every
// ledger movement, receipt and the closed status in one transaction.
import type { IncomingMessage } from "node:http";
import {
  applyEdit, checkRevision, cycleJson, cycleProducts, cycleRow, type CycleRow, type CycleStatus, effectiveStatus,
  etag, givenFields, readCycleFields, setStatus, visibleCycle,
} from "./cycles.js";
import { all, nowSeconds, one, run, transaction } from "./db.js";
import { ApiError, conflict, type Reply } from "./errors.js";
import { type Charge, pendingCharges, postCharges } from "./killbill.js";
import { objectExists } from "./storage.js";
import { balanceOf, householdAccount, movementTime, writeMovement } from "./ledger.js";
import { linePledges, lineRows, shortUnitsOn } from "./lines.js";
import { queueMail } from "./mail.js";
import { formatMoney } from "./money.js";
import { allow, type Viewer } from "./session.js";
import { sharesOf } from "./shares.js";
import { householdRow, households } from "./households.js";
import { allShortShares } from "./shorts.js";

const STATUSES: CycleStatus[] = ["draft", "open", "sealing", "ordered", "received", "breakdown", "closing", "closed"];
const CLOSE_RUNNING_SECONDS = 60;

const illegal = (from: CycleStatus, to: string) =>
  conflict("illegal_transition", `A cycle can't move from ${from} to ${to}.`);

/** The coordinator-requested moves: draft → open, sealing → ordered → received → breakdown. */
const NEXT: Partial<Record<CycleStatus, CycleStatus>> = { sealing: "ordered", ordered: "received", received: "breakdown" };

function cycleReply(id: string, viewer: Viewer): Reply {
  const c = cycleRow(id)!;
  return { status: 200, body: cycleJson(c, viewer), headers: { ETag: etag(c) } };
}

function requestedTarget(body: Record<string, unknown>): string {
  if (typeof body.to !== "string") throw new ApiError(422, "validation", "Some fields need fixing.", { to: "Name the status to move to." });
  return body.to;
}

/** Every transition except close. */
export function transition(viewer: Viewer, req: IncomingMessage, cycleId: string, body: Record<string, unknown>): Reply {
  const c = visibleCycle(cycleId, viewer);
  allow(viewer, "coordinator");
  const fields = givenFields(body);
  if (fields.length > 0) checkRevision(req, c);
  const to = requestedTarget(body);
  if (!STATUSES.includes(to as CycleStatus)) throw new ApiError(422, "validation", "Some fields need fixing.", { to: "That isn't a cycle status." });
  const status = effectiveStatus(c);
  if (to === "open" && status === "draft") {
    applyEdit(c, readCycleFields(body, c, "open", cycleProducts(c.id)));
    setStatus(c, "open");
    return cycleReply(c.id, viewer);
  }
  if (NEXT[status] !== to) throw illegal(status, to);
  if (to === "ordered") {
    const lines = lineRows(c.id);
    if (lines.some((l) => l.status === "filling")) throw conflict("unresolved_lines", "Drop or take up every unfilled case first.");
    if (lines.every((l) => l.status === "dropped")) throw conflict("nothing_to_order", "Every case was dropped; there is nothing to order.");
  }
  setStatus(c, to as CycleStatus);
  return cycleReply(c.id, viewer);
}

// ---- Close -------------------------------------------------------------------------------------

interface Settlement {
  pledger: string;
  caseName: string;
  units: number;
  share: number;
  shortUnits: number;
  credit: number;
}

/** Every pledger's share and short credit on every case that was ordered, in cycle order. */
function settlements(cycleId: string): Settlement[] {
  const found: Settlement[] = [];
  for (const line of lineRows(cycleId)) {
    if (line.status === "dropped") continue;
    const pledges = linePledges(cycleId, line.product_id);
    const shorts = allShortShares(pledges, line.price_cents, line.pack, shortUnitsOn(cycleId, line.product_id));
    for (const share of sharesOf(pledges, line.price_cents, line.pack)) {
      const short = shorts.get(share.pledger);
      found.push({
        pledger: share.pledger,
        caseName: line.case_name,
        units: share.units,
        share: share.share_cents,
        shortUnits: short?.short_units ?? 0,
        credit: short?.credit_cents ?? 0,
      });
    }
  }
  return found;
}

const chargeLabel = (c: CycleRow, caseName: string) => `${c.name}: ${caseName} [${c.id}]`;

/** The close is runnable: breakdown or closing, no other key holding it, an invoice recorded. */
function checkClosable(viewer: Viewer, cycleId: string, key: string): { cycle: CycleRow; invoiceKey: string } {
  const c = visibleCycle(cycleId, viewer);
  allow(viewer, "coordinator");
  const status = effectiveStatus(c);
  if (status !== "breakdown" && status !== "closing") throw illegal(status, "closed");
  if (c.close_key && c.close_key !== key && (c.close_started_at ?? 0) > nowSeconds() - CLOSE_RUNNING_SECONDS) {
    throw conflict("close_in_progress", "This cycle is already being closed.");
  }
  const invoice = one<{ key: string }>("SELECT key FROM documents WHERE cycle_id = ? AND kind = 'invoice'", c.id);
  if (!invoice) throw conflict("invoice_missing", "Upload the distributor invoice before closing.");
  return { cycle: c, invoiceKey: invoice.key };
}

/**
 * Steps 1 and 2: no other close is running and MinIO still holds the invoice, all before any state
 * or Kill Bill is touched. Step 3: the cycle is set to closing and the close lock is taken.
 */
async function startClose(viewer: Viewer, cycleId: string, key: string): Promise<CycleRow> {
  const { invoiceKey } = checkClosable(viewer, cycleId, key);
  if (!(await objectExists(invoiceKey))) throw conflict("invoice_missing", "Upload the distributor invoice before closing.");
  return transaction(() => {
    const { cycle } = checkClosable(viewer, cycleId, key);
    if (effectiveStatus(cycle) === "breakdown") setStatus(cycle, "closing");
    run("UPDATE cycles SET close_key = ?, close_started_at = ? WHERE id = ?", key, nowSeconds(), cycle.id);
    return cycleRow(cycle.id)!;
  });
}

function releaseClose(cycleId: string, key: string): void {
  transaction(() => run("UPDATE cycles SET close_key = NULL WHERE id = ? AND close_key = ?", cycleId, key));
}

/** Step 4: each household's positive net charge per case, posted to Kill Bill exactly once. */
async function postCloseCharges(c: CycleRow, rows: Settlement[]): Promise<void> {
  const byHousehold = new Map<string, Charge[]>();
  for (const s of rows) {
    if (s.pledger === "club" || s.share - s.credit <= 0) continue;
    byHousehold.set(s.pledger, [...(byHousehold.get(s.pledger) ?? []), { description: chargeLabel(c, s.caseName), cents: s.share - s.credit }]);
  }
  const plans: { accountId: string; missing: Charge[] }[] = [];
  for (const [code, charges] of byHousehold) {
    const plan = await pendingCharges(householdRow(code)!, charges);
    if (plan.mismatch) {
      throw conflict("charge_mismatch", `A charge for ${c.name} in billing doesn't match.`);
    }
    if (plan.missing.length > 0) plans.push(plan);
  }
  for (const plan of plans) await postCharges(plan.accountId, plan.missing);
}

/** Step 5, inside the stored-response transaction: movements, receipts and the closed status. */
function finishClose(viewer: Viewer, cycleId: string, rows: Settlement[]): Reply {
  const c = cycleRow(cycleId)!;
  const createdAt = movementTime();
  for (const s of rows) {
    const memo = `${c.name}: ${s.caseName}`;
    if (s.pledger === "club") {
      if (s.share - s.credit > 0) writeMovement("take_up_charge", memo, s.share - s.credit, "club:distributor", "club:stock", c.id, createdAt);
      continue;
    }
    const account = householdAccount(s.pledger);
    writeMovement("pledge_charge", memo, s.share, "club:distributor", account, c.id, createdAt);
    if (s.credit > 0) writeMovement("short_credit", memo, s.credit, account, "club:distributor", c.id, createdAt);
  }
  let queued = 0;
  for (const h of households()) {
    const mine = rows.filter((s) => s.pledger === h.code);
    if (mine.length === 0) continue;
    const net = mine.reduce((sum, s) => sum + s.share - s.credit, 0);
    const body = [
      `Pickup receipt for ${h.name}, ${c.name}`,
      ...mine.map(
        (s) =>
          `${s.caseName}: ${s.units} units, ${formatMoney(s.share)}` +
          (s.shortUnits > 0 ? `, short ${s.shortUnits} units, credit ${formatMoney(s.credit)}` : ""),
      ),
      `Charged this cycle: ${formatMoney(net)}`,
      `New balance: ${formatMoney(balanceOf(h.code))}`,
    ].join("\n");
    queueMail({
      kind: "receipt",
      cycleId: c.id,
      household: h.code,
      recipient: h.email,
      messageId: `receipt-${c.id}-${h.code}@tare-and-tally.example`,
      subject: `Pickup receipt: ${c.name}`,
      body,
    });
    queued++;
  }
  run("UPDATE cycles SET close_key = NULL WHERE id = ?", c.id);
  setStatus(c, "closed");
  const closed = cycleRow(c.id)!;
  return { status: 200, body: { cycle: cycleJson(closed, viewer), receipts_queued: queued }, headers: { ETag: etag(closed) } };
}

/** Requesting `closed` from breakdown or closing. Any failure leaves the cycle in closing. */
export async function closeCycle(viewer: Viewer, cycleId: string, key: string): Promise<() => Reply> {
  const c = await startClose(viewer, cycleId, key);
  const rows = settlements(c.id);
  try {
    await postCloseCharges(c, rows);
  } catch (error) {
    releaseClose(c.id, key);
    throw error;
  }
  return () => finishClose(viewer, c.id, rows);
}

/** Pickup receipts queued at close and whether SMTP has accepted each. */
export function receiptsOf(viewer: Viewer, cycleId: string): Reply {
  visibleCycle(cycleId, viewer);
  allow(viewer, "coordinator");
  const rows = all<{ household_code: string; recipient: string; status: string; failed_attempts: number }>(
    "SELECT household_code, recipient, status, failed_attempts FROM mail WHERE cycle_id = ? AND kind = 'receipt' ORDER BY household_code",
    cycleId,
  );
  return {
    status: 200,
    body: {
      receipts: rows.map((r) => ({
        household_code: r.household_code,
        email: r.recipient,
        status: r.status,
        failed_attempts: r.failed_attempts,
      })),
    },
  };
}

