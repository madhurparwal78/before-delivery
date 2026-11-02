import {
  FLAVOURS,
  findFlavour,
  findProvince,
  type FlavourSlug,
} from '../../shared/catalogue.js';
import { apiMessages, reviewCopy } from '../../shared/copy.js';
import { isSubscribable, type CanCount } from '../../shared/quote.js';
import { approvedReviews } from '../app/reviews.js';
import { publishStockLevels } from '../app/live.js';
import { quoteCrate, readQuoteRequest } from '../app/quotes.js';
import {
  clearSubscribe,
  loadCrate,
  type Crate,
  releaseCan,
  reserveCans,
  updateCrateChoices,
} from '../db/cart.js';
import { availableStock } from '../db/ledger.js';
import { countPaidOrdersWithFlavour } from '../db/orders.js';
import { loadSettings } from '../db/settings.js';
import { ApiError, conflict, notFound, validationError } from '../http/errors.js';
import type { Route } from '../http/router.js';
import { createReview } from '../services/pocketbase.js';
import { crateBody, CUSTOMER_ONLY, openCart } from './support.js';

function crateCans(crate: Crate): CanCount[] {
  const counts = new Map<FlavourSlug, number>();
  for (const slot of crate.slots) {
    if (slot === null) continue;
    counts.set(slot.flavour, (counts.get(slot.flavour) ?? 0) + 1);
  }
  return [...counts].map(([flavour, quantity]) => ({ flavour, quantity }));
}

