import pg from 'pg';
import { randomUuid } from './http.js';
import { sha256Hex, roundHalfUp2 } from '../shared/format.js';
import type { LogEntry } from '../shared/engine.js';

// PostgreSQL access: the one source of truth.

export interface TypistRow {
  id: string;
  email: string;
  name: string;
  verified: boolean;
  passwordHash: string;
}

export interface SettingsRow {
  theme: string;
  caret: string;
  smoothCaret: boolean;
  fontSize: number;
  blindMode: boolean;
  quickRestart: string;
}

export interface TicketRow {
  ticketId: string;
  typistId: string | null;
  mode: 'time' | 'words' | 'quote' | 'custom';
  length: number | null;
  punctuation: boolean;
  numbers: boolean;
  words: string[];
  seed: number | null;
  quoteId: string | null;
  expiresAt: Date;
  submittedRunId: string | null;
}

export interface RunRow {
  runId: string;
  typistId: string;
  ticketId: string;
  mode: string;
  length: number | null;
  punctuation: boolean;
  numbers: boolean;
  quoteId: string | null;
  words: string[];
  log: unknown;
  verdict: 'counted' | 'not_counted';
  reason: string | null;
  durationMs: number | null;
  speed: number | null;
  raw: number | null;
  accuracy: number | null;
  consistency: number | null;
  characters: { correct: number; incorrect: number; extra: number; missed: number } | null;
  errorsByKey: Record<string, number> | null;
  perSecond: { second: number; speed: number; raw: number; errors: number }[] | null;
  personalBest: boolean;
  finishedAt: Date;
  proofKey: string | null;
}

export interface BoardRow {
  rank: number;
  name: string;
  speed: number;
  accuracy: number;
  finishedAt: Date;
  typistId: string;
}

export interface StoredResponse {
  status: number;
  body: Record<string, unknown>;
}

export class Store {
  private readonly pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  query<T extends pg.QueryResultRow>(text: string, values?: readonly unknown[]): Promise<pg.QueryResult<T>> {
    return this.pool.query<T>(text, values as unknown[]);
  }

  // Typists and sessions.

  async typistByEmail(email: string): Promise<TypistRow | null> {
    const r = await this.query('SELECT id, email, name, verified, password_hash FROM typists WHERE lower(email) = lower($1)', [email]);
    return r.rows[0] === undefined ? null : mapTypist(r.rows[0]);
  }

  async typistById(id: string): Promise<TypistRow | null> {
    const r = await this.query('SELECT id, email, name, verified, password_hash FROM typists WHERE id = $1', [id]);
    return r.rows[0] === undefined ? null : mapTypist(r.rows[0]);
  }

  async createTypist(email: string, name: string, passwordHash: string, verified: boolean): Promise<TypistRow> {
    const id = randomUuid();
    await this.query(
      'INSERT INTO typists (id, email, name, password_hash, verified) VALUES ($1, $2, $3, $4, $5)',
      [id, email, name, passwordHash, verified]);
    const r = await this.typistById(id);
    if (r === null) throw new Error('typist insert failed');
    return r;
  }

