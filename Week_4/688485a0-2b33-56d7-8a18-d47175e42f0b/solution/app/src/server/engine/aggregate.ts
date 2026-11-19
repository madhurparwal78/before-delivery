import type { JsonObject, JsonValue } from "../../shared/json.js";
import { ApiError, fail } from "../errors.js";
import { compileFilter, type Predicate } from "./filter.js";
import { type IndexDefinition, choosePlan, type QueryPlan } from "./indexes.js";
import { expressionValue, objectPathValue, withPathValue } from "./path.js";
import { compileProjection, type Projection } from "./projection.js";
import { parseSort, sortDocuments } from "./sort.js";
import { compareValues, compact, depthOf, isPlainObject, isWholeNumber } from "./value.js";

/** Aggregation: validates a pipeline stage by stage and runs it over documents, counting each stage's output. */

export const MAX_QUERY_DEPTH = 32;

type Accumulator = { name: string; operator: string; expression: string | null };

type Stage =
  | { kind: "match"; filter: JsonObject; test: Predicate }
  | { kind: "project"; project: Projection }
  | { kind: "sort"; sort: JsonObject }
  | { kind: "limit"; count: number }
  | { kind: "skip"; count: number }
  | { kind: "unwind"; path: string }
  | { kind: "group"; key: JsonValue; accumulators: Accumulator[] }
  | { kind: "count"; name: string };

interface Pipeline {
  stages: Stage[];
}

const ACCUMULATORS = ["$sum", "$avg", "$min", "$max", "$count", "$push", "$first", "$last"];
const STAGE_NAMES: Record<string, Stage["kind"]> = {
  $match: "match",
  $project: "project",
  $sort: "sort",
  $limit: "limit",
  $skip: "skip",
  $unwind: "unwind",
  $group: "group",
  $count: "count",
};

const isPathExpression = (value: JsonValue | undefined): value is string => typeof value === "string" && /^\$[^$]+$/.test(value);
const isFieldName = (name: string): boolean => name !== "" && !name.startsWith("$") && !name.includes(".");

function compileGroupKey(key: JsonValue | undefined): JsonValue {
  if (key === null || isPathExpression(key)) return key;
  if (isPlainObject(key as JsonValue) && Object.keys(key as JsonObject).length > 0) {
    for (const part of Object.values(key as JsonObject)) if (!isPathExpression(part)) return fail("invalid_stage");
    return key as JsonObject;
  }
  return fail("invalid_stage");
}

function compileAccumulators(spec: JsonObject): Accumulator[] {
  return Object.entries(spec)
    .filter(([name]) => name !== "_id")
    .map(([name, definition]) => {
      if (!isFieldName(name) || !isPlainObject(definition)) return fail("invalid_stage");
      const entries = Object.entries(definition);
      const [operator, argument] = entries[0] ?? [];
      if (entries.length !== 1 || operator === undefined || !ACCUMULATORS.includes(operator)) return fail("invalid_stage");
      if (operator === "$count") {
        return isPlainObject(argument as JsonValue) && Object.keys(argument as JsonObject).length === 0
          ? { name, operator, expression: null }
          : fail("invalid_stage");
      }
      return isPathExpression(argument) ? { name, operator, expression: argument } : fail("invalid_stage");
    });
}

function compileStage(raw: JsonValue): Stage {
  if (!isPlainObject(raw) || Object.keys(raw).length !== 1) return fail("invalid_stage");
  const [name, operand] = Object.entries(raw)[0] as [string, JsonValue];
  const kind = STAGE_NAMES[name];
  if (kind === undefined) return fail("unknown_stage", { stage: name });
  switch (kind) {
    case "match":
      return isPlainObject(operand) ? { kind, filter: operand, test: compileFilter(operand) } : fail("invalid_stage");
    case "project":
      return isPlainObject(operand) ? { kind, project: compileProjection(operand, true) } : fail("invalid_stage");
    case "sort":
      if (!isPlainObject(operand) || Object.keys(operand).length === 0) return fail("invalid_stage");
      parseSort(operand);
      return { kind, sort: operand };
    case "limit":
      return isWholeNumber(operand, 1) ? { kind, count: operand } : fail("invalid_stage");
    case "skip":
      return isWholeNumber(operand, 0) ? { kind, count: operand } : fail("invalid_stage");
    case "unwind":
      return isPathExpression(operand) ? { kind, path: operand.slice(1) } : fail("invalid_stage");
    case "group":
      if (!isPlainObject(operand) || !("_id" in operand)) return fail("invalid_stage");
      return { kind, key: compileGroupKey(operand["_id"]), accumulators: compileAccumulators(operand) };
    case "count":
      return typeof operand === "string" && isFieldName(operand) ? { kind, name: operand } : fail("invalid_stage");
  }
}

/** Validate a pipeline: stage count, nesting depth, then each stage in order. */
export function compilePipeline(raw: JsonValue[], maxStages: number): Pipeline {
  if (raw.length > maxStages) fail("too_many_stages", { limit: maxStages });
  const stages = raw.map((stage, index) => {
    if (depthOf(stage) > MAX_QUERY_DEPTH) fail("query_too_deep", { limit: MAX_QUERY_DEPTH });
    try {
      return compileStage(stage);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.code === "unknown_stage") throw new ApiError("unknown_stage", { ...error.extras, index });
      throw new ApiError("invalid_stage", { index });
    }
  });
  return { stages };
}

