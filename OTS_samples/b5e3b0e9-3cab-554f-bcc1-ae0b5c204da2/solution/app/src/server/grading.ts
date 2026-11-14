import { timingSafeEqual } from "node:crypto";
import { config } from "./config.ts";
import { addMember } from "./classroom.ts";
import { pool, query, newId } from "./db.ts";
import { parseSimClock } from "./domain/clock.ts";
import { Refusal, endSession, executeCommand, moveStrip, setSpeed, type StripSeed } from "./domain/engine.ts";
import type { Position } from "./domain/grammar.ts";
import { checkLayoutFile } from "./domain/layout.ts";
import type { Bay } from "./domain/state.ts";
import { readSpeed } from "./domain/rules.ts";
import { GROUND_BAYS, POSITIONS, TOWER_BAYS } from "../shared/wire.ts";
import { formErrors, layoutInvalid, notFound } from "./errors.ts";
import { reply, route, type Ctx } from "./http.ts";
import { hashPassword, hashToken, newToken, normaliseEmail } from "./auth.ts";
import { aerodromeFor } from "./aerodromes.ts";
import { readScenario, scenarioFor } from "./scenarios.ts";
import { createSession } from "./exercise.ts";
import { setHold } from "./live.ts";
import { loadSession, mutate, runTicks, restartClock } from "./sessions.ts";
import { simClock } from "./domain/clock.ts";

const SETUP_LIMIT = 5_000_000;

type Kind = "school" | "class" | "aerodrome" | "scenario" | "assignment" | "session";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const records = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.filter(isRecord) : []);
const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** Every grading route needs the grading key; without it, or with a wrong one, the route does not exist. */
function requireKey(ctx: Ctx): void {
  const given = Buffer.from(String(ctx.req.headers["x-grading-key"] ?? ""));
  const expected = Buffer.from(config.gradingKey);
  if (expected.length === 0 || given.length !== expected.length || !timingSafeEqual(given, expected)) throw notFound();
}

async function remember(kind: Kind, key: string, id: string): Promise<void> {
  await query(pool, "INSERT INTO grading_keys (kind, key, id) VALUES ($1, $2, $3) ON CONFLICT (kind, key) DO UPDATE SET id = EXCLUDED.id", [kind, key, id]);
}

async function recall(kind: Kind, key: string): Promise<string> {
  const rows = await query<{ id: string }>(pool, "SELECT id FROM grading_keys WHERE kind = $1 AND key = $2", [kind, key]);
  const found = rows[0];
  if (!found) throw formErrors({ [kind]: `No ${kind} with key ${key}.` });
  return found.id;
}

async function userIdByEmail(email: string): Promise<string> {
  const rows = await query<{ id: string }>(pool, "SELECT id FROM users WHERE lower(email) = $1", [normaliseEmail(email)]);
  const found = rows[0];
  if (!found) throw formErrors({ users: `No user ${email}.` });
  return found.id;
}

const BAYS: readonly string[] = [...GROUND_BAYS, ...TOWER_BAYS];
const isBay = (value: string): value is Bay => BAYS.includes(value);

function seedOf(raw: Record<string, unknown>): StripSeed {
  const bay = text(raw.bay);
  if (!isBay(bay)) throw formErrors({ strips: `Unknown bay ${bay}.` });
  return {
    callsign: text(raw.callsign),
    bay,
    ...(raw.frequency === "GND" || raw.frequency === "TWR" ? { frequency: raw.frequency } : {}),
    ...(typeof raw.segment === "string" ? { segment: raw.segment } : {}),
    ...(typeof raw.progress === "number" ? { progress: raw.progress } : {}),
    ...(typeof raw.node === "string" ? { node: raw.node } : {}),
    ...(typeof raw.dueSeconds === "number" ? { dueSeconds: raw.dueSeconds } : {}),
    ...(typeof raw.takeoffStart === "string" ? { takeoffStart: parseSimClock(raw.takeoffStart) ?? 0 } : {}),
    ...(typeof raw.cleared === "string" ? { cleared: raw.cleared } : {}),
  };
}

interface Created {
  users: { email: string; id: string }[];
  schools: Record<string, { id: string; classes: Record<string, string> }>;
  scenarios: Record<string, string>;
  aerodromes: Record<string, string>;
  assignments: Record<string, string>;
  sessions: Record<string, string>;
  invites: { email: string; url: string }[];
}

