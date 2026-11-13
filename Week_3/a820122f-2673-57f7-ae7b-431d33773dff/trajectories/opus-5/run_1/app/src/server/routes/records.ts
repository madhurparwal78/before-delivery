import { ValidationError, fail } from '../http/errors.js';
import {
  requireOwner,
  requireSession,
  requireVisibleCrew,
  route,
  sendJson,
} from '../http/router.js';
import { queryAlignedInstant, queryInstant, queryShipDate } from '../http/validate.js';
import * as store from '../db/store.js';
import { shipDayBounds, shipDateOf } from '../domain/ship-time.js';
import { shipDayStatus } from '../domain/day-state.js';
import { judgeWindow, type RuleSetName } from '../domain/rest-rules.js';
import { ruleSetAt } from '../domain/rule-sets.js';
import {
  HALF_HOUR_MS,
  HOUR_MS,
  formatInstant,
  monthOfShipDate,
  parseShipDate,
  shipDateRange,
} from '../domain/time.js';
import {
  STRIP_HOURS,
  buildStrip,
  computeWindowFor,
  dayDetail,
  loadCrewContext,
  recordBreachesFrom,
  stripStartDefault,
} from '../services/crew-records.js';

function requireShipDateParam(value: string): string {
  if (parseShipDate(value) === null) {
    throw new ValidationError({ ship_date: "A ship's date needs the form 2026-09-10." });
  }
  return value;
}

function requireShipDateList(body: Record<string, unknown>): string[] {
  const raw = body['ship_dates'];
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ValidationError({ ship_dates: "Choose at least one ship's date." });
  }
  const dates: string[] = [];
  for (const value of raw) {
    if (typeof value !== 'string' || parseShipDate(value) === null) {
      throw new ValidationError({ ship_dates: "Each ship's date needs the form 2026-09-10." });
    }
    dates.push(value);
  }
  return dates;
}

