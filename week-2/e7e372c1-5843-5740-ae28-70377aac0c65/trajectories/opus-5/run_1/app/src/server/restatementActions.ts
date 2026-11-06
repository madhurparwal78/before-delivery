/**
 * Every stored change to a restatement. Each one locks the restatement row,
 * takes the version current at that moment, raises it by exactly one and writes
 * exactly one audit entry in the same transaction.
 */
import { randomBytes } from 'node:crypto';
import { Transaction, isUniqueViolation, transact } from './db';
import { fail, validationFailure } from './errors';
import { RestatementState, ROW_KEYS } from '../shared/labels';
import {
  ActorContext,
  authoriseAction,
  authoriseCreate,
  isTransitionAllowed,
  RestatementAction,
  withdrawBeatsClose,
} from '../domain/stateMachine';
import { addDays, formatDateString, newYorkDateStringOf, parseDateString } from '../shared/nytime';
import { closesAtIfOpen, nextWeekEnding, weekEndInstant } from '../domain/calendar';
import { marketClockNow } from './marketClock';
import {
  CORRECTION_CREATE_MEMBERS,
  SAVE_MEMBERS,
  WEEKLY_CREATE_MEMBERS,
  checkDraftArithmetic,
  collectUnacceptedMembers,
  FieldFailures,
  mergeDraft,
  parseDraftMembers,
} from './draftValidation';
import {
  RestatementRecord,
  loadRestatement,
  latestPublishedRestatement,
} from './restatementStore';
import {
  filedRestatementById,
  markComputationsRestated,
  storeMnavAt,
  storePublicationComputations,
} from './computations';

export type AuditAction =
  | 'create'
  | 'edit'
  | 'exhibit_pending'
  | 'exhibit_verified'
  | 'exhibit_rejected'
  | 'submit'
  | 'return'
  | 'clear'
  | 'release_queued'
  | 'publish'
  | 'withdraw'
  | 'supersede';

interface LockedRestatement {
  id: string;
  version: number;
  state: RestatementState;
  weekEnding: string;
  preparedBy: string;
  clearedBy: string | null;
  supersedes: string | null;
  correctionReason: string | null;
  accession: string | null;
  exhibitStatus: 'verified' | 'rejected' | null;
  releaseAtMs: number | null;
}

interface LockedRow {
  id: string;
  version: number;
  state: string;
  week_ending: string;
  prepared_by: string;
  cleared_by: string | null;
  supersedes: string | null;
  correction_reason: string | null;
  accession: string | null;
  exhibit_status: string | null;
  release_at: Date | null;
}

async function lockRestatement(tx: Transaction, id: string): Promise<LockedRestatement | null> {
  const rows = await tx.query<LockedRow>(
    `SELECT id, version, state, week_ending, prepared_by, cleared_by, supersedes,
            correction_reason, accession, exhibit_status, release_at
       FROM restatement WHERE id = $1 FOR UPDATE`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    version: row.version,
    state: row.state as RestatementState,
    weekEnding: row.week_ending,
    preparedBy: row.prepared_by,
    clearedBy: row.cleared_by,
    supersedes: row.supersedes,
    correctionReason: row.correction_reason,
    accession: row.accession,
    exhibitStatus: row.exhibit_status as 'verified' | 'rejected' | null,
    releaseAtMs: row.release_at ? row.release_at.getTime() : null,
  };
}

