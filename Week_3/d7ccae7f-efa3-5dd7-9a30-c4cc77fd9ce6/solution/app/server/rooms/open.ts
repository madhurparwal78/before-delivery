import { randomInt } from "node:crypto";
import { PIN_LENGTH } from "../../shared/schemas.js";
import { nowMs } from "../clock.js";
import { isUniqueViolation, transaction } from "../db.js";
import { apiError, notFound, validationFailed } from "../errors.js";
import { isUuid } from "../ids.js";
import { freezeFields } from "./snapshot.js";
import { watchRoom } from "./timers.js";

const PIN_ATTEMPTS = 25;
const newPin = (): string => String(randomInt(0, 10 ** PIN_LENGTH)).padStart(PIN_LENGTH, "0");

type DeckQuestionRow = { position: number; version: number; type: "multiple_choice" | "estimate" | "sequence"; prompt: string; time_limit_seconds: number; fields: Record<string, unknown>; image: unknown };

// Opens a room: freezes the deck's questions for the night and starts it in the lobby with a fresh PIN.
export async function openRoom(quizmasterId: string, deckId: string): Promise<string> {
  if (!isUuid(deckId)) throw notFound();
  const roomId = await transaction(async (tx) => {
    const deck = await tx.query<{ title: string }>("SELECT title FROM decks WHERE id = $1 AND quizmaster_id = $2", [deckId, quizmasterId]);
    if (!deck.rows[0]) throw notFound();
    const questions = await tx.query<DeckQuestionRow>(
      "SELECT position, version, type, prompt, time_limit_seconds, fields, image FROM questions WHERE deck_id = $1 ORDER BY position",
      [deckId],
    );
    if (questions.rows.length === 0) throw validationFailed({ deckId: "Deck has no questions" });
    for (let attempt = 0; attempt < PIN_ATTEMPTS; attempt++) {
      await tx.query("SAVEPOINT pin");
      try {
        const created = await tx.query<{ id: string }>(
          `INSERT INTO rooms (id, quizmaster_id, deck_title, pin, state, question_count, created_at)
           VALUES (gen_random_uuid(), $1, $2, $3, 'lobby', $4, $5) RETURNING id`,
          [quizmasterId, deck.rows[0].title, newPin(), questions.rows.length, nowMs()],
        );
        const id = (created.rows[0] as { id: string }).id;
        for (const q of questions.rows) {
          await tx.query(
            `INSERT INTO room_questions (room_id, index, type, prompt, time_limit_ms, source_version, fields, image)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [id, q.position, q.type, q.prompt, q.time_limit_seconds * 1000, q.version, JSON.stringify(freezeFields(q.type, q.fields)), q.image === null ? null : JSON.stringify(q.image)],
          );
        }
        return id;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        await tx.query("ROLLBACK TO SAVEPOINT pin");
      }
    }
    throw apiError(503, "database_unavailable");
  });
  watchRoom(roomId);
  return roomId;
}