export function registerRecordRoutes(): void {
  route('GET', '/api/crew/:crewId/days', 'session', async (context) => {
    const crew = await requireVisibleCrew(context);
    const from = queryShipDate(context.query, 'from', 'A first date');
    const to = queryShipDate(context.query, 'to', 'A last date');
    if (from === null || to === null) {
      throw new ValidationError({ from: "Choose the ship's dates to show." });
    }
    if (to < from) throw new ValidationError({ to: 'The last date comes before the first.' });
    const dates = shipDateRange(from, to);
    if (dates.length > 62) {
      throw new ValidationError({ to: 'Ask for at most 62 days at a time.' });
    }
    const vessel = (await store.findVesselById(crew.vesselId)) as store.Vessel;
    const clock = await store.loadVesselClock(vessel);
    const signatures = await store.listSignatures(crew.id, from, to);
    sendJson(context.res, 200, {
      server_now_utc: formatInstant(context.nowMs),
      days: dates.map((shipDate) => {
        const status = shipDayStatus(
          shipDayBounds(clock, shipDate),
          signatures.get(shipDate) ?? null,
          context.nowMs,
        );
        return {
          ship_date: shipDate,
          state: status.state,
          closes_at_utc: formatInstant(status.closesAtMs),
          can_edit: status.canEdit,
        };
      }),
    });
  });

  route('GET', '/api/crew/:crewId/days/:shipDate', 'session', async (context) => {
    const crew = await requireVisibleCrew(context);
    const shipDate = requireShipDateParam(context.params['shipDate'] as string);
    const vessel = (await store.findVesselById(crew.vesselId)) as store.Vessel;
    const clock = await store.loadVesselClock(vessel);
    const bounds = shipDayBounds(clock, shipDate);
    const crewContext = await loadCrewContext(crew, bounds.startMs, bounds.endMs);
    sendJson(context.res, 200, await dayDetail(crewContext, shipDate, context.nowMs));
  });

  route('GET', '/api/crew/:crewId/rolling', 'session', async (context) => {
    const crew = await requireVisibleCrew(context);
    const asOf =
      queryAlignedInstant(context.query, 'as_of', 'A time') ??
      Math.floor(context.nowMs / HALF_HOUR_MS) * HALF_HOUR_MS;
    const crewContext = await loadCrewContext(crew, asOf - 168 * HOUR_MS, asOf);
    const window24 = computeWindowFor(crewContext, asOf - 24 * HOUR_MS, 24);
    const window168 = computeWindowFor(crewContext, asOf - 168 * HOUR_MS, 168);
    await recordBreachesFrom(crew.id, [window24, window168], context.nowMs);
    sendJson(context.res, 200, {
      as_of_utc: formatInstant(asOf),
      rest_hours_24: window24.rest_hours,
      rest_hours_168: window168.rest_hours,
      verdict_24: window24.verdict,
      verdict_168: window168.verdict,
    });
  });

  route('GET', '/api/crew/:crewId/strip', 'session', async (context) => {
    const crew = await requireVisibleCrew(context);
    const requested = queryAlignedInstant(context.query, 'start', 'A start');
    const startMs =
      requested ?? stripStartDefault(await store.latestLoggedCellEnd(crew.id), context.nowMs);
    const crewContext = await loadCrewContext(crew, startMs, startMs + STRIP_HOURS * HOUR_MS);
    const strip = buildStrip(crewContext, startMs);
    await recordBreachesFrom(
      crew.id,
      [...strip.windows['24'], ...strip.windows['168']],
      context.nowMs,
    );
    sendJson(context.res, 200, strip);
  });

  route('GET', '/api/crew/:crewId/window', 'session', async (context) => {
    const crew = await requireVisibleCrew(context);
    const startMs = queryAlignedInstant(context.query, 'start', 'A start');
    if (startMs === null) throw new ValidationError({ start: 'Choose where the window starts.' });
    const hoursRaw = context.query.get('hours');
    if (hoursRaw !== '24' && hoursRaw !== '168') {
      throw new ValidationError({ hours: 'A window is either 24 or 168 hours long.' });
    }
    const hours = hoursRaw === '24' ? 24 : 168;
    const crewContext = await loadCrewContext(crew, startMs, startMs + hours * HOUR_MS);
    const window = computeWindowFor(crewContext, startMs, hours);
    await recordBreachesFrom(crew.id, [window], context.nowMs);
    sendJson(context.res, 200, window);
  });

  route('GET', '/api/crew/:crewId/breaches', 'session', async (context) => {
    const crew = await requireVisibleCrew(context);
    const fromMs = queryInstant(context.query, 'from', 'A first instant');
    const toMs = queryInstant(context.query, 'to', 'A last instant');
    const breaches = await store.listBreaches(crew.id, fromMs, toMs);
    if (breaches.length === 0) {
      sendJson(context.res, 200, { breaches: [] });
      return;
    }
    const earliest = Math.min(...breaches.map((breach) => breach.windowStartMs));
    const latest = Math.max(
      ...breaches.map((breach) => breach.windowStartMs + breach.windowHours * HOUR_MS),
    );
    const crewContext = await loadCrewContext(crew, earliest, latest);
    const ruleSets = crewContext.ruleSets;
    sendJson(context.res, 200, {
      breaches: breaches.map((breach) => {
        const endMs = breach.windowStartMs + breach.windowHours * HOUR_MS;
        const ruleSet: RuleSetName = ruleSetAt(ruleSets, endMs);
        const judgement = judgeWindow(
          crewContext.timeline,
          breach.windowStartMs,
          breach.windowHours,
          ruleSet,
        );
        return {
          id: breach.id,
          rule: breach.rule,
          window_hours: breach.windowHours,
          window_start_utc: formatInstant(breach.windowStartMs),
          window_end_utc: formatInstant(endMs),
          rule_set: breach.ruleSet,
          rest_hours: breach.restHours,
          recorded_at_utc: formatInstant(breach.recordedAtMs),
          still_breaching: judgement.rulesFailed.includes(breach.rule),
        };
      }),
    });
  });

  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
    route(method, '/api/crew/:crewId/breaches', 'none', async () => {
      fail(405, 'breach_permanent');
    });
    route(method, '/api/crew/:crewId/breaches/:breachId', 'none', async () => {
      fail(405, 'breach_permanent');
    });
  }
  route('GET', '/api/crew/:crewId/breaches/:breachId', 'none', async () => {
    fail(405, 'breach_permanent');
  });

  route('POST', '/api/crew/:crewId/days/:shipDate/notes', 'session', async (context) => {
    const crew = await requireVisibleCrew(context);
    const session = requireSession(context);
    const shipDate = requireShipDateParam(context.params['shipDate'] as string);
    const body = context.json();
    const month = await store.findMonth(crew.id, monthOfShipDate(shipDate));
    if (month.state === 'sealed') fail(409, 'month_sealed');
    const text = body['text'];
    if (typeof text !== 'string' || text.length < 1 || text.length > 2000) {
      throw new ValidationError({ text: 'A note needs between 1 and 2,000 characters.' });
    }
    const eventIdRaw = body['event_id'];
    let eventId: string | null = null;
    if (eventIdRaw !== undefined && eventIdRaw !== null && eventIdRaw !== '') {
      const events = await store.listEventsForCrew(crew.id);
      const vessel = (await store.findVesselById(crew.vesselId)) as store.Vessel;
      const clock = await store.loadVesselClock(vessel);
      const event = events.find((item) => item.id === eventIdRaw);
      if (event === undefined || shipDateOf(clock, event.startMs) !== shipDate) {
        throw new ValidationError({ event_id: 'That drill or call-out is not on this day.' });
      }
      eventId = event.id;
    }
    const note = {
      id: store.newId('note'),
      crewId: crew.id,
      shipDate,
      text,
      eventId,
      authorRole: session.role,
      createdAtMs: context.nowMs,
      authorId: session.personId,
    };
    await store.insertNote(note);
    sendJson(context.res, 201, {
      id: note.id,
      ship_date: shipDate,
      text,
      event_id: eventId,
      author_role: session.role,
      created_at_utc: formatInstant(context.nowMs),
    });
  });

  route('POST', '/api/crew/:crewId/days/sign', 'session', async (context) => {
    const crew = await requireVisibleCrew(context);
    const session = requireSession(context);
    if (session.role !== 'crew' || session.personId !== crew.id) fail(403, 'forbidden');
    const dates = requireShipDateList(context.json());
    const vessel = (await store.findVesselById(crew.vesselId)) as store.Vessel;
    const clock = await store.loadVesselClock(vessel);
    for (const shipDate of dates) {
      const signature = await store.findSignature(crew.id, shipDate);
      const status = shipDayStatus(shipDayBounds(clock, shipDate), signature, context.nowMs);
      if (status.state === 'open') fail(409, 'day_not_closed', { ship_date: shipDate });
      if (status.state !== 'closed') fail(409, 'already_signed', { ship_date: shipDate });
    }
    const days: { ship_date: string; state: string }[] = [];
    for (const shipDate of dates) {
      const signed = await store.signDay(crew.id, shipDate, context.nowMs);
      if (!signed) fail(409, 'already_signed', { ship_date: shipDate });
      days.push({ ship_date: shipDate, state: 'signed' });
    }
    sendJson(context.res, 200, { days });
  });

  route('POST', '/api/crew/:crewId/days/countersign', 'session', async (context) => {
    const crew = await requireVisibleCrew(context);
    requireOwner(context);
    const dates = requireShipDateList(context.json());
    const vessel = (await store.findVesselById(crew.vesselId)) as store.Vessel;
    const clock = await store.loadVesselClock(vessel);
    for (const shipDate of dates) {
      const signature = await store.findSignature(crew.id, shipDate);
      const status = shipDayStatus(shipDayBounds(clock, shipDate), signature, context.nowMs);
      if (status.state === 'countersigned') {
        fail(409, 'already_countersigned', { ship_date: shipDate });
      }
      if (status.state !== 'signed') fail(409, 'day_not_signed', { ship_date: shipDate });
    }
    const days: { ship_date: string; state: string }[] = [];
    for (const shipDate of dates) {
      const countersigned = await store.countersignDay(crew.id, shipDate, context.nowMs);
      if (!countersigned) fail(409, 'already_countersigned', { ship_date: shipDate });
      days.push({ ship_date: shipDate, state: 'countersigned' });
    }
    sendJson(context.res, 200, { days });
  });
}
