import { canonicalKeyText, compareValues, maxValue, minValue } from './compare';
import { AppError, invalidStage, unknownStage } from './errors';
import { matchFilter, validateFilter } from './filter';
import { roundHalfAwayFromZero } from './numbers';
import { valuesAtPath } from './paths';
import { Projection, applyProjection, validateProjection } from './projection';
import { SortKey, sortDocuments, validateSort } from './sort';
import { DocObject, DocValue, cloneValue, isPlainObject } from './values';

const STAGE_NAMES = new Set(['$match', '$project', '$sort', '$limit', '$skip', '$unwind', '$count', '$group']);
const ACCUMULATORS = new Set(['$sum', '$avg', '$min', '$max', '$count', '$push', '$first', '$last']);

interface Row {
  doc: DocObject;
  sources: string[];
}

interface MatchStage {
  kind: 'match';
  filter: DocObject;
}
interface ProjectStage {
  kind: 'project';
  projection: Projection;
}
interface SortStage {
  kind: 'sort';
  keys: SortKey[];
}
interface LimitStage {
  kind: 'limit';
  count: number;
}
interface SkipStage {
  kind: 'skip';
  count: number;
}
interface UnwindStage {
  kind: 'unwind';
  path: string;
}
interface CountStage {
  kind: 'count';
  name: string;
}
interface GroupStage {
  kind: 'group';
  key: DocValue;
  accumulators: Array<{ field: string; operator: string; path: string }>;
}

export type Stage =
  | MatchStage
  | ProjectStage
  | SortStage
  | LimitStage
  | SkipStage
  | UnwindStage
  | CountStage
  | GroupStage;

export interface CompiledStage {
  stage: Stage;
  operator: string;
}

function stageError(index: number, run: () => void): void {
  try {
    run();
  } catch (error) {
    if (error instanceof AppError) throw invalidStage(index);
    throw error;
  }
}

function compileGroup(specification: DocValue, index: number): GroupStage {
  if (!isPlainObject(specification) || !Object.prototype.hasOwnProperty.call(specification, '_id')) {
    throw invalidStage(index);
  }
  const key = specification['_id'];
  if (!(key === null || typeof key === 'string' || isPlainObject(key))) throw invalidStage(index);
  if (typeof key === 'string' && !key.startsWith('$')) throw invalidStage(index);
  if (isPlainObject(key)) {
    for (const field of Object.keys(key)) {
      const value = key[field];
      if (typeof value !== 'string' || !value.startsWith('$')) throw invalidStage(index);
    }
  }
  const accumulators: GroupStage['accumulators'] = [];
  for (const field of Object.keys(specification)) {
    if (field === '_id') continue;
    const spec = specification[field];
    if (!isPlainObject(spec)) throw invalidStage(index);
    const operators = Object.keys(spec);
    if (operators.length !== 1) throw invalidStage(index);
    const operator = operators[0];
    if (!ACCUMULATORS.has(operator)) throw invalidStage(index);
    const argument = spec[operator];
    if (operator === '$count') {
      if (!isPlainObject(argument) || Object.keys(argument).length !== 0) throw invalidStage(index);
      accumulators.push({ field, operator, path: '' });
    } else {
      if (typeof argument !== 'string' || !argument.startsWith('$') || argument.length < 2) throw invalidStage(index);
      accumulators.push({ field, operator, path: argument.slice(1) });
    }
  }
  return { kind: 'group', key, accumulators };
}

