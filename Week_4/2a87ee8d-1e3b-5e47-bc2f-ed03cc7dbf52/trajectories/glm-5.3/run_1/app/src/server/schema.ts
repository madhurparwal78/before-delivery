/** Idempotent schema and seed data. Postgres is the only datastore (IF-04). */
import type { PoolClient } from 'pg';

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS facilitators (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  time_zone text NOT NULL
);

CREATE TABLE IF NOT EXISTS workshops (
  id text PRIMARY KEY,
  facilitator_id text NOT NULL REFERENCES facilitators(id),
  title text NOT NULL,
  template text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  scheduled_start text NOT NULL,
  scheduled_end text NOT NULL,
  sponsor_email text NOT NULL,
  fee_cents integer NOT NULL DEFAULT 0,
  round_number integer NOT NULL DEFAULT 0,
  round_ends_at timestamptz,
  voting_ends_at timestamptz,
  dot_budget integer,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (facilitator_id, id)
);
CREATE INDEX IF NOT EXISTS workshops_by_facilitator ON workshops (facilitator_id);

CREATE TABLE IF NOT EXISTS frames (
  id text PRIMARY KEY,
  workshop_id text NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  title text NOT NULL,
  x double precision NOT NULL,
  y double precision NOT NULL,
  width double precision NOT NULL,
  height double precision NOT NULL,
  position integer NOT NULL,
  trashed_at timestamptz,
  purge_at timestamptz,
  purged boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS frames_by_workshop ON frames (workshop_id);

CREATE TABLE IF NOT EXISTS clusters (
  id text PRIMARY KEY,
  workshop_id text NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  frame_id text NOT NULL REFERENCES frames(id) ON DELETE CASCADE,
  title text NOT NULL,
  x double precision NOT NULL,
  y double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clusters_by_frame ON clusters (frame_id);

CREATE TABLE IF NOT EXISTS notes (
  id text PRIMARY KEY,
  workshop_id text NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  frame_id text NOT NULL REFERENCES frames(id) ON DELETE CASCADE,
  cluster_id text REFERENCES clusters(id) ON DELETE SET NULL,
  kind text NOT NULL,
  text text,
  image_id text,
  x double precision NOT NULL,
  y double precision NOT NULL,
  revealed boolean NOT NULL DEFAULT true,
  facilitator_only boolean NOT NULL DEFAULT false,
  author_participant_id text,
  author_facilitator boolean NOT NULL DEFAULT false,
  author_name text NOT NULL DEFAULT '',
  round_number integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  placement_index integer NOT NULL DEFAULT 0,
  deleted boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS notes_by_workshop ON notes (workshop_id);
CREATE INDEX IF NOT EXISTS notes_by_frame ON notes (frame_id);
CREATE INDEX IF NOT EXISTS notes_by_cluster ON notes (cluster_id);
CREATE INDEX IF NOT EXISTS notes_fts ON notes USING gin (to_tsvector('simple'::regconfig, coalesce(text,'')));

CREATE TABLE IF NOT EXISTS connectors (
  id text PRIMARY KEY,
  workshop_id text NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  from_note_id text NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  to_note_id text NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS connectors_by_workshop ON connectors (workshop_id);

CREATE TABLE IF NOT EXISTS dot_ledger (
  id text PRIMARY KEY,
  workshop_id text NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  participant_id text NOT NULL,
  cluster_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('spend','return')),
  cancels_id text REFERENCES dot_ledger(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dots_by_participant ON dot_ledger (participant_id);
CREATE INDEX IF NOT EXISTS dots_by_cluster ON dot_ledger (cluster_id);

CREATE TABLE IF NOT EXISTS join_links (
  id text PRIMARY KEY,
  workshop_id text NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  revoked boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS join_links_by_workshop ON join_links (workshop_id);

CREATE TABLE IF NOT EXISTS facilitator_sessions (
  id text PRIMARY KEY,
  facilitator_id text NOT NULL REFERENCES facilitators(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS participants (
  id text PRIMARY KEY,
  workshop_id text NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  join_link_id text NOT NULL REFERENCES join_links(id),
  session_id text NOT NULL UNIQUE,
  hue integer NOT NULL,
  active boolean NOT NULL DEFAULT true,
  session_ended boolean NOT NULL DEFAULT false,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS participants_by_workshop ON participants (workshop_id);

CREATE TABLE IF NOT EXISTS client_ops (
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  client_op_id text NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  body_hash text NOT NULL,
  status integer NOT NULL,
  response_body jsonb NOT NULL,
  workshop_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_type, actor_id, client_op_id)
);

CREATE TABLE IF NOT EXISTS client_ops_inflight (
  key text PRIMARY KEY,
  body_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invites (
  id text PRIMARY KEY,
  workshop_id text NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE (workshop_id, email)
);

CREATE TABLE IF NOT EXISTS invite_queue (
  id text PRIMARY KEY,
  workshop_id text NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  email text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workshop_id, email)
);
ALTER TABLE invite_queue ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS images (
  id text PRIMARY KEY,
  workshop_id text NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  uploader_type text NOT NULL,
  uploader_id text NOT NULL,
  content_type text NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  stored boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS image_deletes (
  id text PRIMARY KEY,
  image_id text NOT NULL,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS versions (
  id text PRIMARY KEY,
  workshop_id text NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  version integer NOT NULL,
  reason text NOT NULL,
  snapshot jsonb NOT NULL,
  note_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE versions ADD COLUMN IF NOT EXISTS note_count integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS versions_by_workshop ON versions (workshop_id);

CREATE TABLE IF NOT EXISTS activity (
  id text PRIMARY KEY,
  facilitator_id text NOT NULL REFERENCES facilitators(id) ON DELETE CASCADE,
  seq bigint GENERATED ALWAYS AS IDENTITY,
  at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL,
  action text NOT NULL,
  workshop_id text
);
CREATE INDEX IF NOT EXISTS activity_by_facilitator ON activity (facilitator_id, seq DESC);

CREATE TABLE IF NOT EXISTS rate_counters (
  bucket text PRIMARY KEY,
  count integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS invite_daily (
  facilitator_id text NOT NULL,
  local_date text NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (facilitator_id, local_date)
);

CREATE TABLE IF NOT EXISTS billing_mirror (
  facilitator_id text PRIMARY KEY REFERENCES facilitators(id) ON DELETE CASCADE,
  plan text NOT NULL,
  term text NOT NULL,
  renews_on text NOT NULL,
  state text NOT NULL DEFAULT 'active',
  past_due_since timestamptz,
  read_only_at timestamptz,
  pending_change jsonb,
  entitlements jsonb NOT NULL,
  stale boolean NOT NULL DEFAULT false,
  synced_at timestamptz,
  kb_account_id text
);

CREATE TABLE IF NOT EXISTS kb_invoices (
  id text PRIMARY KEY,
  facilitator_id text REFERENCES facilitators(id) ON DELETE CASCADE,
  sponsor_email text,
  workshop_id text,
  number text NOT NULL,
  date text NOT NULL,
  cents integer NOT NULL,
  balance_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'EUR',
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recaps (
  workshop_id text PRIMARY KEY REFERENCES workshops(id) ON DELETE CASCADE,
  recap_token text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'queued',
  reason text,
  attempts integer NOT NULL DEFAULT 0,
  files_stored_at timestamptz,
  email_sent_at timestamptz,
  recipients integer,
  scale integer NOT NULL DEFAULT 1,
  sponsor_invoice_id text,
  lease_until timestamptz,
  file_list jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS board_events (
  workshop_id text NOT NULL,
  version integer NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workshop_id, version)
);
`;

export interface SeedParticipant { name: string; }
export interface SeedNote {
  frameTitle: string; text: string; author: string; authorType: 'facilitator' | 'participant';
  facilitatorOnly?: boolean; clusterTitle?: string; x: number; y: number;
}
export interface SeedCluster { frameTitle: string; title: string; x: number; y: number; notes: string[]; }
export interface SeedWorkshop {
  id: string; title: string; template: string; status: string;
  scheduledStart: string; scheduledEnd: string; sponsorEmail: string; feeCents: number;
  roundNumber: number; participants: SeedParticipant[]; clusters: SeedCluster[];
  notes: SeedNote[]; connectors: Array<{ fromText: string; toText: string }>;
}

export const SEEDS: { facilitators: Array<{ id: string; email: string; name: string; passwordHash: string; timeZone: string; plan: string; term: string; }>;
  workshops: SeedWorkshop[]; } = {
  facilitators: [
    { id: 'fac_juno', email: 'juno@lanternfold.test', name: 'Juno Marlowe', passwordHash: '', timeZone: 'Europe/Lisbon', plan: 'studio', term: 'monthly' },
    { id: 'fac_odile', email: 'odile@lanternfold.test', name: 'Odile Brack', passwordHash: '', timeZone: 'America/Toronto', plan: 'free', term: 'monthly' },
  ],
  workshops: [],
};
