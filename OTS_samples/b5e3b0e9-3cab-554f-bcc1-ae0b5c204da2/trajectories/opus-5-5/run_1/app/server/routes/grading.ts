import { config, timers } from '../config.js';
import { hashPassword, type User } from '../auth.js';
import { newId, one, query } from '../db.js';
import { ApiError, type Ctx, notFound, ok, type Router } from '../http.js';
import { BUILT_IN, validateLayout } from '../layouts.js';
import { createSession, type LiveSession, POSITIONS, requireSession } from '../live.js';
import { type Engine, signatureOf } from '../sim/engine.js';
import type { Leg, Scenario } from '../sim/model.js';
import { findRoute } from '../sim/routes.js';
import { parseClock } from '../../shared/time.js';
import type { Bay, Position } from '../../shared/types.js';
import { createInvitation, inviteUrl, normaliseEmail } from './accounts.js';
import { insertAerodrome, insertScenario, validateScenario } from './library.js';
import { resolveScenario, takeSeat } from './sessions.js';

type Obj = Record<string, unknown>;

const SETUP_LIMIT = 5_000_000;

const list = (value: unknown): Obj[] => (Array.isArray(value) ? (value as Obj[]) : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

function requireKey(ctx: Ctx): void {
  const given = ctx.req.headers['x-grading-key'];
  if (!config.gradingKey || given !== config.gradingKey) throw notFound();
}

async function remember(kind: string, key: string, id: string): Promise<void> {
  await query(
    'INSERT INTO grading_keys (kind, key, id) VALUES ($1, $2, $3) ON CONFLICT (kind, key) DO UPDATE SET id = EXCLUDED.id',
    [kind, key, id],
  );
}

async function lookup(kind: string, key: string): Promise<string> {
  const row = await one<{ id: string }>('SELECT id FROM grading_keys WHERE kind = $1 AND key = $2', [kind, key]);
  if (!row) throw new ApiError(422, { errors: { [kind]: `Unknown ${kind} key ${key}.` } });
  return row.id;
}

async function userByEmail(email: string): Promise<User> {
  const user = await one<User>('SELECT * FROM users WHERE email = $1', [normaliseEmail(email)]);
  if (!user) throw new ApiError(422, { errors: { users: `Unknown user ${email}.` } });
  return user;
}

function trafficDefaults(item: Obj): Obj {
  return {
    type: 'C172',
    wake: 'L',
    rules: 'VFR',
    kind: 'dep',
    stand: null,
    holdingPoint: null,
    runway: null,
    appearAt: 0,
    dueSeconds: null,
    slotSeconds: null,
    overrunsHold: false,
    ...item,
  };
}

function scenarioDefaults(item: Obj, aerodrome: string): Obj {
  return {
    runwayInUse: '27',
    windDir: 270,
    windKt: 5,
    startSimTime: '12:00:00',
    durationSeconds: 3600,
    seed: 0,
    readbackErrorEvery: null,
    events: [],
    ...item,
    aerodrome,
    traffic: list(item.traffic).map(trafficDefaults),
  };
}

/** Puts a scenario aircraft and its strip into the bay a grading session starts it in. */
function place(engine: Engine, spec: Obj): void {
  const callsign = text(spec.callsign);
  const item = engine.scenario.traffic.find((traffic) => traffic.callsign === callsign);
  if (!item) throw new ApiError(422, { errors: { strips: `Unknown callsign ${callsign}.` } });
  const s = engine.state;
  if (!s.aircraft[callsign]) engine.appear(item);
  const aircraft = s.aircraft[callsign]!;
  const strip = s.strips[callsign]!;
  const bay = text(spec.bay) as Bay;
  const hp = item.holdingPoint ?? '';
  const segment = typeof spec.segment === 'string' && spec.segment ? spec.segment : null;
  const node = typeof spec.node === 'string' && spec.node ? spec.node : null;

  const taxiTowardsHold = () => {
    aircraft.status = 'taxiing';
    aircraft.stop = hp;
    aircraft.routeBy = 'GND';
    if (segment) {
      const seg = engine.airfield.segments.get(segment);
      if (!seg) throw new ApiError(422, { errors: { strips: `Unknown segment ${segment}.` } });
      const directions: Leg[] = [
        { kind: 'seg', id: seg.id, from: seg.from, to: seg.to },
        { kind: 'seg', id: seg.id, from: seg.to, to: seg.from },
      ];
      aircraft.segment = seg.id;
      aircraft.node = null;
      aircraft.progress = typeof spec.progress === 'number' ? spec.progress : 0;
      for (const leg of directions) {
        aircraft.legs = [leg];
        const legs = leg.to === hp ? [leg] : findRoute(engine.airfield, aircraft, hp, []);
        if (legs) {
          aircraft.legs = legs;
          return;
        }
      }
      throw new ApiError(422, { errors: { strips: `No route to ${hp} from ${segment}.` } });
    }
    aircraft.segment = null;
    aircraft.node = node ?? item.stand;
    aircraft.progress = 0;
    if (aircraft.node === hp) {
      aircraft.status = 'holding';
      aircraft.legs = [];
      return;
    }
    const legs = findRoute(engine.airfield, aircraft, hp, []);
    if (!legs) throw new ApiError(422, { errors: { strips: `No route to ${hp} from ${aircraft.node}.` } });
    aircraft.legs = legs;
  };

  switch (bay) {
    case 'Pending':
      break;
    case 'Pushback':
      aircraft.status = 'ready';
      break;
    case 'Taxi':
    case 'Hand-off':
    case 'Incoming':
      taxiTowardsHold();
      if (bay !== 'Taxi') strip.offer = { expiresAt: s.now + timers.handoffOfferSeconds, seq: 0 };
      break;
    case 'Holding':
      if (segment) taxiTowardsHold();
      else {
        aircraft.status = 'holding';
        aircraft.node = node ?? hp;
        aircraft.stop = aircraft.node;
      }
      strip.frequency = 'TWR';
      break;
    case 'Line up':
      aircraft.status = 'lined-up';
      aircraft.node = hp;
      aircraft.runwayEntry = s.seq + 1;
      s.seq += 1;
      strip.frequency = 'TWR';
      break;
    case 'Departed': {
      const raw = spec.takeoffStart;
      const start =
        typeof raw === 'number' ? engine.startTime + raw : (parseClock(text(raw)) ?? s.now);
      aircraft.takeoffStart = start;
      aircraft.node = hp;
      const rolled = s.now - start;
      if (rolled < timers.takeoffRollSeconds) {
        aircraft.status = 'rolling';
        aircraft.timer = timers.takeoffRollSeconds - rolled;
        s.seq += 1;
        aircraft.runwayEntry = s.seq;
      } else {
        aircraft.status = 'airborne';
      }
      if (!s.lastTakeoff || s.lastTakeoff.start <= start) s.lastTakeoff = { callsign, wake: item.wake, start };
      strip.frequency = 'TWR';
      break;
    }
    case 'Arrivals':
      aircraft.due = typeof spec.dueSeconds === 'number' ? spec.dueSeconds : item.dueSeconds;
      break;
    case 'Landed':
      aircraft.status = 'vacated';
      aircraft.due = null;
      break;
    default:
      throw new ApiError(422, { errors: { strips: `Unknown bay ${bay}.` } });
  }
  engine.setBay(strip, bay === 'Incoming' ? 'Hand-off' : bay);
  if (strip.offer) strip.offer.seq = strip.seq;
  if (spec.frequency === 'GND' || spec.frequency === 'TWR') strip.frequency = spec.frequency;
  if (typeof spec.cleared === 'string') strip.cleared = spec.cleared || null;
  strip.signature = signatureOf(strip);
}

async function runScript(session: LiveSession, script: Obj[], endAt: number | null): Promise<void> {
  const engine = session.engine;
  const elapsed = () => engine.state.now - engine.state.firstTime;
  const tickTo = async (second: number) => {
    while (elapsed() < second && engine.state.status === 'running') await session.run(() => engine.tick());
  };
  for (const item of script) {
    await tickTo(typeof item.at === 'number' ? item.at : 0);
    if (engine.state.status !== 'running') break;
    const position = text(item.position) as Position;
    if (!POSITIONS.includes(position)) continue;
    await session.run(() => {
      if (typeof item.command === 'string') {
        engine.command(position, item.command);
        return;
      }
      const move = (item.move ?? {}) as Obj;
      const callsign = text(move.callsign).toUpperCase();
      const strip = engine.state.strips[callsign];
      if (strip) engine.move(position, callsign, text(move.to), strip.version);
    });
  }
  if (endAt !== null) {
    await tickTo(endAt);
    await session.run(() => engine.end());
  }
}

export function registerGradingRoutes(router: Router): void {
  router.add('POST', '/api/grading/setup', async (ctx) => {
    requireKey(ctx);
    const body = await ctx.json(SETUP_LIMIT);
    const out = {
      users: [] as { email: string; id: string }[],
      schools: {} as Record<string, { id: string; classes: Record<string, string> }>,
      scenarios: {} as Record<string, string>,
      aerodromes: {} as Record<string, string>,
      assignments: {} as Record<string, string>,
      sessions: {} as Record<string, string>,
      invites: [] as { email: string; url: string }[],
    };

    for (const entry of list(body.users)) {
      const email = normaliseEmail(text(entry.email));
      const hash = await hashPassword(text(entry.password));
      const verified = entry.verified !== false;
      const existing = await one<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
      const id = existing?.id ?? newId();
      if (existing) {
        await query('UPDATE users SET name = $2, password_hash = $3, verified = $4 WHERE id = $1', [id, text(entry.name), hash, verified]);
      } else {
        await query('INSERT INTO users (id, email, name, password_hash, verified) VALUES ($1, $2, $3, $4, $5)', [
          id,
          email,
          text(entry.name),
          hash,
          verified,
        ]);
      }
      out.users.push({ email, id });
    }

    for (const entry of list(body.schools)) {
      const instructor = await userByEmail(text(entry.instructor));
      const existing = await one<{ id: string }>('SELECT id FROM schools WHERE instructor_id = $1', [instructor.id]);
      const schoolId = existing?.id ?? newId();
      if (!existing) {
        await query('INSERT INTO schools (id, name, instructor_id) VALUES ($1, $2, $3)', [schoolId, text(entry.name), instructor.id]);
      }
      await remember('school', text(entry.key), schoolId);
      const classes: Record<string, string> = {};
      for (const cls of list(entry.classes)) {
        const classId = newId();
        await query('INSERT INTO classes (id, school_id, name) VALUES ($1, $2, $3)', [classId, schoolId, text(cls.name)]);
        for (const email of Array.isArray(cls.students) ? (cls.students as string[]) : []) {
          const student = await userByEmail(email);
          await query('INSERT INTO class_students (class_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [classId, student.id]);
        }
        await remember('class', text(cls.key), classId);
        classes[text(cls.key)] = classId;
      }
      out.schools[text(entry.key)] = { id: schoolId, classes };
    }

    for (const entry of list(body.aerodromes)) {
      const result = validateLayout(Buffer.from(JSON.stringify(entry.layout ?? null)));
      if (!result.ok) throw new ApiError(422, { error: 'layout_invalid', lines: result.lines });
      const id = await insertAerodrome(null, result.layout, false);
      await remember('aerodrome', text(entry.key), id);
      out.aerodromes[text(entry.key)] = id;
    }

    for (const entry of list(body.scenarios)) {
      const schoolId = await lookup('school', text(entry.school));
      const ref = text(entry.aerodrome) || 'wrenfield';
      const aerodrome = BUILT_IN.some((built) => built.id === ref) ? ref : await lookup('aerodrome', ref);
      const scenario = await validateScenario(scenarioDefaults(entry, aerodrome), schoolId);
      const id = await insertScenario(schoolId, scenario);
      await remember('scenario', text(entry.key), id);
      out.scenarios[text(entry.key)] = id;
    }

    for (const entry of list(body.assignments)) {
      const classId = await lookup('class', text(entry.class));
      const scenarioId = await lookup('scenario', text(entry.scenario));
      const id = newId();
      await query('INSERT INTO assignments (id, class_id, scenario_id, due_on) VALUES ($1, $2, $3, $4)', [
        id,
        classId,
        scenarioId,
        text(entry.dueOn),
      ]);
      await remember('assignment', text(entry.key), id);
      out.assignments[text(entry.key)] = id;
    }

    for (const entry of list(body.invites)) {
      const classId = await lookup('class', text(entry.class));
      const hours = typeof entry.sentHoursAgo === 'number' ? entry.sentHoursAgo : 0;
      const email = normaliseEmail(text(entry.email));
      const token = await createInvitation(classId, email, new Date(Date.now() - hours * 3600_000), entry.status === 'used');
      out.invites.push({ email, url: inviteUrl(token) });
    }

    for (const entry of list(body.sessions)) {
      const scenarioId = await lookup('scenario', text(entry.scenario));
      const scenarioRow = await one<{ school_id: string; data: Scenario }>('SELECT school_id, data FROM scenarios WHERE id = $1', [
        scenarioId,
      ]);
      const schoolId = scenarioRow!.school_id;
      const assignmentId = entry.assignment ? await lookup('assignment', text(entry.assignment)) : null;
      const { scenario, aerodrome } = await resolveScenario(schoolId, scenarioId, assignmentId);
      const firstTime = typeof entry.simTime === 'string' ? parseClock(entry.simTime) : null;
      const session = await createSession({
        schoolId,
        scenarioId,
        assignmentId,
        scenario,
        aerodromeName: aerodrome.name,
        layout: aerodrome.layout,
        firstTime,
        prepare: (engine) => {
          for (const spec of list(entry.strips)) place(engine, spec);
        },
      });
      const seats = (entry.seats ?? {}) as Record<string, string>;
      for (const position of POSITIONS) {
        if (!seats[position]) continue;
        const user = await userByEmail(seats[position]);
        await session.run(() => takeSeat(session, user, position));
      }
      await runScript(session, list(entry.script), typeof entry.endAt === 'number' ? entry.endAt : null);
      await remember('session', text(entry.key), session.id);
      out.sessions[text(entry.key)] = session.id;
    }

    return ok(out, 201);
  });

  router.add('POST', '/api/grading/sessions/:id/clock', async (ctx) => {
    requireKey(ctx);
    const session = await requireSession(ctx.params.id!);
    const body = await ctx.json();
    const speed = body.speed;
    if (speed !== undefined) {
      if (speed !== 1 && speed !== 2 && speed !== 4) throw new ApiError(422, { errors: { speed: 'Speed must be 1, 2 or 4.' } });
      await session.run(() => {
        session.engine.state.speed = speed;
      });
    }
    const advance = typeof body.advance === 'number' ? Math.max(0, Math.floor(body.advance)) : 0;
    for (let i = 0; i < advance && session.engine.state.status === 'running'; i++) {
      await session.run(() => {
        if (session.engine.state.status === 'running') session.engine.tick();
      });
    }
    return ok({ simTime: session.engine.simClock, state: session.engine.state.status });
  });

  router.add('POST', '/api/grading/sessions/:id/hold-updates', async (ctx) => {
    requireKey(ctx);
    const session = await requireSession(ctx.params.id!);
    const body = await ctx.json();
    const position = text(body.position) as Position;
    if (!POSITIONS.includes(position) || typeof body.hold !== 'boolean') {
      throw new ApiError(422, { errors: { position: 'Position must be GND or TWR and hold true or false.' } });
    }
    const hold = body.hold;
    await session.run(() => session.hold(position, hold), 'none');
    return ok({ position, hold });
  });
}