async function setUsers(created: Created, body: Record<string, unknown>): Promise<void> {
  for (const user of records(body.users)) {
    const email = normaliseEmail(user.email);
    const existing = await query<{ id: string }>(pool, "SELECT id FROM users WHERE lower(email) = $1", [email]);
    const id = existing[0]?.id ?? newId();
    if (!existing[0]) {
      await query(pool, "INSERT INTO users (id, name, email, password_hash, verified) VALUES ($1, $2, $3, $4, $5)", [
        id,
        text(user.name),
        email,
        await hashPassword(text(user.password)),
        user.verified === true,
      ]);
    }
    created.users.push({ email, id });
  }
}

async function setSchools(created: Created, body: Record<string, unknown>): Promise<void> {
  for (const school of records(body.schools)) {
    const instructor = await userIdByEmail(text(school.instructor));
    const known = await query<{ id: string }>(pool, "SELECT id FROM schools WHERE instructor_id = $1", [instructor]);
    const id = known[0]?.id ?? newId();
    if (!known[0]) await query(pool, "INSERT INTO schools (id, name, instructor_id) VALUES ($1, $2, $3)", [id, text(school.name), instructor]);
    await remember("school", text(school.key), id);
    const classes: Record<string, string> = {};
    for (const cls of records(school.classes)) {
      const classId = newId();
      await query(pool, "INSERT INTO classes (id, school_id, name) VALUES ($1, $2, $3)", [classId, id, text(cls.name)]);
      for (const email of Array.isArray(cls.students) ? cls.students : []) await addMember(classId, await userIdByEmail(text(email)));
      await remember("class", text(cls.key), classId);
      classes[text(cls.key)] = classId;
    }
    created.schools[text(school.key)] = { id, classes };
  }
}

async function setAerodromes(created: Created, body: Record<string, unknown>): Promise<void> {
  for (const aerodrome of records(body.aerodromes)) {
    const checked = checkLayoutFile(Buffer.from(JSON.stringify(aerodrome.layout ?? null)));
    if (!checked.ok) throw layoutInvalid(checked.lines);
    const id = newId();
    await query(pool, "INSERT INTO aerodromes (id, school_id, name, code, layout) VALUES ($1, NULL, $2, $3, $4)", [
      id,
      checked.layout.name,
      checked.layout.code,
      JSON.stringify(checked.layout),
    ]);
    await remember("aerodrome", text(aerodrome.key), id);
    created.aerodromes[text(aerodrome.key)] = id;
  }
}

async function setScenarios(created: Created, body: Record<string, unknown>): Promise<void> {
  for (const scenario of records(body.scenarios)) {
    const schoolId = await recall("school", text(scenario.school));
    const named = text(scenario.aerodrome);
    const aerodromeId = ["wrenfield", "kestrel-down"].includes(named) ? named : await recall("aerodrome", named);
    await query(pool, "UPDATE aerodromes SET school_id = $2 WHERE id = $1 AND school_id IS NULL", [aerodromeId, schoolId]);
    const aerodrome = await aerodromeFor(aerodromeId, schoolId);
    const doc = readScenario({ ...scenario, aerodrome: aerodromeId }, aerodrome.layout);
    const id = newId();
    await query(pool, "INSERT INTO scenarios (id, school_id, name, doc) VALUES ($1, $2, $3, $4)", [id, schoolId, doc.name, JSON.stringify(doc)]);
    await remember("scenario", text(scenario.key), id);
    created.scenarios[text(scenario.key)] = id;
  }
}

async function setAssignments(created: Created, body: Record<string, unknown>): Promise<void> {
  for (const assignment of records(body.assignments)) {
    const id = newId();
    await query(pool, "INSERT INTO assignments (id, class_id, scenario_id, due_on) VALUES ($1, $2, $3, $4)", [
      id,
      await recall("class", text(assignment.class)),
      await recall("scenario", text(assignment.scenario)),
      text(assignment.dueOn),
    ]);
    await remember("assignment", text(assignment.key), id);
    created.assignments[text(assignment.key)] = id;
  }
}

async function setInvites(created: Created, body: Record<string, unknown>): Promise<void> {
  for (const invite of records(body.invites)) {
    const token = newToken();
    const hours = typeof invite.sentHoursAgo === "number" ? invite.sentHoursAgo : 0;
    await query(
      pool,
      `INSERT INTO invitations (id, class_id, email, token_hash, sent_at, used_at)
       VALUES ($1, $2, $3, $4, now() - ($5 || ' hours')::interval, CASE WHEN $6 THEN now() END)`,
      [newId(), await recall("class", text(invite.class)), normaliseEmail(invite.email), hashToken(token), String(hours), invite.status === "used"],
    );
    created.invites.push({ email: normaliseEmail(invite.email), url: `${config.publicUrl}/invite/${token}` });
  }
}

