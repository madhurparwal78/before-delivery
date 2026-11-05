import { CycleRow, all, one, run, tx } from "../db";
import { config } from "../db";
import { centsToMoney } from "../money";

export interface QueuedNotice {
  householdCode: string;
}

/** Queues the short-shipment notice for each affected household at once. */
export function queueShortNotices(c: CycleRow, productId: string, shortId: number, affected: { pledger: string; short_units: number; credit_cents: number }[]): void {
  const caseName = one<{ case_name: string }>("SELECT case_name FROM products WHERE id = ?", productId)!.case_name;
  tx(() => {
    for (const a of affected) {
      const hh = one<{ code: string; name: string; email: string }>("SELECT * FROM households WHERE code = ?", a.pledger);
      if (!hh) continue;
      const pledged = one<{ n: number }>(
        "SELECT units AS n FROM pledges WHERE cycle_id = ? AND product_id = ? AND household_code = ?",
        c.id, productId, a.pledger
      );
      run(
        `INSERT INTO emails (cycle_id, kind, household_code, to_email, subject, body, message_id, status, failed_attempts, endpoint, created_at)
         VALUES (?, 'short', ?, ?, ?, ?, ?, 'queued', 0, ?, ?)`,
        c.id,
        a.pledger,
        hh.email,
        `Short shipment: ${caseName}`,
        `${c.name}: ${a.short_units} of your ${pledged?.n ?? a.short_units} units of ${caseName} did not arrive. You will not be charged for them.`,
        `short-${shortId}-${a.pledger}@tare-and-tally.example`,
        config.mailEndpoint,
        Math.floor(Date.now() / 1000)
      );
    }
  });
}

export interface ReceiptLine {
  caseName: string;
  units: number;
  shareCents: number;
  shortUnits: number;
  shortCreditCents: number;
}

/** Queues one pickup receipt per pledging household at close. */
export function queueReceipt(c: CycleRow, householdCode: string, lines: ReceiptLine[], netCents: number, balanceCents: number): void {
  const hh = one<{ code: string; name: string; email: string }>("SELECT * FROM households WHERE code = ?", householdCode);
  if (!hh) return;
  const bodyLines: string[] = [`Pickup receipt for ${hh.name}, ${c.name}`];
  for (const l of lines) {
    let line = `${l.caseName}: ${l.units} units, ${centsToMoney(l.shareCents)}`;
    if (l.shortUnits > 0) {
      line += `, short ${l.shortUnits} units, credit ${centsToMoney(l.shortCreditCents)}`;
    }
    bodyLines.push(line);
  }
  bodyLines.push(`Charged this cycle: ${centsToMoney(netCents)}`);
  bodyLines.push(`New balance: ${centsToMoney(balanceCents)}`);
  run(
    `INSERT INTO emails (cycle_id, kind, household_code, to_email, subject, body, message_id, status, failed_attempts, endpoint, created_at)
     VALUES (?, 'receipt', ?, ?, ?, ?, ?, 'queued', 0, ?, ?)`,
    c.id,
    householdCode,
    hh.email,
    `Pickup receipt: ${c.name}`,
    bodyLines.join("\n"),
    `receipt-${c.id}-${householdCode}@tare-and-tally.example`,
    config.mailEndpoint,
    Math.floor(Date.now() / 1000)
  );
}
