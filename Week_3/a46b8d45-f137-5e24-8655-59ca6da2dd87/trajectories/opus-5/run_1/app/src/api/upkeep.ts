/**
 * The weekly upkeep: importing the supplier parts file and publishing dated aftercare
 * editions. Neither ever changes a claim that has already been decided.
 */

import * as catalogue from '../db/catalogue';
import { apiError, validationFailed } from '../http/errors';
import { EDITION_CODE_PATTERN, type Edition } from '../domain/editions';
import { isLondonDate, londonDate, now } from '../domain/time';
import { matchModelName } from '../domain/model-match';
import { withTransaction } from '../db/pool';

const OPERATOR = 'operator' as const;

const EXPECTED_HEADER =
  'model_name,booklet_number,part_number,part_name,price_gbp,weight_g,longest_side_mm,status';

export type RowReason =
  | 'missing_field'
  | 'unknown_model'
  | 'ambiguous_model'
  | 'bad_booklet_number'
  | 'bad_part_number'
  | 'bad_price'
  | 'bad_weight'
  | 'bad_size'
  | 'bad_status'
  | 'duplicate_row';

export interface UnmatchedRow {
  line: number;
  reason: RowReason;
}

export interface ImportReport {
  created: number;
  updated: number;
  unchanged: number;
  unmatched: UnmatchedRow[];
}

const BOOKLET_MIN = 1;
const BOOKLET_MAX = 99;

function positiveWhole(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return parsed > 0 ? parsed : null;
}

/** A price is a decimal with at most two places, from 0.01 up. */
function priceMinor(value: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const [units, fraction = ''] = value.split('.');
  const minor = Number(units) * 100 + Number(fraction.padEnd(2, '0'));
  return minor >= 1 ? minor : null;
}

interface ParsedRow {
  line: number;
  fields: string[];
}

function parseRows(csv: string): { header: string; rows: ParsedRow[] } {
  const lines = csv.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  // A trailing newline is not a row.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  const rows: ParsedRow[] = [];
  // Line numbers count from 1, so the first data row is line 2. Blank lines are skipped
  // but still counted.
  for (let index = 1; index < lines.length; index += 1) {
    const text = lines[index] ?? '';
    if (text.trim() === '') continue;
    rows.push({ line: index + 1, fields: text.split(',').map((field) => field.trim()) });
  }
  return { header: (lines[0] ?? '').trim(), rows };
}

/** A row reports its first failure only. */
function checkRow(
  fields: string[],
  models: readonly { slug: string; name: string; retiredNames: readonly string[] }[],
): { reason: RowReason } | { part: Omit<catalogue.CataloguePart, 'binCount'> } {
  const [modelName = '', booklet = '', partNumber = '', partName = '', price = '', weight = '', size = '', status = ''] =
    fields;

  if ([modelName, booklet, partNumber, partName, price, weight, size, status].some((field) => field === '')) {
    return { reason: 'missing_field' };
  }

  const match = matchModelName(modelName, models);
  if (match.outcome !== 'matched') return { reason: match.outcome };

  const bookletNumber = positiveWhole(booklet);
  if (bookletNumber === null || bookletNumber < BOOKLET_MIN || bookletNumber > BOOKLET_MAX) {
    return { reason: 'bad_booklet_number' };
  }
  if (!/^(\d{6}|\d{8})$/.test(partNumber)) return { reason: 'bad_part_number' };

  const minor = priceMinor(price);
  if (minor === null) return { reason: 'bad_price' };

  const weightG = positiveWhole(weight);
  if (weightG === null) return { reason: 'bad_weight' };

  const longestSideMm = positiveWhole(size);
  if (longestSideMm === null) return { reason: 'bad_size' };

  if (status !== 'active' && status !== 'withdrawn') return { reason: 'bad_status' };

  return {
    part: {
      modelSlug: match.slug,
      bookletNumber,
      partNumber,
      name: partName,
      priceMinor: minor,
      weightG,
      longestSideMm,
      status,
    },
  };
}

