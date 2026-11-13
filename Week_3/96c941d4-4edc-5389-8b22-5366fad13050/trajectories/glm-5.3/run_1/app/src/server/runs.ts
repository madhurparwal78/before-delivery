import { Client } from 'pg';
import { newId } from './accounts.js';
import { canonicalize } from '../shared/canonical.js';
import { createHash } from 'node:crypto';
import {
  Definition,
  DeviceId,
  CAMPAIGN_ORDER,
  INITIAL_RESERVE,
  INITIAL_HEALTH,
  RULESET,
  campaignById,
} from '../shared/seed.js';
import { Command, Metrics, Failure, Transfer, Simulation } from '../shared/sim.js';
import { replayRun } from '../shared/run.js';
import * as objects from './objects.js';
import { withTransaction } from './db.js';
import { dailySelectionFor, seasonDayForNow } from './season.js';

export type RunMode = 'campaign' | 'playtest' | 'challenge';
export type RunState = 'issued' | 'playing' | 'submitted' | 'verifying' | 'accepted' | 'rejected';
export type ProofState = 'pending' | 'verifying' | 'qualified' | 'failed' | 'obsolete';

export interface TicketRow {
  id: string;
  account_id: string;
  mode: RunMode;
  source_id: string;
  revision: number | null;
  seed: number;
  level_digest: string;
  loadout: DeviceId[];
  ruleset: string;
  initial_reserve: number;
  initial_health: number;
  season_day: string | null;
  daily: boolean;
  definition: Definition;
  state: RunState;
}

export interface RunRow {
  ticket_id: string;
  state: RunState;
  evidence_digest: string | null;
  outcome: string | null;
  breaches: number | null;
  completion_tick: number | null;
  remaining_charge: number | null;
  health: number | null;
  failure_tick: number | null;
  failure_seq: number | null;
  failure_reason: string | null;
  ledger: Transfer[] | null;
}

export function digestCanonical(value: unknown): string {
  return createHash('sha256').update(Buffer.from(canonicalize(value), 'utf8')).digest('hex');
}

export function levelDigestOf(definition: Definition): string {
  return digestCanonical(definition);
}

export function challengeDigestOf(levelDigest: string, ruleset: string): string {
  return digestCanonical({ levelDigest, ruleset });
}

export function evidenceDigestOf(commands: Command[], endTick: number): string {
  return digestCanonical({ commands, endTick });
}

export async function campaignProgress(client: Client, accountId: string): Promise<{ completed: string[]; unlocked: string[] }> {
  const result = await client.query('SELECT encounter_id FROM completions WHERE account_id = $1', [accountId]);
  const completedSet = new Set(result.rows.map((r) => r.encounter_id as string));
  const completed = CAMPAIGN_ORDER.filter((id) => completedSet.has(id));
  const unlocked: string[] = [];
  for (const id of CAMPAIGN_ORDER) {
    unlocked.push(id);
    if (!completedSet.has(id)) break;
  }
  return { completed: [...completed], unlocked };
}

export async function isEncounterUnlocked(client: Client, accountId: string, encounterId: string): Promise<boolean> {
  const index = CAMPAIGN_ORDER.indexOf(encounterId as (typeof CAMPAIGN_ORDER)[number]);
  if (index === -1) return false;
  if (index === 0) return true;
  const preceding = CAMPAIGN_ORDER[index - 1];
  const result = await client.query(
    'SELECT 1 FROM completions WHERE account_id = $1 AND encounter_id = $2',
    [accountId, preceding],
  );
  return result.rowCount === 1;
}

export interface IssueTicketInput {
  mode: RunMode;
  sourceId: string;
  revision: number | null;
  loadout: DeviceId[];
}

export type IssueResult =
  | { kind: 'issued'; ticket: TicketRow }
  | { kind: 'locked' }
  | { kind: 'not-found' }
  | { kind: 'invalid-revision' }
  | { kind: 'invalid-mode' };

/**
 * Issues an immutable ticket bound to its owner, definition, seed, loadout,
 * source revision and ruleset. Season day is assigned for challenge tickets.
 */
