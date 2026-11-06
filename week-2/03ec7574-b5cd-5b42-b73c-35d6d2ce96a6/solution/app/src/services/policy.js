import { ApiError, readAddress } from '../lib/core.js';
import { codePoints, hasControl } from '../lib/validate.js';

// ---------------------------------------------------------------- grammar
const METHODS = ['transfer', 'batch_payout', '*'];
const ACTIONS = ['ALLOW', 'DENY'];
const OPERATORS = ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'in'];
const ORDERING = new Set(['lt', 'lte', 'gt', 'gte']);
const BODY_FIELDS = {
  'destination.address': 'address',
  'source.asset': 'asset',
  'source.chain': 'chain',
  'source.amount': 'number',
};
const ENUMS = { asset: ['usdc', 'eth'], chain: ['ethereum', 'base'] };
const DIGITS = /^(0|[1-9][0-9]*)$/;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function invalid(path, message) {
  throw new ApiError(422, 'INVALID_POLICY', message, { path });
}

function fieldKind(source, field, aggregationIds) {
  if (typeof field !== 'string') return null;
  if (source === 'request_body') return BODY_FIELDS[field] || null;
  if (source === 'system') return field === 'current_unix_timestamp' ? 'number' : null;
  const m = field.match(/^aggregation\.(.+)$/);
  return m && aggregationIds.has(m[1]) ? 'number' : null;
}

// A scalar of the field's kind, normalised for storage (addresses lowercased), or undefined.
function scalar(kind, value, inList) {
  if (kind === 'number') {
    if (typeof value === 'string' && DIGITS.test(value)) return value;
    return !inList && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  }
  if (typeof value !== 'string') return undefined;
  if (kind === 'address') {
    const read = readAddress(value);
    return read.code === 'ok' ? read.address : undefined;
  }
  return ENUMS[kind].includes(value) ? value : undefined;
}

function ruleName(value, at, names) {
  if (typeof value !== 'string') invalid(`${at}.name`, 'A rule name is text.');
  const name = value.normalize('NFC').trim();
  if (codePoints(name) < 1 || codePoints(name) > 80 || hasControl(name)) {
    invalid(`${at}.name`, 'A rule name is 1 to 80 characters without control characters.');
  }
  if (names.has(name)) invalid(`${at}.name`, `Rule names are unique within a policy; ${name} repeats.`);
  names.add(name);
  return name;
}

function condition(c, cat, aggregationIds) {
  if (!isObject(c)) invalid(cat, 'A condition is an object.');
  const { field_source: source, field, operator, value } = c;
  if (!['request_body', 'system', 'reference'].includes(source)) {
    invalid(`${cat}.field_source`, 'field_source is request_body, system or reference.');
  }
  const kind = fieldKind(source, field, aggregationIds);
  if (!kind) invalid(`${cat}.field`, `This field is not available for the field source ${source}.`);
  if (!OPERATORS.includes(operator) || (ORDERING.has(operator) && kind !== 'number')) {
    invalid(`${cat}.operator`, 'This operator cannot be used on this field.');
  }
  let stored;
  if (operator === 'in') {
    const list = Array.isArray(value) && value.length >= 1 && value.length <= 100
      ? value.map((v) => scalar(kind, v, true)) : null;
    if (!list || list.includes(undefined)) invalid(`${cat}.value`, 'in takes a list of 1 to 100 values of the field type.');
    stored = list;
  } else {
    stored = scalar(kind, value, false);
    if (stored === undefined) invalid(`${cat}.value`, 'The value does not fit this field.');
  }
  return { field_source: source, field, operator, value: stored };
}

// Validates the rules grammar in rule order; returns the rules as stored.
export function validateRules(rules, aggregationIds) {
  if (!Array.isArray(rules) || rules.length < 1 || rules.length > 50) invalid('rules', 'A policy has 1 to 50 rules.');
  const names = new Set();
  return rules.map((rule, i) => {
    const at = `rules[${i}]`;
    if (!isObject(rule)) invalid(at, 'A rule is an object.');
    const name = ruleName(rule.name, at, names);
    if (!METHODS.includes(rule.method)) invalid(`${at}.method`, 'A rule method is transfer, batch_payout or *.');
    if (!Array.isArray(rule.conditions) || rule.conditions.length > 20) {
      invalid(`${at}.conditions`, 'A rule has a list of 0 to 20 conditions.');
    }
    const conditions = rule.conditions.map((c, j) => condition(c, `${at}.conditions[${j}]`, aggregationIds));
    if (!ACTIONS.includes(rule.action)) invalid(`${at}.action`, 'A rule action is ALLOW or DENY.');
    return { name, method: rule.method, conditions, action: rule.action };
  });
}

