import type { PgPool, PgConnection } from '../db/pg.ts';

/**
 * One receipt number per settled payment, allocated atomically. The connection
 * must already hold the transaction open.
 */
export async function allocateReceiptNumber(conn: PgConnection): Promise<string> {
  await conn.query(`INSERT INTO receipt_sequence (id, value) VALUES (1, 1) ON CONFLICT (id) DO NOTHING`);
  const res = await conn.query(`UPDATE receipt_sequence SET value = value + 1 WHERE id = 1 RETURNING value - 1 AS seq`);
  const seq = Number(res.rows[0]!['seq']);
  return `HRR-${String(seq).padStart(6, '0')}`;
}

export type { PgPool };
