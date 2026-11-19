import {
  Frequency,
  ReturnRecord,
  ReturnStatus,
  Role,
  STATUS_LABELS,
} from '../../shared/types';
import { newId } from '../auth';
import { query, transaction, Tx } from '../db';
import { formatDate, longDateString, parseDate } from '../../shared/dates';
import { carryForward, computeDueDate, editionForPeriod } from '../domain/duedates';
import { MESSAGES } from '../domain/messages';
import { generatePeriods, periodLabel, periodStartDate } from '../domain/periods';
import { extensionAllowed, isLegalMove, ReturnAction } from '../domain/rules';
import { isAmount } from '../domain/validate';
import { endOfDayInstant } from '../domain/zones';
import { LiveLine, PRIORITY, publish } from '../events';
import * as errors from '../http/errors';
import { LoadedState, PracticeRow, getPractice, loadState, practiceNow } from '../repo/practice';
import {
  ReturnRow,
  loadReturnRowById,
  loadReturnRows,
  presentReturns,
} from '../repo/returns';
import {
  approvalRequestMessage,
  approvedMessage,
  filedMessage,
  queueNotice,
  sentBackMessage,
} from '../services/notices';
import { attemptMailJobs, attemptRenders, syncReminders } from './schedule';

export interface Caller {
  userId: string;
  practiceId: string;
  role: Role;
  clientId: string | null;
  displayName: string;
}

const UPDATE_DATES = `
  UPDATE returns SET nominal_due_date = $2, due_date = $3, carried_from = $4, due_at_ms = $5,
         version = version + 1
    WHERE id = $1`;

function statusSavedLine(record: ReturnRecord, roles: readonly Role[]): LiveLine {
  return {
    text: `${record.client.name} ${record.state} ${record.period_label} is now ${STATUS_LABELS[record.status]}.`,
    priority: PRIORITY.status_saved,
    roles,
    clientId: record.client.id,
  };
}

/** Every return the caller may open; anything else is not found. */
export async function accessibleReturnRow(
  caller: Caller,
  returnId: string,
  tx?: Tx,
): Promise<ReturnRow> {
  const row = await loadReturnRowById(returnId, tx);
  if (!row || row.practice_id !== caller.practiceId) throw errors.notFound();
  if (caller.role === 'owner' && row.client_id !== caller.clientId) throw errors.notFound();
  return row;
}

async function ownerEmailForClient(clientId: string, tx?: Tx): Promise<string> {
  const run = tx ? tx.query.bind(tx) : query;
  const rows = await run<{ email: string }>(
    'SELECT u.email FROM clients c JOIN users u ON u.id = c.owner_user_id WHERE c.id = $1',
    [clientId],
  );
  return rows[0].email;
}

async function bookkeeperEmailFor(practiceId: string, tx?: Tx): Promise<string> {
  const run = tx ? tx.query.bind(tx) : query;
  const rows = await run<{ email: string }>(
    `SELECT email FROM users WHERE practice_id = $1 AND role = 'bookkeeper' ORDER BY created_ms LIMIT 1`,
    [practiceId],
  );
  return rows[0].email;
}

export async function createReturnsForRegistration(
  tx: Tx,
  input: {
    practiceId: string;
    clientId: string;
    registrationId: string;
    state: LoadedState;
    frequency: Frequency;
    firstPeriod: string;
    reminderHour: number;
    changedBy: string;
  },
): Promise<string[]> {
  const ids: string[] = [];
  for (const period of generatePeriods(input.firstPeriod, input.frequency)) {
    const edition = editionForPeriod(input.state.editions, period, input.frequency);
    const due = computeDueDate({
      period,
      frequency: input.frequency,
      edition,
      holidays: input.state.holidays,
      zone: input.state.zone,
      extensionDays: 0,
    });
    const id = newId();
    await tx.query(
      `INSERT INTO returns (id, practice_id, client_id, registration_id, state_id, period, frequency,
          status, version, gross_sales, tax_due, unextended_nominal_date, nominal_due_date, due_date,
          carried_from, due_at_ms, edition_effective_date, edition_due_day, edition_carry, edition_rate,
          edition_extension_days, awaiting_approval, changed_by, created_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'not_started',1,NULL,NULL,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,false,$18,$19)`,
      [
        id,
        input.practiceId,
        input.clientId,
        input.registrationId,
        input.state.id,
        period,
        input.frequency,
        due.unextendedNominalDate,
        due.nominalDueDate,
        due.dueDate,
        due.carriedFrom,
        due.dueAtMs,
        edition.effective_date,
        edition.due_day,
        edition.carry,
        edition.rate,
        edition.extension_days,
        input.changedBy,
        Date.now(),
      ],
    );
    await syncReminders(tx, id, 'not_started', due.dueDate, input.reminderHour);
    ids.push(id);
  }
  return ids;
}

