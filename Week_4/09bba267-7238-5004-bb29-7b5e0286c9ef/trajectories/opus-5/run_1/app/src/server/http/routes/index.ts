import type { RequestContext } from '../context';
import type { ApiResponse } from '../respond';
import * as catalogue from './catalogue';
import * as holds from './holds';
import * as offers from './offers';
import * as owner from './owner';
import * as tickets from './tickets';

export interface Route {
  readonly method: string;
  readonly segments: readonly string[];
  readonly ownerOnly: boolean;
  readonly handle: (context: RequestContext) => Promise<ApiResponse>;
}

function route(
  method: string,
  path: string,
  handle: (context: RequestContext) => Promise<ApiResponse>,
  ownerOnly = false,
): Route {
  return { method, segments: path.split('/').filter((segment) => segment !== ''), ownerOnly, handle };
}

export const API_ROUTES: readonly Route[] = [
  route('GET', '/api/health', catalogue.health),
  route('GET', '/api/performances', catalogue.listPerformances),
  route('GET', '/api/performances/:performanceId', catalogue.showPerformance),
  route('GET', '/api/performances/:performanceId/seats', catalogue.listSeats),
  route('GET', '/api/performances/:performanceId/cart', catalogue.showCart),
  route('POST', '/api/performances/:performanceId/holds', holds.createHold),
  route('DELETE', '/api/performances/:performanceId/holds/:seatId', holds.deleteHold),
  route('POST', '/api/performances/:performanceId/checkout', holds.createCheckout),
  route('POST', '/api/performances/:performanceId/tiers/:tierId/waitlist', holds.createWaitlistEntry),
  route('GET', '/api/orders', tickets.listOrders),
  route('GET', '/api/orders/:orderId', tickets.showOrder),
  route('POST', '/api/tickets/:ticketId/exchange', tickets.createExchange),
  route('POST', '/api/orders/:orderId/refunds', tickets.createRefund),
  route('GET', '/api/waitlist', catalogue.listWaitlist),
  route('GET', '/api/offers/:token', offers.showOffer),
  route('POST', '/api/offers/:token/accept', offers.createOfferAcceptance),
  route('POST', '/api/offers/:token/decline', offers.createOfferDecline),
  route('POST', '/api/owner/session', owner.createOwnerSession),
  route('DELETE', '/api/owner/session', owner.deleteOwnerSession),
  route('GET', '/api/owner/performances', owner.listOwnerPerformances, true),
  route('POST', '/api/owner/performances', owner.createOwnerPerformance, true),
  route('GET', '/api/owner/orders', owner.listOwnerOrders, true),
  route('GET', '/api/owner/outbox', owner.listOwnerOutbox, true),
];

export function matchRoute(
  method: string,
  pathname: string,
): { route: Route; params: Record<string, string> } | undefined {
  const parts = pathname.split('/').filter((segment) => segment !== '');
  for (const candidate of API_ROUTES) {
    if (candidate.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (const [index, segment] of candidate.segments.entries()) {
      const part = parts[index] ?? '';
      if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(part);
      else if (segment !== part) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    if (candidate.method !== method) continue;
    return { route: candidate, params };
  }
  return undefined;
}
