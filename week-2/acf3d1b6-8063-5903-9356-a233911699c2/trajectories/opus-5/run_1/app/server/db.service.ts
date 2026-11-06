import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import * as bcrypt from 'bcryptjs';

const SCHEMA = `
create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text not null check (plan in ('free','standard','pro','max','team')),
  created_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  name text not null,
  email text not null,
  password_hash text not null,
  role text not null check (role in ('owner','member')),
  token_version integer not null default 0,
  created_at timestamptz not null default now(),
  removed_at timestamptz
);
create unique index if not exists users_email_key on users (lower(email));

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  name text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists projects_workspace_name_key on projects (workspace_id, lower(name));

create table if not exists generations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  project_id uuid not null references projects(id),
  user_id uuid not null references users(id),
  model text not null,
  prompt text not null,
  duration integer,
  image_count integer,
  aspect text not null check (aspect in ('16:9','9:16','1:1')),
  cost integer not null check (cost >= 0),
  status text not null check (status in ('queued','rendering','ready','cancelled')),
  idempotency_key text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint generations_finished_matches_status
    check ((status in ('ready','cancelled')) = (finished_at is not null))
);
create unique index if not exists generations_idempotency_key
  on generations (workspace_id, idempotency_key) where idempotency_key is not null;

create table if not exists credit_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  kind text not null check (kind in ('plan','seat','charge','refund')),
  amount integer not null,
  balance_after integer not null check (balance_after >= 0),
  user_id uuid references users(id),
  generation_id uuid references generations(id),
  created_at timestamptz not null default now(),
  constraint credit_entries_generation_matches_kind
    check ((kind in ('charge','refund')) = (generation_id is not null))
);
create unique index if not exists credit_entries_one_charge
  on credit_entries (generation_id) where kind = 'charge';
create unique index if not exists credit_entries_one_refund
  on credit_entries (generation_id) where kind = 'refund';
create index if not exists credit_entries_workspace_idx on credit_entries (workspace_id, created_at, id);

create table if not exists invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  email text not null,
  token text not null unique,
  status text not null check (status in ('pending','accepted','revoked')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);
create unique index if not exists invitations_pending_email_key
  on invitations (workspace_id, lower(email)) where status = 'pending';

create table if not exists enquiries (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('contact','licensing')),
  first_name text,
  last_name text,
  full_name text,
  email text not null,
  company text not null,
  company_size text not null,
  industry text not null,
  products text[],
  message text not null,
  created_at timestamptz not null default now()
);
`;

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  readonly pool: Pool;

  constructor() {
    this.pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 12 });
  }

  async onModuleInit(): Promise<void> {
    await this.pool.query(SCHEMA);
    await this.seed();
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  query<T extends object = Record<string, unknown>>(text: string, values: unknown[] = []) {
    return this.pool.query<T>(text, values);
  }

  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await work(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Locks the workspace row so balance reads, charges and refunds cannot interleave. */
  async lockWorkspace(client: PoolClient, workspaceId: string): Promise<{ id: string; plan: string } | null> {
    const result = await client.query<{ id: string; plan: string }>(
      'select id, plan from workspaces where id = $1 for update',
      [workspaceId]
    );
    return result.rows[0] ?? null;
  }

  async balanceOf(client: Pool | PoolClient, workspaceId: string): Promise<number> {
    const result = await client.query<{ balance: string }>(
      'select coalesce(sum(amount), 0)::bigint as balance from credit_entries where workspace_id = $1',
      [workspaceId]
    );
    return Number(result.rows[0].balance);
  }

  async addCreditEntry(
    client: PoolClient,
    entry: { workspaceId: string; kind: string; amount: number; userId: string | null; generationId: string | null }
  ): Promise<number> {
    const balance = await this.balanceOf(client, entry.workspaceId);
    const balanceAfter = balance + entry.amount;
    await client.query(
      `insert into credit_entries (workspace_id, kind, amount, balance_after, user_id, generation_id)
       values ($1, $2, $3, $4, $5, $6)`,
      [entry.workspaceId, entry.kind, entry.amount, balanceAfter, entry.userId, entry.generationId]
    );
    return balanceAfter;
  }

  private async seed(): Promise<void> {
    await this.transaction(async (client) => {
      await client.query('select pg_advisory_xact_lock(871_236_401)');
      const existing = await client.query('select 1 from workspaces limit 1');
      if (existing.rowCount) return;

      const passwordHash = await bcrypt.hash('deku-demo-pw-2026', 10);
      const ago = (days: number, hours = 0) => `now() - interval '${days} days ${hours} hours'`;

      const northlight = await client.query<{ id: string }>(
        `insert into workspaces (name, plan, created_at) values ('Northlight Studio', 'team', ${ago(30)}) returning id`
      );
      const northlightId = northlight.rows[0].id;
      const mara = await client.query<{ id: string }>(
        `insert into users (workspace_id, name, email, password_hash, role, created_at)
         values ($1, 'Mara Quinn', 'owner@example.com', $2, 'owner', ${ago(30)}) returning id`,
        [northlightId, passwordHash]
      );
      const theo = await client.query<{ id: string }>(
        `insert into users (workspace_id, name, email, password_hash, role, created_at)
         values ($1, 'Theo Park', 'member@example.com', $2, 'member', ${ago(21)}) returning id`,
        [northlightId, passwordHash]
      );
      const spring = await client.query<{ id: string }>(
        `insert into projects (workspace_id, name, created_at) values ($1, 'Spring campaign', ${ago(
          20
        )}) returning id`,
        [northlightId]
      );
      await client.query(
        `insert into projects (workspace_id, name, created_at) values ($1, 'Brand film', ${ago(12)})`,
        [northlightId]
      );
      const maraGeneration = await client.query<{ id: string }>(
        `insert into generations (workspace_id, project_id, user_id, model, prompt, duration, image_count, aspect, cost, status, created_at, finished_at)
         values ($1, $2, $3, 'vela-4.5', 'A paper boat drifting down a rain-soaked street at dusk, cinematic', 10, null, '16:9', 120, 'ready', ${ago(
           6,
           2
         )}, ${ago(6, 1)}) returning id`,
        [northlightId, spring.rows[0].id, mara.rows[0].id]
      );
      const theoGeneration = await client.query<{ id: string }>(
        `insert into generations (workspace_id, project_id, user_id, model, prompt, duration, image_count, aspect, cost, status, created_at, finished_at)
         values ($1, $2, $3, 'vela-image-4', 'A ceramic mug on a linen table in soft morning light', null, 2, '1:1', 16, 'ready', ${ago(
           4,
           3
         )}, ${ago(4, 2)}) returning id`,
        [northlightId, spring.rows[0].id, theo.rows[0].id]
      );
      await client.query(
        `insert into credit_entries (workspace_id, kind, amount, balance_after, user_id, generation_id, created_at) values
         ($1, 'seat', 6900, 6900, $2, null, ${ago(30)}),
         ($1, 'seat', 6900, 13800, $3, null, ${ago(21)}),
         ($1, 'charge', -120, 13680, $2, $4, ${ago(6, 2)}),
         ($1, 'charge', -16, 13664, $3, $5, ${ago(4, 3)})`,
        [northlightId, mara.rows[0].id, theo.rows[0].id, maraGeneration.rows[0].id, theoGeneration.rows[0].id]
      );

      const inesWorkspace = await client.query<{ id: string }>(
        `insert into workspaces (name, plan, created_at) values ('Ines Duarte''s workspace', 'standard', ${ago(
          18
        )}) returning id`
      );
      const inesWorkspaceId = inesWorkspace.rows[0].id;
      const ines = await client.query<{ id: string }>(
        `insert into users (workspace_id, name, email, password_hash, role, created_at)
         values ($1, 'Ines Duarte', 'creator@example.com', $2, 'owner', ${ago(18)}) returning id`,
        [inesWorkspaceId, passwordHash]
      );
      const musicVideo = await client.query<{ id: string }>(
        `insert into projects (workspace_id, name, created_at) values ($1, 'Music video', ${ago(17)}) returning id`,
        [inesWorkspaceId]
      );
      const inesGeneration = await client.query<{ id: string }>(
        `insert into generations (workspace_id, project_id, user_id, model, prompt, duration, image_count, aspect, cost, status, created_at, finished_at)
         values ($1, $2, $3, 'vela-4-turbo', 'Neon reflections on a wet dance floor, slow camera push', 5, null, '9:16', 30, 'ready', ${ago(
           2,
           5
         )}, ${ago(2, 4)}) returning id`,
        [inesWorkspaceId, musicVideo.rows[0].id, ines.rows[0].id]
      );
      await client.query(
        `insert into credit_entries (workspace_id, kind, amount, balance_after, user_id, generation_id, created_at) values
         ($1, 'plan', 625, 625, $2, null, ${ago(18)}),
         ($1, 'charge', -30, 595, $2, $3, ${ago(2, 5)})`,
        [inesWorkspaceId, ines.rows[0].id, inesGeneration.rows[0].id]
      );
    });
  }
}
