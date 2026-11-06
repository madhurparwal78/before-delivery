import { errors } from './http.js';
import { textField } from './text.js';
import { isAddressShape, validChecksum } from './address.js';
import { isPlainObject } from './validate.js';

const RULE_KEYS = ['name', 'method', 'conditions', 'action'];
const CONDITION_KEYS = ['field_source', 'field', 'operator', 'value'];

const STRING_FIELDS = new Set(['destination.address', 'source.asset', 'source.chain']);
const INTEGER_FIELDS = new Set(['source.amount', 'current_unix_timestamp']);
const OPERATORS = new Set(['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'in']);
const COMPARISON_OPS = new Set(['lt', 'lte', 'gt', 'gte']);

function integerValue(value, path) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  throw errors.invalidPolicy(path);
}

// Validates a policy body against the grammar. Returns the normalised rules.
export function validatePolicyRules(rules, orgAggregationIds, path = 'rules') {
  if (!Array.isArray(rules) || rules.length < 1 || rules.length > 50) {
    throw errors.invalidPolicy('rules');
  }
  const names = new Set();
  const out = [];
  for (let i = 0; i < rules.length; i++) {
    const rPath = `rules[${i}]`;
    const rule = rules[i];
    if (!isPlainObject(rule)) throw errors.invalidPolicy(rPath);
    for (const k of Object.keys(rule)) {
      if (!RULE_KEYS.includes(k)) throw errors.invalidPolicy(`${rPath}.${k}`);
    }
    for (const k of RULE_KEYS) {
      if (!Object.hasOwn(rule, k)) throw errors.invalidPolicy(`${rPath}.${k}`);
    }
    const name = textField(rule.name, { field: 'name', min: 1, max: 80 });
    if (names.has(name)) throw errors.invalidPolicy(`${rPath}.name`);
    names.add(name);
    if (!['transfer', 'batch_payout', '*'].includes(rule.method)) {
      throw errors.invalidPolicy(`${rPath}.method`);
    }
    if (!['ALLOW', 'DENY'].includes(rule.action)) throw errors.invalidPolicy(`${rPath}.action`);
    const conditions = rule.conditions;
    if (!Array.isArray(conditions) || conditions.length > 20) {
      throw errors.invalidPolicy(`${rPath}.conditions`);
    }
    const conds = [];
    for (let j = 0; j < conditions.length; j++) {
      const cPath = `${rPath}.conditions[${j}]`;
      const c = conditions[j];
      if (!isPlainObject(c)) throw errors.invalidPolicy(cPath);
      for (const k of Object.keys(c)) {
        if (!CONDITION_KEYS.includes(k)) throw errors.invalidPolicy(`${cPath}.${k}`);
      }
      for (const k of CONDITION_KEYS) {
        if (!Object.hasOwn(c, k)) throw errors.invalidPolicy(`${cPath}.${k}`);
      }
      if (c.field_source === 'request_body') {
        if (!STRING_FIELDS.has(c.field) && !INTEGER_FIELDS.has(c.field)) {
          throw errors.invalidPolicy(`${cPath}.field`);
        }
      } else if (c.field_source === 'system') {
        if (c.field !== 'current_unix_timestamp') throw errors.invalidPolicy(`${cPath}.field`);
      } else if (c.field_source === 'reference') {
        const m = /^aggregation\.([a-z0-9_]+)$/.exec(c.field);
        if (!m || !orgAggregationIds.has(m[1])) throw errors.invalidPolicy(`${cPath}.field`);
      } else {
        throw errors.invalidPolicy(`${cPath}.field_source`);
      }
      if (!OPERATORS.has(c.operator)) throw errors.invalidPolicy(`${cPath}.operator`);
      const isIntegerField = INTEGER_FIELDS.has(c.field) || c.field_source === 'reference'
        || c.field_source === 'system';
      if (COMPARISON_OPS.has(c.operator) && !isIntegerField) {
        throw errors.invalidPolicy(`${cPath}.operator`);
      }
      let value = c.value;
      if (isIntegerField) {
        if (c.operator === 'in') throw errors.invalidPolicy(`${cPath}.operator`);
        integerValue(value, cPath);
      } else if (c.field === 'destination.address') {
        const addressOk = (v) => isAddressShape(v) && !(/[A-F]/.test(v) && !validChecksum(v));
        if (c.operator === 'in') {
          if (!Array.isArray(value) || value.length < 1 || value.length > 100
            || !value.every((v) => typeof v === 'string' && addressOk(v))) {
            throw errors.invalidPolicy(`${cPath}.value`);
          }
          value = value.map((v) => v.toLowerCase());
        } else if (c.operator === 'eq' || c.operator === 'neq') {
          if (typeof value !== 'string' || !addressOk(value)) {
            throw errors.invalidPolicy(`${cPath}.value`);
          }
          value = value.toLowerCase();
        } else {
          throw errors.invalidPolicy(`${cPath}.operator`);
        }
      } else {
        if (c.operator === 'in') {
          if (!Array.isArray(value) || value.length < 1 || value.length > 100
            || !value.every((v) => typeof v === 'string')) {
            throw errors.invalidPolicy(`${cPath}.value`);
          }
        } else if (c.operator !== 'eq' && c.operator !== 'neq') {
          throw errors.invalidPolicy(`${cPath}.operator`);
        } else if (typeof value !== 'string') {
          throw errors.invalidPolicy(`${cPath}.value`);
        }
      }
      conds.push({
        field_source: c.field_source, field: c.field, operator: c.operator, value,
      });
    }
    out.push({ name, method: rule.method, conditions: conds, action: rule.action });
  }
  return out;
}

// Create/update check order. Returns normalised rules.
export function validatePolicyBody(body, orgAggregationIds, { create }) {
  const topKeys = create
    ? ['version', 'name', 'chain_type', 'rules']
    : ['name', 'rules'];
  for (const k of Object.keys(body)) {
    if (!topKeys.includes(k)) throw errors.unknownField(k);
  }
  if (create) {
    if (typeof body.version !== 'string' || body.version !== '1.0') {
      throw errors.invalidPolicy('version');
    }
  }
  const name = textField(body.name, { field: 'name', min: 1, max: 80 });
  if (create) {
    if (typeof body.chain_type !== 'string' || body.chain_type !== 'ethereum') {
      throw errors.invalidPolicy('chain_type');
    }
  }
  const rules = validatePolicyRules(body.rules, orgAggregationIds);
  return { name, rules };
}

