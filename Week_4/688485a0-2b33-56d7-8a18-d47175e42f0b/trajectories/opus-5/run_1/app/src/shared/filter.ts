import { valuesEqual, compareValues } from './compare';
import { invalidQuery, unknownOperator } from './errors';
import { matchCandidates, valuesAtPath } from './paths';
import { DocDate, DocObject, DocValue, isPlainObject } from './values';

const COMPARISON = new Set(['$eq', '$ne', '$gt', '$gte', '$lt', '$lte']);
const OPERATORS = new Set([
  '$eq',
  '$ne',
  '$gt',
  '$gte',
  '$lt',
  '$lte',
  '$in',
  '$nin',
  '$exists',
  '$and',
  '$or',
  '$nor',
  '$not',
  '$size',
  '$elemMatch',
]);
const LOGICAL = new Set(['$and', '$or', '$nor']);

function hasOperatorKeys(value: DocObject): boolean {
  return Object.keys(value).some((key) => key.startsWith('$'));
}

/** A literal value may not carry operator keys at any level. */
function checkLiteral(value: DocValue): void {
  if (Array.isArray(value)) {
    for (const item of value) checkLiteral(item);
    return;
  }
  if (!isPlainObject(value)) return;
  for (const key of Object.keys(value)) {
    if (key.startsWith('$')) {
      if (OPERATORS.has(key)) throw invalidQuery('filter');
      throw unknownOperator(key);
    }
    checkLiteral(value[key]);
  }
}

function checkOperatorArgument(operator: string, argument: DocValue): void {
  switch (operator) {
    case '$in':
    case '$nin':
      if (!Array.isArray(argument)) throw invalidQuery('filter');
      for (const item of argument) checkLiteral(item);
      return;
    case '$exists':
      if (typeof argument !== 'boolean') throw invalidQuery('filter');
      return;
    case '$size':
      if (typeof argument !== 'number' || !Number.isInteger(argument) || argument < 0) throw invalidQuery('filter');
      return;
    case '$elemMatch':
      if (!isPlainObject(argument)) throw invalidQuery('filter');
      if (hasOperatorKeys(argument)) checkCondition(argument);
      else validateFilter(argument);
      return;
    case '$not':
      if (!isPlainObject(argument) || !hasOperatorKeys(argument)) throw invalidQuery('filter');
      checkCondition(argument);
      return;
    default:
      checkLiteral(argument);
  }
}

function checkCondition(condition: DocValue): void {
  if (!isPlainObject(condition)) {
    checkLiteral(condition);
    return;
  }
  const keys = Object.keys(condition);
  if (!keys.some((key) => key.startsWith('$'))) {
    checkLiteral(condition);
    return;
  }
  for (const key of keys) {
    if (!key.startsWith('$')) throw invalidQuery('filter');
    if (!OPERATORS.has(key)) throw unknownOperator(key);
    if (LOGICAL.has(key)) throw invalidQuery('filter');
    checkOperatorArgument(key, condition[key]);
  }
}

/** Checks a filter, throwing `unknown_operator` or `invalid_query`. */
export function validateFilter(filter: DocValue): DocObject {
  if (!isPlainObject(filter)) throw invalidQuery('filter');
  for (const key of Object.keys(filter)) {
    const value = filter[key];
    if (key.startsWith('$')) {
      if (!OPERATORS.has(key)) throw unknownOperator(key);
      if (!LOGICAL.has(key)) throw invalidQuery('filter');
      if (!Array.isArray(value) || value.length === 0) throw invalidQuery('filter');
      for (const item of value) validateFilter(item);
    } else {
      checkCondition(value);
    }
  }
  return filter;
}

function sameTypeClass(value: DocValue, operand: DocValue): boolean {
  if (typeof operand === 'number') return typeof value === 'number';
  if (typeof operand === 'string') return typeof value === 'string';
  if (operand instanceof DocDate) return value instanceof DocDate;
  return false;
}

function matchEquality(candidates: DocValue[], exists: boolean, operand: DocValue): boolean {
  if (operand === null && !exists) return true;
  return candidates.some((value) => valuesEqual(value, operand));
}

function matchComparison(candidates: DocValue[], operand: DocValue, accept: (order: number) => boolean): boolean {
  return candidates.some((value) => sameTypeClass(value, operand) && accept(compareValues(value, operand)));
}

function matchElement(element: DocValue, specification: DocObject): boolean {
  if (hasOperatorKeys(specification)) {
    return matchOperatorObject([element], true, [element], specification);
  }
  return isPlainObject(element) ? matchFilter(specification, element) : false;
}

function matchOperatorObject(
  candidates: DocValue[],
  exists: boolean,
  direct: DocValue[],
  operators: DocObject,
): boolean {
  for (const operator of Object.keys(operators)) {
    const argument = operators[operator];
    let ok: boolean;
    switch (operator) {
      case '$eq':
        ok = matchEquality(candidates, exists, argument);
        break;
      case '$ne':
        ok = !matchEquality(candidates, exists, argument);
        break;
      case '$gt':
        ok = matchComparison(candidates, argument, (order) => order > 0);
        break;
      case '$gte':
        ok = matchComparison(candidates, argument, (order) => order >= 0);
        break;
      case '$lt':
        ok = matchComparison(candidates, argument, (order) => order < 0);
        break;
      case '$lte':
        ok = matchComparison(candidates, argument, (order) => order <= 0);
        break;
      case '$in':
        ok = (argument as DocValue[]).some((member) => matchEquality(candidates, exists, member));
        break;
      case '$nin':
        ok = !(argument as DocValue[]).some((member) => matchEquality(candidates, exists, member));
        break;
      case '$exists':
        ok = argument === exists;
        break;
      case '$size':
        ok = direct.some((value) => Array.isArray(value) && value.length === argument);
        break;
      case '$elemMatch':
        ok = direct.some(
          (value) =>
            Array.isArray(value) && value.some((element) => matchElement(element, argument as DocObject)),
        );
        break;
      default:
        ok = !matchOperatorObject(candidates, exists, direct, argument as DocObject);
    }
    if (!ok) return false;
  }
  return true;
}

function matchCondition(doc: DocObject, path: string, condition: DocValue): boolean {
  const direct = valuesAtPath(doc, path);
  const candidates = matchCandidates(doc, path);
  const exists = direct.length > 0;
  if (isPlainObject(condition) && hasOperatorKeys(condition)) {
    return matchOperatorObject(candidates, exists, direct, condition);
  }
  return matchEquality(candidates, exists, condition);
}

/** Whether a document matches a checked filter. */
export function matchFilter(filter: DocObject, doc: DocObject): boolean {
  for (const key of Object.keys(filter)) {
    const value = filter[key];
    if (key === '$and') {
      if (!(value as DocObject[]).every((sub) => matchFilter(sub, doc))) return false;
    } else if (key === '$or') {
      if (!(value as DocObject[]).some((sub) => matchFilter(sub, doc))) return false;
    } else if (key === '$nor') {
      if ((value as DocObject[]).some((sub) => matchFilter(sub, doc))) return false;
    } else if (!matchCondition(doc, key, value)) {
      return false;
    }
  }
  return true;
}

export { COMPARISON as COMPARISON_OPERATORS };
