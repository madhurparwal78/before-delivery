import { confirmPendingChanges } from '../app/changes.js';
import { runDueDunningSteps } from '../app/dunning.js';
import { publishStockLevels } from '../app/live.js';
import { confirmPendingRefunds } from '../app/refunds.js';
import { chargeNewRenewalInvoices, finishStoredRenewalOrders } from '../app/renewals.js';
import { upcomingRenewalMail } from '../app/emails.js';
import { readSubscription } from '../app/subscriptionView.js';
import { releaseExpiredHolds } from '../db/cart.js';
import { claimOutbox, markMailSent, releaseMailClaim } from '../db/outbox.js';
import { forgetExpiredAttempts } from '../db/attempts.js';
import {
  claimUpcomingRenewalNotice,
  listAllSubscriptions,
} from '../db/subscriptions.js';
import { queueMail } from '../db/outbox.js';
import { changeCutoffInstant } from '../../shared/subscription.js';
import { env } from '../env.js';
import { sendMail } from '../services/smtp.js';

/** Sends the outbox. Each message is claimed first, so it is sent exactly once. */
async function sendOutbox(): Promise<void> {
  for (const mail of await claimOutbox(10)) {
    try {
      await sendMail({ to: mail.to_email, subject: mail.subject, body: mail.body });
      await markMailSent(mail.id);
    } catch {
      await releaseMailClaim(mail.id);
      return;
    }
  }
}

/** One upcoming-renewal email per cycle, once that cycle's change cutoff has passed. */
async function sendUpcomingRenewalNotices(): Promise<void> {
  for (const record of await listAllSubscriptions()) {
    const reading = await readSubscription(record);
    if (reading === null) continue;
    const renewalDate = reading.payload.next_renewal_date;
    if (renewalDate === null) continue;
    if (reading.payload.state === 'cancelled') continue;
    const cutoff = changeCutoffInstant(renewalDate, env.timing.changeCutoffHours);
    if (Date.now() < cutoff.getTime()) continue;
    if (!(await claimUpcomingRenewalNotice(record.id, renewalDate))) continue;
    await queueMail(upcomingRenewalMail(record, renewalDate));
  }
}

interface ScheduledJob {
  name: string;
  everyMs: number;
  run: () => Promise<void>;
}

const JOBS: readonly ScheduledJob[] = [
  {
    name: 'release expired holds',
    everyMs: 1_000,
    run: async () => {
      const released = await releaseExpiredHolds();
      if (released.length > 0) await publishStockLevels();
    },
  },
  { name: 'send outbox', everyMs: 2_000, run: sendOutbox },
  { name: 'confirm change requests', everyMs: 2_000, run: confirmPendingChanges },
  { name: 'confirm refunds', everyMs: 2_000, run: confirmPendingRefunds },
  { name: 'charge renewal invoices', everyMs: 5_000, run: chargeNewRenewalInvoices },
  { name: 'finish renewal orders', everyMs: 10_000, run: finishStoredRenewalOrders },
  { name: 'run dunning steps', everyMs: 2_000, run: runDueDunningSteps },
  { name: 'send upcoming renewal notices', everyMs: 15_000, run: sendUpcomingRenewalNotices },
  { name: 'forget expired checkout keys', everyMs: 600_000, run: forgetExpiredAttempts },
];

/**
 * Runs the scheduled work. Every job claims its work in the database before it
 * runs, and a claim is given back when a service the work needs is unreachable,
 * so another process completes it.
 */
export function startScheduler(): void {
  for (const job of JOBS) {
    let running = false;
    const timer = setInterval(() => {
      if (running) return;
      running = true;
      job
        .run()
        .catch(() => {
          /* the claim went back; another pass retries */
        })
        .finally(() => {
          running = false;
        });
    }, job.everyMs);
    timer.unref();
  }
}