/** Importing the same file again creates and changes nothing. */
export async function importSupplierFile(csv: string): Promise<ImportReport> {
  const { header, rows } = parseRows(csv);
  if (header !== EXPECTED_HEADER) throw validationFailed({ file: 'bad_header' });

  const models = await catalogue.modelNamesForMatching();

  return withTransaction(async (tx) => {
    const report: ImportReport = { created: 0, updated: 0, unchanged: 0, unmatched: [] };
    const seen = new Set<string>();

    for (const row of rows) {
      const outcome = checkRow(row.fields, models);
      if ('reason' in outcome) {
        report.unmatched.push({ line: row.line, reason: outcome.reason });
        continue;
      }

      const key = `${outcome.part.modelSlug}#${outcome.part.bookletNumber}`;
      if (seen.has(key)) {
        report.unmatched.push({ line: row.line, reason: 'duplicate_row' });
        continue;
      }
      seen.add(key);

      const effect = await catalogue.upsertImportedPart(tx, outcome.part);
      report[effect] += 1;
    }

    return report;
  });
}

/* ------------------------------------------------------------------------- editions */

export interface EditionInput {
  code: string;
  title: string;
  startsOn: string;
  standardMonths: string;
  clubMonths: string;
  ownerContributionPercent: string;
}

const TITLE_MAX = 80;
const MONTHS_MIN = 1;
const MONTHS_MAX = 120;

function monthsOrNull(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return value >= MONTHS_MIN && value <= MONTHS_MAX ? value : null;
}

/**
 * An edition rules only claims confirmed from 00:00 Europe/London on its start date, so the
 * server accepts only a start date strictly after today's London date.
 */
export async function saveEdition(input: EditionInput): Promise<Edition> {
  const code = input.code.trim();
  const startsOn = input.startsOn.trim();

  // A state conflict is answered before field validation, so a well-formed clash wins.
  if (EDITION_CODE_PATTERN.test(code) && (await catalogue.editionCodeTaken(code))) {
    throw apiError(OPERATOR, 409, 'edition_code_taken');
  }
  if (isLondonDate(startsOn) && (await catalogue.editionDateTaken(startsOn))) {
    throw apiError(OPERATOR, 409, 'edition_date_taken');
  }

  const errors: Record<string, string> = {};
  if (code === '') errors['code'] = 'required';
  else if (!EDITION_CODE_PATTERN.test(code)) errors['code'] = 'invalid';

  const title = input.title.trim();
  if (title === '') errors['title'] = 'required';
  else if ([...title].length > TITLE_MAX) errors['title'] = 'too_long';

  if (startsOn === '') errors['starts_on'] = 'required';
  else if (!isLondonDate(startsOn)) errors['starts_on'] = 'invalid';
  else if (startsOn <= londonDate(now())) errors['starts_on'] = 'must_be_future';

  const standardMonths = monthsOrNull(input.standardMonths.trim());
  if (input.standardMonths.trim() === '') errors['standard_months'] = 'required';
  else if (standardMonths === null) errors['standard_months'] = 'invalid';

  const clubMonths = monthsOrNull(input.clubMonths.trim());
  if (input.clubMonths.trim() === '') errors['club_months'] = 'required';
  else if (clubMonths === null) errors['club_months'] = 'invalid';

  const percentRaw = input.ownerContributionPercent.trim();
  let percent: number | null = null;
  if (percentRaw === '') {
    errors['owner_contribution_percent'] = 'required';
  } else if (!/^\d+$/.test(percentRaw) || Number(percentRaw) > 100) {
    errors['owner_contribution_percent'] = 'invalid';
  } else {
    percent = Number(percentRaw);
  }

  if (Object.keys(errors).length > 0) throw validationFailed(errors);

  const edition: Edition = {
    code,
    title,
    startsOn,
    standardMonths: standardMonths as number,
    clubMonths: clubMonths as number,
    ownerContributionPercent: percent as number,
  };
  // Editions cannot be edited or deleted, so saving one changes no ruling already made.
  await catalogue.insertEdition(edition);
  return edition;
}
