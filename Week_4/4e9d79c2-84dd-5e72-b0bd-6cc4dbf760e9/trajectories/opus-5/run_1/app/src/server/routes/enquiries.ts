import { Route, assertKnown, jsonBody, pathParam, route } from './router.js';
import { conflict, invalid, notFound, providerUnavailable } from '../errors.js';
import { copy } from '../copy.js';
import { query } from '../db.js';
import { requireDesk } from '../session.js';
import { instantString } from '../../domain/time.js';
import { Size, isSize, refusePlan } from '../../domain/vehicles.js';
import {
  ENQUIRY_STATES,
  duplicatesOf,
  enquiryIdFollowingMerges,
  listEnquiries,
  mergeEnquiries,
  mergedReferencesOf,
  stateChangeAllowed,
} from '../data/enquiries.js';
import { EnquiryState, loadHire } from '../data/hires.js';
import { readTrip, reorderStops, routeTrip, savePlan, tripNeedsFirstRoute } from '../data/trips.js';

function rowJson(row: {
  id: string;
  reference: string;
  customerName: string;
  occasion: string;
  state: string;
  departDate: string;
  departTime: string;
  departInstant: number;
  createdAt: number;
}): Record<string, unknown> {
  return {
    id: row.id,
    reference: row.reference,
    customerName: row.customerName,
    occasion: row.occasion,
    state: row.state,
    departAt: { date: row.departDate, time: row.departTime },
    departInstant: instantString(row.departInstant),
    createdAt: instantString(row.createdAt),
  };
}

export const enquiryRoutes: Route[] = [
  route('GET', '/api/enquiries', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const listing = await listEnquiries(desk.id, {
      state: ctx.queryValue('state'),
      occasion: ctx.queryValue('occasion'),
      q: ctx.cappedQuery('q'),
      after: ctx.queryValue('after'),
      before: ctx.queryValue('before'),
    });
    ctx.json(200, {
      enquiries: listing.rows.map(rowJson),
      nextCursor: listing.nextCursor,
      prevCursor: listing.prevCursor,
    });
  }),

  route('POST', '/api/enquiries/merge', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const body = await jsonBody(ctx);
    const ids = Array.isArray(body.enquiryIds) ? body.enquiryIds : [];
    if (ids.length < 2 || ids.some((id) => typeof id !== 'string')) {
      throw invalid('Choose two enquiries to merge.', { enquiryIds: 'Choose two enquiries to merge.' });
    }
    ctx.json(200, await mergeEnquiries(desk.id, ids as string[]));
  }),

  route('GET', '/api/enquiries/:id', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const followed = assertKnown(await enquiryIdFollowingMerges(desk.id, pathParam(ctx, 'id')));
    const hire = assertKnown(await loadHire(desk.id, followed));
    ctx.json(200, {
      ...rowJson({
        id: hire.id,
        reference: hire.reference,
        customerName: hire.customer.name,
        occasion: hire.occasion,
        state: hire.enquiryState,
        departDate: hire.departAt.date,
        departTime: hire.departAt.time,
        departInstant: hire.departInstant,
        createdAt: hire.createdAt,
      }),
      journeyType: hire.journeyType,
      stops: hire.stops,
      returnAt: hire.returnAt,
      returnInstant: hire.returnInstant === null ? null : instantString(hire.returnInstant),
      party: hire.party,
      details: hire.details,
      email: hire.customer.email,
      telephone: hire.customer.telephone,
      language: hire.language,
      submittedBody: hire.submittedBody,
      mergedReferences: await mergedReferencesOf(desk.id, hire.id),
      duplicates: await duplicatesOf(desk.id, hire.id),
    });
  }),

  route('PATCH', '/api/enquiries/:id', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const id = pathParam(ctx, 'id');
    const hire = assertKnown(await loadHire(desk.id, id));
    const body = await jsonBody(ctx);
    const state = body.state;
    if (typeof state !== 'string' || !ENQUIRY_STATES.includes(state as EnquiryState)) {
      throw invalid('Choose a state.', { state: 'Choose a state.' });
    }
    const wanted = state as EnquiryState;
    if (!stateChangeAllowed(hire.enquiryState, wanted)) throw conflict('illegalStateChange', copy.stateRefused);
    if (wanted !== hire.enquiryState) {
      await query('update enquiries set state = $3 where desk_id = $1 and id = $2', [desk.id, id, wanted]);
    }
    const fresh = assertKnown(await loadHire(desk.id, id));
    ctx.json(
      200,
      rowJson({
        id: fresh.id,
        reference: fresh.reference,
        customerName: fresh.customer.name,
        occasion: fresh.occasion,
        state: fresh.enquiryState,
        departDate: fresh.departAt.date,
        departTime: fresh.departAt.time,
        departInstant: fresh.departInstant,
        createdAt: fresh.createdAt,
      }),
    );
  }),

  route('GET', '/api/enquiries/:id/trip', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const hire = assertKnown(await loadHire(desk.id, pathParam(ctx, 'id')));
    if (await tripNeedsFirstRoute(desk.id, hire.id)) {
      try {
        ctx.json(200, await routeTrip(desk.id, hire.id, hire.party));
        return;
      } catch {
        ctx.json(200, await readTrip(desk.id, hire.id, hire.party));
        return;
      }
    }
    ctx.json(200, await readTrip(desk.id, hire.id, hire.party));
  }),

  route('PUT', '/api/enquiries/:id/trip/stops', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const hire = assertKnown(await loadHire(desk.id, pathParam(ctx, 'id')));
    const body = await jsonBody(ctx);
    const order = Array.isArray(body.order) ? body.order : [];
    if (order.some((id) => typeof id !== 'string')) throw invalid('Send the stops in order.');
    if (!(await reorderStops(desk.id, hire.id, order as string[]))) throw notFound();
    try {
      ctx.json(200, await routeTrip(desk.id, hire.id, hire.party));
    } catch {
      const trip = await readTrip(desk.id, hire.id, hire.party);
      throw providerUnavailable(copy.routeFailed, 'routeProviderDown');
    }
  }),

  route('POST', '/api/enquiries/:id/trip/route', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const hire = assertKnown(await loadHire(desk.id, pathParam(ctx, 'id')));
    await jsonBody(ctx);
    try {
      ctx.json(200, await routeTrip(desk.id, hire.id, hire.party));
    } catch {
      throw providerUnavailable(copy.routeFailed, 'routeProviderDown');
    }
  }),

  route('PUT', '/api/enquiries/:id/trip/plan', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const hire = assertKnown(await loadHire(desk.id, pathParam(ctx, 'id')));
    const body = await jsonBody(ctx);
    const sizes = Array.isArray(body.sizes) ? body.sizes : null;
    if (!sizes || sizes.length === 0 || sizes.some((size) => typeof size !== 'number')) {
      throw invalid(copy.sizeNotOffered, { sizes: copy.sizeNotOffered });
    }
    const refusal = refusePlan(sizes as number[], hire.party);
    if (refusal) throw invalid(refusal.message, { sizes: refusal.message });
    await savePlan(desk.id, hire.id, (sizes as number[]).filter(isSize) as Size[]);
    ctx.json(200, await readTrip(desk.id, hire.id, hire.party));
  }),
];
