import { readCsv } from './csv';
import { canonicalLei, isValidLei } from './lei';
import { normaliseName } from './names';
import { DueDiligence } from './case';

/** The one place the spreadsheet import decides each row's outcome. */

export const IMPORT_HEADER = [
  'Legal name',
  'LEI',
  'Jurisdiction',
  'Licence number',
  'Due diligence',
  'Contact email',
  'Notes',
] as const;

const DUE_DILIGENCE_CELLS: Readonly<Record<string, DueDiligence>> = {
  trusted: 'trusted',
  pending: 'pending',
  restricted: 'restricted',
  blocked: 'blocked',
};

export interface ExistingCounterparty {
  readonly id: string;
  readonly lei: string;
  readonly legalName: string;
  readonly licenceNumber: string;
  readonly dueDiligence: DueDiligence;
  readonly contactEmail: string;
  readonly notes: string;
}

export type ImportOutcome = 'matched' | 'new' | 'refused';
export type MatchedBy = 'lei' | 'legal_name';

export interface ImportFields {
  readonly legalName: string;
  readonly lei: string;
  readonly jurisdictionCode: string;
  readonly licenceNumber: string;
  readonly dueDiligence: DueDiligence;
  readonly contactEmail: string;
  readonly notes: string;
}

export interface ImportRow {
  readonly row: number;
  readonly legalName: string;
  readonly outcome: ImportOutcome;
  readonly matchedBy: MatchedBy | null;
  readonly counterpartyId: string | null;
  readonly changedFields: string[];
  readonly reason: string | null;
  /** Values to write for a `new` row. */
  readonly create: ImportFields | null;
  /** Values to write for a `matched` row with changes. */
  readonly update: Partial<ImportFields> | null;
}

export interface ImportPlan {
  readonly rows: ImportRow[];
  readonly summary: { matched: number; new: number; refused: number };
}

function codePoints(value: string): number {
  return [...value].length;
}

function refusal(row: number, legalName: string, reason: string): ImportRow {
  return {
    row,
    legalName,
    outcome: 'refused',
    matchedBy: null,
    counterpartyId: null,
    changedFields: [],
    reason,
    create: null,
    update: null,
  };
}