async function writeAudit(
  tx: Transaction,
  entry: {
    restatementId: string;
    version: number;
    action: AuditAction;
    actorId: string | null;
    atMs: number;
    fromState: RestatementState | null;
    toState: RestatementState;
    note: string | null;
  },
): Promise<void> {
  await tx.query(
    `INSERT INTO restatement_audit
       (restatement_id, version, action, actor_id, at, from_state, to_state, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      entry.restatementId,
      entry.version,
      entry.action,
      entry.actorId,
      new Date(entry.atMs),
      entry.fromState,
      entry.toState,
      entry.note,
    ],
  );
}

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(10).toString('hex')}`;
}

function requireTransition(action: RestatementAction, locked: LockedRestatement): void {
  if (!isTransitionAllowed(action, locked.state)) throw fail('invalid_transition');
}

function requireAuthorised(action: RestatementAction, actor: ActorContext, locked: LockedRestatement): void {
  const failure = authoriseAction(action, actor, {
    preparedBy: locked.preparedBy,
    clearedBy: locked.clearedBy,
  });
  if (failure !== null) throw fail(failure);
}

async function replaceShareEvents(
  tx: Transaction,
  restatementId: string,
  events: readonly { kind: string; shares: string; effectiveDate: string }[],
): Promise<void> {
  await tx.query('DELETE FROM share_event WHERE restatement_id = $1', [restatementId]);
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index] as { kind: string; shares: string; effectiveDate: string };
    await tx.query(
      `INSERT INTO share_event (id, restatement_id, position, kind, shares, effective_date)
         VALUES ($1, $2, $3, $4, $5, $6)`,
      [newId('she'), restatementId, index, event.kind, event.shares, event.effectiveDate],
    );
  }
}

// --- Creating a draft ---

export async function createRestatement(
  actor: ActorContext,
  body: Record<string, unknown>,
): Promise<RestatementRecord> {
  const createFailure = authoriseCreate(actor);
  if (createFailure !== null) throw fail(createFailure);

  const isCorrection = 'supersedes' in body;
  const accepted = isCorrection ? CORRECTION_CREATE_MEMBERS : WEEKLY_CREATE_MEMBERS;

  return transact(async (tx) => {
    const nowMs = await marketClockNow();
    const latest = await latestPublishedRestatement(tx);
    if (latest === null) throw fail(isCorrection ? 'not_latest_week' : 'week_out_of_sequence');
    const latestWeek = parseDateString(latest.weekEnding);
    if (latestWeek === null) throw fail('week_out_of_sequence');

    let weekEnding: string;
    let supersedesId: string | null = null;

    if (isCorrection) {
      const named = body.supersedes;
      if (typeof named !== 'string') throw fail('not_latest_week');
      const locked = await lockRestatement(tx, named);
      if (locked === null || locked.state !== 'published') throw fail('not_latest_week');
      const stillLatest = await latestPublishedRestatement(tx);
      if (stillLatest === null || stillLatest.id !== named) throw fail('not_latest_week');
      supersedesId = named;
      weekEnding = locked.weekEnding;
    } else {
      const required = formatDateString(nextWeekEnding(latestWeek));
      if ('week_ending' in body && body.week_ending !== required) {
        throw fail('week_out_of_sequence');
      }
      const requiredDate = parseDateString(required);
      if (requiredDate === null) throw fail('week_out_of_sequence');
      if (nowMs <= weekEndInstant(requiredDate)) throw fail('week_not_ended');
      weekEnding = required;
    }

    const open = await tx.query<{ id: string }>(
      `SELECT id FROM restatement
        WHERE state IN ('draft','in_review','returned','cleared','queued') LIMIT 1`,
    );
    if (open.length > 0) throw fail('restatement_open');

    const failures: FieldFailures = collectUnacceptedMembers(body, accepted);
    const patch = parseDraftMembers(body, accepted, weekEnding, failures);
    const draft = mergeDraft(null, patch, weekEnding, isCorrection, supersedesId);
    await checkDraftArithmetic(tx, draft, failures, false);
    if (Object.keys(failures).length > 0) throw validationFailure(failures);

    const id = newId('rst');
    try {
      await tx.query(
        `INSERT INTO restatement
           (id, version, week_ending, state, supersedes, correction_reason,
            row_beginning_balance, row_eth_acquired, row_staking_rewards,
            row_ending_balance, row_cumulative_staking_rewards, row_diluted_shares,
            accession, exhibit_page, prepared_by, created_at, updated_at)
           VALUES ($1, 1, $2, 'draft', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14)`,
        [
          id,
          weekEnding,
          supersedesId,
          draft.correctionReason,
          draft.rows['beginning-balance'] ?? null,
          draft.rows['eth-acquired'] ?? null,
          draft.rows['staking-rewards'] ?? null,
          draft.rows['ending-balance'] ?? null,
          draft.rows['cumulative-staking-rewards'] ?? null,
          draft.rows['diluted-shares'] ?? null,
          draft.accession,
          draft.exhibitPage,
          actor.userId,
          new Date(nowMs),
        ],
      );
    } catch (failure) {
      if (isUniqueViolation(failure)) throw fail('restatement_open');
      throw failure;
    }
    await replaceShareEvents(tx, id, draft.shareEvents);
    await writeAudit(tx, {
      restatementId: id,
      version: 1,
      action: 'create',
      actorId: actor.userId,
      atMs: nowMs,
      fromState: null,
      toState: 'draft',
      note: null,
    });
    const created = await loadRestatement(tx, id);
    if (created === null) throw fail('internal');
    return created;
  });
}

