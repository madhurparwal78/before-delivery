import { timingSafeEqual } from "node:crypto";
import type { Hono } from "hono";
import { config } from "../config";
import { pool, transaction } from "../db";
import { isRealDate } from "../../shared/calendar";
import type { Edition, Frequency, Status } from "../../shared/types";
import { toCents } from "../domain/money";
import { toIso } from "../domain/labels";
import { DEFAULT_REMINDER_HOUR } from "../domain/reminders";
import { periodsFrom } from "../domain/schedule";
import { isKnownZone } from "../domain/zone";
import { type Ctx, type Env, isUuid, reply } from "../http/context";
import { invalid, notFound } from "../http/errors";
import { insertClient, registerInState } from "../store/clients";
import { cancelPendingReminders } from "../store/returns";
import { createPractice, createSession, createUser, emailTaken, getPractice, nowOf } from "../store/practice";
import { insertCatalogue, insertState, getStates } from "../store/states";
import { setPracticeClock } from "../services/clock";
import { dispatchMail } from "../services/outbox";
import { renderSeeded } from "../services/packets";
import { Check, MESSAGES, asObject, editionFrom } from "../validation";

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const isInstant = (value: unknown): value is string => typeof value === "string" && INSTANT.test(value) && !Number.isNaN(Date.parse(value));
const SEEDABLE: Status[] = ["not_started", "prepared", "client_approved", "filed", "packeted"];

function requireGradingKey(c: Ctx): void {
  const given = Buffer.from(c.req.header("x-grading-key") ?? "");
  const wanted = Buffer.from(config.gradingKey);
  if (!wanted.length || given.length !== wanted.length || !timingSafeEqual(given, wanted)) throw notFound();
}

interface Plan {
  bookkeeper: { displayName: string; email: string; password: string; reminderHour: number };
  now: string | null;
  states: { code: string; name: string; zone: string; holidays: string[]; editions: Edition[] }[] | null;
  clients: {
    key: string; name: string; owner: { displayName: string; email: string; password: string };
    registrations: {
      key: string; state: string; frequency: Frequency; firstPeriod: string;
      returns: { period: string; status: Status; gross: string | null; tax: string | null }[];
    }[];
  }[];
}

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function parsePlan(raw: unknown): { plan: Plan; check: Check } {
  const body = asObject(raw);
  const check = new Check();
  const bk = asObject(body.bookkeeper);
  const bookkeeper = {
    displayName: check.displayName("bookkeeper.display_name", bk.display_name, MESSAGES.yourName),
    email: check.email("bookkeeper.email", bk.email),
    password: check.password("bookkeeper.password", bk.password),
    reminderHour: bk.reminder_hour === undefined ? DEFAULT_REMINDER_HOUR : check.integer("bookkeeper.reminder_hour", bk.reminder_hour, 6, 21, MESSAGES.reminderHour),
  };
  if (body.now !== undefined && !isInstant(body.now)) check.fail("now", MESSAGES.instant);
  const states = body.states === undefined ? null : list(body.states).map((entry, i) => {
    const s = asObject(entry);
    const at = `states[${i}]`;
    if (typeof s.code !== "string" || !s.code.trim()) check.fail(`${at}.code`, MESSAGES.state);
    if (typeof s.name !== "string" || !s.name.trim()) check.fail(`${at}.name`, MESSAGES.businessName);
    if (typeof s.zone !== "string" || !isKnownZone(s.zone)) check.fail(`${at}.zone`, MESSAGES.zone);
    const holidays = list(s.holidays);
    if (!holidays.every((d) => typeof d === "string" && isRealDate(d))) check.fail(`${at}.holidays`, MESSAGES.holidays);
    const editions = list(s.editions).map((e, j) => editionFrom(check, `${at}.editions[${j}].`, asObject(e)));
    if (!editions.length) check.fail(`${at}.editions`, MESSAGES.editions);
    return { code: String(s.code), name: String(s.name), zone: String(s.zone), holidays: holidays as string[], editions };
  });
  const knownCodes = new Set(states?.map((s) => s.code));
  const emails = new Set([bookkeeper.email.toLowerCase()]);
  const clients = list(body.clients).map((entry, i) => {
    const c = asObject(entry);
    const at = `clients[${i}]`;
    const owner = asObject(c.owner);
    const ownerEmail = check.email(`${at}.owner.email`, owner.email);
    if (emails.has(ownerEmail.toLowerCase())) check.fail(`${at}.owner.email`, MESSAGES.emailTaken);
    emails.add(ownerEmail.toLowerCase());
    const registrations = list(c.registrations).map((r, j) => {
      const reg = asObject(r);
      const rat = `${at}.registrations[${j}]`;
      if (typeof reg.state !== "string" || (states && !knownCodes.has(reg.state))) check.fail(`${rat}.state`, MESSAGES.state);
      const frequency = check.frequency(`${rat}.frequency`, reg.frequency);
      const firstPeriod = check.firstPeriod(`${rat}.first_period`, reg.frequency, reg.first_period);
      const valid = !(`${rat}.frequency` in check.errors) && !(`${rat}.first_period` in check.errors);
      const returns = list(reg.returns).map((entry2, k) => {
        const ret = asObject(entry2);
        const rt = `${rat}.returns[${k}]`;
        if (valid && !periodsFrom(frequency, firstPeriod).includes(String(ret.period))) check.fail(`${rt}.period`, MESSAGES.firstPeriod);
        const status = (ret.status ?? "not_started") as Status;
        if (!SEEDABLE.includes(status)) check.fail(`${rt}.status`, MESSAGES.status);
        const given = (key: string): string | null => {
          if (ret[key] === undefined) return null;
          return check.amount(`${rt}.${key}`, ret[key]);
        };
        return { period: String(ret.period), status, gross: given("gross_sales"), tax: given("tax_due") };
      });
      return { key: String(reg.key), state: String(reg.state), frequency, firstPeriod, returns };
    });
    return {
      key: String(c.key), name: check.displayName(`${at}.name`, c.name, MESSAGES.businessName),
      owner: {
        displayName: check.displayName(`${at}.owner.display_name`, owner.display_name, MESSAGES.ownerName),
        email: ownerEmail, password: check.password(`${at}.owner.password`, owner.password),
      },
      registrations,
    };
  });
  return { plan: { bookkeeper, now: (body.now as string | undefined) ?? null, states, clients }, check };
}

