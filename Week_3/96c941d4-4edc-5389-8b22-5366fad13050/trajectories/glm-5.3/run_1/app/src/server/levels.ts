import { Client } from 'pg';
import { newId } from './accounts.js';
import { Definition, RULESET, deviceOrder } from '../shared/seed.js';
import { Command } from '../shared/sim.js';
import { withTransaction, withClient } from './db.js';
import * as objects from './objects.js';
import {
  LevelRow,
  loadLevel,
  levelDigestOf,
  challengeDigestOf,
  loadTicket,
} from './runs.js';

// ---------- Level revisions and proofs ----------

export interface ProofRow {
  run_id: string;
  level_id: string;
  revision: number;
  state: string;
}

export async function listLevels(accountId: string): Promise<LevelRow[]> {
  return withClient(async (client) => {
    const result = await client.query(
      "SELECT * FROM levels WHERE account_id = $1 AND state <> 'withdrawn' ORDER BY title ASC, id ASC",
      [accountId],
    );
    return result.rows as LevelRow[];
  });
}

export async function createLevel(accountId: string, definition: Definition): Promise<LevelRow> {
  const id = newId('lvl');
  const digest = levelDigestOf(definition);
  return withTransaction(async (client) => {
    await client.query(
      `INSERT INTO levels (id, account_id, title, state, revision, definition, level_digest, ruleset)
       VALUES ($1,$2,$3,'private',1,$4,$5,$6)`,
      [id, accountId, definition.title, JSON.stringify(definition), digest, RULESET],
    );
    return (await client.query('SELECT * FROM levels WHERE id = $1', [id])).rows[0] as LevelRow;
  });
}

export type SaveOutcome =
  | { kind: 'saved'; level: LevelRow }
  | { kind: 'not-found' }
  | { kind: 'revision-changed' }
  | { kind: 'transition' };

export async function saveLevel(id: string, accountId: string, expectedRevision: number, definition: Definition): Promise<SaveOutcome> {
  const digest = levelDigestOf(definition);
  return withTransaction(async (client) => {
    const result = await client.query('SELECT * FROM levels WHERE id = $1 FOR UPDATE', [id]);
    const row = result.rows[0] as LevelRow | undefined;
    if (!row || row.account_id !== accountId) return { kind: 'not-found' };
    if (row.state === 'withdrawn') return { kind: 'not-found' };
    // Edits are invalid outside private state.
    if (row.state !== 'private') return { kind: 'transition' };
    if (row.revision !== expectedRevision) return { kind: 'revision-changed' };
    const newRevision = expectedRevision + 1;
    await client.query(
      'UPDATE levels SET title=$2, definition=$3, level_digest=$4, revision=$5, proof_run_id=NULL WHERE id=$1',
      [id, definition.title, JSON.stringify(definition), digest, newRevision],
    );
    // Existing proofs of the previous revision become obsolete.
    await client.query(
      "UPDATE proofs SET state='obsolete', updated_at=now() WHERE level_id=$1 AND revision=$2 AND state IN ('pending','verifying','qualified')",
      [id, expectedRevision],
    );
    const saved = await client.query('SELECT * FROM levels WHERE id = $1', [id]);
    return { kind: 'saved', level: saved.rows[0] as LevelRow };
  });
}

export async function levelProofs(client: Client, levelId: string): Promise<ProofRow[]> {
  const result = await client.query('SELECT * FROM proofs WHERE level_id = $1 ORDER BY run_id ASC', [levelId]);
  return result.rows as ProofRow[];
}

// ---------- Publication and withdrawal ----------

export type PublishOutcome =
  | { kind: 'committed'; challenge: Record<string, unknown> }
  | { kind: 'identical'; challenge: Record<string, unknown> }
  | { kind: 'pending'; level: LevelRow }
  | { kind: 'not-found' }
  | { kind: 'revision-changed' }
  | { kind: 'proof-required' }
  | { kind: 'transition' }
  | { kind: 'duplicate' };

/**
 * Proof-backed publication: immutable definition and evidence objects must be
 * confirmed before the authoritative publication record commits.
 */
