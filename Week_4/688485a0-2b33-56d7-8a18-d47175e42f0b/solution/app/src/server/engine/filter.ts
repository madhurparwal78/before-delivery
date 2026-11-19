import type { JsonObject, JsonValue } from "../../shared/json.js";
import { fail } from "../errors.js";
import { type Reach, reach, splitPath } from "./path.js";
import { compareValues, isPlainObject, isWholeNumber, sameClass, valuesEqual } from "./value.js";

/** Filter matching: the one place that decides which documents a filter selects. */

export type Predicate = (doc: JsonObject) => boolean;
type Test = (reached: Reach) => boolean;

const LOGICAL = ["$and", "$or", "$nor"];
const COMPARE: Record<string, (order: number) => boolean> = {
  $gt: (order) => order > 0,
  $gte: (order) => order >= 0,
  $lt: (order) => order < 0,
  $lte: (order) => order <= 0,
};
const FIELD_OPERATORS = new Set(["$eq", "$ne", "$in", "$nin", "$exists", "$not", "$size", "$elemMatch", ...Object.keys(COMPARE)]);

const invalid = (): never => fail("invalid_query", { field: "filter" });

/** A condition object made of operators (as opposed to a value to compare with). */
export function isOperatorObject(condition: JsonValue): condition is JsonObject {
  if (!isPlainObject(condition)) return false;
  const keys = Object.keys(condition);
  if (keys.length === 0 || !keys.some((key) => key.startsWith("$"))) return false;
  if (!keys.every((key) => key.startsWith("$"))) invalid();
  return true;
}

function candidates(reached: Reach): JsonValue[] {
  const all: JsonValue[] = [];
  for (const value of reached.values) {
    all.push(value);
    if (Array.isArray(value)) all.push(...value);
  }
  return all;
}

function equalTo(reached: Reach, operand: JsonValue): boolean {
  if (operand === null) return !reached.present || candidates(reached).some((value) => value === null);
  return candidates(reached).some((value) => valuesEqual(value, operand));
}

function compileElementMatch(operand: JsonValue): Test {
  if (!isPlainObject(operand)) return invalid();
  const keys = Object.keys(operand);
  let elementTest: (element: JsonValue) => boolean;
  if (keys.length > 0 && keys.every((key) => key.startsWith("$") && !LOGICAL.includes(key))) {
    const operators = compileOperators(operand);
    elementTest = (element) => operators({ values: [element], present: true });
  } else {
    const predicate = compileFilter(operand);
    elementTest = (element) => isPlainObject(element) && predicate(element);
  }
  return (reached) => reached.values.some((value) => Array.isArray(value) && value.some(elementTest));
}

function compileOperator(operator: string, operand: JsonValue): Test {
  switch (operator) {
    case "$eq":
      return (reached) => equalTo(reached, operand);
    case "$ne":
      return (reached) => !equalTo(reached, operand);
    case "$gt":
    case "$gte":
    case "$lt":
    case "$lte": {
      const holds = COMPARE[operator] as (order: number) => boolean;
      return (reached) => candidates(reached).some((value) => sameClass(value, operand) && holds(compareValues(value, operand)));
    }
    case "$in":
    case "$nin": {
      if (!Array.isArray(operand)) return invalid();
      const any: Test = (reached) => operand.some((option) => equalTo(reached, option));
      return operator === "$in" ? any : (reached) => !any(reached);
    }
    case "$exists":
      return typeof operand === "boolean" ? (reached) => reached.present === operand : invalid();
    case "$size":
      return isWholeNumber(operand, 0)
        ? (reached) => reached.values.some((value) => Array.isArray(value) && value.length === operand)
        : invalid();
    case "$not": {
      if (!isOperatorObject(operand)) return invalid();
      const inner = compileOperators(operand);
      return (reached) => !inner(reached);
    }
    case "$elemMatch":
      return compileElementMatch(operand);
    default:
      return fail("unknown_operator", { operator });
  }
}

function compileOperators(operators: JsonObject): Test {
  const tests = Object.entries(operators).map(([operator, operand]) => {
    if (!operator.startsWith("$") || !FIELD_OPERATORS.has(operator)) return fail("unknown_operator", { operator });
    return compileOperator(operator, operand);
  });
  return (reached) => tests.every((test) => test(reached));
}

function compileCondition(condition: JsonValue): Test {
  return isOperatorObject(condition) ? compileOperators(condition) : (reached) => equalTo(reached, condition);
}

function compileLogical(operator: string, operand: JsonValue): Predicate {
  if (!Array.isArray(operand) || operand.length === 0 || !operand.every((part) => isPlainObject(part))) return invalid();
  const parts = operand.map((part) => compileFilter(part as JsonObject));
  if (operator === "$and") return (doc) => parts.every((part) => part(doc));
  if (operator === "$or") return (doc) => parts.some((part) => part(doc));
  return (doc) => !parts.some((part) => part(doc));
}

export function compileFilter(filter: JsonObject): Predicate {
  const parts: Predicate[] = [];
  for (const [key, condition] of Object.entries(filter)) {
    if (LOGICAL.includes(key)) {
      parts.push(compileLogical(key, condition));
    } else if (key.startsWith("$")) {
      if (FIELD_OPERATORS.has(key)) invalid();
      fail("unknown_operator", { operator: key });
    } else {
      const segments = splitPath(key);
      const test = compileCondition(condition);
      parts.push((doc) => test(reach(doc, segments)));
    }
  }
  return (doc) => parts.every((part) => part(doc));
}
