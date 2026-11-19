import { ValidationError, fail } from '../http/errors.js';
import {
  requireOwnedVessel,
  requireOwner,
  requireVisibleVessel,
  route,
  sendJson,
} from '../http/router.js';
import {
  queryShipDate,
  requireAlignedInstant,
  requireChoice,
  requireClockTime,
  requireDegrees,
  requireEmail,
  requirePasscode,
  requireShipDateField,
  requireText,
  requireWholeNumber,
} from '../http/validate.js';
import * as store from '../db/store.js';
import { hashPasscode } from '../services/passcodes.js';
import { checkClockChange } from '../domain/clock-change.js';
import {
  clockChangeKind,
  clockChangeLabel,
  nauticalZone,
  offsetAt,
  shipDayBounds,
  shipDateOf,
  zoneWarning,
  type VesselClock,
} from '../domain/ship-time.js';
import { MAX_FLAG_EXCEPTION_HOURS, periodsOverlap } from '../domain/rule-sets.js';
import { planRota } from '../domain/rota.js';
import { HOUR_MS, formatInstant, monthOfShipDate, shipDateRange } from '../domain/time.js';
import { eventPayload, loadCrewContext } from '../services/crew-records.js';

const VESSEL_LIMIT = 4;

async function monthSealedForVessel(vesselId: string, month: string): Promise<boolean> {
  const crew = await store.listCrewByVessel(vesselId);
  for (const member of crew) {
    const state = await store.findMonth(member.id, month);
    if (state.state === 'sealed') return true;
  }
  return false;
}

async function requireVesselCrew(vesselId: string, body: Record<string, unknown>): Promise<store.Crew> {
  const crewId = body['crew_id'];
  if (typeof crewId !== 'string' || crewId === '') {
    throw new ValidationError({ crew_id: 'Choose a crew member.' });
  }
  const crew = await store.findCrewById(crewId);
  if (crew === null || crew.vesselId !== vesselId) {
    throw new ValidationError({ crew_id: 'That crew member is not on this vessel.' });
  }
  return crew;
}

