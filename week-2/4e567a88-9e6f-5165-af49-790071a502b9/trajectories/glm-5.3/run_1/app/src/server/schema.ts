// Schema and seed, applied idempotently on every start.
import type { Pool } from "./db.js";
import { CATALOGUE } from "../shared/models.js";
import { createHash, scryptSync, randomBytes } from "node:crypto";

const DDL = `
CREATE TABLE IF NOT EXISTS orgs (
  id text PRIMARY KEY,
  name text NOT NULL,
  timezone text NOT NULL,
  retention_days integer NOT NULL
);
CREATE TABLE IF NOT EXISTS teams (
  id text PRIMARY KEY,
  name text NOT NULL,
  concurrency integer NOT NULL,
  payload_visibility text NOT NULL,
  soft_cap_credits integer NOT NULL,
  hard_cap_credits integer NOT NULL,
  api_default text NOT NULL,
  playground_default text NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  passcode_hash text NOT NULL,
  role text NOT NULL,
  team_id text REFERENCES teams(id),
  api_key text NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS models (
  slug text PRIMARY KEY,
  name text NOT NULL,
  modality text NOT NULL,
  unit text NOT NULL,
  unit_label text NOT NULL,
  input_schema jsonb NOT NULL,
  rail_order integer NOT NULL
);
CREATE TABLE IF NOT EXISTS rates (
  id text PRIMARY KEY,
  model_slug text NOT NULL REFERENCES models(slug),
  micro_per_unit bigint NOT NULL,
  effective_at timestamptz NOT NULL,
  effective_at_local text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE SEQUENCE IF NOT EXISTS rate_seq START 5;
CREATE TABLE IF NOT EXISTS org_model_access (
  model_slug text PRIMARY KEY REFERENCES models(slug),
  api text NOT NULL,
  playground text NOT NULL
);
CREATE TABLE IF NOT EXISTS team_model_access (
  team_id text NOT NULL REFERENCES teams(id),
  model_slug text NOT NULL REFERENCES models(slug),
  api text NOT NULL,
  playground text NOT NULL,
  PRIMARY KEY (team_id, model_slug)
);
CREATE TABLE IF NOT EXISTS jobs (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES teams(id),
  model_slug text NOT NULL REFERENCES models(slug),
  status text NOT NULL,
  priority text NOT NULL,
  submitted_by text NOT NULL REFERENCES members(id),
  submitted_at timestamptz NOT NULL,
  started_at timestamptz,
  finished_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  lapse_count integer NOT NULL DEFAULT 0,
  failure_reason text,
  waiting_reason text,
  rate_id text NOT NULL REFERENCES rates(id),
  est_num bigint NOT NULL,
  est_den bigint NOT NULL,
  billed_num bigint,
  billed_den bigint,
  reserved_micro bigint NOT NULL,
  charged_micro bigint,
  released_micro bigint NOT NULL DEFAULT 0,
  input jsonb NOT NULL,
  context text NOT NULL,
  lease_expires_at timestamptz
);
CREATE SEQUENCE IF NOT EXISTS job_seq START 1;
CREATE TABLE IF NOT EXISTS job_outputs (
  job_id text NOT NULL REFERENCES jobs(id),
  n integer NOT NULL,
  asset_id text NOT NULL,
  PRIMARY KEY (job_id, n)
);
CREATE TABLE IF NOT EXISTS ledger_movements (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES teams(id),
  kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  job_id text REFERENCES jobs(id),
  topup_id text,
  kb_invoice_id text
);
CREATE SEQUENCE IF NOT EXISTS movement_seq START 1;
CREATE TABLE IF NOT EXISTS ledger_entries (
  movement_id text NOT NULL REFERENCES ledger_movements(id),
  account text NOT NULL,
  amount_micro bigint NOT NULL,
  PRIMARY KEY (movement_id, account)
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  team_id text NOT NULL REFERENCES teams(id),
  key text NOT NULL,
  request_hash text NOT NULL,
  state text NOT NULL,
  response_status integer,
  response_body jsonb,
  job_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, key)
);
CREATE TABLE IF NOT EXISTS assets (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES teams(id),
  kind text NOT NULL,
  media_type text NOT NULL,
  job_id text REFERENCES jobs(id),
  model_slug text,
  width integer,
  height integer,
  duration_seconds numeric,
  bytes bigint NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  object_key text NOT NULL,
  state text NOT NULL,
  removed_at timestamptz,
  removed_reason text,
  uploaded_by text REFERENCES members(id)
);
CREATE SEQUENCE IF NOT EXISTS asset_seq START 1;
CREATE TABLE IF NOT EXISTS lineage_edges (
  from_asset text NOT NULL REFERENCES assets(id),
  to_asset text NOT NULL REFERENCES assets(id),
  job_id text NOT NULL REFERENCES jobs(id),
  PRIMARY KEY (from_asset, to_asset, job_id)
);
CREATE TABLE IF NOT EXISTS topups (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES teams(id),
  credits integer NOT NULL,
  amount_usd text NOT NULL,
  status text NOT NULL,
  pending_reason text,
  failure_reason text,
  kb_account_id text,
  kb_invoice_id text,
  kb_payment_id text,
  created_by text NOT NULL REFERENCES members(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);
CREATE TABLE IF NOT EXISTS policy_versions (
  version integer PRIMARY KEY,
  policy jsonb NOT NULL,
  saved_by text NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES teams(id),
  url text NOT NULL,
  state text NOT NULL,
  consecutive_failures integer NOT NULL DEFAULT 0,
  secret text NOT NULL,
  created_by text NOT NULL REFERENCES members(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE SEQUENCE IF NOT EXISTS endpoint_seq START 1;
CREATE TABLE IF NOT EXISTS webhook_events (
  id text PRIMARY KEY,
  endpoint_id text NOT NULL REFERENCES webhook_endpoints(id),
  job_id text NOT NULL,
  event_type text NOT NULL,
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  state text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz
);
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES webhook_events(id),
  endpoint_id text NOT NULL REFERENCES webhook_endpoints(id),
  attempt integer NOT NULL,
  attempted_at timestamptz NOT NULL,
  status_code integer,
  outcome text NOT NULL,
  next_attempt_at timestamptz
);
CREATE SEQUENCE IF NOT EXISTS delivery_seq START 1;
CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  member_id text NOT NULL REFERENCES members(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS budget_notices (
  team_id text NOT NULL REFERENCES teams(id),
  kind text NOT NULL,
  period_start timestamptz NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, kind, period_start)
);
CREATE TABLE IF NOT EXISTS refusals (
  id serial PRIMARY KEY,
  team_id text NOT NULL REFERENCES teams(id),
  at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL
);
`;