export async function publishLevel(id: string, accountId: string, expectedRevision: number, proofRunId: string): Promise<PublishOutcome> {
  return withTransaction(async (client) => {
    const levelResult = await client.query('SELECT * FROM levels WHERE id = $1 FOR UPDATE', [id]);
    const level = levelResult.rows[0] as LevelRow | undefined;
    if (!level || level.account_id !== accountId) return { kind: 'not-found' };
    if (level.revision !== expectedRevision) return { kind: 'revision-changed' };
    if (level.state === 'withdrawn') return { kind: 'not-found' };

    // The proof must be qualified for the current revision.
    const proofResult = await client.query(
      "SELECT * FROM proofs WHERE run_id = $1 AND level_id = $2 AND revision = $3 AND state = 'qualified'",
      [proofRunId, id, expectedRevision],
    );
    if (proofResult.rowCount === 0) return { kind: 'proof-required' };

    const digest = challengeDigestOf(level.level_digest, RULESET);

    // Identical committed replay returns the stored challenge.
    const existing = await client.query('SELECT * FROM challenge_publications WHERE digest = $1', [digest]);
    if (existing.rowCount === 1) {
      const publication = existing.rows[0];
      if (publication.level_id === id) {
        if (level.state === 'published') {
          return { kind: 'identical', challenge: challengeShape(publication) };
        }
      } else {
        return { kind: 'duplicate' };
      }
    } else if (existing.rowCount === 1) {
      return { kind: 'duplicate' };
    }

    if (level.state !== 'private') {
      // Only a private or proof-pending level can begin or continue publication.
      if (level.state !== 'proof-pending') return { kind: 'transition' };
    }

    // Confirm the immutable objects: definition and the proof's evidence.
    const defObject = await objects.getObject(objects.levelsKey(level.level_digest));
    if (!defObject.ok || !defObject.bytes) {
      // Entering proof-pending pins the selected proof run and keeps the
      // challenge private and retryable.
      await client.query("UPDATE levels SET state='proof-pending', proof_run_id=$2 WHERE id=$1", [id, proofRunId]);
      const refreshed = await client.query('SELECT * FROM levels WHERE id = $1', [id]);
      return { kind: 'pending', level: refreshed.rows[0] as LevelRow };
    }
    const ticketRow = await loadTicket(client, proofRunId);
    const runRow = await client.query('SELECT evidence_digest FROM runs WHERE ticket_id = $1', [proofRunId]);
    const evidenceDigest = runRow.rows[0]?.evidence_digest as string | undefined;
    if (!ticketRow || !evidenceDigest) {
      await client.query("UPDATE levels SET state='proof-pending', proof_run_id=$2 WHERE id=$1", [id, proofRunId]);
      const refreshed = await client.query('SELECT * FROM levels WHERE id = $1', [id]);
      return { kind: 'pending', level: refreshed.rows[0] as LevelRow };
    }
    const evidenceObject = await objects.getObject(objects.evidenceKey(evidenceDigest));
    if (!evidenceObject.ok || !evidenceObject.bytes) {
      await client.query("UPDATE levels SET state='proof-pending', proof_run_id=$2 WHERE id=$1", [id, proofRunId]);
      const refreshed = await client.query('SELECT * FROM levels WHERE id = $1', [id]);
      return { kind: 'pending', level: refreshed.rows[0] as LevelRow };
    }

    // Commit the publication record.
    const account = await client.query('SELECT player_name FROM accounts WHERE id = $1', [accountId]);
    const creatorName = account.rows[0].player_name as string;
    const committed = await client.query(
      `INSERT INTO challenge_publications (digest, level_id, ruleset, title, description, difficulty, creator_name, definition, level_digest, proof_run_id, unlisted)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false)
       ON CONFLICT (digest) DO NOTHING
       RETURNING *`,
      [
        digest, id, RULESET, level.definition.title, level.definition.description,
        level.definition.difficulty, creatorName, JSON.stringify(level.definition),
        level.level_digest, proofRunId,
      ],
    );
    if (committed.rowCount === 0) {
      const clash = await client.query('SELECT * FROM challenge_publications WHERE digest = $1', [digest]);
      if (clash.rows[0] && clash.rows[0].level_id !== id) return { kind: 'duplicate' };
      return { kind: 'identical', challenge: challengeShape(clash.rows[0]) };
    }
    await client.query("UPDATE levels SET state='published', challenge_digest=$2 WHERE id=$1", [id, digest]);
    // Commit index work with publication.
    await client.query(
      "INSERT INTO index_work (digest, action, status) VALUES ($1,'upsert','pending') ON CONFLICT DO NOTHING",
      [digest],
    );
    const publication = committed.rows[0];
    return { kind: 'committed', challenge: challengeShape(publication) };
  });
}

