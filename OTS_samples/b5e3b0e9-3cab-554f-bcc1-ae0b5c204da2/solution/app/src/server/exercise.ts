import { config, timers } from "./config.ts";
import { pool, query, newId, tx } from "./db.ts";
import { parseSimClock, simClock } from "./domain/clock.ts";
import {
  NotFinalRefusal,
  Refusal,
  applyEvent,
  editStrip,
  endSession,
  executeCommand,
  findAircraft,
  isCurrent,
  moveStrip,
  pause,
  pinNote,
  planCommand,
  previewConflicts,
  resume,
  setSpeed,
  startSession,
  taxiConflicts,
  type InjectedEvent,
  type Sim,
  type StripSeed,
} from "./domain/engine.ts";
import type { Position } from "./domain/grammar.ts";
import { commandForms, parseLine } from "./domain/grammar.ts";
import { debrief } from "./domain/scoring.ts";
import { EVENT_KINDS, type LogEntry, type SessionSetup } from "./domain/state.ts";
import { readSpeed, windFault } from "./domain/rules.ts";
import { isPosition } from "../shared/wire.ts";
import { frameOf, type Frame } from "./domain/view.ts";
import {
  ended,
  formErrors,
  notFinal,
  notFound,
  paused,
  parseRefusal,
  rateLimited,
  running,
  seatHeld,
  seatInUse,
  seatTaken,
  versionConflict,
} from "./errors.ts";
import { reply, route, type Ctx } from "./http.ts";
import { requireInstructor } from "./auth.ts";
import { aerodromeFor } from "./aerodromes.ts";
import { scenarioFor, type ScenarioDoc } from "./scenarios.ts";
import {
  accessOutcome,
  accessSession,
  currentPayload,
  isGraceOver,
  loadSession,
  mutate,
  restartClock,
  seatRows,
  simFromRow,
  type Access,
  type Mutation,
} from "./sessions.ts";

// ---------------------------------------------------------------------------------------------------------------
// Starting a session

interface NewSession {
  schoolId: string;
  scenarioId: string;
  doc: ScenarioDoc;
  assignmentId: string | null;
  firstSimTime?: number;
  seeds?: StripSeed[];
}

/** Creates a running session from a scenario, with a frozen copy of the scenario and aerodrome. */
export async function createSession(input: NewSession): Promise<{ id: string; sim: Sim }> {
  const aerodrome = await aerodromeFor(input.doc.aerodrome, input.schoolId);
  const { doc } = input;
  const scenarioStart = parseSimClock(doc.startSimTime) ?? 0;
  const setup: SessionSetup = {
    scenarioName: doc.name,
    aerodromeName: aerodrome.layout.name,
    layout: aerodrome.layout,
    traffic: doc.traffic,
    events: doc.events,
    seed: doc.seed,
    readbackErrorEvery: doc.readbackErrorEvery,
    scenarioStart,
    durationSeconds: doc.durationSeconds,
  };
  const first = input.firstSimTime ?? scenarioStart;
  const sim = startSession(setup, timers, doc.runwayInUse, { dir: doc.windDir, kt: doc.windKt }, first, input.seeds ?? []);
  const id = newId();
  await tx(async (client) => {
    await query(
      client,
      `INSERT INTO sessions (id, school_id, scenario_id, assignment_id, setup, state, status, last_tick_ms)
       VALUES ($1, $2, $3, $4, $5, $6, 'running', $7)`,
      [id, input.schoolId, input.scenarioId, input.assignmentId, JSON.stringify(setup), JSON.stringify(sim.state), Date.now()],
    );
    await query(client, "INSERT INTO session_frames (session_id, t, frame) VALUES ($1, 0, $2)", [id, JSON.stringify(frameOf(sim))]);
  });
  return { id, sim };
}

// ---------------------------------------------------------------------------------------------------------------
// Rate limit

const windows = new Map<string, number[]>();

/** Commands and moves per seat over the last minute of wall clock. */
function limitRate(sessionId: string, position: Position): void {
  const key = `${sessionId}:${position}`;
  const now = Date.now();
  const recent = (windows.get(key) ?? []).filter((at) => now - at < 60_000);
  if (recent.length >= config.commandsPerMinute) {
    windows.set(key, recent);
    throw rateLimited();
  }
  recent.push(now);
  windows.set(key, recent);
}

// ---------------------------------------------------------------------------------------------------------------
// Helpers shared by the routes


function sessionId(ctx: Ctx): string {
  return ctx.params[0] ?? "";
}

function seatOf(access: Access): Position {
  if (access.position === null) throw notFound();
  return access.position;
}

