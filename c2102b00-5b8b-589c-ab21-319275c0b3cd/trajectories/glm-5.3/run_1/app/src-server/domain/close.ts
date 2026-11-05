import { CycleRow, one, run, tx } from "../db";
import { errors } from "../errors";
import { cycle, cycleProducts, product } from "./club";
import { shortSummary } from "./shorts";
import { lineShares } from "./pledge";
import { creditOf, writeMovement } from "./ledger";
import { queueReceipt, ReceiptLine } from "./mail";
import { deliverSoon } from "../providers/mailworker";
import { createAccount, ensurePaymentMethod, findAccount, listInvoices, postCharges, KbCharge } from "../providers/killbill";
import { centsToDollarsString, dollarsNumberToCents } from "../money";
import { config } from "../db";
import * as s3 from "../providers/s3";
import { documentRecord } from "./documents";
import { acquireCloseLease, releaseCloseLease } from "../util/idem";

export interface CloseOutcome {
  receiptsQueued: number;
}

interface HouseholdCaseNet {
  shareCents: number;
  shortCreditCents: number;
  netCents: number;
}

/** Per household and case: share, short credit and net charge. */
export function netCharges(c: CycleRow): Map<string, Map<string, HouseholdCaseNet>> {
  const byHousehold = new Map<string, Map<string, HouseholdCaseNet>>();
  for (const p of cycleProducts(c.id)) {
    const ln = one<{ status: string }>("SELECT status FROM lines WHERE cycle_id = ? AND product_id = ?", c.id, p.id)!;
    if (ln.status === "dropped") continue;
    const shares = lineShares(c, p.id);
    for (const sh of shares.shares) {
      const short = shortSummary(c.id, p.id, sh.pledger);
      const cases = byHousehold.get(sh.pledger) ?? new Map<string, HouseholdCaseNet>();
      cases.set(p.id, { shareCents: sh.share_cents, shortCreditCents: short.creditCents, netCents: sh.share_cents - short.creditCents });
      byHousehold.set(sh.pledger, cases);
    }
  }
  return byHousehold;
}

/**
 * The close pipeline: invoice confirmation, Kill Bill charges, then one
 * transaction of movements, receipts and the closed state.
 */
