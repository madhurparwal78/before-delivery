/**
 * Which request members a create or save accepts, and every draft field rule.
 * Both decisions live here; create, save and submit all call this module.
 */
import { Transaction } from './db';
import {
  ROW_KEYS,
  RowKey,
  SHARE_EVENT_KINDS,
  ShareEventKind,
} from '../shared/labels';
import { Decimal, add, compare, fractionalDigits, fromInteger, isNegative, parseDecimal } from '../shared/decimal';
import { addDays, formatDateString, parseDateString } from '../shared/nytime';
import { isWithinWeek } from '../domain/calendar';
import { dilutedSharesInEffect, signedShares } from './ledger';
import { RestatementRecord, currentRestatementForWeek } from './restatementStore';

export const IMMUTABLE_MEMBER_MESSAGE = 'This field cannot be changed here.';

const MESSAGES = {
  required: 'Enter a value.',
  ethAmount: 'Enter an ETH amount of up to 18 decimal places, zero or more.',
  shareCount: 'Enter a whole number of shares above zero.',
  eventKind: 'Choose an event type.',
  effectiveDate: 'Enter a date inside this holdings week.',
  accession: 'Enter an accession number as 0000000000-00-000000.',
  exhibitPage: 'Enter a page from 1 to 500.',
  correctionReason: 'Enter a correction reason of 10 to 500 characters.',
  shareEventsShape: 'Enter the share-count events as a list.',
  rowsShape: 'Enter the exhibit rows as an object.',
  beginningBalance: "This does not match the prior week's ending balance.",
  endingBalance: 'This does not equal beginning balance plus ETH acquired plus staking rewards.',
  cumulative:
    "This does not equal the prior week's cumulative rewards plus this week's staking rewards.",
  dilutedShares: 'This does not match the diluted share count in effect on the week-ending date.',
  eventBelowZero: 'This event would take the diluted share count to zero or below.',
} as const;

export const WEEKLY_CREATE_MEMBERS = [
  'week_ending',
  'rows',
  'share_events',
  'accession',
  'exhibit_page',
] as const;

export const CORRECTION_CREATE_MEMBERS = [
  'supersedes',
  'correction_reason',
  'rows',
  'share_events',
  'accession',
  'exhibit_page',
] as const;

export const SAVE_MEMBERS = [
  'version',
  'rows',
  'share_events',
  'accession',
  'exhibit_page',
  'correction_reason',
] as const;

const SHARE_EVENT_MEMBERS = ['kind', 'shares', 'effective_date', 'id'] as const;

export interface ParsedShareEvent {
  kind: ShareEventKind;
  shares: string;
  effectiveDate: string;
}

export interface DraftPatch {
  rows?: Partial<Record<RowKey, string>>;
  shareEvents?: ParsedShareEvent[];
  accession?: string;
  exhibitPage?: number;
  correctionReason?: string;
}

export type FieldFailures = Record<string, string>;

const ACCESSION_PATTERN = /^\d{10}-\d{2}-\d{6}$/;
const INTEGER_PATTERN = /^[1-9][0-9]*$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function collectUnacceptedMembers(
  body: Record<string, unknown>,
  accepted: readonly string[],
): FieldFailures {
  const failures: FieldFailures = {};
  for (const member of Object.keys(body)) {
    if (!accepted.includes(member)) failures[member] = IMMUTABLE_MEMBER_MESSAGE;
  }
  return failures;
}

function parseRows(raw: unknown, failures: FieldFailures): Partial<Record<RowKey, string>> | null {
  if (!isPlainObject(raw)) {
    failures.rows = MESSAGES.rowsShape;
    return null;
  }
  const rows: Partial<Record<RowKey, string>> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!(ROW_KEYS as readonly string[]).includes(key)) {
      failures[`rows.${key}`] = IMMUTABLE_MEMBER_MESSAGE;
      continue;
    }
    const rowKey = key as RowKey;
    if (typeof value !== 'string') {
      failures[`rows.${rowKey}`] =
        rowKey === 'diluted-shares' ? MESSAGES.shareCount : MESSAGES.ethAmount;
      continue;
    }
    rows[rowKey] = value;
  }
  return rows;
}

function checkRowFormat(key: RowKey, value: string, failures: FieldFailures): Decimal | null {
  if (key === 'diluted-shares') {
    if (!INTEGER_PATTERN.test(value)) {
      failures[`rows.${key}`] = MESSAGES.shareCount;
      return null;
    }
    return fromInteger(BigInt(value));
  }
  const parsed = parseDecimal(value);
  if (parsed === null || isNegative(parsed) || fractionalDigits(value) > 18) {
    failures[`rows.${key}`] = MESSAGES.ethAmount;
    return null;
  }
  return parsed;
}

