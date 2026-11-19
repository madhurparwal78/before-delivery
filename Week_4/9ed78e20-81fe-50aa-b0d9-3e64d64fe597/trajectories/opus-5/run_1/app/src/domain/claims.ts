import { bodyMarkerIds } from './bodytext.js';
import { COMPARATORS } from './comparators.js';
import { formatCalendarDate } from './london.js';

export type Claim = {
  readonly id: string;
  readonly text: string;
  readonly benchmark: string;
  readonly eval_date: string;
  readonly comparator: string;
  readonly stated_delta: string;
};

export type BenchmarkRow = {
  readonly id: string;
  readonly subject: string;
  readonly benchmark: string;
  readonly eval_date: string;
  readonly score_text: string;
};

export type ClaimVerdict = {
  readonly claim: string;
  readonly ok: boolean;
  readonly reason: string | null;
};

export const SCORE_PATTERN = /^(?:100(?:\.0{1,2})?|\d{1,2}(?:\.\d{1,2})?)$/;
const STATED_DELTA_PATTERN = /^[+-]?\d+(?:\.\d{1,2})?$/;
const CLAIM_ID_PATTERN = /^c\d+$/;

function decimals(value: string): number {
  const dot = value.indexOf('.');
  return dot === -1 ? 0 : value.length - dot - 1;
}

function scaled(value: string, places: number): bigint {
  const negative = value.startsWith('-');
  const digits = value.replace(/^[+-]/, '');
  const [whole = '0', fraction = ''] = digits.split('.');
  const padded = (fraction + '0'.repeat(places)).slice(0, places);
  const magnitude = BigInt(whole + (places > 0 ? padded : ''));
  return negative ? -magnitude : magnitude;
}

function formatScaled(amount: bigint, places: number): string {
  const sign = amount < 0n ? '-' : '+';
  const digits = (amount < 0n ? -amount : amount).toString().padStart(places + 1, '0');
  if (places === 0) return `${sign}${digits}`;
  return `${sign}${digits.slice(0, digits.length - places)}.${digits.slice(digits.length - places)}`;
}

/** The model's score minus the comparator's, at the wider precision, signed. */
export function recordedDelta(modelScore: string, comparatorScore: string): string {
  const places = Math.max(decimals(modelScore), decimals(comparatorScore));
  return formatScaled(scaled(modelScore, places) - scaled(comparatorScore, places), places);
}

export function deltaMagnitude(delta: string): string {
  return delta.replace(/^[+-]/, '');
}

function sameNumericValue(left: string, right: string): boolean {
  const places = Math.max(decimals(left), decimals(right));
  return scaled(left, places) === scaled(right, places);
}

export function isValidStatedDelta(value: string): boolean {
  return STATED_DELTA_PATTERN.test(value);
}

export function isValidClaimId(value: string): boolean {
  return CLAIM_ID_PATTERN.test(value);
}

const DATE_IN_TEXT = /\d{4}-\d{2}-\d{2}/g;
const NUMERIC_RUN = /[0-9.]+/g;

/** Every number in a claim's text, with model and benchmark names excluded. */
export function numbersInClaimText(
  text: string,
  modelName: string,
  benchmark: string,
): readonly string[] {
  const names = [modelName, benchmark, ...COMPARATORS.map((comparator) => comparator.name)]
    .filter((name) => name.length > 0)
    .sort((left, right) => right.length - left.length);

  let cleaned = text;
  for (const name of names) {
    cleaned = cleaned.split(name).join(' ');
  }

  const dateRanges: Array<readonly [number, number]> = [];
  DATE_IN_TEXT.lastIndex = 0;
  for (let match = DATE_IN_TEXT.exec(cleaned); match !== null; match = DATE_IN_TEXT.exec(cleaned)) {
    dateRanges.push([match.index, match.index + match[0].length]);
  }

  const numbers: string[] = [];
  NUMERIC_RUN.lastIndex = 0;
  for (let match = NUMERIC_RUN.exec(cleaned); match !== null; match = NUMERIC_RUN.exec(cleaned)) {
    const run = match[0];
    const leading = run.length - run.replace(/^\.+/, '').length;
    const token = run.replace(/^\.+/, '').replace(/\.+$/, '');
    if (!/^\d+(?:\.\d+)?$/.test(token)) continue;
    const start = match.index + leading;
    const end = start + token.length;
    if (dateRanges.some(([from, to]) => start >= from && end <= to)) continue;
    const before = cleaned.charAt(start - 1);
    const after = cleaned.charAt(end);
    if (/\p{L}/u.test(before) || /\p{L}/u.test(after)) continue;
    numbers.push(token);
  }
  return numbers;
}