export function challengeShape(row: Record<string, unknown>): Record<string, unknown> {
  return {
    digest: row.digest,
    ruleset: row.ruleset,
    title: row.title,
    description: row.description,
    difficulty: row.difficulty,
    creatorName: row.creator_name,
    definition: row.definition,
    proofRunId: row.proof_run_id,
  };
}

export type WithdrawOutcome =
  | { kind: 'withdrawn'; id: string; state: string }
  | { kind: 'not-found' }
  | { kind: 'revision-changed' }
  | { kind: 'transition' };

export async function withdrawLevel(id: string, accountId: string, expectedRevision: number): Promise<WithdrawOutcome> {
  return withTransaction(async (client) => {
    const result = await client.query('SELECT * FROM levels WHERE id = $1 FOR UPDATE', [id]);
    const level = result.rows[0] as LevelRow | undefined;
    if (!level || level.account_id !== accountId) return { kind: 'not-found' };
    if (level.state === 'withdrawn') return { kind: 'not-found' };
    if (level.revision !== expectedRevision) return { kind: 'revision-changed' };
    if (level.state === 'published') {
      await client.query("UPDATE levels SET state='unlisted' WHERE id=$1", [id]);
      await client.query("UPDATE challenge_publications SET unlisted=true, unlisted_at=now() WHERE level_id=$1 AND unlisted=false", [id]);
      const publication = await client.query('SELECT digest FROM challenge_publications WHERE level_id=$1 AND unlisted=true LIMIT 1', [id]);
      const digest = publication.rows[0]?.digest as string | undefined;
      if (digest) {
        await client.query(
          "INSERT INTO index_work (digest, action, status) VALUES ($1,'delete','pending') ON CONFLICT DO NOTHING",
          [digest],
        );
      }
      return { kind: 'withdrawn', id, state: 'unlisted' };
    }
    if (level.state === 'private' || level.state === 'proof-pending') {
      await client.query("UPDATE levels SET state='withdrawn' WHERE id=$1", [id]);
      return { kind: 'withdrawn', id, state: 'withdrawn' };
    }
    return { kind: 'transition' };
  });
}

// ---------- Rankings (server-exclusive decisions) ----------

export interface BoardRowShape {
  rank: number;
  accountId: string;
  playerName: string;
  runId: string;
  breaches: number;
  completionTick: number;
  remainingCharge: number;
}

export interface BoardShape {
  digest: string;
  ruleset: string;
  rows: BoardRowShape[];
  personalBest: BoardRowShape | null;
  completions: number;
  crewUsage: Array<{ device: string; deployments: number; tenthsPercent: number }>;
}

interface QualifyingRow {
  run_id: string;
  account_id: string;
  player_name: string;
  breaches: number;
  completion_tick: number;
  remaining_charge: number;
  accepted_at: Date;
  commands: Command[];
}

/**
 * Computes the board from the same qualifying accepted victories: best-only per
 * account, competition ranks with gaps, distinct-account completions and
 * largest-remainder crew usage.
 */
