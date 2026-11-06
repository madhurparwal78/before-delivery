export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS org (
  id             text PRIMARY KEY,
  name           text NOT NULL
);

CREATE TABLE IF NOT EXISTS teams (
  id             text PRIMARY KEY,
  name           text NOT NULL,
  position       integer NOT NULL,
  grant_micro    bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  id             text PRIMARY KEY,
  name           text NOT NULL,
  email          text NOT NULL UNIQUE,
  role           text NOT NULL,
  team_id        text REFERENCES teams(id),
  api_key        text NOT NULL UNIQUE,
  passcode       text NOT NULL
);

CREATE TABLE IF NOT EXISTS models (
  slug           text PRIMARY KEY,
  name           text NOT NULL,
  modality       text NOT NULL,
  unit           text NOT NULL,
  unit_label     text NOT NULL,
  input_schema   json NOT NULL,
  position       integer NOT NULL
);

CREATE TABLE IF NOT EXISTS policy_versions (
  version        integer PRIMARY KEY,
  document       json NOT NULL,
  saved_by       text NOT NULL,
  saved_at       timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS rates (
  id             text PRIMARY KEY,
  model_slug     text NOT NULL REFERENCES models(slug),
  micro_per_unit bigint NOT NULL,
  effective_at   timestamptz NOT NULL,
  created_by     text NOT NULL
);
CREATE INDEX IF NOT EXISTS rates_model_idx ON rates(model_slug, effective_at);

CREATE TABLE IF NOT EXISTS sessions (
  id             text PRIMARY KEY,
  member_id      text NOT NULL REFERENCES members(id),
  created_at     timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id                   text PRIMARY KEY,
  num                  bigint NOT NULL,
  team_id              text NOT NULL REFERENCES teams(id),
  model_slug           text NOT NULL REFERENCES models(slug),
  status               text NOT NULL,
  priority             text NOT NULL,
  context              text NOT NULL,
  submitted_by         text NOT NULL REFERENCES members(id),
  submitted_at         timestamptz NOT NULL,
  started_at           timestamptz,
  finished_at          timestamptz,
  attempts             integer NOT NULL DEFAULT 0,
  lapses               integer NOT NULL DEFAULT 0,
  failure_reason       text,
  input                json NOT NULL,
  rate_id              text NOT NULL REFERENCES rates(id),
  rate_micro_per_unit  bigint NOT NULL,
  unit                 text NOT NULL,
  estimated_units_micro bigint NOT NULL,
  billed_units_micro   bigint,
  reserved_micro       bigint NOT NULL,
  charged_micro        bigint,
  lease_expires_at     timestamptz,
  period_start         timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_team_idx ON jobs(team_id, num DESC);
CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status);

CREATE TABLE IF NOT EXISTS job_input_assets (
  job_id     text NOT NULL REFERENCES jobs(id),
  asset_id   text NOT NULL,
  position   integer NOT NULL,
  PRIMARY KEY (job_id, asset_id)
);

CREATE TABLE IF NOT EXISTS assets (
  id               text PRIMARY KEY,
  num              bigint NOT NULL,
  team_id          text NOT NULL REFERENCES teams(id),
  kind             text NOT NULL,
  media_type       text NOT NULL,
  job_id           text REFERENCES jobs(id),
  model_slug       text REFERENCES models(slug),
  width            integer,
  height           integer,
  duration_seconds integer,
  bytes            bigint NOT NULL,
  created_at       timestamptz NOT NULL,
  expires_at       timestamptz NOT NULL,
  storage_key      text NOT NULL,
  prompt           text,
  owner_member_id  text NOT NULL REFERENCES members(id),
  output_index     integer,
  removed_at       timestamptz,
  removed_reason   text
);
CREATE INDEX IF NOT EXISTS assets_team_idx ON assets(team_id, num DESC);

CREATE TABLE IF NOT EXISTS asset_edges (
  from_asset_id  text NOT NULL REFERENCES assets(id),
  to_asset_id    text NOT NULL REFERENCES assets(id),
  PRIMARY KEY (from_asset_id, to_asset_id)
);

CREATE TABLE IF NOT EXISTS movements (
  id             text PRIMARY KEY,
  num            bigint NOT NULL,
  team_id        text NOT NULL REFERENCES teams(id),
  kind           text NOT NULL,
  created_at     timestamptz NOT NULL,
  job_id         text REFERENCES jobs(id),
  topup_id       text,
  kb_invoice_id  text
);
CREATE INDEX IF NOT EXISTS movements_team_idx ON movements(team_id, num);

CREATE TABLE IF NOT EXISTS entries (
  movement_id    text NOT NULL REFERENCES movements(id),
  position       integer NOT NULL,
  team_id        text NOT NULL REFERENCES teams(id),
  account        text NOT NULL,
  amount_micro   bigint NOT NULL,
  PRIMARY KEY (movement_id, position)
);
CREATE INDEX IF NOT EXISTS entries_team_idx ON entries(team_id, account);

CREATE TABLE IF NOT EXISTS idempotency_records (
  team_id        text NOT NULL REFERENCES teams(id),
  key            text NOT NULL,
  body_hash      text NOT NULL,
  job_id         text NOT NULL REFERENCES jobs(id),
  status_code    integer NOT NULL,
  response_body  json NOT NULL,
  created_at     timestamptz NOT NULL,
  PRIMARY KEY (team_id, key)
);

CREATE TABLE IF NOT EXISTS replays (
  id             bigserial PRIMARY KEY,
  team_id        text NOT NULL REFERENCES teams(id),
  job_id         text NOT NULL REFERENCES jobs(id),
  at             timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS replays_team_idx ON replays(team_id, at DESC);

CREATE TABLE IF NOT EXISTS topups (
  id             text PRIMARY KEY,
  team_id        text NOT NULL REFERENCES teams(id),
  credits        bigint NOT NULL,
  amount_usd     text NOT NULL,
  status         text NOT NULL,
  pending_reason text,
  failure_reason text,
  kb_account_id  text,
  kb_invoice_id  text,
  kb_payment_id  text,
  created_by     text NOT NULL REFERENCES members(id),
  created_at     timestamptz NOT NULL,
  paid_at        timestamptz,
  next_retry_at  timestamptz
);
CREATE INDEX IF NOT EXISTS topups_team_idx ON topups(team_id, created_at DESC);

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id                   text PRIMARY KEY,
  num                  bigint NOT NULL,
  team_id              text NOT NULL REFERENCES teams(id),
  url                  text NOT NULL,
  secret               text NOT NULL,
  state                text NOT NULL,
  consecutive_failures integer NOT NULL DEFAULT 0,
  created_by           text NOT NULL REFERENCES members(id),
  created_at           timestamptz NOT NULL,
  removed_at           timestamptz
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id               text PRIMARY KEY,
  endpoint_id      text NOT NULL REFERENCES webhook_endpoints(id),
  job_id           text NOT NULL REFERENCES jobs(id),
  event_type       text NOT NULL,
  body             text NOT NULL,
  created_at       timestamptz NOT NULL,
  state            text NOT NULL,
  attempts         integer NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL,
  last_status_code integer
);
CREATE INDEX IF NOT EXISTS webhook_events_endpoint_idx ON webhook_events(endpoint_id, created_at);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id              bigserial PRIMARY KEY,
  event_id        text NOT NULL,
  endpoint_id     text NOT NULL REFERENCES webhook_endpoints(id),
  event_type      text NOT NULL,
  job_id          text NOT NULL,
  attempt         integer NOT NULL,
  attempted_at    timestamptz NOT NULL,
  status_code     integer,
  outcome         text NOT NULL,
  next_attempt_at timestamptz
);
CREATE INDEX IF NOT EXISTS webhook_deliveries_endpoint_idx ON webhook_deliveries(endpoint_id, id DESC);