function rowFor(
  rows: readonly BenchmarkRow[],
  subject: string,
  benchmark: string,
  evalDate: string,
): BenchmarkRow | undefined {
  return rows.find(
    (row) => row.subject === subject && row.benchmark === benchmark && row.eval_date === evalDate,
  );
}

export type ClaimValidation = {
  readonly ok: boolean;
  readonly verdicts: readonly ClaimVerdict[];
  readonly fields: Readonly<Record<string, string>>;
};

/** Checks a model route's claims against the recorded benchmark rows. */
export function validateClaims(input: {
  readonly slug: string;
  readonly title: string;
  readonly body: string;
  readonly claims: readonly Claim[];
  readonly rows: readonly BenchmarkRow[];
}): ClaimValidation {
  const verdicts: ClaimVerdict[] = [];
  const fields: Record<string, string> = {};
  const markers = bodyMarkerIds(input.body);

  for (const claim of input.claims) {
    const modelRow = rowFor(input.rows, input.slug, claim.benchmark, claim.eval_date);
    const comparatorRow = rowFor(input.rows, claim.comparator, claim.benchmark, claim.eval_date);
    let reason: string | null = null;

    if (modelRow === undefined || comparatorRow === undefined) {
      const missing = modelRow === undefined ? input.slug : claim.comparator;
      reason = `No recorded row for ${missing} on ${claim.benchmark} at ${claim.eval_date}.`;
    } else {
      const recorded = recordedDelta(modelRow.score_text, comparatorRow.score_text);
      if (!sameNumericValue(claim.stated_delta, recorded)) {
        reason = `Stated difference ${claim.stated_delta} does not match the recorded difference ${recorded}.`;
      } else {
        const allowed = [
          modelRow.score_text,
          comparatorRow.score_text,
          deltaMagnitude(recorded),
        ];
        const offending = numbersInClaimText(claim.text, input.title, claim.benchmark).find(
          (number) => !allowed.some((value) => sameNumericValue(number, value)),
        );
        if (offending !== undefined) {
          reason = `The number ${offending} in the claim text does not match the cited rows.`;
        }
      }
    }

    if (reason === null && !markers.includes(claim.id)) {
      reason = `Claim ${claim.id} is not marked in the body.`;
    }

    verdicts.push({ claim: claim.id, ok: reason === null, reason });
    if (reason !== null) fields[claim.id] = reason;
  }

  const defined = new Set(input.claims.map((claim) => claim.id));
  for (const marker of markers) {
    if (!defined.has(marker)) {
      const reason = `The body marks claim ${marker}, which is not defined.`;
      verdicts.push({ claim: 'body', ok: false, reason });
      if (fields.body === undefined) fields.body = reason;
    }
  }

  return { ok: Object.keys(fields).length === 0, verdicts, fields };
}

export function claimAnnouncement(input: {
  readonly number: number;
  readonly benchmark: string;
  readonly modelName: string;
  readonly modelScore: string;
  readonly comparatorName: string;
  readonly comparatorScore: string;
  readonly evalDate: string;
}): string {
  return `Claim ${input.number}: ${input.benchmark}, ${input.modelName} ${input.modelScore} versus ${input.comparatorName} ${input.comparatorScore}, evaluated ${formatCalendarDate(
    input.evalDate,
  )}.`;
}