export function referencedAggregations(rules) {
  const ids = [];
  for (const rule of rules) {
    for (const c of rule.conditions) {
      const id = c.field_source === 'reference' ? c.field.slice('aggregation.'.length) : null;
      if (id && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

// ---------------------------------------------------------------- the five steps
function compare(operator, actual, expected, kind) {
  if (kind === 'number') {
    const a = BigInt(actual);
    if (operator === 'in') return expected.some((v) => BigInt(v) === a);
    const b = BigInt(expected);
    return { eq: a === b, neq: a !== b, lt: a < b, lte: a <= b, gt: a > b, gte: a >= b }[operator];
  }
  if (operator === 'in') return expected.includes(actual);
  return operator === 'eq' ? actual === expected : actual !== expected;
}

function truth(c, request, values) {
  if (c.field_source === 'system') return compare(c.operator, request.nowSec, c.value, 'number');
  if (c.field_source === 'reference') {
    return compare(c.operator, values[c.field.slice('aggregation.'.length)], c.value, 'number');
  }
  const actual = { 'destination.address': request.destination, 'source.asset': request.asset,
    'source.chain': request.chain, 'source.amount': request.rawAmount }[c.field];
  return compare(c.operator, actual, c.value, BODY_FIELDS[c.field]);
}

// request: {method, asset, chain, destination, rawAmount, nowSec}; values: aggregation id -> BigInt.
// Returns the decision and one trace entry per rule in policy order.
export function decide(policy, request, values) {
  if (!policy) {
    return { decision: { action: 'ALLOW', rule: null, reason: 'no_policy', policy_id: null, policy_revision: null }, trace: [] };
  }
  const trace = policy.rules.map((rule) => {
    const considered = rule.method === request.method || rule.method === '*';
    const conditions = considered ? rule.conditions.map((c) => truth(c, request, values)) : [];
    return { rule: rule.name, considered, matched: considered && conditions.every(Boolean), conditions };
  });
  const first = (action) => policy.rules.find((r, i) => r.action === action && trace[i].matched);
  const deny = first('DENY');
  const allow = deny ? null : first('ALLOW');
  const hit = deny || allow;
  const decision = {
    action: allow ? 'ALLOW' : 'DENY', rule: hit ? hit.name : null, reason: hit ? 'matched_rule' : 'default_deny',
    policy_id: policy.id, policy_revision: policy.revision,
  };
  return { decision, trace };
}

// ---------------------------------------------------------------- aggregation values
// The window total of one aggregation for wallet W (and destination D when grouped so) at time T,
// over pending_approval and executed intents created later than T minus the window and not after T.
async function windowTotal(db, agg, wallet, destination, nowSec) {
  const window = [wallet.id, nowSec - agg.window_seconds, nowSec];
  const live = `i.wallet_id = $1 AND i.status IN ('pending_approval', 'executed')
    AND i.created_at > to_timestamp($2) AND i.created_at <= to_timestamp($3)`;
  const measure = agg.metric === 'count' ? 'count(*)::text' : 'COALESCE(sum(x.raw_amount), 0)::text';
  const source = agg.group_by === 'wallet'
    ? `SELECT i.raw_amount FROM intents i WHERE ${live}`
    : `SELECT i.raw_amount FROM intents i WHERE ${live} AND i.kind = 'transfer' AND i.destination_address = $4
       UNION ALL
       SELECT it.raw_amount FROM intent_items it JOIN intents i ON i.id = it.intent_id
        WHERE ${live} AND it.destination_address = $4`;
  const params = agg.group_by === 'wallet' ? window : [...window, destination];
  const { rows } = await db.query(`SELECT ${measure} AS v FROM (${source}) x`, params);
  return BigInt(rows[0].v);
}

// Values for the lines of one request, each line seeing the earlier lines of the same request.
// lines: [{destination, rawAmount}]; returns one {aggregation id: BigInt} map per line.
export async function aggregationValues(db, policy, wallet, lines, nowSec) {
  const ids = policy ? referencedAggregations(policy.rules) : [];
  if (!ids.length) return lines.map(() => ({}));
  const { rows: aggs } = await db.query(
    'SELECT * FROM aggregations WHERE organization_id = $1 AND id = ANY(SELECT jsonb_array_elements_text($2::jsonb))',
    [wallet.organization_id, JSON.stringify(ids)]);
  const totals = new Map();
  const total = async (agg, destination) => {
    const key = `${agg.id} ${agg.group_by === 'wallet' ? '' : destination}`;
    if (!totals.has(key)) totals.set(key, await windowTotal(db, agg, wallet, destination, nowSec));
    return totals.get(key);
  };
  const out = [];
  for (let k = 0; k < lines.length; k += 1) {
    const values = {};
    for (const agg of aggs) {
      if (agg.asset !== wallet.asset) {
        values[agg.id] = 0n;
        continue;
      }
      const { destination } = lines[k];
      const share = lines.slice(0, k + 1)
        .filter((l) => agg.group_by === 'wallet' || l.destination === destination)
        .reduce((sum, l) => sum + l.rawAmount, 0n);
      values[agg.id] = (await total(agg, destination)) + (agg.metric === 'count' ? 1n : share);
    }
    out.push(values);
  }
  return out;
}