export function planImport(
  text: string,
  existing: readonly ExistingCounterparty[],
  jurisdictionCodes: readonly string[],
): ImportPlan {
  const table = readCsv(text);
  const header = table.length > 0 ? table[0].map((cell) => cell.trim()) : [];
  const headerMatches =
    header.length === IMPORT_HEADER.length && IMPORT_HEADER.every((name, at) => header[at] === name);
  if (!headerMatches) {
    return { rows: [], summary: { matched: 0, new: 0, refused: 0 } };
  }

  const byLei = new Map(existing.map((entry) => [entry.lei, entry]));
  const byName = new Map(existing.map((entry) => [normaliseName(entry.legalName), entry]));
  const codes = new Map(jurisdictionCodes.map((code) => [code.toUpperCase(), code]));

  const claimedExisting = new Map<string, number>();
  const claimedLei = new Map<string, number>();
  const claimedName = new Map<string, number>();

  const rows: ImportRow[] = [];

  for (let index = 1; index < table.length; index += 1) {
    const raw = table[index];
    if (raw.length === 1 && raw[0].trim() === '') continue;
    const number = index + 1;
    const cell = (at: number): string => (raw[at] ?? '').trim();
    const legalName = cell(0);
    const leiCell = cell(1);
    const jurisdictionCell = cell(2);
    const licenceCell = cell(3);
    const dueDiligenceCell = cell(4);
    const emailCell = cell(5);
    const notesCell = cell(6);

    if (legalName === '') {
      rows.push(refusal(number, legalName, 'Legal name is required'));
      continue;
    }
    if (leiCell !== '' && !isValidLei(leiCell)) {
      rows.push(refusal(number, legalName, 'LEI check digits do not match'));
      continue;
    }
    const lei = leiCell === '' ? '' : canonicalLei(leiCell);
    const normalised = normaliseName(legalName);
    const matchedByLei = lei === '' ? undefined : byLei.get(lei);
    const matchedByName = lei === '' ? byName.get(normalised) : undefined;
    const matched = matchedByLei ?? matchedByName;
    const isNew = matched === undefined;

    if (jurisdictionCell !== '' && !codes.has(jurisdictionCell.toUpperCase())) {
      rows.push(refusal(number, legalName, 'Unknown jurisdiction'));
      continue;
    }
    if (jurisdictionCell === '' && isNew) {
      rows.push(refusal(number, legalName, 'Unknown jurisdiction'));
      continue;
    }
    if (dueDiligenceCell !== '' && DUE_DILIGENCE_CELLS[dueDiligenceCell.toLowerCase()] === undefined) {
      rows.push(refusal(number, legalName, 'Unknown due diligence status'));
      continue;
    }
    if (codePoints(notesCell) > 2000) {
      rows.push(refusal(number, legalName, 'Notes are longer than 2,000 characters'));
      continue;
    }
    const clash =
      (matched !== undefined ? claimedExisting.get(matched.id) : undefined) ??
      (lei === '' ? undefined : claimedLei.get(lei)) ??
      claimedName.get(normalised);
    if (clash !== undefined) {
      rows.push(refusal(number, legalName, `Same counterparty as row ${clash}`));
      continue;
    }
    if (isNew && lei !== '' && byName.has(normalised)) {
      rows.push(
        refusal(number, legalName, 'Legal name matches another counterparty with a different LEI'),
      );
      continue;
    }
    if (isNew && lei === '') {
      rows.push(refusal(number, legalName, 'LEI is required for a new counterparty'));
      continue;
    }
    if (isNew && licenceCell === '') {
      rows.push(refusal(number, legalName, 'Licence number is required for a new counterparty'));
      continue;
    }
    if (isNew && emailCell === '') {
      rows.push(refusal(number, legalName, 'Contact email is required'));
      continue;
    }

    if (matched !== undefined) {
      claimedExisting.set(matched.id, number);
      const changedFields: string[] = [];
      const update: Record<string, string> = {};
      if (licenceCell !== '' && licenceCell !== matched.licenceNumber) {
        changedFields.push('licenceNumber');
        update.licenceNumber = licenceCell;
      }
      if (dueDiligenceCell !== '') {
        const value = DUE_DILIGENCE_CELLS[dueDiligenceCell.toLowerCase()];
        if (value !== matched.dueDiligence) {
          changedFields.push('dueDiligence');
          update.dueDiligence = value;
        }
      }
      if (emailCell !== '' && emailCell !== matched.contactEmail) {
        changedFields.push('contactEmail');
        update.contactEmail = emailCell;
      }
      if (notesCell !== '' && notesCell !== matched.notes) {
        changedFields.push('notes');
        update.notes = notesCell;
      }
      rows.push({
        row: number,
        legalName,
        outcome: 'matched',
        matchedBy: matchedByLei !== undefined ? 'lei' : 'legal_name',
        counterpartyId: matched.id,
        changedFields,
        reason: null,
        create: null,
        update: changedFields.length === 0 ? null : (update as Partial<ImportFields>),
      });
      continue;
    }

    claimedLei.set(lei, number);
    claimedName.set(normalised, number);
    rows.push({
      row: number,
      legalName,
      outcome: 'new',
      matchedBy: null,
      counterpartyId: null,
      changedFields: [],
      reason: null,
      create: {
        legalName,
        lei,
        jurisdictionCode: codes.get(jurisdictionCell.toUpperCase()) ?? jurisdictionCell.toUpperCase(),
        licenceNumber: licenceCell,
        dueDiligence:
          dueDiligenceCell === '' ? 'pending' : DUE_DILIGENCE_CELLS[dueDiligenceCell.toLowerCase()],
        contactEmail: emailCell,
        notes: notesCell,
      },
      update: null,
    });
  }

  return {
    rows,
    summary: {
      matched: rows.filter((row) => row.outcome === 'matched').length,
      new: rows.filter((row) => row.outcome === 'new').length,
      refused: rows.filter((row) => row.outcome === 'refused').length,
    },
  };
}
