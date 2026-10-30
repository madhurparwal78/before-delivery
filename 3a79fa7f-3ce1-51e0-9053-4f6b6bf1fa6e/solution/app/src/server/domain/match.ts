// The five-question fit quiz (brief: Match quiz): points table, winner with the tie break and two reasons.
import { BOARD_NAMES, type BoardName } from "../catalog.ts";
import type { Db } from "../db.ts";
import { ApiError, invalid } from "../errors.ts";
import { now } from "../clock.ts";

type Points = [number, number, number];
interface Question {
  text: string;
  options: { key: string; label: string; points: Points }[];
}

const QUESTIONS: Question[] = [
  {
    text: "How much have you foiled?",
    options: [
      { key: "never", label: "Never", points: [3, 0, 0] },
      { key: "foiled", label: "I have foiled without a motor", points: [0, 1, 3] },
      { key: "powered", label: "I have ridden an eFoil", points: [0, 2, 1] },
    ],
  },
  {
    text: "Where will you ride?",
    options: [
      { key: "calm", label: "Calm water", points: [2, 1, 0] },
      { key: "swell", label: "Ocean swell", points: [0, 1, 2] },
      { key: "mixed", label: "A bit of both", points: [0, 2, 0] },
    ],
  },
  {
    text: "What matters most?",
    options: [
      { key: "stability", label: "Stability", points: [2, 0, 0] },
      { key: "range", label: "Range", points: [0, 3, 0] },
      { key: "lightness", label: "Light weight", points: [0, 0, 3] },
    ],
  },
  {
    text: "What is your budget?",
    options: [
      { key: "under-12k", label: "Under $12k", points: [3, 0, 0] },
      { key: "12k-14k", label: "$12k to $14k", points: [0, 0, 2] },
      { key: "any", label: "Whatever it takes", points: [0, 2, 0] },
    ],
  },
  {
    text: "What do you weigh?",
    options: [
      { key: "under-70", label: "Under 70 kg", points: [0, 0, 1] },
      { key: "70-90", label: "70 to 90 kg", points: [0, 1, 0] },
      { key: "over-90", label: "Over 90 kg", points: [1, 1, 0] },
    ],
  },
];

/** Question copy and option keys for the quiz page (no points). */
export function quizCopy(): { text: string; options: { key: string; label: string }[] }[] {
  return QUESTIONS.map((q) => ({ text: q.text, options: q.options.map(({ key, label }) => ({ key, label })) }));
}

interface MatchResult {
  id: string;
  answers: string[];
  recommended: BoardName;
  scores: Record<BoardName, number>;
  reasons: number[];
}

function score(answers: string[]): Omit<MatchResult, "id"> {
  const rows = answers.map((key, i) => QUESTIONS[i]?.options.find((o) => o.key === key)?.points ?? [0, 0, 0]);
  const totals = BOARD_NAMES.map((_, j) => rows.reduce((sum, r) => sum + r[j]!, 0));
  let winner = 0;
  for (let j = 1; j < BOARD_NAMES.length; j++) if (totals[j]! > totals[winner]!) winner = j;
  const reasons = rows
    .map((r, q) => ({ q: q + 1, points: r[winner]! }))
    .sort((a, b) => b.points - a.points || a.q - b.q)
    .slice(0, 2)
    .map((r) => r.q);
  const scores = Object.fromEntries(BOARD_NAMES.map((name, j) => [name, totals[j]!])) as Record<BoardName, number>;
  return { answers, recommended: BOARD_NAMES[winner]!, scores, reasons };
}

export async function createMatch(db: Db, body: Record<string, unknown>): Promise<MatchResult> {
  const answers = body.answers;
  const valid =
    Array.isArray(answers) &&
    answers.length === QUESTIONS.length &&
    answers.every((a, i) => typeof a === "string" && QUESTIONS[i]!.options.some((o) => o.key === a));
  if (!valid) throw invalid({ answers: "Answer all five questions." });
  const result = score(answers as string[]);
  const { rows } = await db.query<{ id: string }>(
    "INSERT INTO match_results (answers, recommended, scores, reasons, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [JSON.stringify(result.answers), result.recommended, JSON.stringify(result.scores), JSON.stringify(result.reasons), now()],
  );
  return { id: rows[0]!.id, answers: result.answers, recommended: result.recommended, scores: result.scores, reasons: result.reasons };
}

export async function readMatch(db: Db, id: string): Promise<MatchResult> {
  const missing = new ApiError("not_found", { message: "We could not find that match." });
  if (!/^\d{1,18}$/.test(id)) throw missing;
  const { rows } = await db.query<MatchResult>(
    "SELECT id::text AS id, answers, recommended, scores, reasons FROM match_results WHERE id = $1",
    [id],
  );
  const row = rows[0];
  if (!row) throw missing;
  return {
    id: row.id, answers: row.answers, recommended: row.recommended,
    scores: { Drift: row.scores.Drift, Crest: row.scores.Crest, Swift: row.scores.Swift }, reasons: row.reasons,
  };
}
