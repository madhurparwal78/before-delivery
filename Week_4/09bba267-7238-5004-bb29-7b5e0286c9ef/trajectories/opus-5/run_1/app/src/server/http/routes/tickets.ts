import { FIELD_MESSAGES } from '../../../shared/copy';
import { withTransaction } from '../../db';
import { exchangeTicket } from '../../domain/exchange';
import { loadOrders, publicOrder } from '../../domain/orders';
import { refundTickets } from '../../domain/refund';
import type { RequestContext } from '../context';
import { onceByKey } from '../idempotency';
import { type ApiResponse, error, json, validationError } from '../respond';
import { field, isUuid, stringArray, stringField } from '../validate';

export async function listOrders(context: RequestContext): Promise<ApiResponse> {
  const orders = await withTransaction((db) => loadOrders(db, { buyerId: context.buyerId, includeCancelled: false }));
  return json(200, { orders: orders.map(publicOrder) });
}

export async function showOrder(context: RequestContext): Promise<ApiResponse> {
  const orderId = context.params.orderId ?? '';
  const orders = await withTransaction((db) =>
    loadOrders(db, { buyerId: context.buyerId, orderId, includeCancelled: false }),
  );
  const order = orders[0];
  return order ? json(200, publicOrder(order)) : error(404, 'not_found');
}

export async function createExchange(context: RequestContext): Promise<ApiResponse> {
  return onceByKey(context, context.buyerId, async () => {
    const ticketId = context.params.ticketId ?? '';
    if (!isUuid(ticketId)) return error(404, 'not_found');
    const result = await exchangeTicket({
      ticketId,
      buyerId: context.buyerId,
      newSeatId: stringField(context.body, 'newSeatId'),
    });
    switch (result.kind) {
      case 'done':
        return json(200, { order: result.order, differenceCents: result.differenceCents });
      case 'not_found':
        return error(404, 'not_found');
      case 'changes_closed':
        return error(409, 'changes_closed');
      case 'ticket_not_issued':
        return error(409, 'ticket_not_issued');
      case 'seat_taken':
        return error(409, 'seats_taken', { taken: [result.seatId] });
      case 'invalid_seat':
        return validationError({ newSeatId: FIELD_MESSAGES.newSeatId });
      case 'declined':
        return error(402, 'payment_declined');
      default:
        return error(503, 'payments_unavailable');
    }
  });
}

export async function createRefund(context: RequestContext): Promise<ApiResponse> {
  return onceByKey(context, context.buyerId, async () => {
    const orderId = context.params.orderId ?? '';
    const requested = stringArray(field(context.body, 'ticketIds')) ?? [];
    const distinct = [...new Set(requested.filter(isUuid))];
    const result = await refundTickets({
      orderId,
      buyerId: context.buyerId,
      ticketIds: distinct,
      requestedCount: requested.length,
    });
    switch (result.kind) {
      case 'done':
        return json(200, { order: result.order, refundCents: result.refundCents });
      case 'not_found':
        return error(404, 'not_found');
      case 'changes_closed':
        return error(409, 'changes_closed');
      case 'ticket_not_issued':
        return error(409, 'ticket_not_issued');
      case 'invalid_tickets':
        return validationError({ ticketIds: FIELD_MESSAGES.ticketIds });
      default:
        return error(503, 'payments_unavailable');
    }
  });
}
