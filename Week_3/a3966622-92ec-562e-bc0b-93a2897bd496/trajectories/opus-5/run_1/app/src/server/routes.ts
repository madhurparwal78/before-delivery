import { computePlan, openWindows } from '../domain/plan.ts';
import {
  dateKeyAt,
  formatInstantSeconds,
  parsePortDate,
  parsePortDateTime,
  wallToInstant,
} from '../domain/porttime.ts';
import { nextAvailableInstant } from '../domain/rest.ts';
import { ROUTE } from '../domain/route.ts';
import { STANDARD_DAY } from '../domain/tide.ts';
import type { App } from './app.ts';
import {
  moveBoardingInstant,
  dutiesOfPilot,
  pilotOfUser,
  planForMove,
  planSubjectOf,
  tideTableOf,
  userByEmail,
} from './derive.ts';
import { ApiError, forbidden, invalid, notFound } from './errors.ts';
import {
  type PublicContext,
  type RequestContext,
  type Reply,
  type Route,
  newSessionToken,
} from './http.ts';
import {
  invoiceOrNotFound,
  issueInvoice,
  listTariffRevisions,
  publishTariffRevision,
  refreshInvoiceBalance,
} from './ops/accounts.ts';
import { assignPilot, readEligibility } from './ops/assignment.ts';
import {
  CARD_LIMIT_BYTES,
  PHOTO_LIMIT_BYTES,
  canReadPhoto,
  declaredPdfType,
  declaredPhotoType,
  fileLadderReport,
  payloadTooLarge,
  storagePhotoLimits,
  storePhoto,
  storePilotCard,
  storageUnavailable,
} from './ops/evidence.ts';
import { movesExportCsv, visibleMovesInBoardingOrder } from './ops/exports.ts';
import {
  amendMove,
  cancelMove,
  commitWindow,
  createMove,
  detentionAction,
  pilotTransition,
  reorderMove,
} from './ops/moves.ts';
import { publishTideRevision } from './ops/tides.ts';
import {
  BLOCK_RANGE,
  FieldErrors,
  LENGTH_RANGE,
  SPEED_RANGE,
  TONNAGE_RANGE,
  asRecord,
  boardingTimeField,
  definite,
  draughtField,
  numberField,
  wholeNumberField,
} from './ops/validate.ts';
import type { MoveRecord, StoreState, UserRecord, VesselRecord } from './store/types.ts';
import {
  canReadMove,
  canReadVessel,
  invoiceView,
  moveView,
  planView,
  reportView,
  vesselView,
} from './views.ts';

function moveOr404(app: App, user: UserRecord, ref: string): MoveRecord {
  const move = app.store.read().moves.find((entry) => entry.ref === ref);
  if (move === undefined || !canReadMove(user, move)) throw notFound();
  return move;
}

function vesselOr404(app: App, user: UserRecord, id: string): VesselRecord {
  const vessel = app.store.read().vessels.find((entry) => entry.id === id);
  if (vessel === undefined || !canReadVessel(user, vessel)) throw notFound();
  return vessel;
}

function sessionUserJson(user: UserRecord): Reply {
  return {
    status: 200,
    json: {
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        agency_code: user.agency_code,
      },
    },
  };
}

function matchesSearch(state: StoreState, move: MoveRecord, query: string): boolean {
  if (query.trim() === '') return true;
  const vessel = state.vessels.find((entry) => entry.id === move.vessel_id);
  const haystack = `${move.ref} ${vessel?.name ?? ''} ${move.status}`.toLowerCase();
  return haystack.includes(query.trim().toLowerCase());
}

