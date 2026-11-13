import { ValidationError, fail } from '../http/errors.js';
import { requireCrewSession, route, sendJson } from '../http/router.js';
import * as store from '../db/store.js';
import { checkWatchEntry } from '../domain/watch-entry.js';
import { shipDateOf, shipDayBounds, type VesselClock } from '../domain/ship-time.js';
import { shipDayStatus } from '../domain/day-state.js';
import { monthOfShipDate, parseInstant } from '../domain/time.js';
import { entryPayload, recordBreachesAround } from '../services/crew-records.js';

type EntryRequest = {
  entryKey: string;
  startMs: number;
  endMs: number;
  kind: 'rest' | 'work';
};

type ParsedEntry =
  | { ok: true; value: EntryRequest }
  | { ok: false; errors: Record<string, string> };

function parseEntryShape(raw: unknown): ParsedEntry {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: { entry: 'Send each entry as a JSON object.' } };
  }
  const body = raw as Record<string, unknown>;
  const entryKey = body['entry_key'];
  if (typeof entryKey !== 'string' || entryKey.length < 1 || entryKey.length > 100) {
    return { ok: false, errors: { entry_key: 'An entry key needs 1 to 100 characters.' } };
  }
  const kind = body['kind'];
  if (kind !== 'rest' && kind !== 'work') {
    return { ok: false, errors: { kind: 'An entry is either rest or work.' } };
  }
  const startMs = parseInstant(body['start_utc']);
  if (startMs === null) {
    return { ok: false, errors: { start_utc: 'A start needs the form 2026-09-10T02:00:00Z.' } };
  }
  const endMs = parseInstant(body['end_utc']);
  if (endMs === null) {
    return { ok: false, errors: { end_utc: 'An end needs the form 2026-09-10T02:00:00Z.' } };
  }
  return { ok: true, value: { entryKey, startMs, endMs, kind } };
}

function sameAsStored(stored: store.WatchEntryRow, request: EntryRequest): boolean {
  return (
    stored.startMs === request.startMs &&
    stored.endMs === request.endMs &&
    stored.kind === request.kind
  );
}

type DayDisposition = { kind: 'open' | 'closed' | 'frozen' };

async function dayDisposition(
  crew: store.Crew,
  clock: VesselClock,
  shipDate: string,
  nowMs: number,
): Promise<DayDisposition> {
  const month = await store.findMonth(crew.id, monthOfShipDate(shipDate));
  if (month.state === 'sealed') return { kind: 'frozen' };
  const signature = await store.findSignature(crew.id, shipDate);
  const status = shipDayStatus(shipDayBounds(clock, shipDate), signature, nowMs);
  if (status.state === 'open') return { kind: 'open' };
  if (status.state === 'closed') return { kind: 'closed' };
  return { kind: 'frozen' };
}