function parseShareEvents(
  raw: unknown,
  weekEnding: string,
  failures: FieldFailures,
): ParsedShareEvent[] | null {
  if (!Array.isArray(raw)) {
    failures.share_events = MESSAGES.shareEventsShape;
    return null;
  }
  const parsed: ParsedShareEvent[] = [];
  const weekEndingDate = parseDateString(weekEnding);
  raw.forEach((entry, index) => {
    if (!isPlainObject(entry)) {
      failures[`share_events.${index}.kind`] = MESSAGES.eventKind;
      return;
    }
    for (const member of Object.keys(entry)) {
      if (!(SHARE_EVENT_MEMBERS as readonly string[]).includes(member)) {
        failures[`share_events.${index}.${member}`] = IMMUTABLE_MEMBER_MESSAGE;
      }
    }
    const kind = entry.kind;
    const shares = entry.shares;
    const effectiveDate = entry.effective_date;
    let validKind: ShareEventKind | null = null;
    if (typeof kind !== 'string' || !(SHARE_EVENT_KINDS as readonly string[]).includes(kind)) {
      failures[`share_events.${index}.kind`] = MESSAGES.eventKind;
    } else {
      validKind = kind as ShareEventKind;
    }
    let validShares: string | null = null;
    if (typeof shares !== 'string' || !INTEGER_PATTERN.test(shares)) {
      failures[`share_events.${index}.shares`] = MESSAGES.shareCount;
    } else {
      validShares = shares;
    }
    let validDate: string | null = null;
    if (typeof effectiveDate !== 'string') {
      failures[`share_events.${index}.effective_date`] = MESSAGES.effectiveDate;
    } else {
      const date = parseDateString(effectiveDate);
      if (date === null || weekEndingDate === null || !isWithinWeek(weekEndingDate, date)) {
        failures[`share_events.${index}.effective_date`] = MESSAGES.effectiveDate;
      } else {
        validDate = effectiveDate;
      }
    }
    if (validKind !== null && validShares !== null && validDate !== null) {
      parsed.push({ kind: validKind, shares: validShares, effectiveDate: validDate });
    }
  });
  return parsed;
}

export function parseDraftMembers(
  body: Record<string, unknown>,
  accepted: readonly string[],
  weekEnding: string,
  failures: FieldFailures,
): DraftPatch {
  const patch: DraftPatch = {};
  if (accepted.includes('rows') && 'rows' in body) {
    const rows = parseRows(body.rows, failures);
    if (rows !== null) {
      for (const [key, value] of Object.entries(rows)) {
        checkRowFormat(key as RowKey, value, failures);
      }
      patch.rows = rows;
    }
  }
  if (accepted.includes('share_events') && 'share_events' in body) {
    const events = parseShareEvents(body.share_events, weekEnding, failures);
    if (events !== null) patch.shareEvents = events;
  }
  if (accepted.includes('accession') && 'accession' in body) {
    const accession = body.accession;
    if (typeof accession !== 'string' || !ACCESSION_PATTERN.test(accession)) {
      failures.accession = MESSAGES.accession;
    } else {
      patch.accession = accession;
    }
  }
  if (accepted.includes('exhibit_page') && 'exhibit_page' in body) {
    const page = body.exhibit_page;
    if (typeof page !== 'number' || !Number.isInteger(page) || page < 1 || page > 500) {
      failures.exhibit_page = MESSAGES.exhibitPage;
    } else {
      patch.exhibitPage = page;
    }
  }
  if (accepted.includes('correction_reason') && 'correction_reason' in body) {
    const reason = body.correction_reason;
    if (typeof reason !== 'string' || reason.length < 10 || reason.length > 500) {
      failures.correction_reason = MESSAGES.correctionReason;
    } else {
      patch.correctionReason = reason;
    }
  }
  return patch;
}

export interface EffectiveDraft {
  weekEnding: string;
  isCorrection: boolean;
  supersedesId: string | null;
  rows: Partial<Record<RowKey, string>>;
  shareEvents: ParsedShareEvent[];
  accession: string | null;
  exhibitPage: number | null;
  correctionReason: string | null;
}

export function mergeDraft(
  stored: RestatementRecord | null,
  patch: DraftPatch,
  weekEnding: string,
  isCorrection: boolean,
  supersedesId: string | null,
): EffectiveDraft {
  const storedRows: Partial<Record<RowKey, string>> = {};
  if (stored !== null) {
    for (const key of ROW_KEYS) {
      const value = stored.rows[key];
      if (value !== null) storedRows[key] = value;
    }
  }
  const rows = patch.rows !== undefined ? patch.rows : storedRows;
  const shareEvents =
    patch.shareEvents !== undefined
      ? patch.shareEvents
      : (stored?.shareEvents ?? []).map((event) => ({
          kind: event.kind,
          shares: event.shares,
          effectiveDate: event.effectiveDate,
        }));
  return {
    weekEnding,
    isCorrection,
    supersedesId,
    rows,
    shareEvents,
    accession: patch.accession ?? stored?.accession ?? null,
    exhibitPage: patch.exhibitPage ?? stored?.exhibitPage ?? null,
    correctionReason: patch.correctionReason ?? stored?.correctionReason ?? null,
  };
}