  async updateTypist(id: string, fields: { name?: string; passwordHash?: string; verified?: boolean }): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (fields.name !== undefined) { values.push(fields.name); sets.push(`name = $${values.length}`); }
    if (fields.passwordHash !== undefined) { values.push(fields.passwordHash); sets.push(`password_hash = $${values.length}`); }
    if (fields.verified !== undefined) { values.push(fields.verified); sets.push(`verified = $${values.length}`); }
    if (sets.length === 0) return;
    values.push(id);
    await this.query(`UPDATE typists SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
  }

  async createSession(typistId: string, token: string): Promise<void> {
    await this.query('INSERT INTO sessions (token, typist_id) VALUES ($1, $2)', [token, typistId]);
  }

  async sessionTypist(token: string): Promise<TypistRow | null> {
    const r = await this.query(
      `SELECT t.id, t.email, t.name, t.verified, t.password_hash
       FROM sessions s JOIN typists t ON t.id = s.typist_id WHERE s.token = $1`, [token]);
    return r.rows[0] === undefined ? null : mapTypist(r.rows[0]);
  }

  async deleteSession(token: string): Promise<void> {
    await this.query('DELETE FROM sessions WHERE token = $1', [token]);
  }

  async deleteSessionsForTypist(typistId: string): Promise<void> {
    await this.query('DELETE FROM sessions WHERE typist_id = $1', [typistId]);
  }

  async sessionTokensForTypist(typistId: string): Promise<string[]> {
    const r = await this.query<{ token: string }>('SELECT token FROM sessions WHERE typist_id = $1', [typistId]);
    return r.rows.map((row) => row.token);
  }

  // Verification and reset tokens.

  async createVerifyToken(typistId: string, token: string, expiresAt: Date): Promise<void> {
    await this.query('DELETE FROM verify_tokens WHERE typist_id = $1', [typistId]);
    await this.query('INSERT INTO verify_tokens (token, typist_id, expires_at) VALUES ($1, $2, $3)', [token, typistId, expiresAt]);
  }

  async consumeVerifyToken(token: string): Promise<'ok' | 'expired' | 'unknown'> {
    const r = await this.query<{ typist_id: string; expires_at: Date; used_at: Date | null }>(
      'SELECT typist_id, expires_at, used_at FROM verify_tokens WHERE token = $1 FOR UPDATE', [token]);
    const row = r.rows[0];
    if (row === undefined) return 'unknown';
    if (row.used_at !== null || row.expires_at.getTime() <= Date.now()) return 'expired';
    await this.query('UPDATE verify_tokens SET used_at = now() WHERE token = $1', [token]);
    return 'ok';
  }

  async createResetToken(typistId: string, token: string, expiresAt: Date): Promise<void> {
    await this.query('DELETE FROM reset_tokens WHERE typist_id = $1', [typistId]);
    await this.query('INSERT INTO reset_tokens (token, typist_id, expires_at) VALUES ($1, $2, $3)', [token, typistId, expiresAt]);
  }

  async consumeResetToken(token: string): Promise<'ok' | 'expired' | 'unknown'> {
    const r = await this.query<{ typist_id: string; expires_at: Date; used_at: Date | null }>(
      'SELECT typist_id, expires_at, used_at FROM reset_tokens WHERE token = $1 FOR UPDATE', [token]);
    const row = r.rows[0];
    if (row === undefined) return 'unknown';
    if (row.used_at !== null || row.expires_at.getTime() <= Date.now()) return 'expired';
    await this.query('UPDATE reset_tokens SET used_at = now() WHERE token = $1', [token]);
    return 'ok';
  }

  // Sign-in failures: counted exactly, in one statement per attempt.

  /**
   * Count one failed sign-in for an email and report the count, in a single
   * locked statement so parallel attempts cannot under-count. The advisory
   * lock is transaction-scoped and keyed by the email.
   */
  async countFailedSignIn(email: string, windowSeconds: number, maxFailures: number, now: Date): Promise<{ counted: boolean; failures: number }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext(lower($1)))', [email]);
      const previous = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM sign_failures
         WHERE email = lower($1) AND failed_at > ($2::timestamptz - ($3 || ' seconds')::interval)`,
        [email, now, windowSeconds]);
      const failures = Number(previous.rows[0]?.n ?? 0);
      if (failures >= maxFailures) {
        await client.query('ROLLBACK');
        return { counted: false, failures };
      }
      await client.query('INSERT INTO sign_failures (email, failed_at) VALUES (lower($1), $2)', [email, now]);
      await client.query('COMMIT');
      return { counted: true, failures: failures + 1 };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async currentSignInFailures(email: string, windowSeconds: number, now: Date): Promise<number> {
    const r = await this.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM sign_failures
       WHERE email = lower($1) AND failed_at > ($2::timestamptz - ($3 || ' seconds')::interval)`,
      [email, now, windowSeconds]);
    return Number(r.rows[0]?.n ?? 0);
  }

  async oldestRecentFailure(email: string, windowSeconds: number, now: Date): Promise<Date | null> {
    const r = await this.query<{ failed_at: Date }>(
      `SELECT failed_at FROM sign_failures
       WHERE email = lower($1) AND failed_at > ($2::timestamptz - ($3 || ' seconds')::interval)
       ORDER BY failed_at DESC LIMIT 1 OFFSET $4`,
      [email, now, windowSeconds, 4]);
    return r.rows[0]?.failed_at ?? null;
  }

  async pruneSignInFailures(now: Date): Promise<void> {
    await this.query("DELETE FROM sign_failures WHERE failed_at < ($1::timestamptz - interval '1 hour')", [now]);
  }

  // Settings.

  async settingsFor(typistId: string, defaults: SettingsRow): Promise<SettingsRow> {
    const r = await this.query<{ theme: string; caret: string; smooth_caret: boolean; font_size: number; blind_mode: boolean; quick_restart: string }>(
      'SELECT theme, caret, smooth_caret, font_size, blind_mode, quick_restart FROM settings WHERE typist_id = $1', [typistId]);
    const row = r.rows[0];
    if (row === undefined) return defaults;
    return { theme: row.theme, caret: row.caret, smoothCaret: row.smooth_caret, fontSize: row.font_size, blindMode: row.blind_mode, quickRestart: row.quick_restart };
  }

  async saveSettings(typistId: string, s: SettingsRow): Promise<void> {
    await this.query(
      `INSERT INTO settings (typist_id, theme, caret, smooth_caret, font_size, blind_mode, quick_restart)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (typist_id) DO UPDATE SET
         theme = EXCLUDED.theme, caret = EXCLUDED.caret, smooth_caret = EXCLUDED.smooth_caret,
         font_size = EXCLUDED.font_size, blind_mode = EXCLUDED.blind_mode, quick_restart = EXCLUDED.quick_restart`,
      [typistId, s.theme, s.caret, s.smoothCaret, s.fontSize, s.blindMode, s.quickRestart]);
  }

  // Tickets.

  async nextSequence(): Promise<number> {
    const r = await this.query<{ n: string }>('SELECT nextval(\'ticket_sequence\')::text AS n');
    return Number(r.rows[0].n);
  }

  async insertTicket(row: TicketRow): Promise<void> {
    await this.query(
      `INSERT INTO tickets (ticket_id, typist_id, mode, length, punctuation, numbers, words, seed, quote_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [row.ticketId, row.typistId, row.mode, row.length, row.punctuation, row.numbers, JSON.stringify(row.words), row.seed, row.quoteId, row.expiresAt]);
  }

