// Background work: membership activation, mail delivery, due-tomorrow reminders and provider probes.
import { config } from "./config.js";
import { pool, rows, transaction } from "./db.js";
import { addDays } from "./domain/time.js";
import { dueBy, loadCalendar, today } from "./domain/calendar.js";
import { deliverMail, queueMail } from "./providers/mail.js";
import { ensureAccount, ensureCatalog, ensureSubscription, probeBilling, settleFirstInvoice, type Tier } from "./providers/killbill.js";
import { onServiceUp, startProbe } from "./providers/status.js";
import { probeStorage } from "./providers/storage.js";

/** Brings one pending membership forward in Kill Bill: account, subscription and first payment, reusing
 * whatever an earlier attempt left there; marks it active once Kill Bill shows it ACTIVE and paid. */
export async function syncMembership(userId: number): Promise<void> {
  try {
    await transaction(async (client) => {
      const locked = await rows<{ ok: boolean }>(client, `SELECT pg_try_advisory_xact_lock(2, $1) AS ok`, [userId]);
      if (!locked[0]!.ok) return;
      const [member] = await rows<{
        name: string;
        email: string;
        tier: Tier;
        status: string;
        killbill_account_id: string | null;
        killbill_subscription_id: string | null;
      }>(
        client,
        `SELECT u.name, u.email, m.tier, m.status, m.killbill_account_id, m.killbill_subscription_id
         FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.user_id = $1`,
        [userId],
      );
      if (!member || member.status !== "pending-payment") return;
      const accountId = member.killbill_account_id ?? (await ensureAccount(member.name, member.email));
      const subscriptionId = member.killbill_subscription_id ?? (await ensureSubscription(accountId, member.tier));
      const active = await settleFirstInvoice(accountId, subscriptionId);
      await client.query(
        `UPDATE memberships SET killbill_account_id = $2, killbill_subscription_id = $3, status = $4 WHERE user_id = $1`,
        [userId, accountId, subscriptionId, active ? "active" : "pending-payment"],
      );
    });
  } catch (error) {
    console.error(`membership sync for user ${userId}:`, error instanceof Error ? error.message : error);
  }
}

export function kickMembershipSync(userId: number): void {
  setTimeout(() => void syncMembership(userId), 300).unref();
}

let catalogReady = false;

/** One process at a time checks for the tenant's catalog and uploads it, so racing starts upload it once. */
function uploadCatalog(): Promise<void> {
  return transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(5)");
    await ensureCatalog();
  }).then(
    () => void (catalogReady = true),
    () => void (catalogReady = false),
  );
}

async function syncPendingMemberships(): Promise<void> {
  const pending = await rows<{ user_id: number }>(pool, `SELECT user_id FROM memberships WHERE status = 'pending-payment' ORDER BY user_id`);
  if (pending.length > 0 && !catalogReady) await uploadCatalog();
  for (const { user_id } of pending) await syncMembership(user_id);
}

/** One reminder per out loan and due date, on the library day before it is due. */
async function sweepReminders(): Promise<void> {
  const calendar = await loadCalendar(pool);
  const tomorrow = addDays(today(calendar, Date.now()), 1);
  const due = await rows<{ id: number }>(pool, `SELECT id FROM loans WHERE status = 'out' AND due_date = $1`, [tomorrow]);
  for (const { id } of due) {
    await transaction(async (client) => {
      const claimed = await client.query(
        `INSERT INTO reminders (loan_id, due_date) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [id, tomorrow],
      );
      if (!claimed.rowCount) return;
      const [loan] = await rows<{ ref: string; email: string; name: string }>(
        client,
        `SELECT l.ref, u.email, u.name FROM loans l JOIN users u ON u.id = l.member_id WHERE l.id = $1`,
        [id],
      );
      const items = await rows<{ name: string; tag: string }>(
        client,
        `SELECT i.name, i.tag FROM loan_items li JOIN items i ON i.id = li.item_id WHERE li.loan_id = $1 ORDER BY li.position`,
        [id],
      );
      await queueMail(
        client,
        loan!.email,
        `Due tomorrow at Pegworth: ${loan!.ref}`,
        [
          `Hello ${loan!.name},`,
          "",
          `Loan ${loan!.ref} is due back tomorrow, ${tomorrow}, by ${dueBy(calendar, tomorrow)}.`,
          "",
          ...items.map((item) => `- ${item.name} (${item.tag})`),
          "",
          "Pegworth Desk",
        ].join("\n"),
      );
    });
  }
  kickMail();
}

function every(milliseconds: number, work: () => Promise<void>): void {
  const run = async () => {
    try {
      await work();
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
    }
    setTimeout(run, milliseconds).unref();
  };
  void run();
}

/** Delivers queued mail right after a commit that queued some. */
export function kickMail(): void {
  setTimeout(() => void deliverMail().catch(() => undefined), 10).unref();
}

export function startWorkers(): void {
  startProbe("storage", probeStorage);
  startProbe("billing", probeBilling);
  void uploadCatalog();
  onServiceUp((service) => {
    if (service === "billing") void uploadCatalog();
  });
  every(2000, syncPendingMemberships);
  every(2000, deliverMail);
  every(config.reminderSweepSeconds * 1000, sweepReminders);
}
