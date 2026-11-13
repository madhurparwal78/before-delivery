import { fail } from '../errors.js';
import type { StreamRow } from '../store.js';
import { checkQueryLimits } from './query.js';
import { runMatch, type Hit } from './search.js';
import { upTo } from './numbers.js';
import { displayTime } from './tz.js';
import { valuesOf, type FieldType } from './mapping.js';

export type PipeColumn = { name: string; type: FieldType };

export type PipeResult = { columns: PipeColumn[]; rows: (string | number | boolean | null)[][] };

type Aggregate = { agg: 'count' | 'avg' | 'max' | 'min' | 'sum'; field: string | null; name: string };

type Parsed = {
  from: { name: string; position: number };
  where: { text: string; position: number } | null;
  stats: { aggregates: Aggregate[]; by: string | null; byPosition: number } | null;
  sort: { column: string; direction: 'asc' | 'desc'; position: number }[] | null;
  limit: number;
  keep: { name: string; position: number }[] | null;
};

const COMMANDS = ['FROM', 'WHERE', 'STATS', 'SORT', 'LIMIT', 'KEEP'];

function parsePipe(text: string): Parsed {
  const segments: { text: string; offset: number }[] = [];
  let offset = 0;
  for (const part of text.split('|')) {
    segments.push({ text: part, offset });
    offset += part.length + 1;
  }
  const parsed: Parsed = {
    from: { name: '', position: 0 },
    where: null,
    stats: null,
    sort: null,
    limit: 1000,
    keep: null,
  };
  let sawFrom = false;
  segments.forEach((segment, index) => {
    const trimmedStart = segment.text.length - segment.text.trimStart().length;
    const body = segment.text.trim();
    const position = segment.offset + trimmedStart + 1;
    if (body === '') {
      throw fail.pipeSyntax(`Unknown command  at position ${position}.`, position);
    }
    const word = body.split(/\s+/)[0];
    const upper = word.toUpperCase();
    if (!COMMANDS.includes(upper)) {
      throw fail.pipeSyntax(`Unknown command ${word} at position ${position}.`, position);
    }
    const rest = body.slice(word.length).trim();
    const restPosition = position + body.indexOf(rest, word.length);
    if (upper === 'FROM') {
      if (index !== 0) throw fail.pipeSyntax('FROM must come first.', position);
      sawFrom = true;
      parsed.from = { name: rest.split(/\s+/)[0] ?? '', position: restPosition };
      return;
    }
    if (!sawFrom) throw fail.pipeSyntax('FROM must come first.', position);
    switch (upper) {
      case 'WHERE':
        parsed.where = { text: rest, position: restPosition };
        return;
      case 'STATS': {
        const byMatch = /\s+BY\s+/i.exec(rest);
        const aggregateText = byMatch ? rest.slice(0, byMatch.index) : rest;
        const by = byMatch ? rest.slice(byMatch.index + byMatch[0].length).trim() : null;
        const byPosition = byMatch ? restPosition + byMatch.index + byMatch[0].length : restPosition;
        const aggregates: Aggregate[] = [];
        for (const piece of aggregateText.split(',')) {
          const trimmed = piece.trim();
          if (trimmed === '') continue;
          const match = /^(count|avg|max|min|sum)\s*\(\s*([^)]*?)\s*\)(?:\s+AS\s+(\S+))?$/i.exec(trimmed);
          if (!match) {
            const at = restPosition + rest.indexOf(trimmed);
            throw fail.pipeSyntax(`Unknown command ${trimmed.split(/[\s(]/)[0]} at position ${at}.`, at);
          }
          const agg = match[1].toLowerCase() as Aggregate['agg'];
          const field = match[2] === '*' || match[2] === '' ? null : match[2];
          aggregates.push({ agg, field, name: match[3] ?? trimmed });
        }
        parsed.stats = { aggregates, by: by === null || by === '' ? null : by, byPosition };
        return;
      }
      case 'SORT': {
        const entries: Parsed['sort'] = [];
        for (const piece of rest.split(',')) {
          const trimmed = piece.trim();
          if (trimmed === '') continue;
          const parts = trimmed.split(/\s+/);
          entries.push({
            column: parts[0],
            direction: (parts[1] ?? 'ASC').toUpperCase() === 'DESC' ? 'desc' : 'asc',
            position: restPosition + rest.indexOf(trimmed),
          });
        }
        parsed.sort = entries;
        return;
      }
      case 'LIMIT': {
        const value = Number(rest);
        if (!Number.isFinite(value) || value < 1) {
          throw fail.pipeSyntax(`Expected a number at position ${restPosition}.`, restPosition);
        }
        if (value > 10000) throw fail.pipeSyntax('LIMIT can be at most 10000.', restPosition);
        parsed.limit = Math.floor(value);
        return;
      }
      case 'KEEP': {
        const columns: Parsed['keep'] = [];
        for (const piece of rest.split(',')) {
          const trimmed = piece.trim();
          if (trimmed === '') continue;
          columns.push({ name: trimmed, position: restPosition + rest.indexOf(trimmed) });
        }
        parsed.keep = columns;
        return;
      }
      default:
        return;
    }
  });
  if (!sawFrom) throw fail.pipeSyntax('FROM must come first.', 1);
  return parsed;
}

