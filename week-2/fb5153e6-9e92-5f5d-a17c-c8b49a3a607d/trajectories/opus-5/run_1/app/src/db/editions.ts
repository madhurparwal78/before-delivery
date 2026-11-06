import { queryOne, transaction } from './pool.js';

export interface EditionAvailability {
  readonly total: number;
  readonly remaining: number;
  readonly onSale: boolean;
}

/** A retired copy keeps its number, so a sold-out edition stays sold out. */
export async function editionAvailability(
  modelId: number,
  total: number,
  onSale: boolean,
): Promise<EditionAvailability> {
  const row = await queryOne<{ n: string }>(
    `SELECT count(*)::text AS n FROM edition_copies WHERE model_id = $1`,
    [modelId],
  );
  const claimed = Number(row?.n ?? '0');
  return { total, remaining: Math.max(0, total - claimed), onSale };
}

export async function editionHasSale(modelId: number): Promise<boolean> {
  const row = await queryOne<{ n: string }>(
    `SELECT count(*)::text AS n FROM edition_copies WHERE model_id = $1 AND order_id IS NOT NULL`,
    [modelId],
  );
  return Number(row?.n ?? '0') > 0;
}

/**
 * Claims the next copy. When several checkouts claim the last one at once,
 * exactly one gets it and every other gets nothing.
 */
export async function claimCopy(modelId: number, total: number): Promise<number | null> {
  return transaction(async (client) => {
    await client.query(`SELECT id FROM models WHERE id = $1 FOR UPDATE`, [modelId]);
    const counted = await client.query<{ n: string; highest: number | null }>(
      `SELECT count(*)::text AS n, max(number) AS highest FROM edition_copies WHERE model_id = $1`,
      [modelId],
    );
    const row = counted.rows[0];
    const claimed = Number(row?.n ?? '0');
    if (claimed >= total) return null;
    const next = (row?.highest ?? 0) + 1;
    await client.query(`INSERT INTO edition_copies (model_id, number) VALUES ($1, $2)`, [
      modelId,
      next,
    ]);
    return next;
  });
}

/** A claimed copy whose Kill Bill charge fails is released. */
export async function releaseCopy(modelId: number, number: number): Promise<void> {
  await queryOne(
    `DELETE FROM edition_copies WHERE model_id = $1 AND number = $2 AND order_id IS NULL`,
    [modelId, number],
  );
}

export async function attachCopyToOrder(
  modelId: number,
  number: number,
  orderId: number,
): Promise<void> {
  await queryOne(`UPDATE edition_copies SET order_id = $3 WHERE model_id = $1 AND number = $2`, [
    modelId,
    number,
    orderId,
  ]);
}

/** A refunded edition copy's number is retired. */
export async function retireCopyForOrder(orderId: number): Promise<void> {
  await queryOne(`UPDATE edition_copies SET retired = true WHERE order_id = $1`, [orderId]);
}
