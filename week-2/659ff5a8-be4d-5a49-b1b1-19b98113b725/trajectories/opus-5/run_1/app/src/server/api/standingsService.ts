import type { PoolClient } from 'pg';
import type { StandingsRow, StandingsView } from '../../shared/api';
import { formatTime } from '../domain/decimal';
import { isoUtc } from '../domain/clubTime';
import {
  orderForView,
  rankEntries,
  type EntryInput,
  type RankedEntry,
} from '../domain/standings';
import {
  listRegistrations,
  listRuns,
  runDto,
  type RegistrationRecord,
  type RunRecord,
} from './support';

export interface StandingsEntry {
  registration: RegistrationRecord;
  runs: RunRecord[];
  ranked: RankedEntry;
}

export interface EventStandings {
  entries: StandingsEntry[];
  byRegistration: Map<string, StandingsEntry>;
}

function entryInput(registration: RegistrationRecord, runs: RunRecord[]): EntryInput {
  return {
    registrationId: registration.id,
    carNumber: registration.car_number,
    classCode: registration.class_code,
    runs: runs.map((run) => ({
      runNumber: run.run_number,
      status: run.status,
      outcome: run.outcome,
      adjustedMs: run.adjusted_ms,
      indexedMs: run.indexed_ms,
    })),
  };
}

export function buildStandings(
  registrations: RegistrationRecord[],
  runs: RunRecord[],
): EventStandings {
  const runsByRegistration = new Map<string, RunRecord[]>();
  for (const run of runs) {
    const bucket = runsByRegistration.get(run.registration_id) ?? [];
    bucket.push(run);
    runsByRegistration.set(run.registration_id, bucket);
  }
  for (const bucket of runsByRegistration.values()) {
    bucket.sort((a, b) => a.run_number - b.run_number);
  }
  const inputs = registrations.map((registration) =>
    entryInput(registration, runsByRegistration.get(registration.id) ?? []),
  );
  const ranked = rankEntries(inputs);
  const rankedById = new Map(ranked.map((entry) => [entry.registrationId, entry]));
  const entries: StandingsEntry[] = registrations.map((registration) => {
    const rankedEntry = rankedById.get(registration.id);
    if (!rankedEntry) throw new Error('Ranking lost a registration');
    return {
      registration,
      runs: runsByRegistration.get(registration.id) ?? [],
      ranked: rankedEntry,
    };
  });
  return { entries, byRegistration: new Map(entries.map((entry) => [entry.registration.id, entry])) };
}

export async function eventStandings(
  eventId: string,
  client?: PoolClient,
): Promise<EventStandings> {
  const [registrations, runs] = await Promise.all([
    listRegistrations(eventId, client),
    listRuns(eventId, client),
  ]);
  return buildStandings(registrations, runs);
}

export function standingsRow(entry: StandingsEntry): StandingsRow {
  const { registration, ranked } = entry;
  const lastChange =
    registration.last_change_at &&
    registration.last_change_run_number !== null &&
    registration.last_change_indexed &&
    registration.last_change_class &&
    registration.last_change_raw
      ? {
          runNumber: registration.last_change_run_number,
          at: isoUtc(registration.last_change_at),
          rankChange: {
            indexed: registration.last_change_indexed,
            class: registration.last_change_class,
            raw: registration.last_change_raw,
          },
        }
      : null;
  return {
    registrationId: registration.id,
    carNumber: registration.car_number,
    classCode: registration.class_code,
    driverName: registration.driver_name,
    carDescription: registration.car_description,
    position: ranked.position,
    classPosition: ranked.classPosition,
    rawPosition: ranked.rawPosition,
    bestAdjusted: formatTime(ranked.bestAdjustedMs),
    bestIndexed: formatTime(ranked.bestIndexedMs),
    lastChange,
    runs: entry.runs.map(runDto),
  };
}

export function standingsRows(
  standings: EventStandings,
  view: StandingsView,
  classFilter: string | null,
): StandingsRow[] {
  const filtered = classFilter
    ? standings.entries.filter((entry) => entry.registration.class_code === classFilter)
    : standings.entries;
  const order = orderForView(
    filtered.map((entry) => entry.ranked),
    view,
  );
  const byId = new Map(filtered.map((entry) => [entry.registration.id, entry]));
  return order.map((ranked) => {
    const entry = byId.get(ranked.registrationId);
    if (!entry) throw new Error('Ordering lost an entry');
    return standingsRow(entry);
  });
}

export function fastestIndexedMs(standings: EventStandings): number | null {
  let fastest: number | null = null;
  for (const entry of standings.entries) {
    const best = entry.ranked.bestIndexedMs;
    if (best === null) continue;
    if (fastest === null || best < fastest) fastest = best;
  }
  return fastest;
}