export async function closeCycle(c: CycleRow): Promise<CloseOutcome> {
  if (!acquireCloseLease(c.id)) throw errors.closeInProgress();
  try {
    const current = cycle(c.id)!;
    if (current.status !== "breakdown" && current.status !== "closing") {
      throw errors.illegalTransition();
    }
    // 1. Confirm the invoice with MinIO before touching state or Kill Bill.
    const record = documentRecord(c.id, "invoice");
    if (!record) throw errors.invoiceMissing();
    const stat = await s3.statObject(record.key);
    if (!stat.exists) throw errors.invoiceMissing();

    // 2. Enter closing (revision +1), once.
    tx(() => {
      const cyc = one<CycleRow>("SELECT * FROM cycles WHERE id = ?", c.id)!;
      if (cyc.status === "breakdown") {
        run("UPDATE cycles SET status = 'closing', revision = revision + 1 WHERE id = ?", c.id);
      }
    });

    // 3. Post Kill Bill charges, skipping ones already there.
    await postCloseCharges(c);

    // 4. One transaction: movements, receipts, closed state.
    const receiptsQueued = tx(() => {
      const cyc = one<CycleRow>("SELECT * FROM cycles WHERE id = ?", c.id)!;
      if (cyc.status !== "closing") throw errors.illegalTransition();
      const nowSec = Math.floor(Date.now() / 1000);
      const nets = netCharges(cyc);

      for (const [householdCode, cases] of nets) {
        if (householdCode === "club") continue;
        for (const [productId, net] of cases) {
          const p = product(productId)!;
          const memo = `${cyc.name}: ${p.case_name}`;
          writeMovement(householdCode, "pledge_charge", cyc.id, memo, nowSec, "club:distributor", `household:${householdCode}`, net.shareCents);
          if (net.shortCreditCents > 0) {
            writeMovement(householdCode, "short_credit", cyc.id, memo, nowSec, `household:${householdCode}`, "club:distributor", net.shortCreditCents);
          }
        }
      }
      for (const p of cycleProducts(cyc.id)) {
        const ln = one<{ status: string }>("SELECT status FROM lines WHERE cycle_id = ? AND product_id = ?", cyc.id, p.id)!;
        if (ln.status !== "taken_up") continue;
        const shares = lineShares(cyc, p.id);
        const clubShare = shares.shares.find((s) => s.pledger === "club");
        if (!clubShare) continue;
        const clubNet = clubShare.share_cents - shortSummary(cyc.id, p.id, "club").creditCents;
        const memo = `${cyc.name}: ${p.case_name}`;
        writeMovement("club", "take_up_charge", cyc.id, memo, nowSec, "club:distributor", "club:stock", clubNet);
      }

      // Receipts, one per pledging household on a case that was not dropped.
      let queued = 0;
      for (const [householdCode, cases] of nets) {
        if (householdCode === "club" || cases.size === 0) continue;
        const lines: ReceiptLine[] = [];
        let netTotal = 0;
        for (const p of cycleProducts(cyc.id)) {
          const info = cases.get(p.id);
          if (!info) continue;
          const pledged = one<{ n: number }>(
            "SELECT units AS n FROM pledges WHERE cycle_id = ? AND product_id = ? AND household_code = ?",
            cyc.id, p.id, householdCode
          )?.n ?? 0;
          const short = shortSummary(cyc.id, p.id, householdCode);
          lines.push({
            caseName: p.case_name,
            units: pledged,
            shareCents: info.shareCents,
            shortUnits: short.units,
            shortCreditCents: short.creditCents,
          });
          netTotal += info.netCents;
        }
        const balance = creditOf(householdCode).balance_cents;
        queueReceipt(cyc, householdCode, lines, netTotal, balance);
        queued += 1;
      }
      run("UPDATE cycles SET status = 'closed', revision = revision + 1 WHERE id = ?", cyc.id);
      return queued;
    });
    deliverSoon();
    return { receiptsQueued };
  } finally {
    releaseCloseLease(c.id);
  }
}

async function postCloseCharges(c: CycleRow): Promise<void> {
  const nets = netCharges(c);
  const households = [...nets.keys()].filter((h) => h !== "club");
  const accountIds = new Map<string, string>();
  for (const hh of households) {
    let accountId = await findAccount(`${config.kbKeyPrefix}-${hh}`);
    if (accountId === null) {
      const row = one<{ name: string; email: string }>("SELECT * FROM households WHERE code = ?", hh);
      if (!row) continue;
      accountId = await createAccount(`${config.kbKeyPrefix}-${hh}`, row.name, row.email);
      await ensurePaymentMethod(accountId);
    }
    accountIds.set(hh, accountId);
  }
  for (const hh of households) {
    const accountId = accountIds.get(hh);
    if (!accountId) continue;
    const invoices = await listInvoices(accountId);
    const existing = new Map<string, number | null>();
    for (const inv of invoices) {
      for (const item of inv.items) {
        if (item.itemType === "EXTERNAL_CHARGE" && item.description) {
          existing.set(item.description, dollarsNumberToCents(item.amount));
        }
      }
    }
    const toPost: KbCharge[] = [];
    for (const [productId, net] of nets.get(hh)!) {
      if (net.netCents <= 0) continue;
      const p = product(productId)!;
      const description = `${c.name}: ${p.case_name} [${c.id}]`;
      const already = existing.get(description);
      if (already !== undefined) {
        if (already !== net.netCents) throw errors.chargeMismatch();
        continue; // already posted on a COMMITTED invoice
      }
      toPost.push({ amount: centsToDollarsString(net.netCents), description });
    }
    if (toPost.length > 0) {
      await postCharges(accountId, toPost);
    }
  }
}
