import { randomBytes, createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Client, Database } from './db.js';
import { UNIQUE_VIOLATION, pgCode } from './db.js';
import { ApiError } from './errors.js';
import type { Command, Definition, Failure, Metrics, Ticket, Transfer } from '../shared/types.js';
import { runSources, challengeDestination, proofSources } from './transitions.js';
import type { LevelState, ProofState, RunState } from './transitions.js';

export interface AccountRecord {
  id: string;
  email: string;
  playerName: string;
}

export interface LevelRecord {
  id: string;
  accountId: string;
  revision: number;
  state: LevelState;
  definition: Definition;
  digest: string;
  proofRunId: string | null;
  challengeDigest: string | null;
  pendingProofRunId: string | null;
}

export interface ProofRecord {
  runId: string;
  levelId: string;
  accountId: string;
  revision: number;
  state: ProofState;
}

export interface RunRecord {
  id: string;
  accountId: string;
  state: RunState;
  evidenceDigest: string | null;
  commands: Command[] | null;
  endTick: number | null;
  metrics: Metrics | null;
  failure: Failure | null;
  lastAvailableTick: number | null;
}

export interface ChallengeRecord {
  digest: string;
  levelId: string;
  accountId: string;
  ruleset: string;
  levelDigest: string;
  title: string;
  description: string;
  difficulty: string;
  creatorName: string;
  definition: Definition;
  proofRunId: string;
  listed: boolean;
}

