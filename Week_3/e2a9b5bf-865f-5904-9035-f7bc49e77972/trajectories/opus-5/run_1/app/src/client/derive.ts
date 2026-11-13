import { eveningDate, localClock, parseTimestamp, utcOffset } from '../shared/clock.js';
import type { CompletenessSubject, ProgramRules } from '../shared/completeness.js';
import { deriveFromKit } from '../shared/optics.js';
import { derivePair } from '../shared/pair.js';
import { hasMarks, parseStrokeFile } from '../shared/strokes.js';
import type {
  CatalogueObject,
  Observation,
  ObservingSession,
  Program,
  StrokeFile,
} from '../shared/types.js';
import { journalEntries } from './journal.js';
import { appState } from './state.js';

function catalogue(objectId: string): CatalogueObject | null {
  return appState().copy.objects.find((entry) => entry.id === objectId) ?? null;
}

function sessionFromQueue(
  sessionId: string,
  siteId: string,
  startedAt: string,
  optics: ObservingSession['optics'],
): ObservingSession | null {
  const { copy } = appState();
  const site = copy.sites.find((entry) => entry.id === siteId);
  const started = parseTimestamp(startedAt);
  const derived = copy.kit ? deriveFromKit(copy.kit, optics) : null;
  if (!site || !started || !derived) return null;
  return {
    id: sessionId,
    site: { id: site.id, name: site.name, time_zone: site.time_zone },
    started_at: startedAt,
    evening_date: eveningDate(started, site.time_zone),
    local_start: localClock(started, site.time_zone),
    local_start_offset: utcOffset(started, site.time_zone),
    optics,
    derived,
    observation_count: 0,
  };
}

interface Derived {
  sessions: Map<string, ObservingSession>;
  observations: Map<string, Observation>;
  strokes: Map<string, string>;
}

/** The device's copy with its queued changes applied, in order. */
function derived(): Derived {
  const { copy } = appState();
  const sessions = new Map(Object.entries(copy.sessions));
  const observations = new Map(Object.entries(copy.observations));
  const strokes = new Map(Object.entries(copy.stroke_files));

  for (const entry of journalEntries()) {
    const change = entry.change;
    if (change.kind === 'session.create') {
      const session = sessionFromQueue(
        change.session_id,
        change.site_id,
        change.started_at,
        change.optics,
      );
      if (session) sessions.set(session.id, session);
    } else if (change.kind === 'session.optics') {
      const session = sessions.get(change.session_id);
      const kit = copy.kit;
      const next = kit ? deriveFromKit(kit, change.optics) : null;
      if (session && next) {
        sessions.set(session.id, { ...session, optics: change.optics, derived: next });
      }
    } else if (change.kind === 'observation.create') {
      const session = sessions.get(change.session_id);
      const object = catalogue(change.object_id);
      const kit = copy.kit;
      if (!session || !object || !kit) continue;
      const optics = change.fields.optics ?? session.optics;
      const next = deriveFromKit(kit, optics);
      if (!next) continue;
      const observedAt = change.fields.observed_at ?? null;
      const stamp = observedAt ? parseTimestamp(observedAt) : null;
      observations.set(change.observation_id, {
        id: change.observation_id,
        session_id: session.id,
        object_id: object.id,
        designation: object.designation,
        kind: object.kind,
        observed_at: observedAt,
        local_time: stamp ? localClock(stamp, session.site.time_zone) : null,
        local_offset: stamp ? utcOffset(stamp, session.site.time_zone) : null,
        evening_date: session.evening_date,
        site: session.site,
        seeing: change.fields.seeing ?? null,
        transparency_nelm: change.fields.transparency_nelm ?? null,
        concentration_class: change.fields.concentration_class ?? null,
        pair: change.fields.pair ? derivePair(change.fields.pair) : null,
        description: change.fields.description ?? '',
        optics,
        derived: next,
        sketch: null,
        version: 1,
      });
    } else if (change.kind === 'observation.update') {
      const existing = observations.get(change.observation_id);
      const kit = copy.kit;
      if (!existing || !kit) continue;
      const fields = change.fields;
      const optics = fields.optics ?? existing.optics;
      const next = deriveFromKit(kit, optics) ?? existing.derived;
      const observedAt =
        'observed_at' in fields ? (fields.observed_at ?? null) : existing.observed_at;
      const stamp = observedAt ? parseTimestamp(observedAt) : null;
      observations.set(existing.id, {
        ...existing,
        observed_at: observedAt,
        local_time: stamp ? localClock(stamp, existing.site.time_zone) : null,
        local_offset: stamp ? utcOffset(stamp, existing.site.time_zone) : null,
        seeing: 'seeing' in fields ? (fields.seeing ?? null) : existing.seeing,
        transparency_nelm:
          'transparency_nelm' in fields
            ? (fields.transparency_nelm ?? null)
            : existing.transparency_nelm,
        concentration_class:
          'concentration_class' in fields
            ? (fields.concentration_class ?? null)
            : existing.concentration_class,
        pair: 'pair' in fields ? (fields.pair ? derivePair(fields.pair) : null) : existing.pair,
        description: 'description' in fields ? (fields.description ?? '') : existing.description,
        optics,
        derived: next,
      });
    } else if (change.kind === 'sketch.put') {
      const existing = observations.get(change.observation_id);
      if (!existing) continue;
      strokes.set(change.observation_id, change.strokes);
      const file = parseStrokeFile(change.strokes);
      observations.set(existing.id, {
        ...existing,
        sketch:
          file && hasMarks(file)
            ? {
                strokes_sha256: '',
                strokes_size: new TextEncoder().encode(change.strokes).byteLength,
                has_raster: change.raster_png_base64 !== null,
              }
            : null,
      });
    } else if (change.kind === 'observation.delete') {
      observations.delete(change.observation_id);
      strokes.delete(change.observation_id);
    }
  }

  for (const session of sessions.values()) {
    session.observation_count = [...observations.values()].filter(
      (observation) => observation.session_id === session.id,
    ).length;
  }
  return { sessions, observations, strokes };
}