export async function computeBoard(client: Client, digest: string, viewerAccountId: string | null, dailyOnly: boolean, seasonDay: string | null): Promise<BoardShape> {
  const params: unknown[] = [digest];
  let where = "cp.digest = $1 AND r.state='accepted' AND r.outcome='victory' AND t.mode='challenge'";
  if (dailyOnly) {
    where += ' AND t.daily = true AND t.season_day = $2';
    params.push(seasonDay);
  }
  const query = `
    SELECT r.ticket_id AS run_id, t.account_id, a.player_name, r.breaches, r.completion_tick, r.remaining_charge, r.accepted_at, se.commands
    FROM challenge_publications cp
    JOIN tickets t ON t.mode = 'challenge' AND t.source_id = cp.digest
    JOIN runs r ON r.ticket_id = t.id
    JOIN accounts a ON a.id = t.account_id
    LEFT JOIN staged_evidence se ON se.ticket_id = t.id
    WHERE ${where}
    ORDER BY r.accepted_at ASC
  `;
  const result = await client.query(query, params);
  const rows = result.rows as unknown as QualifyingRow[];

  // Best-only per account: fewer breaches, then lower completionTick, then greater remainingCharge.
  const bestPerAccount = new Map<string, QualifyingRow>();
  for (const row of rows) {
    const existing = bestPerAccount.get(row.account_id);
    if (!existing) {
      bestPerAccount.set(row.account_id, row);
      continue;
    }
    if (isBetter(row, existing)) {
      // Equal metrics keep the earliest committed result.
      if (!metricsEqual(row, existing)) bestPerAccount.set(row.account_id, row);
    }
  }
  const best = [...bestPerAccount.values()].sort((a, b) => {
    if (a.breaches !== b.breaches) return a.breaches - b.breaches;
    if (a.completion_tick !== b.completion_tick) return a.completion_tick - b.completion_tick;
    if (a.remaining_charge !== b.remaining_charge) return b.remaining_charge - a.remaining_charge;
    return a.account_id < b.account_id ? -1 : a.account_id > b.account_id ? 1 : 0;
  });

  const boardRows: BoardRowShape[] = [];
  let rank = 0;
  let position = 0;
  let previous: QualifyingRow | null = null;
  for (const row of best) {
    position++;
    const tied = previous !== null && metricsEqual(row, previous);
    if (!tied) rank = position;
    boardRows.push({
      rank,
      accountId: row.account_id,
      playerName: row.player_name,
      runId: row.run_id,
      breaches: row.breaches,
      completionTick: row.completion_tick,
      remainingCharge: row.remaining_charge,
    });
    previous = row;
  }

  // Crew usage from deploy commands in the selected best runs, including salvaged.
  const deployments = new Map<string, number>();
  for (const device of deviceOrder()) deployments.set(device, 0);
  let total = 0;
  for (const row of best) {
    for (const cmd of row.commands ?? []) {
      if (cmd.type === 'deploy' && typeof cmd.device === 'string' && deployments.has(cmd.device)) {
        deployments.set(cmd.device, (deployments.get(cmd.device) ?? 0) + 1);
        total++;
      }
    }
  }
  const usage = tenthsPercent(deployments, total);

  const personalBest = viewerAccountId ? boardRows.find((r) => r.accountId === viewerAccountId) ?? null : null;

  return {
    digest,
    ruleset: RULESET,
    rows: boardRows,
    personalBest,
    completions: bestPerAccount.size,
    crewUsage: usage,
  };
}

function isBetter(candidate: QualifyingRow, incumbent: QualifyingRow): boolean {
  if (candidate.breaches !== incumbent.breaches) return candidate.breaches < incumbent.breaches;
  if (candidate.completion_tick !== incumbent.completion_tick) return candidate.completion_tick < incumbent.completion_tick;
  return candidate.remaining_charge > incumbent.remaining_charge;
}

function metricsEqual(a: QualifyingRow, b: QualifyingRow): boolean {
  return a.breaches === b.breaches && a.completion_tick === b.completion_tick && a.remaining_charge === b.remaining_charge;
}

/** Largest-remainder conversion to tenths of a percent in device order. */
function tenthsPercent(counts: Map<string, number>, total: number): Array<{ device: string; deployments: number; tenthsPercent: number }> {
  if (total === 0) {
    return [...counts.entries()].map(([device, count]) => ({ device, deployments: count, tenthsPercent: 0 }));
  }
  const entries = [...counts.entries()];
  const base = entries.map(([, count]) => Math.floor((count * 1000) / total));
  let remainder = 1000 - base.reduce((sum, value) => sum + value, 0);
  const order = entries
    .map((entry, index) => ({ index, remainder: (entry[1] * 1000) % total }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  const extra = new Map<number, number>();
  let i = 0;
  while (remainder > 0 && order.length > 0) {
    extra.set(order[i % order.length].index, 1);
    remainder--;
    i++;
  }
  return entries.map(([device, count], index) => ({
    device,
    deployments: count,
    tenthsPercent: base[index] + (extra.get(index) ?? 0),
  }));
}

export { loadLevel };