function cellOf(
  value: ReturnType<typeof valuesOf>,
  type: FieldType,
  zone: string,
): string | number | boolean | null {
  if (value.length === 0) return null;
  const render = (item: string | number | boolean): string | number | boolean => {
    if (type === 'date' && typeof item === 'string') return displayTime(zone, Date.parse(item));
    return item;
  };
  if (value.length === 1) return render(value[0]);
  return value.map((item) => String(render(item))).join(', ');
}

export async function runPipe(input: {
  text: string;
  zone: string;
  nowMs: number;
  resolveStream: (name: string) => Promise<StreamRow | null>;
}): Promise<PipeResult> {
  checkQueryLimits(input.text);
  const parsed = parsePipe(input.text);
  const stream = await input.resolveStream(parsed.from.name);
  if (!stream) {
    throw fail.pipeSyntax(`Stream ${parsed.from.name} doesn't exist.`, parsed.from.position);
  }
  const whereOffset = parsed.where ? parsed.where.position - 1 : 0;
  let outcome;
  try {
    outcome = await runMatch({
      stream,
      q: parsed.where?.text ?? '',
      fromMs: 0,
      toMs: 8640000000000000,
      filters: [],
      nowMs: input.nowMs,
    });
  } catch (cause) {
    if (
      cause instanceof Error &&
      'code' in cause &&
      (cause as { code?: string }).code === 'query_syntax'
    ) {
      const api = cause as unknown as { message: string; position: number };
      const moved = whereOffset + api.position;
      throw fail.pipeSyntax(
        api.message.replace(/position \d+\./, `position ${moved}.`),
        moved,
      );
    }
    throw cause;
  }
  const context = outcome.context;
  const typeOf = (field: string): FieldType =>
    field === '_id' ? 'keyword' : (context.typeOf(field) ?? 'keyword');
  const conflictOf = context.conflictOf;

  if (parsed.stats) {
    const by = parsed.stats.by;
    if (by !== null && typeOf(by) === undefined) {
      throw fail.pipeSyntax(`Unknown column ${by} at position ${parsed.stats.byPosition}.`, parsed.stats.byPosition);
    }
    if (by !== null) {
      const conflict = conflictOf(by);
      if (conflict) throw fail.fieldConflict(conflict);
      if (!context.fields.some((field) => field.field === by)) {
        throw fail.pipeSyntax(
          `Unknown column ${by} at position ${parsed.stats.byPosition}.`,
          parsed.stats.byPosition,
        );
      }
    }
    for (const aggregate of parsed.stats.aggregates) {
      if (!aggregate.field) continue;
      const conflict = conflictOf(aggregate.field);
      if (conflict) throw fail.fieldConflict(conflict);
      const type = context.typeOf(aggregate.field);
      if (type === undefined) {
        throw fail.pipeSyntax(
          `Unknown column ${aggregate.field} at position ${parsed.stats.byPosition}.`,
          parsed.stats.byPosition,
        );
      }
      if ((aggregate.agg === 'avg' || aggregate.agg === 'sum') && type !== 'number') {
        throw fail.pipeSyntax(
          `${aggregate.agg} needs a number field: ${aggregate.field} is ${type}.`,
          parsed.stats.byPosition,
        );
      }
    }
    const groups = new Map<string, Hit[]>();
    for (const hit of outcome.hits) {
      const keys = by === null ? ['all'] : valuesOf(hit.event.fields[by]).map((value) => String(value));
      const names = keys.length === 0 ? ['null'] : keys;
      for (const name of names) {
        const list = groups.get(name) ?? [];
        list.push(hit);
        groups.set(name, list);
      }
    }
    const columns: PipeColumn[] = [];
    if (by !== null) columns.push({ name: by, type: typeOf(by) });
    for (const aggregate of parsed.stats.aggregates) {
      const type: FieldType =
        aggregate.agg === 'count' || aggregate.agg === 'avg' || aggregate.agg === 'sum'
          ? 'number'
          : typeOf(aggregate.field ?? '');
      columns.push({ name: aggregate.name, type });
    }
    let rows: (string | number | boolean | null)[][] = [...groups.entries()]
      .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
      .map(([name, hits]) => {
        const row: (string | number | boolean | null)[] = [];
        if (by !== null) row.push(name === 'null' ? null : name);
        for (const aggregate of parsed.stats!.aggregates) {
          if (aggregate.agg === 'count') {
            row.push(hits.length);
            continue;
          }
          const numbers: number[] = [];
          for (const hit of hits) {
            for (const value of valuesOf(hit.event.fields[aggregate.field ?? ''])) {
              if (typeof value === 'number') numbers.push(value);
            }
          }
          if (numbers.length === 0) {
            row.push(null);
            continue;
          }
          switch (aggregate.agg) {
            case 'avg':
              row.push(Number(upTo(numbers.reduce((sum, value) => sum + value, 0) / numbers.length, 4)));
              break;
            case 'sum':
              row.push(numbers.reduce((sum, value) => sum + value, 0));
              break;
            case 'max':
              row.push(Math.max(...numbers));
              break;
            case 'min':
              row.push(Math.min(...numbers));
              break;
            default:
              row.push(null);
          }
        }
        return row;
      });
    const shaped = applyKeepAndSort(columns, rows, parsed);
    rows = shaped.rows.slice(0, parsed.limit);
    return { columns: shaped.columns, rows };
  }

  const fieldNames = context.fields.map((field) => field.field).filter((field) => field !== '@timestamp');
  const columns: PipeColumn[] = [
    { name: '_id', type: 'keyword' },
    { name: '@timestamp', type: 'date' },
    ...fieldNames.sort().map((field) => ({ name: field, type: typeOf(field) })),
  ];
  const rows = outcome.hits.map((hit) =>
    columns.map((column) => {
      if (column.name === '_id') return hit.event.eventId;
      if (column.name === '@timestamp') return displayTime(input.zone, hit.event.tsMs);
      return cellOf(valuesOf(hit.event.fields[column.name]), column.type, input.zone);
    }),
  );
  const shaped = applyKeepAndSort(columns, rows, parsed);
  return { columns: shaped.columns, rows: shaped.rows.slice(0, parsed.limit) };
}

