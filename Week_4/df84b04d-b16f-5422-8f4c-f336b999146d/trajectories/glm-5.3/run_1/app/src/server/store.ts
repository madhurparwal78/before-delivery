import type { Pool, QueryResultRow } from 'pg';
import type {
  Account,
  BulletRow,
  ShareRow,
  ShareStatus,
  UndoStep,
} from '../domain/types.js';
import { randomBytes, randomUUID } from 'node:crypto';

export interface Placement {
  id: string;
  parentId: string | null;
  position: number;
  depth: number;
  collapsed: boolean;
  original: BulletRow;
  row: BulletRow;
  placeholder: boolean;
}

export interface OutlineSnapshot {
  root: BulletRow | null;
  rootId: string | null;
  isShared: boolean;
  ownerId: string;
  rows: Map<string, BulletRow>;
  placements: Placement[];
}

export interface MoveCheckResult {
  ok: boolean;
  code?: 'no_previous_sibling' | 'at_top' | 'at_first' | 'at_last' | 'inside_itself' | 'too_deep';
}

export interface MovePlan {
  parentId: string | null;
  index: number;
  previousParentId: string | null;
  previousIndex: number;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: Record<string, unknown>,
  ) {
    super(JSON.stringify(body));
  }
}

export function newId(): string {
  return randomUUID();
}

export function newToken(): string {
  return randomBytes(24).toString('base64url');
}

export class Store {
  constructor(private pool: Pool) {}

  async query(sql: string, params: readonly unknown[] = []): Promise<QueryResultRow[]> {
    const result = await this.pool.query(sql, params as unknown[]);
    return result.rows;
  }

  async health(): Promise<boolean> {
    try {
      await this.pool.query('select 1');
      return true;
    } catch {
      return false;
    }
  }

  async tableExists(name: string): Promise<boolean> {
    const rows = await this.query("select to_regclass($1) is not null as ok", [name]);
    return rows[0]?.ok === true;
  }
}

const SCHEMA_SQL = [
  `create table if not exists accounts (
    id text primary key,
    email text not null unique,
    name text not null,
    password_hash text not null,
    confirmed boolean not null default false,
    hide_completed boolean not null default false,
    created_at bigint not null
  )`,
  `create table if not exists signup_codes (
    id text primary key,
    email text not null,
    code_hash text not null,
    expires_at bigint not null,
    created_at bigint not null
  )`,
  `create table if not exists sessions (
    token text primary key,
    account_id text not null,
    created_at bigint not null
  )`,
  `create table if not exists bullets (
    id text primary key,
    owner_id text not null,
    original_id text,
    parent_id text,
    position integer not null,
    text text not null default '',
    completed boolean not null default false,
    collapsed boolean not null default false,
    date text,
    tags text[] not null default '{}',
    mentions text[] not null default '{}',
    revision integer not null default 1,
    trashed_at bigint,
    purged boolean not null default false,
    created_at bigint not null
  )`,
  `create table if not exists shares (
    id text primary key,
    bullet_id text not null,
    owner_id text not null,
    email text not null,
    token text not null unique,
    status text not null,
    created_at bigint not null,
    accepted_at bigint
  )`,
  `create table if not exists undo_steps (
    id text primary key,
    account_id text not null,
    kind text not null,
    created_at bigint not null,
    payload jsonb not null
  )`,
  `create index if not exists undo_steps_account_idx on undo_steps (account_id, created_at desc)`,
  `create table if not exists redo_steps (
    id text primary key,
    account_id text not null,
    kind text not null,
    created_at bigint not null,
    payload jsonb not null
  )`,
  `create index if not exists redo_steps_account_idx on redo_steps (account_id, created_at desc)`,
  `create table if not exists outline_seq (
    owner_id text primary key,
    seq bigint not null default 0
  )`,
  `create table if not exists change_log (
    owner_id text not null,
    seq bigint not null,
    message jsonb not null,
    created_at bigint not null,
    primary key (owner_id, seq)
  )`,
  `create index if not exists bullets_owner_parent_idx on bullets (owner_id, parent_id, position)`,
  `create index if not exists bullets_original_idx on bullets (original_id)`,
  `create index if not exists shares_email_idx on shares (email, status)`,
];

export async function applySchema(pool: Pool): Promise<void> {
  for (const sql of SCHEMA_SQL) {
    await pool.query(sql);
  }
}

export interface BulletFilter {
  includeTrashed?: boolean;
}

export function rowToBulletRow(row: QueryResultRow): BulletRow {
  return {
    id: row.id,
    ownerId: row.owner_id,
    originalId: row.original_id,
    parentId: row.parent_id,
    position: row.position,
    text: row.text,
    completed: row.completed,
    collapsed: row.collapsed,
    date: row.date,
    tags: row.tags,
    mentions: row.mentions,
    revision: row.revision,
    trashedAt: row.trashed_at ? Number(row.trashed_at) : null,
    purged: row.purged,
    createdAt: Number(row.created_at),
  };
}

