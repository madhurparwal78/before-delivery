// Background work. Each job claims its rows in Postgres, so several processes sharing one
// database never expire, offer, remind, mail or settle the same thing twice.
import { many, tx } from "./db.js";
import { drainOutbox, enqueueMail } from "./mail.js";
import { retryPendingReceipts } from "./payments.js";
import { reminderDue, venueToday } from "./rules.js";
import { freshLedger } from "./views.js";

async function sendBalanceReminders(): Promise<void> {
  const due = reminderDue(venueToday(new Date()));
  if (!due) return;
  await tx(async (db) => {
    const seats = await many<{ id: string; bench: string; email: string }>(
      db,
      `SELECT r.id, r.bench, a.email FROM reservations r JOIN accounts a ON a.id = r.buyer_id
       WHERE r.state = 'deposit_paid' AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.dedupe_key = 'reminder-7:' || r.id)`,
    );
    for (const seat of seats) {
      await enqueueMail(db, `reminder-${due}:${seat.id}`, {
        to: seat.email,
        subject: `Balance reminder: ${due} days to pay for Bench ${seat.bench}`,
        body: `The balance for Bench ${seat.bench} is due on 19 March 2027.\n\nPay it from your account: /account\n\nOpaline Bench Days`,
      });
    }
  });
}

function every(milliseconds: number, job: () => Promise<void>): void {
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    job()
      .catch((error: unknown) => console.error(`background job failed: ${error instanceof Error ? error.message : "unknown error"}`))
      .finally(() => {
        running = false;
      });
  }, milliseconds).unref();
}

export function startWorkers(): void {
  every(1_000, () => freshLedger(new Date()));
  every(2_000, drainOutbox);
  every(2_000, retryPendingReceipts);
  every(20_000, sendBalanceReminders);
}