export function viewSessions(): ObservingSession[] {
  return [...derived().sessions.values()].sort((a, b) =>
    a.started_at === b.started_at ? 0 : a.started_at < b.started_at ? 1 : -1,
  );
}

export function viewSession(sessionId: string): ObservingSession | null {
  return derived().sessions.get(sessionId) ?? null;
}

export function viewObservation(observationId: string): Observation | null {
  return derived().observations.get(observationId) ?? null;
}

export function viewSessionObservations(sessionId: string): Observation[] {
  return [...derived().observations.values()]
    .filter((observation) => observation.session_id === sessionId)
    .sort(byTimeThenId);
}

function byTimeThenId(a: Observation, b: Observation): number {
  if (a.observed_at === b.observed_at) return a.id < b.id ? -1 : 1;
  if (a.observed_at === null) return 1;
  if (b.observed_at === null) return -1;
  return a.observed_at < b.observed_at ? -1 : 1;
}

/** History order: newest observed_at first, with observations that have no time last. */
export function viewHistory(objectId: string): Observation[] {
  return [...derived().observations.values()]
    .filter((observation) => observation.object_id === objectId)
    .sort((a, b) => -byTimeThenId(a, b));
}

export function viewStrokeFile(observationId: string): StrokeFile | null {
  const text = derived().strokes.get(observationId);
  return text === undefined ? null : parseStrokeFile(text);
}

export function viewSubjects(): CompletenessSubject[] {
  const observations = [...derived().observations.values()];
  const order = new Map(observations.map((observation, index) => [observation.id, index]));
  return observations.map((observation) => ({
    id: observation.id,
    object_id: observation.object_id,
    kind: observation.kind,
    evening_date: observation.evening_date,
    observed_at: observation.observed_at,
    seeing: observation.seeing,
    transparency_nelm: observation.transparency_nelm,
    concentration_class: observation.concentration_class,
    has_pair: observation.pair !== null,
    description: observation.description,
    has_sketch: observation.sketch !== null,
    sequence: order.get(observation.id) ?? 0,
  }));
}

export function rulesFor(program: Program): ProgramRules {
  const objects = appState().copy.program_objects[program.id] ?? [];
  return {
    required_count: program.required_count,
    editions: program.editions,
    object_ids: objects.map((entry) => entry.object_id),
  };
}
