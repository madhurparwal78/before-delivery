import type { AppServices } from '../http/context';
import { purgeExpiredKeys } from '../http/idempotency';
import { prepareDueCharts } from '../service/chart';
import { issuePendingRefunds } from '../service/refunds';
import { storeReservedTicket } from '../service/tickets';

interface OutboxRow {
  readonly id: number;
  readonly to_email: string;
  readonly subject: string;
  readonly body: string;
  readonly attach_pnr: string | null;
  readonly attach_version: number | null;
}

/** Each queued mail is delivered exactly once, from the outbox. */
async function deliverOutbox(app: AppServices): Promise<void> {
  const rows = await app.database.query<OutboxRow>(
    `update outbox set claimed_at = now()
     where id in (
       select id from outbox
       where sent_at is null
         and (claimed_at is null or claimed_at < now() - interval '60 seconds')
       order by id limit 10 for update skip locked
     )
     returning id, to_email, subject, body, attach_pnr, attach_version`,
  );
  for (const row of rows) {
    const attachments = [];
    if (row.attach_pnr !== null && row.attach_version !== null) {
      const tickets = await app.database.query<{ object_key: string; stored: boolean }>(
        'select object_key, stored from tickets where pnr = $1 and version = $2',
        [row.attach_pnr, row.attach_version],
      );
      const ticket = tickets[0];
      if (ticket === undefined || !ticket.stored) continue;
      try {
        const object = await app.storage.get(ticket.object_key);
        attachments.push({
          filename: `e-ticket-${row.attach_pnr}-v${row.attach_version}.pdf`,
          contentType: 'application/pdf',
          content: object.body,
        });
      } catch {
        continue;
      }
    }
    try {
      await app.mailer.send({
        to: row.to_email,
        subject: row.subject,
        body: row.body,
        attachments,
      });
      await app.database.query('update outbox set sent_at = now() where id = $1', [row.id]);
    } catch {
      await app.database.query('update outbox set claimed_at = null where id = $1', [row.id]);
    }
  }
}

/** A version reserved during a MinIO outage is stored once MinIO is reachable again. */
async function backfillTickets(app: AppServices): Promise<void> {
  const rows = await app.database.query<{ pnr: string; version: number }>(
    'select pnr, version from tickets where stored = false order by pnr, version',
  );
  for (const row of rows) {
    const stored = await storeReservedTicket(app.database, app.storage, row.pnr, row.version)
      .catch(() => false);
    if (stored) {
      await app.database.query('update bookings set version = version + 1 where pnr = $1', [row.pnr]);
    }
  }
}

function every(milliseconds: number, task: () => Promise<void>): NodeJS.Timeout {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void task().catch(() => undefined).finally(() => {
      running = false;
    });
  }, milliseconds);
  timer.unref();
  return timer;
}

export function startJobs(app: AppServices): () => void {
  const timers = [
    every(1_000, () => prepareDueCharts(app, app.clock.now())),
    every(2_000, () => deliverOutbox(app)),
    every(5_000, () => backfillTickets(app)),
    every(20_000, () => issuePendingRefunds(app)),
    every(600_000, () => purgeExpiredKeys(app.database)),
  ];
  return () => {
    for (const timer of timers) clearInterval(timer);
  };
}
