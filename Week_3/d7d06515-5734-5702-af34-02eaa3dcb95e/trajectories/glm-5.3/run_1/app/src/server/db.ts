import pg from "pg";

export interface Db {
  query<T extends pg.QueryResultRow>(sql: string, params?: unknown[]): Promise<pg.QueryResult<T>>;
  all<T extends pg.QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T extends pg.QueryResultRow>(sql: string, params?: unknown[]): Promise<T | null>;
  run(sql: string, params?: unknown[]): Promise<pg.QueryResult>;
  tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T>;
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

export const db: Db = {
  query: (sql, params) => pool.query(sql, params),
  all: async (sql, params) => (await pool.query(sql, params)).rows,
  one: async (sql, params) => (await pool.query(sql, params)).rows[0] ?? null,
  run: (sql, params) => pool.query(sql, params),
  tx: async (fn) => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const result = await fn(client);
      await client.query("commit");
      return result;
    } catch (err) {
      await client.query("rollback").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  },
};

const schema = `
create table if not exists workspaces (
  id text primary key,
  kind text not null,
  time_zone text not null default 'UTC',
  created_epoch bigint not null,
  sample boolean not null default false
);

create table if not exists accounts (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null,
  email text not null,
  email_lower text not null,
  password_hash text not null,
  verified boolean not null default false,
  confirmed_date_key text,
  time_zone text not null default 'UTC',
  signin_failures int not null default 0,
  locked_until bigint,
  created_epoch bigint not null,
  unique (email_lower)
);

create table if not exists confirm_tokens (
  id text primary key,
  account_id text not null references accounts(id) on delete cascade,
  created_epoch bigint not null
);

create table if not exists sessions (
  token text primary key,
  account_id text not null references accounts(id) on delete cascade,
  created_epoch bigint not null
);

create table if not exists folders (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  parent_id text,
  name text not null,
  name_lower text not null,
  modified_epoch bigint not null,
  created_epoch bigint not null
);
create index if not exists folders_parent on folders(workspace_id, parent_id, name_lower);

create table if not exists drawings (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  folder_id text references folders(id) on delete cascade,
  name text not null,
  name_lower text not null,
  units text not null default 'mm',
  plot_style text not null default 'Monochrome',
  version int not null default 1,
  next_handle text not null default '10',
  max_handle_used int not null default 0,
  trace_counter int not null default 0,
  export_count int not null default 0,
  modified_epoch bigint not null,
  created_epoch bigint not null,
  deleted_epoch bigint,
  sample boolean not null default false
);
create index if not exists drawings_folder on drawings(workspace_id, folder_id, name_lower);

create table if not exists layers (
  drawing_id text not null references drawings(id) on delete cascade,
  name text not null,
  name_lower text not null,
  color text not null default 'White',
  linetype text not null default 'Continuous',
  lineweight text not null default '0.25 mm',
  is_on boolean not null default true,
  frozen boolean not null default false,
  locked boolean not null default false,
  current boolean not null default false,
  position int not null default 0,
  primary key (drawing_id, name_lower)
);

create table if not exists objects (
  handle text not null,
  drawing_id text not null references drawings(id) on delete cascade,
  layer text not null,
  type text not null,
  color text not null default 'ByLayer',
  linetype text not null default 'ByLayer',
  linetype_scale numeric not null default 1,
  lineweight text not null default 'ByLayer',
  dimension_style text not null default 'Standard',
  text_style text not null default 'Standard',
  multileader_style text not null default 'Standard',
  geometry jsonb not null,
  created_epoch bigint not null,
  primary key (drawing_id, handle)
);

create table if not exists layouts (
  drawing_id text not null references drawings(id) on delete cascade,
  name text not null,
  viewport_scale text,
  position int not null default 0,
  primary key (drawing_id, name)
);

create table if not exists versions (
  drawing_id text not null references drawings(id) on delete cascade,
  version int not null,
  actor text not null,
  command text not null,
  created_epoch bigint not null,
  created jsonb not null,
  modified jsonb not null,
  erased jsonb not null,
  before_state jsonb,
  after_state jsonb,
  undone boolean not null default false,
  primary key (drawing_id, version)
);

create table if not exists activity (
  id bigserial primary key,
  drawing_id text not null references drawings(id) on delete cascade,
  actor text not null,
  command text not null,
  count int not null,
  verb text not null,
  at_epoch bigint not null
);

create table if not exists undo_stack (
  id bigserial primary key,
  drawing_id text not null references drawings(id) on delete cascade,
  account_id text not null,
  version int not null
);
create index if not exists undo_stack_lookup on undo_stack(drawing_id, account_id, id);

create table if not exists file_versions (
  drawing_id text not null references drawings(id) on delete cascade,
  number int not null,
  created_epoch bigint not null,
  actor text not null,
  size_bytes int not null,
  object_key text not null,
  primary key (drawing_id, number)
);

create table if not exists recent_opens (
  account_id text not null,
  drawing_id text not null references drawings(id) on delete cascade,
  opened_epoch bigint not null,
  primary key (account_id, drawing_id)
);

create table if not exists traces (
  id text primary key,
  drawing_id text not null references drawings(id) on delete cascade,
  name text not null,
  state text not null default 'open',
  author text not null,
  notice text,
  created_epoch bigint not null,
  next_handle int not null default 1
);

create table if not exists trace_objects (
  trace_id text not null references traces(id) on delete cascade,
  handle text not null,
  seq int not null,
  geometry jsonb not null,
  primary key (trace_id, handle)
);

create table if not exists issues (
  drawing_id text not null references drawings(id) on delete cascade,
  number int not null,
  trace_id text not null,
  text text not null,
  status text not null default 'open',
  primary key (drawing_id, number)
);

create table if not exists shares (
  id text primary key,
  drawing_id text not null references drawings(id) on delete cascade,
  token text not null unique,
  access text not null,
  recipient_email text not null,
  recipient_name text,
  expires_epoch bigint,
  revoked boolean not null default false,
  created_epoch bigint not null,
  invited_epoch bigint,
  created_by text not null
);

create table if not exists exports (
  id text primary key,
  drawing_id text not null references drawings(id) on delete cascade,
  format text not null,
  layout text not null,
  file text not null,
  state text not null default 'requested',
  issue_date_key text not null,
  title_block_revision text,
  object_key text,
  size_bytes int,
  requested_epoch bigint not null,
  stored_epoch bigint
);

create table if not exists quotes (
  id bigserial primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  number text not null,
  date_key text not null,
  seq int not null,
  sent_to text not null,
  sent_epoch bigint
);

create table if not exists title_block_revisions (
  workspace_id text not null references workspaces(id) on delete cascade,
  letter text not null,
  footer_note text not null,
  effective_date text not null,
  position int not null default 0,
  primary key (workspace_id, letter)
);

create table if not exists grading_clocks (
  workspace_id text primary key references workspaces(id) on delete cascade,
  base_epoch bigint not null
);

create table if not exists presence (
  tab_id text primary key,
  drawing_id text not null,
  name text not null,
  access text not null,
  state text not null,
  last_input_epoch bigint not null,
  seen_epoch bigint not null
);

create table if not exists xrefs (
  id text primary key,
  drawing_id text not null references drawings(id) on delete cascade,
  source_drawing_id text not null,
  name text not null,
  status text not null default 'loaded'
);

create table if not exists blocks (
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null,
  definition jsonb not null,
  primary key (workspace_id, name)
);
`;

export async function applySchema(): Promise<void> {
  await db.run(`
    create table if not exists schema_migrations (
      id int primary key,
      applied_epoch bigint not null
    );
  `);
  await db.run(schema);
}
