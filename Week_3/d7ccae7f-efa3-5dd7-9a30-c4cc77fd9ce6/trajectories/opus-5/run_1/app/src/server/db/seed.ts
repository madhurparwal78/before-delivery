import { createHash, randomBytes } from 'node:crypto';
import { hashPassword } from '../accounts.js';
import { snapshotForStorage } from '../domain/room.js';
import type { QuestionSpec } from '../domain/questions.js';
import { query } from './pool.js';

const INES = '11111111-1111-4111-8111-111111111111';
const ROWAN = '22222222-2222-4222-8222-222222222222';
const GILDED_TAP = '33333333-3333-4333-8333-333333333333';
const PRACTICE = '44444444-4444-4444-8444-444444444444';
const THURSDAY_MIX = '55555555-5555-4555-8555-555555555555';
const PAST_NIGHT = '77777777-7777-4777-8777-777777777777';

interface SeedQuestion {
  id: string;
  prompt: string;
  timeLimitSeconds: number;
  spec: QuestionSpec;
}

const GILDED_QUESTIONS: SeedQuestion[] = [
  {
    id: '66666666-6666-4666-8666-000000000001',
    prompt: 'Which planet has the shortest day?',
    timeLimitSeconds: 20,
    spec: {
      type: 'multiple_choice',
      options: ['Jupiter', 'Mars', 'Earth', 'Venus'],
      correctIndex: 0,
    },
  },
  {
    id: '66666666-6666-4666-8666-000000000002',
    prompt: 'How many keys does a standard piano have?',
    timeLimitSeconds: 25,
    spec: { type: 'estimate', min: 40, max: 120, step: 1, answer: 88, tolerance: 4, unit: 'keys' },
  },
  {
    id: '66666666-6666-4666-8666-000000000003',
    prompt: 'Put these inventions in order, earliest first.',
    timeLimitSeconds: 30,
    spec: {
      type: 'sequence',
      items: ['Printing press', 'Steam engine', 'Telephone', 'World Wide Web'],
    },
  },
  {
    id: '66666666-6666-4666-8666-000000000004',
    prompt: 'What is the chemical symbol for gold?',
    timeLimitSeconds: 15,
    spec: { type: 'multiple_choice', options: ['Ag', 'Au', 'Gd', 'Go'], correctIndex: 1 },
  },
];

const THURSDAY_QUESTIONS: SeedQuestion[] = [
  {
    id: '66666666-6666-4666-8666-000000000005',
    prompt: 'How many sides does a hexagon have?',
    timeLimitSeconds: 20,
    spec: { type: 'multiple_choice', options: ['5', '6', '7', '8'], correctIndex: 1 },
  },
];

const PAST_STANDINGS = [
  { seatId: '88888888-8888-4888-8888-000000000001', nickname: 'Quizzly Bears', score: 3120 },
  { seatId: '88888888-8888-4888-8888-000000000002', nickname: 'Les Quizerables', score: 2980 },
  { seatId: '88888888-8888-4888-8888-000000000003', nickname: 'Pint Sized', score: 2410 },
  { seatId: '88888888-8888-4888-8888-000000000004', nickname: 'Agatha Quiztie', score: 1875 },
  { seatId: '88888888-8888-4888-8888-000000000005', nickname: 'The Lone Ranger', score: 920 },
];

function specJson(spec: QuestionSpec): string {
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

async function seedQuizmaster(
  id: string,
  email: string,
  password: string,
  displayName: string,
): Promise<void> {
  await query(
    `INSERT INTO quizmasters (id, email, email_lower, password_hash, display_name)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
    [id, email, email.toLowerCase(), await hashPassword(password), displayName],
  );
}

async function seedDeck(id: string, quizmasterId: string, title: string): Promise<void> {
  await query(
    `INSERT INTO decks (id, quizmaster_id, title) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [id, quizmasterId, title],
  );
}

async function seedQuestions(deckId: string, questions: readonly SeedQuestion[]): Promise<void> {
  for (const [index, question] of questions.entries()) {
    await query(
      `INSERT INTO questions (id, deck_id, position, type, prompt, time_limit_seconds, spec)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
      [
        question.id,
        deckId,
        index + 1,
        question.spec.type,
        question.prompt,
        question.timeLimitSeconds,
        specJson(question.spec),
      ],
    );
  }
}

async function seedPastNight(): Promise<void> {
  const snapshot = GILDED_QUESTIONS.map((question, index) =>
    snapshotForStorage({
      id: question.id,
      position: index + 1,
      version: 1,
      prompt: question.prompt,
      timeLimitSeconds: question.timeLimitSeconds,
      image: null,
      spec: question.spec,
    }),
  );
  const inserted = await query<{ id: string }>(
    `INSERT INTO rooms (id, quizmaster_id, deck_id, deck_title, pin, state, questions,
       question_index, next_event_id, created_at, ended_at, end_reason)
     VALUES ($1, $2, $3, $4, $5, 'ended', $6, 4, 1,
       timestamptz '2026-10-27 20:30:00+00', timestamptz '2026-10-27 21:40:00+00', 'host')
     ON CONFLICT (id) DO NOTHING RETURNING id`,
    [PAST_NIGHT, INES, GILDED_TAP, 'Tuesday at The Gilded Tap', '405118', JSON.stringify(snapshot)],
  );
  if (inserted.length === 0) return;
  for (const [index, entry] of PAST_STANDINGS.entries()) {
    const cumulativeMs = 18_000 + index * 9_000;
    await query(
      `INSERT INTO seats (id, room_id, nickname, nickname_lower, rejoin_token_hash, score,
         streak, cumulative_ms, joined_after_index, joined_at)
       VALUES ($1, $2, $3, $4, $5, $6, 0, $7, 0, timestamptz '2026-10-27 20:31:00+00')`,
      [
        entry.seatId,
        PAST_NIGHT,
        entry.nickname,
        entry.nickname.toLowerCase(),
        createHash('sha256').update(randomBytes(32)).digest('hex'),
        entry.score,
        cumulativeMs,
      ],
    );
    await query(
      `INSERT INTO standings (room_id, seat_id, nickname, score, streak, cumulative_ms, rank)
       VALUES ($1, $2, $3, $4, 0, $5, $6)`,
      [PAST_NIGHT, entry.seatId, entry.nickname, entry.score, cumulativeMs, index + 1],
    );
  }
}

export async function applySeed(): Promise<void> {
  await seedQuizmaster(INES, 'ines@corkline.example', 'tally-pour-2026', 'Ines Talbot');
  await seedQuizmaster(ROWAN, 'rowan@corkline.example', 'second-round-77', 'Rowan Pike');
  await seedDeck(GILDED_TAP, INES, 'Tuesday at The Gilded Tap');
  await seedDeck(PRACTICE, INES, 'Practice deck');
  await seedDeck(THURSDAY_MIX, ROWAN, 'Thursday Mix');
  await seedQuestions(GILDED_TAP, GILDED_QUESTIONS);
  await seedQuestions(THURSDAY_MIX, THURSDAY_QUESTIONS);
  await seedPastNight();
}
