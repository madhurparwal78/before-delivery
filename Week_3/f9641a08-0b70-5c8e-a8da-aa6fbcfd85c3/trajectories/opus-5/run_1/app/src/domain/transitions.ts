import { Db } from '../db/pool';
import { FIELD_COPY, invalidTransition, notFound, outOfStock, validationFailed } from '../errors';
import { SessionUser } from '../http/context';
import { appendAudit } from './audit';
import {
  ClaimRow,
  ReturnRow,
  TrialRow,
  addCaseHistory,
  claimPayload,
  publishCase,
  returnPayload,
  trialPayload
} from './cases';
import { publishStockFor } from './events';
import { returnSubject, recordNotification, statusBody, trialSubject, warrantySubject } from './notify';
import {
  CLAIM_STATUS_WORDS,
  CLAIM_TRANSITIONS,
  RETURN_STATUS_WORDS,
  RETURN_TRANSITIONS,
  TRIAL_STATUS_WORDS,
  TRIAL_TRANSITIONS,
  refundShareFor
} from './rules';
import {
  OrderLineRow,
  OrderRow,
  createZeroValueOrder,
  exchangeCandidates,
  issueRefund,
  loadOrder,
  linePaidAmount,
  publishOrder
} from './orders';
import { availableMap, drawFromAccount, lockVariants } from './stock';

function requireReason(to: string, reason: string | null): string | null {
  if (to !== 'rejected') return null;
  const value = (reason ?? '').trim();
  if (value.length < 5 || value.length > 500) throw validationFailed({ reason: FIELD_COPY.staffReason });
  return value;
}

async function lineAndOrder(client: Db, orderLineId: string): Promise<{ line: OrderLineRow; order: OrderRow }> {
  const line = await client.one<OrderLineRow>('SELECT * FROM order_lines WHERE id = $1 FOR UPDATE', [orderLineId]);
  if (line === null) throw notFound();
  const order = await client.one<OrderRow>('SELECT * FROM orders WHERE number = $1 FOR UPDATE', [
    line.order_number
  ]);
  if (order === null) throw notFound();
  return { line, order };
}

export async function transitionReturn(
  client: Db,
  row: ReturnRow,
  to: string,
  reason: string | null,
  actor: SessionUser
): Promise<Record<string, unknown>> {
  if (!(to in RETURN_STATUS_WORDS)) throw validationFailed({ to: FIELD_COPY.caseTo });
  if (!(RETURN_TRANSITIONS[row.status] ?? []).includes(to)) throw invalidTransition();
  const rejectReason = requireReason(to, reason);

  const { line, order } = await lineAndOrder(client, row.order_line_id);

  let refundAmount: number | null = null;

  if (to === 'received') {
    await lockVariants(client, [line.variant_id]);
    await drawFromAccount(client, line.variant_id, 'return_received', row.number, row.quantity, 'dispatched');
    await publishStockFor(client, [line.variant_id]);
  }

  if (to === 'refunded') {
    const amount = refundShareFor(
      linePaidAmount(line),
      line.quantity,
      line.returned_quantity,
      line.refunded_amount,
      row.quantity
    );
    await issueRefund(client, order, amount, 'return', row.number);
    await client.query(
      'UPDATE order_lines SET returned_quantity = returned_quantity + $2, refunded_amount = refunded_amount + $3 WHERE id = $1',
      [line.id, row.quantity, amount]
    );
    refundAmount = amount;
    const refreshed = await loadOrder(client, order.number);
    await publishOrder(client, refreshed!);
  }

  if (to === 'exchanged') {
    const candidates = await exchangeCandidates(client, line);
    const candidate = candidates.find((item) => item.sku === row.exchange_sku);
    if (candidate === undefined) throw validationFailed({ exchange_sku: FIELD_COPY.exchangeSku });
    const variant = await client.one<{ id: string }>('SELECT id FROM variants WHERE sku = $1', [candidate.sku]);
    const available = (await availableMap(client, [variant!.id])).get(variant!.id) ?? 0;
    if (available < row.quantity) {
      throw outOfStock(candidate.sku, available, `${line.product} — ${candidate.colour}, ${candidate.size}`);
    }
    const exchangeOrder = await createZeroValueOrder(client, {
      userId: row.user_id,
      email: order.email,
      kind: 'exchange',
      sourceOrder: order,
      variantId: variant!.id,
      quantity: row.quantity,
      reason: 'exchange_committed',
      ref: row.number
    });
    await client.query('UPDATE returns SET exchange_order_number = $2 WHERE number = $1', [
      row.number,
      exchangeOrder.number
    ]);
    await client.query('UPDATE order_lines SET returned_quantity = returned_quantity + $2 WHERE id = $1', [
      line.id,
      row.quantity
    ]);
  }

  await client.query(
    'UPDATE returns SET status = $2, version = version + 1, reject_reason = $3, refund_amount = coalesce($4, refund_amount) WHERE number = $1',
    [row.number, to, rejectReason, refundAmount]
  );
  await addCaseHistory(client, 'return', row.number, to);
  const updated = await client.one<ReturnRow>('SELECT * FROM returns WHERE number = $1', [row.number]);
  await publishCase(client, 'return', { number: row.number, status: to, version: updated!.version }, row.user_id);
  await appendAudit(client, actor, 'status_changed', 'return', row.number, { status: row.status }, { status: to });
  const subject = returnSubject(row.number, to);
  await recordNotification(
    client,
    row.user_id,
    subject,
    statusBody(`Return ${row.number}`, RETURN_STATUS_WORDS[to], refundAmount),
    'pending'
  );
  return returnPayload(client, updated!);
}

