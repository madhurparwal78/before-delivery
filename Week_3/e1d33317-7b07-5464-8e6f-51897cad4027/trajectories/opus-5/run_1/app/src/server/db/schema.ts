import { query } from './pool.js';

const STATEMENTS = [
  `create table if not exists scores (
     id text primary key,
     title text not null,
     measure_count integer not null,
     lamport integer not null,
     last_seq integer not null
   )`,
  `create table if not exists time_signatures (
     score_id text not null references scores(id) on delete cascade,
     measure integer not null,
     beats integer not null,
     beat_type integer not null,
     primary key (score_id, measure)
   )`,
  `create table if not exists tempos (
     score_id text not null references scores(id) on delete cascade,
     measure integer not null,
     bpm integer not null,
     primary key (score_id, measure)
   )`,
  `create table if not exists parts (
     id text primary key,
     score_id text not null references scores(id) on delete cascade,
     name text not null,
     status text not null,
     revision integer not null default 0,
     extracted_at_lamport integer,
     page_count integer,
     layout jsonb not null default '{"systemBreaks":[],"pageBreaks":[]}'::jsonb,
     extracted_layout jsonb,
     last_error text,
     ord integer not null
   )`,
  `create table if not exists staves (
     id text primary key,
     score_id text not null references scores(id) on delete cascade,
     name text not null,
     clef text not null,
     transpose_diatonic integer not null,
     transpose_chromatic integer not null,
     part_id text not null references parts(id) on delete cascade,
     ord double precision not null
   )`,
  `create table if not exists collaborators (
     id text primary key,
     score_id text not null references scores(id) on delete cascade,
     name text not null,
     role text not null,
     status text not null,
     staff_ids jsonb not null default '[]'::jsonb,
     all_staves boolean not null default false,
     seat_token text unique,
     invite_token text unique,
     acked_lamport integer not null default 0
   )`,
  `create table if not exists elements (
     score_id text not null references scores(id) on delete cascade,
     staff_id text not null,
     voice smallint not null,
     lamport integer not null,
     site text not null,
     after_lamport integer,
     after_site text,
     kind text not null,
     pitch jsonb,
     duration text not null,
     dots smallint not null,
     fields jsonb not null default '{}'::jsonb,
     delete_lamport integer,
     delete_site text,
     primary key (score_id, lamport, site)
   )`,
  `create index if not exists elements_voice_idx on elements (score_id, staff_id, voice)`,
  `create table if not exists operations (
     score_id text not null references scores(id) on delete cascade,
     seq bigint not null,
     op_lamport integer not null,
     op_site text not null,
     op jsonb not null,
     type text not null,
     field text,
     staff_id text not null,
     voice smallint not null,
     measure integer not null,
     beat double precision not null,
     summary text not null,
     author_id text not null,
     at timestamptz not null default now(),
     primary key (score_id, seq)
   )`,
  `create unique index if not exists operations_stamp_idx
     on operations (score_id, op_lamport, op_site)`,
  `create index if not exists operations_filter_idx on operations (score_id, seq desc)`,
  `create table if not exists snapshots (
     score_id text not null references scores(id) on delete cascade,
     seq bigint not null,
     stable_lamport integer not null,
     at timestamptz not null default now(),
     primary key (score_id, seq)
   )`,
  `create table if not exists holds (
     score_id text not null references scores(id) on delete cascade,
     staff_id text not null,
     collaborator_id text not null,
     connection_id text not null,
     since timestamptz not null default now(),
     primary key (score_id, staff_id)
   )`,
  `create table if not exists banks (
     id text primary key,
     score_id text not null references scores(id) on delete cascade,
     file_name text not null,
     kind text not null,
     bytes integer not null,
     staff_id text not null,
     root_pitch text,
     object_key text not null,
     created_at timestamptz not null default now()
   )`,
];

export async function applySchema(): Promise<void> {
  for (const statement of STATEMENTS) {
    await query(statement);
  }
}