export async function issueTicket(client: Client, accountId: string, input: IssueTicketInput): Promise<IssueResult> {
  const seasonDay = await seasonDayForNow(client);
  let definition: Definition;
  let seed: number;
  let levelDigest: string;
  let revision: number | null = null;
  let daily = false;

  if (input.mode === 'campaign') {
    if (input.revision !== null) return { kind: 'invalid-mode' };
    const encounter = campaignById(input.sourceId);
    if (!encounter) return { kind: 'not-found' };
    const unlocked = await isEncounterUnlocked(client, accountId, encounter.id);
    if (!unlocked) return { kind: 'locked' };
    definition = encounter.definition;
    seed = encounter.seed;
    levelDigest = levelDigestOf(definition);
  } else if (input.mode === 'playtest') {
    const level = await loadLevel(client, input.sourceId);
    if (!level || level.account_id !== accountId) return { kind: 'not-found' };
    const currentRevision = input.revision;
    if (currentRevision === null || currentRevision !== level.revision) return { kind: 'invalid-revision' };
    if (level.state !== 'private') return { kind: 'invalid-revision' };
    definition = level.definition;
    seed = level.definition.seed;
    levelDigest = level.level_digest;
    revision = level.revision;
  } else {
    // Challenge mode: sourceId is the challenge digest.
    const challenge = await loadPublishedChallenge(client, input.sourceId);
    if (!challenge) return { kind: 'not-found' };
    definition = challenge.definition;
    seed = challenge.definition.seed;
    levelDigest = challenge.level_digest;
    const dailyDigest = await dailySelectionFor(client, seasonDay);
    daily = dailyDigest !== null && dailyDigest === challenge.digest;
  }

  const id = newId('run');
  await client.query(
    `INSERT INTO tickets (id, account_id, mode, source_id, revision, seed, level_digest, loadout, ruleset,
      initial_reserve, initial_health, season_day, daily, definition, state)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'issued')`,
    [
      id, accountId, input.mode, input.sourceId, revision, seed, levelDigest,
      JSON.stringify(input.loadout), RULESET, INITIAL_RESERVE, INITIAL_HEALTH,
      input.mode === 'challenge' ? seasonDay : null, daily, JSON.stringify(definition),
    ],
  );
  return { kind: 'issued', ticket: await loadTicket(client, id) };
}

export async function loadTicket(client: Client, id: string): Promise<TicketRow> {
  const result = await client.query('SELECT * FROM tickets WHERE id = $1', [id]);
  return result.rows[0] as TicketRow;
}

export interface LevelRow {
  id: string;
  account_id: string;
  title: string;
  state: string;
  revision: number;
  definition: Definition;
  level_digest: string;
  challenge_digest: string | null;
  proof_run_id: string | null;
  ruleset: string;
}

export async function loadLevel(client: Client, id: string): Promise<LevelRow | null> {
  const result = await client.query('SELECT * FROM levels WHERE id = $1', [id]);
  if (result.rowCount === 0) return null;
  const row = result.rows[0];
  if (row.state === 'withdrawn') return null;
  return row as LevelRow;
}

export interface ChallengeRow {
  digest: string;
  level_id: string;
  ruleset: string;
  title: string;
  description: string;
  difficulty: string;
  creator_name: string;
  definition: Definition;
  level_digest: string;
  proof_run_id: string;
  unlisted: boolean;
}

export async function loadPublishedChallenge(client: Client, digest: string): Promise<ChallengeRow | null> {
  const result = await client.query('SELECT * FROM challenge_publications WHERE digest = $1', [digest]);
  const row = result.rows[0];
  if (!row || row.unlisted) return null;
  return row as ChallengeRow;
}

// ---------- Run state transitions (single source for the run table) ----------

export function runCanStart(state: RunState): boolean {
  return state === 'issued' || state === 'playing';
}

export function runCanStageEvidence(state: RunState): boolean {
  return state === 'playing';
}

export function runCanRetry(state: RunState): boolean {
  return state === 'submitted' || state === 'accepted' || state === 'rejected';
}

export async function loadRun(client: Client, ticketId: string): Promise<RunRow | null> {
  const result = await client.query('SELECT * FROM runs WHERE ticket_id = $1', [ticketId]);
  if (result.rowCount === 0) return null;
  return result.rows[0] as RunRow;
}

// ---------- Command checking (DP-11 server agreement) ----------

export interface CommandCheckOutcome {
  ok: boolean;
  reason?: string;
  commandState?: Record<string, unknown>;
}

/**
 * Reconstructs the prefix to atTick, applies prefix commands in supplied order
 * at that tick, then validates the proposal before spawning. Neither the
 * ticket nor staged evidence changes.
 */