interface MutationOutcome {
  record: ReturnRecord;
  lines: LiveLine[];
  renderQueued: boolean;
  mailQueued: boolean;
}

async function lockReturn(tx: Tx, returnId: string): Promise<void> {
  await tx.query('SELECT id FROM returns WHERE id = $1 FOR UPDATE', [returnId]);
}

function requireVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw errors.validation({ version: MESSAGES.version });
  }
  return value;
}

/** The version rule: a mismatch persists nothing, whatever else the body held. */
function checkVersion(row: ReturnRow, sent: number): void {
  if (row.version !== sent) {
    throw errors.staleVersion(row.version, row.status, row.changed_by);
  }
}

function checkMove(action: ReturnAction, row: ReturnRow, extended: boolean): void {
  if (!isLegalMove(action, { status: row.status, awaiting_approval: row.awaiting_approval, extended })) {
    throw errors.illegalStatus(row.status);
  }
}

async function isExtended(tx: Tx, returnId: string): Promise<boolean> {
  const rows = await tx.query<{ return_id: string }>(
    'SELECT return_id FROM extensions WHERE return_id = $1',
    [returnId],
  );
  return rows.length > 0;
}

function validateAmounts(body: Record<string, unknown>, amendment: boolean): {
  gross_sales: string;
  tax_due: string;
} {
  const fieldErrors: Record<string, string> = {};
  if (!isAmount(body.gross_sales)) fieldErrors.gross_sales = MESSAGES.amount;
  if (!isAmount(body.tax_due)) fieldErrors.tax_due = MESSAGES.amount;
  if (amendment && body.note !== undefined && body.note !== null) {
    if (typeof body.note !== 'string' || body.note.length > 500) {
      fieldErrors.note = MESSAGES.note_long;
    }
  }
  if (Object.keys(fieldErrors).length > 0) throw errors.validation(fieldErrors);
  return { gross_sales: body.gross_sales as string, tax_due: body.tax_due as string };
}

async function finish(
  practiceId: string,
  outcome: MutationOutcome,
): Promise<ReturnRecord> {
  publish(practiceId, { lines: outcome.lines });
  if (outcome.mailQueued) void attemptMailJobs(practiceId);
  if (outcome.renderQueued) void attemptRenders(practiceId);
  return outcome.record;
}

async function present(tx: Tx, returnId: string, nowMs: number): Promise<ReturnRecord> {
  const row = await loadReturnRowById(returnId, tx);
  if (!row) throw errors.notFound();
  const [record] = await presentReturns([row], nowMs, tx);
  return record;
}

