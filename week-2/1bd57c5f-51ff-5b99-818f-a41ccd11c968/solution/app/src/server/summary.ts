import { TRADES, TRADE_LABELS, STATUS_LABELS, type ItemStatus, type Trade } from "../shared/domain";
import { config } from "./config";
import { maybeOne, one, pool, rows, sequence, transaction, type Tx } from "./db";
import { queueEmail, sendQueuedMail, signInLine } from "./mail";
import { loadRooms } from "./records";
import { addDays, utcToLocal } from "./schedule";
import { countsByScope } from "./views";
import { liveOccurrences, loadSeries } from "./visits";

// The daily walkthrough summary. From SUMMARY_LOCAL_TIME (job-local) each homeowner of an
// active or walkthrough job gets at most one code-free, amount-free summary per job-local
// day, once the window since the previous cut-off holds changes and the latest change is
// SUMMARY_QUIET_SECONDS old. The cut-off is the moment it is queued.

const CHECK_MS = 10_000;

interface Candidate {
  id: string;
  name: string;
  time_zone: string;
  created_at: string;
}

interface Change {
  item_id: string;
  kind: "created" | "changed" | "deleted";
  deleted_number: number | null;
  deleted_title: string | null;
}

function minutesOf(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

async function summaryBody(tx: Tx, job: Candidate, localDate: string, changes: readonly Change[]): Promise<string> {
  const [rooms, counts, series, items] = await sequence(
    () => loadRooms(tx, job.id),
    () => countsByScope(tx, job.id),
    () => loadSeries(tx, job.id),
    () =>
      rows<{ id: string; number: number; title: string; status: ItemStatus }>(
        tx,
        "SELECT id, number, title, status FROM items WHERE job_id = $1",
        [job.id],
      ),
  );
  const { verified, total, percent } = counts.all.progress;
  const tomorrow = addDays(localDate, 1);
  const tradeOrder = (trade: Trade | null) => (trade === null ? TRADES.length : TRADES.indexOf(trade));
  const visits = liveOccurrences(series, job.time_zone)
    .filter((occurrence) => occurrence.startsLocal.slice(0, 10) === tomorrow)
    .sort((a, b) => a.startsUtc.getTime() - b.startsUtc.getTime() || tradeOrder(a.series.member_trade) - tradeOrder(b.series.member_trade))
    .map((occurrence) => {
      const label = occurrence.series.member_trade ? TRADE_LABELS[occurrence.series.member_trade] : "";
      return `Visit ${tomorrow} ${occurrence.startsLocal.slice(11, 16)} to ${occurrence.endsLocal.slice(11, 16)}: ${label}`;
    });
  const created = new Set(changes.filter((change) => change.kind === "created").map((change) => change.item_id));
  const listed = new Map<number, string>();
  for (const change of changes) {
    const item = items.find((candidate) => candidate.id === change.item_id);
    if (item) listed.set(item.number, `Item ${item.number}: ${item.title} — ${STATUS_LABELS[item.status]}`);
    else if (change.kind === "deleted" && !created.has(change.item_id) && change.deleted_number !== null) {
      listed.set(change.deleted_number, `Item ${change.deleted_number}: ${change.deleted_title} — Removed`);
    }
  }
  return [
    `${percent}% verified (${verified} of ${total} items)`,
    ...rooms.map((room) => {
      const tally = counts.all.rooms.find((entry) => entry.id === room.id)!.counts;
      return `${room.name}: ${tally.verified} of ${tally.total} verified`;
    }),
    ...(visits.length > 0 ? visits : ["No site visits tomorrow"]),
    ...[...listed.entries()].sort(([a], [b]) => a - b).map(([, line]) => line),
    signInLine(),
  ].join("\n");
}

/** Queues the job's summary for today when it is due; answers whether one was queued. */
async function queueSummary(job: Candidate): Promise<boolean> {
  return transaction(async (tx) => {
    await tx.query("SELECT 1 FROM jobs WHERE id = $1 FOR UPDATE", [job.id]);
    const { now } = await one<{ now: string }>(tx, "SELECT clock_timestamp() AS now");
    const local = utcToLocal(new Date(now), job.time_zone);
    if (minutesOf(local.time) < config.summaryMinutes) return false;
    const done = await maybeOne(tx, "SELECT 1 FROM daily_summaries WHERE job_id = $1 AND local_date = $2", [job.id, local.date]);
    if (done) return false;
    const previous = await maybeOne<{ queued_at: string }>(
      tx,
      "SELECT max(queued_at) AS queued_at FROM daily_summaries WHERE job_id = $1 HAVING count(*) > 0",
      [job.id],
    );
    const since = previous?.queued_at ?? job.created_at;
    const changes = await rows<Change & { changed_at: string }>(
      tx,
      `SELECT item_id, kind, deleted_number, deleted_title, changed_at FROM item_changes
       WHERE job_id = $1 AND changed_at > $2 AND changed_at <= $3 ORDER BY changed_at`,
      [job.id, since, now],
    );
    const latest = changes.at(-1);
    if (!latest || Date.parse(now) - Date.parse(latest.changed_at) < config.summaryQuietSeconds * 1000) return false;
    const homeowners = await rows<{ email: string }>(
      tx,
      `SELECT p.email FROM job_members m JOIN people p ON p.id = m.person_id
       WHERE m.job_id = $1 AND m.role = 'homeowner' AND m.ended_at IS NULL ORDER BY m.position`,
      [job.id],
    );
    if (homeowners.length === 0) return false;
    await tx.query("INSERT INTO daily_summaries (job_id, local_date, queued_at) VALUES ($1, $2, $3)", [job.id, local.date, now]);
    const body = await summaryBody(tx, job, local.date, changes);
    for (const { email } of homeowners) {
      await queueEmail(tx, {
        jobId: job.id,
        kind: "summary",
        to: email,
        subject: `Snaglight: walkthrough summary for ${job.name}, ${local.date}`,
        body,
      });
    }
    return true;
  });
}

async function queueDueSummaries(): Promise<void> {
  try {
    const jobs = await rows<Candidate>(
      pool,
      `SELECT j.id, j.name, j.time_zone, j.created_at FROM jobs j
       WHERE j.status IN ('active', 'walkthrough')
         AND EXISTS (SELECT 1 FROM job_members m WHERE m.job_id = j.id AND m.role = 'homeowner' AND m.ended_at IS NULL)
         AND EXISTS (SELECT 1 FROM item_changes c WHERE c.job_id = j.id
                     AND c.changed_at > COALESCE((SELECT max(queued_at) FROM daily_summaries s WHERE s.job_id = j.id), j.created_at))`,
    );
    let queued = false;
    for (const job of jobs) queued = (await queueSummary(job)) || queued;
    if (queued) await sendQueuedMail();
  } catch (error) {
    console.error("daily summary check failed:", (error as Error).message);
  }
}

export function startDailySummaries(): void {
  void queueDueSummaries();
  setInterval(() => void queueDueSummaries(), CHECK_MS).unref();
}
