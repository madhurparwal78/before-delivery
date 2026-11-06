import { config } from '../config';
import { withTransaction } from '../db/pool';
import { sendMail } from './mail';

const ALERT_INTERVAL_MS = 30_000;

interface QueuedAlert {
  id: string;
  figure_id: string;
  moved: number;
  reversed_tco2e: string;
  recipients: string[];
  project_slug: string;
}

/** Claims one queued alert at a time with a database lock, so each is sent exactly once. */
async function sendNextAlert(): Promise<boolean> {
  return withTransaction(async (client) => {
    const claimed = await client.query<QueuedAlert>(
      `select queue.id, queue.figure_id, queue.moved, queue.reversed_tco2e, queue.recipients,
              figures.project_slug
       from alert_queue queue join figures on figures.id = queue.figure_id
       where queue.sent_at is null
       order by queue.id
       for update of queue skip locked
       limit 1`,
    );
    const alert = claimed.rows[0];
    if (alert === undefined) return false;
    await sendMail({
      to: alert.recipients,
      subject: `Seal broken on ${alert.figure_id} (readings moved: ${alert.moved})`,
      lines: [
        `Figure: ${alert.figure_id}`,
        `Readings moved: ${alert.moved}`,
        `Reversed: ${alert.reversed_tco2e} tCO2e`,
        `Audit trail: ${config.appPublicUrl}/projects/${alert.project_slug}/figures/${alert.figure_id}/audit`,
      ],
    });
    await client.query(
      "update alert_queue set sent_at = date_trunc('second', clock_timestamp()) where id = $1",
      [alert.id],
    );
    return true;
  });
}

export async function flushAlerts(): Promise<void> {
  for (let sent = 0; sent < 50; sent += 1) {
    try {
      if (!(await sendNextAlert())) return;
    } catch {
      return;
    }
  }
}

export function startAlertLoop(): NodeJS.Timeout {
  const timer = setInterval(() => void flushAlerts(), ALERT_INTERVAL_MS);
  timer.unref();
  return timer;
}
