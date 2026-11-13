import { randomUUID } from 'node:crypto';
import { MAX_DECK_QUESTIONS } from '../shared/protocol.js';
import type { Deck, DeckSummary, Question, QuestionType } from '../shared/protocol.js';
import { query, withTransaction } from './db/pool.js';
import { deckFull, notFound, versionConflict } from './errors.js';
import { parseStoredSpec, type QuestionDraft } from './domain/questions.js';
import { parseStoredImage, type SnapshotImage } from './domain/room.js';
import { presignPictureUrl } from './images/minio.js';

interface QuestionRow {
  id: string;
  position: number;
  version: number;
  type: string;
  prompt: string;
  time_limit_seconds: number;
  spec: unknown;
  image: unknown;
}

const QUESTION_COLUMNS = 'id, position, version, type, prompt, time_limit_seconds, spec, image';

function questionType(raw: string): QuestionType {
  if (raw === 'estimate') return 'estimate';
  if (raw === 'sequence') return 'sequence';
  return 'multiple_choice';
}

function toQuestion(row: QuestionRow): Question {
  const type = questionType(row.type);
  const spec = parseStoredSpec(type, row.spec);
  const image = parseStoredImage(row.image);
  const common = {
    id: row.id,
    position: row.position,
    version: row.version,
    prompt: row.prompt,
    timeLimitSeconds: row.time_limit_seconds,
    image: image
      ? {
          status: 'attached' as const,
          contentType: image.contentType,
          bytes: image.bytes,
          previewUrl: presignPictureUrl(image.key),
        }
      : null,
  };
  if (spec.type === 'multiple_choice') {
    return { ...common, type: spec.type, options: spec.options, correctIndex: spec.correctIndex };
  }
  if (spec.type === 'estimate') {
    return {
      ...common,
      type: spec.type,
      min: spec.min,
      max: spec.max,
      step: spec.step,
      answer: spec.answer,
      tolerance: spec.tolerance,
      unit: spec.unit,
    };
  }
  return { ...common, type: spec.type, items: spec.items };
}

export async function listDecks(quizmasterId: string): Promise<DeckSummary[]> {
  const rows = await query<{
    id: string;
    title: string;
    version: number;
    question_count: number;
    updated_at: Date;
  }>(
    `SELECT d.id, d.title, d.version, d.updated_at,
       (SELECT count(*)::int FROM questions q WHERE q.deck_id = d.id) AS question_count
     FROM decks d WHERE d.quizmaster_id = $1 ORDER BY d.updated_at DESC, d.id`,
    [quizmasterId],
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    version: row.version,
    questionCount: row.question_count,
    updatedAt: row.updated_at.getTime(),
  }));
}

export async function readDeck(quizmasterId: string, deckId: string): Promise<Deck> {
  const decks = await query<{ id: string; title: string; version: number }>(
    'SELECT id, title, version FROM decks WHERE id = $1 AND quizmaster_id = $2',
    [deckId, quizmasterId],
  );
  const deck = decks[0];
  if (!deck) throw notFound();
  const rows = await query<QuestionRow>(
    `SELECT ${QUESTION_COLUMNS} FROM questions WHERE deck_id = $1 ORDER BY position`,
    [deckId],
  );
  return {
    id: deck.id,
    title: deck.title,
    version: deck.version,
    questions: rows.map(toQuestion),
  };
}

export async function createDeck(quizmasterId: string, title: string): Promise<Deck> {
  const id = randomUUID();
  await query('INSERT INTO decks (id, quizmaster_id, title) VALUES ($1, $2, $3)', [
    id,
    quizmasterId,
    title,
  ]);
  return { id, title, version: 1, questions: [] };
}

export async function renameDeck(
  quizmasterId: string,
  deckId: string,
  title: string,
  version: number,
): Promise<Deck> {
  const owned = await query<{ version: number }>(
    'SELECT version FROM decks WHERE id = $1 AND quizmaster_id = $2',
    [deckId, quizmasterId],
  );
  const current = owned[0];
  if (!current) throw notFound();
  if (current.version !== version) throw versionConflict(current.version);
  const updated = await query<{ id: string }>(
    `UPDATE decks SET title = $3, version = version + 1, updated_at = now()
     WHERE id = $1 AND version = $2 RETURNING id`,
    [deckId, version, title],
  );
  if (updated.length === 0) throw versionConflict(current.version);
  return readDeck(quizmasterId, deckId);
}

async function requireDeck(quizmasterId: string, deckId: string): Promise<void> {
  const rows = await query<{ id: string }>(
    'SELECT id FROM decks WHERE id = $1 AND quizmaster_id = $2',
    [deckId, quizmasterId],
  );
  if (rows.length === 0) throw notFound();
}

