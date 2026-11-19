import { env } from './env';
import { startHttpServer } from './http/server';
import { refreshMembershipFromBilling } from './http/routes/membership';
import { addDays, today } from '../shared/time';
import { applySchema, CATALOG_LOCK, pool, waitForDatabase, withAdvisoryLock } from './repo/db';
import { readCalendar } from './repo/calendar';
import { readLoanItems } from './repo/loans';
import { seedDatabase } from './repo/seed';
import {
  listEndingMemberships,
  listPendingMemberships,
  markMembershipLapsed,
  recordBillingIds,
} from './repo/users';
import {
  ensureAccount,
  ensureCatalog,
  ensureFirstYearPayment,
  ensureSubscription,
} from './services/killbill';
import { queueMail, reminderMail, startMailWorker } from './services/mail';
import { startServiceProbes } from './services/status';

const MEMBERSHIP_SWEEP_MS = 5000;
const CATALOG_SWEEP_MS = 30000;

/** Gives every membership its Kill Bill account, subscription and first payment. */
async function provisionMemberships(): Promise<void> {
  const pending = await listPendingMemberships(pool);
  for (const membership of pending) {
    const user = await pool.query<{ name: string; email: string }>(
      'select name, email from users where id = $1',
      [membership.user_id],
    );
    const person = user.rows[0];
    if (!person) continue;
    try {
      const accountId =
        membership.killbill_account_id ?? (await ensureAccount(person.email, person.name));
      const subscriptionId =
        membership.killbill_subscription_id ??
        (await ensureSubscription(accountId, membership.tier));
      if (
        membership.killbill_account_id !== accountId ||
        membership.killbill_subscription_id !== subscriptionId
      ) {
        await recordBillingIds(pool, membership.user_id, accountId, subscriptionId);
      }
      await ensureFirstYearPayment(accountId, subscriptionId);
    } catch {
      continue;
    }
    await refreshMembershipFromBilling(membership.user_id);
  }
}

/** A membership reads as lapsed from the first library-local day after its term. */
async function lapseFinishedMemberships(): Promise<void> {
  const calendar = await readCalendar(pool);
  const libraryToday = today(calendar.timeZone, new Date());
  for (const membership of await listEndingMemberships(pool)) {
    if (membership.active_until !== null && libraryToday > membership.active_until) {
      await markMembershipLapsed(pool, membership.user_id);
    }
  }
}

async function sweepMemberships(): Promise<void> {
  await provisionMemberships();
  await lapseFinishedMemberships();
}

/** One reminder per out loan whose due date is tomorrow in library time. */
async function sweepReminders(): Promise<void> {
  const calendar = await readCalendar(pool);
  const tomorrow = addDays(today(calendar.timeZone, new Date()), 1);
  const loans = await pool.query<{ id: number; ref: string; email: string }>(
    `select l.id, l.ref, u.email from loans l join users u on u.id = l.member_id
     where l.status = 'out' and l.due_date = $1`,
    [tomorrow],
  );
  for (const loan of loans.rows) {
    const claimed = await pool.query(
      `insert into reminders_sent (loan_id, due_date) values ($1, $2)
       on conflict do nothing returning loan_id`,
      [loan.id, tomorrow],
    );
    if (claimed.rows.length === 0) continue;
    const items = await readLoanItems(pool, loan.id);
    const message = reminderMail(
      loan.ref,
      items,
      tomorrow,
      calendar.closingTimeFor(tomorrow) ?? '',
    );
    const client = await pool.connect();
    try {
      await client.query('begin');
      await queueMail(
        client,
        `reminder:${loan.id}:${tomorrow}`,
        loan.email,
        message.subject,
        message.body,
      );
      await client.query('commit');
    } finally {
      client.release();
    }
  }
}

function repeat(work: () => Promise<void>, intervalMs: number): void {
  const tick = (): void => {
    work()
      .catch((error: unknown) => process.stderr.write(`${String(error)}\n`))
      .finally(() => setTimeout(tick, intervalMs));
  };
  tick();
}

async function boot(): Promise<void> {
  startHttpServer(env.port);
  await waitForDatabase();
  await applySchema();
  await seedDatabase();
  startServiceProbes();
  startMailWorker();
  repeat(async () => {
    await withAdvisoryLock(CATALOG_LOCK, ensureCatalog);
  }, CATALOG_SWEEP_MS);
  repeat(sweepMemberships, MEMBERSHIP_SWEEP_MS);
  repeat(sweepReminders, env.reminderSweepSeconds * 1000);
}

void boot().catch((error: unknown) => {
  process.stderr.write(`Pegworth failed to start: ${String(error)}\n`);
  process.exitCode = 1;
});

process.on('SIGTERM', () => {
  void pool.end().finally(() => process.exit(0));
});