CREATE TABLE IF NOT EXISTS cap_notices (
  team_id       text NOT NULL REFERENCES teams(id),
  period_start  timestamptz NOT NULL,
  kind          text NOT NULL,
  sent_at       timestamptz NOT NULL,
  PRIMARY KEY (team_id, period_start, kind)
);

CREATE TABLE IF NOT EXISTS last_submissions (
  team_id            text PRIMARY KEY REFERENCES teams(id),
  period_start       timestamptz NOT NULL,
  refused_hard_cap   boolean NOT NULL,
  at                 timestamptz NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS job_seq START 1;
CREATE SEQUENCE IF NOT EXISTS asset_seq START 1;
CREATE SEQUENCE IF NOT EXISTS movement_seq START 1;
CREATE SEQUENCE IF NOT EXISTS rate_seq START 5;
CREATE SEQUENCE IF NOT EXISTS endpoint_seq START 1;
`;

export interface SchemaProperty {
  type: 'string' | 'integer';
  title: string;
  description?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  enum?: readonly (string | number)[];
  default?: string | number;
  contentMediaType?: string;
}

export interface InputSchema {
  type: 'object';
  required: readonly string[];
  properties: Record<string, SchemaProperty>;
}

interface SeedModel {
  slug: string;
  name: string;
  modality: 'image' | 'video' | 'audio';
  unit: string;
  unitLabel: string;
  position: number;
  rateId: string;
  microPerUnit: number;
  schema: InputSchema;
}

const PROMPT_PROPERTY: SchemaProperty = {
  type: 'string',
  title: 'Prompt',
  description: 'What the model should generate.',
  minLength: 1,
  maxLength: 2000,
};

export const SEED_MODELS: readonly SeedModel[] = [
  {
    slug: 'quill-still',
    name: 'Quill Still',
    modality: 'image',
    unit: 'image',
    unitLabel: 'images',
    position: 1,
    rateId: 'r_1',
    microPerUnit: 4000000,
    schema: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: PROMPT_PROPERTY,
        style: {
          type: 'string',
          title: 'Style',
          description: 'Rendering style for the still.',
          enum: ['photo', 'illustration', 'line art'],
          default: 'photo',
        },
        num_images: {
          type: 'integer',
          title: 'Number of images',
          description: 'How many stills to render.',
          minimum: 1,
          maximum: 8,
          default: 1,
        },
      },
    },
  },
  {
    slug: 'halftone-xl',
    name: 'Halftone XL',
    modality: 'image',
    unit: 'megapixel',
    unitLabel: 'megapixels',
    position: 2,
    rateId: 'r_2',
    microPerUnit: 3333333,
    schema: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: PROMPT_PROPERTY,
        width: {
          type: 'integer',
          title: 'Width',
          description: 'Output width in pixels.',
          enum: [512, 768, 1024, 1536, 2048],
          default: 1024,
        },
        height: {
          type: 'integer',
          title: 'Height',
          description: 'Output height in pixels.',
          enum: [512, 768, 1024, 1536, 2048],
          default: 1024,
        },
        num_images: {
          type: 'integer',
          title: 'Number of images',
          description: 'How many images to render.',
          minimum: 1,
          maximum: 4,
          default: 1,
        },
        init_image: {
          type: 'string',
          title: 'Starting image',
          description: 'An image URL or asset reference to start from.',
          contentMediaType: 'image/*',
        },
      },
    },
  },
  {
    slug: 'reel-10',
    name: 'Reel 10',
    modality: 'video',
    unit: 'video_second',
    unitLabel: 'video-seconds',
    position: 3,
    rateId: 'r_3',
    microPerUnit: 8500000,
    schema: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: PROMPT_PROPERTY,
        duration_seconds: {
          type: 'integer',
          title: 'Duration (seconds)',
          description: 'Length of the generated clip.',
          enum: [5, 10],
          default: 5,
        },
        start_image: {
          type: 'string',
          title: 'Start frame',
          description: 'An image URL or asset reference for the first frame.',
          contentMediaType: 'image/*',
        },
      },
    },
  },
  {
    slug: 'murmur-voice',
    name: 'Murmur Voice',
    modality: 'audio',
    unit: 'audio_second',
    unitLabel: 'audio-seconds',
    position: 4,
    rateId: 'r_4',
    microPerUnit: 400000,
    schema: {
      type: 'object',
      required: ['text'],
      properties: {
        text: {
          type: 'string',
          title: 'Script',
          description: 'The words to speak.',
          minLength: 1,
          maxLength: 2000,
        },
        voice: {
          type: 'string',
          title: 'Voice',
          description: 'Which voice to speak with.',
          enum: ['ash', 'brook', 'cove'],
          default: 'ash',
        },
        max_seconds: {
          type: 'integer',
          title: 'Maximum length (seconds)',
          description: 'Upper bound on the generated audio.',
          minimum: 1,
          maximum: 120,
          default: 30,
        },
      },
    },
  },
];

export interface SeedTeam {
  id: string;
  name: string;
  position: number;
  grantCredits: number;
  concurrency: number;
  payloadVisibility: 'team' | 'restricted';
  softCapCredits: number;
  hardCapCredits: number;
}

export const SEED_TEAMS: readonly SeedTeam[] = [
  {
    id: 't_storefront',
    name: 'Storefront',
    position: 1,
    grantCredits: 5000,
    concurrency: 2,
    payloadVisibility: 'team',
    softCapCredits: 3000,
    hardCapCredits: 4000,
  },
  {
    id: 't_campaigns',
    name: 'Campaigns',
    position: 2,
    grantCredits: 600,
    concurrency: 1,
    payloadVisibility: 'team',
    softCapCredits: 300,
    hardCapCredits: 400,
  },
];

export interface SeedMember {
  id: string;
  name: string;
  email: string;
  role: 'member' | 'admin' | 'finance' | 'compliance';
  teamId: string | null;
  apiKey: string;
}

export const SEED_MEMBERS: readonly SeedMember[] = [
  { id: 'm_mara', name: 'Mara Okonkwo', email: 'mara@halden.example', role: 'member', teamId: 't_storefront', apiKey: 'dpk_mara_4c19e7' },
  { id: 'm_theo', name: 'Theo Lindqvist', email: 'theo@halden.example', role: 'member', teamId: 't_storefront', apiKey: 'dpk_theo_82ad30' },
  { id: 'm_ines', name: 'Ines Calloway', email: 'ines@halden.example', role: 'member', teamId: 't_campaigns', apiKey: 'dpk_ines_5be611' },
  { id: 'm_rafael', name: 'Rafael Duarte', email: 'rafael@halden.example', role: 'admin', teamId: null, apiKey: 'dpk_rafael_0f7c42' },
  { id: 'm_june', name: 'June Whitford', email: 'june@halden.example', role: 'finance', teamId: null, apiKey: 'dpk_june_d39a58' },
  { id: 'm_sol', name: 'Sol Abernathy', email: 'sol@halden.example', role: 'compliance', teamId: null, apiKey: 'dpk_sol_61e2bf' },
];

export const SEED_PASSCODE = 'lumen-pass-2026';
export const ORG_NAME = 'Halden Works';
export const ORG_TIMEZONE = 'America/New_York';
export const ORG_RETENTION_DAYS = 30;