export async function checkCommand(
  definition: Definition,
  loadout: DeviceId[],
  seed: number,
  commands: Command[],
  atTick: number,
  proposal: Command,
): Promise<CommandCheckOutcome> {
  // Build simulation through atTick by applying commands stamped < atTick in
  // order during replay; commands stamped atTick apply before the proposal.
  const sim = new Simulation(definition, loadout, INITIAL_RESERVE, INITIAL_HEALTH, seed);
  const prefixByTick = new Map<number, Command[]>();
  for (const cmd of commands) {
    const list = prefixByTick.get(cmd.tick) ?? [];
    list.push(cmd);
    prefixByTick.set(cmd.tick, list);
  }
  let prevSeq: number | null = null;
  let prevTick: number | null = null;
  while (sim.tick < atTick && !sim.terminal) {
    const tickCommands = prefixByTick.get(sim.tick) ?? [];
    for (const cmd of tickCommands) {
      const reason = sim.commandReason(cmd, prevSeq, prevTick);
      if (reason !== null) {
        return { ok: false, reason };
      }
      sim.applyLegalCommand(cmd);
      prevSeq = cmd.seq;
      prevTick = cmd.tick;
    }
    sim.resolveTick(sim.transferCount);
  }
  // Apply prefix commands stamped atTick before validating the proposal.
  const atTickCommands = prefixByTick.get(atTick) ?? [];
  for (const cmd of atTickCommands) {
    const reason = sim.commandReason(cmd, prevSeq, prevTick);
    if (reason !== null) {
      return { ok: false, reason };
    }
    sim.applyLegalCommand(cmd);
    prevSeq = cmd.seq;
    prevTick = cmd.tick;
  }
  const mark = sim.transferCount;
  // Validate proposal against the state at atTick.
  const proposalReason = sim.commandReason(proposal, prevSeq, prevTick);
  if (proposalReason !== null) {
    return { ok: false, reason: proposalReason };
  }
  // Apply the proposal; produce CommandState with phase after-commands.
  sim.applyLegalCommand(proposal);
  const state = sim.commandStateSnapshot(mark);
  return { ok: true, commandState: { ...state, phase: 'after-commands' } };
}

// ---------- Submission and verification ----------

export interface SubmitOutcome {
  status: 200 | 202;
  result: Record<string, unknown>;
}

export interface SubmitFailure {
  status: number;
  code: string;
  message?: string;
  fields?: Record<string, string>;
}

/**
 * Stages canonical evidence (first durable staging owns the ticket), then
 * verifies: reads both stored objects back, validates digests, reproduces play
 * from tick zero, and commits exactly one terminal result.
 */
