import { config } from '../config.js';
import { db, Queryable, withTransaction } from '../db.js';
import { dropEvents, flushEvents } from '../live.js';
import { flushOutbox } from '../mail.js';
import { blockAt, blockTimeOf, latestHeight, produceBlock } from './blocks.js';
import { runFraudCheck } from './fraud.js';
import {
  failDepositPeriod,
  finaliseProposal,
  ProposalRow,
  proposalsOf,
  sendVoteReminder,
} from './governance.js';
import { takeSample } from './sampling.js';
import { releaseUnbondingsAt } from './staking.js';
import { allWorkspaces } from './workspaces.js';
import { BlockRow, LightNodeRow, WorkspaceRow } from './types.js';

let currentMs = Date.parse(config.appStartAt);
let realtimeOffsetMs = 0;
let running: Promise<void> = Promise.resolve();

export async function loadClock(): Promise<void> {
  const { rows } = await db.query<{ now: Date }>('SELECT now FROM clock WHERE id = 1');
  if (rows[0]) {
    currentMs = rows[0].now.getTime();
  } else {
    currentMs = Date.parse(config.appStartAt);
    await db.query('INSERT INTO clock (id, now) VALUES (1, $1)', [new Date(currentMs)]);
  }
  realtimeOffsetMs = currentMs - Date.now();
}

/** The server clock. The browser never decides time-dependent state. */
export function now(): Date {
  if (config.clockMode === 'manual') return new Date(currentMs);
  return new Date(Date.now() + realtimeOffsetMs);
}

async function persistClock(tx: Queryable, at: Date): Promise<void> {
  await tx.query('UPDATE clock SET now = $1 WHERE id = 1', [at]);
}

interface DueSample {
  node: LightNodeRow;
  block: BlockRow;
  at: number;
}

async function dueSamples(tx: Queryable, targetMs: number): Promise<DueSample[]> {
  const { rows } = await tx.query<{
    node_id: string;
    workspace_id: string;
    name: string;
    number: number;
    auto_sample: boolean;
    auto_sample_since: Date | null;
    height: number;
    taken: string;
  }>(
    `SELECT n.id AS node_id, n.workspace_id, n.name, n.number, n.auto_sample, n.auto_sample_since,
            b.height,
            (SELECT count(*)::text FROM samples s WHERE s.light_node_id = n.id AND s.height = b.height) AS taken
     FROM light_nodes n
       JOIN blocks b ON b.workspace_id = n.workspace_id
     WHERE n.auto_sample
       AND b.status <> 'rejected'
       AND (n.auto_sample_since IS NULL OR b.produced_at >= n.auto_sample_since)
       AND b.produced_at <= $1`,
    [new Date(targetMs)],
  );
  const due: DueSample[] = [];
  for (const row of rows) {
    const taken = Number(row.taken);
    if (taken >= config.samplesPerBlock) continue;
    const block = (await blockAt(tx, row.workspace_id, row.height)) as BlockRow;
    const at = block.produced_at.getTime() + (taken + 1) * config.sampleIntervalMs;
    if (at > targetMs) continue;
    due.push({
      node: {
        id: row.node_id,
        workspace_id: row.workspace_id,
        name: row.name,
        number: row.number,
        auto_sample: row.auto_sample,
        auto_sample_since: row.auto_sample_since,
      },
      block,
      at,
    });
  }
  return due;
}

async function dueFraudChecks(tx: Queryable, targetMs: number): Promise<BlockRow[]> {
  const { rows } = await tx.query<BlockRow>(
    `SELECT * FROM blocks
     WHERE fraud_checked_at IS NULL
       AND produced_at + ($1::bigint * interval '1 millisecond') <= $2`,
    [config.fraudCheckDelayMs, new Date(targetMs)],
  );
  return rows;
}

interface ProposalEvent {
  proposal: ProposalRow;
  at: number;
  what: 'deposit-end' | 'voting-end' | 'reminder';
}

async function dueProposalEvents(tx: Queryable, targetMs: number): Promise<ProposalEvent[]> {
  const workspaces = await allWorkspaces(tx);
  const events: ProposalEvent[] = [];
  for (const workspace of workspaces) {
    for (const proposal of await proposalsOf(tx, workspace.id)) {
      if (proposal.status === 'deposit' && proposal.deposit_ends_at.getTime() <= targetMs) {
        events.push({ proposal, at: proposal.deposit_ends_at.getTime(), what: 'deposit-end' });
      }
      if (proposal.status === 'voting' && proposal.voting_ends_at) {
        const end = proposal.voting_ends_at.getTime();
        if (end <= targetMs) events.push({ proposal, at: end, what: 'voting-end' });
        const reminder = end - config.voteReminderSeconds * 1000;
        if (proposal.reminded_at === null && reminder <= targetMs) {
          events.push({ proposal, at: reminder, what: 'reminder' });
        }
      }
    }
  }
  return events;
}

async function dueUnbondingMs(tx: Queryable, targetMs: number): Promise<number | null> {
  const { rows } = await tx.query<{ at: Date | null }>(
    `SELECT min(completes_at) AS at FROM unbondings
     WHERE released_at IS NULL AND completes_at <= $1`,
    [new Date(targetMs)],
  );
  return rows[0]?.at ? rows[0].at.getTime() : null;
}

