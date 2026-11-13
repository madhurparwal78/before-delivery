import { randomUUID } from "node:crypto";
import { z } from "zod";
import { deckQuestionSchema, type Deck, type DeckQuestion, type DeckSummary } from "../shared/schemas.js";
import { nowMs } from "./clock.js";
import { pool, transaction, type Tx } from "./db.js";
import { apiError, fieldsOf, notFound, validationFailed } from "./errors.js";
import { storePicture } from "./pictures.js";
import { parseQuestionInput, storedFields } from "./questionRules.js";
import { isUuid } from "./ids.js";
import { presignGet, statObject } from "./s3.js";
import { storedImageSchema } from "./rooms/snapshot.js";

const DECK_LIMIT = 50;

type DeckRow = { id: string; title: string; version: number };
type QuestionRow = {
  id: string;
  position: number;
  version: number;
  type: string;
  prompt: string;
  time_limit_seconds: number;
  fields: Record<string, unknown>;
  image: unknown;
};

const QUESTION_COLUMNS = "id, position, version, type, prompt, time_limit_seconds, fields, image";
const titleBody = z.object({
  title: z.string("Title must be 1 to 80 characters").trim().min(1, "Title must be 1 to 80 characters").max(80, "Title must be 1 to 80 characters"),
});

function parseTitle(body: unknown): string {
  const parsed = titleBody.safeParse(body);
  if (!parsed.success) throw validationFailed(fieldsOf(parsed.error));
  return parsed.data.title;
}

function questionView(row: QuestionRow): DeckQuestion {
  const image = row.image === null ? null : storedImageSchema.parse(row.image);
  return deckQuestionSchema.parse({
    ...row.fields,
    id: row.id,
    position: row.position,
    version: row.version,
    type: row.type,
    prompt: row.prompt,
    timeLimitSeconds: row.time_limit_seconds,
    image: image && { status: "attached", contentType: image.contentType, bytes: image.bytes, previewUrl: presignGet(image.key) },
  });
}

async function ownedDeck(db: Tx | typeof pool, quizmasterId: string, deckId: string, lock = false): Promise<DeckRow> {
  if (!isUuid(deckId)) throw notFound();
  const found = await db.query<DeckRow>(`SELECT id, title, version FROM decks WHERE id = $1 AND quizmaster_id = $2${lock ? " FOR UPDATE" : ""}`, [deckId, quizmasterId]);
  const row = found.rows[0];
  if (!row) throw notFound();
  return row;
}

async function readQuestion(db: Tx | typeof pool, deckId: string, questionId: string): Promise<QuestionRow> {
  if (!isUuid(questionId)) throw notFound();
  const found = await db.query<QuestionRow>(`SELECT ${QUESTION_COLUMNS} FROM questions WHERE id = $1 AND deck_id = $2`, [questionId, deckId]);
  const row = found.rows[0];
  if (!row) throw notFound();
  return row;
}

const touch = (db: Tx | typeof pool, deckId: string): Promise<unknown> => db.query("UPDATE decks SET updated_at = $2 WHERE id = $1", [deckId, nowMs()]);

export async function listDecks(quizmasterId: string): Promise<DeckSummary[]> {
  const rows = await pool.query<{ id: string; title: string; version: number; question_count: number; updated_at: string }>(
    `SELECT d.id, d.title, d.version, d.updated_at, (SELECT count(*)::int FROM questions q WHERE q.deck_id = d.id) AS question_count
     FROM decks d WHERE d.quizmaster_id = $1 ORDER BY d.updated_at DESC, d.title`,
    [quizmasterId],
  );
  return rows.rows.map((r) => ({ id: r.id, title: r.title, version: r.version, questionCount: r.question_count, updatedAt: Number(r.updated_at) }));
}

export async function readDeck(quizmasterId: string, deckId: string): Promise<Deck> {
  const deck = await ownedDeck(pool, quizmasterId, deckId);
  const questions = await pool.query<QuestionRow>(`SELECT ${QUESTION_COLUMNS} FROM questions WHERE deck_id = $1 ORDER BY position`, [deck.id]);
  return { id: deck.id, title: deck.title, version: deck.version, questions: questions.rows.map(questionView) };
}

export async function createDeck(quizmasterId: string, body: unknown): Promise<Deck> {
  const title = parseTitle(body);
  const id = randomUUID();
  await pool.query("INSERT INTO decks (id, quizmaster_id, title, version, updated_at) VALUES ($1, $2, $3, 1, $4)", [id, quizmasterId, title, nowMs()]);
  return { id, title, version: 1, questions: [] };
}

