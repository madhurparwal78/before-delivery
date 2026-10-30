import { AddressError, normaliseAddress } from './address.js';
import { ASSETS, policyIntegerValue } from './amounts.js';
import { checkText } from './text.js';

export const CHAINS = ['ethereum', 'base'];
export const METHODS = ['transfer', 'batch_payout', '*'];
export const ACTIONS = ['ALLOW', 'DENY'];
export const OPERATORS = ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'in'];
const ORDER_OPERATORS = new Set(['lt', 'lte', 'gt', 'gte']);

export const POLICY_BODY_SCHEMA = {
  version: true,
  name: true,
  chain_type: true,
  rules: [{ name: true, method: true, conditions: [{ field_source: true, field: true, operator: true, value: true }], action: true }]
};

export class PolicyError extends Error {
  constructor(path) {
    super('policy is outside the grammar');
    this.code = 'INVALID_POLICY';
    this.path = path;
  }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fieldKind(fieldSource, field) {
  if (fieldSource === 'request_body') {
    if (field === 'destination.address') return 'address';
    if (field === 'source.asset') return 'asset';
    if (field === 'source.chain') return 'chain';
    if (field === 'source.amount') return 'integer';
    return null;
  }
  if (fieldSource === 'system') return field === 'current_unix_timestamp' ? 'integer' : null;
  if (fieldSource === 'reference') return field.startsWith('aggregation.') ? 'aggregation' : null;
  return null;
}

function normaliseConditionValue(kind, value, path) {
  if (kind === 'address') {
    if (typeof value !== 'string') throw new PolicyError(path);
    try {
      return normaliseAddress(value);
    } catch (error) {
      if (error instanceof AddressError) throw new PolicyError(path);
      throw error;
    }
  }
  if (kind === 'asset') {
    if (!ASSETS.includes(value)) throw new PolicyError(path);
    return value;
  }
  if (kind === 'chain') {
    if (!CHAINS.includes(value)) throw new PolicyError(path);
    return value;
  }
  if (kind === 'integer' || kind === 'aggregation') {
    if (policyIntegerValue(value) === null) throw new PolicyError(path);
    return value;
  }
  throw new PolicyError(path);
}

function validateCondition(condition, path, aggregationIds) {
  if (!isPlainObject(condition)) throw new PolicyError(path);
  const { field_source: fieldSource, field, operator, value } = condition;
  if (!['request_body', 'system', 'reference'].includes(fieldSource)) throw new PolicyError(`${path}.field_source`);
  if (typeof field !== 'string') throw new PolicyError(`${path}.field`);
  const kind = fieldKind(fieldSource, field);
  if (!kind) throw new PolicyError(`${path}.field`);
  if (!OPERATORS.includes(operator)) throw new PolicyError(`${path}.operator`);
  if (ORDER_OPERATORS.has(operator) && kind !== 'integer' && kind !== 'aggregation') {
    throw new PolicyError(`${path}.operator`);
  }
  if (kind === 'aggregation' && !aggregationIds.has(field.slice('aggregation.'.length))) {
    throw new PolicyError(`${path}.field`);
  }

  if (operator === 'in') {
    if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new PolicyError(`${path}.value`);
    const values = value.map((entry, index) => {
      if (typeof entry !== 'string') throw new PolicyError(`${path}.value[${index}]`);
      return normaliseConditionValue(kind, entry, `${path}.value[${index}]`);
    });
    return { field_source: fieldSource, field, operator, value: values };
  }

  return {
    field_source: fieldSource,
    field,
    operator,
    value: normaliseConditionValue(kind, value, `${path}.value`)
  };
}

export function validateRules(rules, { aggregationIds }) {
  if (!Array.isArray(rules) || rules.length < 1 || rules.length > 50) throw new PolicyError('rules');
  const names = new Set();
  return rules.map((rule, index) => {
    const path = `rules[${index}]`;
    if (!isPlainObject(rule)) throw new PolicyError(path);
    const name = checkText(rule.name, 'ruleName', { trim: true });
    if (!name.ok || names.has(name.value)) throw new PolicyError(`${path}.name`);
    names.add(name.value);
    if (!METHODS.includes(rule.method)) throw new PolicyError(`${path}.method`);
    if (!Array.isArray(rule.conditions) || rule.conditions.length > 20) throw new PolicyError(`${path}.conditions`);
    const conditions = rule.conditions.map((condition, conditionIndex) =>
      validateCondition(condition, `${path}.conditions[${conditionIndex}]`, aggregationIds));
    if (!ACTIONS.includes(rule.action)) throw new PolicyError(`${path}.action`);
    return { name: name.value, method: rule.method, conditions, action: rule.action };
  });
}

function compare(kind, left, operator, right) {
  if (kind === 'integer' || kind === 'aggregation') {
    const a = BigInt(left);
    if (operator === 'in') return right.some((entry) => BigInt(entry) === a);
    const b = BigInt(right);
    if (operator === 'eq') return a === b;
    if (operator === 'neq') return a !== b;
    if (operator === 'lt') return a < b;
    if (operator === 'lte') return a <= b;
    if (operator === 'gt') return a > b;
    return a >= b;
  }
  if (operator === 'in') return right.includes(left);
  if (operator === 'eq') return left === right;
  return left !== right;
}

function conditionTruth(condition, context) {
  const kind = fieldKind(condition.field_source, condition.field);
  let left;
  if (kind === 'address') left = context.request.destination.address;
  else if (kind === 'asset') left = context.request.source.asset;
  else if (kind === 'chain') left = context.request.source.chain;
  else if (kind === 'aggregation') {
    left = context.aggregationValues[condition.field.slice('aggregation.'.length)] ?? '0';
  } else if (condition.field === 'current_unix_timestamp') left = String(context.nowSeconds);
  else left = context.request.source.amount;
  return compare(kind, left, condition.operator, condition.value);
}

/** The five pinned evaluation steps, used by transfers, batch lines and the evaluate route. */
export function evaluatePolicy({ policy, method, request, nowSeconds, aggregationValues = {} }) {
  if (!policy) {
    return { action: 'ALLOW', rule: null, reason: 'no_policy', policy_id: null, policy_revision: null, trace: [] };
  }
  const context = { request, nowSeconds, aggregationValues };
  const trace = [];
  const matches = [];
  for (const rule of policy.rules) {
    const considered = rule.method === method || rule.method === '*';
    if (!considered) {
      trace.push({ rule: rule.name, considered: false, matched: false, conditions: [] });
      continue;
    }
    const conditions = rule.conditions.map((condition) => conditionTruth(condition, context));
    const matched = conditions.every(Boolean);
    trace.push({ rule: rule.name, considered: true, matched, conditions });
    if (matched) matches.push(rule);
  }

  const deny = matches.find((rule) => rule.action === 'DENY');
  if (deny) {
    return { action: 'DENY', rule: deny.name, reason: 'matched_rule', policy_id: policy.id, policy_revision: policy.revision, trace };
  }
  const allow = matches.find((rule) => rule.action === 'ALLOW');
  if (allow) {
    return { action: 'ALLOW', rule: allow.name, reason: 'matched_rule', policy_id: policy.id, policy_revision: policy.revision, trace };
  }
  return { action: 'DENY', rule: null, reason: 'default_deny', policy_id: policy.id, policy_revision: policy.revision, trace };
}

export function referencedAggregationIds(policy) {
  if (!policy) return [];
  const ids = new Set();
  for (const rule of policy.rules) {
    for (const condition of rule.conditions) {
      if (condition.field_source === 'reference' && condition.field.startsWith('aggregation.')) {
        ids.add(condition.field.slice('aggregation.'.length));
      }
    }
  }
  return [...ids];
}
