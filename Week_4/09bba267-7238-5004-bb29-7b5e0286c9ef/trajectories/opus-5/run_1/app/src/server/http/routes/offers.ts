import { withTransaction } from '../../db';
import { acceptOffer } from '../../domain/purchase';
import { declineOffer, loadOffer } from '../../domain/waitlist';
import { endExpiredOffers } from '../../domain/seats';
import type { RequestContext } from '../context';
import { onceByKey } from '../idempotency';
import { type ApiResponse, error, json } from '../respond';

export async function showOffer(context: RequestContext): Promise<ApiResponse> {
  const token = context.params.token ?? '';
  const offer = await withTransaction((db) => loadOffer(db, token));
  return offer ? json(200, { offer }) : error(404, 'not_found');
}

export async function createOfferAcceptance(context: RequestContext): Promise<ApiResponse> {
  const token = context.params.token ?? '';
  return onceByKey(context, `${context.buyerId}:offer:${token}`, async () => {
    await withTransaction((db) => endExpiredOffers(db));
    const result = await acceptOffer(token);
    if (result === undefined) return error(404, 'not_found');
    switch (result.kind) {
      case 'paid':
        return json(201, { order: result.order });
      case 'sales_closed':
        return error(409, 'sales_closed');
      case 'offer_closed':
        return error(409, 'offer_closed');
      case 'offer_expired':
        return error(410, 'offer_expired');
      case 'declined':
        return error(402, 'payment_declined');
      default:
        return error(503, 'payments_unavailable');
    }
  });
}

export async function createOfferDecline(context: RequestContext): Promise<ApiResponse> {
  const token = context.params.token ?? '';
  const result = await declineOffer(token);
  switch (result.kind) {
    case 'declined':
      return json(200, { offer: result.offer });
    case 'offer_closed':
      return error(409, 'offer_closed');
    case 'offer_expired':
      return error(410, 'offer_expired');
    case 'not_found':
      return error(404, 'not_found');
  }
}