// --- Saving a draft ---

export async function saveRestatement(
  actor: ActorContext,
  id: string,
  body: Record<string, unknown>,
): Promise<RestatementRecord> {
  return transact(async (tx) => {
    const locked = await lockRestatement(tx, id);
    if (locked === null) throw fail('not_found');
    requireAuthorised('edit', actor, locked);
    requireTransition('edit', locked);

    const failures: FieldFailures = collectUnacceptedMembers(body, SAVE_MEMBERS);
    const version = body.version;
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
      failures.version = 'Enter the restatement version you are editing.';
    } else if (version !== locked.version) {
      throw fail('version_conflict');
    }

    const stored = await loadRestatement(tx, id);
    if (stored === null) throw fail('not_found');
    const patch = parseDraftMembers(body, SAVE_MEMBERS, locked.weekEnding, failures);
    const draft = mergeDraft(
      stored,
      patch,
      locked.weekEnding,
      locked.supersedes !== null,
      locked.supersedes,
    );
    await checkDraftArithmetic(tx, draft, failures, false);
    if (Object.keys(failures).length > 0) throw validationFailure(failures);

    const nowMs = await marketClockNow();
    const nextVersion = locked.version + 1;
    const accessionChanged = patch.accession !== undefined && patch.accession !== locked.accession;
    await tx.query(
      `UPDATE restatement SET
         version = $2, updated_at = $3,
         row_beginning_balance = $4, row_eth_acquired = $5, row_staking_rewards = $6,
         row_ending_balance = $7, row_cumulative_staking_rewards = $8, row_diluted_shares = $9,
         accession = $10, exhibit_page = $11, correction_reason = $12,
         exhibit_status = CASE WHEN $13 THEN NULL ELSE exhibit_status END,
         exhibit_sha256 = CASE WHEN $13 THEN NULL ELSE exhibit_sha256 END,
         exhibit_bytes = CASE WHEN $13 THEN NULL ELSE exhibit_bytes END,
         exhibit_key = CASE WHEN $13 THEN NULL ELSE exhibit_key END
       WHERE id = $1`,
      [
        id,
        nextVersion,
        new Date(nowMs),
        draft.rows['beginning-balance'] ?? null,
        draft.rows['eth-acquired'] ?? null,
        draft.rows['staking-rewards'] ?? null,
        draft.rows['ending-balance'] ?? null,
        draft.rows['cumulative-staking-rewards'] ?? null,
        draft.rows['diluted-shares'] ?? null,
        draft.accession,
        draft.exhibitPage,
        draft.correctionReason,
        accessionChanged,
      ],
    );
    await replaceShareEvents(tx, id, draft.shareEvents);
    await writeAudit(tx, {
      restatementId: id,
      version: nextVersion,
      action: 'edit',
      actorId: actor.userId,
      atMs: nowMs,
      fromState: locked.state,
      toState: locked.state,
      note: null,
    });
    const saved = await loadRestatement(tx, id);
    if (saved === null) throw fail('internal');
    return saved;
  });
}

// --- The exhibit upload's two stored steps ---

export interface ExhibitStepsResult {
  restatement: RestatementRecord;
  finalVersion: number;
}

