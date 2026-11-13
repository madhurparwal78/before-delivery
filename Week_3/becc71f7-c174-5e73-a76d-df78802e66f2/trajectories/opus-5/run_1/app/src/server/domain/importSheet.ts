/**
 * The previous tool's spreadsheet: parsing, consignor matching and the one refusal reason
 * per refused row. The preview and Save read a file exactly the same way.
 */

import { addDays, isValidBrusselsDate, type BrusselsDate } from '../../shared/brussels.js';
import { parseEuros } from '../../shared/money.js';
import { importReason } from '../../shared/copy.js';
import { isValidIban, normaliseIban } from '../domain/iban.js';
import { EMAIL_PATTERN } from '../../shared/validate.js';
import {
  CATEGORIES,
  CONDITIONS,
  SIZES,
  type Category,
  type Condition,
  type ImportRowStatus,
  type Size,
} from '../../shared/options.js';

export const EXPECTED_HEADER = [
  'item_no',
  'consignor_name',
  'consignor_email',
  'consignor_phone',
  'consignor_iban',
  'category',
  'brand',
  'description',
  'size',
  'condition',
  'asking_price',
  'intake_date',
] as const;

const MIN_ASKING_PRICE_CENTS = 100;
const MAX_ASKING_PRICE_CENTS = 1_000_000;
const MAX_INTAKE_DAYS_BACK = 730;

