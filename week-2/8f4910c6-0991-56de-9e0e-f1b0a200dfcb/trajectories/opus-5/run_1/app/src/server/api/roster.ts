import { query } from '../db.js';
import { validation } from '../http/errors.js';
import type { Ctx, Reply, Route } from '../http/router.js';
import { insertTalent, listTalent, type TalentRow } from '../data/talent.js';
import { buildCsv, parseCsv } from '../domain/csv.js';
import {
  ROSTER_HEADER,
  nameKey,
  parseBodyMeasureValue,
  parseDivisionValue,
  parseHeightValue,
  parseOfficeValue,
  parseReachValue,
} from '../domain/roster.js';
import { parseIsoDate } from '../../shared/zone.js';
import { BOARD_TITLES } from '../../shared/format.js';
import { fieldCopy, json } from './helpers.js';
import type { Board, ImportReport, ImportReportRow, OfficeId } from '../../shared/types.js';

const ROSTER_CSV_LIMIT_BYTES = 2_000_000;

const OFFICE_TITLES: Record<OfficeId, string> = { toronto: 'Toronto', vancouver: 'Vancouver' };

type RowValues = {
  email: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  office: string;
  division: string;
  height: string;
  chest: string;
  waist: string;
  hips: string;
  instagram: string;
  tiktok: string;
  youtube: string;
};

function valuesOf(cells: string[]): RowValues {
  const cell = (index: number): string => (cells[index] ?? '').trim();
  return {
    email: cell(0),
    firstName: cell(1),
    lastName: cell(2),
    dateOfBirth: cell(3),
    office: cell(4),
    division: cell(5),
    height: cell(6),
    chest: cell(7),
    waist: cell(8),
    hips: cell(9),
    instagram: cell(10),
    tiktok: cell(11),
    youtube: cell(12),
  };
}

function splitName(displayName: string): { firstName: string; lastName: string } {
  const parts = displayName.trim().split(/\s+/);
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') };
}

type Fillable = {
  field: string;
  column: string;
  value: number | string;
  current: (row: TalentRow) => number | string | null;
  emptyValue: number | null;
};

export const rosterRoutes: Route[] = [
  {
    method: 'POST',
    path: '/api/roster/imports',
    auth: 'session',
    roles: ['agency_director'],
    body: 'multipart',
    fileLimitBytes: ROSTER_CSV_LIMIT_BYTES,
    handler: async (ctx: Ctx): Promise<Reply> => {
      if (!ctx.file) throw validation({ file: fieldCopy.rosterHeader() });
      const rows = parseCsv(ctx.file.bytes.toString('utf8'));
      const header = (rows[0] ?? []).map((cell) => cell.trim());
      if (header.length !== ROSTER_HEADER.length || header.some((cell, index) => cell !== ROSTER_HEADER[index])) {
        throw validation({ file: fieldCopy.rosterHeader() });
      }

      const existing = await query<TalentRow>(`SELECT * FROM talent WHERE state <> 'erased'`);
      const report: ImportReportRow[] = [];

      for (let index = 1; index < rows.length; index += 1) {
        const cells = rows[index];
        if (cells.every((cell) => cell.trim() === '')) continue;
        const values = valuesOf(cells);
        const rowNumber = index + 1;

        const match = matchRow(values, existing);
        const officeValue = values.office ? parseOfficeValue(values.office) : null;
        const divisionValue = values.division ? parseDivisionValue(values.division) : null;
        const dateValue = values.dateOfBirth ? parseIsoDate(values.dateOfBirth) : null;
        const heightValue = values.height ? parseHeightValue(values.height) : null;

        if (!values.email && !values.dateOfBirth) {
          report.push({ row: rowNumber, outcome: 'orphan', talentId: null, reason: 'no_identity', filled: [] });
          continue;
        }
        if (officeValue === null && (values.office !== '' || !match)) {
          report.push({ row: rowNumber, outcome: 'orphan', talentId: null, reason: 'unknown_office', filled: [] });
          continue;
        }
        if (divisionValue === null && (values.division !== '' || !match)) {
          report.push({ row: rowNumber, outcome: 'orphan', talentId: null, reason: 'unknown_division', filled: [] });
          continue;
        }
        if (!match && heightValue === null) {
          report.push({ row: rowNumber, outcome: 'orphan', talentId: null, reason: 'bad_height', filled: [] });
          continue;
        }
        if (values.dateOfBirth && !dateValue) {
          report.push({ row: rowNumber, outcome: 'orphan', talentId: null, reason: 'bad_date', filled: [] });
          continue;
        }

        if (match) {
          const filled = await fillEmptyFields(match, values);
          report.push({
            row: rowNumber,
            outcome: filled.length > 0 ? 'merged' : 'unchanged',
            talentId: match.id,
            reason: null,
            filled,
          });
          continue;
        }

        const created = await insertTalent({
          displayName: `${values.firstName} ${values.lastName}`.trim(),
          office: officeValue as OfficeId,
          board: divisionValue as Board,
          email: values.email || null,
          dateOfBirth: values.dateOfBirth || null,
          heightCm: heightValue,
          chestCm: values.chest ? parseBodyMeasureValue(values.chest) : null,
          waistCm: values.waist ? parseBodyMeasureValue(values.waist) : null,
          hipsCm: values.hips ? parseBodyMeasureValue(values.hips) : null,
          instagram: parseReachValue(values.instagram) ?? 0,
          tiktok: parseReachValue(values.tiktok) ?? 0,
          youtube: parseReachValue(values.youtube) ?? 0,
        });
        existing.push(created);
        report.push({ row: rowNumber, outcome: 'created', talentId: created.id, reason: null, filled: [] });
      }

      const counts = {
        created: report.filter((row) => row.outcome === 'created').length,
        merged: report.filter((row) => row.outcome === 'merged').length,
        unchanged: report.filter((row) => row.outcome === 'unchanged').length,
        orphan: report.filter((row) => row.outcome === 'orphan').length,
      };
      const body: ImportReport = { counts, rows: report };
      return json(200, body);
    },
  },
  {
    method: 'GET',
    path: '/api/roster/export.csv',
    auth: 'session',
    roles: ['agency_director'],
    handler: async (): Promise<Reply> => {
      const rows = await listTalent({ state: 'active' });
      const csv = buildCsv(
        ROSTER_HEADER,
        rows.map((row) => {
          const name = splitName(row.display_name);
          return [
            row.email ?? '',
            name.firstName,
            name.lastName,
            row.date_of_birth ?? '',
            OFFICE_TITLES[row.office_id],
            BOARD_TITLES[row.board],
            row.height_cm === null ? '' : String(row.height_cm),
            row.chest_cm === null ? '' : String(row.chest_cm),
            row.waist_cm === null ? '' : String(row.waist_cm),
            row.hips_cm === null ? '' : String(row.hips_cm),
            String(row.instagram),
            String(row.tiktok),
            String(row.youtube),
          ];
        }),
        [
          'text',
          'text',
          'text',
          'number',
          'text',
          'text',
          'number',
          'number',
          'number',
          'number',
          'number',
          'number',
          'number',
        ],
      );
      return {
        status: 200,
        body: csv,
        contentType: 'text/csv; charset=utf-8',
        headers: { 'Content-Disposition': 'attachment; filename="roster.csv"' },
      };
    },
  },
];