function planningSubjectFromBody(
  app: App,
  user: UserRecord,
  body: unknown,
): { vessel: VesselRecord; subject: ReturnType<typeof planSubjectOf>; tonnage: number; boarding: number } {
  const fields = asRecord(body);
  const state = app.store.read();
  const vessel = state.vessels.find((entry) => entry.id === fields.vessel_id);
  if (vessel === undefined || !canReadVessel(user, vessel)) throw notFound();
  const errors = new FieldErrors();
  const boardingField = boardingTimeField(fields, errors, { mustBeFuture: false, now: Date.now() });
  const draught = draughtField(fields, errors);
  const speed = numberField(fields, 'speed_kn', errors, SPEED_RANGE);
  const block = numberField(fields, 'block_coefficient', errors, BLOCK_RANGE);
  const tonnage = wholeNumberField(fields, 'gross_tonnage', errors, TONNAGE_RANGE);
  numberField(fields, 'length_m', errors, LENGTH_RANGE);
  errors.throwIfAny();
  const boarding = definite(boardingField, 'boarding_at');
  return {
    vessel,
    subject: {
      draught_mm: draught ?? vessel.draught_mm,
      speed_kn: speed ?? vessel.speed_kn,
      block_coefficient: block ?? vessel.block_coefficient,
    },
    tonnage: tonnage ?? vessel.gross_tonnage,
    boarding: boarding.instant,
  };
}

/** The clerk reads no plan or windows. */
function refusePlanReader(user: UserRecord): void {
  if (user.role === 'clerk') throw forbidden();
}

