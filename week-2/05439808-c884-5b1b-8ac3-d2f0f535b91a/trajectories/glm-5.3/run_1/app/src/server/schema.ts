// PostgreSQL schema and seed data, applied idempotently on every start.
import argon2 from 'argon2';
import type { PoolClient } from 'pg';
import { getApp } from './runtime.ts';
import { createStarterVillage, layOutStarterIsland } from './island.ts';

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS accounts (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  email_lc TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  role TEXT NOT NULL DEFAULT 'islander',
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS tokens (
  id BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES accounts(id),
  kind TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  issued_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  used_at BIGINT,
  superseded_at BIGINT
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  account_id BIGINT REFERENCES accounts(id),
  csrf_token TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  ended_at BIGINT
);
CREATE TABLE IF NOT EXISTS throttle_keys (
  key TEXT PRIMARY KEY,
  last_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS throttle_events (
  id BIGSERIAL PRIMARY KEY,
  key TEXT NOT NULL,
  at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS throttle_events_key_at ON throttle_events (key, at);
CREATE TABLE IF NOT EXISTS idempotency (
  account_id BIGINT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  key TEXT NOT NULL,
  body JSONB NOT NULL,
  status INT NOT NULL,
  response JSONB NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (account_id, method, path, key)
);
CREATE TABLE IF NOT EXISTS villages (
  id BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL UNIQUE REFERENCES accounts(id),
  trophies INT NOT NULL DEFAULT 0,
  shield_ends_at BIGINT,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS buildings (
  id BIGSERIAL PRIMARY KEY,
  village_id BIGINT NOT NULL REFERENCES villages(id),
  type TEXT NOT NULL,
  x INT NOT NULL,
  y INT NOT NULL,
  rotation INT NOT NULL DEFAULT 0,
  level INT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  job_to_level INT,
  job_started_at BIGINT,
  job_finishes_at BIGINT,
  job_cost_brine INT NOT NULL DEFAULT 0,
  job_cost_peat INT NOT NULL DEFAULT 0,
  job_cost_copper INT NOT NULL DEFAULT 0,
  accrual_started_at BIGINT
);
CREATE INDEX IF NOT EXISTS buildings_village ON buildings (village_id);
CREATE SEQUENCE IF NOT EXISTS ledger_pair_seq;
CREATE TABLE IF NOT EXISTS ledger (
  id BIGSERIAL PRIMARY KEY,
  pair_id BIGINT NOT NULL,
  village_id BIGINT REFERENCES villages(id),
  kind TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount BIGINT NOT NULL,
  counterparty_kind TEXT NOT NULL,
  counterparty_village_id BIGINT REFERENCES villages(id),
  raid_id BIGINT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_village ON ledger (village_id, id DESC);
CREATE INDEX IF NOT EXISTS ledger_pair ON ledger (pair_id);
CREATE TABLE IF NOT EXISTS training_batches (
  id BIGSERIAL PRIMARY KEY,
  village_id BIGINT NOT NULL REFERENCES villages(id),
  unit TEXT NOT NULL,
  count INT NOT NULL,
  starts_at BIGINT NOT NULL,
  finishes_at BIGINT NOT NULL,
  queued_at BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
);
CREATE INDEX IF NOT EXISTS training_village ON training_batches (village_id, status);
CREATE TABLE IF NOT EXISTS raids (
  id BIGSERIAL PRIMARY KEY,
  attacker_village_id BIGINT NOT NULL REFERENCES villages(id),
  defender_village_id BIGINT NOT NULL REFERENCES villages(id),
  state TEXT NOT NULL,
  end_reason TEXT,
  locked_at BIGINT NOT NULL,
  finalize_by BIGINT NOT NULL,
  seed BIGINT NOT NULL,
  res_saltjack INT NOT NULL,
  res_peat_slinger INT NOT NULL,
  lootable_brine INT NOT NULL,
  lootable_peat INT NOT NULL,
  lootable_copper INT NOT NULL,
  res_lootable_brine INT,
  res_lootable_peat INT,
  res_lootable_copper INT,
  final_tick INT,
  destruction INT,
  stars INT,
  loot_brine INT,
  loot_peat INT,
  loot_copper INT,
  transferred_brine INT,
  transferred_peat INT,
  transferred_copper INT,
  trophies_attacker INT,
  trophies_defender INT,
  star_bonus INT,
  resolved_at BIGINT,
  layout JSONB NOT NULL,
  deploys JSONB NOT NULL,
  hashes JSONB,
  result JSONB
);
CREATE INDEX IF NOT EXISTS raids_attacker ON raids (attacker_village_id, id DESC);
CREATE INDEX IF NOT EXISTS raids_defender ON raids (defender_village_id, id DESC);
CREATE TABLE IF NOT EXISTS cooldowns (
  attacker_village_id BIGINT NOT NULL REFERENCES villages(id),
  defender_village_id BIGINT NOT NULL REFERENCES villages(id),
  until BIGINT NOT NULL,
  PRIMARY KEY (attacker_village_id, defender_village_id)
);
CREATE TABLE IF NOT EXISTS reward_claims (
  id BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES accounts(id),
  kind TEXT NOT NULL,
  at BIGINT NOT NULL,
  zone TEXT NOT NULL,
  step INT
);
CREATE INDEX IF NOT EXISTS reward_claims_account ON reward_claims (account_id, kind, at DESC);
CREATE TABLE IF NOT EXISTS clans (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  motto TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  dissolved_at BIGINT
);
CREATE UNIQUE INDEX IF NOT EXISTS clans_name_live ON clans (lower(name)) WHERE dissolved_at IS NULL;
CREATE TABLE IF NOT EXISTS clan_members (
  clan_id BIGINT NOT NULL REFERENCES clans(id),
  account_id BIGINT NOT NULL REFERENCES accounts(id),
  role TEXT NOT NULL,
  joined_at BIGINT NOT NULL,
  mate_since BIGINT,
  PRIMARY KEY (clan_id, account_id)
);
CREATE INDEX IF NOT EXISTS clan_members_account ON clan_members (account_id);
CREATE TABLE IF NOT EXISTS invitations (
  id BIGSERIAL PRIMARY KEY,
  clan_id BIGINT NOT NULL REFERENCES clans(id),
  email_lc TEXT NOT NULL,
  invited_by BIGINT NOT NULL REFERENCES accounts(id),
  created_at BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
);
CREATE INDEX IF NOT EXISTS invitations_email ON invitations (email_lc, status);
CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  clan_id BIGINT NOT NULL REFERENCES clans(id),
  author_id BIGINT NOT NULL REFERENCES accounts(id),
  body TEXT,
  removed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_clan ON messages (clan_id, id);
CREATE TABLE IF NOT EXISTS requests (
  id BIGSERIAL PRIMARY KEY,
  clan_id BIGINT NOT NULL REFERENCES clans(id),
  requester_id BIGINT NOT NULL REFERENCES accounts(id),
  unit TEXT NOT NULL,
  count INT NOT NULL,
  given INT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open',
  closed_at BIGINT
);
CREATE TABLE IF NOT EXISTS donations (
  id BIGSERIAL PRIMARY KEY,
  clan_id BIGINT NOT NULL REFERENCES clans(id),
  request_id BIGINT NOT NULL REFERENCES requests(id),
  donor_id BIGINT NOT NULL REFERENCES accounts(id),
  recipient_id BIGINT NOT NULL REFERENCES accounts(id),
  unit TEXT NOT NULL,
  count INT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS donations_donor ON donations (clan_id, donor_id, created_at);
CREATE INDEX IF NOT EXISTS donations_recipient ON donations (clan_id, recipient_id, created_at);
CREATE TABLE IF NOT EXISTS mail_queue (
  id BIGSERIAL PRIMARY KEY,
  to_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  claimed_at BIGINT,
  sent_at BIGINT
);
`;

export async function migrate(client: PoolClient): Promise<void> {
  await client.query(SCHEMA_SQL);
}

export interface SeedAccount {
  email: string;
  password: string;
  displayName: string;
  timeZone: string;
  role: 'islander' | 'operator';
  trophies?: number;
}

export const SEED_ACCOUNTS: SeedAccount[] = [
  { email: 'ops@lowtide.test', password: 'Tideline-Operator-27', displayName: 'Studio Ops', timeZone: 'UTC', role: 'operator' },
  { email: 'ivo@lowtide.test', password: 'Saltpan-Ivo-27', displayName: 'Ivo Brack', timeZone: 'America/Chicago', role: 'islander', trophies: 120 },
  { email: 'marrow@lowtide.test', password: 'Saltpan-Marrow-27', displayName: 'Marrow Quay', timeZone: 'Europe/Lisbon', role: 'islander', trophies: 240 },
  { email: 'pell@lowtide.test', password: 'Saltpan-Pell-27', displayName: 'Pell Saunder', timeZone: 'Australia/Hobart', role: 'islander', trophies: 610 },
  { email: 'wren@lowtide.test', password: 'Saltpan-Wren-27', displayName: 'Wren Sallow', timeZone: 'Europe/Dublin', role: 'islander', trophies: 396 },
  { email: 'tamsin@lowtide.test', password: 'Saltpan-Tamsin-27', displayName: 'Tamsin Rook', timeZone: 'Asia/Kolkata', role: 'islander', trophies: 401 },
];

export const SEED_HASH_OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export async function seed(client: PoolClient): Promise<void> {
  const existing = await client.query<{ id: string }>('SELECT id FROM accounts WHERE email_lc = $1', ['ops@lowtide.test']);
  if (existing.rows.length > 0) return;

  const now = getApp().clock.now();

  const villageIds: Record<string, number> = {};
  for (const account of SEED_ACCOUNTS) {
    const hash = await argon2.hash(account.password, SEED_HASH_OPTIONS);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO accounts (email, email_lc, password_hash, display_name, time_zone, verified, role, created_at)
       VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7) RETURNING id`,
      [account.email, account.email.toLowerCase(), hash, account.displayName, account.timeZone, account.role, now]
    );
    const accountId = Number(inserted.rows[0].id);
    if (account.role === 'operator') continue;

    const village = await client.query<{ id: string }>(
      'INSERT INTO villages (account_id, trophies, created_at) VALUES ($1, $2, $3) RETURNING id',
      [accountId, account.trophies ?? 0, now]
    );
    const villageId = Number(village.rows[0].id);
    villageIds[account.email] = villageId;
    await layOutStarterIsland(client, villageId, now);
  }

  const clan = await client.query<{ id: string }>(
    'INSERT INTO clans (name, motto, created_at) VALUES ($1, $2, $3) RETURNING id',
    ['Brackwater Kin', 'We keep the sluice open.', now]
  );
  const clanId = Number(clan.rows[0].id);
  const pell = await client.query<{ id: string }>('SELECT id FROM accounts WHERE email_lc = $1', ['pell@lowtide.test']);
  const ivo = await client.query<{ id: string }>('SELECT id FROM accounts WHERE email_lc = $1', ['ivo@lowtide.test']);
  await client.query(
    `INSERT INTO clan_members (clan_id, account_id, role, joined_at, mate_since) VALUES ($1, $2, 'skipper', $3, NULL), ($1, $4, 'mate', $5, $5)`,
    [clanId, Number(pell.rows[0].id), now, Number(ivo.rows[0].id), now + 1]
  );
}
