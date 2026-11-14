import { aerodromeFor } from "./aerodromes.ts";
import { cleanName, requireInstructor } from "./auth.ts";
import { parseSimClock } from "./domain/clock.ts";
import type { Layout } from "./domain/layout.ts";
import { windFault } from "./domain/rules.ts";
import { EVENT_KINDS, type EventKind, type ScheduledEvent, type TrafficItem } from "./domain/state.ts";
import { newId, pool, query } from "./db.ts";
import { notFound, scenarioInvalid } from "./errors.ts";
import { reply, route } from "./http.ts";

export interface ScenarioDoc {
  aerodrome: string;
  name: string;
  runwayInUse: string;
  windDir: number;
  windKt: number;
  startSimTime: string;
  durationSeconds: number;
  seed: number;
  readbackErrorEvery: number | null;
  traffic: TrafficItem[];
  events: ScheduledEvent[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isInt = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);

/** Reads and judges a scenario; the first fault is thrown as the published `scenario_invalid` answer. */
export function readScenario(body: Record<string, unknown>, layout: Layout): ScenarioDoc {
  const where = layout.name;
  const thresholds = layout.runways.flatMap((runway) => runway.thresholds.map((t) => t.id));
  const name = cleanName(body.name, 120);
  if (name === null) throw scenarioInvalid("Scenario name is required.");
  if (typeof body.runwayInUse !== "string" || !thresholds.includes(body.runwayInUse)) {
    throw scenarioInvalid(`Runway ${String(body.runwayInUse ?? "")} is not on ${where}.`);
  }
  const wind = windFault(body.windDir, body.windKt);
  if (wind !== null || !isInt(body.windDir) || !isInt(body.windKt)) throw scenarioInvalid(wind ?? "Wind must be whole numbers.");
  if (typeof body.startSimTime !== "string" || parseSimClock(body.startSimTime) === null) throw scenarioInvalid("Start time must be HH:MM:SS.");
  if (!isInt(body.durationSeconds) || body.durationSeconds <= 0) throw scenarioInvalid("Duration seconds must be a whole number above 0.");
  if (!isInt(body.seed)) throw scenarioInvalid("Seed must be a whole number.");
  const every = body.readbackErrorEvery ?? null;
  if (every !== null && (!isInt(every) || every < 0)) throw scenarioInvalid("Readback error interval must be a whole number of 0 or more.");
  const rows = Array.isArray(body.traffic) ? body.traffic : [];
  const seen = new Set<string>();
  const traffic = rows.map((row: unknown): TrafficItem => {
    if (!isRecord(row)) throw scenarioInvalid("Each aircraft needs its fields.");
    const callsign = typeof row.callsign === "string" ? row.callsign : "";
    if (!/^[A-Z]{5}$/.test(callsign)) throw scenarioInvalid(`Callsign ${callsign} must be 5 capital letters.`);
    if (seen.has(callsign)) throw scenarioInvalid(`Callsign ${callsign} is used more than once.`);
    seen.add(callsign);
    const kind = row.kind === "arr" ? "arr" : "dep";

    if (typeof row.type !== "string" || row.type.trim() === "") throw scenarioInvalid(`Type for ${callsign} is required.`);
    if (!["L", "M", "H", "J"].includes(String(row.wake))) throw scenarioInvalid(`Wake for ${callsign} must be L, M, H or J.`);
    const rules: TrafficItem["rules"] | null = row.rules === "IFR" ? "IFR" : row.rules === "VFR" ? "VFR" : null;
    if (rules === null) throw scenarioInvalid(`Rules for ${callsign} must be VFR or IFR.`);
    if (!isInt(row.appearAt) || row.appearAt < 0) throw scenarioInvalid(`Appear at for ${callsign} must be a whole number of 0 or more.`);
    const traffic = {
      callsign,
      type: row.type.trim(),
      wake: row.wake as TrafficItem["wake"],
      rules,
      kind: kind as TrafficItem["kind"],
      appearAt: row.appearAt,
    };
    if (kind === "dep") {
      const stand = typeof row.stand === "string" ? row.stand : "";
      if (layout.nodes.find((n) => n.id === stand)?.kind !== "stand") throw scenarioInvalid(`Stand ${stand} is not on ${where}.`);
      const point = typeof row.holdingPoint === "string" ? row.holdingPoint : "";
      if (layout.nodes.find((n) => n.id === point)?.kind !== "holding") throw scenarioInvalid(`Holding point ${point} is not on ${where}.`);
      const slot = row.slotSeconds ?? null;
      if (slot !== null && (!isInt(slot) || slot < 0)) throw scenarioInvalid(`Slot seconds for ${callsign} must be a whole number of 0 or more.`);
      return { ...traffic, stand, holdingPoint: point, runway: null, dueSeconds: null, slotSeconds: slot, overrunsHold: row.overrunsHold === true };
    }
    const runway = typeof row.runway === "string" ? row.runway : "";
    if (!thresholds.includes(runway)) throw scenarioInvalid(`Runway ${runway} is not on ${where}.`);
    if (!isInt(row.dueSeconds) || row.dueSeconds <= 0) throw scenarioInvalid(`Due seconds for ${callsign} must be a whole number above 0.`);
    return { ...traffic, stand: null, holdingPoint: null, runway, dueSeconds: row.dueSeconds, slotSeconds: null, overrunsHold: false };
  });
  const events = (Array.isArray(body.events) ? body.events : []).map((event: unknown): ScheduledEvent => {
    if (!isRecord(event) || !isInt(event.at) || event.at < 0 || !EVENT_KINDS.some((kind) => kind === event.kind)) {
      throw scenarioInvalid("Each scheduled event needs a time and a kind.");
    }
    return {
      at: event.at,
      kind: event.kind as EventKind,
      ...(typeof event.callsign === "string" ? { callsign: event.callsign } : {}),
      ...(isInt(event.windDir) ? { windDir: event.windDir } : {}),
      ...(isInt(event.windKt) ? { windKt: event.windKt } : {}),
    };
  });
  return {
    aerodrome: String(body.aerodrome),
    name,
    runwayInUse: body.runwayInUse,
    windDir: body.windDir,
    windKt: body.windKt,
    startSimTime: body.startSimTime,
    durationSeconds: body.durationSeconds,
    seed: body.seed,
    readbackErrorEvery: every,
    traffic,
    events,
  };
}

export async function scenarioFor(id: string, schoolId: string): Promise<{ id: string; doc: ScenarioDoc }> {
  const rows = await query<{ id: string; doc: ScenarioDoc }>(pool, "SELECT id, doc FROM scenarios WHERE id = $1 AND school_id = $2", [id, schoolId]);
  const found = rows[0];
  if (!found) throw notFound();
  return found;
}

export function registerScenarioRoutes(): void {
  route("GET", "/api/scenarios", async (ctx) => {
    const { schoolId } = await requireInstructor(ctx);
    return query(pool, "SELECT id, name FROM scenarios WHERE school_id = $1 ORDER BY created_at, id", [schoolId]);
  });

  route("POST", "/api/scenarios", async (ctx) => {
    const { schoolId } = await requireInstructor(ctx);
    const body = await ctx.json();
    const aerodrome = await aerodromeFor(typeof body.aerodrome === "string" ? body.aerodrome : "", schoolId);
    const doc = readScenario(body, aerodrome.layout);
    const id = newId();
    await query(pool, "INSERT INTO scenarios (id, school_id, name, doc) VALUES ($1, $2, $3, $4)", [id, schoolId, doc.name, JSON.stringify(doc)]);
    return reply(201, { id });
  });

  route("GET", "/api/scenarios/:id", async (ctx) => {
    const { schoolId } = await requireInstructor(ctx);
    const found = await scenarioFor(ctx.params[0] ?? "", schoolId);
    return { id: found.id, ...found.doc };
  });

  route("PUT", "/api/scenarios/:id", async (ctx) => {
    const { schoolId } = await requireInstructor(ctx);
    const found = await scenarioFor(ctx.params[0] ?? "", schoolId);
    const body = await ctx.json();
    const aerodrome = await aerodromeFor(typeof body.aerodrome === "string" ? body.aerodrome : "", schoolId);
    const doc = readScenario(body, aerodrome.layout);
    await query(pool, "UPDATE scenarios SET name = $2, doc = $3 WHERE id = $1", [found.id, doc.name, JSON.stringify(doc)]);
    return { id: found.id, ...doc };
  });
}
