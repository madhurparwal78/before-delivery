import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";
import type { QuestionType } from "../shared/schemas.js";
import { hashPassword } from "./passwords.js";
import { freezeFields } from "./rooms/snapshot.js";

type SeedQuestion = { type: QuestionType; prompt: string; seconds: number; fields: Record<string, unknown> };

const INES = "5a1f6d1e-0c1b-4f7a-9a52-3f0d8a7b1001";
const ROWAN = "5a1f6d1e-0c1b-4f7a-9a52-3f0d8a7b1002";
const TUESDAY_DECK = "5a1f6d1e-0c1b-4f7a-9a52-3f0d8a7b2001";
const PRACTICE_DECK = "5a1f6d1e-0c1b-4f7a-9a52-3f0d8a7b2002";
const THURSDAY_DECK = "5a1f6d1e-0c1b-4f7a-9a52-3f0d8a7b2003";
const SEED_NIGHT = "5a1f6d1e-0c1b-4f7a-9a52-3f0d8a7b3001";
const NIGHT_ENDED_AT = Date.UTC(2026, 9, 27, 21, 40);
const NIGHT_STANDINGS: [string, number][] = [
  ["Quizzly Bears", 3120],
  ["Les Quizerables", 2980],
  ["Pint Sized", 2410],
  ["Agatha Quiztie", 1875],
  ["The Lone Ranger", 920],
];

const tuesdayQuestions: SeedQuestion[] = [
  {
    type: "multiple_choice",
    prompt: "Which planet has the shortest day?",
    seconds: 20,
    fields: { options: ["Jupiter", "Mars", "Earth", "Venus"], correctIndex: 0 },
  },
  {
    type: "estimate",
    prompt: "How many keys does a standard piano have?",
    seconds: 25,
    fields: { min: 40, max: 120, step: 1, answer: 88, tolerance: 4, unit: "keys" },
  },
  {
    type: "sequence",
    prompt: "Put these inventions in order, earliest first.",
    seconds: 30,
    fields: { items: ["Printing press", "Steam engine", "Telephone", "World Wide Web"] },
  },
  {
    type: "multiple_choice",
    prompt: "What is the chemical symbol for gold?",
    seconds: 15,
    fields: { options: ["Ag", "Au", "Gd", "Go"], correctIndex: 1 },
  },
];

const thursdayQuestions: SeedQuestion[] = [
  {
    type: "multiple_choice",
    prompt: "How many sides does a hexagon have?",
    seconds: 20,
    fields: { options: ["5", "6", "7", "8"], correctIndex: 1 },
  },
];

async function seedQuizmaster(db: pg.ClientBase, id: string, email: string, password: string, displayName: string): Promise<void> {
  const found = await db.query("SELECT 1 FROM quizmasters WHERE id = $1", [id]);
  if (found.rowCount) return;
  await db.query(
    "INSERT INTO quizmasters (id, email, email_key, display_name, password_hash, created_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING",
    [id, email, email.toLowerCase(), displayName, await hashPassword(password), Date.now()],
  );
}

async function seedDeck(db: pg.ClientBase, id: string, owner: string, title: string, questions: SeedQuestion[]): Promise<void> {
  const inserted = await db.query(
    "INSERT INTO decks (id, quizmaster_id, title, version, updated_at) VALUES ($1, $2, $3, 1, $4) ON CONFLICT DO NOTHING",
    [id, owner, title, Date.now()],
  );
  if (!inserted.rowCount) return;
  for (const [position, q] of questions.entries()) {
    await db.query(
      "INSERT INTO questions (id, deck_id, position, version, type, prompt, time_limit_seconds, fields) VALUES (gen_random_uuid(), $1, $2, 1, $3, $4, $5, $6)",
      [id, position + 1, q.type, q.prompt, q.seconds, JSON.stringify(q.fields)],
    );
  }
}

function seatIdFor(nickname: string): string {
  const hex = createHash("sha1").update(`${SEED_NIGHT}:${nickname}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function seedNight(db: pg.ClientBase): Promise<void> {
  const inserted = await db.query(
    `INSERT INTO rooms (id, quizmaster_id, deck_title, pin, state, question_index, question_count, created_at, ended_at, end_reason)
     VALUES ($1, $2, 'Tuesday at The Gilded Tap', '000000', 'ended', $3, $3, $4, $5, 'host') ON CONFLICT DO NOTHING`,
    [SEED_NIGHT, INES, tuesdayQuestions.length, NIGHT_ENDED_AT - 3_600_000, NIGHT_ENDED_AT],
  );
  if (!inserted.rowCount) return;
  for (const [index, q] of tuesdayQuestions.entries()) {
    await db.query(
      "INSERT INTO room_questions (room_id, index, type, prompt, time_limit_ms, source_version, fields) VALUES ($1, $2, $3, $4, $5, 1, $6)",
      [SEED_NIGHT, index + 1, q.type, q.prompt, q.seconds * 1000, JSON.stringify(freezeFields(q.type, q.fields))],
    );
  }
  for (const [place, [nickname, score]] of NIGHT_STANDINGS.entries()) {
    const seatId = seatIdFor(nickname);
    const cumulativeMs = 20_000 * (place + 1);
    await db.query(
      `INSERT INTO seats (id, room_id, nickname, nickname_key, rejoin_token_hash, join_seq, joined_at, score, streak, cumulative_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9)`,
      [seatId, SEED_NIGHT, nickname, nickname.toLowerCase(), randomBytes(32).toString("hex"), place + 1, NIGHT_ENDED_AT - 3_000_000, score, cumulativeMs],
    );
    await db.query(
      "INSERT INTO standings (room_id, seat_id, nickname, score, streak, cumulative_ms, rank) VALUES ($1, $2, $3, $4, 0, $5, $6)",
      [SEED_NIGHT, seatId, nickname, score, cumulativeMs, place + 1],
    );
  }
}

// Idempotent: every row is written only when it is missing.
export async function seedSql(db: pg.ClientBase): Promise<void> {
  await seedQuizmaster(db, INES, "ines@corkline.example", "tally-pour-2026", "Ines Talbot");
  await seedQuizmaster(db, ROWAN, "rowan@corkline.example", "second-round-77", "Rowan Pike");
  await seedDeck(db, TUESDAY_DECK, INES, "Tuesday at The Gilded Tap", tuesdayQuestions);
  await seedDeck(db, PRACTICE_DECK, INES, "Practice deck", []);
  await seedDeck(db, THURSDAY_DECK, ROWAN, "Thursday Mix", thursdayQuestions);
  await seedNight(db);
}