/** Checks one stage, throwing `unknown_stage` or `invalid_stage`. */
export function compileStage(raw: DocValue, index: number): CompiledStage {
  if (!isPlainObject(raw)) throw invalidStage(index);
  const keys = Object.keys(raw);
  if (keys.length !== 1) throw invalidStage(index);
  const operator = keys[0];
  if (!STAGE_NAMES.has(operator)) throw unknownStage(operator, index);
  const body = raw[operator];
  switch (operator) {
    case '$match': {
      let filter: DocObject = {};
      stageError(index, () => {
        filter = validateFilter(body);
      });
      return { operator, stage: { kind: 'match', filter } };
    }
    case '$project': {
      let projection: Projection | null = null;
      stageError(index, () => {
        projection = validateProjection(body, true);
      });
      if (!projection) throw invalidStage(index);
      return { operator, stage: { kind: 'project', projection } };
    }
    case '$sort': {
      let keysOut: SortKey[] = [];
      stageError(index, () => {
        keysOut = validateSort(body);
      });
      if (keysOut.length === 0) throw invalidStage(index);
      return { operator, stage: { kind: 'sort', keys: keysOut } };
    }
    case '$limit':
      if (typeof body !== 'number' || !Number.isInteger(body) || body < 1) throw invalidStage(index);
      return { operator, stage: { kind: 'limit', count: body } };
    case '$skip':
      if (typeof body !== 'number' || !Number.isInteger(body) || body < 0) throw invalidStage(index);
      return { operator, stage: { kind: 'skip', count: body } };
    case '$unwind':
      if (typeof body !== 'string' || !body.startsWith('$') || body.length < 2) throw invalidStage(index);
      return { operator, stage: { kind: 'unwind', path: body.slice(1) } };
    case '$count':
      if (typeof body !== 'string' || body.length === 0 || body.startsWith('$') || body.includes('.')) {
        throw invalidStage(index);
      }
      return { operator, stage: { kind: 'count', name: body } };
    default:
      return { operator, stage: compileGroup(body, index) };
  }
}

function singleValue(doc: DocObject, path: string): DocValue | undefined {
  const values = valuesAtPath(doc, path);
  if (values.length === 0) return undefined;
  if (values.length === 1) return values[0];
  return values;
}

function setPath(doc: DocObject, path: string, value: DocValue): DocObject {
  const segments = path.split('.');
  const out: DocObject = {};
  const head = segments[0];
  let replaced = false;
  for (const key of Object.keys(doc)) {
    if (key === head) {
      replaced = true;
      if (segments.length === 1) {
        out[key] = value;
      } else {
        const child = doc[key];
        out[key] = isPlainObject(child) ? setPath(child, segments.slice(1).join('.'), value) : child;
      }
    } else {
      out[key] = doc[key];
    }
  }
  if (!replaced && segments.length === 1) out[head] = value;
  return out;
}

