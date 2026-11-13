import { WEEKDAYS } from "../shared/api.js";
import { one, transaction, type Db } from "./db.js";
import { insertUser } from "./domain/accounts.js";
import { insertTask, type NewTask } from "./domain/ordering.js";
import { hashPassword } from "./domain/passwords.js";
import { FIXTURES } from "./domain/quests.js";

const DEMO_PASSWORD = "deedfall-demo";

type SeedTask = Omit<NewTask, "difficulty" | "weekdays" | "priceCents"> &
  Partial<Pick<NewTask, "difficulty" | "weekdays" | "priceCents">> & { checklist?: [string, boolean][] };

const PLAYERS = [
  {
    username: "mira",
    timeZone: "Europe/Lisbon",
    dayStartHour: 0,
    level: 3,
    experience: 20,
    healthTenths: 425,
    goldCents: 1840,
    tasks: [
      { type: "habit", title: "Drink a glass of water", difficulty: "easy", value: 3 },
      { type: "habit", title: "Doomscroll after midnight", difficulty: "medium", value: -4 },
      { type: "daily", title: "Stretch for ten minutes", difficulty: "easy", weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri"], value: 0, streak: 4 },
      { type: "daily", title: "Read one chapter", difficulty: "medium", weekdays: [...WEEKDAYS], value: 6, streak: 12 },
      { type: "todo", title: "Book the dentist", difficulty: "hard", value: 0, checklist: [["Find the number", true], ["Call before noon", false]] },
      { type: "reward", title: "Fancy coffee", priceCents: 500 },
      { type: "reward", title: "Episode of a show", priceCents: 1200 },
    ] satisfies SeedTask[],
  },
  {
    username: "tomas",
    timeZone: "America/Toronto",
    dayStartHour: 6,
    level: 2,
    experience: 10,
    healthTenths: 500,
    goldCents: 725,
    tasks: [
      { type: "habit", title: "Take the stairs", difficulty: "easy", value: 0 },
      { type: "daily", title: "Walk the dog", difficulty: "easy", weekdays: [...WEEKDAYS], value: 0, streak: 0 },
      { type: "todo", title: "Return library books", difficulty: "trivial", value: 0 },
      { type: "reward", title: "New paperback", priceCents: 1500 },
    ] satisfies SeedTask[],
  },
  {
    username: "ines",
    timeZone: "Asia/Manila",
    dayStartHour: 4,
    level: 1,
    experience: 5,
    healthTenths: 380,
    goldCents: 200,
    tasks: [
      { type: "daily", title: "Practice guitar", difficulty: "medium", weekdays: ["Mon", "Wed", "Fri"], value: 0, streak: 2 },
      { type: "reward", title: "Bubble tea", priceCents: 650 },
    ] satisfies SeedTask[],
  },
];

async function seedTasks(db: Db, userId: string, tasks: SeedTask[]): Promise<void> {
  for (const task of tasks) {
    const created = await insertTask(db, userId, { difficulty: null, weekdays: null, priceCents: null, ...task });
    for (const [index, [text, checked]] of (task.checklist ?? []).entries()) {
      await db.query("INSERT INTO checklist_items (task_id, text, checked, position) VALUES ($1, $2, $3, $4)", [created.id, text, checked, index + 1]);
    }
  }
}

/** Seed the demo players, their party, the active quest and the chat once; running it again changes nothing. */
export async function seed(): Promise<void> {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  await transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(7306)");
    if (await one(db, "SELECT 1 FROM users WHERE username = 'mira'")) return;
    const ids = new Map<string, string>();
    for (const player of PLAYERS) {
      const created = await insertUser(db, { ...player, passwordHash, resting: false }, new Date());
      ids.set(player.username, created.id);
      await seedTasks(db, created.id, player.tasks);
    }
    const party = (await one<{ id: string }>(db, "INSERT INTO parties (name, leader_id) VALUES ('Lantern Crew', $1) RETURNING id", [ids.get("mira")]))!;
    for (const [position, name] of ["mira", "tomas", "ines"].entries()) {
      await db.query("UPDATE users SET party_id = $1, joined_party_at = now() + make_interval(secs => $3) WHERE id = $2", [party.id, ids.get(name), position * 0.001]);
    }
    const quest = (await one<{ id: string }>(
      db,
      `INSERT INTO quests (party_id, name, state, boss_health_tenths, invited_at, started_at)
       VALUES ($1, $2, 'active', 2126, now(), now()) RETURNING id`,
      [party.id, FIXTURES[0]!.name],
    ))!;
    for (const name of ["mira", "tomas", "ines"]) {
      await db.query("INSERT INTO quest_responses (quest_id, user_id, accepted) VALUES ($1, $2, true)", [quest.id, ids.get(name)]);
    }
    const strikes: [string, number, number][] = [["mira", 1000, 3000], ["tomas", 600, 2400], ["ines", 274, 2126]];
    for (const [index, [name, amount, after]] of strikes.entries()) {
      await db.query(
        "INSERT INTO quest_events (quest_id, seq, kind, user_id, amount_tenths, boss_health_after_tenths) VALUES ($1, $2, 'strike', $3, $4, $5)",
        [quest.id, index + 1, ids.get(name), amount, after],
      );
    }
    const chat: [string, string][] = [["mira", "Drowsewyrm is wobbling. One more push tonight."], ["tomas", "Walking the dog counts, right?"]];
    for (const [name, text] of chat) {
      await db.query("INSERT INTO chat_messages (party_id, user_id, text) VALUES ($1, $2, $3)", [party.id, ids.get(name), text]);
    }
  });
}