export function registerFleetRoutes(): void {
  route('GET', '/api/vessels', 'session', async (context) => {
    const ownerId = requireOwner(context);
    const vessels = await store.listVesselsByOwner(ownerId);
    const payload = await Promise.all(
      vessels.map(async (vessel) => ({
        id: vessel.id,
        name: vessel.name,
        kind: vessel.kind,
        current_offset_minutes: offsetAt(await store.loadVesselClock(vessel), context.nowMs),
      })),
    );
    sendJson(context.res, 200, { vessels: payload });
  });

  route('POST', '/api/vessels', 'session', async (context) => {
    const ownerId = requireOwner(context);
    const body = context.json();
    const name = requireText(body, 'name', 'A vessel name', 1, 120);
    const kind = requireChoice(body, 'kind', 'A vessel type', [
      'workboat',
      'survey_boat',
      'coaster',
      'charter_yacht',
    ] as const);
    const offset = requireWholeNumber(body, 'initial_offset_minutes', 'The starting offset');
    if (offset % 30 !== 0 || offset < -720 || offset > 840) {
      throw new ValidationError({
        initial_offset_minutes:
          'A ship keeps a whole or half hour offset between -720 and 840 minutes from UTC.',
      });
    }
    const id = store.newId('vessel');
    if (!(await store.insertVesselWithinLimit(id, ownerId, name, kind, offset, VESSEL_LIMIT))) {
      fail(409, 'vessel_limit');
    }
    sendJson(context.res, 201, {
      id,
      name,
      kind,
      current_offset_minutes: offset,
    });
  });

  route('GET', '/api/vessels/:vesselId/crew', 'session', async (context) => {
    const vessel = await requireVisibleVessel(context);
    const crew = await store.listCrewByVessel(vessel.id);
    sendJson(context.res, 200, {
      crew: crew.map((member) => ({
        id: member.id,
        name: member.name,
        rank: member.rank,
        email: member.email,
      })),
    });
  });

  route('POST', '/api/vessels/:vesselId/crew', 'session', async (context) => {
    const vessel = await requireOwnedVessel(context);
    const body = context.json();
    const name = requireText(body, 'name', 'A crew name', 1, 120);
    const rank = requireText(body, 'rank', 'A rank', 1, 120);
    const email = requireEmail(body, 'email');
    const passcode = requirePasscode(body, 'passcode');
    if (await store.emailTaken(email)) fail(409, 'email_taken');
    const id = store.newId('crew');
    if (!(await store.insertCrew(id, vessel.id, name, rank, email, hashPasscode(passcode)))) {
      fail(409, 'email_taken');
    }
    sendJson(context.res, 201, { id, name, rank, email });
  });

  route('GET', '/api/vessels/:vesselId/clock-changes', 'session', async (context) => {
    const vessel = await requireVisibleVessel(context);
    const clock = await store.loadVesselClock(vessel);
    sendJson(context.res, 200, {
      clock_changes: clock.changes.map((change) => ({
        id: change.id,
        changes_at_utc: formatInstant(change.changesAtMs),
        old_offset_minutes: change.oldOffsetMinutes,
        new_offset_minutes: change.newOffsetMinutes,
        kind: clockChangeKind(change),
        label: clockChangeLabel(change),
        ship_date: shipDateOf(clock, change.changesAtMs),
        ship_date_cells: shipDayBounds(clock, shipDateOf(clock, change.changesAtMs)).cellCount,
        fix_id: change.fixId,
        nautical_zone: nauticalZone(change.longitude),
        zone_warning: zoneWarning(change.newOffsetMinutes, change.longitude),
      })),
    });
  });

  route('POST', '/api/vessels/:vesselId/clock-changes', 'session', async (context) => {
    const vessel = await requireOwnedVessel(context);
    const body = context.json();
    const changesAtMs = requireAlignedInstant(body, 'changes_at_utc', 'The change time');
    const newOffsetMinutes = requireWholeNumber(body, 'new_offset_minutes', 'The new offset');
    const latitude = requireDegrees(body, 'latitude', 'A latitude', 90);
    const longitude = requireDegrees(body, 'longitude', 'A longitude', 180);
    const clock = await store.loadVesselClock(vessel);
    const provisionalShipDate = shipDateOf(clock, changesAtMs);
    if (await monthSealedForVessel(vessel.id, monthOfShipDate(provisionalShipDate))) {
      fail(409, 'month_sealed');
    }
    const { oldOffsetMinutes, shipDate } = checkClockChange(clock, changesAtMs, newOffsetMinutes);

    const existingFix = await store.findFixAt(vessel.id, changesAtMs);
    let fixId = existingFix?.id ?? null;
    if (fixId === null) {
      fixId = store.newId('fix');
      await store.insertFix(fixId, vessel.id, changesAtMs, latitude, longitude);
    }
    const id = store.newId('clock');
    await store.insertClockChange(
      id,
      vessel.id,
      changesAtMs,
      oldOffsetMinutes,
      newOffsetMinutes,
      latitude,
      longitude,
      fixId,
    );
    const updated = await store.loadVesselClock(vessel);
    const change = updated.changes.find((item) => item.changesAtMs === changesAtMs) as NonNullable<
      VesselClock['changes'][number]
    >;
    sendJson(context.res, 201, {
      id: change.id,
      changes_at_utc: formatInstant(changesAtMs),
      old_offset_minutes: oldOffsetMinutes,
      new_offset_minutes: newOffsetMinutes,
      kind: clockChangeKind(change),
      label: clockChangeLabel(change),
      ship_date: shipDate,
      ship_date_cells: shipDayBounds(updated, shipDate).cellCount,
      fix_id: fixId,
      nautical_zone: nauticalZone(longitude),
      zone_warning: zoneWarning(newOffsetMinutes, longitude),
    });
  });

  route('GET', '/api/vessels/:vesselId/fixes', 'session', async (context) => {
    const vessel = await requireVisibleVessel(context);
    const fixes = await store.listFixes(vessel.id);
    sendJson(context.res, 200, {
      fixes: fixes.map((fix) => ({
        id: fix.id,
        at_utc: formatInstant(fix.atMs),
        latitude: fix.latitude,
        longitude: fix.longitude,
      })),
    });
  });

  route('POST', '/api/vessels/:vesselId/fixes', 'session', async (context) => {
    const vessel = await requireOwnedVessel(context);
    const body = context.json();
    const atMs = requireAlignedInstant(body, 'at_utc', 'The fix time');
    const latitude = requireDegrees(body, 'latitude', 'A latitude', 90);
    const longitude = requireDegrees(body, 'longitude', 'A longitude', 180);
    const id = store.newId('fix');
    const stored = await store.insertFix(id, vessel.id, atMs, latitude, longitude);
    if (!stored) {
      throw new ValidationError({ at_utc: 'This vessel already has a fix at that instant.' });
    }
    sendJson(context.res, 201, {
      id,
      at_utc: formatInstant(atMs),
      latitude,
      longitude,
    });
  });

  route('POST', '/api/vessels/:vesselId/rota-watches', 'session', async (context) => {
    const vessel = await requireOwnedVessel(context);
    const body = context.json();
    const crew = await requireVesselCrew(vessel.id, body);
    const label = requireText(body, 'label', 'A watch name', 1, 120);
    const startTime = requireClockTime(body, 'start_time', 'A start time');
    const endTime = requireClockTime(body, 'end_time', 'An end time');
    const fromDate = requireShipDateField(body, 'from_date', "The first ship's date");
    const toDate = requireShipDateField(body, 'to_date', "The last ship's date");
    if (toDate < fromDate) {
      throw new ValidationError({ to_date: "The last ship's date comes before the first." });
    }
    const id = store.newId('watch');
    await store.insertRotaWatch({
      id,
      vesselId: vessel.id,
      crewId: crew.id,
      label,
      startTime,
      endTime,
      fromDate,
      toDate,
    });
    sendJson(context.res, 201, {
      id,
      crew_id: crew.id,
      label,
      start_time: startTime,
      end_time: endTime,
      from_date: fromDate,
      to_date: toDate,
    });
  });

  route('GET', '/api/vessels/:vesselId/rota', 'session', async (context) => {
    const vessel = await requireOwnedVessel(context);
    const crewId = context.query.get('crew_id');
    if (crewId === null || crewId === '') {
      throw new ValidationError({ crew_id: 'Choose a crew member.' });
    }
    const crew = await store.findCrewById(crewId);
    if (crew === null || crew.vesselId !== vessel.id) {
      throw new ValidationError({ crew_id: 'That crew member is not on this vessel.' });
    }
    const fromDate = queryShipDate(context.query, 'from', 'A first date');
    const toDate = queryShipDate(context.query, 'to', 'A last date');
    if (fromDate === null || toDate === null) {
      throw new ValidationError({ from: 'Choose the dates to plan.' });
    }
    if (toDate < fromDate) {
      throw new ValidationError({ to: 'The last date comes before the first.' });
    }
    if (shipDateRange(fromDate, toDate).length > 28) {
      throw new ValidationError({ to: 'Plan at most 28 days at a time.' });
    }
    const clock = await store.loadVesselClock(vessel);
    const ruleSets = await store.listRuleSets(vessel.id);
    const watches = await store.listRotaWatches(vessel.id, crew.id);
    const plan = planRota(clock, watches, fromDate, toDate, ruleSets);
    sendJson(context.res, 200, plan);
  });

  route('GET', '/api/vessels/:vesselId/rule-sets', 'session', async (context) => {
    const vessel = await requireVisibleVessel(context);
    const periods = await store.listRuleSets(vessel.id);
    sendJson(context.res, 200, {
      rule_sets: periods.map((period) => ({
        id: period.id,
        rule_set: period.ruleSet,
        effective_from_utc: formatInstant(period.effectiveFromMs),
        effective_until_utc: formatInstant(period.effectiveUntilMs),
        flag_reference: period.flagReference,
      })),
    });
  });

  route('POST', '/api/vessels/:vesselId/rule-sets', 'session', async (context) => {
    const vessel = await requireOwnedVessel(context);
    const body = context.json();
    requireChoice(body, 'rule_set', 'A rule set', ['flag_exception'] as const);
    const fromMs = requireAlignedInstant(body, 'effective_from_utc', 'The start');
    const untilMs = requireAlignedInstant(body, 'effective_until_utc', 'The end');
    const flagReference = requireText(body, 'flag_reference', 'A flag authorisation', 1, 200);
    const periods = await store.listRuleSets(vessel.id);
    if (periodsOverlap(periods, fromMs, untilMs)) fail(409, 'rule_set_overlap');
    if (fromMs <= context.nowMs) {
      throw new ValidationError({ effective_from_utc: 'Pick a start time after now.' });
    }
    if (untilMs <= fromMs || untilMs - fromMs > MAX_FLAG_EXCEPTION_HOURS * HOUR_MS) {
      throw new ValidationError({
        effective_until_utc: 'A flag exception cannot run longer than two weeks.',
      });
    }
    const id = store.newId('ruleset');
    await store.insertRuleSet(id, vessel.id, fromMs, untilMs, flagReference);
    sendJson(context.res, 201, {
      id,
      rule_set: 'flag_exception',
      effective_from_utc: formatInstant(fromMs),
      effective_until_utc: formatInstant(untilMs),
      flag_reference: flagReference,
    });
  });

  route('POST', '/api/vessels/:vesselId/events', 'session', async (context) => {
    const vessel = await requireOwnedVessel(context);
    const body = context.json();
    const crew = await requireVesselCrew(vessel.id, body);
    const kind = requireChoice(body, 'kind', 'A type', ['drill', 'call_out'] as const);
    const startMs = requireAlignedInstant(body, 'start_utc', 'The start');
    const endMs = requireAlignedInstant(body, 'end_utc', 'The end');
    const description = requireText(body, 'description', 'A description', 1, 2000);
    if (endMs <= startMs) {
      throw new ValidationError({ end_utc: 'The end comes before the start.' });
    }
    const clock = await store.loadVesselClock(vessel);
    const shipDate = shipDateOf(clock, startMs);
    const month = await store.findMonth(crew.id, monthOfShipDate(shipDate));
    if (month.state === 'sealed') fail(409, 'month_sealed');
    const id = store.newId('event');
    await store.insertEvent({
      id,
      vesselId: vessel.id,
      crewId: crew.id,
      kind,
      startMs,
      endMs,
      description,
    });
    const crewContext = await loadCrewContext(crew, startMs, endMs);
    const notes = await store.listNotesForCrew(crew.id);
    sendJson(
      context.res,
      201,
      eventPayload(
        crewContext,
        { id, vesselId: vessel.id, crewId: crew.id, kind, startMs, endMs, description },
        notes,
      ),
    );
  });
}