export function registerGrading(app: Hono<Env>): void {
  app.post("/api/grading/fixture", async (c) => {
    requireGradingKey(c);
    const { plan, check } = parsePlan(c.get("body"));
    for (const email of [plan.bookkeeper.email, ...plan.clients.map((cl) => cl.owner.email)]) {
      if (email && (await emailTaken(pool, email))) {
        check.fail(email === plan.bookkeeper.email ? "bookkeeper.email" : `clients[${plan.clients.findIndex((cl) => cl.owner.email === email)}].owner.email`,
          MESSAGES.emailTaken);
      }
    }
    check.done();
    const answer = await transaction(async (db) => {
      const practiceId = await createPractice(db, plan.bookkeeper.reminderHour, plan.now);
      const bookkeeperId = await createUser(db, { practiceId, clientId: null, displayName: plan.bookkeeper.displayName,
        email: plan.bookkeeper.email, password: plan.bookkeeper.password, role: "bookkeeper" });
      if (plan.states) for (const s of plan.states) await insertState(db, practiceId, s);
      else await insertCatalogue(db, practiceId);
      const states = await getStates(db, practiceId);
      const practice = await getPractice(db, practiceId);
      const seededAt = toIso(nowOf(practice));
      const clients: Record<string, unknown> = {};
      for (const client of plan.clients) {
        const clientId = await insertClient(db, practiceId, client.name);
        const ownerId = await createUser(db, { practiceId, clientId, displayName: client.owner.displayName,
          email: client.owner.email, password: client.owner.password, role: "owner" });
        const registrations: Record<string, unknown> = {};
        for (const reg of client.registrations) {
          const made = await registerInState(db, { practiceId, clientId, state: states.find((s) => s.code === reg.state)!,
            frequency: reg.frequency, firstPeriod: reg.firstPeriod, reminderHour: practice.reminderHour,
            changedBy: plan.bookkeeper.displayName });
          for (const seed of reg.returns) {
            const id = made.returnIds[seed.period];
            const open = seed.status === "not_started";
            const gross = seed.gross ?? (open ? null : "0.00");
            const tax = seed.tax ?? (open ? null : "0.00");
            const filed = seed.status === "filed" || seed.status === "packeted";
            await db.query(
              `UPDATE returns SET status = $2, gross_cents = $3, tax_cents = $4, awaiting_approval = $5, filed_at = $6 WHERE id = $1`,
              [id, filed ? "filed" : seed.status, gross && toCents(gross), tax && toCents(tax), seed.status === "prepared",
                filed ? seededAt : null]);
            if (seed.status === "client_approved" || filed) {
              await db.query("INSERT INTO approvals (return_id, action, by_name, at) VALUES ($1, 'approved', $2, $3)",
                [id, client.owner.displayName, seededAt]);
            }
            if (filed) await cancelPendingReminders(db, id);
            if (seed.status === "packeted") await renderSeeded(db, id);
          }
          registrations[reg.key] = { id: made.registration.id, returns: made.returnIds };
        }
        clients[client.key] = { id: clientId, owner_session: await createSession(db, ownerId), registrations };
      }
      return { practice_id: practiceId, session: await createSession(db, bookkeeperId), clients };
    });
    await dispatchMail(answer.practice_id);
    return reply(answer, 201);
  });

  app.post("/api/grading/clock", async (c) => {
    requireGradingKey(c);
    const body = asObject(c.get("body"));
    const practiceId = typeof body.practice_id === "string" ? body.practice_id : "";
    if (!isUuid(practiceId) || !(await practiceExists(practiceId))) throw notFound();
    if (!isInstant(body.now)) throw invalid({ now: MESSAGES.instant });
    await setPracticeClock(practiceId, Date.parse(body.now));
    return reply({ now: body.now });
  });
}

async function practiceExists(id: string): Promise<boolean> {
  return (await pool.query("SELECT 1 FROM practices WHERE id = $1", [id])).rowCount === 1;
}

