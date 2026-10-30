import { computeAggregationValues } from './aggregations.js';
import { evaluatePolicy, referencedAggregationIds } from './policy.js';
import { unixSeconds } from './time.js';

export async function loadReferencedAggregations(client, organizationId, policy) {
  const ids = referencedAggregationIds(policy);
  if (!ids.length) return [];
  const result = await client.query(
    'SELECT * FROM aggregations WHERE organization_id = $1 AND id = ANY($2)',
    [organizationId, ids]
  );
  return ids.map((id) => result.rows.find((row) => row.id === id)).filter(Boolean);
}

/** The single path from a request to a policy decision, used by transfers, batch lines and evaluate. */
export async function decide(client, { organization, wallet, policy, method, destinationAddress, rawAmount, contributions, now }) {
  const aggregations = await loadReferencedAggregations(client, organization.id, policy);
  const aggregationValues = await computeAggregationValues(client, {
    aggregations,
    wallet,
    destinationAddress,
    now,
    contributions: contributions || { wallet: rawAmount, destination: rawAmount }
  });
  const decision = evaluatePolicy({
    policy,
    method,
    request: {
      source: { asset: wallet.asset, chain: wallet.chain, amount: rawAmount.toString() },
      destination: { address: destinationAddress }
    },
    nowSeconds: unixSeconds(now),
    aggregationValues
  });
  return { decision, aggregationValues, aggregations };
}