export async function storeExhibitSteps(
  actor: ActorContext,
  id: string,
  outcome: 'verified' | 'rejected',
  exhibit: { sha256: string; bytes: number; key: string | null },
): Promise<ExhibitStepsResult> {
  return transact(async (tx) => {
    const locked = await lockRestatement(tx, id);
    if (locked === null) throw fail('not_found');
    requireAuthorised('upload_exhibit', actor, locked);
    requireTransition('upload_exhibit', locked);
    const nowMs = await marketClockNow();
    const pendingVersion = locked.version + 1;
    const finalVersion = pendingVersion + 1;
    await tx.query('UPDATE restatement SET version = $2, updated_at = $3 WHERE id = $1', [
      id,
      pendingVersion,
      new Date(nowMs),
    ]);
    await writeAudit(tx, {
      restatementId: id,
      version: pendingVersion,
      action: 'exhibit_pending',
      actorId: actor.userId,
      atMs: nowMs,
      fromState: locked.state,
      toState: locked.state,
      note: null,
    });
    await tx.query(
      `UPDATE restatement SET version = $2, updated_at = $3,
         exhibit_status = $4, exhibit_sha256 = $5, exhibit_bytes = $6, exhibit_key = $7
       WHERE id = $1`,
      [id, finalVersion, new Date(nowMs), outcome, exhibit.sha256, exhibit.bytes, exhibit.key],
    );
    await writeAudit(tx, {
      restatementId: id,
      version: finalVersion,
      action: outcome === 'verified' ? 'exhibit_verified' : 'exhibit_rejected',
      actorId: actor.userId,
      atMs: nowMs,
      fromState: locked.state,
      toState: locked.state,
      note: null,
    });
    const saved = await loadRestatement(tx, id);
    if (saved === null) throw fail('internal');
    return { restatement: saved, finalVersion };
  });
}

// --- Submit, return, clear ---

export async function submitRestatement(
  actor: ActorContext,
  id: string,
): Promise<RestatementRecord> {
  return transact(async (tx) => {
    const locked = await lockRestatement(tx, id);
    if (locked === null) throw fail('not_found');
    requireAuthorised('submit', actor, locked);
    requireTransition('submit', locked);
    if (locked.exhibitStatus !== 'verified') throw fail('exhibit_not_verified');

    const stored = await loadRestatement(tx, id);
    if (stored === null) throw fail('not_found');
    const failures: FieldFailures = {};
    const draft = mergeDraft(
      stored,
      {},
      locked.weekEnding,
      locked.supersedes !== null,
      locked.supersedes,
    );
    await checkDraftArithmetic(tx, draft, failures, true);
    if (Object.keys(failures).length > 0) throw validationFailure(failures);

    const nowMs = await marketClockNow();
    const nextVersion = locked.version + 1;
    await tx.query(
      `UPDATE restatement SET version = $2, updated_at = $3, state = 'in_review', return_note = NULL
         WHERE id = $1`,
      [id, nextVersion, new Date(nowMs)],
    );
    await writeAudit(tx, {
      restatementId: id,
      version: nextVersion,
      action: 'submit',
      actorId: actor.userId,
      atMs: nowMs,
      fromState: locked.state,
      toState: 'in_review',
      note: null,
    });
    const saved = await loadRestatement(tx, id);
    if (saved === null) throw fail('internal');
    return saved;
  });
}

export async function returnRestatement(
  actor: ActorContext,
  id: string,
  note: unknown,
): Promise<RestatementRecord> {
  return transact(async (tx) => {
    const locked = await lockRestatement(tx, id);
    if (locked === null) throw fail('not_found');
    requireAuthorised('return', actor, locked);
    requireTransition('return', locked);
    if (typeof note !== 'string' || note.length < 10 || note.length > 1000) {
      throw validationFailure({ note: 'Enter a note of 10 to 1,000 characters.' });
    }
    const nowMs = await marketClockNow();
    const nextVersion = locked.version + 1;
    await tx.query(
      `UPDATE restatement SET version = $2, updated_at = $3, state = 'returned', return_note = $4
         WHERE id = $1`,
      [id, nextVersion, new Date(nowMs), note],
    );
    await writeAudit(tx, {
      restatementId: id,
      version: nextVersion,
      action: 'return',
      actorId: actor.userId,
      atMs: nowMs,
      fromState: locked.state,
      toState: 'returned',
      note,
    });
    const saved = await loadRestatement(tx, id);
    if (saved === null) throw fail('internal');
    return saved;
  });
}

