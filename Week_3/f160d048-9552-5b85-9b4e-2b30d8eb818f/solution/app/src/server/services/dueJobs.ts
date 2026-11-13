import { config } from "../config";
import { inUnit } from "../db/unit";
import { pool } from "../db/pool";
import { formatRange } from "../../shared/money";
import { CITIES, nameOf, type CityId } from "../../shared/reference";
import { lapseExpiredClaims } from "./claims";
import { trimLiveEvents } from "./liveHub";
import { sendDueMail } from "./outbox";
import { reconcileIndexes, runDueSearchSync } from "./searchSync";

type DueBatch = { id: number; label: string; email: string };
type BatchJob = { id: string; title: string; company_name: string; city: CityId; pay_low: number; pay_high: number };

async function sendAlertBatches(): Promise<void> {
  await inUnit(async (unit) => {
    const due = await unit.rows<DueBatch>(
      `SELECT b.id, a.label, u.email FROM alert_batches b JOIN alerts a ON a.id = b.alert_id JOIN users u ON u.id = a.user_id
        WHERE b.sent_at IS NULL AND b.opened_at + make_interval(secs => $1) <= app_now()
        ORDER BY b.id FOR UPDATE OF b SKIP LOCKED`,
      [config.limits.alertBatchSeconds],
    );
    for (const batch of due) {
      await unit.query("UPDATE alert_batches SET sent_at = app_now() WHERE id = $1", [batch.id]);
      const jobs = await unit.rows<BatchJob>(
        `SELECT j.id, j.title, c.name AS company_name, j.city AS city, j.pay_low, j.pay_high
           FROM alert_batch_jobs bj JOIN jobs j ON j.id = bj.job_id JOIN companies c ON c.id = j.company_id
          WHERE bj.batch_id = $1 AND j.status = 'listed' ORDER BY j.listed_at DESC, j.id`,
        [batch.id],
      );
      if (jobs.length === 0) continue;
      const lines = jobs.map(
        (job) => `${job.title} at ${job.company_name}, ${nameOf(CITIES, job.city)}, ${formatRange(job.pay_low, job.pay_high)}\n${config.publicUrl}/jobs/${job.id}\n`,
      );
      const count = jobs.length === 1 ? "1 new lab job" : `${jobs.length} new lab jobs`;
      await unit.mail(batch.email, `${count} for ${batch.label}`, lines.join("\n"));
    }
  });
}

async function purge(): Promise<void> {
  await pool.query("DELETE FROM rate_events WHERE at < app_now() - interval '1 day'");
  await pool.query("DELETE FROM auth_tokens WHERE expires_at < app_now() - interval '1 day'");
}

async function attempt(step: () => Promise<void>): Promise<void> {
  try {
    await step();
  } catch (error) {
    console.error("due job failed:", error instanceof Error ? error.message : error);
  }
}

/** Claim lapses, alert batches, outbox sends and search sync: on a timer and on every grading clock call. */
export async function runDueJobs(): Promise<void> {
  await attempt(lapseExpiredClaims);
  await attempt(sendAlertBatches);
  await attempt(sendDueMail);
  await attempt(runDueSearchSync);
  await attempt(reconcileIndexes);
  await attempt(trimLiveEvents);
  await attempt(purge);
}

const TICK_MS = 2000;

export function startDueJobs(): void {
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    void runDueJobs().finally(() => {
      running = false;
    });
  }, TICK_MS);
}
