import { Db, nextCounter } from '../db/pool';
import { publish } from '../services/live';
import {
  CLAIM_STATUS_WORDS,
  RETURN_STATUS_WORDS,
  TRIAL_STATUS_WORDS
} from './rules';

export type CaseKind = 'return' | 'trial' | 'warranty_claim';

export const CASE_PREFIX: Record<CaseKind, string> = {
  return: 'RT',
  trial: 'TR',
  warranty_claim: 'WC'
};

export const CASE_STATUS_WORDS: Record<CaseKind, Record<string, string>> = {
  return: RETURN_STATUS_WORDS,
  trial: TRIAL_STATUS_WORDS,
  warranty_claim: CLAIM_STATUS_WORDS
};

export async function nextCaseNumber(client: Db, kind: CaseKind): Promise<string> {
  const value = await nextCounter(client, `case_number_${kind}`, 1001);
  return `${CASE_PREFIX[kind]}-${value}`;
}

export async function addCaseHistory(client: Db, kind: CaseKind, number: string, status: string): Promise<void> {
  await client.query('INSERT INTO case_history (kind, number, status) VALUES ($1, $2, $3)', [kind, number, status]);
}

export async function caseHistory(
  client: Db,
  kind: CaseKind,
  number: string
): Promise<Array<{ status: string; at: string }>> {
  const rows = await client.query<{ status: string; at: Date }>(
    'SELECT status, at FROM case_history WHERE kind = $1 AND number = $2 ORDER BY id ASC',
    [kind, number]
  );
  return rows.map((row) => ({ status: row.status, at: row.at.toISOString() }));
}

export async function publishCase(
  client: Db,
  kind: CaseKind,
  payload: { number: string; status: string; version: number },
  userId: string
): Promise<void> {
  const eventType = kind === 'warranty_claim' ? 'warranty' : kind;
  await publish(client, eventType, payload, { userId });
  await publish(client, 'queue', { kind, number: payload.number, status: payload.status }, { staffOnly: true });
}

export type ReturnRow = {
  number: string;
  order_line_id: string;
  user_id: string;
  status: string;
  version: number;
  quantity: number;
  reason: string;
  outcome: string;
  exchange_sku: string | null;
  exchange_order_number: string | null;
  refund_amount: number | null;
  reject_reason: string | null;
  created_at: Date;
};

export type TrialRow = {
  number: string;
  order_line_id: string;
  user_id: string;
  status: string;
  version: number;
  note: string;
  refund_amount: number | null;
  reject_reason: string | null;
  created_at: Date;
};

export type ClaimRow = {
  number: string;
  registration_id: string;
  user_id: string;
  component: string;
  description: string;
  status: string;
  version: number;
  reject_reason: string | null;
  resolution_order_number: string | null;
  created_at: Date;
};

export async function returnPayload(client: Db, row: ReturnRow): Promise<Record<string, unknown>> {
  const line = await client.one<{ order_number: string }>('SELECT order_number FROM order_lines WHERE id = $1', [
    row.order_line_id
  ]);
  return {
    number: row.number,
    status: row.status,
    version: row.version,
    order_number: line?.order_number ?? null,
    order_line_id: row.order_line_id,
    history: await caseHistory(client, 'return', row.number),
    refund_amount: row.refund_amount,
    reason: row.reason,
    quantity: row.quantity,
    outcome: row.outcome,
    exchange_sku: row.exchange_sku,
    exchange_order_number: row.exchange_order_number,
    reject_reason: row.reject_reason
  };
}

export async function trialPayload(client: Db, row: TrialRow): Promise<Record<string, unknown>> {
  const line = await client.one<{ order_number: string }>('SELECT order_number FROM order_lines WHERE id = $1', [
    row.order_line_id
  ]);
  return {
    number: row.number,
    status: row.status,
    version: row.version,
    order_number: line?.order_number ?? null,
    order_line_id: row.order_line_id,
    history: await caseHistory(client, 'trial', row.number),
    refund_amount: row.refund_amount,
    reason: null,
    note: row.note,
    reject_reason: row.reject_reason
  };
}

export async function claimPayload(client: Db, row: ClaimRow): Promise<Record<string, unknown>> {
  const registration = await client.one<{ order_line_id: string }>(
    'SELECT order_line_id FROM warranty_registrations WHERE id = $1',
    [row.registration_id]
  );
  const line =
    registration === null
      ? null
      : await client.one<{ order_number: string }>('SELECT order_number FROM order_lines WHERE id = $1', [
          registration.order_line_id
        ]);
  const evidence = await client.query<{ id: string; kind: string; filename: string; status: string }>(
    'SELECT id, kind, filename, status FROM evidence WHERE claim_number = $1 ORDER BY stored_at ASC',
    [row.number]
  );
  return {
    number: row.number,
    status: row.status,
    version: row.version,
    order_number: line?.order_number ?? null,
    order_line_id: registration?.order_line_id ?? null,
    registration_id: row.registration_id,
    history: await caseHistory(client, 'warranty_claim', row.number),
    refund_amount: null,
    reason: null,
    component: row.component,
    description: row.description,
    resolution_order_number: row.resolution_order_number,
    reject_reason: row.reject_reason,
    evidence
  };
}

export async function openReturnOrTrialExists(client: Db, orderLineId: string): Promise<boolean> {
  const openReturn = await client.one<{ number: string }>(
    `SELECT number FROM returns WHERE order_line_id = $1
     AND status NOT IN ('rejected', 'refunded', 'exchanged') LIMIT 1`,
    [orderLineId]
  );
  if (openReturn !== null) return true;
  const openTrial = await client.one<{ number: string }>(
    `SELECT number FROM trials WHERE order_line_id = $1
     AND status NOT IN ('rejected', 'refunded') LIMIT 1`,
    [orderLineId]
  );
  return openTrial !== null;
}

export async function openClaimExists(client: Db, orderLineId: string, component: string): Promise<boolean> {
  const row = await client.one<{ number: string }>(
    `SELECT c.number FROM warranty_claims c
     JOIN warranty_registrations r ON r.id = c.registration_id
     WHERE r.order_line_id = $1 AND c.component = $2
       AND c.status NOT IN ('rejected', 'resolved') LIMIT 1`,
    [orderLineId, component]
  );
  return row !== null;
}
