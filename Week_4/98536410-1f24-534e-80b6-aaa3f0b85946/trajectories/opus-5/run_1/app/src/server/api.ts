import type { RequestContext } from './http/context.js';
import type { ApiResult } from './http/result.js';
import {
  deleteSession,
  getHealth,
  getMe,
  getStatus,
  postSession,
} from './routes/session.js';
import {
  getDayPlan,
  getHours,
  getShopHolds,
  getSlots,
  getStock,
  getStore,
  listStores,
  postStockCount,
  postSuspension,
  postTillSale,
  putHours,
} from './routes/stores.js';
import { getAvailability, getProduct, listProducts } from './routes/catalogue.js';
import {
  deleteHold,
  getCart,
  getCartShops,
  getHold,
  postHold,
  putCartArea,
  putCartLine,
  putCartStore,
} from './routes/cart.js';
import {
  getEstateReview,
  getOrder,
  getOrderDocument,
  getOrderEvents,
  getOrderReplay,
  listOrders,
  listReturns,
  postOrder,
  postOrderTransition,
  postReturn,
  postReturnLabel,
  postReturnTransition,
} from './routes/orders.js';

type Handler = (context: RequestContext) => Promise<ApiResult>;
type Route = { method: string; segments: string[]; handler: Handler };

function route(method: string, pattern: string, handler: Handler): Route {
  return { method, segments: pattern.split('/').filter((part) => part !== ''), handler };
}

const ROUTES: Route[] = [
  route('POST', '/api/session', postSession),
  route('GET', '/api/me', getMe),
  route('DELETE', '/api/session', deleteSession),
  route('GET', '/api/health', getHealth),
  route('GET', '/api/status', getStatus),

  route('GET', '/api/stores', listStores),
  route('GET', '/api/stores/:id', getStore),
  route('POST', '/api/stores/:id/suspension', postSuspension),
  route('GET', '/api/stores/:id/stock', getStock),
  route('POST', '/api/stores/:id/stock/:sku/count', postStockCount),
  route('POST', '/api/stores/:id/till-sales', postTillSale),
  route('GET', '/api/stores/:id/holds', getShopHolds),
  route('GET', '/api/stores/:id/hours', getHours),
  route('PUT', '/api/stores/:id/hours', putHours),
  route('GET', '/api/stores/:id/day-plan', getDayPlan),
  route('GET', '/api/stores/:id/slots', getSlots),

  route('GET', '/api/products', listProducts),
  route('GET', '/api/products/:sku', getProduct),
  route('GET', '/api/products/:sku/availability', getAvailability),

  route('GET', '/api/cart', getCart),
  route('PUT', '/api/cart/lines/:sku', putCartLine),
  route('PUT', '/api/cart/store', putCartStore),
  route('PUT', '/api/cart/area', putCartArea),
  route('GET', '/api/cart/shops', getCartShops),

  route('POST', '/api/holds', postHold),
  route('GET', '/api/holds/:id', getHold),
  route('DELETE', '/api/holds/:id', deleteHold),

  route('POST', '/api/orders', postOrder),
  route('GET', '/api/orders', listOrders),
  route('GET', '/api/orders/:id', getOrder),
  route('POST', '/api/orders/:id/transitions', postOrderTransition),
  route('GET', '/api/orders/:id/document', getOrderDocument),
  route('GET', '/api/orders/:id/events', getOrderEvents),
  route('GET', '/api/orders/:id/replay', getOrderReplay),
  route('POST', '/api/orders/:id/returns', postReturn),

  route('GET', '/api/returns', listReturns),
  route('POST', '/api/returns/:id/transitions', postReturnTransition),
  route('POST', '/api/returns/:id/label', postReturnLabel),

  route('GET', '/api/estate/review', getEstateReview),
];

export function matchApiRoute(
  method: string,
  pathname: string,
): { handler: Handler; params: Record<string, string> } | null {
  const parts = pathname.split('/').filter((part) => part !== '');
  for (const candidate of ROUTES) {
    if (candidate.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let index = 0; index < candidate.segments.length; index += 1) {
      const segment = candidate.segments[index] as string;
      const value = parts[index] as string;
      if (segment.startsWith(':')) {
        params[segment.slice(1)] = decodeURIComponent(value);
      } else if (segment !== value) {
        matched = false;
        break;
      }
    }
    if (matched && candidate.method === method) return { handler: candidate.handler, params };
  }
  return null;
}
