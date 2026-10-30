export const AGGREGATION_METRICS = ['sum_amount', 'count'];
export const AGGREGATION_GROUPS = ['wallet', 'destination'];

const COUNTED_STATUSES = ['pending_approval', 'executed'];

async function walletValue(client, aggregation, wallet, now) {
  const result = await client.query(
    `SELECT COALESCE(SUM(raw_amount), 0)::text AS total, COUNT(*)::text AS entries
       FROM intents
      WHERE wallet_id = $1
        AND status = ANY($2)
        AND created_at > $3::timestamptz - make_interval(secs => $4)
        AND created_at <= $3::timestamptz`,
    [wallet.id, COUNTED_STATUSES, now, aggregation.window_seconds]
  );
  const row = result.rows[0];
  return aggregation.metric === 'count' ? BigInt(row.entries) : BigInt(row.total);
}

async function destinationValue(client, aggregation, wallet, destinationAddress, now) {
  const result = await client.query(
    `SELECT
        (SELECT COALESCE(SUM(raw_amount), 0)::text FROM intents
          WHERE wallet_id = $1 AND kind = 'transfer' AND destination_address = $2 AND status = ANY($3)
            AND created_at > $4::timestamptz - make_interval(secs => $5) AND created_at <= $4::timestamptz) AS transfer_total,
        (SELECT COUNT(*)::text FROM intents
          WHERE wallet_id = $1 AND kind = 'transfer' AND destination_address = $2 AND status = ANY($3)
            AND created_at > $4::timestamptz - make_interval(secs => $5) AND created_at <= $4::timestamptz) AS transfer_count,
        (SELECT COALESCE(SUM(items.raw_amount), 0)::text FROM intent_items items
            JOIN intents ON intents.id = items.intent_id
          WHERE intents.wallet_id = $1 AND items.destination_address = $2 AND intents.status = ANY($3)
            AND intents.created_at > $4::timestamptz - make_interval(secs => $5) AND intents.created_at <= $4::timestamptz) AS item_total,
        (SELECT COUNT(*)::text FROM intent_items items
            JOIN intents ON intents.id = items.intent_id
          WHERE intents.wallet_id = $1 AND items.destination_address = $2 AND intents.status = ANY($3)
            AND intents.created_at > $4::timestamptz - make_interval(secs => $5) AND intents.created_at <= $4::timestamptz) AS item_count`,
    [wallet.id, destinationAddress, COUNTED_STATUSES, now, aggregation.window_seconds]
  );
  const row = result.rows[0];
  return aggregation.metric === 'count'
    ? BigInt(row.transfer_count) + BigInt(row.item_count)
    : BigInt(row.transfer_total) + BigInt(row.item_total);
}

/**
 * Rolling value of each aggregation for the request being decided, including that request.
 * `contributions` holds the request's own raw amount per grouping.
 */
export async function computeAggregationValues(client, { aggregations, wallet, destinationAddress, now, contributions }) {
  const values = {};
  for (const aggregation of aggregations) {
    if (aggregation.asset !== wallet.asset) {
      values[aggregation.id] = '0';
      continue;
    }
    const existing = aggregation.group_by === 'destination'
      ? await destinationValue(client, aggregation, wallet, destinationAddress, now)
      : await walletValue(client, aggregation, wallet, now);
    const contribution = aggregation.metric === 'count' ? 1n : BigInt(contributions[aggregation.group_by]);
    values[aggregation.id] = (existing + contribution).toString();
  }
  return values;
}