function nestedValue(doc: DocObject, path: string): DocValue | undefined {
  const segments = path.split('.');
  let current: DocValue = doc;
  for (const segment of segments) {
    if (!isPlainObject(current) || !Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

function runGroup(rows: Row[], stage: GroupStage): Row[] {
  const groups = new Map<string, { key: DocValue; rows: Row[] }>();
  for (const row of rows) {
    let keyValue: DocValue;
    if (stage.key === null) {
      keyValue = null;
    } else if (typeof stage.key === 'string') {
      const value = singleValue(row.doc, stage.key.slice(1));
      keyValue = value === undefined ? null : value;
    } else {
      const object: DocObject = {};
      const specification = stage.key as DocObject;
      for (const field of Object.keys(specification)) {
        const path = (specification[field] as string).slice(1);
        const value = singleValue(row.doc, path);
        object[field] = value === undefined ? null : value;
      }
      keyValue = object;
    }
    const text = canonicalKeyText(keyValue);
    const bucket = groups.get(text);
    if (bucket) bucket.rows.push(row);
    else groups.set(text, { key: keyValue, rows: [row] });
  }
  const out: Row[] = [];
  for (const bucket of groups.values()) {
    const doc: DocObject = { _id: bucket.key };
    for (const accumulator of stage.accumulators) {
      const values = bucket.rows.map((row) => singleValue(row.doc, accumulator.path));
      const present = values.filter((value): value is DocValue => value !== undefined);
      const numbers = present.filter((value): value is number => typeof value === 'number');
      switch (accumulator.operator) {
        case '$sum':
          doc[accumulator.field] = numbers.reduce((total, value) => total + value, 0);
          break;
        case '$avg':
          doc[accumulator.field] =
            numbers.length === 0
              ? null
              : roundHalfAwayFromZero(numbers.reduce((total, value) => total + value, 0) / numbers.length, 10);
          break;
        case '$min':
          doc[accumulator.field] = present.length === 0 ? null : minValue(present);
          break;
        case '$max':
          doc[accumulator.field] = present.length === 0 ? null : maxValue(present);
          break;
        case '$push':
          doc[accumulator.field] = present;
          break;
        case '$first':
          doc[accumulator.field] = values.length === 0 ? null : (values[0] ?? null);
          break;
        case '$last':
          doc[accumulator.field] = values.length === 0 ? null : (values[values.length - 1] ?? null);
          break;
        default:
          doc[accumulator.field] = bucket.rows.length;
      }
    }
    const sources = new Set<string>();
    for (const row of bucket.rows) {
      for (const source of row.sources) sources.add(source);
    }
    out.push({ doc, sources: Array.from(sources) });
  }
  out.sort((left, right) => compareValues(left.doc['_id'], right.doc['_id']));
  return out;
}

function runStage(rows: Row[], stage: Stage): Row[] {
  switch (stage.kind) {
    case 'match':
      return rows.filter((row) => matchFilter(stage.filter, row.doc));
    case 'project':
      return rows.map((row) => ({ doc: applyProjection(row.doc, stage.projection), sources: row.sources }));
    case 'sort': {
      const sorted = sortDocuments(
        rows.map((row) => row.doc),
        stage.keys,
      );
      const byDoc = new Map<DocObject, Row>();
      for (const row of rows) byDoc.set(row.doc, row);
      return sorted.map((doc) => byDoc.get(doc) ?? { doc, sources: [] });
    }
    case 'limit':
      return rows.slice(0, stage.count);
    case 'skip':
      return rows.slice(stage.count);
    case 'unwind': {
      const out: Row[] = [];
      for (const row of rows) {
        const value = nestedValue(row.doc, stage.path);
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
          for (const element of value) {
            out.push({ doc: setPath(row.doc, stage.path, cloneValue(element)), sources: row.sources });
          }
        } else {
          out.push(row);
        }
      }
      return out;
    }
    case 'count': {
      if (rows.length === 0) return [];
      const sources = new Set<string>();
      for (const row of rows) {
        for (const source of row.sources) sources.add(source);
      }
      return [{ doc: { [stage.name]: rows.length }, sources: Array.from(sources) }];
    }
    default:
      return runGroup(rows, stage);
  }
}

export interface StageResult {
  index: number;
  count: number;
  disabled: boolean;
  documents: DocObject[];
}

export interface PipelineRun {
  input: number;
  stages: StageResult[];
  output: DocObject[];
  pinStoppedAt: number | null;
}

/** Runs a compiled pipeline, keeping each stage's count, preview documents and pin trail. */
export function runPipeline(
  docs: DocObject[],
  stages: CompiledStage[],
  disabled: Set<number>,
  previewDocs: number,
  pin: string | null,
): PipelineRun {
  let rows: Row[] = docs.map((doc) => ({ doc, sources: [String(doc['_id'])] }));
  const results: StageResult[] = [];
  let pinStoppedAt: number | null = null;
  let pinAlive = pin !== null;
  stages.forEach((compiled, index) => {
    const isDisabled = disabled.has(index);
    if (!isDisabled) rows = runStage(rows, compiled.stage);
    if (pin !== null && pinAlive && !isDisabled) {
      const survives = rows.some((row) => row.sources.includes(pin));
      if (!survives) {
        pinAlive = false;
        pinStoppedAt = index;
      }
    }
    results.push({
      index,
      count: rows.length,
      disabled: isDisabled,
      documents: rows.slice(0, previewDocs).map((row) => row.doc),
    });
  });
  return { input: docs.length, stages: results, output: rows.map((row) => row.doc), pinStoppedAt };
}