export function buildRoutes(app: App): Route[] {
  const routes: Route[] = [];

  routes.push({
    auth: 'public',
    method: 'GET',
    pattern: '/api/health',
    handle: (): Reply => ({ status: 200, json: { status: 'ok' } }),
  });

  routes.push({
    auth: 'public',
    method: 'GET',
    pattern: '/api/port',
    handle: (): Reply => {
      const state = app.store.read();
      return {
        status: 200,
        json: {
          port: 'Port Ansell',
          zone: 'America/Halifax',
          now: formatInstantSeconds(Date.now()),
          store_date: state.store_date,
          tide_version: state.tide_version,
          step_minutes: 5,
          waypoints: ROUTE.map((waypoint) => ({ ...waypoint })),
        },
      };
    },
  });

  routes.push({
    auth: 'session',
    method: 'GET',
    pattern: '/api/services',
    handle: async (): Promise<Reply> => ({ status: 200, json: await app.services.snapshot() }),
  });

  routes.push({
    auth: 'public',
    method: 'POST',
    pattern: '/api/session',
    body: 'json',
    handle: (context: PublicContext): Reply => {
      const fields = asRecord(context.body);
      const email = typeof fields.email === 'string' ? fields.email : '';
      const password = typeof fields.password === 'string' ? fields.password : '';
      const user = userByEmail(app.store.read(), email);
      if (user === undefined || user.password !== password) {
        throw new ApiError(401, 'invalid_credentials', 'Email or password is incorrect');
      }
      const token = newSessionToken();
      app.store.mutate((state) => {
        state.sessions.push({
          token,
          user_id: user.id,
          created_at: formatInstantSeconds(Date.now()),
        });
      });
      context.setSession(token);
      return sessionUserJson(user);
    },
  });

  routes.push({
    auth: 'session',
    method: 'GET',
    pattern: '/api/session',
    handle: (context: RequestContext): Reply => sessionUserJson(context.user),
  });

  routes.push({
    auth: 'session',
    method: 'DELETE',
    pattern: '/api/session',
    handle: (context: RequestContext): Reply => {
      app.store.mutate((state) => {
        state.sessions = state.sessions.filter((entry) => entry.user_id !== context.user.id);
      });
      context.setSession(null);
      return { status: 204 };
    },
  });

  routes.push({
    auth: 'session',
    method: 'GET',
    pattern: '/api/vessels',
    handle: (context: RequestContext): Reply => {
      if (context.user.role === 'clerk') throw forbidden();
      const state = app.store.read();
      return {
        status: 200,
        json: {
          vessels: state.vessels
            .filter((vessel) => canReadVessel(context.user, vessel))
            .map((vessel) => vesselView(vessel, state)),
        },
      };
    },
  });

  routes.push({
    auth: 'session',
    method: 'POST',
    pattern: '/api/plan',
    body: 'json',
    handle: (context: RequestContext): Reply => {
      if (context.user.role !== 'agent' && context.user.role !== 'dispatcher') throw forbidden();
      const state = app.store.read();
      const planning = planningSubjectFromBody(app, context.user, context.body);
      const plan = computePlan(tideTableOf(state), planning.subject, planning.boarding);
      return {
        status: 200,
        json: planView(state, plan, { gross_tonnage: planning.tonnage }, planning.boarding),
      };
    },
  });

  routes.push({
    auth: 'session',
    method: 'GET',
    pattern: '/api/moves',
    handle: (context: RequestContext): Reply => {
      const state = app.store.read();
      const query = context.url.searchParams.get('q') ?? '';
      const status = context.url.searchParams.get('status');
      const now = Date.now();
      const moves = visibleMovesInBoardingOrder(state, context.user)
        .filter((move) => matchesSearch(state, move, query))
        .filter((move) => status === null || move.status === status)
        .map((move) => moveView(state, move, context.user, now));
      return { status: 200, json: { moves } };
    },
  });

  routes.push({
    auth: 'session',
    method: 'GET',
    pattern: '/api/exports/moves.csv',
    handle: (context: RequestContext): Reply => ({
      status: 200,
      bytes: Buffer.from(movesExportCsv(app, context.user), 'utf8'),
      contentType: 'text/csv; charset=utf-8',
      headers: { 'content-disposition': 'attachment; filename="moves.csv"' },
    }),
  });

  routes.push({
    auth: 'session',
    method: 'POST',
    pattern: '/api/moves',
    body: 'json',
    keyed: true,
    handle: (context: RequestContext): Reply => createMove(app, context.user, context.body),
  });

  routes.push({
    auth: 'session',
    method: 'GET',
    pattern: '/api/moves/:ref',
    handle: (context: RequestContext): Reply => {
      const move = moveOr404(app, context.user, context.params.ref as string);
      return {
        status: 200,
        json: moveView(app.store.read(), move, context.user, Date.now()),
        headers: { etag: `"${move.version}"` },
      };
    },
  });

  routes.push({
    auth: 'session',
    method: 'PATCH',
    pattern: '/api/moves/:ref',
    body: 'json',
    handle: (context: RequestContext): Reply => {
      const move = moveOr404(app, context.user, context.params.ref as string);
      return amendMove(app, context.user, move, context.body, context.headers['if-match']);
    },
  });

  routes.push({
    auth: 'session',
    method: 'POST',
    pattern: '/api/moves/:ref/cancel',
    body: 'json',
    keyed: true,
    handle: (context: RequestContext): Reply => {
      const move = moveOr404(app, context.user, context.params.ref as string);
      return cancelMove(app, context.user, move);
    },
  });

  routes.push({
    auth: 'session',
    method: 'POST',
    pattern: '/api/moves/:ref/reorder',
    body: 'json',
    handle: (context: RequestContext): Reply => {
      const move = moveOr404(app, context.user, context.params.ref as string);
      return reorderMove(app, context.user, move, context.body);
    },
  });

  routes.push({
    auth: 'session',
    method: 'GET',
    pattern: '/api/moves/:ref/plan',
    handle: (context: RequestContext): Reply => {
      const move = moveOr404(app, context.user, context.params.ref as string);
      refusePlanReader(context.user);
      const state = app.store.read();
      const requested = context.url.searchParams.get('boarding_at');
      let boarding = moveBoardingInstant(move);
      if (requested !== null) {
        const wall = parsePortDateTime(requested);
        const instant = wall === null ? null : wallToInstant(wall);
        if (instant === null) {
          throw invalid({ boarding_at: 'That time does not exist in port time on this date' });
        }
        boarding = instant;
      }
      const plan = planForMove(state, move, boarding);
      return {
        status: 200,
        json: planView(state, plan, { gross_tonnage: move.gross_tonnage }, boarding),
      };
    },
  });

  routes.push({
    auth: 'session',
    method: 'GET',
    pattern: '/api/moves/:ref/windows',
    handle: (context: RequestContext): Reply => {
      const move = moveOr404(app, context.user, context.params.ref as string);
      refusePlanReader(context.user);
      const state = app.store.read();
      const dateText = context.url.searchParams.get('date');
      const date = dateText === null ? null : parsePortDate(dateText);
      if (date === null) throw invalid({ date: 'A date of the form YYYY-MM-DD is required' });
      return {
        status: 200,
        json: {
          date: dateText,
          tide_version: state.tide_version,
          windows: openWindows(tideTableOf(state), planSubjectOf(move), date),
        },
      };
    },
  });

  routes.push({
    auth: 'session',
    method: 'POST',
    pattern: '/api/moves/:ref/commit',
    body: 'json',
    handle: (context: RequestContext): Reply => {
      const move = moveOr404(app, context.user, context.params.ref as string);
      return commitWindow(app, context.user, move, context.body, context.headers['if-match']);
    },
  });

  routes.push({
    auth: 'session',
    method: 'GET',
    pattern: '/api/moves/:ref/eligibility',
    handle: (context: RequestContext): Reply => {
      const move = moveOr404(app, context.user, context.params.ref as string);
      return readEligibility(app, context.user, move);
    },
  });

  routes.push({
    auth: 'session',
    method: 'POST',
    pattern: '/api/moves/:ref/assignment',
    body: 'json',
    keyed: true,
    handle: (context: RequestContext): Reply => {
      const move = moveOr404(app, context.user, context.params.ref as string);
      return assignPilot(app, context.user, move, context.body, context.headers['if-match']);
    },
  });

  routes.push({
    auth: 'session',
    method: 'POST',
    pattern: '/api/moves/:ref/transitions',
    body: 'json',
    keyed: true,
    handle: (context: RequestContext): Reply => {
      const move = moveOr404(app, context.user, context.params.ref as string);
      return pilotTransition(app, context.user, move, context.body);
    },
  });

  routes.push({
    auth: 'session',
    method: 'POST',
    pattern: '/api/moves/:ref/detention',
    body: 'json',
    keyed: true,
    handle: (context: RequestContext): Reply => {
      const move = moveOr404(app, context.user, context.params.ref as string);
      return detentionAction(app, context.user, move, context.body);
    },
  });

  routes.push({
    auth: 'session',
    method: 'POST',
    pattern: '/api/moves/:ref/photos',
    handle: async (context: RequestContext): Promise<Reply> => {
      const move = moveOr404(app, context.user, context.params.ref as string);
      storagePhotoLimits(context.headers['content-length']);
      const contentType = declaredPhotoType(context.headers['content-type']);
      const body = await context.readBytes(PHOTO_LIMIT_BYTES);
      return storePhoto(app, context.user, move, contentType, body);
    },
  });

  routes.push({
    auth: 'session',
    method: 'GET',
    pattern: '/api/photos/:id/content',
    handle: async (context: RequestContext): Promise<Reply> => {
      const photoId = context.params.id as string;
      if (!canReadPhoto(app, context.user, photoId)) throw notFound();
      const photo = app.store.read().photos.find((entry) => entry.id === photoId);
      if (photo === undefined) throw notFound();
      try {
        const stored = await app.objectStore.get(photo.key);
        return {
          status: 200,
          bytes: stored.body,
          contentType: photo.content_type,
          headers: { 'x-checksum-sha256': photo.sha256 },
        };
      } catch {
        throw storageUnavailable();
      }
    },
  });

  routes.push({
    auth: 'session',
    method: 'POST',
    pattern: '/api/moves/:ref/ladder-reports',
    body: 'json',
    keyed: true,
    handle: (context: RequestContext): Reply => {
      const move = moveOr404(app, context.user, context.params.ref as string);
      return fileLadderReport(app, context.user, move, context.body);
    },
  });

  routes.push({
    auth: 'session',
    method: 'GET',
    pattern: '/api/ladder-reports/:id',
    handle: (context: RequestContext): Reply => {
      const state = app.store.read();
      const report = state.ladder_reports.find((entry) => entry.id === context.params.id);
      if (report === undefined) throw notFound();
      moveOr404(app, context.user, report.move_ref);
      return { status: 200, json: reportView(state, report) };
    },
  });

  routes.push({
    auth: 'session',
    method: 'POST',
    pattern: '/api/vessels/:id/pilot-cards',
    handle: async (context: RequestContext): Promise<Reply> => {
      const vessel = vesselOr404(app, context.user, context.params.id as string);
      const declared = Number(context.headers['content-length'] ?? '0');
      if (declared > CARD_LIMIT_BYTES) throw payloadTooLarge();
      declaredPdfType(context.headers['content-type']);
      const body = await context.readBytes(CARD_LIMIT_BYTES);
      return storePilotCard(app, context.user, vessel, body);
    },
  });

  routes.push({
    auth: 'session',
    method: 'GET',
    pattern: '/api/vessels/:id/pilot-cards/:cardId/content',
    handle: async (context: RequestContext): Promise<Reply> => {
      const state = app.store.read();
      const vessel = vesselOr404(app, context.user, context.params.id as string);
      const card = state.pilot_cards.find(
        (entry) => entry.card_id === context.params.cardId && entry.vessel_id === vessel.id,
      );
      if (card === undefined) throw notFound();
      if (context.user.role === 'pilot') {
        const pilot = pilotOfUser(state, context.user);
        const assigned = state.moves.some(
          (move) => move.vessel_id === vessel.id && move.pilot_id === (pilot?.id ?? ''),
        );
        if (!assigned) throw forbidden();
      }
      try {
        const stored = await app.objectStore.get(card.key);
        return {
          status: 200,
          bytes: stored.body,
          contentType: 'application/pdf',
          headers: { 'x-checksum-sha256': card.sha256 },
        };
      } catch {
        throw storageUnavailable();
      }
    },
  });

  routes.push({
    auth: 'session',
    method: 'GET',
    pattern: '/api/tide',
    handle: (context: RequestContext): Reply => {
      const state = app.store.read();
      const dateText = context.url.searchParams.get('date') ?? dateKeyAt(Date.now());
      if (parsePortDate(dateText) === null) {
        throw invalid({ date: 'A date of the form YYYY-MM-DD is required' });
      }
      const revision = state.tide_revisions.find((entry) => entry.date === dateText);
      return {
        status: 200,
        json: {
          date: dateText,
          version: state.tide_version,
          events: revision === undefined ? STANDARD_DAY.map((event) => ({ ...event })) : revision.events,
        },
      };
    },
  });

  routes.push({
    auth: 'session',
    method: 'POST',
    pattern: '/api/tide-revisions',
    body: 'json',
    handle: (context: RequestContext): Reply =>
      publishTideRevision(app, context.user, context.body),
  });

  routes.push({
    auth: 'session',
    method: 'GET',
    pattern: '/api/pilots',
    handle: (context: RequestContext): Reply => {
      if (context.user.role !== 'dispatcher') throw forbidden();
      const state = app.store.read();
      const now = Date.now();
      const pilots = state.turn_order.map((pilotId, index) => {
        const pilot = state.pilots.find((entry) => entry.id === pilotId);
        const duties = dutiesOfPilot(state, pilotId);
        const available = nextAvailableInstant(duties);
        return {
          id: pilotId,
          name: pilot?.name ?? pilotId,
          licence_class: pilot?.licence_class ?? 'C',
          position: index + 1,
          on_duty: duties.some((duty) => duty.start <= now && duty.end >= now),
          rest_until: available === null ? null : formatInstantSeconds(available),
        };
      });
      return { status: 200, json: { pilots } };
    },
  });

  routes.push({
    auth: 'session',
    method: 'GET',
    pattern: '/api/me/next-job',
    handle: (context: RequestContext): Reply => {
      if (context.user.role !== 'pilot') throw forbidden();
      const state = app.store.read();
      const pilot = pilotOfUser(state, context.user);
      const current = state.moves
        .filter(
          (move) =>
            move.pilot_id === (pilot?.id ?? '') &&
            (move.status === 'Pilot assigned' ||
              move.status === 'Pilot away' ||
              move.status === 'On board'),
        )
        .sort((left, right) => moveBoardingInstant(left) - moveBoardingInstant(right))[0];
      if (current === undefined) return { status: 200, json: { move: null, plan: null } };
      const boarding = moveBoardingInstant(current);
      const plan = planForMove(state, current, boarding);
      return {
        status: 200,
        json: {
          move: moveView(state, current, context.user, Date.now()),
          plan: planView(state, plan, { gross_tonnage: current.gross_tonnage }, boarding),
        },
      };
    },
  });

  routes.push({
    auth: 'session',
    method: 'GET',
    pattern: '/api/skips',
    handle: (context: RequestContext): Reply => {
      if (context.user.role !== 'dispatcher') throw forbidden();
      return { status: 200, json: { skips: app.store.read().skips } };
    },
  });

  routes.push({
    auth: 'session',
    method: 'GET',
    pattern: '/api/overrides',
    handle: (context: RequestContext): Reply => {
      if (context.user.role !== 'dispatcher') throw forbidden();
      return { status: 200, json: { overrides: app.store.read().rest_overrides } };
    },
  });

  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    routes.push({
      auth: 'session',
      method,
      pattern: '/api/overrides/:id',
      handle: (): Reply => {
        throw new ApiError(405, 'method_not_allowed', 'A rest override cannot be altered');
      },
    });
  }

  routes.push({
    auth: 'session',
    method: 'GET',
    pattern: '/api/tariff-revisions',
    handle: (context: RequestContext): Reply => listTariffRevisions(app, context.user),
  });

  routes.push({
    auth: 'session',
    method: 'POST',
    pattern: '/api/tariff-revisions',
    body: 'json',
    handle: (context: RequestContext): Reply =>
      publishTariffRevision(app, context.user, context.body),
  });

  routes.push({
    auth: 'session',
    method: 'GET',
    pattern: '/api/invoices',
    handle: async (context: RequestContext): Promise<Reply> => {
      if (context.user.role !== 'clerk' && context.user.role !== 'agent') throw forbidden();
      const state = app.store.read();
      const invoices = state.invoices.filter(
        (invoice) =>
          context.user.role === 'clerk' || invoice.agency_code === context.user.agency_code,
      );
      for (const invoice of invoices) await refreshInvoiceBalance(app, invoice);
      return { status: 200, json: { invoices: invoices.map(invoiceView) } };
    },
  });

  routes.push({
    auth: 'session',
    method: 'GET',
    pattern: '/api/invoices/:id',
    handle: async (context: RequestContext): Promise<Reply> => {
      const invoice = invoiceOrNotFound(app, context.user, context.params.id as string);
      await refreshInvoiceBalance(app, invoice);
      return { status: 200, json: invoiceView(invoice) };
    },
  });

  routes.push({
    auth: 'session',
    method: 'POST',
    pattern: '/api/invoices/:id/issue',
    body: 'json',
    keyed: true,
    handle: async (context: RequestContext): Promise<Reply> => {
      const invoice = invoiceOrNotFound(app, context.user, context.params.id as string);
      return issueInvoice(app, context.user, invoice);
    },
  });

  return routes;
}
