import { numToBigInt } from './core.js';

// The five pinned policy steps. `request` is
// {method, source: {asset, chain, amount: BigInt}, destination: {address}}.
// `aggValues` maps "aggregation.<id>" to a BigInt value.
export function evaluatePolicy(rules, request, aggValues) {
  const trace = [];
  let firstDeny = null;
  let firstAllow = null;
  for (const rule of rules) {
    const considered = rule.method === '*' || rule.method === request.method;
    if (!considered) {
      trace.push({ rule: rule.name, considered: false, matched: false, conditions: [] });
      continue;
    }
    const conditions = rule.conditions.map((c) => conditionHolds(c, request, aggValues));
    const matched = conditions.every(Boolean);
    trace.push({ rule: rule.name, considered: true, matched, conditions });
    if (matched) {
      if (rule.action === 'DENY') {
        if (!firstDeny) firstDeny = rule.name;
      } else if (!firstAllow) firstAllow = rule.name;
    }
  }
  if (firstDeny) return { action: 'DENY', rule: firstDeny, reason: 'matched_rule', trace };
  if (firstAllow) return { action: 'ALLOW', rule: firstAllow, reason: 'matched_rule', trace };
  return { action: 'DENY', rule: null, reason: 'default_deny', trace };
}

function conditionHolds(cond, request, aggValues) {
  const op = cond.operator;
  let left;
  if (cond.field_source === 'system') {
    left = request.now;
  } else if (cond.field_source === 'reference') {
    left = aggValues[cond.field] ?? 0n;
  } else if (cond.field === 'destination.address') {
    const addr = request.destination.address;
    if (op === 'in') return cond.value.includes(addr);
    if (op === 'eq') return addr === cond.value;
    return addr !== cond.value;
  } else if (cond.field === 'source.asset' || cond.field === 'source.chain') {
    const v = cond.field === 'source.asset' ? request.source.asset : request.source.chain;
    if (op === 'in') return cond.value.includes(v);
    if (op === 'eq') return v === cond.value;
    return v !== cond.value;
  } else {
    left = request.source.amount;
  }
  const right = BigInt(cond.value);
  switch (op) {
    case 'eq': return left === right;
    case 'neq': return left !== right;
    case 'lt': return left < right;
    case 'lte': return left <= right;
    case 'gt': return left > right;
    case 'gte': return left >= right;
    default: return false;
  }
}

// One decision per policy id, reused by transfers, batches and the evaluate route.
export function noPolicyDecision() {
  return { action: 'ALLOW', rule: null, reason: 'no_policy', policy_id: null, policy_revision: null };
}

// Aggregation value for a request on wallet W, destination D, at time T.
// `requestLines` holds the request's own contributions as {destination, amount}
// pairs — a transfer's single line, or a batch's lines up to and including the
// line being decided (only those to D under `destination` grouping).
export async function aggregationValue(client, agg, wallet, destination, at, requestLines, requestCount) {
  if (wallet.asset !== agg.asset) return 0n;
  const since = new Date(at.getTime() - agg.window_seconds * 1000);
  let total = 0n;
  let count = 0;
  if (agg.group_by === 'wallet') {
    const { rows } = await client.query(
      `SELECT coalesce(sum(raw_amount), 0)::text AS s, count(*)::int AS n
       FROM intents
       WHERE wallet_id = $1 AND organization_id = $2
         AND status IN ('pending_approval','executed')
         AND created_at > $3 AND created_at <= $4`,
      [wallet.id, wallet.organization_id, since, at]
    );
    total += numToBigInt(rows[0].s);
    count += rows[0].n;
  } else {
    const { rows: tr } = await client.query(
      `SELECT coalesce(sum(raw_amount), 0)::text AS s, count(*)::int AS n
       FROM intents
       WHERE wallet_id = $1 AND organization_id = $2
         AND status IN ('pending_approval','executed')
         AND kind = 'transfer' AND destination_address = $3
         AND created_at > $4 AND created_at <= $5`,
      [wallet.id, wallet.organization_id, destination, since, at]
    );
    total += numToBigInt(tr[0].s);
    count += tr[0].n;
    const { rows: ln } = await client.query(
      `SELECT coalesce(sum(ii.raw_amount), 0)::text AS s, count(*)::int AS n
       FROM intent_items ii
       JOIN intents i ON i.id = ii.intent_id
       WHERE i.wallet_id = $1 AND i.organization_id = $2
         AND i.status IN ('pending_approval','executed')
         AND ii.destination_address = $3
         AND i.created_at > $4 AND i.created_at <= $5`,
      [wallet.id, wallet.organization_id, destination, since, at]
    );
    total += numToBigInt(ln[0].s);
    count += ln[0].n;
  }
  if (agg.metric === 'sum_amount') {
    let reqSum = 0n;
    for (const line of requestLines) {
      if (agg.group_by === 'destination' && line.destination !== destination) continue;
      reqSum += line.amount;
    }
    return total + reqSum;
  }
  return BigInt(count + requestCount);
}

// Aggregation values for every aggregation a policy references.
export async function aggregationValuesForPolicy(client, orgId, rules, wallet, destination, at, requestLines, requestCount) {
  const refs = new Set();
  for (const r of rules) {
    for (const c of r.conditions) {
      if (c.field_source === 'reference') refs.add(c.field.slice('aggregation.'.length));
    }
  }
  if (!refs.size) return {};
  const { rows: aggs } = await client.query(
    'SELECT * FROM aggregations WHERE organization_id = $1', [orgId]);
  const values = {};
  for (const agg of aggs) {
    if (!refs.has(agg.id)) continue;
    values[agg.id] = await aggregationValue(client, agg, wallet, destination, at, requestLines, requestCount);
  }
  return values;
}

export function aggValuesByField(values) {
  const out = {};
  for (const [id, v] of Object.entries(values)) out[`aggregation.${id}`] = v;
  return out;
}
