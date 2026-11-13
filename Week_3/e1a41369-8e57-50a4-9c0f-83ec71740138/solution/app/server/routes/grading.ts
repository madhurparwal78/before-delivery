import { timingSafeEqual } from "node:crypto";
import { DIFFICULTIES, type Difficulty, type TaskType, type Weekday } from "../../shared/api.js";
import { config } from "../config.js";
import { HttpError, Message, Refusal } from "../errors.js";
import { one, transaction, type Db } from "../db.js";
import { insertUser, isPassword, isUsername, validateDayStartHour, validateZone } from "../domain/accounts.js";
import { runDueCloses } from "../domain/close.js";
import { FULL_HEALTH_TENTHS } from "../domain/progress.js";
import { insertTask, moveTask } from "../domain/ordering.js";
import { hashPassword } from "../domain/passwords.js";
import { fixtureNamed } from "../domain/quests.js";
import { priceCentsOf, titleOf, weekdaysOf } from "../domain/taskinput.js";
import { reply, route } from "../http.js";
import { serialized } from "../mutate.js";
import { UNIQUE_VIOLATION, asObject } from "./auth.js";

/** Grading routes answer 404 unless the token header equals the configured token. */
function requireToken(header: string | undefined): void {
  const expected = config.gradingToken;
  if (expected === undefined || header === undefined) throw Refusal.notFound();
  const given = Buffer.from(header);
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) throw Refusal.notFound();
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const list = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.map(asObject) : []);
const number = (value: unknown, fallback: number): number => (typeof value === "number" ? value : fallback);

interface UserSpec {
  username: string;
  password: string;
  timeZone: string;
  dayStartHour: number;
  level: number;
  experience: number;
  healthTenths: number;
  goldCents: number;
  resting: boolean;
  currentDate?: string;
}

function checkUsers(input: Record<string, unknown>[], errors: Record<string, string>): void {
  input.forEach((raw, index) => {
    const at = (field: string) => `users[${index}].${field}`;
    if (!isUsername(raw.username)) errors[at("username")] = Message.username;
    if (!isPassword(raw.password)) errors[at("password")] = Message.password;
    if (raw.timeZone !== undefined && validateZone(raw.timeZone) === undefined) errors[at("timeZone")] = Message.timeZone;
    if (raw.dayStartHour !== undefined && validateDayStartHour(raw.dayStartHour) === undefined) errors[at("dayStartHour")] = Message.dayStartHour;
    if (raw.currentDate !== undefined && !(typeof raw.currentDate === "string" && DATE.test(raw.currentDate))) errors[at("currentDate")] = "Use a date as YYYY-MM-DD.";
  });
}

function toSpec(raw: Record<string, unknown>): UserSpec {
  return {
    username: raw.username as string,
    password: raw.password as string,
    timeZone: raw.timeZone === undefined ? "UTC" : validateZone(raw.timeZone)!,
    dayStartHour: raw.dayStartHour === undefined ? 0 : (raw.dayStartHour as number),
    level: number(raw.level, 1),
    experience: number(raw.experience, 0),
    healthTenths: Math.round(number(raw.health, FULL_HEALTH_TENTHS / 10) * 10),
    goldCents: Math.round(number(raw.gold, 0) * 100),
    resting: raw.resting === true,
    currentDate: raw.currentDate as string | undefined,
  };
}

