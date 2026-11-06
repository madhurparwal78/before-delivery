// Schema and seed, applied idempotently on every start against an empty or existing database.

import { createHash, randomBytes, scryptSync } from "node:crypto";
import type pg from "pg";
import { tx } from "./db";
import { MICRO } from "../shared/money";
import type { InputSchema } from "../shared/schema";
import { instantOf } from "../shared/tz";
import { UNIT_RULES } from "../shared/units";
import { postMovement } from "./domain/ledger";
import type { Context, OrgAccess, Policy, TeamAccess, TeamPolicy } from "./domain/policy";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS teams (
  id text PRIMARY KEY, name text NOT NULL, position int NOT NULL);
CREATE TABLE IF NOT EXISTS members (
  id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('member', 'admin', 'finance', 'compliance')),
  team_id text REFERENCES teams, passcode_hash text NOT NULL, api_key_hash text NOT NULL UNIQUE,
  position int NOT NULL,
  CHECK ((role = 'member') = (team_id IS NOT NULL)));
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY, member_id text NOT NULL REFERENCES members, created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS models (
  slug text PRIMARY KEY, name text NOT NULL, modality text NOT NULL CHECK (modality IN ('image', 'video', 'audio')),
  unit text NOT NULL, position int NOT NULL, input_schema json NOT NULL);
CREATE SEQUENCE IF NOT EXISTS rate_number START 5;
CREATE TABLE IF NOT EXISTS rates (
  id text PRIMARY KEY, model text NOT NULL REFERENCES models,
  micro_per_unit bigint NOT NULL CHECK (micro_per_unit BETWEEN 1 AND 1000000000000),
  effective_at timestamptz NOT NULL, created_by text REFERENCES members, created_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS rates_model ON rates (model, effective_at);
CREATE TABLE IF NOT EXISTS policy_versions (
  version int PRIMARY KEY, policy jsonb NOT NULL, saved_by text REFERENCES members, saved_at timestamptz NOT NULL);
CREATE SEQUENCE IF NOT EXISTS job_number;
CREATE TABLE IF NOT EXISTS jobs (
  number bigint PRIMARY KEY, id text NOT NULL UNIQUE, team_id text NOT NULL REFERENCES teams,
  model text NOT NULL REFERENCES models,
  status text NOT NULL CHECK (status IN ('queued', 'leased', 'running', 'succeeded', 'failed', 'cancelled')),
  priority text NOT NULL CHECK (priority IN ('high', 'normal', 'low')), priority_rank smallint NOT NULL,
  submitted_by text NOT NULL REFERENCES members, submitted_at timestamptz NOT NULL,
  submitted_context text NOT NULL CHECK (submitted_context IN ('api', 'playground')),
  started_at timestamptz, finished_at timestamptz, attempts int NOT NULL DEFAULT 0, lapses int NOT NULL DEFAULT 0,
  lease_expires_at timestamptz, failure_reason text,
  rate_id text NOT NULL REFERENCES rates, rate_micro bigint NOT NULL, unit text NOT NULL,
  estimated_units_micro bigint NOT NULL, billed_units_micro bigint,
  reserved_micro bigint NOT NULL CHECK (reserved_micro >= 0), charged_micro bigint,
  input jsonb NOT NULL, input_assets text[] NOT NULL);
CREATE INDEX IF NOT EXISTS jobs_team_status ON jobs (team_id, status);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  team_id text NOT NULL REFERENCES teams, key text NOT NULL, fingerprint text NOT NULL,
  status int, response jsonb, created_at timestamptz NOT NULL, PRIMARY KEY (team_id, key));
CREATE TABLE IF NOT EXISTS replays (job_id text NOT NULL REFERENCES jobs (id), at timestamptz NOT NULL);
CREATE SEQUENCE IF NOT EXISTS movement_number;
CREATE TABLE IF NOT EXISTS movements (
  number bigint PRIMARY KEY, id text NOT NULL UNIQUE, team_id text NOT NULL REFERENCES teams,
  kind text NOT NULL CHECK (kind IN ('opening_grant', 'top_up', 'reserve', 'settle', 'release')),
  created_at timestamptz NOT NULL, job_id text REFERENCES jobs (id), topup_id text, kb_invoice_id text);