export async function submitEvidence(
  ticketId: string,
  accountId: string,
  commands: Command[],
  endTick: number,
): Promise<SubmitOutcome | SubmitFailure> {
  const digest = evidenceDigestOf(commands, endTick);

  const outcome = await withTransaction(async (client): Promise<(SubmitOutcome & { restore?: true }) | (SubmitFailure & { staged?: true })> => {
    const ticket = await client.query('SELECT * FROM tickets WHERE id = $1 FOR UPDATE', [ticketId]);
    const ticketRow = ticket.rows[0] as TicketRow | undefined;
    if (!ticketRow || ticketRow.account_id !== accountId) {
      return { status: 404, code: 'NOT_FOUND' } as SubmitFailure;
    }
    const runResult = await client.query('SELECT * FROM runs WHERE ticket_id = $1 FOR UPDATE', [ticketId]);
    const run = runResult.rows[0] as RunRow | undefined;

    if (run && (run.state === 'accepted' || run.state === 'rejected')) {
      // Identical evidence or retry returns the stored result.
      const staged = await client.query('SELECT evidence_digest FROM staged_evidence WHERE ticket_id = $1', [ticketId]);
      const stagedDigest = staged.rows[0]?.evidence_digest as string | undefined;
      if (stagedDigest && stagedDigest === digest) {
        return { status: 200, result: resultShape(run), restore: true } as SubmitOutcome & { restore: true };
      }
      return { status: 409, code: 'EVIDENCE_CONFLICT' } as SubmitFailure;
    }

    if (!run || run.state === 'issued') {
      return { status: 409, code: 'INVALID_TRANSITION' } as SubmitFailure;
    }

    // First durable staging owns the ticket.
    const staged = await client.query('SELECT evidence_digest FROM staged_evidence WHERE ticket_id = $1', [ticketId]);
    if (staged.rows[0]) {
      const stagedDigest = staged.rows[0].evidence_digest as string;
      if (stagedDigest !== digest) {
        return { status: 409, code: 'EVIDENCE_CONFLICT' } as SubmitFailure;
      }
    } else {
      await client.query(
        'INSERT INTO staged_evidence (ticket_id, evidence_digest, commands, end_tick) VALUES ($1,$2,$3,$4)',
        [ticketId, digest, JSON.stringify(commands), endTick],
      );
    }

    // Transition to submitted if currently playing.
    if (run.state === 'playing' || run.state === 'submitted') {
      await client.query(
        `INSERT INTO runs (ticket_id, state, evidence_digest, updated_at) VALUES ($1,'submitted',$2,now())
         ON CONFLICT (ticket_id) DO UPDATE SET state='submitted', evidence_digest=$2, updated_at=now()`,
        [ticketId, digest],
      );
    }
    return { status: 202, result: { ...pendingResult(digest), runId: ticketId }, staged: true };
  });
  // Retry on an already-terminal result restores any absent objects from the
  // authoritative staged bytes before returning the stored result.
  if ('restore' in outcome && outcome.restore) {
    const evidenceBytes = Buffer.from(canonicalize({ commands, endTick }), 'utf8');
    const stored = await objects.putObjectIfAbsent(objects.evidenceKey(digest), new Uint8Array(evidenceBytes));
    const definitionRow = await withTransaction(async (client) => {
      const row = await client.query('SELECT definition FROM tickets WHERE id = $1', [ticketId]);
      return row.rows[0].definition as Definition;
    });
    const definitionBytes = Buffer.from(canonicalize(definitionRow), 'utf8');
    await objects.putObjectIfAbsent(objects.levelsKey(levelDigestOf(definitionRow)), new Uint8Array(definitionBytes));
    if (stored.ok) {
      return { status: 200, result: outcome.result };
    }
    // The stored result remains authoritative even if restoration fails.
    return { status: 200, result: outcome.result };
  }
  if ('code' in outcome) return outcome;
  if (!('staged' in outcome)) return outcome;
  // Stage committed: attempt verification outside the transaction. Object
  // writes happen first; an object failure leaves staged work pending.
  const evidenceBytes = Buffer.from(canonicalize({ commands, endTick }), 'utf8');
  const stored = await objects.putObjectIfAbsent(objects.evidenceKey(digest), new Uint8Array(evidenceBytes));
  if (!stored.ok) {
    return { status: 202, result: { ...pendingResult(digest), runId: ticketId } };
  }
  const definition = await withTransaction(async (client) => {
    const row = await client.query('SELECT definition FROM tickets WHERE id = $1', [ticketId]);
    return row.rows[0].definition as Definition;
  });
  const definitionBytes = Buffer.from(canonicalize(definition), 'utf8');
  const levelDigest = levelDigestOf(definition);
  const defStored = await objects.putObjectIfAbsent(objects.levelsKey(levelDigest), new Uint8Array(definitionBytes));
  if (!defStored.ok) {
    return { status: 202, result: { ...pendingResult(digest), runId: ticketId } };
  }
  const verify = await verifyEvidence(ticketId, digest);
  if (verify) {
    return { status: 200, result: verify };
  }
  return { status: 202, result: { ...pendingResult(digest), runId: ticketId } };
}

export function pendingResult(digest: string): Record<string, unknown> {
  return { runId: '', state: 'submitted', evidenceDigest: digest, metrics: null, failure: null };
}

export function resultShape(run: RunRow): Record<string, unknown> {
  return {
    runId: run.ticket_id,
    state: run.state,
    evidenceDigest: run.evidence_digest,
    metrics:
      run.state === 'accepted'
        ? { outcome: run.outcome, breaches: run.breaches, completionTick: run.completion_tick, remainingCharge: run.remaining_charge, health: run.health }
        : null,
    failure:
      run.state === 'rejected'
        ? { tick: run.failure_tick, seq: run.failure_seq, reason: run.failure_reason }
        : null,
  };
}

/**
 * Independent reproduction: reads stored evidence and definition objects,
 * validates digests and simulates from tick zero. Returns the terminal result
 * shape when committed, or null when evidence is unavailable.
 */