/**
 * The holdings arithmetic checks. Checks that involve a row not yet entered are
 * skipped unless `requireEveryField` is set, which is what submit does.
 */
export async function checkDraftArithmetic(
  tx: Transaction,
  draft: EffectiveDraft,
  failures: FieldFailures,
  requireEveryField: boolean,
): Promise<void> {
  const weekEndingDate = parseDateString(draft.weekEnding);
  if (weekEndingDate === null) return;

  if (requireEveryField) {
    for (const key of ROW_KEYS) {
      if (draft.rows[key] === undefined && failures[`rows.${key}`] === undefined) {
        failures[`rows.${key}`] = MESSAGES.required;
      }
    }
    if (draft.accession === null && failures.accession === undefined) {
      failures.accession = MESSAGES.accession;
    }
    if (draft.exhibitPage === null && failures.exhibit_page === undefined) {
      failures.exhibit_page = MESSAGES.exhibitPage;
    }
    if (draft.isCorrection && draft.correctionReason === null) {
      failures.correction_reason = MESSAGES.correctionReason;
    }
  }

  const values: Partial<Record<RowKey, Decimal>> = {};
  for (const key of ROW_KEYS) {
    const raw = draft.rows[key];
    if (raw === undefined) continue;
    if (failures[`rows.${key}`] !== undefined) continue;
    const parsed = checkRowFormat(key, raw, failures);
    if (parsed !== null) values[key] = parsed;
  }

  const priorWeekEnding = formatDateString(addDays(weekEndingDate, -7));
  const priorWeek = await currentRestatementForWeek(tx, priorWeekEnding);

  const beginning = values['beginning-balance'];
  const acquired = values['eth-acquired'];
  const staking = values['staking-rewards'];
  const ending = values['ending-balance'];
  const cumulative = values['cumulative-staking-rewards'];
  const diluted = values['diluted-shares'];

  if (priorWeek !== null && beginning !== undefined && failures['rows.beginning-balance'] === undefined) {
    const priorEnding = priorWeek.rows['ending-balance'];
    const parsedPriorEnding = priorEnding === null ? null : parseDecimal(priorEnding);
    if (parsedPriorEnding !== null && compare(beginning, parsedPriorEnding) !== 0) {
      failures['rows.beginning-balance'] = MESSAGES.beginningBalance;
    }
  }

  if (
    beginning !== undefined &&
    acquired !== undefined &&
    staking !== undefined &&
    ending !== undefined &&
    failures['rows.ending-balance'] === undefined
  ) {
    if (compare(ending, add(add(beginning, acquired), staking)) !== 0) {
      failures['rows.ending-balance'] = MESSAGES.endingBalance;
    }
  }

  if (
    priorWeek !== null &&
    staking !== undefined &&
    cumulative !== undefined &&
    failures['rows.cumulative-staking-rewards'] === undefined
  ) {
    const priorCumulative = priorWeek.rows['cumulative-staking-rewards'];
    const parsedPrior = priorCumulative === null ? null : parseDecimal(priorCumulative);
    if (parsedPrior !== null && compare(cumulative, add(parsedPrior, staking)) !== 0) {
      failures['rows.cumulative-staking-rewards'] = MESSAGES.cumulative;
    }
  }

  const eventsAreValid = draft.shareEvents.every(
    (_event, index) =>
      failures[`share_events.${index}.kind`] === undefined &&
      failures[`share_events.${index}.shares`] === undefined &&
      failures[`share_events.${index}.effective_date`] === undefined,
  );

  if (eventsAreValid) {
    const beforeWeek = formatDateString(addDays(weekEndingDate, -7));
    const runningStart = await dilutedSharesInEffect(tx, beforeWeek, draft.supersedesId);
    const ordered = draft.shareEvents
      .map((event, index) => ({ event, index }))
      .sort((left, right) => {
        if (left.event.effectiveDate === right.event.effectiveDate) return left.index - right.index;
        return left.event.effectiveDate < right.event.effectiveDate ? -1 : 1;
      });
    let running = runningStart;
    for (const { event, index } of ordered) {
      running += signedShares(event.kind, BigInt(event.shares));
      if (running <= 0n) {
        failures[`share_events.${index}.shares`] = MESSAGES.eventBelowZero;
        break;
      }
    }

    if (diluted !== undefined && failures['rows.diluted-shares'] === undefined) {
      const base = await dilutedSharesInEffect(tx, draft.weekEnding, draft.supersedesId);
      let expected = base;
      for (const event of draft.shareEvents) {
        if (event.effectiveDate <= draft.weekEnding) {
          expected += signedShares(event.kind, BigInt(event.shares));
        }
      }
      if (compare(diluted, fromInteger(expected)) !== 0) {
        failures['rows.diluted-shares'] = MESSAGES.dilutedShares;
      }
    }
  }
}
