import type { Pool } from 'pg';
import { createHash, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import type { DeckRecord, RoomSnapshot } from './domain.ts';

const SCHEMA_NAME = /^[a-z_][a-z0-9_]*$/.test(process.env.APP_DB_SCHEMA ?? '') ? (process.env.APP_DB_SCHEMA as string) : 'public';
export function appSchema(): string {
  return SCHEMA_NAME;
}

export interface AccountSeed {
  email: string;
  password: string;
  displayName: string;
}

export interface DeckSeed {
  title: string;
  questions: {
    type: string;
    prompt: string;
    timeLimitSeconds: number;
    content: Record<string, unknown>;
  }[];
}

export const schemaSql = `
create table if not exists quizmasters (
  id uuid primary key,
  email text not null,
  email_lower text not null unique,
  password_hash text not null,
  display_name text not null,
  created_at bigint not null
);
create table if not exists passwords (
  email_lower text primary key,
  salt text not null
);
create table if not exists sessions (
  token_hash text primary key,
  quizmaster_id uuid not null references quizmasters(id) on delete cascade,
  expires_at bigint not null
);
create table if not exists decks (
  id uuid primary key,
  quizmaster_id uuid not null references quizmasters(id) on delete cascade,
  title text not null,
  version int not null default 1,
  updated_at bigint not null
);
create table if not exists questions (
  id uuid primary key,
  deck_id uuid not null references decks(id) on delete cascade,
  position int not null,
  version int not null default 1,
  type text not null,
  prompt text not null,
  time_limit_seconds int not null,
  content jsonb not null,
  image_content_type text,
  image_bytes bigint,
  image_object_key text,
  created_at bigint not null
);
create index if not exists questions_deck_idx on questions(deck_id, position);
create table if not exists snapshots (
  id uuid primary key,
  content jsonb not null,
  last_event_id int not null default 0
);
create table if not exists rooms (
  id uuid primary key,
  quizmaster_id uuid not null references quizmasters(id) on delete cascade,
  deck_id uuid not null,
  snapshot_id uuid not null references snapshots(id),
  deck_title text not null,
  pin text not null,
  state text not null,
  question_index int,
  opens_at bigint,
  deadline_at bigint,
  locked_reason text,
  ended_reason text,
  ended_at bigint,
  opened_at bigint not null,
  empty_since bigint
);
create unique index if not exists rooms_live_pin_idx on rooms(pin) where ended_reason is null;
create table if not exists seats (
  id uuid primary key,
  room_id uuid not null references rooms(id) on delete cascade,
  nickname text not null,
  nickname_lower text not null,
  rejoin_token_hash text not null,
  joined_at bigint not null,
  score int not null default 0,
  streak int not null default 0,
  cumulative_ms bigint not null default 0,
  rank int not null default 0
);
create unique index if not exists seats_room_nick_idx on seats(room_id, nickname_lower);
create table if not exists answers (
  room_id uuid not null references rooms(id) on delete cascade,
  seat_id uuid not null references seats(id) on delete cascade,
  question_index int not null,
  latency_ms bigint not null,
  points int,
  received_at bigint not null,
  choice int,
  estimate double precision,
  "order" text[],
  primary key (room_id, seat_id, question_index)
);
create table if not exists standings (
  room_id uuid not null references rooms(id) on delete cascade,
  seat_id uuid not null references seats(id) on delete cascade,
  nickname text not null,
  score int not null,
  streak int not null,
  cumulative_ms bigint not null,
  rank int not null,
  primary key (room_id, seat_id)
);
create table if not exists events (
  room_id uuid not null,
  id int not null,
  type text not null,
  data jsonb not null,
  created_at bigint not null,
  primary key (room_id, id)
);
create table if not exists clients (
  id text primary key,
  room_id uuid not null references rooms(id) on delete cascade,
  seat_id uuid references seats(id) on delete cascade,
  kind text not null,
  rejoin_token_hash text,
  superseded_at bigint,
  created_at bigint not null,
  last_seen_at bigint not null
);
create table if not exists nights (
  room_id uuid primary key references rooms(id) on delete cascade,
  deck_title text not null,
  ended_at bigint not null
);
`;

const ines: AccountSeed = {
  email: 'ines@corkline.example',
  password: 'tally-pour-2026',
  displayName: 'Ines Talbot',
};

const rowan: AccountSeed = {
  email: 'rowan@corkline.example',
  password: 'second-round-77',
  displayName: 'Rowan Pike',
};

export function hashPassword(password: string, salt: string): string {
  const digest = createHash('sha256').update(`lastbell:${salt}:${password}`).digest();
  return scryptSync(digest, salt, 32).toString('hex');
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newToken(): string {
  return randomBytes(24).toString('hex');
}

export function deckSnapshotJson(deck: DeckRecord): string {
  return JSON.stringify({
    questions: deck.questions.map((q) => ({
      id: q.id,
      position: q.position,
      version: q.version,
      prompt: q.prompt,
      timeLimitSeconds: q.timeLimitSeconds,
      image: q.image,
      content: JSON.stringify(q.content),
    })),
  });
}

const seededDecks: { email: string; decks: DeckSeed[] }[] = [
  {
    email: ines.email,
    decks: [
      {
        title: 'Tuesday at The Gilded Tap',
        questions: [
          {
            type: 'multiple_choice',
            prompt: 'Which planet has the shortest day?',
            timeLimitSeconds: 20,
            content: {
              type: 'multiple_choice',
              options: ['Jupiter', 'Mars', 'Earth', 'Venus'],
              correctIndex: 0,
            },
          },
          {
            type: 'estimate',
            prompt: 'How many keys does a standard piano have?',
            timeLimitSeconds: 25,
            content: { type: 'estimate', min: 40, max: 120, step: 1, answer: 88, tolerance: 4, unit: 'keys' },
          },
          {
            type: 'sequence',
            prompt: 'Put these inventions in order, earliest first.',
            timeLimitSeconds: 30,
            content: {
              type: 'sequence',
              items: ['Printing press', 'Steam engine', 'Telephone', 'World Wide Web'],
            },
          },
          {
            type: 'multiple_choice',
            prompt: 'What is the chemical symbol for gold?',
            timeLimitSeconds: 15,
            content: { type: 'multiple_choice', options: ['Ag', 'Au', 'Gd', 'Go'], correctIndex: 1 },
          },
        ],
      },
      { title: 'Practice deck', questions: [] },
    ],
  },
  {
    email: rowan.email,
    decks: [
      {
        title: 'Thursday Mix',
        questions: [
          {
            type: 'multiple_choice',
            prompt: 'How many sides does a hexagon have?',
            timeLimitSeconds: 20,
            content: { type: 'multiple_choice', options: ['5', '6', '7', '8'], correctIndex: 1 },
          },
        ],
      },
    ],
  },
];

export async function applySchema(pool: Pool): Promise<void> {
  await pool.query(`create schema if not exists ${appSchema()}`);
  await pool.query(`set search_path to ${appSchema()}, public`);
  await pool.query(schemaSql);
  await pool.query(`alter table clients add column if not exists last_seen_at bigint`);
  await pool.query(`update clients set last_seen_at = $1 where last_seen_at is null`, [Date.now()]);
  await pool.query(`alter table clients alter column last_seen_at set not null`);
}

export async function applySeed(pool: Pool): Promise<void> {
  await pool.query(`set search_path to ${appSchema()}, public`);
  await pool.query('begin');
  try {
    const seedAccount = async (account: AccountSeed): Promise<string> => {
      const emailLower = account.email.toLowerCase();
      const existing = await pool.query('select id from quizmasters where email_lower = $1', [emailLower]);
      if (existing.rowCount && existing.rowCount > 0) return String(existing.rows[0].id);
      const id = randomUUID();
      const salt = newToken().slice(0, 16);
      await pool.query(
        `insert into quizmasters (id, email, email_lower, password_hash, display_name, created_at)
         values ($1, $2, $3, $4, $5, $6)`,
        [id, account.email, emailLower, hashPassword(account.password, salt), account.displayName, Date.now()],
      );
      await pool.query('insert into passwords (email_lower, salt) values ($1, $2) on conflict (email_lower) do nothing', [
        emailLower,
        salt,
      ]);
      return id;
    };

    const gildedTap = seededDecks[0].decks[0];
    for (const account of [ines, rowan]) {
      const quizmasterId = await seedAccount(account);
      const entries = seededDecks.find((entry) => entry.email === account.email);
      if (!entries) continue;
      for (const deck of entries.decks) {
        const existingDeck = await pool.query(
          'select id from decks where quizmaster_id = $1 and title = $2',
          [quizmasterId, deck.title],
        );
        if (existingDeck.rowCount && existingDeck.rowCount > 0) continue;
        const deckId = randomUUID();
        await pool.query(
          'insert into decks (id, quizmaster_id, title, version, updated_at) values ($1, $2, $3, 1, $4)',
          [deckId, quizmasterId, deck.title, Date.now()],
        );
        let position = 1;
        for (const question of deck.questions) {
          await pool.query(
            `insert into questions (id, deck_id, position, version, type, prompt, time_limit_seconds, content, created_at)
             values ($1, $2, $3, 1, $4, $5, $6, $7, $8)`,
            [
              randomUUID(),
              deckId,
              position,
              question.type,
              question.prompt,
              question.timeLimitSeconds,
              JSON.stringify(question.content),
              Date.now(),
            ],
          );
          position += 1;
        }
      }
    }

    const inesId = await pool.query('select id from quizmasters where email_lower = $1', [ines.email]);
    const gildedDeckId = await pool.query(
      'select id from decks where quizmaster_id = $1 and title = $2',
      [String(inesId.rows[0].id), gildedTap.title],
    );
    const deckId = String(gildedDeckId.rows[0].id);
    const endedAt = Date.UTC(2026, 9, 27, 21, 40, 0);
    const hasNight = await pool.query('select 1 from nights limit 1');
    if (!hasNight.rowCount || hasNight.rowCount === 0) {
      const roomId = randomUUID();
      const seats: { nick: string; score: number }[] = [
        { nick: 'Quizzly Bears', score: 3120 },
        { nick: 'Les Quizerables', score: 2980 },
        { nick: 'Pint Sized', score: 2410 },
        { nick: 'Agatha Quiztie', score: 1875 },
        { nick: 'The Lone Ranger', score: 920 },
      ];
      const snapshotRow = await pool.query(
        'insert into snapshots (id, content, last_event_id) values ($1, $2, 0) returning id',
        [randomUUID(), JSON.stringify({ questions: [] })],
      );
      await pool.query(
        `insert into rooms (id, quizmaster_id, deck_id, snapshot_id, deck_title, pin, state, ended_reason, ended_at, opened_at, empty_since)
         values ($1, $2, $3, $4, $5, $6, 'ended', 'host', $7, $8, $8)`,
        [roomId, inesId.rows[0].id, deckId, snapshotRow.rows[0].id, gildedTap.title, '123456', endedAt, endedAt],
      );
      let rank = 1;
      for (const seat of seats) {
        const seatId = randomUUID();
        await pool.query(
          `insert into seats (id, room_id, nickname, nickname_lower, rejoin_token_hash, joined_at, score, streak, cumulative_ms, rank)
           values ($1, $2, $3, $4, $5, $6, $7, 0, 0, $8)`,
          [seatId, roomId, seat.nick, seat.nick.toLowerCase(), newToken(), endedAt, seat.score, rank],
        );
        await pool.query(
          `insert into standings (room_id, seat_id, nickname, score, streak, cumulative_ms, rank)
           values ($1, $2, $3, $4, 0, 0, $5)`,
          [roomId, seatId, seat.nick, seat.score, rank],
        );
        rank += 1;
      }
      await pool.query(
        'insert into nights (room_id, deck_title, ended_at) values ($1, $2, $3)',
        [roomId, gildedTap.title, endedAt],
      );
    }
    await pool.query('commit');
  } catch (err) {
    await pool.query('rollback');
    throw err;
  }
}

export function snapshotQuestions(deck: DeckRecord): RoomSnapshot['questions'] {
  return deck.questions.map((q) => ({
    id: q.id,
    position: q.position,
    version: q.version,
    prompt: q.prompt,
    timeLimitSeconds: q.timeLimitSeconds,
    image: q.image,
    content: q.content,
  }));
}