export const shopRoutes: readonly Route[] = [
  {
    method: 'GET',
    path: '/api/flavours',
    handle: async () => {
      const [settings, available] = await Promise.all([loadSettings(), availableStock()]);
      return {
        status: 200,
        json: {
          flavours: FLAVOURS.map((flavour) => ({
            slug: flavour.slug,
            name: flavour.name,
            can_price_cents: settings.pricing.canPriceCents[flavour.slug],
            limited: flavour.limited,
            subscribable: flavour.subscribable,
            stock_left: available.get(flavour.slug) ?? 0,
          })),
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/api/flavours/:slug/reviews',
    handle: async (ctx) => {
      const flavour = findFlavour(ctx.params.slug!);
      if (flavour === undefined) throw notFound();
      return { status: 200, json: { reviews: await approvedReviews(flavour.slug) } };
    },
  },
  {
    method: 'POST',
    path: '/api/flavours/:slug/reviews',
    roles: CUSTOMER_ONLY,
    handle: async (ctx) => {
      const flavour = findFlavour(ctx.params.slug!);
      if (flavour === undefined) throw notFound();
      const payload = (ctx.body ?? {}) as Record<string, unknown>;
      const fields: Record<string, string> = {};
      const rating = payload.rating;
      if (
        typeof rating !== 'number' ||
        !Number.isInteger(rating) ||
        rating < 1 ||
        rating > 5
      ) {
        fields.rating = 'Give a rating from 1 to 5.';
      }
      const body = typeof payload.body === 'string' ? payload.body.trim() : '';
      if (body.length < 10 || body.length > 1000) {
        fields.body = 'Write between 10 and 1000 characters.';
      }
      if (Object.keys(fields).length > 0) throw validationError(fields);

      if ((await countPaidOrdersWithFlavour(ctx.user!.id, flavour.slug)) === 0) {
        throw new ApiError(403, 'not_a_buyer', reviewCopy.notBuyer);
      }
      const review = await createReview({
        flavour: flavour.slug,
        user: ctx.user!.id,
        rating: rating as number,
        body,
      });
      if (review === 'already_reviewed') {
        throw conflict('already_reviewed', reviewCopy.alreadyReviewed);
      }
      return { status: 201, json: { review: { id: review.id, status: 'pending' } } };
    },
  },
  {
    method: 'POST',
    path: '/api/quote',
    handle: async (ctx) => ({
      status: 200,
      json: await quoteCrate(readQuoteRequest(ctx.body)),
    }),
  },
  {
    method: 'GET',
    path: '/api/cart',
    handle: async (ctx) => {
      const cart = await openCart(ctx);
      const crate = await loadCrate(cart.id);
      if (crate === null) {
        const fresh = await openCart({ ...ctx, cartId: null });
        return {
          status: 200,
          json: { cart: crateBody((await loadCrate(fresh.id))!) },
          cookies: fresh.cookies,
        };
      }
      return { status: 200, json: { cart: crateBody(crate) }, cookies: cart.cookies };
    },
  },
  {
    method: 'POST',
    path: '/api/cart/items',
    handle: async (ctx) => {
      const payload = (ctx.body ?? {}) as Record<string, unknown>;
      const flavour = typeof payload.flavour === 'string' ? findFlavour(payload.flavour) : undefined;
      const quantity = payload.quantity;
      const fields: Record<string, string> = {};
      if (flavour === undefined) fields.flavour = apiMessages.unknownFlavour;
      if (
        typeof quantity !== 'number' ||
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > 12
      ) {
        fields.quantity = apiMessages.badQuantity;
      }
      if (Object.keys(fields).length > 0) throw validationError(fields);

      const cart = await openCart(ctx);
      const outcome = await reserveCans(cart.id, flavour!.slug, quantity as number);
      if (outcome === null) throw notFound();
      if (!outcome.result.granted) {
        const refusal = outcome.result;
        if (refusal.refusal === 'sold_out') {
          throw new ApiError(409, 'sold_out', 'That flavour just sold out.', {
            stock_left: refusal.stockLeft,
          });
        }
        throw new ApiError(409, 'hold_limit', 'That would pass a crate limit.', {
          limit: refusal.limit,
          stock_left: refusal.stockLeft,
        });
      }
      if (outcome.crate.subscribe && !isSubscribable(crateCans(outcome.crate))) {
        await clearSubscribe(cart.id);
        outcome.crate.subscribe = false;
      }
      void publishStockLevels();
      return {
        status: 201,
        json: {
          cart: crateBody(outcome.crate),
          added: { flavour: flavour!.slug, slots: outcome.result.slots },
          stock_left: outcome.result.stockLeft,
        },
        cookies: cart.cookies,
      };
    },
  },
  {
    method: 'DELETE',
    path: '/api/cart/items/:slot',
    body: 'none',
    handle: async (ctx) => {
      const slot = Number(ctx.params.slot);
      if (!Number.isInteger(slot) || slot < 0 || slot > 11) throw notFound();
      const cart = await openCart(ctx);
      const outcome = await releaseCan(cart.id, slot);
      if (outcome === null || outcome === 'empty_slot') throw notFound();
      if (outcome.crate.subscribe && !isSubscribable(crateCans(outcome.crate))) {
        await clearSubscribe(cart.id);
        outcome.crate.subscribe = false;
      }
      void publishStockLevels();
      return {
        status: 200,
        json: { cart: crateBody(outcome.crate), stock_left: outcome.stockLeft },
        cookies: cart.cookies,
      };
    },
  },
  {
    method: 'PATCH',
    path: '/api/cart',
    handle: async (ctx) => {
      const payload = (ctx.body ?? {}) as Record<string, unknown>;
      const fields: Record<string, string> = {};
      if (payload.province !== undefined && findProvince(String(payload.province)) === undefined) {
        fields.province = apiMessages.unknownProvince;
      }
      if (
        payload.cadence !== undefined &&
        payload.cadence !== 'monthly' &&
        payload.cadence !== 'bimonthly'
      ) {
        fields.cadence = 'Pick a delivery rhythm.';
      }
      if (payload.subscribe !== undefined && typeof payload.subscribe !== 'boolean') {
        fields.subscribe = 'Say whether this crate is a subscription.';
      }
      if (Object.keys(fields).length > 0) throw validationError(fields);

      const cart = await openCart(ctx);
      const current = await loadCrate(cart.id);
      if (current === null) throw notFound();
      if (payload.subscribe === true && !isSubscribable(crateCans(current))) {
        throw conflict('not_subscribable', apiMessages.notSubscribable);
      }
      const crate = await updateCrateChoices(cart.id, {
        province: payload.province === undefined ? undefined : findProvince(String(payload.province))!.code,
        subscribe: payload.subscribe === undefined ? undefined : payload.subscribe === true,
        cadence:
          payload.cadence === undefined ? undefined : (payload.cadence as 'monthly' | 'bimonthly'),
      });
      if (crate === null) throw notFound();
      return { status: 200, json: { cart: crateBody(crate) }, cookies: cart.cookies };
    },
  },
];