interface PresentationRecord {
  runId: string;
  version: number;
  tick: number;
  playing: boolean;
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('hex')}`;
}

const SCRYPT_KEY_LENGTH = 32;

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, SCRYPT_KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, digestHex] = stored.split('$');
  if (scheme !== 'scrypt') return false;
  const derived = scryptSync(password, Buffer.from(saltHex, 'hex'), SCRYPT_KEY_LENGTH);
  const expected = Buffer.from(digestHex, 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

interface AccountRow {
  id: string;
  email: string;
  player_name: string;
  password_hash: string;
}

interface LevelRow {
  id: string;
  account_id: string;
  revision: number;
  state: LevelState;
  definition: Definition;
  digest: string;
  proof_run_id: string | null;
  challenge_digest: string | null;
  pending_proof_run_id: string | null;
}

interface TicketRow {
  id: string;
  account_id: string;
  mode: Ticket['mode'];
  source_id: string;
  revision: number | null;
  seed: number;
  level_digest: string;
  loadout: string[];
  ruleset: string;
  initial_reserve: number;
  initial_health: number;
  season_day: string | null;
  daily: boolean;
  definition: Definition;
  challenge_digest: string | null;
}

interface RunRow {
  id: string;
  account_id: string;
  state: RunState;
  evidence_digest: string | null;
  commands: Command[] | null;
  end_tick: number | null;
  outcome: Metrics['outcome'] | null;
  breaches: number | null;
  completion_tick: number | null;
  remaining_charge: number | null;
  health: number | null;
  failure: Failure | null;
  last_available_tick: number | null;
}

interface ChallengeRow {
  digest: string;
  level_id: string;
  account_id: string;
  ruleset: string;
  level_digest: string;
  title: string;
  description: string;
  difficulty: string;
  creator_name: string;
  definition: Definition;
  proof_run_id: string;
  listed: boolean;
}

function toLevel(row: LevelRow): LevelRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    revision: row.revision,
    state: row.state,
    definition: row.definition,
    digest: row.digest,
    proofRunId: row.proof_run_id,
    challengeDigest: row.challenge_digest,
    pendingProofRunId: row.pending_proof_run_id,
  };
}

function toTicket(row: TicketRow): Ticket & { definition: Definition; challengeDigest: string | null } {
  return {
    id: row.id,
    accountId: row.account_id,
    mode: row.mode,
    sourceId: row.source_id,
    revision: row.revision,
    seed: row.seed,
    levelDigest: row.level_digest,
    loadout: row.loadout,
    ruleset: row.ruleset,
    initialReserve: row.initial_reserve,
    initialHealth: row.initial_health,
    seasonDay: row.season_day,
    daily: row.daily,
    definition: row.definition,
    challengeDigest: row.challenge_digest,
  };
}

function toRun(row: RunRow): RunRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    state: row.state,
    evidenceDigest: row.evidence_digest,
    commands: row.commands,
    endTick: row.end_tick,
    metrics: row.outcome === null ? null : { outcome: row.outcome, breaches: row.breaches as number,
      completionTick: row.completion_tick as number, remainingCharge: row.remaining_charge as number, health: row.health as number },
    failure: row.failure,
    lastAvailableTick: row.last_available_tick,
  };
}

function toChallenge(row: ChallengeRow): ChallengeRecord {
  return {
    digest: row.digest,
    levelId: row.level_id,
    accountId: row.account_id,
    ruleset: row.ruleset,
    levelDigest: row.level_digest,
    title: row.title,
    description: row.description,
    difficulty: row.difficulty,
    creatorName: row.creator_name,
    definition: row.definition,
    proofRunId: row.proof_run_id,
    listed: row.listed,
  };
}

export type StoredTicket = Ticket & { definition: Definition; challengeDigest: string | null };

export class Store {
  constructor(private readonly db: Database) {}

  async createAccount(
    email: string,
    normalized: string,
    playerName: string,
    password: string,
  ): Promise<AccountRecord> {
    const id = newId('acc');
    try {
      await this.db.query(
        'INSERT INTO accounts (id, email, email_normalized, player_name, password_hash) VALUES ($1,$2,$3,$4,$5)',
        [id, email, normalized, playerName, hashPassword(password)],
      );
    } catch (error) {
      if (pgCode(error) === UNIQUE_VIOLATION) throw new ApiError('EMAIL_EXISTS');
      throw error;
    }
    return { id, email, playerName };
  }

  async accountByEmail(normalized: string): Promise<(AccountRecord & { passwordHash: string }) | null> {
    const result = await this.db.query<AccountRow>(
      'SELECT id, email, player_name, password_hash FROM accounts WHERE email_normalized = $1',
      [normalized],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return { id: row.id, email: row.email, playerName: row.player_name, passwordHash: row.password_hash };
  }

  async createSession(accountId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.db.query('INSERT INTO sessions (token_hash, account_id) VALUES ($1,$2)', [
      hashToken(token),
      accountId,
    ]);
    return token;
  }

  async accountForToken(token: string): Promise<AccountRecord | null> {
    const result = await this.db.query<AccountRow>(
      `SELECT a.id, a.email, a.player_name, a.password_hash FROM sessions s
       JOIN accounts a ON a.id = s.account_id
       WHERE s.token_hash = $1 AND s.revoked = false`,
      [hashToken(token)],
    );
    const row = result.rows[0];
    return row === undefined ? null : { id: row.id, email: row.email, playerName: row.player_name };
  }

  async revokeSession(token: string): Promise<void> {
    await this.db.query('UPDATE sessions SET revoked = true WHERE token_hash = $1', [hashToken(token)]);
  }

  async insertLevel(accountId: string, definition: Definition, digest: string): Promise<LevelRecord> {
    const id = newId('lvl');
    await this.db.transaction(async (client) => {
    await client.query(
      `INSERT INTO levels (id, account_id, revision, state, title, definition, digest)
       VALUES ($1,$2,1,'private',$3,$4,$5)`,
      [id, accountId, definition.title, JSON.stringify(definition), digest],
    );
    await client.query('INSERT INTO level_revisions (level_id, revision, definition, digest) VALUES ($1,1,$2,$3)', [id, JSON.stringify(definition), digest]);
    });
    return (await this.level(id)) as LevelRecord;
  }

  async level(id: string): Promise<LevelRecord | null> {
    const result = await this.db.query<LevelRow>('SELECT * FROM levels WHERE id = $1', [id]);
    const row = result.rows[0];
    return row === undefined ? null : toLevel(row);
  }

  async levelsOf(accountId: string): Promise<LevelRecord[]> {
    const result = await this.db.query<LevelRow>(
      `SELECT * FROM levels WHERE account_id = $1 AND state <> 'withdrawn' ORDER BY title, id`,
      [accountId],
    );
    return result.rows.map(toLevel);
  }

  async proofsOf(levelId: string): Promise<ProofRecord[]> {
    const result = await this.db.query<{
      run_id: string;
      level_id: string;
      account_id: string;
      revision: number;
      state: ProofState;
    }>('SELECT * FROM proofs WHERE level_id = $1 ORDER BY run_id', [levelId]);
    return result.rows.map((row) => ({
      runId: row.run_id,
      levelId: row.level_id,
      accountId: row.account_id,
      revision: row.revision,
      state: row.state,
    }));
  }

  async proof(runId: string): Promise<ProofRecord | null> {
    const result = await this.db.query<{
      run_id: string;
      level_id: string;
      account_id: string;
      revision: number;
      state: ProofState;
    }>('SELECT * FROM proofs WHERE run_id = $1', [runId]);
    const row = result.rows[0];
    return row === undefined
      ? null
      : {
          runId: row.run_id,
          levelId: row.level_id,
          accountId: row.account_id,
          revision: row.revision,
          state: row.state,
        };
  }

  async insertTicketAndRun(
    ticket: StoredTicket,
    proof: { levelId: string; revision: number } | null,
  ): Promise<void> {
    await this.db.transaction(async (client) => {
      if (ticket.mode === 'challenge') {
        const challenge = await client.query<{listed: boolean}>('SELECT listed FROM challenges WHERE digest = $1 FOR SHARE', [ticket.challengeDigest]);
        if (challenge.rows[0] === undefined || !challenge.rows[0].listed) throw new ApiError('NOT_FOUND');
      }
      if (proof !== null) {
        const current = await client.query<{revision: number; state: string}>('SELECT revision, state FROM levels WHERE id = $1 FOR UPDATE', [proof.levelId]);
        challengeDestination(current.rows[0].state as LevelState, 'edit');
        if (current.rows[0].revision !== proof.revision) throw new ApiError('REVISION_CHANGED');
      }
      await client.query(
        `INSERT INTO tickets (id, account_id, mode, source_id, revision, seed, level_digest, loadout,
           ruleset, initial_reserve, initial_health, season_day, daily, definition, challenge_digest)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          ticket.id,
          ticket.accountId,
          ticket.mode,
          ticket.sourceId,
          ticket.revision,
          ticket.seed,
          ticket.levelDigest,
          JSON.stringify(ticket.loadout),
          ticket.ruleset,
          ticket.initialReserve,
          ticket.initialHealth,
          ticket.seasonDay,
          ticket.daily,
          JSON.stringify(ticket.definition),
          ticket.challengeDigest,
        ],
      );
      await client.query(`INSERT INTO runs (id, account_id, state) VALUES ($1,$2,'issued')`, [
        ticket.id,
        ticket.accountId,
      ]);
      if (proof !== null) {
        await client.query(
          `INSERT INTO proofs (run_id, level_id, account_id, revision, state) VALUES ($1,$2,$3,$4,'pending')`,
          [ticket.id, proof.levelId, ticket.accountId, proof.revision],
        );
      }
    });
  }

  async ticket(id: string): Promise<StoredTicket | null> {
    const result = await this.db.query<TicketRow>('SELECT * FROM tickets WHERE id = $1', [id]);
    const row = result.rows[0];
    return row === undefined ? null : toTicket(row);
  }

  async run(id: string): Promise<RunRecord | null> {
    const result = await this.db.query<RunRow>('SELECT * FROM runs WHERE id = $1', [id]);
    const row = result.rows[0];
    return row === undefined ? null : toRun(row);
  }

  async ledger(runId: string): Promise<Transfer[]> {
    const result = await this.db.query<{
      movement_id: number;
      tick: number;
      account: string;
      delta: number;
      reason: Transfer['reason'];
      device_id: number | null;
    }>(
      'SELECT movement_id, tick, account, delta, reason, device_id FROM ledger_entries WHERE run_id = $1 ORDER BY ordinal',
      [runId],
    );
    return result.rows.map((row) => ({
      movementId: row.movement_id,
      tick: row.tick,
      account: row.account,
      delta: row.delta,
      reason: row.reason,
      deviceId: row.device_id,
    }));
  }

  async startRun(id: string): Promise<void> {
    await this.db.query(`UPDATE runs SET state = 'playing' WHERE id = $1 AND state = ANY($2::text[])`, [id, runSources.start]);
  }

  /** Durably stages the first canonical evidence for a playing run. */
  async stageEvidence(
    id: string,
    digest: string,
    commands: Command[],
    endTick: number,
  ): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE runs SET state = 'submitted', evidence_digest = $2, commands = $3, end_tick = $4
       WHERE id = $1 AND state = ANY($5::text[])`,
      [id, digest, JSON.stringify(commands), endTick, runSources.stage],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async beginVerification(id: string): Promise<void> {
    await this.db.transaction(async (client) => {
      const updated = await client.query(
        `UPDATE runs SET state = 'verifying' WHERE id = $1 AND state = ANY($2::text[])`,
        [id, runSources.begin],
      );
      if ((updated.rowCount ?? 0) === 1) {
        await client.query(`UPDATE proofs SET state = 'verifying' WHERE run_id = $1 AND state = ANY($2::text[])`, [
          id, proofSources.begin,
        ]);
      }
    });
  }

  async returnToSubmitted(id: string): Promise<void> {
    await this.db.transaction(async (client) => {
      await client.query(`UPDATE runs SET state = 'submitted' WHERE id = $1 AND state = ANY($2::text[])`, [id, runSources.resume]);
      await client.query(`UPDATE proofs SET state = 'pending' WHERE run_id = $1 AND state = ANY($2::text[])`, [
        id, proofSources.resume,
      ]);
    });
  }

  async challenge(digest: string): Promise<ChallengeRecord | null> {
    const result = await this.db.query<ChallengeRow>('SELECT * FROM challenges WHERE digest = $1', [digest]);
    const row = result.rows[0];
    return row === undefined ? null : toChallenge(row);
  }

  async challengeForLevel(levelId: string): Promise<ChallengeRecord | null> {
    const result = await this.db.query<ChallengeRow>('SELECT * FROM challenges WHERE level_id = $1', [
      levelId,
    ]);
    const row = result.rows[0];
    return row === undefined ? null : toChallenge(row);
  }

  async challengesByDigests(digests: string[]): Promise<ChallengeRecord[]> {
    if (digests.length === 0) return [];
    const result = await this.db.query<ChallengeRow>(
      'SELECT * FROM challenges WHERE digest = ANY($1::text[]) AND listed = true',
      [digests],
    );
    return result.rows.map(toChallenge);
  }

  async listedDigests(): Promise<string[]> {
    const result = await this.db.query<{ digest: string }>(
      'SELECT digest FROM challenges WHERE listed = true ORDER BY digest',
    );
    return result.rows.map((row) => row.digest);
  }

  async challengeCompletions(digest: string): Promise<number> {
    const result = await this.db.query<{ count: number }>(
      `SELECT count(DISTINCT r.account_id)::int8 AS count FROM runs r JOIN tickets t ON t.id = r.id
       WHERE t.challenge_digest = $1 AND t.mode = 'challenge' AND r.state = 'accepted'
         AND r.outcome = 'victory'`,
      [digest],
    );
    return result.rows[0].count;
  }

  async qualifyingResults(
    digest: string,
    seasonDay: string | null,
  ): Promise<
    {
      runId: string;
      accountId: string;
      playerName: string;
      metrics: Metrics;
      commitSeq: number;
      commands: Command[];
    }[]
  > {
    const result = await this.db.query<{
      id: string;
      account_id: string;
      player_name: string;
      metrics: Metrics;
      commit_seq: number;
      commands: Command[];
    }>(
      `SELECT r.id, r.account_id, a.player_name, jsonb_build_object('outcome',r.outcome,'breaches',r.breaches,'completionTick',r.completion_tick,'remainingCharge',r.remaining_charge,'health',r.health) AS metrics, r.commit_seq, r.commands
       FROM runs r
       JOIN tickets t ON t.id = r.id
       JOIN accounts a ON a.id = r.account_id
       WHERE t.mode = 'challenge' AND t.challenge_digest = $1 AND r.state = 'accepted'
         AND r.outcome = 'victory'
         AND ($2::text IS NULL OR (t.daily = true AND t.season_day = $2))
       ORDER BY r.commit_seq`,
      [digest, seasonDay],
    );
    return result.rows.map((row) => ({
      runId: row.id,
      accountId: row.account_id,
      playerName: row.player_name,
      metrics: row.metrics,
      commitSeq: row.commit_seq,
      commands: row.commands,
    }));
  }

  async completedEncounters(accountId: string): Promise<string[]> {
    const result = await this.db.query<{ encounter_id: string }>(
      'SELECT encounter_id FROM completions WHERE account_id = $1',
      [accountId],
    );
    return result.rows.map((row) => row.encounter_id);
  }

  /** Freezes the daily selection for a season day inside one transaction. */
  async freezeDailySelection(
    seasonDay: string,
    select: (digests: string[]) => string | null,
  ): Promise<string | null> {
    return this.db.transaction(async (client) => {
      const existing = await client.query<{ digest: string | null }>(
        'SELECT digest FROM daily_selection WHERE season_day = $1',
        [seasonDay],
      );
      if (existing.rows[0] !== undefined) return existing.rows[0].digest;
      const published = await client.query<{ digest: string }>(
        'SELECT digest FROM challenges WHERE listed = true',
      );
      const chosen = select(published.rows.map((row) => row.digest));
      await client.query(
        'INSERT INTO daily_selection (season_day, digest) VALUES ($1,$2) ON CONFLICT (season_day) DO NOTHING',
        [seasonDay, chosen],
      );
      const settled = await client.query<{ digest: string | null }>(
        'SELECT digest FROM daily_selection WHERE season_day = $1',
        [seasonDay],
      );
      return settled.rows[0].digest;
    });
  }

  async dailyVictoryDays(accountId: string): Promise<Set<string>> {
    const result = await this.db.query<{ season_day: string }>(
      `SELECT DISTINCT t.season_day FROM runs r JOIN tickets t ON t.id = r.id
       WHERE r.account_id = $1 AND t.daily = true AND r.state = 'accepted'
         AND r.outcome = 'victory' AND t.season_day IS NOT NULL`,
      [accountId],
    );
    return new Set(result.rows.map((row) => row.season_day));
  }

  async presentation(runId: string): Promise<PresentationRecord | null> {
    const result = await this.db.query<{
      run_id: string;
      version: number;
      tick: number;
      playing: boolean;
    }>('SELECT * FROM presentations WHERE run_id = $1', [runId]);
    const row = result.rows[0];
    return row === undefined
      ? null
      : { runId: row.run_id, version: row.version, tick: row.tick, playing: row.playing };
  }

  async updatePresentation(
    runId: string,
    expectedVersion: number,
    tick: number,
    playing: boolean,
  ): Promise<PresentationRecord | null> {
    const result = await this.db.query<{ version: number; tick: number; playing: boolean }>(
      `UPDATE presentations SET version = version + 1, tick = $3, playing = $4
       WHERE run_id = $1 AND version = $2 RETURNING version, tick, playing`,
      [runId, expectedVersion, tick, playing],
    );
    const row = result.rows[0];
    return row === undefined ? null : { runId, version: row.version, tick: row.tick, playing: row.playing };
  }

  /** Reads shared presentation and qualifying results from one database snapshot. */
  async snapshotSources(
    runId: string,
    digest: string | null,
  ): Promise<{
    presentation: PresentationRecord;
    results: {
      runId: string;
      accountId: string;
      playerName: string;
      metrics: Metrics;
      commitSeq: number;
      commands: Command[];
    }[];
  }> {
    return this.db.transaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const presentation = await client.query<{
        run_id: string;
        version: number;
        tick: number;
        playing: boolean;
      }>('SELECT * FROM presentations WHERE run_id = $1', [runId]);
      const row = presentation.rows[0];
      const results =
        digest === null
          ? { rows: [] as never[] }
          : await client.query<{
              id: string;
              account_id: string;
              player_name: string;
              metrics: Metrics;
              commit_seq: number;
              commands: Command[];
            }>(
              `SELECT r.id, r.account_id, a.player_name, jsonb_build_object('outcome',r.outcome,'breaches',r.breaches,'completionTick',r.completion_tick,'remainingCharge',r.remaining_charge,'health',r.health) AS metrics, r.commit_seq, r.commands
               FROM runs r JOIN tickets t ON t.id = r.id JOIN accounts a ON a.id = r.account_id
               WHERE t.mode = 'challenge' AND t.challenge_digest = $1 AND r.state = 'accepted'
                 AND r.outcome = 'victory' ORDER BY r.commit_seq`,
              [digest],
            );
      return {
        presentation: { runId, version: row.version, tick: row.tick, playing: row.playing },
        results: results.rows.map((result) => ({
          runId: result.id,
          accountId: result.account_id,
          playerName: result.player_name,
          metrics: result.metrics,
          commitSeq: result.commit_seq,
          commands: result.commands,
        })),
      };
    });
  }

  async pendingIndexWork(): Promise<{ digest: string; operation: 'upsert' | 'delete' }[]> {
    const result = await this.db.query<{ digest: string; operation: 'upsert' | 'delete' }>(
      'SELECT digest, operation FROM index_work WHERE confirmed = false ORDER BY updated_at',
    );
    return result.rows;
  }

  async confirmIndexWork(digest: string, operation: string): Promise<void> {
    await this.db.query(
      'UPDATE index_work SET confirmed = true WHERE digest = $1 AND operation = $2 AND confirmed = false',
      [digest, operation],
    );
  }

  async indexingPending(): Promise<boolean> {
    const result = await this.db.query<{ count: number }>(
      'SELECT count(*)::int8 AS count FROM index_work WHERE confirmed = false',
    );
    return result.rows[0].count > 0;
  }

  transaction<T>(work: (client: Client) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }
}

/** Records committed discovery work for later provider confirmation. */
export async function recordIndexWork(
  client: Client,
  digest: string,
  operation: 'upsert' | 'delete',
): Promise<void> {
  await client.query(
    `INSERT INTO index_work (digest, operation, confirmed, updated_at) VALUES ($1,$2,false,now())
     ON CONFLICT (digest) DO UPDATE SET operation = $2, confirmed = false, updated_at = now()`,
    [digest, operation],
  );
}