const versionOf = (body: unknown): number => {
  const parsed = z.object({ version: z.number().int() }).safeParse(body);
  if (!parsed.success) throw validationFailed({ version: "Version is required" });
  return parsed.data.version;
};

function versionConflict(currentVersion: number): never {
  throw apiError(412, "version_conflict", { currentVersion });
}

export async function renameDeck(quizmasterId: string, deckId: string, body: unknown): Promise<Deck> {
  const deck = await ownedDeck(pool, quizmasterId, deckId);
  const version = versionOf(body);
  if (version !== deck.version) versionConflict(deck.version);
  const title = parseTitle(body);
  const updated = await pool.query("UPDATE decks SET title = $3, version = version + 1, updated_at = $4 WHERE id = $1 AND version = $2", [deck.id, version, title, nowMs()]);
  if (!updated.rowCount) versionConflict((await ownedDeck(pool, quizmasterId, deckId)).version);
  return readDeck(quizmasterId, deckId);
}

export async function addQuestion(quizmasterId: string, deckId: string, body: unknown): Promise<DeckQuestion> {
  const row = await transaction(async (tx) => {
    const deck = await ownedDeck(tx, quizmasterId, deckId, true);
    const count = await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM questions WHERE deck_id = $1", [deck.id]);
    const existing = (count.rows[0] as { n: number }).n;
    if (existing >= DECK_LIMIT) throw apiError(409, "deck_full");
    const input = parseQuestionInput(body);
    const inserted = await tx.query<QuestionRow>(
      `INSERT INTO questions (id, deck_id, position, version, type, prompt, time_limit_seconds, fields)
       VALUES (gen_random_uuid(), $1, $2, 1, $3, $4, $5, $6) RETURNING ${QUESTION_COLUMNS}`,
      [deck.id, existing + 1, input.type, input.prompt, input.timeLimitSeconds, JSON.stringify(storedFields(input))],
    );
    await touch(tx, deck.id);
    return inserted.rows[0] as QuestionRow;
  });
  return questionView(row);
}

export async function saveQuestion(quizmasterId: string, deckId: string, questionId: string, body: unknown): Promise<DeckQuestion> {
  const deck = await ownedDeck(pool, quizmasterId, deckId);
  const current = await readQuestion(pool, deck.id, questionId);
  const version = versionOf(body);
  if (version !== current.version) versionConflict(current.version);
  const input = parseQuestionInput(body);
  const updated = await pool.query<QuestionRow>(
    `UPDATE questions SET type = $3, prompt = $4, time_limit_seconds = $5, fields = $6, version = version + 1
     WHERE id = $1 AND deck_id = $2 AND version = $7 RETURNING ${QUESTION_COLUMNS}`,
    [questionId, deck.id, input.type, input.prompt, input.timeLimitSeconds, JSON.stringify(storedFields(input)), version],
  );
  const row = updated.rows[0];
  if (!row) versionConflict((await readQuestion(pool, deck.id, questionId)).version);
  await touch(pool, deck.id);
  return questionView(row);
}

export async function deleteQuestion(quizmasterId: string, deckId: string, questionId: string): Promise<void> {
  await transaction(async (tx) => {
    const deck = await ownedDeck(tx, quizmasterId, deckId, true);
    const question = await readQuestion(tx, deck.id, questionId);
    await tx.query("DELETE FROM questions WHERE id = $1", [questionId]);
    await tx.query("UPDATE questions SET position = position - 1 WHERE deck_id = $1 AND position > $2", [deck.id, question.position]);
    await touch(tx, deck.id);
  });
}

export async function attachPicture(quizmasterId: string, deckId: string, questionId: string, file: Buffer | null): Promise<DeckQuestion> {
  const deck = await ownedDeck(pool, quizmasterId, deckId);
  await readQuestion(pool, deck.id, questionId);
  const image = await storePicture(questionId, file);
  const updated = await pool.query<QuestionRow>(
    `UPDATE questions SET image = $3, version = version + 1 WHERE id = $1 AND deck_id = $2 RETURNING ${QUESTION_COLUMNS}`,
    [questionId, deck.id, JSON.stringify(image)],
  );
  const row = updated.rows[0];
  if (!row) throw notFound();
  await touch(pool, deck.id);
  return questionView(row);
}

export async function removePicture(quizmasterId: string, deckId: string, questionId: string): Promise<void> {
  const deck = await ownedDeck(pool, quizmasterId, deckId);
  const question = await readQuestion(pool, deck.id, questionId);
  if (question.image === null) return;
  await statObject(storedImageSchema.parse(question.image).key);
  await pool.query("UPDATE questions SET image = NULL, version = version + 1 WHERE id = $1 AND deck_id = $2", [questionId, deck.id]);
  await touch(pool, deck.id);
}