export async function transitionTrial(
  client: Db,
  row: TrialRow,
  to: string,
  reason: string | null,
  actor: SessionUser
): Promise<Record<string, unknown>> {
  if (!(to in TRIAL_STATUS_WORDS)) throw validationFailed({ to: FIELD_COPY.caseTo });
  if (!(TRIAL_TRANSITIONS[row.status] ?? []).includes(to)) throw invalidTransition();
  const rejectReason = requireReason(to, reason);

  const { line, order } = await lineAndOrder(client, row.order_line_id);

  let refundAmount: number | null = null;

  if (to === 'returned') {
    await lockVariants(client, [line.variant_id]);
    await drawFromAccount(client, line.variant_id, 'trial_returned', row.number, line.quantity, 'dispatched');
    await publishStockFor(client, [line.variant_id]);
  }

  if (to === 'refunded') {
    const amount = linePaidAmount(line) - line.refunded_amount;
    await issueRefund(client, order, amount, 'trial', row.number);
    await client.query(
      'UPDATE order_lines SET returned_quantity = $2, refunded_amount = refunded_amount + $3 WHERE id = $1',
      [line.id, line.quantity, amount]
    );
    refundAmount = amount;
    const refreshed = await loadOrder(client, order.number);
    await publishOrder(client, refreshed!);
  }

  await client.query(
    'UPDATE trials SET status = $2, version = version + 1, reject_reason = $3, refund_amount = coalesce($4, refund_amount) WHERE number = $1',
    [row.number, to, rejectReason, refundAmount]
  );
  await addCaseHistory(client, 'trial', row.number, to);
  const updated = await client.one<TrialRow>('SELECT * FROM trials WHERE number = $1', [row.number]);
  await publishCase(client, 'trial', { number: row.number, status: to, version: updated!.version }, row.user_id);
  await appendAudit(client, actor, 'status_changed', 'trial', row.number, { status: row.status }, { status: to });
  const subject = trialSubject(row.number, to);
  await recordNotification(
    client,
    row.user_id,
    subject,
    statusBody(`Trial return ${row.number}`, TRIAL_STATUS_WORDS[to], refundAmount),
    'pending'
  );
  return trialPayload(client, updated!);
}

export async function transitionClaim(
  client: Db,
  row: ClaimRow,
  to: string,
  reason: string | null,
  actor: SessionUser
): Promise<Record<string, unknown>> {
  if (!(to in CLAIM_STATUS_WORDS)) throw validationFailed({ to: FIELD_COPY.caseTo });
  if (!(CLAIM_TRANSITIONS[row.status] ?? []).includes(to)) throw invalidTransition();
  const rejectReason = requireReason(to, reason);

  const registration = await client.one<{ order_line_id: string }>(
    'SELECT order_line_id FROM warranty_registrations WHERE id = $1',
    [row.registration_id]
  );
  if (registration === null) throw notFound();
  const { line, order } = await lineAndOrder(client, registration.order_line_id);

  if (to === 'replacement') {
    await lockVariants(client, [line.variant_id]);
    const available = (await availableMap(client, [line.variant_id])).get(line.variant_id) ?? 0;
    if (available < 1) {
      throw outOfStock(line.sku, available, `${line.product} — ${line.colour}, ${line.size}`);
    }
    const replacementOrder = await createZeroValueOrder(client, {
      userId: row.user_id,
      email: order.email,
      kind: 'replacement',
      sourceOrder: order,
      variantId: line.variant_id,
      quantity: 1,
      reason: 'replacement_committed',
      ref: row.number
    });
    await client.query('UPDATE warranty_claims SET resolution_order_number = $2 WHERE number = $1', [
      row.number,
      replacementOrder.number
    ]);
  }

  await client.query(
    'UPDATE warranty_claims SET status = $2, version = version + 1, reject_reason = $3 WHERE number = $1',
    [row.number, to, rejectReason]
  );
  await addCaseHistory(client, 'warranty_claim', row.number, to);
  const updated = await client.one<ClaimRow>('SELECT * FROM warranty_claims WHERE number = $1', [row.number]);
  await publishCase(
    client,
    'warranty_claim',
    { number: row.number, status: to, version: updated!.version },
    row.user_id
  );
  await appendAudit(
    client,
    actor,
    'status_changed',
    'warranty_claim',
    row.number,
    { status: row.status },
    { status: to }
  );
  const subject = warrantySubject(row.number, to);
  await recordNotification(
    client,
    row.user_id,
    subject,
    statusBody(`Warranty claim ${row.number}`, CLAIM_STATUS_WORDS[to], null),
    'pending'
  );
  return claimPayload(client, updated!);
}