async function setSessions(created: Created, body: Record<string, unknown>): Promise<void> {
  for (const spec of records(body.sessions)) {
    const scenarioId = await recall("scenario", text(spec.scenario));
    const scenarioRow = (await query<{ school_id: string }>(pool, "SELECT school_id FROM scenarios WHERE id = $1", [scenarioId]))[0];
    if (!scenarioRow) throw notFound();
    const scenario = await scenarioFor(scenarioId, scenarioRow.school_id);
    const assignmentId = spec.assignment === undefined ? null : await recall("assignment", text(spec.assignment));
    const first = typeof spec.simTime === "string" ? parseSimClock(spec.simTime) : null;
    const { id } = await createSession({
      schoolId: scenarioRow.school_id,
      scenarioId,
      doc: scenario.doc,
      assignmentId,
      ...(first !== null ? { firstSimTime: first } : {}),
      seeds: records(spec.strips).map(seedOf),
    });
    const seats = isRecord(spec.seats) ? spec.seats : {};
    for (const position of POSITIONS) {
      if (typeof seats[position] === "string") {
        await query(pool, "INSERT INTO seats (session_id, position, user_id, disconnected_at) VALUES ($1, $2, $3, now())", [
          id,
          position,
          await userIdByEmail(seats[position]),
        ]);
      }
    }
    if (Array.isArray(spec.script) || typeof spec.endAt === "number") {
      await runScript(id, records(spec.script), typeof spec.endAt === "number" ? spec.endAt : null);
    }
    await remember("session", text(spec.key), id);
    created.sessions[text(spec.key)] = id;
  }
}

/** Plays a script through the real command and move paths at its sim times, then carries on to endAt. */
async function runScript(id: string, steps: Record<string, unknown>[], endAt: number | null): Promise<void> {
  await mutate(id, (m) => {
    const first = m.sim.state.firstSimTime;
    const ordered = steps.map((step, order) => ({ step, order })).sort((a, b) => Number(a.step.at) - Number(b.step.at) || a.order - b.order);
    for (const { step } of ordered) {
      const due = first + Number(step.at);
      if (m.sim.state.status !== "running") break;
      runTicks(m, Math.max(0, due - m.sim.state.simTime));
      const position: Position = step.position === "TWR" ? "TWR" : "GND";
      try {
        if (typeof step.command === "string") executeCommand(m.sim, position, step.command);
        else if (isRecord(step.move)) moveStrip(m.sim, position, text(step.move.callsign), text(step.move.to));
      } catch (error) {
        if (!(error instanceof Refusal)) throw error;
      }
      m.checkpoint();
    }
    if (endAt !== null) {
      const stop = first + endAt;
      while (m.sim.state.status === "running" && m.sim.state.simTime < stop) runTicks(m, 1);
      if (m.sim.state.status === "running") {
        endSession(m.sim);
        m.checkpoint();
      }
    }
  });
}

export function registerGradingRoutes(): void {
  route("POST", "/api/grading/setup", async (ctx) => {
    requireKey(ctx);
    const body = await ctx.json(SETUP_LIMIT);
    const created: Created = { users: [], schools: {}, scenarios: {}, aerodromes: {}, assignments: {}, sessions: {}, invites: [] };
    await setUsers(created, body);
    await setSchools(created, body);
    await setAerodromes(created, body);
    await setScenarios(created, body);
    await setAssignments(created, body);
    await setInvites(created, body);
    await setSessions(created, body);
    return reply(201, created);
  });

  route("POST", "/api/grading/sessions/:id/clock", async (ctx) => {
    requireKey(ctx);
    const body = await ctx.json();
    const id = ctx.params[0] ?? "";
    if (!(await loadSession(pool, id))) throw notFound();
    return mutate(id, async (m) => {
      if (body.speed !== undefined) {
        const speed = readSpeed(body.speed);
        if (speed === null) throw formErrors({ speed: "Speed must be 1, 2 or 4." });
        setSpeed(m.sim, speed);
        await restartClock(m);
      }
      if (typeof body.advance === "number" && body.advance > 0) runTicks(m, Math.floor(body.advance));
      return { simTime: simClock(m.sim.state.simTime), state: m.sim.state.status };
    });
  });

  route("POST", "/api/grading/sessions/:id/hold-updates", async (ctx) => {
    requireKey(ctx);
    const body = await ctx.json();
    const id = ctx.params[0] ?? "";
    if (!(await loadSession(pool, id))) throw notFound();
    if ((body.position !== "GND" && body.position !== "TWR") || typeof body.hold !== "boolean") {
      throw formErrors({ position: "Position must be GND or TWR." });
    }
    setHold(id, body.position, body.hold);
    return { ok: true };
  });
}