export async function saveAmounts(
  caller: Caller,
  returnId: string,
  body: Record<string, unknown>,
): Promise<ReturnRecord> {
  const outcome = await transaction<MutationOutcome>(async (tx) => {
    const practice = await requirePractice(caller.practiceId);
    const nowMs = practiceNow(practice);
    await lockReturn(tx, returnId);
    const row = await accessibleReturnRow(caller, returnId, tx);
    const version = requireVersion(body.version);
    checkVersion(row, version);
    checkMove('save_amounts', row, await isExtended(tx, returnId));
    const amounts = validateAmounts(body, false);
    const awaiting = row.status === 'prepared';
    await tx.query(
      `UPDATE returns SET gross_sales = $2, tax_due = $3, awaiting_approval = $4,
              version = version + 1, changed_by = $5 WHERE id = $1`,
      [returnId, amounts.gross_sales, amounts.tax_due, awaiting, caller.displayName],
    );
    const record = await present(tx, returnId, nowMs);
    if (awaiting) {
      await queueNotice(
        tx,
        caller.practiceId,
        returnId,
        'approval_request',
        await ownerEmailForClient(row.client_id, tx),
        approvalRequestMessage(record),
      );
    }
    return {
      record,
      lines: [
        {
          text: `Amounts saved for ${record.client.name} ${record.state} ${record.period_label}.`,
          priority: PRIORITY.amounts_saved,
          roles: ['bookkeeper', 'owner'],
          clientId: record.client.id,
        },
      ],
      renderQueued: false,
      mailQueued: awaiting,
    };
  });
  return finish(caller.practiceId, outcome);
}

export async function prepare(
  caller: Caller,
  returnId: string,
  body: Record<string, unknown>,
): Promise<ReturnRecord> {
  const outcome = await transaction<MutationOutcome>(async (tx) => {
    const practice = await requirePractice(caller.practiceId);
    const nowMs = practiceNow(practice);
    await lockReturn(tx, returnId);
    const row = await accessibleReturnRow(caller, returnId, tx);
    checkVersion(row, requireVersion(body.version));
    checkMove('prepare', row, await isExtended(tx, returnId));
    const amounts = validateAmounts(body, false);
    await tx.query(
      `UPDATE returns SET status = 'prepared', gross_sales = $2, tax_due = $3,
              awaiting_approval = true, version = version + 1, changed_by = $4 WHERE id = $1`,
      [returnId, amounts.gross_sales, amounts.tax_due, caller.displayName],
    );
    const record = await present(tx, returnId, nowMs);
    await queueNotice(
      tx,
      caller.practiceId,
      returnId,
      'approval_request',
      await ownerEmailForClient(row.client_id, tx),
      approvalRequestMessage(record),
    );
    return {
      record,
      lines: [statusSavedLine(record, ['bookkeeper', 'owner'])],
      renderQueued: false,
      mailQueued: true,
    };
  });
  return finish(caller.practiceId, outcome);
}

export async function approve(
  caller: Caller,
  returnId: string,
  body: Record<string, unknown>,
): Promise<ReturnRecord> {
  const outcome = await transaction<MutationOutcome>(async (tx) => {
    const practice = await requirePractice(caller.practiceId);
    const nowMs = practiceNow(practice);
    await lockReturn(tx, returnId);
    const row = await accessibleReturnRow(caller, returnId, tx);
    checkVersion(row, requireVersion(body.version));
    checkMove('approve', row, await isExtended(tx, returnId));
    await tx.query(
      `INSERT INTO approvals (id, return_id, action, by_name, at_ms, reason)
       VALUES ($1,$2,'approved',$3,$4,NULL)`,
      [newId(), returnId, caller.displayName, nowMs],
    );
    await tx.query(
      `UPDATE returns SET status = 'client_approved', awaiting_approval = false,
              version = version + 1, changed_by = $2 WHERE id = $1`,
      [returnId, caller.displayName],
    );
    const record = await present(tx, returnId, nowMs);
    await queueNotice(
      tx,
      caller.practiceId,
      returnId,
      'approved',
      await bookkeeperEmailFor(caller.practiceId, tx),
      approvedMessage(record, caller.displayName),
    );
    return {
      record,
      lines: [
        statusSavedLine(record, ['owner']),
        {
          text: `${caller.displayName} approved ${record.state} ${record.period_label}.`,
          priority: PRIORITY.approval_seen,
          roles: ['bookkeeper'],
          clientId: record.client.id,
        },
      ],
      renderQueued: false,
      mailQueued: true,
    };
  });
  return finish(caller.practiceId, outcome);
}