export async function clearRestatement(
  actor: ActorContext,
  id: string,
  body: Record<string, unknown>,
): Promise<RestatementRecord> {
  return transact(async (tx) => {
    const locked = await lockRestatement(tx, id);
    if (locked === null) throw fail('not_found');
    requireAuthorised('clear', actor, locked);
    requireTransition('clear', locked);

    const failures: FieldFailures = {};
    const version = body.version;
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
      failures.version = 'Enter the restatement version you reviewed.';
    } else if (version !== locked.version) {
      throw fail('version_conflict');
    }
    const checked = body.checked;
    const checkedList = Array.isArray(checked) ? checked : null;
    const confirmsEveryRow =
      checkedList !== null &&
      checkedList.length === ROW_KEYS.length &&
      ROW_KEYS.every(
        (key) => checkedList.filter((candidate) => candidate === key).length === 1,
      );
    if (!confirmsEveryRow) {
      failures.checked = 'Confirm each of the six exhibit rows exactly once.';
    }
    if (Object.keys(failures).length > 0) throw validationFailure(failures);

    const nowMs = await marketClockNow();
    const nextVersion = locked.version + 1;
    await tx.query(
      `UPDATE restatement SET version = $2, updated_at = $3, state = 'cleared', cleared_by = $4
         WHERE id = $1`,
      [id, nextVersion, new Date(nowMs), actor.userId],
    );
    await writeAudit(tx, {
      restatementId: id,
      version: nextVersion,
      action: 'clear',
      actorId: actor.userId,
      atMs: nowMs,
      fromState: locked.state,
      toState: 'cleared',
      note: null,
    });
    const saved = await loadRestatement(tx, id);
    if (saved === null) throw fail('internal');
    return saved;
  });
}

// --- Publication and supersession ---

async function publishLocked(
  tx: Transaction,
  locked: LockedRestatement,
  publishedAtMs: number,
  actorId: string | null,
): Promise<void> {
  // The superseded restatement leaves the published state first, so that a week
  // never holds two published restatements at once.
  if (locked.supersedes !== null) {
    const superseded = await lockRestatement(tx, locked.supersedes);
    if (superseded !== null && superseded.state === 'published') {
      const supersedeVersion = superseded.version + 1;
      await tx.query(
        `UPDATE restatement SET version = $2, updated_at = $3, state = 'superseded', superseded_by = $4
           WHERE id = $1`,
        [superseded.id, supersedeVersion, new Date(publishedAtMs), locked.id],
      );
      await writeAudit(tx, {
        restatementId: superseded.id,
        version: supersedeVersion,
        action: 'supersede',
        actorId: null,
        atMs: publishedAtMs,
        fromState: 'published',
        toState: 'superseded',
        note: locked.correctionReason,
      });
    }
  }

  const publishVersion = locked.version + 1;
  await tx.query(
    `UPDATE restatement SET version = $2, updated_at = $3, state = 'published',
       published_at = $3, release_at = NULL WHERE id = $1`,
    [locked.id, publishVersion, new Date(publishedAtMs)],
  );
  await writeAudit(tx, {
    restatementId: locked.id,
    version: publishVersion,
    action: 'publish',
    actorId,
    atMs: publishedAtMs,
    fromState: locked.state,
    toState: 'published',
    note: null,
  });

  const filed = await filedRestatementById(tx, locked.id);
  if (filed === null) throw fail('internal');
  const stored = await storePublicationComputations(tx, filed, publishedAtMs);

  if (locked.supersedes !== null && locked.correctionReason !== null) {
    await markComputationsRestated(
      tx,
      locked.supersedes,
      newYorkDateStringOf(publishedAtMs),
      locked.correctionReason,
      locked.id,
      stored,
    );
  }
}

