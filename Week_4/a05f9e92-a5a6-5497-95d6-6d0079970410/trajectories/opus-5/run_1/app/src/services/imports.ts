/**
 * The published import format. Preview reports each row's action and errors with
 * line numbers; commit skips error rows and applies the rest in one transaction.
 * Running an already-applied file again shows every row unchanged.
 */

import { query, transaction } from '../db';
import { classNames, isClassName } from '../domain/cmdb';
import type { Engine } from './engine';

export type ImportTable = 'people' | 'configuration_items';

export type RowAction = 'create' | 'update' | 'unchanged' | 'error';

export interface ImportRow {
  readonly line: number;
  readonly action: RowAction;
  readonly key: string | null;
  readonly errors: readonly string[];
  readonly values: Readonly<Record<string, string>>;
}

export interface ImportPreview {
  readonly rows: readonly ImportRow[];
  readonly counts: Readonly<Record<RowAction, number>>;
}

const peopleColumns = ['username', 'display_name', 'department', 'active'] as const;
const ciColumns = ['name', 'class', 'criticality', 'business_critical', 'owner_department'] as const;

function columnsFor(table: ImportTable): readonly string[] {
  return table === 'people' ? peopleColumns : ciColumns;
}

function keyColumn(table: ImportTable): string {
  return table === 'people' ? 'username' : 'name';
}