route("POST", "/api/grading/setup", async (context) => {
  requireToken(context.header("x-grading-token"));
  const body = context.json(asObject);
  const errors: Record<string, string> = {};
  const users = list(body.users);
  checkUsers(users, errors);
  const known = new Set(users.map((raw) => String(raw.username)));
  const parties = list(body.parties);
  const quests = list(body.quests);
  const tasks = list(body.tasks);
  parties.forEach((party, index) => {
    if (typeof party.name !== "string" || !party.name) errors[`parties[${index}].name`] = Message.name;
    if (!known.has(String(party.leader))) errors[`parties[${index}].leader`] = Message.inviteTarget;
    (Array.isArray(party.members) ? party.members : []).forEach((member, at) => {
      if (!known.has(String(member))) errors[`parties[${index}].members[${at}]`] = Message.inviteTarget;
    });
  });
  const partyNames = new Set(parties.map((party) => String(party.name)));
  quests.forEach((quest, index) => {
    if (!partyNames.has(String(quest.party))) errors[`quests[${index}].party`] = Message.name;
    if (!fixtureNamed(String(quest.quest))) errors[`quests[${index}].quest`] = Message.quest;
    if (quest.state !== "invited" && quest.state !== "active") errors[`quests[${index}].state`] = Message.quest;
  });
  tasks.forEach((task, index) => {
    const at = (field: string) => `tasks[${index}].${field}`;
    if (!known.has(String(task.owner))) errors[at("owner")] = Message.inviteTarget;
    if (!["habit", "daily", "todo", "reward"].includes(String(task.type))) errors[at("type")] = Message.type;
    if (titleOf(task.title) === undefined) errors[at("title")] = Message.title;
    if (task.type !== "reward" && !DIFFICULTIES.includes(task.difficulty as Difficulty)) errors[at("difficulty")] = Message.difficulty;
    if (task.type === "daily" && weekdaysOf(task.weekdays) === undefined) errors[at("weekdays")] = Message.weekdays;
    if (task.type === "reward" && priceCentsOf(task.price) === undefined) errors[at("price")] = Message.price;
  });
  if (Object.keys(errors).length > 0) throw new HttpError(422, { errors });

  const specs = users.map(toSpec);
  const hashes = await Promise.all(specs.map((spec) => hashPassword(spec.password)));
  const created = await serialized(() =>
    transaction(async (db) => {
      const createdUsers: Record<string, { id: string; today: string; nextCloseAt: string }> = {};
      const ids = new Map<string, string>();
      for (const [index, spec] of specs.entries()) {
        const user = await insertUser(
          db,
          { ...spec, passwordHash: hashes[index]!, healthTenths: spec.healthTenths, openDate: spec.currentDate },
          new Date(),
        );
        ids.set(spec.username, user.id);
        createdUsers[spec.username] = { id: user.id, today: user.today, nextCloseAt: user.nextCloseAt.toISOString() };
      }
      const partyIds: Record<string, string> = {};
      for (const party of parties) {
        const name = String(party.name);
        const leader = ids.get(String(party.leader))!;
        const row = (await one<{ id: string }>(db, "INSERT INTO parties (name, leader_id) VALUES ($1, $2) RETURNING id", [name, leader]))!;
        partyIds[name] = row.id;
        const members = [String(party.leader), ...(party.members as string[])];
        for (const [position, member] of members.entries()) {
          await db.query("UPDATE users SET party_id = $1, joined_party_at = now() + make_interval(secs => $3) WHERE id = $2", [row.id, ids.get(member), position * 0.001]);
        }
      }
      const questIds: Record<string, string> = {};
      for (const quest of quests) {
        const partyName = String(quest.party);
        const fixture = fixtureNamed(String(quest.quest))!;
        const leaderId = (await one<{ leader_id: string }>(db, "SELECT leader_id FROM parties WHERE id = $1", [partyIds[partyName]]))!.leader_id;
        const health = typeof quest.bossHealth === "number" ? Math.round(quest.bossHealth * 10) : fixture.maxHealthTenths;
        const row = (await one<{ id: string }>(
          db,
          `INSERT INTO quests (party_id, name, state, boss_health_tenths, invited_at, started_at)
           VALUES ($1, $2, $3, $4, now(), CASE WHEN $3 = 'active' THEN now() END) RETURNING id`,
          [partyIds[partyName], fixture.name, quest.state, health],
        ))!;
        questIds[partyName] = row.id;
        const accepted = Array.isArray(quest.acceptedBy) ? (quest.acceptedBy as string[]).map((name) => ids.get(name)!) : [leaderId];
        for (const userId of accepted) await db.query("INSERT INTO quest_responses (quest_id, user_id, accepted) VALUES ($1, $2, true)", [row.id, userId]);
      }
      const taskIds: Record<string, Record<string, string>> = {};
      for (const task of tasks) {
        const owner = String(task.owner);
        const id = await createTask(db, ids.get(owner)!, task);
        (taskIds[owner] ??= {})[String(task.title)] = id;
      }
      return { users: createdUsers, parties: partyIds, quests: questIds, tasks: taskIds };
    }),
  ).catch((error: unknown) => {
    throw (error as { code?: string }).code === UNIQUE_VIOLATION ? Refusal.usernameTaken() : error;
  });
  return reply(201, created);
});

async function createTask(db: Db, userId: string, task: Record<string, unknown>): Promise<string> {
  const type = task.type as TaskType;
  const created = await insertTask(db, userId, {
    type,
    title: titleOf(task.title)!,
    difficulty: type === "reward" ? null : (task.difficulty as Difficulty),
    weekdays: type === "daily" ? (weekdaysOf(task.weekdays) as Weekday[]) : null,
    priceCents: type === "reward" ? (priceCentsOf(task.price) as number) : null,
    value: number(task.value, 0),
    streak: number(task.streak, 0),
    done: task.done === true,
  });
  for (const [index, item] of list(task.checklist).entries()) {
    await db.query("INSERT INTO checklist_items (task_id, text, checked, position) VALUES ($1, $2, $3, $4)", [created.id, String(item.text), item.checked === true, index + 1]);
  }
  if (typeof task.position === "number" && task.position >= 1 && task.position < created.position) await moveTask(db, created, task.position);
  return created.id;
}

route("POST", "/api/grading/rollover", async (context) => {
  requireToken(context.header("x-grading-token"));
  const at = new Date(String(context.json((body) => asObject(body).at)));
  const closes = await serialized(() => runDueCloses(at));
  return reply(200, { closes });
});