/** Publishes a restatement by id inside an existing transaction. */
export async function publishRestatementById(
  tx: Transaction,
  id: string,
  publishedAtMs: number,
  actorId: string | null,
): Promise<void> {
  const locked = await lockRestatement(tx, id);
  if (locked === null) throw fail('not_found');
  await publishLocked(tx, locked, publishedAtMs, actorId);
}

export async function appendAuditEntry(
  tx: Transaction,
  entry: {
    restatementId: string;
    version: number;
    action: AuditAction;
    actorId: string | null;
    atMs: number;
    fromState: RestatementState | null;
    toState: RestatementState;
    note: string | null;
  },
): Promise<void> {
  await writeAudit(tx, entry);
}

// --- Release ---

export type ReleaseOutcome = 'queued' | 'published';

export interface ReleaseResult {
  status: number;
  outcome: ReleaseOutcome;
  restatement: RestatementRecord;
}

interface StoredReleaseResponse {
  status: number;
  body: { outcome: ReleaseOutcome; restatement: RestatementRecord };
  restatementId: string;
}

async function readStoredRelease(
  tx: Transaction,
  userId: string,
  key: string,
): Promise<StoredReleaseResponse | null> {
  const rows = await tx.query<{ status: number; body: StoredReleaseResponse['body']; restatement_id: string }>(
    'SELECT status, body, restatement_id FROM release_idempotency WHERE user_id = $1 AND key = $2',
    [userId, key],
  );
  const row = rows[0];
  if (!row) return null;
  return { status: row.status, body: row.body, restatementId: row.restatement_id };
}

export async function releaseRestatement(
  actor: ActorContext,
  id: string,
  body: Record<string, unknown>,
  idempotencyKey: string | null,
): Promise<ReleaseResult> {
  return transact(async (tx) => {
    if (idempotencyKey !== null) {
      const stored = await readStoredRelease(tx, actor.userId, idempotencyKey);
      if (stored !== null && stored.restatementId === id) {
        return {
          status: stored.status,
          outcome: stored.body.outcome,
          restatement: stored.body.restatement,
        };
      }
    }
    const locked = await lockRestatement(tx, id);
    if (locked === null) throw fail('not_found');
    requireAuthorised('release', actor, locked);
    requireTransition('release', locked);
    if (idempotencyKey !== null) {
      const stored = await readStoredRelease(tx, actor.userId, idempotencyKey);
      if (stored !== null) throw fail('idempotency_conflict');
    }
    if (body.confirm !== true) {
      throw validationFailure({ confirm: 'Confirm that this restatement is cleared for release.' });
    }

    const nowMs = await marketClockNow();
    const closesAt = closesAtIfOpen(nowMs);
    let result: ReleaseResult;
    if (closesAt !== null) {
      const nextVersion = locked.version + 1;
      await tx.query(
        `UPDATE restatement SET version = $2, updated_at = $3, state = 'queued',
           release_at = $4, released_by = $5 WHERE id = $1`,
        [id, nextVersion, new Date(nowMs), new Date(closesAt), actor.userId],
      );
      await writeAudit(tx, {
        restatementId: id,
        version: nextVersion,
        action: 'release_queued',
        actorId: actor.userId,
        atMs: nowMs,
        fromState: locked.state,
        toState: 'queued',
        note: null,
      });
      const saved = await loadRestatement(tx, id);
      if (saved === null) throw fail('internal');
      result = { status: 202, outcome: 'queued', restatement: saved };
    } else {
      await tx.query('UPDATE restatement SET released_by = $2 WHERE id = $1', [id, actor.userId]);
      await publishLocked(tx, locked, nowMs, actor.userId);
      const saved = await loadRestatement(tx, id);
      if (saved === null) throw fail('internal');
      result = { status: 200, outcome: 'published', restatement: saved };
    }

    if (idempotencyKey !== null) {
      await tx.query(
        `INSERT INTO release_idempotency (user_id, key, restatement_id, status, body, created_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6)
           ON CONFLICT (user_id, key) DO NOTHING`,
        [
          actor.userId,
          idempotencyKey,
          id,
          result.status,
          JSON.stringify({ outcome: result.outcome, restatement: result.restatement }),
          new Date(nowMs),
        ],
      );
    }
    return result;
  });
}