CREATE INDEX IF NOT EXISTS movements_team ON movements (team_id, number);
CREATE INDEX IF NOT EXISTS movements_job ON movements (job_id);
CREATE TABLE IF NOT EXISTS entries (
  movement_number bigint NOT NULL REFERENCES movements,
  account text NOT NULL CHECK (account IN ('funding', 'available', 'reserved', 'settled')),
  amount_micro bigint NOT NULL CHECK (amount_micro <> 0), PRIMARY KEY (movement_number, account));
CREATE SEQUENCE IF NOT EXISTS topup_number;
CREATE TABLE IF NOT EXISTS topups (
  number bigint PRIMARY KEY, id text NOT NULL UNIQUE, team_id text NOT NULL REFERENCES teams,
  credits int NOT NULL CHECK (credits BETWEEN 100 AND 100000 AND credits % 100 = 0),
  status text NOT NULL CHECK (status IN ('pending', 'paid', 'failed')), pending_reason text, failure_reason text,
  kb_account_id text, kb_invoice_id text, kb_payment_id text,
  created_by text NOT NULL REFERENCES members,
  created_at timestamptz NOT NULL, paid_at timestamptz);
CREATE SEQUENCE IF NOT EXISTS asset_number;
CREATE TABLE IF NOT EXISTS assets (
  number bigint PRIMARY KEY, id text NOT NULL UNIQUE, team_id text NOT NULL REFERENCES teams,
  kind text NOT NULL CHECK (kind IN ('upload', 'output')), media_type text NOT NULL,
  job_id text REFERENCES jobs (id), output_index int, owner_id text NOT NULL REFERENCES members,
  width int, height int, duration_seconds int, bytes bigint NOT NULL, object_key text NOT NULL,
  created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
  removed_at timestamptz, object_removed boolean NOT NULL DEFAULT false);
CREATE INDEX IF NOT EXISTS assets_job ON assets (job_id);
CREATE TABLE IF NOT EXISTS asset_edges (
  from_asset text NOT NULL REFERENCES assets (id), to_asset text NOT NULL REFERENCES assets (id),
  PRIMARY KEY (from_asset, to_asset));
CREATE INDEX IF NOT EXISTS asset_edges_to ON asset_edges (to_asset);
CREATE TABLE IF NOT EXISTS cap_notices (
  team_id text NOT NULL REFERENCES teams, period_start timestamptz NOT NULL,
  kind text NOT NULL CHECK (kind IN ('soft', 'hard')), PRIMARY KEY (team_id, period_start, kind));
CREATE TABLE IF NOT EXISTS cap_attempts (
  team_id text PRIMARY KEY REFERENCES teams, period_start timestamptz NOT NULL, refused boolean NOT NULL);
CREATE SEQUENCE IF NOT EXISTS endpoint_number;
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  number bigint PRIMARY KEY, id text NOT NULL UNIQUE, team_id text NOT NULL REFERENCES teams, url text NOT NULL,
  secret text NOT NULL, state text NOT NULL CHECK (state IN ('active', 'failing', 'disabled')),
  consecutive_failures int NOT NULL DEFAULT 0, last_status_code int,
  created_by text NOT NULL REFERENCES members, created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS webhook_events (
  id text PRIMARY KEY, endpoint_id text NOT NULL REFERENCES webhook_endpoints (id) ON DELETE CASCADE,
  job_id text NOT NULL REFERENCES jobs (id), type text NOT NULL, body text NOT NULL, created_at timestamptz NOT NULL,
  attempts int NOT NULL DEFAULT 0, next_attempt_at timestamptz);
