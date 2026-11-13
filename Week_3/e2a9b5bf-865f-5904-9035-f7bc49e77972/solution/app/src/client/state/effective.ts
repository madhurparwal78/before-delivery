import { deriveFor } from "../../shared/optics";
import { measuredPair } from "../../shared/pair";
import { markCount, parseStrokeFile } from "../../shared/stroke";
import { eveningDate, localClock, offsetAt, parseUtc } from "../../shared/time";
import type { Observation, Optics, Pair, Session } from "../../shared/types";
import type { JournalEntry, ServerCopy } from "./model";
import { representative, type Ranked } from "../../shared/completeness";
import type { ProgramDetail } from "../../shared/types";

/** The server's last answer with the still-queued changes applied in order. */
export interface Effective {
  sessions: Record<string, Session>;
  observations: Record<string, Observation>;
  strokes: Record<string, string>;
  createdSeq: Record<string, number>;
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

let lastKey: { server: ServerCopy; journal: JournalEntry[] } | null = null;
let lastValue: Effective | null = null;

export function effective(server: ServerCopy, journal: JournalEntry[]): Effective {
  if (lastKey && lastKey.server === server && lastKey.journal === journal && lastValue) return lastValue;
  lastKey = { server, journal };
  lastValue = compute(server, journal);
  return lastValue;
}

function withZone(obs: Observation, observedAt: string | null, zone: string): Observation {
  const date = observedAt ? parseUtc(observedAt) : null;
  return {
    ...obs,
    observed_at: observedAt,
    local_time: date ? localClock(date, zone) : null,
    local_offset: date ? offsetAt(date, zone) : null,
  };
}

function compute(server: ServerCopy, journal: JournalEntry[]): Effective {
  const sessions: Record<string, Session> = { ...server.sessions };
  let observations: Record<string, Observation> = { ...server.observations };
  const strokes: Record<string, string> = { ...server.strokes };
  const createdSeq: Record<string, number> = {};
  const kit = server.kit;
  const catalogue = server.objects ?? [];
  const sites = server.sites ?? [];
  const derive = (optics: Optics) => (kit ? deriveFor(optics, kit) : null);

  journal.forEach((entry, index) => {
    const body = asObject(entry.change.body);
    switch (entry.change.kind) {
      case "session.create": {
        const site = sites.find((s) => s.id === body.site_id);
        const started = parseUtc(body.started_at);
        const optics = body.optics as Optics;
        const derived = derive(optics);
        if (!site || !started || !derived) return;
        sessions[String(body.session_id)] = {
          id: String(body.session_id),
          site: { id: site.id, name: site.name, time_zone: site.time_zone },
          started_at: String(body.started_at),
          evening_date: eveningDate(started, site.time_zone),
          local_start: localClock(started, site.time_zone),
          local_start_offset: offsetAt(started, site.time_zone),
          optics,
          derived,
          observation_count: 0,
        };
        return;
      }
      case "session.optics": {
        const session = sessions[String(body.session_id)];
        const optics = body.optics as Optics;
        const derived = derive(optics);
        if (session && derived) sessions[session.id] = { ...session, optics, derived };
        return;
      }
      case "observation.create": {
        const session = sessions[String(body.session_id)];
        const object = catalogue.find((o) => o.id === body.object_id);
        if (!session || !object) return;
        const fields = asObject(body.fields);
        const optics = (fields.optics as Optics | undefined) ?? session.optics;
        const derived = derive(optics);
        if (!derived) return;
        const id = String(body.observation_id);
        createdSeq[id] = index + 1;
        let obs: Observation = {
          id,
          session_id: session.id,
          object_id: object.id,
          designation: object.designation,
          kind: object.kind,
          observed_at: null,
          local_time: null,
          local_offset: null,
          evening_date: session.evening_date,
          site: session.site,
          seeing: (fields.seeing as number | undefined) ?? null,
          transparency_nelm: (fields.transparency_nelm as number | undefined) ?? null,
          concentration_class: (fields.concentration_class as string | undefined) ?? null,
          pair: null,
          description: typeof fields.description === "string" ? fields.description : "",
          optics,
          derived,
          sketch: null,
          version: 0,
        };
        obs = withZone(obs, typeof fields.observed_at === "string" ? fields.observed_at : null, session.site.time_zone);
        const pair = fields.pair as Pair | undefined | null;
        if (pair) obs.pair = measuredPair(pair.primary, pair.secondary);
        observations[id] = obs;
        return;
      }
      case "observation.update": {
        const current = observations[String(body.observation_id)];
        if (!current) return;
        const fields = asObject(body.fields);
        let next: Observation = { ...current };
        if ("seeing" in fields) next.seeing = (fields.seeing as number | null) ?? null;
        if ("transparency_nelm" in fields) next.transparency_nelm = (fields.transparency_nelm as number | null) ?? null;
        if ("concentration_class" in fields) next.concentration_class = (fields.concentration_class as string | null) ?? null;
        if ("description" in fields) next.description = typeof fields.description === "string" ? fields.description : "";
        if ("observed_at" in fields) {
          next = withZone(next, typeof fields.observed_at === "string" ? fields.observed_at : null, current.site.time_zone);
        }
        if ("pair" in fields) {
          const pair = fields.pair as Pair | null;
          next.pair = pair ? measuredPair(pair.primary, pair.secondary) : null;
        }
        if ("optics" in fields && fields.optics) {
          const optics = fields.optics as Optics;
          const derived = derive(optics);
          if (derived) {
            next.optics = optics;
            next.derived = derived;
          }
        }
        observations[current.id] = next;
        return;
      }
      case "sketch.put": {
        const id = String(body.observation_id);
        const current = observations[id];
        if (!current) return;
        const text = String(body.strokes);
        strokes[id] = text;
        observations[id] = {
          ...current,
          sketch: { strokes_sha256: "pending", strokes_size: text.length, has_raster: body.raster_png_base64 != null },
        };
        return;
      }
      case "observation.delete": {
        const id = String(body.observation_id);
        const { [id]: _removed, ...rest } = observations;
        observations = rest;
        delete strokes[id];
        return;
      }
    }
  });

  const counts: Record<string, number> = {};
  for (const obs of Object.values(observations)) counts[obs.session_id] = (counts[obs.session_id] ?? 0) + 1;
  for (const id of Object.keys(sessions)) {
    const session = sessions[id]!;
    const count = counts[id] ?? 0;
    if (session.observation_count !== count) sessions[id] = { ...session, observation_count: count };
  }
  return { sessions, observations, strokes, createdSeq };
}

const markCache = new Map<string, number>();

function marksIn(text: string | undefined): number {
  if (!text) return 0;
  let n = markCache.get(text);
  if (n === undefined) {
    const file = parseStrokeFile(text);
    n = file ? markCount(file) : 0;
    if (markCache.size > 500) markCache.clear();
    markCache.set(text, n);
  }
  return n;
}

function rankedObservations(eff: Effective): Ranked[] {
  return Object.values(eff.observations).map((o) => ({
    id: o.id,
    object_id: o.object_id,
    kind: o.kind,
    evening_date: o.evening_date,
    observed_at: o.observed_at,
    seeing: o.seeing,
    transparency_nelm: o.transparency_nelm,
    description: o.description,
    concentration_class: o.concentration_class,
    pair: o.pair,
    has_sketch: marksIn(eff.strokes[o.id]) > 0,
    created_seq: eff.createdSeq[o.id] ?? 0,
  }));
}

/** Counts, bar and checklist for a program, computed on the device with the server's rule. */
export function localProgress(program: ProgramDetail, eff: Effective): {
  qualifying: number;
  rows: { object_id: string; designation: string; name: string; observation: Observation | null; qualifies: boolean }[];
} {
  const ranked = rankedObservations(eff);
  const ruleSet = { object_ids: program.objects.map((o) => o.object_id), editions: program.editions };
  let qualifying = 0;
  const rows = program.objects.map((object) => {
    const rep = representative(
      ranked.filter((o) => o.object_id === object.object_id),
      ruleSet,
    );
    if (rep.qualifying) qualifying += 1;
    return {
      object_id: object.object_id,
      designation: object.designation,
      name: object.name,
      observation: rep.qualifying && rep.observation ? (eff.observations[rep.observation.id] ?? null) : null,
      qualifies: rep.qualifying,
    };
  });
  return { qualifying, rows };
}