// --- Withdraw ---

export async function withdrawRestatement(
  actor: ActorContext,
  id: string,
  body: Record<string, unknown>,
): Promise<RestatementRecord> {
  return transact(async (tx) => {
    const locked = await lockRestatement(tx, id);
    if (locked === null) throw fail('not_found');
    requireAuthorised('withdraw', actor, locked);
    requireTransition('withdraw', locked);

    const nowMs = await marketClockNow();
    if (locked.releaseAtMs === null || !withdrawBeatsClose(locked.releaseAtMs, nowMs)) {
      throw fail('invalid_transition');
    }

    const failures: FieldFailures = {};
    const version = body.version;
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
      failures.version = 'Enter the restatement version you are withdrawing.';
    } else if (version !== locked.version) {
      throw fail('version_conflict');
    }
    const note = body.note;
    if (typeof note !== 'string' || note.length < 10 || note.length > 500) {
      failures.note = 'Enter a note of 10 to 500 characters.';
    }
    if (Object.keys(failures).length > 0) throw validationFailure(failures);

    const nextVersion = locked.version + 1;
    await tx.query(
      `UPDATE restatement SET version = $2, updated_at = $3, state = 'cleared',
         release_at = NULL, released_by = NULL WHERE id = $1`,
      [id, nextVersion, new Date(nowMs)],
    );
    await writeAudit(tx, {
      restatementId: id,
      version: nextVersion,
      action: 'withdraw',
      actorId: actor.userId,
      atMs: nowMs,
      fromState: 'queued',
      toState: 'cleared',
      note: typeof note === 'string' ? note : null,
    });
    const saved = await loadRestatement(tx, id);
    if (saved === null) throw fail('internal');
    return saved;
  });
}

// --- Session-close processing, used by the timer and by opportunistic catch-up ---

export async function processOneSessionClose(
  closeDate: string,
  closeInstantMs: number,
): Promise<boolean> {
  return transact(async (tx) => {
    const claimed = await tx.query<{ close_date: string }>(
      `INSERT INTO session_close (close_date, closes_at, processed_at)
         VALUES ($1, $2, $3) ON CONFLICT (close_date) DO NOTHING
         RETURNING close_date`,
      [closeDate, new Date(closeInstantMs), new Date()],
    );
    if (claimed.length === 0) return false;

    await storeMnavAt(tx, closeInstantMs);

    const queued = await tx.query<{ id: string }>(
      `SELECT id FROM restatement WHERE state = 'queued' AND release_at = $1 FOR UPDATE`,
      [new Date(closeInstantMs)],
    );
    for (const row of queued) {
      const locked = await lockRestatement(tx, row.id);
      if (locked === null || locked.state !== 'queued') continue;
      await publishLocked(tx, locked, closeInstantMs, null);
    }
    return true;
  });
}

export async function earliestUnprocessedCloseDate(): Promise<string | null> {
  return transact(async (tx) => {
    const rows = await tx.query<{ close_date: string }>(
      'SELECT max(close_date) AS close_date FROM session_close',
    );
    const latest = rows[0]?.close_date ?? null;
    if (latest !== null) {
      const parsed = parseDateString(latest);
      if (parsed === null) return null;
      return formatDateString(addDays(parsed, 1));
    }
    const first = await tx.query<{ published_at: Date }>(
      'SELECT min(published_at) AS published_at FROM restatement WHERE published_at IS NOT NULL',
    );
    const firstPublished = first[0]?.published_at ?? null;
    return firstPublished === null ? null : newYorkDateStringOf(firstPublished.getTime());
  });
}