const SEED_RATE_EFFECTIVE = Date.UTC(2026, 0, 1, 5, 0, 0); // 2026-01-01T00:00:00 America/New_York

function hashPasscode(passcode: string): string {
  const salt = "dispatch-static-salt";
  const h = scryptSync(passcode, salt, 32).toString("hex");
  return `scrypt:${salt}:${h}`;
}

export async function applySchemaAndSeed(pool: Pool): Promise<void> {
  await pool.exec(DDL);

  await pool.exec(
    `INSERT INTO orgs (id, name, timezone, retention_days) VALUES ('org', 'Halden Works', 'America/New_York', 30)
     ON CONFLICT (id) DO NOTHING`,
  );

  const teams: [string, string, number, string, number, number][] = [
    ["t_storefront", "Storefront", 2, "team", 3000, 4000],
    ["t_campaigns", "Campaigns", 1, "team", 300, 400],
  ];
  for (const [id, name, concurrency, visibility, soft, hard] of teams) {
    await pool.exec(
      `INSERT INTO teams (id, name, concurrency, payload_visibility, soft_cap_credits, hard_cap_credits, api_default, playground_default)
       VALUES ($1,$2,$3,$4,$5,$6,'inherit','inherit') ON CONFLICT (id) DO NOTHING`,
      [id, name, concurrency, visibility, soft, hard],
    );
  }

  const pass = hashPasscode("lumen-pass-2026");
  const members: [string, string, string, string, string | null, string][] = [
    ["m_mara", "Mara Okonkwo", "mara@halden.example", "member", "t_storefront", "dpk_mara_4c19e7"],
    ["m_theo", "Theo Lindqvist", "theo@halden.example", "member", "t_storefront", "dpk_theo_82ad30"],
    ["m_ines", "Ines Calloway", "ines@halden.example", "member", "t_campaigns", "dpk_ines_5be611"],
    ["m_rafael", "Rafael Duarte", "rafael@halden.example", "admin", null, "dpk_rafael_0f7c42"],
    ["m_june", "June Whitford", "june@halden.example", "finance", null, "dpk_june_d39a58"],
    ["m_sol", "Sol Abernathy", "sol@halden.example", "compliance", null, "dpk_sol_61e2bf"],
  ];
  for (const [id, name, email, role, teamId, apiKey] of members) {
    await pool.exec(
      `INSERT INTO members (id, name, email, passcode_hash, role, team_id, api_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
      [id, name, email, pass, role, teamId, apiKey],
    );
  }

  for (let i = 0; i < CATALOGUE.length; i++) {
    const m = CATALOGUE[i];
    await pool.exec(
      `INSERT INTO models (slug, name, modality, unit, unit_label, input_schema, rail_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (slug) DO NOTHING`,
      [m.slug, m.name, m.modality, m.unit, m.unit_label, JSON.stringify(m.fields), i + 1],
    );
  }

  const rates: [string, string, number][] = [
    ["r_1", "quill-still", 4_000_000],
    ["r_2", "halftone-xl", 3_333_333],
    ["r_3", "reel-10", 8_500_000],
    ["r_4", "murmur-voice", 400_000],
  ];
  for (const [id, slug, micro] of rates) {
    await pool.exec(
      `INSERT INTO rates (id, model_slug, micro_per_unit, effective_at, effective_at_local, created_by)
       VALUES ($1,$2,$3,$4,$5,'seed') ON CONFLICT (id) DO NOTHING`,
      [id, slug, micro, new Date(SEED_RATE_EFFECTIVE), "2026-01-01T00:00:00"],
    );
  }

  await pool.exec(
    `INSERT INTO org_model_access (model_slug, api, playground)
     SELECT slug, 'allowed', CASE WHEN slug = 'reel-10' THEN 'blocked' ELSE 'allowed' END FROM models
     ON CONFLICT (model_slug) DO NOTHING`,
  );
  await pool.exec(
    `INSERT INTO team_model_access (team_id, model_slug, api, playground) VALUES
       ('t_campaigns', 'reel-10', 'inherit', 'allowed'),
       ('t_storefront', 'murmur-voice', 'blocked', 'inherit')
     ON CONFLICT (team_id, model_slug) DO NOTHING`,
  );

  // Opening grants: one movement per team, only when the team has none.
  for (const [id, , , , , grant] of [
    ["t_storefront", "", 0, "", 0, 5_000],
    ["t_campaigns", "", 0, "", 0, 600],
  ] as [string, string, number, string, number, number][]) {
    const existing = await pool.one<{ n: number }>(`SELECT count(*)::int AS n FROM ledger_movements WHERE team_id = $1`, [id]);
    if ((existing?.n ?? 0) === 0) {
      await pool.tx(async (tx) => {
        const seq = await tx.one<{ nextval: number }>(`SELECT nextval('movement_seq') AS nextval`);
        const mvId = `mv_${seq?.nextval}`;
        await tx.exec(
          `INSERT INTO ledger_movements (id, team_id, kind) VALUES ($1,$2,'opening_grant')`,
          [mvId, id],
        );
        await tx.exec(
          `INSERT INTO ledger_entries (movement_id, account, amount_micro) VALUES ($1,'funding',$2), ($1,'available',$3)`,
          [mvId, -BigInt(grant) * 1_000_000n, BigInt(grant) * 1_000_000n],
        );
      });
    }
  }

  // Policy version 1 from the seeded settings.
  const hasVersion = await pool.one<{ n: number }>(`SELECT count(*)::int AS n FROM policy_versions`);
  if ((hasVersion?.n ?? 0) === 0) {
    const policy = await currentPolicyJson(pool);
    await pool.exec(
      `INSERT INTO policy_versions (version, policy, saved_by) VALUES (1, $1, 'seed')`,
      [JSON.stringify(policy)],
    );
  }
}

/** The policy object as currently stored in the operational tables. */
export async function currentPolicyJson(pool: Pool): Promise<unknown> {
  const org = await pool.one<{ timezone: string; retention_days: number }>(`SELECT timezone, retention_days FROM orgs WHERE id = 'org'`);
  const teams = await pool.many<{ id: string; name: string; concurrency: number; payload_visibility: string; soft_cap_credits: number; hard_cap_credits: number; api_default: string; playground_default: string }>(
    `SELECT id, name, concurrency, payload_visibility, soft_cap_credits, hard_cap_credits, api_default, playground_default FROM teams ORDER BY id`,
  );
  const teamAccess = await pool.many<{ team_id: string; model_slug: string; api: string; playground: string }>(
    `SELECT team_id, model_slug, api, playground FROM team_model_access`,
  );
  const orgAccess = await pool.many<{ model_slug: string; api: string; playground: string }>(
    `SELECT model_slug, api, playground FROM org_model_access`,
  );
  const models = await pool.many<{ slug: string }>(`SELECT slug FROM models ORDER BY rail_order`);
  const orgMap: Record<string, { api: string; playground: string }> = {};
  for (const slug of models.map((m) => m.slug)) {
    const row = orgAccess.find((a) => a.model_slug === slug);
    orgMap[slug] = { api: row?.api ?? "allowed", playground: row?.playground ?? "allowed" };
  }
  const versionRow = await pool.one<{ max: number }>(`SELECT max(version)::int AS max FROM policy_versions`);
  return {
    version: versionRow?.max ?? 1,
    timezone: org?.timezone ?? "UTC",
    retention_days: org?.retention_days ?? 30,
    org_model_access: orgMap,
    teams: teams.map((t) => ({
      id: t.id,
      name: t.name,
      concurrency: t.concurrency,
      payload_visibility: t.payload_visibility,
      soft_cap_credits: t.soft_cap_credits,
      hard_cap_credits: t.hard_cap_credits,
      context_defaults: { api: t.api_default, playground: t.playground_default },
      model_access: Object.fromEntries(
        models.map((m) => {
          const row = teamAccess.find((a) => a.team_id === t.id && a.model_slug === m.slug);
          return [m.slug, { api: row?.api ?? "inherit", playground: row?.playground ?? "inherit" }];
        }),
      ),
    })),
  };
}

export function canonicalBody(model: string, input: unknown, priority: string | undefined): string {
  return JSON.stringify({ model, input, priority: priority ?? "normal" }, (_k, v) => v);
}

export function hashRequest(model: string, input: unknown, priority: string | undefined): string {
  return createHash("sha256").update(canonicalBody(model, input, priority)).digest("hex");
}

export function randomSalt(): string {
  return randomBytes(8).toString("hex");
}