export function rowToAccount(row: QueryResultRow): Account {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    hideCompleted: row.hide_completed,
  };
}

export function rowToShare(row: QueryResultRow): ShareRow {
  return {
    id: row.id,
    bulletId: row.bullet_id,
    ownerId: row.owner_id,
    email: row.email,
    token: row.token,
    status: row.status as ShareStatus,
    createdAt: Number(row.created_at),
  };
}

export function rowToUndoStep(row: QueryResultRow): UndoStep {
  return {
    id: row.id,
    accountId: row.account_id,
    kind: row.kind as UndoStep['kind'],
    createdAt: Number(row.created_at),
    payload: row.payload as Record<string, unknown>,
  };
}

export async function nextSeq(pool: Pool, ownerId: string): Promise<number> {
  const rows = await pool.query(
    `update outline_seq set seq = seq + 1 where owner_id = $1 returning seq`,
    [ownerId],
  );
  if (rows.rows.length === 0) {
    const ins = await pool.query(
      `insert into outline_seq (owner_id, seq) values ($1, 1)
       on conflict (owner_id) do update set seq = outline_seq.seq + 1
       returning seq`,
      [ownerId],
    );
    return Number(ins.rows[0]?.seq);
  }
  return Number(rows.rows[0]?.seq);
}

export async function accountByEmail(pool: Pool, email: string): Promise<QueryResultRow | null> {
  const rows = await pool.query(`select * from accounts where email = $1`, [email]);
  return rows.rows[0] ?? null;
}

export async function accountById(pool: Pool, id: string): Promise<QueryResultRow | null> {
  const rows = await pool.query(`select * from accounts where id = $1`, [id]);
  return rows.rows[0] ?? null;
}

export async function insertAccount(
  pool: Pool,
  account: { id: string; email: string; name: string; passwordHash: string; confirmed: boolean },
): Promise<void> {
  await pool.query(
    `insert into accounts (id, email, name, password_hash, confirmed, hide_completed, created_at)
     values ($1, $2, $3, $4, $5, false, $6)`,
    [account.id, account.email, account.name, account.passwordHash, account.confirmed, Date.now()],
  );
}

export async function sessionAccount(pool: Pool, token: string): Promise<QueryResultRow | null> {
  const rows = await pool.query(
    `select a.* from sessions s join accounts a on a.id = s.account_id where s.token = $1`,
    [token],
  );
  return rows.rows[0] ?? null;
}

export async function insertSession(pool: Pool, accountId: string): Promise<string> {
  const token = newToken();
  await pool.query(`insert into sessions (token, account_id, created_at) values ($1, $2, $3)`, [
    token,
    accountId,
    Date.now(),
  ]);
  return token;
}

export async function shareByToken(pool: Pool, token: string): Promise<QueryResultRow | null> {
  const rows = await pool.query(`select * from shares where token = $1`, [token]);
  return rows.rows[0] ?? null;
}

export async function shareById(pool: Pool, id: string): Promise<QueryResultRow | null> {
  const rows = await pool.query(`select * from shares where id = $1`, [id]);
  return rows.rows[0] ?? null;
}

export async function acceptedSharesFor(pool: Pool, email: string): Promise<ShareRow[]> {
  const rows = await pool.query(
    `select s.*, b.text as bullet_text, b.purged as bullet_purged, b.trashed_at as bullet_trashed, a.name as owner_name
     from shares s
     join bullets b on b.id = s.bullet_id
     join accounts a on a.id = s.owner_id
     where s.email = $1 and s.status = 'accepted' and b.trashed_at is null and b.purged = false
     order by s.created_at asc`,
    [email],
  );
  return rows.rows.map(rowToShare);
}

export async function insertBullet(
  pool: Pool,
  bullet: BulletRow,
): Promise<void> {
  await pool.query(
    `insert into bullets (id, owner_id, original_id, parent_id, position, text, completed, collapsed, date, tags, mentions, revision, trashed_at, purged, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      bullet.id,
      bullet.ownerId,
      bullet.originalId,
      bullet.parentId,
      bullet.position,
      bullet.text,
      bullet.completed,
      bullet.collapsed,
      bullet.date,
      bullet.tags,
      bullet.mentions,
      bullet.revision,
      bullet.trashedAt,
      bullet.purged,
      bullet.createdAt,
    ],
  );
}

export interface OwnerScope {
  ownerId: string;
  isShare: boolean;
  sharedRootId: string | null;
}

export function ownerOf(row: BulletRow): string {
  return row.ownerId;
}
