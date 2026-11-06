import type { Queryable } from './pool.js';

const SEQUENCES = {
  order: { sequence: 'order_number_seq', prefix: 'PDL-' },
  subscription: { sequence: 'subscription_number_seq', prefix: 'SUB-' },
  refund: { sequence: 'refund_number_seq', prefix: 'RF-' },
  credit: { sequence: 'credit_number_seq', prefix: 'CR-' },
  contact: { sequence: 'contact_number_seq', prefix: 'CT-' },
  notice: { sequence: 'notice_number_seq', prefix: 'NT-' },
  stepup: { sequence: 'stepup_number_seq', prefix: 'SC-' },
  batch: { sequence: 'batch_code_seq', prefix: 'B-' },
} as const;

export type NumberKind = keyof typeof SEQUENCES;

const WIDTH: Record<NumberKind, number> = {
  order: 6,
  subscription: 6,
  refund: 6,
  credit: 6,
  contact: 6,
  notice: 6,
  stepup: 6,
  batch: 4,
};

export async function takeNumber(client: Queryable, kind: NumberKind): Promise<string> {
  const { sequence, prefix } = SEQUENCES[kind];
  const result = await client.query<{ value: string }>(
    `SELECT nextval('${sequence}')::text AS value`,
  );
  const value = result.rows[0]?.value;
  if (!value) throw new Error(`could not take a ${kind} number`);
  return `${prefix}${value.padStart(WIDTH[kind], '0')}`;
}