/** The exercise-state check of the error order: paused and ended exercises refuse commands, moves and edits. */
function mustBeRunning(sim: Sim): void {
  if (sim.state.status === "paused") throw paused();
  if (sim.state.status === "ended") throw ended();
}

function mustNotBeEnded(sim: Sim): void {
  if (sim.state.status === "ended") throw ended();
}

/** Turns the engine's refusals into the published answers. */
async function refusing<T>(work: () => Promise<T> | T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof NotFinalRefusal) throw notFinal(error.callsign);
    if (error instanceof Refusal) throw parseRefusal(error.message);
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Presence of seat holders

/** A seat holder's browser connected (true) or the last one closed (false). */
export async function seatPresence(id: string, userId: string, connected: boolean): Promise<void> {
  const seat = (await query(pool, "SELECT 1 FROM seats WHERE session_id = $1 AND user_id = $2", [id, userId]))[0];
  if (!seat) return;
  await mutate(id, async (m) => {
    await query(m.client, "UPDATE seats SET disconnected_at = $3 WHERE session_id = $1 AND user_id = $2", [id, userId, connected ? null : new Date()]);
  }).catch(() => undefined);
}

// ---------------------------------------------------------------------------------------------------------------
// Routes

export function registerExerciseRoutes(): void {
  route("POST", "/api/sessions", async (ctx) => {
    const { schoolId } = await requireInstructor(ctx);
    const body = await ctx.json();
    if (typeof body.scenario !== "string") throw formErrors({ scenario: "Choose a scenario." });
    const scenario = await scenarioFor(body.scenario, schoolId);
    let assignmentId: string | null = null;
    if (body.assignment !== undefined && body.assignment !== null) {
      const owned = await query<{ id: string }>(
        pool,
        "SELECT a.id FROM assignments a JOIN classes c ON c.id = a.class_id WHERE a.id = $1 AND c.school_id = $2",
        [String(body.assignment), schoolId],
      );
      if (!owned[0]) throw notFound();
      assignmentId = owned[0].id;
    }
    const { id } = await createSession({ schoolId, scenarioId: scenario.id, doc: scenario.doc, assignmentId });
    return reply(201, { id });
  });

  route("GET", "/api/sessions/:id/state", async (ctx) => {
    const access = await accessSession(ctx, sessionId(ctx));
    const current = await currentPayload(access.row.id);
    if (!current) throw notFound();
    const me = access.user.id;
    return {
      ...current.payload,
      layout: access.row.setup.layout,
      scenario: access.row.setup.scenarioName,
      aerodrome: access.row.setup.aerodromeName,
      me: { id: me, instructor: access.instructor, position: access.position },
      forms: { GND: commandForms("GND"), TWR: commandForms("TWR") },
    };
  });

  route("POST", "/api/sessions/:id/seats", async (ctx) => {
    const access = await accessSession(ctx, sessionId(ctx));
    const body = await ctx.json();
    if (!isPosition(body.position)) throw formErrors({ position: "Position must be GND or TWR." });
    const position = body.position;
    return mutate(access.row.id, async (m) => {
      mustNotBeEnded(m.sim);
      const taken = await seatRows(m.client, access.row.id);
      const mine = taken.find((seat) => seat.user_id === access.user.id);
      if (mine?.position === position) return { position };
      if (mine) throw seatHeld();
      if (taken.some((seat) => seat.position === position)) throw seatTaken();
      await query(m.client, "INSERT INTO seats (session_id, position, user_id, disconnected_at) VALUES ($1, $2, $3, now())", [
        access.row.id,
        position,
        access.user.id,
      ]);
      return { position };
    });
  });

  route("DELETE", "/api/sessions/:id/seats/:position", async (ctx) => {
    const access = await accessSession(ctx, sessionId(ctx));
    if (!access.instructor) throw notFound();
    const position = ctx.params[1] ?? "";
    if (!isPosition(position)) throw notFound();
    await mutate(access.row.id, async (m) => {
      const seat = (await seatRows(m.client, access.row.id)).find((seat) => seat.position === position);
      if (!seat) return;
      if (seat.disconnected_at === null || !isGraceOver(seat.disconnected_at)) throw seatInUse();
      await query(m.client, "DELETE FROM seats WHERE session_id = $1 AND position = $2", [access.row.id, position]);
    });
    return reply(204);
  });

  route("POST", "/api/sessions/:id/commands", async (ctx) => {
    const access = await accessSession(ctx, sessionId(ctx));
    const position = seatOf(access);
    limitRate(access.row.id, position);
    const body = await ctx.json();
    const text = typeof body.text === "string" ? body.text : "";
    return mutate(access.row.id, (m) =>
      refusing(() => {
        mustBeRunning(m.sim);
        return executeCommand(m.sim, position, text);
      }),
    );
  });

  route("POST", "/api/sessions/:id/preview", async (ctx) => {
    const access = await accessSession(ctx, sessionId(ctx));
    const position = seatOf(access);
    const body = await ctx.json();
    const text = typeof body.text === "string" ? body.text : "";
    const current = await loadSession(pool, access.row.id);
    if (!current) throw notFound();
    const sim = simFromRow(current);
    const first = parseLine(text).words[0];
    const named = first === undefined ? undefined : findAircraft(sim, first);
    const callsign = named && named.frequency === position ? named.callsign : null;
    const none = { callsign, route: [] as string[], stop: null as string | null, conflicts: [] as { segment: string; rule: string }[] };
    if (callsign === null || sim.state.status !== "running") return none;
    try {
      const plan = planCommand(sim, position, text);
      if (plan.clearance.verb !== "TAXI" || !plan.route) return none;
      const point = plan.clearance.point;
      return {
        callsign,
        route: plan.route.flatMap((step) => (step.kind === "segment" ? [step.segment] : [])),
        stop: point,
        conflicts: previewConflicts(taxiConflicts(sim, plan.aircraft, plan.route, point), plan.route, point),
      };
    } catch (error) {
      if (error instanceof Refusal) return none;
      throw error;
    }
  });

  route("POST", "/api/sessions/:id/strips/:callsign/move", async (ctx) => {
    const access = await accessSession(ctx, sessionId(ctx));
    const position = seatOf(access);
    const callsign = ctx.params[1] ?? "";
    limitRate(access.row.id, position);
    const body = await ctx.json();
    await mutate(access.row.id, (m) =>
      refusing(() => {
        if (!findAircraft(m.sim, callsign)) throw notFound();
        mustBeRunning(m.sim);
        const errors: Record<string, string> = {};
        if (typeof body.to !== "string") errors.to = "Choose a bay.";
        if (!Number.isInteger(body.version)) errors.version = "Send the strip version.";
        if (Object.keys(errors).length > 0) throw formErrors(errors);
        if (!isCurrent(m.sim, callsign, body.version as number)) throw versionConflict(callsign);
        moveStrip(m.sim, position, callsign, body.to as string);
      }),
    );
    return { strip: callsign };
  });

  route("PATCH", "/api/sessions/:id/strips/:callsign", async (ctx) => {
    const access = await accessSession(ctx, sessionId(ctx));
    const position = seatOf(access);
    const callsign = ctx.params[1] ?? "";
    const body = await ctx.json();
    await mutate(access.row.id, (m) =>
      refusing(() => {
        if (!findAircraft(m.sim, callsign)) throw notFound();
        mustBeRunning(m.sim);
        const errors: Record<string, string> = {};
        if (typeof body.holdingPoint !== "string") errors.holdingPoint = "Enter a holding point.";
        if (typeof body.remarks !== "string") errors.remarks = "Enter remarks.";
        if (!Number.isInteger(body.version)) errors.version = "Send the strip version.";
        if (Object.keys(errors).length > 0) throw formErrors(errors);
        if (!isCurrent(m.sim, callsign, body.version as number)) throw versionConflict(callsign);
        editStrip(m.sim, position, callsign, body.holdingPoint as string, body.remarks as string);
      }),
    );
    return { strip: callsign };
  });

  route("POST", "/api/sessions/:id/events", async (ctx) => {
    const access = await accessSession(ctx, sessionId(ctx));
    if (!access.instructor) throw notFound();
    const body = await ctx.json();
    await mutate(access.row.id, (m) =>
      refusing(() => {
        mustNotBeEnded(m.sim);
        const kind = EVENT_KINDS.find((k) => k === body.kind);
        if (!kind) throw new Refusal(`Unknown event ${String(body.kind ?? "")}.`);
        const event: InjectedEvent = { kind };
        if (typeof body.callsign === "string") event.callsign = body.callsign;
        if (kind === "wind") {
          const fault = windFault(body.windDir, body.windKt);
          if (fault !== null) throw new Refusal(fault);
          event.windDir = Number(body.windDir);
          event.windKt = Number(body.windKt);
        }
        applyEvent(m.sim, event);
      }),
    );
    return { ok: true };
  });

  const control = (name: string, apply: (m: Mutation, body: Record<string, unknown>) => Promise<void> | void): void => {
    route("POST", `/api/sessions/:id/${name}`, async (ctx) => {
      const access = await accessSession(ctx, sessionId(ctx));
      if (!access.instructor) throw notFound();
      const body = await ctx.json();
      return mutate(access.row.id, async (m) => {
        mustNotBeEnded(m.sim);
        await apply(m, body);
        return { status: m.sim.state.status, speed: m.sim.state.speed };
      });
    });
  };
  control("pause", (m) => pause(m.sim));
  control("resume", async (m) => {
    resume(m.sim);
    await restartClock(m);
  });
  control("speed", async (m, body) => {
    const speed = readSpeed(body.speed);
    if (speed === null) throw formErrors({ speed: "Speed must be 1, 2 or 4." });
    setSpeed(m.sim, speed);
    await restartClock(m);
  });

  route("POST", "/api/sessions/:id/end", async (ctx) => {
    const access = await accessSession(ctx, sessionId(ctx));
    if (!access.instructor) throw notFound();
    await mutate(access.row.id, (m) => endSession(m.sim));
    return { status: "ended" };
  });

  route("POST", "/api/sessions/:id/notes", async (ctx) => {
    const access = await accessSession(ctx, sessionId(ctx));
    if (!access.instructor) throw notFound();
    const body = await ctx.json();
    const text = typeof body.text === "string" ? body.text.trim() : "";
    await mutate(access.row.id, (m) => {
      mustNotBeEnded(m.sim);
      if (text === "" || text.length > 500) throw formErrors({ text: "Note must be 1 to 500 characters." });
      pinNote(m.sim, text);
    });
    return reply(201, { ok: true });
  });

  route("GET", "/api/sessions/:id/debrief", async (ctx) => {
    const access = await accessOutcome(ctx, sessionId(ctx));
    return debriefOf(access);
  });

  route("GET", "/api/sessions/:id/replay", async (ctx) => {
    const access = await accessOutcome(ctx, sessionId(ctx));
    if (access.row.status !== "ended") throw running();
    const { state } = access.row;
    const length = state.simTime - state.firstSimTime;
    const asked = Number(ctx.url.searchParams.get("t") ?? 0);
    const t = Math.min(length, Math.max(0, Number.isInteger(asked) ? asked : 0));
    const frames = await query<{ frame: Frame }>(
      pool,
      "SELECT frame FROM session_frames WHERE session_id = $1 AND t <= $2 ORDER BY t DESC LIMIT 1",
      [access.row.id, t],
    );
    const frame = frames[0]?.frame ?? { aircraft: [], strips: [] };
    return { simTime: simClock(state.firstSimTime + t), aircraft: frame.aircraft, strips: frame.strips };
  });
}

