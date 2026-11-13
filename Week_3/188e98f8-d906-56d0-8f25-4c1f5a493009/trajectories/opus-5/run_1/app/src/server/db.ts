/** PostgreSQL access, plus the schema and seed applied idempotently on every serve. */

import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

export interface Db {
  query<Row extends QueryResultRow>(sql: string, values?: readonly unknown[]): Promise<QueryResult<Row>>;
  transaction<Result>(work: (tx: Db) => Promise<Result>): Promise<Result>;
}

class PoolDb implements Db {
  constructor(private readonly pool: Pool) {}

  async query<Row extends QueryResultRow>(sql: string, values: readonly unknown[] = []): Promise<QueryResult<Row>> {
    return this.pool.query<Row>(sql, values as unknown[]);
  }

  async transaction<Result>(work: (tx: Db) => Promise<Result>): Promise<Result> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await work(new ClientDb(client));
      await client.query('commit');
      return result;
    } catch (failure) {
      await client.query('rollback');
      throw failure;
    } finally {
      client.release();
    }
  }
}

class ClientDb implements Db {
  constructor(private readonly client: PoolClient) {}

  async query<Row extends QueryResultRow>(sql: string, values: readonly unknown[] = []): Promise<QueryResult<Row>> {
    return this.client.query<Row>(sql, values as unknown[]);
  }

  async transaction<Result>(work: (tx: Db) => Promise<Result>): Promise<Result> {
    return work(this);
  }
}

/** The single row a query is written to return. */
export function one<Row extends QueryResultRow>(result: QueryResult<Row>): Row {
  const row = result.rows[0];
  if (row === undefined) throw new Error('query returned no row');
  return row;
}

export function isUniqueViolation(reason: unknown, constraint: string): boolean {
  const failure = reason as { code?: string; constraint?: string };
  return failure.code === '23505' && failure.constraint === constraint;
}

export function openDb(databaseUrl: string): { db: Db; pool: Pool } {
  const pool = new Pool({ connectionString: databaseUrl, max: 10 });
  pool.on('error', () => {
    /* a broken idle connection is dropped from the pool and reopened on demand */
  });
  return { db: new PoolDb(pool), pool };
}

const SCHEMA = `
create table if not exists league (
  id int primary key,
  name text not null,
  season text not null,
  pub text not null,
  night int not null,
  table_version int not null,
  last_published_round int
);

create table if not exists teams (
  id int primary key,
  name text not null,
  captain_email text not null,
  night_1 int not null,
  night_2 int not null,
  night_3 int not null
);
create unique index if not exists teams_name_folded on teams (lower(name));

create table if not exists desk_codes (
  code text primary key,
  role text not null,
  team_id int references teams(id)
);

create table if not exists sessions (
  token text primary key,
  role text not null,
  team_id int references teams(id),
  created_at timestamptz not null default now()
);

create table if not exists rounds (
  number int primary key,
  title text not null,
  kind text not null,
  status text not null,
  opened_at timestamptz,
  closes_at timestamptz,
  closed_at timestamptz,
  sheet_key text,
  sheet_size int,
  sheet_sha256 text,
  sheet_width int,
  sheet_height int
);

create table if not exists answers (
  id serial primary key,
  round int not null references rounds(number),
  team_id int not null references teams(id),
  question int not null,
  text text not null,
  submitted_at timestamptz not null default clock_timestamp(),
  current boolean not null default true,
  mark int,
  ruled int
);
create index if not exists answers_round_question_team on answers (round, question, team_id);
create index if not exists answers_team on answers (team_id);

create table if not exists disputes (
  id serial primary key,
  answer_id int not null references answers(id),
  team_id int not null references teams(id),
  round int not null references rounds(number),
  question int not null,
  reason text not null,
  status text not null,
  raised_at timestamptz not null default clock_timestamp(),
  ruled_at timestamptz,
  note text
);
create unique index if not exists disputes_one_per_answer on disputes (answer_id);

create table if not exists idempotency (
  team_id int not null references teams(id),
  key text not null,
  round int not null,
  body text not null,
  status int not null,
  response text not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (team_id, key)
);

create table if not exists submit_log (
  id serial primary key,
  team_id int not null references teams(id),
  at timestamptz not null default clock_timestamp()
);
create index if not exists submit_log_team_at on submit_log (team_id, at);

create table if not exists published_scores (
  round int not null references rounds(number),
  team_id int not null references teams(id),
  score int not null,
  primary key (round, team_id)
);
`;