export async function addQuestion(
  quizmasterId: string,
  deckId: string,
  draft: QuestionDraft,
): Promise<Question> {
  await requireDeck(quizmasterId, deckId);
  const id = randomUUID();
  const row = await withTransaction(async (tx) => {
    await tx.query('SELECT id FROM decks WHERE id = $1 FOR UPDATE', [deckId]);
    const counted = await tx.queryOne<{ total: number }>(
      'SELECT count(*)::int AS total FROM questions WHERE deck_id = $1',
      [deckId],
    );
    const total = counted?.total ?? 0;
    if (total >= MAX_DECK_QUESTIONS) throw deckFull();
    const inserted = await tx.queryOne<QuestionRow>(
      `INSERT INTO questions (id, deck_id, position, type, prompt, time_limit_seconds, spec)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${QUESTION_COLUMNS}`,
      [id, deckId, total + 1, draft.type, draft.prompt, draft.timeLimitSeconds, specJson(draft)],
    );
    await tx.query('UPDATE decks SET updated_at = now() WHERE id = $1', [deckId]);
    return inserted;
  });
  if (!row) throw notFound();
  return toQuestion(row);
}

function specJson(draft: QuestionDraft): string {
  const { spec } = draft;
  if (spec.type === 'multiple_choice') {
    return JSON.stringify({ options: spec.options, correctIndex: spec.correctIndex });
  }
  if (spec.type === 'estimate') {
    return JSON.stringify({
      min: spec.min,
      max: spec.max,
      step: spec.step,
      answer: spec.answer,
      tolerance: spec.tolerance,
      unit: spec.unit,
    });
  }
  return JSON.stringify({ items: spec.items });
}

export async function saveQuestion(
  quizmasterId: string,
  deckId: string,
  questionId: string,
  draft: QuestionDraft,
  version: number,
): Promise<Question> {
  await requireDeck(quizmasterId, deckId);
  const existing = await query<{ version: number }>(
    'SELECT version FROM questions WHERE id = $1 AND deck_id = $2',
    [questionId, deckId],
  );
  const current = existing[0];
  if (!current) throw notFound();
  if (current.version !== version) throw versionConflict(current.version);
  const rows = await query<QuestionRow>(
    `UPDATE questions SET type = $4, prompt = $5, time_limit_seconds = $6, spec = $7,
       version = version + 1, updated_at = now()
     WHERE id = $1 AND deck_id = $2 AND version = $3 RETURNING ${QUESTION_COLUMNS}`,
    [questionId, deckId, version, draft.type, draft.prompt, draft.timeLimitSeconds, specJson(draft)],
  );
  const row = rows[0];
  if (!row) throw versionConflict(current.version);
  await query('UPDATE decks SET updated_at = now() WHERE id = $1', [deckId]);
  return toQuestion(row);
}

export async function deleteQuestion(
  quizmasterId: string,
  deckId: string,
  questionId: string,
): Promise<void> {
  await requireDeck(quizmasterId, deckId);
  await withTransaction(async (tx) => {
    const removed = await tx.queryOne<{ position: number }>(
      'DELETE FROM questions WHERE id = $1 AND deck_id = $2 RETURNING position',
      [questionId, deckId],
    );
    if (!removed) throw notFound();
    await tx.query(
      'UPDATE questions SET position = position - 1 WHERE deck_id = $1 AND position > $2',
      [deckId, removed.position],
    );
    await tx.query('UPDATE decks SET updated_at = now() WHERE id = $1', [deckId]);
  });
}

export interface QuestionForImage {
  id: string;
  deckId: string;
}

export async function requireQuestion(
  quizmasterId: string,
  deckId: string,
  questionId: string,
): Promise<QuestionForImage> {
  const rows = await query<{ id: string }>(
    `SELECT q.id FROM questions q JOIN decks d ON d.id = q.deck_id
     WHERE q.id = $1 AND q.deck_id = $2 AND d.quizmaster_id = $3`,
    [questionId, deckId, quizmasterId],
  );
  if (rows.length === 0) throw notFound();
  return { id: questionId, deckId };
}

export async function setQuestionImage(
  deckId: string,
  questionId: string,
  image: SnapshotImage | null,
): Promise<Question> {
  const rows = await query<QuestionRow>(
    `UPDATE questions SET image = $3, version = version + 1, updated_at = now()
     WHERE id = $1 AND deck_id = $2 RETURNING ${QUESTION_COLUMNS}`,
    [questionId, deckId, image === null ? null : JSON.stringify(image)],
  );
  const row = rows[0];
  if (!row) throw notFound();
  await query('UPDATE decks SET updated_at = now() WHERE id = $1', [deckId]);
  return toQuestion(row);
}