async function dueBlocks(tx: Queryable, targetMs: number): Promise<{ workspace: WorkspaceRow; height: number; at: number }[]> {
  const workspaces = await allWorkspaces(tx);
  const due: { workspace: WorkspaceRow; height: number; at: number }[] = [];
  for (const workspace of workspaces) {
    const height = (await latestHeight(tx, workspace.id)) + 1;
    const at = blockTimeOf(height).getTime();
    if (at <= targetMs) due.push({ workspace, height, at });
  }
  return due;
}

async function nextInstant(tx: Queryable, targetMs: number): Promise<number | null> {
  const candidates: number[] = [];
  const unbonding = await dueUnbondingMs(tx, targetMs);
  if (unbonding !== null) candidates.push(unbonding);
  for (const event of await dueProposalEvents(tx, targetMs)) candidates.push(event.at);
  for (const block of await dueBlocks(tx, targetMs)) candidates.push(block.at);
  for (const sample of await dueSamples(tx, targetMs)) candidates.push(sample.at);
  for (const block of await dueFraudChecks(tx, targetMs)) {
    candidates.push(block.produced_at.getTime() + config.fraudCheckDelayMs);
  }
  if (candidates.length === 0) return null;
  return Math.min(...candidates);
}

/** Runs every event due at one instant, in the published order. */
async function runInstant(instantMs: number, payRewards: boolean): Promise<void> {
  const at = new Date(instantMs);
  try {
    await withTransaction(async (tx) => {
      await releaseUnbondingsAt(tx, at);

      for (const event of (await dueProposalEvents(tx, instantMs)).filter((item) => item.at === instantMs)) {
        if (event.what === 'deposit-end') await failDepositPeriod(tx, event.proposal, at);
        else if (event.what === 'reminder') await sendVoteReminder(tx, event.proposal, at);
        else await finaliseProposal(tx, event.proposal, at);
      }

      for (const due of (await dueBlocks(tx, instantMs)).filter((item) => item.at === instantMs)) {
        await produceBlock(tx, due.workspace, due.height, at, payRewards);
      }

      for (const due of (await dueSamples(tx, instantMs)).filter((item) => item.at === instantMs)) {
        const workspace = due.block.workspace_id;
        const row = (await blockAt(tx, workspace, due.block.height)) as BlockRow;
        if (row.status === 'rejected') continue;
        const { rows } = await tx.query<WorkspaceRow>(
          'SELECT id, name, next_block FROM workspaces WHERE id = $1',
          [workspace],
        );
        await takeSample(tx, rows[0], due.node, row, at);
      }

      for (const block of (await dueFraudChecks(tx, instantMs)).filter(
        (item) => item.produced_at.getTime() + config.fraudCheckDelayMs === instantMs,
      )) {
        const { rows } = await tx.query<WorkspaceRow>(
          'SELECT id, name, next_block FROM workspaces WHERE id = $1',
          [block.workspace_id],
        );
        await tx.query(
          'UPDATE blocks SET fraud_checked_at = $3 WHERE workspace_id = $1 AND height = $2',
          [block.workspace_id, block.height, at],
        );
        await runFraudCheck(tx, rows[0], block, at);
      }

      if (instantMs > currentMs) await persistClock(tx, at);
    });
    if (instantMs > currentMs) currentMs = instantMs;
    flushEvents();
    void flushOutbox();
  } catch (error) {
    dropEvents();
    throw error;
  }
}

async function run(targetMs: number, payRewards: boolean): Promise<void> {
  for (;;) {
    const instant = await nextInstant(db, targetMs);
    if (instant === null) break;
    await runInstant(instant, payRewards);
  }
  if (targetMs > currentMs) {
    currentMs = targetMs;
    await db.query('UPDATE clock SET now = $1 WHERE id = 1', [new Date(currentMs)]);
  }
}

/**
 * Serialises clock advances so events never interleave. The seeded history
 * blocks pay no rewards; rewards start with the first block the engine makes.
 */
export function advanceTo(targetMs: number, payRewards = true): Promise<void> {
  running = running.then(
    () => run(targetMs, payRewards),
    () => run(targetMs, payRewards),
  );
  return running;
}

export async function advanceBy(ms: number): Promise<Date> {
  await advanceTo(currentMs + ms);
  return new Date(currentMs);
}

export async function resetClock(tx: Queryable): Promise<void> {
  currentMs = Date.parse(config.appStartAt);
  realtimeOffsetMs = currentMs - Date.now();
  await tx.query(
    'INSERT INTO clock (id, now) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET now = excluded.now',
    [new Date(currentMs)],
  );
}

/** Used by the seed to place the clock at the end of the seeded history. */
export async function setClockTo(tx: Queryable, at: Date): Promise<void> {
  currentMs = at.getTime();
  realtimeOffsetMs = currentMs - Date.now();
  await tx.query(
    'INSERT INTO clock (id, now) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET now = excluded.now',
    [at],
  );
}

export function startClock(): void {
  if (config.clockMode !== 'realtime') return;
  setInterval(() => {
    void advanceTo(Date.now() + realtimeOffsetMs);
  }, 200).unref();
}