export async function sendBack(
  caller: Caller,
  returnId: string,
  body: Record<string, unknown>,
): Promise<ReturnRecord> {
  const outcome = await transaction<MutationOutcome>(async (tx) => {
    const practice = await requirePractice(caller.practiceId);
    const nowMs = practiceNow(practice);
    await lockReturn(tx, returnId);
    const row = await accessibleReturnRow(caller, returnId, tx);
    checkVersion(row, requireVersion(body.version));
    checkMove('send_back', row, await isExtended(tx, returnId));
    const reason = body.reason;
    if (typeof reason !== 'string' || reason.trim().length === 0) {
      throw errors.validation({ reason: MESSAGES.reason_missing });
    }
    if (reason.length > 500) {
      throw errors.validation({ reason: MESSAGES.reason_long });
    }
    await tx.query(
      `INSERT INTO approvals (id, return_id, action, by_name, at_ms, reason)
       VALUES ($1,$2,'sent_back',$3,$4,$5)`,
      [newId(), returnId, caller.displayName, nowMs, reason],
    );
    await tx.query(
      `UPDATE returns SET status = 'prepared', awaiting_approval = false,
              version = version + 1, changed_by = $2 WHERE id = $1`,
      [returnId, caller.displayName],
    );
    const record = await present(tx, returnId, nowMs);
    await queueNotice(
      tx,
      caller.practiceId,
      returnId,
      'sent_back',
      await bookkeeperEmailFor(caller.practiceId, tx),
      sentBackMessage(record, caller.displayName, reason),
    );
    return {
      record,
      lines: [
        statusSavedLine(record, ['owner']),
        {
          text: `${caller.displayName} sent back ${record.state} ${record.period_label}.`,
          priority: PRIORITY.approval_seen,
          roles: ['bookkeeper'],
          clientId: record.client.id,
        },
      ],
      renderQueued: false,
      mailQueued: true,
    };
  });
  return finish(caller.practiceId, outcome);
}

export async function file(
  caller: Caller,
  returnId: string,
  body: Record<string, unknown>,
): Promise<ReturnRecord> {
  const outcome = await transaction<MutationOutcome>(async (tx) => {
    const practice = await requirePractice(caller.practiceId);
    const nowMs = practiceNow(practice);
    await lockReturn(tx, returnId);
    const row = await accessibleReturnRow(caller, returnId, tx);
    checkVersion(row, requireVersion(body.version));
    checkMove('file', row, await isExtended(tx, returnId));
    await tx.query(
      `UPDATE returns SET status = 'filed', filed_at_ms = $2, awaiting_approval = false,
              packet_target_revision = packet_revisions + 1, version = version + 1, changed_by = $3
         WHERE id = $1`,
      [returnId, nowMs, caller.displayName],
    );
    await syncReminders(tx, returnId, 'filed', row.due_date, practice.reminder_hour);
    const record = await present(tx, returnId, nowMs);
    await queueNotice(
      tx,
      caller.practiceId,
      returnId,
      'filed',
      await ownerEmailForClient(row.client_id, tx),
      filedMessage(record),
    );
    return {
      record,
      lines: [statusSavedLine(record, ['bookkeeper', 'owner'])],
      renderQueued: true,
      mailQueued: true,
    };
  });
  return finish(caller.practiceId, outcome);
}