interface SeedTeam {
  id: number;
  name: string;
  email: string;
  nights: [number, number, number];
}

const SEED_TEAMS: SeedTeam[] = [
  { id: 1, name: 'Tequila Mockingbird', email: 'captain01@snug-league.test', nights: [51, 48, 53] },
  { id: 2, name: 'Les Quizérables', email: 'captain02@snug-league.test', nights: [50, 49, 50] },
  { id: 3, name: 'Sherlock Ohms', email: 'captain03@snug-league.test', nights: [47, 52, 46] },
  { id: 4, name: 'The Quizzly Bears', email: 'captain04@snug-league.test', nights: [45, 50, 50] },
  { id: 5, name: 'The Mitochondriacs', email: 'captain05@snug-league.test', nights: [44, 46, 48] },
  { id: 6, name: 'Universally Challenged', email: 'captain06@snug-league.test', nights: [43, 45, 44] },
  { id: 7, name: 'Spelling Bees', email: 'captain07@snug-league.test', nights: [41, 44, 43] },
  { id: 8, name: 'Norfolk Enchants', email: 'captain08@snug-league.test', nights: [40, 42, 41] },
  { id: 9, name: 'Half Past Pints', email: 'captain09@snug-league.test', nights: [38, 40, 41] },
  { id: 10, name: 'The Lemon Tops', email: 'captain10@snug-league.test', nights: [36, 39, 40] },
  { id: 11, name: "Dot's Lot", email: 'captain11@snug-league.test', nights: [35, 37, 36] },
  { id: 12, name: 'Bad Losers', email: 'captain12@snug-league.test', nights: [30, 33, 31] },
];

const SEED_ROUNDS: { number: number; title: string; kind: 'standard' | 'picture' }[] = [
  { number: 1, title: 'General Knowledge', kind: 'standard' },
  { number: 2, title: 'History', kind: 'standard' },
  { number: 3, title: 'Picture Round: Doorways', kind: 'picture' },
  { number: 4, title: 'Music', kind: 'standard' },
  { number: 5, title: 'Science and Nature', kind: 'standard' },
  { number: 6, title: 'Picture Round: Shop Fronts', kind: 'picture' },
  { number: 7, title: 'Sport', kind: 'standard' },
  { number: 8, title: 'Final Round: Local Knowledge', kind: 'standard' },
];

export async function applySchemaAndSeed(db: Db): Promise<void> {
  await db.query(SCHEMA);
  await db.transaction(async (tx) => {
    await tx.query(
      `insert into league (id, name, season, pub, night, table_version, last_published_round)
       values (1, 'Snug Thursday League', 'Autumn 2026', 'The Snug, Little Brampton', 4, 1, null)
       on conflict (id) do nothing`,
    );
    for (const team of SEED_TEAMS) {
      await tx.query(
        `insert into teams (id, name, captain_email, night_1, night_2, night_3)
         values ($1, $2, $3, $4, $5, $6) on conflict (id) do nothing`,
        [team.id, team.name, team.email, team.nights[0], team.nights[1], team.nights[2]],
      );
    }
    await tx.query(
      `insert into desk_codes (code, role, team_id)
       values ('HOST-4417', 'quizmaster', null), ('MARK-2093', 'marker', null)
       on conflict (code) do nothing`,
    );
    for (const team of SEED_TEAMS) {
      const code = `CAP-${String(team.id).padStart(2, '0')}`;
      await tx.query(
        `insert into desk_codes (code, role, team_id) values ($1, 'captain', $2) on conflict (code) do nothing`,
        [code, team.id],
      );
    }
    for (const round of SEED_ROUNDS) {
      await tx.query(
        `insert into rounds (number, title, kind, status) values ($1, $2, $3, 'drafted')
         on conflict (number) do nothing`,
        [round.number, round.title, round.kind],
      );
    }
  });
}