export function registerEntryRoutes(): void {
  route('POST', '/api/watch-entries', 'session', async (context) => {
    const crewId = requireCrewSession(context, 'crew_only');
    const crew = (await store.findCrewById(crewId)) as store.Crew;
    const vessel = (await store.findVesselById(crew.vesselId)) as store.Vessel;
    const clock = await store.loadVesselClock(vessel);
    const body = context.json();

    const entryKey = body['entry_key'];
    if (typeof entryKey === 'string' && entryKey.length >= 1 && entryKey.length <= 100) {
      const stored = await store.findEntryByKey(crew.id, entryKey);
      if (stored !== null) {
        const parsed = parseEntryShape(body);
        const matches = parsed.ok && sameAsStored(stored, parsed.value);
        if (!matches) fail(409, 'entry_key_conflict');
        sendJson(context.res, 201, { entry: entryPayload(stored) });
        return;
      }
    }

    const parsed = parseEntryShape(body);
    if (!parsed.ok) throw new ValidationError(parsed.errors);

    const dayOfStart = shipDateOf(clock, parsed.value.startMs);
    const month = await store.findMonth(crew.id, monthOfShipDate(dayOfStart));
    if (month.state === 'sealed') fail(409, 'month_sealed');
    const disposition = await dayDisposition(crew, clock, dayOfStart, context.nowMs);
    if (disposition.kind !== 'open') fail(409, 'day_closed');

    const { shipDate } = checkWatchEntry(
      clock,
      parsed.value.startMs,
      parsed.value.endMs,
      context.nowMs,
    );
    const result = await store.insertEntry({
      crewId: crew.id,
      entryKey: parsed.value.entryKey,
      startMs: parsed.value.startMs,
      endMs: parsed.value.endMs,
      kind: parsed.value.kind,
      shipDate,
      late: false,
      applied: true,
      receivedAtMs: context.nowMs,
    });
    if (result.stored) {
      await recordBreachesAround(crew, parsed.value.startMs, parsed.value.endMs, context.nowMs);
    }
    sendJson(context.res, 201, { entry: entryPayload(result.entry) });
  });

  route('POST', '/api/watch-entries/sync', 'session', async (context) => {
    const crewId = requireCrewSession(context, 'crew_only');
    const crew = (await store.findCrewById(crewId)) as store.Crew;
    const vessel = (await store.findVesselById(crew.vesselId)) as store.Vessel;
    const clock = await store.loadVesselClock(vessel);
    const body = context.json();
    const entries = body['entries'];
    if (!Array.isArray(entries)) {
      throw new ValidationError({ entries: 'Send the queued entries as a list.' });
    }
    if (entries.length > 500) {
      throw new ValidationError({ entries: 'Send at most 500 entries at a time.' });
    }

    const results: Record<string, unknown>[] = [];
    let changedFromMs = Number.POSITIVE_INFINITY;
    let changedToMs = Number.NEGATIVE_INFINITY;

    for (const raw of entries) {
      const parsed = parseEntryShape(raw);
      const requestedKey =
        typeof raw === 'object' && raw !== null && typeof (raw as Record<string, unknown>)['entry_key'] === 'string'
          ? ((raw as Record<string, unknown>)['entry_key'] as string)
          : null;
      if (requestedKey !== null) {
        const stored = await store.findEntryByKey(crew.id, requestedKey);
        if (stored !== null) {
          if (parsed.ok && sameAsStored(stored, parsed.value)) {
            results.push({
              entry_key: requestedKey,
              outcome: 'replayed',
              entry: entryPayload(stored),
              errors: null,
            });
          } else {
            results.push({
              entry_key: requestedKey,
              outcome: 'conflict',
              entry: null,
              errors: null,
            });
          }
          continue;
        }
      }
      if (!parsed.ok) {
        results.push({
          entry_key: requestedKey,
          outcome: 'rejected',
          entry: null,
          errors: parsed.errors,
        });
        continue;
      }
      let shipDate: string;
      try {
        shipDate = checkWatchEntry(clock, parsed.value.startMs, parsed.value.endMs, context.nowMs)
          .shipDate;
      } catch (error) {
        results.push({
          entry_key: parsed.value.entryKey,
          outcome: 'rejected',
          entry: null,
          errors: error instanceof ValidationError ? error.errors : { entry: 'That entry was refused.' },
        });
        continue;
      }
      const disposition = await dayDisposition(crew, clock, shipDate, context.nowMs);
      const late = disposition.kind !== 'open';
      const applied = disposition.kind !== 'frozen';
      const result = await store.insertEntry({
        crewId: crew.id,
        entryKey: parsed.value.entryKey,
        startMs: parsed.value.startMs,
        endMs: parsed.value.endMs,
        kind: parsed.value.kind,
        shipDate,
        late,
        applied,
        receivedAtMs: context.nowMs,
      });
      if (result.stored && applied) {
        changedFromMs = Math.min(changedFromMs, parsed.value.startMs);
        changedToMs = Math.max(changedToMs, parsed.value.endMs);
      }
      results.push({
        entry_key: parsed.value.entryKey,
        outcome: late ? 'late' : 'applied',
        entry: entryPayload(result.entry),
        errors: null,
      });
    }

    if (changedToMs > changedFromMs) {
      await recordBreachesAround(crew, changedFromMs, changedToMs, context.nowMs);
    }
    sendJson(context.res, 200, { results });
  });
}