export async function grantExtension(
  caller: Caller,
  returnId: string,
  body: Record<string, unknown>,
): Promise<ReturnRecord> {
  const outcome = await transaction<MutationOutcome>(async (tx) => {
    const practice = await requirePractice(caller.practiceId);
    const nowMs = practiceNow(practice);
    await lockReturn(tx, returnId);
    const row = await accessibleReturnRow(caller, returnId, tx);
    checkVersion(row, requireVersion(body.version));
    checkMove('extension', row, await isExtended(tx, returnId));
    const dueAtMs = Number(row.due_at_ms);
    if (!extensionAllowed(dueAtMs, nowMs)) throw errors.deadlinePassed();
    const state = await stateForReturn(tx, row);
    const due = computeDueDate({
      period: row.period,
      frequency: row.frequency,
      edition: {
        effective_date: row.edition_effective_date,
        due_day: row.edition_due_day,
        carry: row.edition_carry,
        rate: row.edition_rate,
        extension_days: row.edition_extension_days,
      },
      holidays: state.holidays,
      zone: state.zone,
      extensionDays: row.edition_extension_days,
    });
    await tx.query(
      `INSERT INTO extensions (return_id, granted_at_ms, extension_days, due_date_before, due_at_before_ms)
       VALUES ($1,$2,$3,$4,$5)`,
      [returnId, nowMs, row.edition_extension_days, row.due_date, dueAtMs],
    );
    await tx.query(UPDATE_DATES, [
      returnId,
      due.nominalDueDate,
      due.dueDate,
      due.carriedFrom,
      due.dueAtMs,
    ]);
    await tx.query('UPDATE returns SET changed_by = $2 WHERE id = $1', [
      returnId,
      caller.displayName,
    ]);
    await syncReminders(tx, returnId, row.status, due.dueDate, practice.reminder_hour);
    const record = await present(tx, returnId, nowMs);
    return {
      record,
      lines: [
        {
          text: `Extended to ${longDateString(record.due_date)}.`,
          priority: PRIORITY.extension_granted,
          roles: ['bookkeeper', 'owner'],
          clientId: record.client.id,
        },
      ],
      renderQueued: false,
      mailQueued: false,
    };
  });
  return finish(caller.practiceId, outcome);
}