/** Comma separated, double-quoted fields where needed, LF or CRLF line ends. */
export function parseCsv(text: string): string[][] {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines: string[][] = [];
  let fields: string[] = [];
  let value = '';
  let quoted = false;
  let index = 0;

  const endField = (): void => {
    fields.push(value);
    value = '';
  };
  const endLine = (): void => {
    endField();
    lines.push(fields);
    fields = [];
  };

  while (index < body.length) {
    const character = body[index] as string;
    if (quoted) {
      if (character === '"') {
        if (body[index + 1] === '"') {
          value += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      value += character;
      index += 1;
      continue;
    }
    if (character === '"' && value === '') {
      quoted = true;
      index += 1;
      continue;
    }
    if (character === ',') {
      endField();
      index += 1;
      continue;
    }
    if (character === '\r' && body[index + 1] === '\n') {
      endLine();
      index += 2;
      continue;
    }
    if (character === '\n' || character === '\r') {
      endLine();
      index += 1;
      continue;
    }
    value += character;
    index += 1;
  }
  if (value !== '' || fields.length > 0) endLine();
  return lines;
}

/** lower case, accents removed, every run of other characters one space, trimmed. */
export function normalisedName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function labelToValue<T extends string>(
  options: readonly { value: T; label: string }[],
  input: string,
): T | null {
  const wanted = input.trim().toLowerCase();
  return (
    options.find((option) => option.label.toLowerCase() === wanted)?.value ??
    options.find((option) => option.value.toLowerCase() === wanted)?.value ??
    null
  );
}

export interface KnownConsignor {
  id: string;
  name: string;
  emailLower: string | null;
  normalised: string;
}

export interface PiecePlan {
  category: Category;
  brand: string;
  description: string;
  size: Size;
  condition: Condition;
  askingPriceCents: number;
  intakeDate: BrusselsDate;
}

export interface NewConsignorPlan {
  name: string;
  email: string | null;
  phone: string | null;
  iban: string | null;
}

export interface EvaluatedRow {
  row: number;
  itemNo: string;
  status: ImportRowStatus;
  consignorName: string;
  reason: string | null;
  /** Set for matched and new rows: what Save would bring over. */
  consignorKey: string | null;
  newConsignor: NewConsignorPlan | null;
  piece: PiecePlan | null;
}

export interface SheetCounts {
  matched: number;
  new: number;
  refused: number;
  already: number;
}

export interface SheetReading {
  rows: EvaluatedRow[];
  counts: SheetCounts;
}

export class BadSheetHeader extends Error {
  constructor() {
    super('The header line is not the expected one');
    this.name = 'BadSheetHeader';
  }
}

export function evaluateSheet(
  text: string,
  known: readonly KnownConsignor[],
  itemNosAlreadyBroughtOver: ReadonlySet<string>,
  today: BrusselsDate,
): SheetReading {
  const lines = parseCsv(text);
  const header = lines[0];
  if (
    header === undefined ||
    header.length !== EXPECTED_HEADER.length ||
    header.some((field, index) => field.trim() !== EXPECTED_HEADER[index])
  ) {
    throw new BadSheetHeader();
  }

  const working: KnownConsignor[] = [...known];
  const seenItemNos = new Set<string>();
  const rows: EvaluatedRow[] = [];

  for (let index = 1; index < lines.length; index += 1) {
    const fields = lines[index] as string[];
    const rowNumber = index + 1;
    const itemNo = (fields[0] ?? '').trim();
    const name = (fields[1] ?? '').trim();

    const refuse = (reason: string): void => {
      rows.push({
        row: rowNumber,
        itemNo,
        status: 'refused',
        consignorName: name,
        reason,
        consignorKey: null,
        newConsignor: null,
        piece: null,
      });
    };

    if (itemNo === '') {
      refuse(importReason.missingItemNo);
      continue;
    }
    if (seenItemNos.has(itemNo)) {
      refuse(importReason.duplicateItemNo);
      continue;
    }
    seenItemNos.add(itemNo);

    if (itemNosAlreadyBroughtOver.has(itemNo)) {
      rows.push({
        row: rowNumber,
        itemNo,
        status: 'already',
        consignorName: name,
        reason: null,
        consignorKey: null,
        newConsignor: null,
        piece: null,
      });
      continue;
    }

    if (fields.length !== EXPECTED_HEADER.length) {
      refuse(importReason.fieldCount(fields.length));
      continue;
    }
    if (name === '') {
      refuse(importReason.missingConsignorName);
      continue;
    }

    const email = (fields[2] ?? '').trim();
    if (email !== '' && !EMAIL_PATTERN.test(email)) {
      refuse(importReason.badEmail);
      continue;
    }
    const iban = (fields[4] ?? '').trim();
    if (iban !== '' && !isValidIban(iban)) {
      refuse(importReason.badIban);
      continue;
    }

    const byEmail =
      email === ''
        ? null
        : (working.find((candidate) => candidate.emailLower === email.toLowerCase()) ?? null);
    let consignor = byEmail;
    if (consignor === null) {
      const byName = working.filter((candidate) => candidate.normalised === normalisedName(name));
      if (byName.length > 1) {
        refuse(importReason.ambiguousName);
        continue;
      }
      consignor = byName[0] ?? null;
    }

    const category = labelToValue(CATEGORIES, fields[5] ?? '');
    if (category === null) {
      refuse(importReason.unknownCategory);
      continue;
    }
    const brand = (fields[6] ?? '').trim();
    if (brand === '' || brand.length > 60) {
      refuse(importReason.missingBrand);
      continue;
    }
    const description = (fields[7] ?? '').trim();
    if (description === '' || description.length > 120) {
      refuse(importReason.missingDescription);
      continue;
    }
    const size = labelToValue(SIZES, fields[8] ?? '');
    if (size === null) {
      refuse(importReason.unknownSize);
      continue;
    }
    const condition = labelToValue(CONDITIONS, fields[9] ?? '');
    if (condition === null) {
      refuse(importReason.unknownCondition);
      continue;
    }
    const askingPriceCents = parseEuros(fields[10] ?? '');
    if (
      askingPriceCents === null ||
      askingPriceCents < MIN_ASKING_PRICE_CENTS ||
      askingPriceCents > MAX_ASKING_PRICE_CENTS
    ) {
      refuse(importReason.badAskingPrice);
      continue;
    }
    const intakeDate = (fields[11] ?? '').trim();
    if (
      !isValidBrusselsDate(intakeDate) ||
      intakeDate > today ||
      intakeDate < addDays(today, -MAX_INTAKE_DAYS_BACK)
    ) {
      refuse(importReason.badIntakeDate);
      continue;
    }

    const piece: PiecePlan = {
      category,
      brand,
      description,
      size,
      condition,
      askingPriceCents,
      intakeDate,
    };

    if (consignor !== null) {
      rows.push({
        row: rowNumber,
        itemNo,
        status: 'matched',
        consignorName: consignor.name,
        reason: null,
        consignorKey: consignor.id,
        newConsignor: null,
        piece,
      });
      continue;
    }

    const key = `new:${rowNumber}`;
    working.push({
      id: key,
      name,
      emailLower: email === '' ? null : email.toLowerCase(),
      normalised: normalisedName(name),
    });
    rows.push({
      row: rowNumber,
      itemNo,
      status: 'new',
      consignorName: name,
      reason: null,
      consignorKey: key,
      newConsignor: {
        name,
        email: email === '' ? null : email,
        phone: (fields[3] ?? '').trim() === '' ? null : (fields[3] as string).trim(),
        iban: iban === '' ? null : normaliseIban(iban),
      },
      piece,
    });
  }

  return {
    rows,
    counts: {
      matched: rows.filter((row) => row.status === 'matched').length,
      new: rows.filter((row) => row.status === 'new').length,
      refused: rows.filter((row) => row.status === 'refused').length,
      already: rows.filter((row) => row.status === 'already').length,
    },
  };
}