  async ticketById(ticketId: string): Promise<TicketRow | null> {
    const r = await this.query<{ ticket_id: string; typist_id: string | null; mode: string; length: number | null; punctuation: boolean; numbers: boolean; words: unknown; seed: number | null; quote_id: string | null; expires_at: Date; submitted_run_id: string | null }>(
      'SELECT ticket_id, typist_id, mode, length, punctuation, numbers, words, seed, quote_id, expires_at, submitted_run_id FROM tickets WHERE ticket_id = $1', [ticketId]);
    const row = r.rows[0];
    if (row === undefined) return null;
    return {
      ticketId: row.ticket_id,
      typistId: row.typist_id,
      mode: row.mode as TicketRow['mode'],
      length: row.length,
      punctuation: row.punctuation,
      numbers: row.numbers,
      words: Array.isArray(row.words) ? (row.words as string[]) : [],
      seed: row.seed,
      quoteId: row.quote_id,
      expiresAt: row.expires_at,
      submittedRunId: row.submitted_run_id,
    };
  }

  // Runs.

  async insertRun(row: RunRow, firstBody: Buffer): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const claimed = await client.query(
        'UPDATE tickets SET submitted_run_id = $1 WHERE ticket_id = $2 AND submitted_run_id IS NULL',
        [row.runId, row.ticketId]);
      if (claimed.rowCount !== 1) {
        await client.query('ROLLBACK');
        return;
      }
      await client.query(
        `INSERT INTO runs (run_id, typist_id, ticket_id, mode, length, punctuation, numbers, quote_id, words, log, first_body, proof_key,
          verdict, reason, duration_ms, speed, raw, accuracy, consistency, characters, errors_by_key, per_second, personal_best, board_length, finished_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
        [
          row.runId, row.typistId, row.ticketId, row.mode, row.length, row.punctuation, row.numbers, row.quoteId,
          JSON.stringify(row.words), JSON.stringify(row.log), firstBody, row.proofKey,
          row.verdict, row.reason, row.durationMs, row.speed, row.raw, row.accuracy, row.consistency,
          row.characters === null ? null : JSON.stringify(row.characters),
          row.errorsByKey === null ? null : JSON.stringify(row.errorsByKey),
          row.perSecond === null ? null : JSON.stringify(row.perSecond),
          row.personalBest, row.mode === 'time' ? row.length : null, row.finishedAt,
        ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async runById(runId: string): Promise<RunRow | null> {
    const r = await this.query(
      `SELECT run_id, typist_id, ticket_id, mode, length, punctuation, numbers, quote_id, words, log, verdict, reason, duration_ms,
              speed, raw, accuracy, consistency, characters, errors_by_key, per_second, personal_best, finished_at, proof_key
       FROM runs WHERE run_id = $1`, [runId]);
    return r.rows[0] === undefined ? null : mapRunRows(r.rows)[0] ?? null;
  }

  async history(typistId: string, mode: string | null, length: string | null, verdict: string | null, page: number, pageSize: number): Promise<{ rows: RunRow[]; more: boolean }> {
    const conds: string[] = ['typist_id = $1'];
    const values: unknown[] = [typistId];
    if (mode !== null) { values.push(mode); conds.push(`mode = $${values.length}`); }
    if (length !== null) { values.push(length); conds.push(`length::text = $${values.length}`); }
    if (verdict !== null) { values.push(verdict); conds.push(`verdict = $${values.length}`); }
    const where = conds.join(' AND ');
    const limit = pageSize + 1;
    values.push(limit);
    const r = await this.query(
      `SELECT run_id, typist_id, ticket_id, mode, length, punctuation, numbers, quote_id, words, log, verdict, reason, duration_ms,
              speed, raw, accuracy, consistency, characters, errors_by_key, per_second, personal_best, finished_at, proof_key
       FROM runs WHERE ${where} ORDER BY finished_at DESC, run_id DESC LIMIT $${values.length}`, values);
    const rows = mapRunRows(r.rows);
    return { rows: rows.slice(0, pageSize), more: rows.length > pageSize };
  }

  async historyLengths(typistId: string, mode: string | null): Promise<number[]> {
    if (mode === null) return [];
    const r = await this.query<{ length: number | null }>(
      'SELECT DISTINCT length FROM runs WHERE typist_id = $1 AND mode = $2 ORDER BY length', [typistId, mode]);
    return r.rows.map((row) => row.length).filter((x): x is number => x !== null);
  }

  async testsCounted(typistId: string): Promise<number> {
    const r = await this.query<{ n: string }>('SELECT count(*)::text AS n FROM runs WHERE typist_id = $1 AND verdict = \'counted\'', [typistId]);
    return Number(r.rows[0]?.n ?? 0);
  }

  async personalBests(typistId: string): Promise<RunRow[]> {
    const r = await this.query(
      `SELECT DISTINCT ON (mode, length, punctuation, numbers)
              run_id, typist_id, ticket_id, mode, length, punctuation, numbers, quote_id, words, log, verdict, reason, duration_ms,
              speed, raw, accuracy, consistency, characters, errors_by_key, per_second, personal_best, finished_at, proof_key
       FROM runs WHERE typist_id = $1 AND verdict = 'counted'
       ORDER BY mode, length, punctuation, numbers, speed DESC, accuracy DESC, finished_at ASC`, [typistId]);
    return mapRunRows(r.rows);
  }

  async bestSpeedFor(typistId: string, mode: string, length: number, punctuation: boolean, numbers: boolean): Promise<{ speed: number; accuracy: number; finishedAt: Date } | null> {
    const r = await this.query<{ speed: number; accuracy: number; finished_at: Date }>(
      `SELECT speed, accuracy, finished_at FROM runs
       WHERE typist_id = $1 AND verdict = 'counted' AND mode = $2 AND length = $3 AND punctuation = $4 AND numbers = $5
       ORDER BY speed DESC, accuracy DESC, finished_at ASC LIMIT 1`,
      [typistId, mode, length, punctuation, numbers]);
    const row = r.rows[0];
    if (row === undefined) return null;
    return { speed: row.speed, accuracy: row.accuracy, finishedAt: row.finished_at };
  }

  async board(board: 'daily' | 'alltime', length: number, limit: number): Promise<BoardRow[]> {
    const dayStart = board === 'daily' ? `AND finished_at >= date_trunc('day', now() at time zone 'utc')` : '';
    const r = await this.query<{ name: string; typist_id: string; speed: number; accuracy: number; finished_at: Date }>(
      `SELECT DISTINCT ON (t.id) t.name, t.id AS typist_id, r.speed, r.accuracy, r.finished_at
       FROM runs r JOIN typists t ON t.id = r.typist_id
       WHERE r.verdict = 'counted' AND t.verified AND r.mode = 'time' AND r.length = $1
         AND r.punctuation = FALSE AND r.numbers = FALSE ${dayStart}
       ORDER BY t.id, r.speed DESC, r.accuracy DESC, r.finished_at ASC`,
      [length]);
    const rows = r.rows.map((row) => ({ name: row.name, typistId: row.typist_id, speed: Number(row.speed), accuracy: Number(row.accuracy), finishedAt: row.finished_at }));
    rows.sort((a, b) => (a.speed !== b.speed ? b.speed - a.speed : a.accuracy !== b.accuracy ? b.accuracy - a.accuracy : a.finishedAt.getTime() - b.finishedAt.getTime()));
    return rows.slice(0, limit).map((row, i) => ({ ...row, rank: i + 1 }));
  }

  // Stored first responses, for one ticket one run.

  async storedResponse(ticketId: string): Promise<StoredResponse | null> {
    const ticket = await this.ticketById(ticketId);
    if (ticket === null || ticket.submittedRunId === null) return null;
    const run = await this.runById(ticket.submittedRunId);
    if (run === null) return null;
    return storedResponseFor(run);
  }

  // Pending mail.

  async queueMail(to: string, subject: string, body: string): Promise<void> {
    await this.query('INSERT INTO pending_mail (to_address, subject, body) VALUES ($1, $2, $3)', [to, subject, body]);
  }

  async pendingMail(): Promise<{ id: number; to: string; subject: string; body: string }[]> {
    const r = await this.query<{ id: string; to_address: string; subject: string; body: string }>(
      'SELECT id, to_address, subject, body FROM pending_mail WHERE delivered_at IS NULL ORDER BY id');
    return r.rows.map((row) => ({ id: Number(row.id), to: row.to_address, subject: row.subject, body: row.body }));
  }

  async markMailDelivered(id: number): Promise<void> {
    await this.query('UPDATE pending_mail SET delivered_at = now() WHERE id = $1', [id]);
  }

  async gradingSetup(typists: { email: string; name: string; password: string; verified: boolean; passwordHash: string }[], runs: { typistId: string; mode: string; length: number; punctuation: boolean; numbers: boolean; speed: number; raw: number; accuracy: number; consistency: number; finishedAt: Date }[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const t of typists) {
        const id = randomUuid();
        const existing = await client.query<{ id: string }>('SELECT id FROM typists WHERE lower(email) = lower($1)', [t.email]);
        if (existing.rows[0] === undefined) {
          await client.query(
            'INSERT INTO typists (id, email, name, password_hash, verified) VALUES ($1, $2, $3, $4, $5)',
            [id, t.email, t.name, t.passwordHash, t.verified]);
        } else {
          await client.query(
            'UPDATE typists SET name = $2, password_hash = $3, verified = $4 WHERE id = $1',
            [existing.rows[0].id, t.name, t.passwordHash, t.verified]);
        }
      }
      for (const run of runs) {
        await client.query(
          `INSERT INTO runs (run_id, typist_id, ticket_id, mode, length, punctuation, numbers, quote_id, words, log, first_body, proof_key,
            verdict, reason, duration_ms, speed, raw, accuracy, consistency, characters, errors_by_key, per_second, personal_best, board_length, finished_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'counted',NULL,NULL,$13,$14,$15,$16,NULL,NULL,NULL,FALSE,$17,$18)`,
          [randomUuid(), run.typistId, null, run.mode, run.length, run.punctuation, run.numbers, null,
            JSON.stringify([]), JSON.stringify([]), Buffer.alloc(0), null,
            roundHalfUp2(run.speed), roundHalfUp2(run.raw), roundHalfUp2(run.accuracy), roundHalfUp2(run.consistency),
            run.mode === 'time' ? run.length : null, run.finishedAt]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

function mapTypist(row: Record<string, unknown>): TypistRow {
  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name),
    verified: Boolean(row.verified),
    passwordHash: String(row.password_hash),
  };
}

function mapRunRows(rows: readonly Record<string, unknown>[]): RunRow[] {
  return rows.map((row) => mapRunRow(row)).filter((row): row is RunRow => row !== null);
}

function mapRunRow(row: Record<string, unknown> | undefined): RunRow | null {
  if (row === undefined) return null;
  return {
    runId: String(row.run_id),
    typistId: String(row.typist_id),
    ticketId: String(row.ticket_id),
    mode: String(row.mode),
    length: row.length === null ? null : Number(row.length),
    punctuation: Boolean(row.punctuation),
    numbers: Boolean(row.numbers),
    quoteId: row.quote_id === null || row.quote_id === undefined ? null : String(row.quote_id),
    words: Array.isArray(row.words) ? (row.words as string[]) : [],
    log: row.log,
    verdict: row.verdict === 'counted' ? 'counted' : 'not_counted',
    reason: row.reason === null || row.reason === undefined ? null : String(row.reason),
    durationMs: row.duration_ms === null || row.duration_ms === undefined ? null : Number(row.duration_ms),
    speed: row.speed === null || row.speed === undefined ? null : Number(row.speed),
    raw: row.raw === null || row.raw === undefined ? null : Number(row.raw),
    accuracy: row.accuracy === null || row.accuracy === undefined ? null : Number(row.accuracy),
    consistency: row.consistency === null || row.consistency === undefined ? null : Number(row.consistency),
    characters: (row.characters as RunRow['characters']) ?? null,
    errorsByKey: (row.errors_by_key as RunRow['errorsByKey']) ?? null,
    perSecond: (row.per_second as RunRow['perSecond']) ?? null,
    personalBest: Boolean(row.personal_best),
    finishedAt: new Date(row.finished_at as string),
    proofKey: row.proof_key === null || row.proof_key === undefined ? null : String(row.proof_key),
  };
}

export function storedResponseFor(run: RunRow): StoredResponse {
  if (run.verdict === 'counted') {
    return {
      status: 201,
      body: {
        runId: run.runId,
        verdict: 'counted',
        personalBest: run.personalBest,
        speed: run.speed,
        raw: run.raw,
        accuracy: run.accuracy,
        consistency: run.consistency,
        proofKey: run.proofKey,
      },
    };
  }
  return {
    status: 422,
    body: {
      error: run.reason,
      verdict: 'not_counted',
      runId: run.runId,
      proofKey: run.proofKey,
    },
  };
}

export async function proofKeyForBody(bytes: Buffer): Promise<string> {
  return sha256Hex(new Uint8Array(bytes));
}

export type { LogEntry };