/** Comma separation, double-quote quoting, `""` for a quote. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cell += '"';
          i += 1;
          continue;
        }
        quoted = false;
        continue;
      }
      cell += ch;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === ',') {
      out.push(cell);
      cell = '';
      continue;
    }
    cell += ch;
  }
  out.push(cell);
  return out;
}

export async function previewImport(
  engine: Engine,
  table: ImportTable,
  text: string,
  mapping: Readonly<Record<string, string>>,
): Promise<ImportPreview> {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const rows: ImportRow[] = [];
  const counts: Record<RowAction, number> = { create: 0, update: 0, unchanged: 0, error: 0 };
  const push = (row: ImportRow): void => {
    rows.push(row);
    counts[row.action] += 1;
  };

  const expectedHeader = `#switchyard-import v1 ${table}`;
  if ((lines[0] ?? '').trim() !== expectedHeader) {
    push({
      line: 1,
      action: 'error',
      key: null,
      errors: [`Line 1: the first line must be "#switchyard-import v1 <table>".`],
      values: {},
    });
    return { rows, counts };
  }

  const allowed = columnsFor(table);
  const rawHeader = splitCsvLine(lines[1] ?? '').map((h) => h.trim());
  const header = rawHeader.map((name) => mapping[name] ?? name);
  const headerErrors: string[] = [];
  for (const name of header) {
    if (!allowed.includes(name)) headerErrors.push(`Line 2: unknown column "${name}".`);
  }
  if (headerErrors.length > 0) {
    push({ line: 2, action: 'error', key: null, errors: headerErrors, values: {} });
    return { rows, counts };
  }

  const departments = new Set((await query<{ name: string }>(`SELECT name FROM department`)).map((r) => r.name));
  const key = keyColumn(table);
  const seen = new Map<string, number>();

  for (let index = 2; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;
    if (line.trim() === '') continue;
    const cells = splitCsvLine(line);
    if (cells.length !== header.length) {
      push({
        line: lineNumber,
        action: 'error',
        key: null,
        errors: [`Line ${lineNumber}: expected ${header.length} values, found ${cells.length}.`],
        values: {},
      });
      continue;
    }
    const values: Record<string, string> = {};
    header.forEach((name, position) => {
      values[name] = (cells[position] ?? '').trim();
    });

    const errors: string[] = [];
    const required = table === 'people' ? ['username', 'display_name'] : ['name', 'class'];
    for (const name of required) {
      if (!values[name] || values[name] === '') errors.push(`Line ${lineNumber}: ${name} is required.`);
    }
    if (table === 'configuration_items' && values.class && !isClassName(values.class)) {
      errors.push(
        `Line ${lineNumber}: class "${values.class}" is not one of ${classNames.join(', ')}.`,
      );
    }
    if (table === 'configuration_items' && values.criticality && !['1', '2', '3'].includes(values.criticality)) {
      errors.push(`Line ${lineNumber}: criticality "${values.criticality}" is not one of 1, 2, 3.`);
    }
    for (const flag of ['active', 'business_critical']) {
      const value = values[flag];
      if (value !== undefined && value !== '' && value !== 'true' && value !== 'false') {
        errors.push(`Line ${lineNumber}: ${flag} "${value}" is not one of true, false.`);
      }
    }
    const departmentColumn = table === 'people' ? 'department' : 'owner_department';
    const department = values[departmentColumn];
    if (department !== undefined && department !== '' && !departments.has(department)) {
      errors.push(`Line ${lineNumber}: department "${department}" does not exist.`);
    }
    const rowKey = values[key] ?? '';
    const earlier = seen.get(rowKey.toLowerCase());
    if (rowKey !== '' && earlier !== undefined) {
      errors.push(`Line ${lineNumber}: duplicate key "${rowKey}" also on line ${earlier}.`);
    } else if (rowKey !== '') {
      seen.set(rowKey.toLowerCase(), lineNumber);
    }

    if (errors.length > 0) {
      push({ line: lineNumber, action: 'error', key: rowKey === '' ? null : rowKey, errors, values });
      continue;
    }

    const action = await actionFor(engine, table, values);
    push({ line: lineNumber, action, key: rowKey, errors: [], values });
  }

  return { rows, counts };
}

async function actionFor(
  engine: Engine,
  table: ImportTable,
  values: Readonly<Record<string, string>>,
): Promise<RowAction> {
  if (table === 'people') {
    const person = engine.person(values.username);
    if (!person) return 'create';
    const sameName = person.displayName === values.display_name;
    const sameDepartment = (person.department ?? '') === (values.department ?? '');
    const sameActive = person.active === (values.active === undefined || values.active === '' ? true : values.active === 'true');
    return sameName && sameDepartment && sameActive ? 'unchanged' : 'update';
  }
  const item = engine.map.find(values.name);
  if (!item) return 'create';
  const sameClass = item.className === values.class;
  const sameCriticality =
    values.criticality === undefined || values.criticality === ''
      ? true
      : item.criticality === Number(values.criticality);
  const sameFlag =
    values.business_critical === undefined || values.business_critical === ''
      ? true
      : item.businessCritical === (values.business_critical === 'true');
  const sameOwner =
    values.owner_department === undefined || values.owner_department === ''
      ? true
      : (item.ownerDepartment ?? '') === values.owner_department;
  return sameClass && sameCriticality && sameFlag && sameOwner ? 'unchanged' : 'update';
}

export type Outcome = 'created' | 'updated' | 'unchanged' | 'failed';

export interface CommitResult {
  readonly line: number;
  readonly outcome: Outcome;
  readonly errors: readonly string[];
}

/** Commit skips error rows and applies the rest in one transaction. */
export async function commitImport(
  table: string,
  rows: readonly ImportRow[],
): Promise<CommitResult[]> {
  const kind = table === 'people' ? 'people' : 'configuration_items';
  const results: CommitResult[] = [];
  await transaction(async (client) => {
    for (const row of rows) {
      if (row.action === 'error') {
        results.push({ line: row.line, outcome: 'failed', errors: row.errors });
        continue;
      }
      if (row.action === 'unchanged') {
        results.push({ line: row.line, outcome: 'unchanged', errors: [] });
        continue;
      }
      const values = row.values;
      if (kind === 'people') {
        await client.query(
          `INSERT INTO person (username, display_name, department, roles, time_zone, active, can_sign_in)
           VALUES ($1, $2, $3, '[]'::jsonb, 'Europe/Berlin', $4, FALSE)
           ON CONFLICT (username) DO UPDATE SET display_name = $2, department = $3, active = $4`,
          [
            values.username,
            values.display_name,
            values.department === '' ? null : (values.department ?? null),
            values.active === undefined || values.active === '' ? true : values.active === 'true',
          ],
        );
      } else {
        await client.query(
          `INSERT INTO configuration_item (name, class_name, criticality, business_critical,
                                           owner_department, status, workspace)
           VALUES ($1, $2, $3, $4, $5, 'healthy', 'live')
           ON CONFLICT (workspace, lower(name)) DO UPDATE SET class_name = $2, criticality = $3,
             business_critical = $4, owner_department = $5`,
          [
            values.name,
            values.class,
            values.criticality === undefined || values.criticality === '' ? 2 : Number(values.criticality),
            values.business_critical === 'true',
            values.owner_department === '' ? null : (values.owner_department ?? null),
          ],
        );
      }
      results.push({
        line: row.line,
        outcome: row.action === 'create' ? 'created' : 'updated',
        errors: [],
      });
    }
  });
  return results;
}