/** The plan the scan guard measures: the first enabled stage when it is a `$match`, else a full scan. */
export function pipelinePlan(pipeline: Pipeline, disabled: ReadonlySet<number>, indexes: IndexDefinition[]): QueryPlan {
  const first = pipeline.stages.findIndex((_, index) => !disabled.has(index));
  const stage = pipeline.stages[first];
  return stage?.kind === "match" ? choosePlan(stage.filter, indexes) : { index: null, firstKey: null };
}

interface Work {
  doc: JsonObject;
  pinned: boolean;
}

function unwind(works: Work[], path: string): Work[] {
  const out: Work[] = [];
  for (const work of works) {
    const { found, value } = objectPathValue(work.doc, path);
    if (!found || value === null) continue;
    if (!Array.isArray(value)) out.push(work);
    else for (const element of value) out.push({ doc: withPathValue(work.doc, path, element), pinned: work.pinned });
  }
  return out;
}

const roundedAverage = (sum: number, count: number): number => {
  const average = sum / count;
  return Math.sign(average) * Number(Math.abs(average).toFixed(10));
};

function accumulate(accumulator: Accumulator, members: JsonObject[]): JsonValue {
  const { operator, expression } = accumulator;
  if (operator === "$count") return members.length;
  const present = members.map((doc) => expressionValue(doc, expression as string));
  const values = present.filter((value): value is JsonValue => value !== undefined);
  switch (operator) {
    case "$sum":
      return values.reduce<number>((sum, value) => (typeof value === "number" ? sum + value : sum), 0);
    case "$avg": {
      const numbers = values.filter((value): value is number => typeof value === "number");
      return numbers.length === 0 ? null : roundedAverage(numbers.reduce((sum, value) => sum + value, 0), numbers.length);
    }
    case "$min":
      return values.length === 0 ? null : values.reduce((best, value) => (compareValues(value, best) < 0 ? value : best));
    case "$max":
      return values.length === 0 ? null : values.reduce((best, value) => (compareValues(value, best) > 0 ? value : best));
    case "$push":
      return values;
    case "$first":
      return present[0] ?? null;
    default:
      return present[present.length - 1] ?? null;
  }
}

function groupKeyOf(doc: JsonObject, key: JsonValue): JsonValue {
  if (key === null) return null;
  if (typeof key === "string") return expressionValue(doc, key) ?? null;
  return Object.fromEntries(Object.entries(key as JsonObject).map(([name, expression]) => [name, expressionValue(doc, expression as string) ?? null]));
}

function group(works: Work[], stage: Extract<Stage, { kind: "group" }>): Work[] {
  const groups = new Map<string, { key: JsonValue; members: JsonObject[]; pinned: boolean }>();
  for (const work of works) {
    const key = groupKeyOf(work.doc, stage.key);
    const id = compact(key);
    const entry = groups.get(id) ?? { key, members: [], pinned: false };
    entry.members.push(work.doc);
    entry.pinned ||= work.pinned;
    groups.set(id, entry);
  }
  return [...groups.values()]
    .sort((a, b) => compareValues(a.key, b.key))
    .map((entry) => ({
      doc: { _id: entry.key, ...Object.fromEntries(stage.accumulators.map((accumulator) => [accumulator.name, accumulate(accumulator, entry.members)])) },
      pinned: entry.pinned,
    }));
}

function runStage(stage: Stage, works: Work[]): Work[] {
  switch (stage.kind) {
    case "match":
      return works.filter((work) => stage.test(work.doc));
    case "project":
      return works.map((work) => ({ doc: stage.project(work.doc), pinned: work.pinned }));
    case "sort": {
      const byDoc = new Map(works.map((work) => [work.doc, work]));
      return sortDocuments(works.map((work) => work.doc), stage.sort).map((doc) => byDoc.get(doc) as Work);
    }
    case "limit":
      return works.slice(0, stage.count);
    case "skip":
      return works.slice(stage.count);
    case "unwind":
      return unwind(works, stage.path);
    case "group":
      return group(works, stage);
    case "count":
      return works.length === 0 ? [] : [{ doc: { [stage.name]: works.length }, pinned: works.some((work) => work.pinned) }];
  }
}

interface StageOutcome {
  index: number;
  count: number;
  disabled: boolean;
  documents: JsonObject[];
}

interface PipelineRun {
  stages: StageOutcome[];
  output: JsonObject[];
  /** The first enabled stage after which no output came from the pinned document; null when it reaches the end. */
  stoppedAt: number | null;
}

export function runPipeline(pipeline: Pipeline, disabled: ReadonlySet<number>, docs: JsonObject[], previewDocs: number, pin: string | null): PipelineRun {
  let works: Work[] = docs.map((doc) => ({ doc, pinned: pin !== null && doc["_id"] === pin }));
  let stoppedAt: number | null = null;
  const stages = pipeline.stages.map((stage, index): StageOutcome => {
    const off = disabled.has(index);
    if (!off) {
      works = runStage(stage, works);
      if (pin !== null && stoppedAt === null && !works.some((work) => work.pinned)) stoppedAt = index;
    }
    return { index, count: works.length, disabled: off, documents: works.slice(0, previewDocs).map((work) => work.doc) };
  });
  return { stages, output: works.map((work) => work.doc), stoppedAt };
}

/** The preview answer: the input count, every stage's count and first documents, and where the pinned document stops. */
export function previewBody(run: PipelineRun, input: number, pin: string | null): JsonObject {
  return {
    input,
    stages: run.stages.map((stage) => ({ index: stage.index, count: stage.count, disabled: stage.disabled, documents: stage.documents })),
    pin: pin === null ? null : { _id: pin, stopped_at: run.stoppedAt },
  };
}