interface LogRow {
  sim_time: number;
  position: string;
  kind: string;
  text: string;
  rule: string | null;
  severity: string | null;
  callsign: string | null;
}

export async function logOf(id: string): Promise<LogEntry[]> {
  const rows = await query<LogRow>(
    pool,
    "SELECT sim_time, position, kind, text, rule, severity, callsign FROM session_log WHERE session_id = $1 ORDER BY id",
    [id],
  );
  return rows.map((r) => ({
    simTime: r.sim_time,
    position: r.position as LogEntry["position"],
    kind: r.kind as LogEntry["kind"],
    text: r.text,
    ...(r.rule ? { rule: r.rule } : {}),
    ...(r.severity ? { severity: r.severity } : {}),
    ...(r.callsign ? { callsign: r.callsign } : {}),
  }));
}

/** The debrief of an ended exercise; before the end it is the published wait. */
async function debriefOf(access: Access): Promise<Record<string, unknown>> {
  if (access.row.status !== "ended") throw running();
  const { row } = access;
  const log = await logOf(row.id);
  const result = debrief(row.setup, row.state, timers, log);
  const seats = await seatRows(pool, row.id);
  const holder = (position: Position): string | null => seats.find((s) => s.position === position)?.name ?? null;
  return {
    score: result.score,
    passed: result.passed,
    breakdown: result.breakdown,
    log: log.map((entry) => ({ simTime: simClock(entry.simTime), position: entry.position, kind: entry.kind, text: entry.text })),
    scenario: row.setup.scenarioName,
    aerodrome: row.setup.aerodromeName,
    layout: row.setup.layout,
    length: row.state.simTime - row.state.firstSimTime,
    clocks: Array.from({ length: row.state.simTime - row.state.firstSimTime + 1 }, (_, t) => simClock(row.state.firstSimTime + t)),
    students: { GND: holder("GND"), TWR: holder("TWR") },
  };
}
