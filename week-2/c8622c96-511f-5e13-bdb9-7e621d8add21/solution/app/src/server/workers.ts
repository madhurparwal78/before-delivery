// Scheduled and retried work. Every job claims its rows in the database (row locks, SKIP LOCKED), so any
// instance sharing the database may finish work another began, and each effect happens exactly once.
// An instance that finds a provider unreachable waits 5 seconds before its next attempt; the waiting work
// stays free in the database, so an instance that can reach the provider takes it on its next poll.
import { retryActivations } from "./activation.js";
import { serverNow } from "./clock.js";
import { one, query, transaction } from "./db.js";
import { purgeTakenDown } from "./desk.js";
import { creditLine, creditsOf, type EssayRow } from "./essay-model.js";
import { bumpVersion } from "./essays.js";
import type { LicenceRow } from "./licence-state.js";
import { assertTransition } from "./lifecycle.js";
import { queueExpiryWarning, queueLiftAlert } from "./mail.js";
import { deliver } from "./smtp.js";
import { recordDuePayouts } from "./statements.js";
import { seedMedia } from "./seed-media.js";

const WARNING_LEAD = "24 hours";

/** Embargoed essays whose lift instant has passed go live once, with one alert per follower. */
async function liftEmbargoes(): Promise<void> {
  for (;;) {
    const lifted = await transaction(async (client) => {
      const now = await serverNow(client);
      const essay = await one<EssayRow>(
        `SELECT * FROM essays WHERE state = 'embargoed' AND lift_at <= $1 ORDER BY lift_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [now], client);
      if (!essay) return false;
      const credits = await creditsOf([essay.id], client);
      const followers = await query<{ email: string }>(
        `SELECT DISTINCT p.email FROM follows f JOIN people p ON p.id = f.person_id
         WHERE f.essay_id = $1 OR f.contributor = ANY($2)`, [essay.id, credits.map((c) => c.handle)], client);
      assertTransition(essay.state, "lift");
      await bumpVersion(client, essay.id, "state = 'live'");
      await queueLiftAlert(client, { id: essay.id, title: essay.title, creditLine: creditLine(credits.map((c) => c.name)) },
        essay.lift_at, followers.map((f) => f.email));
      return true;
    });
    if (!lifted) return;
  }
}

/** Queues one expiry warning per active licence exactly 24 elapsed hours before its end instant. */
async function queueWarnings(): Promise<void> {
  for (;;) {
    const queued = await transaction(async (client) => {
      const now = await serverNow(client);
      const licence = await one<LicenceRow>(
        `SELECT * FROM licences WHERE status = 'active' AND NOT warning_queued AND window_end > $1
           AND window_end - interval '${WARNING_LEAD}' <= $1 AND confirmed_at < window_end - interval '${WARNING_LEAD}'
         ORDER BY window_end LIMIT 1 FOR UPDATE SKIP LOCKED`, [now], client);
      if (!licence) return false;
      const essay = await one<{ title: string }>("SELECT title FROM essays WHERE id = $1", [licence.essay_id], client);
      const credits = await creditsOf([licence.essay_id], client);
      await queueExpiryWarning(client, { id: licence.essay_id, title: essay?.title ?? "",
        creditLine: creditLine(credits.map((c) => c.name)) }, licence);
      await query("UPDATE licences SET warning_queued = true WHERE id = $1", [licence.id], client);
      return true;
    });
    if (!queued) return;
  }
}

/** Sends queued mail one message at a time, holding the row lock while sending so a cancel waits for it. */
async function sendMail(): Promise<WorkOutcome> {
  for (;;) {
    const result = await transaction(async (client): Promise<WorkOutcome | "sent"> => {
      const mail = await one<{ id: number; recipient: string; subject: string; body: string }>(
        `SELECT id, recipient, subject, body FROM mail_queue WHERE state = 'queued'
         ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`, [], client);
      if (!mail) return "done";
      try {
        await deliver({ to: mail.recipient, subject: mail.subject, body: mail.body });
      } catch {
        return "provider_down";
      }
      await query("UPDATE mail_queue SET state = 'sent', sent_at = clock_timestamp() WHERE id = $1", [mail.id], client);
      return "sent";
    });
    if (result !== "sent") return result;
  }
}

async function retryPurges(): Promise<void> {
  const essays = await query<{ id: string }>("SELECT id FROM essays WHERE storage_purge_pending");
  for (const essay of essays) await purgeTakenDown(essay.id);
}

export type WorkOutcome = "done" | "provider_down";

const PROVIDER_RETRY_MS = 5000;

interface Job {
  every: number;
  run: () => Promise<WorkOutcome | void>;
  busy: boolean;
  next: number;
}

const job = (every: number, run: () => Promise<WorkOutcome | void>): Job => ({ every, run, busy: false, next: 0 });

const jobs: Job[] = [
  job(400, liftEmbargoes),
  job(500, queueWarnings),
  job(500, sendMail),
  job(1000, retryActivations),
  job(1000, () => recordDuePayouts()),
  job(5000, retryPurges),
  job(5000, seedMedia),
];

export function startWorkers(): void {
  setInterval(() => {
    const now = Date.now();
    for (const due of jobs) {
      if (due.busy || now < due.next) continue;
      due.busy = true;
      due.next = now + due.every;
      due.run().then((outcome) => {
        if (outcome === "provider_down") due.next = Date.now() + PROVIDER_RETRY_MS;
      }).catch(() => undefined).finally(() => {
        due.busy = false;
      });
    }
  }, 100).unref();
}