CREATE INDEX IF NOT EXISTS webhook_events_due ON webhook_events (next_attempt_at) WHERE next_attempt_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  number bigserial PRIMARY KEY, event_id text NOT NULL REFERENCES webhook_events ON DELETE CASCADE,
  endpoint_id text NOT NULL REFERENCES webhook_endpoints (id) ON DELETE CASCADE, attempt int NOT NULL,
  attempted_at timestamptz NOT NULL, status_code int,
  outcome text NOT NULL CHECK (outcome IN ('delivered', 'failed', 'skipped_disabled')), next_attempt_at timestamptz);
`;

const PASSCODE = "lumen-pass-2026";

const TEAMS = [
  { id: "t_storefront", name: "Storefront", grant: 5_000n, concurrency: 2, soft: 3_000, hard: 4_000 },
  { id: "t_campaigns", name: "Campaigns", grant: 600n, concurrency: 1, soft: 300, hard: 400 },
];

const MEMBERS = [
  { id: "m_mara", name: "Mara Okonkwo", email: "mara@halden.example", role: "member", team: "t_storefront", key: "dpk_mara_4c19e7" },
  { id: "m_theo", name: "Theo Lindqvist", email: "theo@halden.example", role: "member", team: "t_storefront", key: "dpk_theo_82ad30" },
  { id: "m_ines", name: "Ines Calloway", email: "ines@halden.example", role: "member", team: "t_campaigns", key: "dpk_ines_5be611" },
  { id: "m_rafael", name: "Rafael Duarte", email: "rafael@halden.example", role: "admin", team: null, key: "dpk_rafael_0f7c42" },
  { id: "m_june", name: "June Whitford", email: "june@halden.example", role: "finance", team: null, key: "dpk_june_d39a58" },
  { id: "m_sol", name: "Sol Abernathy", email: "sol@halden.example", role: "compliance", team: null, key: "dpk_sol_61e2bf" },
];

const PROMPT = {
  type: "string", title: "Prompt", description: "Describe what to generate, up to 2,000 characters.",
  minLength: 1, maxLength: 2000,
} as const;
const SIZES = [512, 768, 1024, 1536, 2048];

const CATALOGUE: { slug: string; name: string; modality: string; rate: bigint; schema: InputSchema }[] = [
  {
    slug: "quill-still", name: "Quill Still", modality: "image", rate: 4_000_000n,
    schema: {
      type: "object", required: ["prompt"], additionalProperties: false,
      properties: {
        prompt: PROMPT,
        style: { type: "string", title: "Style", description: "The look of the image.", enum: ["photo", "illustration", "line art"], default: "photo" },
        num_images: { type: "integer", title: "Number of images", description: "Each image is 1024 by 1024.", minimum: 1, maximum: 8, default: 1 },
      },
    },
  },
  {
    slug: "halftone-xl", name: "Halftone XL", modality: "image", rate: 3_333_333n,
    schema: {
      type: "object", required: ["prompt"], additionalProperties: false,
      properties: {
        prompt: PROMPT,
        width: { type: "integer", title: "Width", description: "Output width in pixels.", enum: SIZES, default: 1024 },
        height: { type: "integer", title: "Height", description: "Output height in pixels.", enum: SIZES, default: 1024 },
        num_images: { type: "integer", title: "Number of images", description: "Billed by output megapixel.", minimum: 1, maximum: 4, default: 1 },
        init_image: { type: "string", title: "Starting image", description: "An image URL or asset:<asset id>.", contentMediaType: "image/*" },
      },
    },
  },
  {
    slug: "reel-10", name: "Reel 10", modality: "video", rate: 8_500_000n,
    schema: {
      type: "object", required: ["prompt"], additionalProperties: false,
      properties: {
        prompt: PROMPT,
        duration_seconds: { type: "integer", title: "Duration (seconds)", description: "Length of the 1280 by 720 clip.", enum: [5, 10], default: 5 },
        start_image: { type: "string", title: "Start frame", description: "An image URL or asset:<asset id>.", contentMediaType: "image/*" },
      },
    },
  },
  {
    slug: "murmur-voice", name: "Murmur Voice", modality: "audio", rate: 400_000n,
    schema: {
      type: "object", required: ["text"], additionalProperties: false,
      properties: {
        text: { type: "string", title: "Script", description: "The words to speak, up to 2,000 characters.", minLength: 1, maxLength: 2000 },
        voice: { type: "string", title: "Voice", description: "The speaking voice.", enum: ["ash", "brook", "cove"], default: "ash" },
        max_seconds: { type: "integer", title: "Maximum length (seconds)", description: "Billed for the seconds actually spoken.", minimum: 1, maximum: 120, default: 30 },
      },
    },
  },
];

const ZONE = "America/New_York";

function seedPolicy(): Policy {
  const teamAccess = (teamId: string): TeamPolicy["model_access"] => Object.fromEntries(CATALOGUE.map((m) => {
    const access: Record<Context, TeamAccess> = { api: "inherit", playground: "inherit" };
    if (teamId === "t_storefront" && m.slug === "murmur-voice") access.api = "blocked";
    if (teamId === "t_campaigns" && m.slug === "reel-10") access.playground = "allowed";
    return [m.slug, access];
  }));
  return {
    version: 1,
    timezone: ZONE,
    retention_days: 30,
    org_model_access: Object.fromEntries(CATALOGUE.map((m): [string, Record<Context, OrgAccess>] => [
      m.slug, { api: "allowed", playground: m.slug === "reel-10" ? "blocked" : "allowed" },
    ])),
    teams: TEAMS.map((t): TeamPolicy => ({
      id: t.id, name: t.name, concurrency: t.concurrency, payload_visibility: "team",
      soft_cap_credits: t.soft, hard_cap_credits: t.hard,
      context_defaults: { api: "inherit", playground: "inherit" },
      model_access: teamAccess(t.id),
    })),
  };
}

export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

function hashPasscode(passcode: string, salt = randomBytes(16).toString("hex")): string {
  return `${salt}:${scryptSync(passcode, salt, 32).toString("hex")}`;
}

async function seed(client: pg.PoolClient): Promise<void> {
  const now = new Date();
  for (const [position, team] of TEAMS.entries()) {
    await client.query("INSERT INTO teams (id, name, position) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [team.id, team.name, position]);
  }
  for (const [position, m] of MEMBERS.entries()) {
    await client.query(
      `INSERT INTO members (id, name, email, role, team_id, passcode_hash, api_key_hash, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING`,
      [m.id, m.name, m.email, m.role, m.team, hashPasscode(PASSCODE), sha256(m.key), position]);
  }
  const effective = new Date(instantOf({ year: 2026, month: 1, day: 1, hour: 0, minute: 0, second: 0 }, ZONE) ?? 0);
  for (const [position, model] of CATALOGUE.entries()) {
    await client.query(
      `INSERT INTO models (slug, name, modality, unit, position, input_schema) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING`,
      [model.slug, model.name, model.modality, UNIT_RULES[model.slug].unit, position, JSON.stringify(model.schema)]);
    await client.query(
      `INSERT INTO rates (id, model, micro_per_unit, effective_at, created_by, created_at)
       VALUES ($1, $2, $3, $4, NULL, $4) ON CONFLICT DO NOTHING`,
      [`r_${position + 1}`, model.slug, model.rate, effective]);
  }
  const policy = seedPolicy();
  const { version, ...stored } = policy;
  await client.query(
    "INSERT INTO policy_versions (version, policy, saved_by, saved_at) VALUES ($1, $2, NULL, $3) ON CONFLICT DO NOTHING",
    [version, JSON.stringify(stored), now]);
  for (const team of TEAMS) {
    const granted = await client.query("SELECT 1 FROM movements WHERE team_id = $1 AND kind = 'opening_grant'", [team.id]);
    if (!granted.rowCount) {
      await postMovement(client, { teamId: team.id, kind: "opening_grant", amount: team.grant * MICRO, at: now });
    }
  }
}

export async function migrate(): Promise<void> {
  await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(4173)");
    await client.query(SCHEMA);
    await seed(client);
  });
}