function applyKeepAndSort(
  columns: PipeColumn[],
  rows: (string | number | boolean | null)[][],
  parsed: Parsed,
): { columns: PipeColumn[]; rows: (string | number | boolean | null)[][] } {
  let shapedColumns = columns;
  let shapedRows = rows;
  if (parsed.keep) {
    const indexes: number[] = [];
    for (const keep of parsed.keep) {
      const index = columns.findIndex((column) => column.name === keep.name);
      if (index < 0) {
        throw fail.pipeSyntax(`Unknown column ${keep.name} at position ${keep.position}.`, keep.position);
      }
      indexes.push(index);
    }
    shapedColumns = indexes.map((index) => columns[index]);
    shapedRows = rows.map((row) => indexes.map((index) => row[index]));
  }
  if (parsed.sort) {
    const entries = parsed.sort.map((entry) => {
      const index = shapedColumns.findIndex((column) => column.name === entry.column);
      if (index < 0) {
        throw fail.pipeSyntax(
          `Unknown column ${entry.column} at position ${entry.position}.`,
          entry.position,
        );
      }
      return { index, direction: entry.direction };
    });
    const compare = (
      left: string | number | boolean | null,
      right: string | number | boolean | null,
    ): number => {
      if (left === null && right === null) return 0;
      if (left === null) return 1;
      if (right === null) return -1;
      if (typeof left === 'number' && typeof right === 'number') return left - right;
      const leftText = String(left);
      const rightText = String(right);
      return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
    };
    shapedRows = [...shapedRows].sort((leftRow, rightRow) => {
      for (const entry of entries) {
        const left = leftRow[entry.index];
        const right = rightRow[entry.index];
        if (left === null && right !== null) return 1;
        if (right === null && left !== null) return -1;
        const compared = compare(left, right) * (entry.direction === 'asc' ? 1 : -1);
        if (compared !== 0) return compared;
      }
      for (let index = 0; index < shapedColumns.length; index += 1) {
        const compared = compare(leftRow[index], rightRow[index]);
        if (compared !== 0) return compared;
      }
      return 0;
    });
  }
  return { columns: shapedColumns, rows: shapedRows };
}