/** Email first, then first and last name with an equal date of birth. */
function matchRow(values: RowValues, existing: TalentRow[]): TalentRow | null {
  if (values.email) {
    const byEmail = existing.find(
      (row) => (row.email ?? '').trim().toLowerCase() === values.email.toLowerCase(),
    );
    if (byEmail) return byEmail;
  }
  if (values.dateOfBirth) {
    const key = nameKey(values.firstName, values.lastName);
    const byName = existing.find((row) => {
      const name = splitName(row.display_name);
      return nameKey(name.firstName, name.lastName) === key && row.date_of_birth === values.dateOfBirth;
    });
    if (byName) return byName;
  }
  return null;
}

/** A matched row fills only empty fields; non-empty values are never overwritten. */
async function fillEmptyFields(row: TalentRow, values: RowValues): Promise<string[]> {
  const candidates: Fillable[] = [];
  const push = (
    field: string,
    column: string,
    value: number | string | null,
    current: (talent: TalentRow) => number | string | null,
    emptyValue: number | null = null,
  ): void => {
    if (value === null || value === '') return;
    candidates.push({ field, column, value, current, emptyValue });
  };

  push('email', 'email', values.email || null, (talent) => talent.email);
  push('dateOfBirth', 'date_of_birth', values.dateOfBirth || null, (talent) => talent.date_of_birth);
  push('heightCm', 'height_cm', values.height ? parseHeightValue(values.height) : null, (talent) => talent.height_cm);
  push('chestCm', 'chest_cm', values.chest ? parseBodyMeasureValue(values.chest) : null, (talent) => talent.chest_cm);
  push('waistCm', 'waist_cm', values.waist ? parseBodyMeasureValue(values.waist) : null, (talent) => talent.waist_cm);
  push('hipsCm', 'hips_cm', values.hips ? parseBodyMeasureValue(values.hips) : null, (talent) => talent.hips_cm);
  push('instagram', 'instagram', parseReachValue(values.instagram), (talent) => talent.instagram, 0);
  push('tiktok', 'tiktok', parseReachValue(values.tiktok), (talent) => talent.tiktok, 0);
  push('youtube', 'youtube', parseReachValue(values.youtube), (talent) => talent.youtube, 0);

  const filled: string[] = [];
  for (const candidate of candidates) {
    const current = candidate.current(row);
    const isEmpty = current === null || current === '' || current === candidate.emptyValue;
    if (!isEmpty || current === candidate.value) continue;
    await query(`UPDATE talent SET ${candidate.column} = $2 WHERE id = $1`, [row.id, candidate.value]);
    filled.push(candidate.field);
  }
  if (filled.length > 0) {
    const refreshed = await query<TalentRow>('SELECT * FROM talent WHERE id = $1', [row.id]);
    Object.assign(row, refreshed[0]);
  }
  return filled;
}
