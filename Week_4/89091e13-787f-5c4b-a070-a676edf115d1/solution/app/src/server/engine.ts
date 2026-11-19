import { config } from "./config.ts";
import { exclusive, maybeOne, pool, transaction, type AfterCommit, type Db } from "./db.ts";
import { clockNow, eventsProcessedThrough, persistClock, setProcessed } from "./clock.ts";
import { flushObjects, produceBlock } from "./blocks.ts";
import { closeVoting, failProposal, sendVoteReminders } from "./governance.ts";
import { deliverDueMail } from "./outbox.ts";
import { autoSampleTick, runFraudCheck } from "./sampling.ts";
import { releaseUnbonding } from "./staking.ts";
import { storageReachable } from "./storage.ts";
import { broadcast } from "./live.ts";
import { latestHeight } from "./workspace.ts";

/** Whether blocks pay rewards. The seed's history paid none: rewards start with the first block after it. */
let paysRewards = true;

export function setPaysRewards(value: boolean): void {
  paysRewards = value;
}

interface DueEvent {
  at: Date;
  kind: "release" | "deposit-end" | "voting-end" | "reminder" | "block" | "sample" | "fraud";
  ref: string;
}

/**
 * The next due event, derived from stored state (no queue to lose). Ties at one instant run in the published order:
 * unbonding releases, proposal period ends, block production, light-node samples, fraud checks.
 */
async function nextEvent(db: Db, target: Date): Promise<DueEvent | undefined> {
  return maybeOne<DueEvent>(
    db,
    `SELECT at, kind, ref FROM (
       SELECT completes_at AS at, 1 AS rank, 'release' AS kind, id::text AS ref FROM unbondings WHERE released_at IS NULL
       UNION ALL SELECT deposit_ends_at, 2, 'deposit-end', workspace_id::text || ':' || number FROM proposals WHERE status = 'deposit'
       UNION ALL SELECT voting_ends_at, 2, 'voting-end', workspace_id::text || ':' || number FROM proposals WHERE status = 'voting'
       UNION ALL SELECT voting_ends_at - $5::int * interval '1 millisecond', 2, 'reminder', workspace_id::text || ':' || number
         FROM proposals WHERE status = 'voting' AND NOT reminder_sent
       UNION ALL SELECT $1::timestamptz + ((SELECT COALESCE(MAX(b.height), 0) FROM blocks b WHERE b.workspace_id = w.id) + 1) * $2::bigint * interval '1 millisecond',
         3, 'block', w.id::text FROM workspaces w
       UNION ALL SELECT b.produced_at + (a.ticks + 1) * $3::int * interval '1 millisecond', 4, 'sample', a.node_id::text || ':' || a.height
         FROM auto_sampling a JOIN light_nodes n ON n.id = a.node_id AND n.auto_sample
         JOIN blocks b ON b.workspace_id = n.workspace_id AND b.height = a.height
         WHERE a.ticks < $6::int AND b.status <> 'rejected'
       UNION ALL SELECT produced_at + $4::int * interval '1 millisecond', 5, 'fraud', workspace_id::text || ':' || height FROM blocks WHERE NOT fraud_checked
     ) due WHERE at <= $7 ORDER BY at, rank, ref LIMIT 1`,
    [config.startAt, config.blockTimeMs, config.sampleIntervalMs, config.fraudCheckDelayMs, config.voteReminderMs, config.samplesPerBlock, target],
  );
}

async function handle(db: Db, after: AfterCommit, event: DueEvent): Promise<void> {
  const [first, second] = event.ref.split(":") as [string, string];
  after(() => void deliverDueMail());
  switch (event.kind) {
    case "release": {
      const { workspaceId } = await releaseUnbonding(db, Number(event.ref));
      after(() => broadcast(workspaceId, { type: "changed" }));
      return;
    }
    case "deposit-end":
      await failProposal(db, first, Number(second), event.at);
      after(() => broadcast(first, { type: "changed" }));
      return;
    case "voting-end":
      await closeVoting(db, first, Number(second), event.at);
      after(() => broadcast(first, { type: "changed" }));
      return;
    case "reminder":
      await sendVoteReminders(db, first, Number(second));
      return;
    case "block":
      await produceBlock(db, after, event.ref, (await latestHeight(db, event.ref)) + 1, event.at, paysRewards);
      return;
    case "sample":
      await autoSampleTick(db, after, first, Number(second), event.at);
      return;
    case "fraud":
      await runFraudCheck(db, after, first, Number(second), event.at);
      return;
  }
}

/** Runs every event due up to `target`, each at its own instant, then parks the clock at `target`. The caller holds the writer lock. */
export async function advanceTo(target: Date): Promise<void> {
  for (;;) {
    const event = await nextEvent(pool, target);
    if (!event) break;
    await transaction((db, after) => handle(db, after, event));
    if (event.kind === "block" && storageReachable()) await flushObjects();
  }
  if (target > eventsProcessedThrough()) setProcessed(target);
  await persistClock(pool);
}

/** Realtime mode: brings events up to the wall-driven clock. Manual mode moves only through the grading clock route. */
export async function catchUp(): Promise<void> {
  if (config.clockMode === "realtime") await advanceTo(clockNow());
}

export function startRealtimeClock(): void {
  if (config.clockMode !== "realtime") return;
  setInterval(() => void exclusive(catchUp), 250);
}