export async function amend(
  caller: Caller,
  returnId: string,
  body: Record<string, unknown>,
): Promise<ReturnRecord> {
  const outcome = await transaction<MutationOutcome>(async (tx) => {
    const practice = await requirePractice(caller.practiceId);
    const nowMs = practiceNow(practice);
    await lockReturn(tx, returnId);
    const row = await accessibleReturnRow(caller, returnId, tx);
    checkVersion(row, requireVersion(body.version));
    checkMove('amend', row, await isExtended(tx, returnId));
    const amounts = validateAmounts(body, true);
    const note = typeof body.note === 'string' && body.note.length > 0 ? body.note : null;
    await tx.query(
      `INSERT INTO amendments (id, return_id, at_ms, by_name, note,
          original_gross_sales, original_tax_due, amended_gross_sales, amended_tax_due)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        newId(),
        returnId,
        nowMs,
        caller.displayName,
        note,
        row.gross_sales ?? '0.00',
        row.tax_due ?? '0.00',
        amounts.gross_sales,
        amounts.tax_due,
      ],
    );
    await tx.query(
      `UPDATE returns SET status = 'amended', gross_sales = $2, tax_due = $3,
              packet_target_revision = packet_revisions + 1, version = version + 1, changed_by = $4
         WHERE id = $1`,
      [returnId, amounts.gross_sales, amounts.tax_due, caller.displayName],
    );
    const record = await present(tx, returnId, nowMs);
    return {
      record,
      lines: [statusSavedLine(record, ['bookkeeper', 'owner'])],
      renderQueued: true,
      mailQueued: false,
    };
  });
  return finish(caller.practiceId, outcome);
}

async function requirePractice(practiceId: string): Promise<PracticeRow> {
  const practice = await getPractice(practiceId);
  if (!practice) throw errors.notFound();
  return practice;
}

async function stateForReturn(tx: Tx, row: ReturnRow): Promise<LoadedState> {
  const state = await loadState(row.practice_id, row.state_code, tx);
  if (!state) throw errors.notFound();
  return state;
}

/**
 * Publishing an edition recalculates only the not_started returns of that
 * state whose periods start on or after its effective date.
 */
export async function recalculateForEdition(
  tx: Tx,
  state: LoadedState,
  effectiveDate: string,
  reminderHour: number,
): Promise<string[]> {
  const rows = await loadReturnRows(
    state.practice_id,
    { stateCode: state.code },
    tx,
  );
  const recalculated: string[] = [];
  for (const row of rows) {
    if (row.status !== 'not_started') continue;
    const startDate = formatDate(periodStartDate(row.period, row.frequency));
    if (startDate < effectiveDate) continue;
    const edition = editionForPeriod(state.editions, row.period, row.frequency);
    const extension = await tx.queryOne<{ extension_days: number }>(
      'SELECT extension_days FROM extensions WHERE return_id = $1',
      [row.id],
    );
    const due = computeDueDate({
      period: row.period,
      frequency: row.frequency,
      edition,
      holidays: state.holidays,
      zone: state.zone,
      extensionDays: extension ? extension.extension_days : 0,
    });
    await tx.query(
      `UPDATE returns SET unextended_nominal_date = $2, nominal_due_date = $3, due_date = $4,
              carried_from = $5, due_at_ms = $6, edition_effective_date = $7, edition_due_day = $8,
              edition_carry = $9, edition_rate = $10, edition_extension_days = $11,
              version = version + 1 WHERE id = $1`,
      [
        row.id,
        due.unextendedNominalDate,
        due.nominalDueDate,
        due.dueDate,
        due.carriedFrom,
        due.dueAtMs,
        edition.effective_date,
        edition.due_day,
        edition.carry,
        edition.rate,
        edition.extension_days,
      ],
    );
    await syncReminders(tx, row.id, row.status, due.dueDate, reminderHour);
    recalculated.push(row.id);
  }
  return recalculated;
}

/**
 * Saving a holiday list carries the unchanged extended nominal date forward
 * again, for every not_started return of that state.
 */
export async function recalculateForHolidays(
  tx: Tx,
  state: LoadedState,
  reminderHour: number,
): Promise<string[]> {
  const rows = await loadReturnRows(state.practice_id, { stateCode: state.code }, tx);
  const recalculated: string[] = [];
  for (const row of rows) {
    if (row.status !== 'not_started') continue;
    const nominal = row.nominal_due_date;
    const carried = carryForward(parseDate(nominal), row.edition_carry, state.holidays);
    const carriedString = formatDate(carried);
    await tx.query(UPDATE_DATES, [
      row.id,
      nominal,
      carriedString,
      carriedString === nominal ? null : nominal,
      endOfDayInstant(state.zone, carried),
    ]);
    await syncReminders(tx, row.id, row.status, carriedString, reminderHour);
    recalculated.push(row.id);
  }
  return recalculated;
}

export async function resyncAllReminders(
  tx: Tx,
  practiceId: string,
  reminderHour: number,
): Promise<void> {
  const rows = await tx.query<{ id: string; status: ReturnStatus; due_date: string }>(
    'SELECT id, status, due_date::text AS due_date FROM returns WHERE practice_id = $1',
    [practiceId],
  );
  for (const row of rows) {
    await syncReminders(tx, row.id, row.status, row.due_date, reminderHour);
  }
}

/**
 * Announces every return whose deadline the practice clock has just passed, in
 * deadline order, so the latest deadline's line is the one that stays.
 */
export async function announceNewlyOverdue(
  practiceId: string,
  fromMs: number,
  toMs: number,
): Promise<void> {
  if (toMs <= fromMs) return;
  const rows = await query<{
    id: string;
    client_id: string;
    client_name: string;
    state_code: string;
    period: string;
    frequency: Frequency;
  }>(
    `SELECT r.id, r.client_id, c.name AS client_name, s.code AS state_code, r.period, r.frequency
       FROM returns r JOIN clients c ON c.id = r.client_id JOIN states s ON s.id = r.state_id
      WHERE r.practice_id = $1 AND r.status IN ('not_started','prepared','client_approved')
        AND r.due_at_ms >= $2 AND r.due_at_ms < $3
      ORDER BY r.due_at_ms, s.code, c.name, r.id`,
    [practiceId, fromMs, toMs],
  );
  if (rows.length === 0) return;
  publish(practiceId, {
    lines: rows.map((row, index) => ({
      text: `${row.client_name} ${row.state_code} ${periodLabel(row.period, row.frequency)} is overdue.`,
      priority: PRIORITY.went_overdue,
      roles: ['bookkeeper', 'owner'] as Role[],
      clientId: row.client_id,
      order: index,
    })),
  });
}