export async function verifyEvidence(
  ticketId: string,
  digest: string,
): Promise<Record<string, unknown> | null> {
  return withTransaction(async (client) => {
    const ticketResult = await client.query('SELECT * FROM tickets WHERE id = $1 FOR UPDATE', [ticketId]);
    const ticket = ticketResult.rows[0] as TicketRow | undefined;
    if (!ticket) return null;
    const runResult = await client.query('SELECT * FROM runs WHERE ticket_id = $1 FOR UPDATE', [ticketId]);
    const run = runResult.rows[0] as RunRow | undefined;
    if (!run || run.state !== 'submitted') {
      if (run && (run.state === 'accepted' || run.state === 'rejected')) {
        return resultShape(run);
      }
      return null;
    }

    // Object reads: confirmed immutable evidence and definition.
    const evidenceObject = await objects.getObject(objects.evidenceKey(digest));
    if (!evidenceObject.ok || !evidenceObject.bytes) return null;
    const evidenceText = Buffer.from(evidenceObject.bytes).toString('utf8');
    if (digestCanonical(JSON.parse(evidenceText)) !== digest) return null;

    const definitionObject = await objects.getObject(objects.levelsKey(ticket.level_digest));
    if (!definitionObject.ok || !definitionObject.bytes) return null;
    const definitionCheck = JSON.parse(Buffer.from(definitionObject.bytes).toString('utf8')) as Definition;
    if (levelDigestOf(definitionCheck) !== ticket.level_digest) return null;

    // Reproduce from tick zero with the stored commands.
    const evidence = JSON.parse(evidenceText) as { commands: Command[]; endTick: number };
    const reproduction = replayRun(
      definitionCheck,
      ticket.loadout,
      ticket.seed,
      evidence.commands,
      evidence.endTick,
      { collectFrames: false },
    );

    if (reproduction.failure || !reproduction.metrics) {
      await commitResult(client, ticket, {
        state: 'rejected',
        failure: reproduction.failure,
        ledger: reproduction.ledger,
      });
    } else {
      await commitAccepted(client, ticket, {
        metrics: reproduction.metrics,
        ledger: reproduction.ledger,
      });
    }
    const stored = await loadRun(client, ticketId);
    return stored ? resultShape(stored) : null;
  }).catch((e) => {
    if (process.env.SQUALLGLASS_DEBUG === '1') {
      console.error('verifyEvidence failure:', e);
    }
    return null;
  });
}

interface CommitAcceptedInput {
  metrics: Metrics;
  ledger: Transfer[];
}

async function commitAccepted(client: Client, ticket: TicketRow, input: CommitAcceptedInput): Promise<void> {
  await client.query(
    `UPDATE runs SET state='accepted', outcome=$2, breaches=$3, completion_tick=$4, remaining_charge=$5,
      health=$6, failure_tick=NULL, failure_seq=NULL, failure_reason=NULL, ledger=$7, accepted_at=now(), updated_at=now()
     WHERE ticket_id=$1 AND state='submitted'`,
    [
      ticket.id,
      input.metrics.outcome,
      input.metrics.breaches,
      input.metrics.completionTick,
      input.metrics.remainingCharge,
      input.metrics.health,
      JSON.stringify(input.ledger),
    ],
  );
  // Accepted effects commit with the result in one transaction: campaign
  // completion and qualifying proof state.
  if (ticket.mode === 'campaign' && input.metrics.outcome === 'victory') {
    await client.query(
      'INSERT INTO completions (account_id, encounter_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [ticket.account_id, ticket.source_id],
    );
  }
  if (ticket.mode === 'playtest' && input.metrics.outcome === 'victory') {
    const level = await loadLevel(client, ticket.source_id);
    if (level && level.revision === ticket.revision && level.proof_run_id === null) {
      await client.query(
        `INSERT INTO proofs (run_id, level_id, revision, state) VALUES ($1,$2,$3,'qualified')
         ON CONFLICT (run_id) DO UPDATE SET state='qualified', updated_at=now()`,
        [ticket.id, level.id, level.revision],
      );
      await client.query('UPDATE levels SET proof_run_id=$1 WHERE id=$2 AND proof_run_id IS NULL', [ticket.id, level.id]);
    }
  }
}

async function commitResult(client: Client, ticket: TicketRow, input: { state: 'rejected'; failure: Failure | null; ledger: Transfer[] }): Promise<void> {
  await client.query(
    `UPDATE runs SET state='rejected', outcome=NULL, breaches=NULL, completion_tick=NULL, remaining_charge=NULL,
      health=NULL, failure_tick=$2, failure_seq=$3, failure_reason=$4, ledger=$5, updated_at=now()
     WHERE ticket_id=$1 AND state='submitted'`,
    [ticket.id, input.failure?.tick ?? null, input.failure?.seq ?? null, input.failure?.reason ?? null, JSON.stringify(input.ledger)],
  );
  if (ticket.mode === 'playtest') {
    await client.query(
      `INSERT INTO proofs (run_id, level_id, revision, state) VALUES ($1,$2,$3,'failed')
       ON CONFLICT (run_id) DO UPDATE SET state='failed', updated_at=now()`,
      [ticket.id, ticket.source_id, ticket.revision ?? 0],
    );
  }
}

export { objects };
