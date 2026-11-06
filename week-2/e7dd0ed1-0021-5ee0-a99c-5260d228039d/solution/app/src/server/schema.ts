// Schema and seed data, applied idempotently every time the app starts serving (brief: Services,
// Postgres; Seed data). Two processes may start at once, so the whole bootstrap holds one lock.
import { pool, query } from "./db.js";
import { hashPassword, recoveryCodeHash, seal } from "./secrets.js";
import { PLANS } from "../shared/plans.js";

const DDL = `
CREATE TABLE IF NOT EXISTS regions (
  id text PRIMARY KEY, name text NOT NULL, continent text NOT NULL, lon integer NOT NULL, lat integer NOT NULL,
  position integer NOT NULL, state text NOT NULL DEFAULT 'online');
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY, email text NOT NULL, name text NOT NULL, password_hash text NOT NULL,
  operator boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
  two_step_secret text, two_step_setup text, two_step_enabled_at timestamptz, last_totp_step bigint);
CREATE TABLE IF NOT EXISTS recovery_codes (
  user_id uuid NOT NULL REFERENCES users, code_hash text NOT NULL, used_at timestamptz, PRIMARY KEY (user_id, code_hash));
CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY, token_hash text NOT NULL UNIQUE, user_id uuid NOT NULL REFERENCES users, state text NOT NULL,
  device text NOT NULL, created_at timestamptz NOT NULL, last_seen_at timestamptz NOT NULL, pending_until timestamptz,
  confirmed_until timestamptz);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id) WHERE state <> 'ended';
CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users (lower(email));
CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY, slug text NOT NULL UNIQUE, name text NOT NULL, plan_id text NOT NULL,
  status text NOT NULL DEFAULT 'active', suspended_reason text,
  killbill_account_id text, killbill_subscription_id text, created_at timestamptz NOT NULL DEFAULT now(),
  key_generation integer NOT NULL DEFAULT 1, key_rotated_at timestamptz);
CREATE TABLE IF NOT EXISTS members (
  workspace_id uuid NOT NULL REFERENCES workspaces, user_id uuid NOT NULL REFERENCES users, role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (workspace_id, user_id));
CREATE TABLE IF NOT EXISTS signin_failures (email text NOT NULL, failed_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS signin_failures_email ON signin_failures (email, failed_at);
CREATE TABLE IF NOT EXISTS access_keys (
  key_id text PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces, description text NOT NULL,
  permission text NOT NULL, buckets text[], prefix text, expires_at timestamptz, state text NOT NULL, sealed_secret text NOT NULL,
  previous_sealed_secret text, previous_secret_expires_at timestamptz, previous_secret_last_used_at timestamptz,
  created_by uuid NOT NULL, created_at timestamptz NOT NULL, last_used_at timestamptz);
CREATE TABLE IF NOT EXISTS buckets (
  id bigserial PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces, name text NOT NULL UNIQUE,
  placement text[] NOT NULL, created_at timestamptz NOT NULL, object_count bigint NOT NULL DEFAULT 0,
  stored_bytes bigint NOT NULL DEFAULT 0, noncurrent_days integer, keep_newest_noncurrent integer NOT NULL DEFAULT 0,
  abort_multipart_days integer, lifecycle_updated_at timestamptz, storage_sealed_through timestamptz);
CREATE TABLE IF NOT EXISTS versions (
  version_id text PRIMARY KEY, bucket_id bigint NOT NULL REFERENCES buckets, key text COLLATE "C" NOT NULL,
  size bigint NOT NULL, etag text NOT NULL, content_type text NOT NULL, metadata jsonb NOT NULL, tags jsonb NOT NULL,
  checksum_algorithm text, checksum_value text, part_sizes bigint[], created_at timestamptz NOT NULL,
  last_modified timestamptz NOT NULL, acknowledged_at timestamptz NOT NULL, current boolean NOT NULL,
  noncurrent_since timestamptz, retain_until timestamptz, legal_hold boolean NOT NULL DEFAULT false,
  wrapped_key bytea NOT NULL, key_generation integer NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS versions_current ON versions (bucket_id, key) WHERE current;
CREATE INDEX IF NOT EXISTS versions_key ON versions (bucket_id, key, created_at);
CREATE INDEX IF NOT EXISTS versions_noncurrent ON versions (bucket_id, key) WHERE NOT current;
CREATE TABLE IF NOT EXISTS replicas (
  version_id text NOT NULL REFERENCES versions ON DELETE CASCADE, region text NOT NULL, position integer NOT NULL,
  role text NOT NULL, state text NOT NULL, attempts integer NOT NULL DEFAULT 0, settled_at timestamptz,
  settle_ms bigint, error text, pending_since timestamptz, claim text, claimed_at timestamptz,
  PRIMARY KEY (version_id, region));
CREATE INDEX IF NOT EXISTS replicas_pending ON replicas (pending_since) WHERE state = 'pending';
CREATE INDEX IF NOT EXISTS replicas_region ON replicas (region, state);
CREATE TABLE IF NOT EXISTS storage_changes (bucket_id bigint NOT NULL, at timestamptz NOT NULL, delta bigint NOT NULL);
CREATE INDEX IF NOT EXISTS storage_changes_bucket ON storage_changes (bucket_id, at);
CREATE TABLE IF NOT EXISTS byte_removals (object_key text PRIMARY KEY, next_attempt_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS uploads (
  upload_id text PRIMARY KEY, bucket_id bigint NOT NULL REFERENCES buckets, workspace_id uuid NOT NULL,
  key text COLLATE "C" NOT NULL, initiated_at timestamptz NOT NULL, state text NOT NULL, checksum_algorithm text,
  content_type text NOT NULL, metadata jsonb NOT NULL, tags jsonb NOT NULL, completed_parts text,
  completed_etag text, completed_version_id text, completed_at timestamptz, wrapped_key bytea, key_generation integer);
CREATE INDEX IF NOT EXISTS uploads_open ON uploads (bucket_id) WHERE state = 'open';
CREATE TABLE IF NOT EXISTS upload_parts (
  upload_id text NOT NULL REFERENCES uploads, part_number integer NOT NULL, size bigint NOT NULL, etag text NOT NULL,
  checksum_algorithm text, checksum_value text, PRIMARY KEY (upload_id, part_number));
CREATE TABLE IF NOT EXISTS reservations (
  id bigserial PRIMARY KEY, workspace_id uuid NOT NULL, bytes bigint NOT NULL, upload_id text, part_number integer);
CREATE INDEX IF NOT EXISTS reservations_workspace ON reservations (workspace_id);
CREATE TABLE IF NOT EXISTS idempotency_records (
  workspace_id uuid NOT NULL, idem_key text NOT NULL, endpoint text NOT NULL, bucket text NOT NULL,
  object_key text NOT NULL, body_sha256 text NOT NULL, status integer, response jsonb,
  created_at timestamptz NOT NULL, PRIMARY KEY (workspace_id, idem_key));
CREATE TABLE IF NOT EXISTS batches (
  id text PRIMARY KEY, workspace_id uuid NOT NULL, bucket_id bigint NOT NULL REFERENCES buckets,
  state text NOT NULL, undo_until timestamptz NOT NULL, created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS batch_entries (
  batch_id text NOT NULL REFERENCES batches, position integer NOT NULL, key text NOT NULL, version_id text NOT NULL,
  PRIMARY KEY (batch_id, position));
CREATE TABLE IF NOT EXISTS share_links (
  id text PRIMARY KEY, workspace_id uuid NOT NULL, bucket_id bigint NOT NULL, key text NOT NULL,
  version_id text NOT NULL, token_hash text NOT NULL UNIQUE, created_by uuid NOT NULL, created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL, state text NOT NULL);
CREATE INDEX IF NOT EXISTS share_links_version ON share_links (version_id) WHERE state = 'active';
CREATE INDEX IF NOT EXISTS share_links_workspace ON share_links (workspace_id, created_at);
CREATE TABLE IF NOT EXISTS share_link_hits (link_id text NOT NULL, at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS share_link_hits_link ON share_link_hits (link_id, at);
CREATE TABLE IF NOT EXISTS invites (
  id text PRIMARY KEY, workspace_id uuid NOT NULL, email text NOT NULL, role text NOT NULL,
  token_hash text NOT NULL UNIQUE, created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, state text NOT NULL);
CREATE INDEX IF NOT EXISTS invites_workspace ON invites (workspace_id, created_at);
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id text PRIMARY KEY, workspace_id uuid NOT NULL, url text NOT NULL, events text[] NOT NULL, buckets text[],
  description text NOT NULL, state text NOT NULL, sealed_secret text NOT NULL, created_at timestamptz NOT NULL,
  next_sequence bigint NOT NULL DEFAULT 1, busy_until timestamptz);
CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL, type text NOT NULL, occurred_at timestamptz NOT NULL,
  bucket text NOT NULL, key text NOT NULL, version_id text NOT NULL);
CREATE TABLE IF NOT EXISTS deliveries (
  id text PRIMARY KEY, endpoint_id text NOT NULL REFERENCES webhook_endpoints ON DELETE CASCADE,
  event_id uuid NOT NULL, event_type text NOT NULL, sequence bigint NOT NULL, state text NOT NULL,
  attempts integer NOT NULL DEFAULT 0, last_status integer, last_error text, next_attempt_at timestamptz,
  delivered_at timestamptz, body text NOT NULL, UNIQUE (endpoint_id, sequence));
CREATE INDEX IF NOT EXISTS deliveries_pending ON deliveries (endpoint_id, sequence) WHERE state = 'pending';
CREATE TABLE IF NOT EXISTS usage_windows (start_at timestamptz PRIMARY KEY, end_at timestamptz);
CREATE TABLE IF NOT EXISTS usage_rows (
  tracking_id text PRIMARY KEY, workspace_id uuid NOT NULL, bucket_id bigint NOT NULL, bucket text NOT NULL,
  unit text NOT NULL, window_start timestamptz NOT NULL, window_end timestamptz, quantity numeric NOT NULL,
  amount numeric, billing_state text NOT NULL);
CREATE INDEX IF NOT EXISTS usage_rows_workspace ON usage_rows (workspace_id, window_start);
CREATE INDEX IF NOT EXISTS usage_rows_state ON usage_rows (billing_state);
CREATE TABLE IF NOT EXISTS billing_status (
  id integer PRIMARY KEY, last_attempt_at timestamptz, last_attempt_ok boolean, last_error text,
  catalog_uploaded boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS threshold_alerts (
  workspace_id uuid NOT NULL, period text NOT NULL, metric text NOT NULL, threshold integer NOT NULL,
  PRIMARY KEY (workspace_id, period, metric, threshold));
CREATE TABLE IF NOT EXISTS mail_outbox (
  id bigserial PRIMARY KEY, recipient text NOT NULL, subject text NOT NULL, body text NOT NULL,
  created_at timestamptz NOT NULL, sent_at timestamptz, next_attempt_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS mail_outbox_unsent ON mail_outbox (next_attempt_at) WHERE sent_at IS NULL;
CREATE TABLE IF NOT EXISTS audit_entries (
  workspace_slug text NOT NULL, seq bigint NOT NULL, at timestamptz NOT NULL, actor text NOT NULL, action text NOT NULL,
  target text NOT NULL, detail text NOT NULL, prev_hash text NOT NULL, hash text NOT NULL, PRIMARY KEY (workspace_slug, seq));
CREATE INDEX IF NOT EXISTS audit_entries_action ON audit_entries (workspace_slug, action, seq);
`;

export const REGIONS = [
  { id: "cascade", name: "Cascade", continent: "North America West", lon: -122, lat: 47 },
  { id: "meridian", name: "Meridian", continent: "Europe Central", lon: 9, lat: 50 },
  { id: "monsoon", name: "Monsoon", continent: "Southeast Asia", lon: 104, lat: 1 },
  { id: "pampas", name: "Pampas", continent: "South America East", lon: -47, lat: -23 },
] as const;
export const REGION_IDS: readonly string[] = REGIONS.map((r) => r.id);

const SEED_PASSWORD = "farshore-demo-26";

// Jun Arai is enrolled in two-step sign-in, with no code step accepted yet.
const SEED_TWO_STEP = {
  email: "jun@paperkite.test",
  secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
  recoveryCodes: ["kite1-jun01", "kite1-jun02", "kite1-jun03", "kite1-jun04", "kite1-jun05", "kite1-jun06", "kite1-jun07",
    "kite1-jun08", "kite1-jun09", "kite1-jun10"],
};

const WORKSPACES = [
  { slug: "lanternfish", name: "Lanternfish Games", plan: "indie",
    members: [["Mara Okonkwo", "mara@lanternfish.test", "owner"], ["Theo Lindqvist", "theo@lanternfish.test", "developer"],
      ["Priya Raman", "priya@lanternfish.test", "viewer"]],
    buckets: [["lanternfish-replays", ["cascade", "meridian", "monsoon"]], ["lanternfish-avatars", ["meridian", "cascade"]]] },
  { slug: "paperkite", name: "Paper Kite Studio", plan: "indie",
    members: [["Jun Arai", "jun@paperkite.test", "owner"], ["Sol Benitez", "sol@paperkite.test", "developer"]],
    buckets: [["paperkite-replays", ["monsoon", "cascade"]]] },
  { slug: "tidepool", name: "Tidepool Tools", plan: "sandbox",
    members: [["Ada Nwosu", "ada@tidepool.test", "owner"]],
    buckets: [["tidepool-builds", ["cascade"]]] },
] as const;

export const SEED_OBJECTS = [
  { bucket: "lanternfish-replays", key: "season-1/manifest.json", contentType: "application/json",
    bytes: Buffer.from('{"season":1,"build":"1.4.2"}'), tags: { env: "prod", team: "netcode" } },
  { bucket: "lanternfish-replays", key: "season-1/replays/r-0001.bin", contentType: "application/octet-stream",
    bytes: Buffer.alloc(2048), tags: { env: "qa" } },
  { bucket: "lanternfish-avatars", key: "avatars/README.txt", contentType: "text/plain",
    bytes: Buffer.from("Avatar uploads land here.\n"), tags: {} },
  { bucket: "paperkite-replays", key: "season-1/manifest.json", contentType: "application/json",
    bytes: Buffer.from('{"studio":"paperkite","season":1}'), tags: { env: "prod" } },
  { bucket: "tidepool-builds", key: "builds/tidepool-0.9.0.txt", contentType: "text/plain",
    bytes: Buffer.from("tidepool build 0.9.0\n"), tags: {} },
] as const;

// Applies the schema and seeds regions, workspaces, people and buckets. Seed objects are
// written afterwards by objects.seedObjects, because their bytes go to MinIO.
export async function applySchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(424242)");
    await client.query(DDL);
    await client.query("INSERT INTO billing_status (id) VALUES (1) ON CONFLICT DO NOTHING");
    for (const [position, r] of REGIONS.entries()) {
      await client.query(
        "INSERT INTO regions (id, name, continent, lon, lat, position) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING",
        [r.id, r.name, r.continent, r.lon, r.lat, position]);
    }
    const existing = await query<{ email: string }>(client, "SELECT lower(email) AS email FROM users");
    const known = new Set(existing.map((u) => u.email));
    const hash = known.size === 0 ? await hashPassword(SEED_PASSWORD) : null;
    const person = async (name: string, email: string, operator: boolean): Promise<void> => {
      if (known.has(email)) return;
      const enrolled = email === SEED_TWO_STEP.email;
      const created = await client.query<{ id: string }>(
        `INSERT INTO users (id, email, name, password_hash, operator, two_step_secret, two_step_enabled_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING RETURNING id`,
        [email, name, hash ?? await hashPassword(SEED_PASSWORD), operator, enrolled ? seal(SEED_TWO_STEP.secret) : null,
          enrolled ? new Date(Math.floor(Date.now() / 1000) * 1000) : null]);
      const id = created.rows[0]?.id;
      if (enrolled && id) {
        await client.query("INSERT INTO recovery_codes (user_id, code_hash) SELECT $1, unnest($2::text[])",
          [id, SEED_TWO_STEP.recoveryCodes.map(recoveryCodeHash)]);
      }
    };
    await person("Rui Castellan", "operator@farshore.test", true);
    for (const ws of WORKSPACES) {
      if (!PLANS.some((p) => p.id === ws.plan)) throw new Error(`unknown plan ${ws.plan}`);
      await client.query(
        "INSERT INTO workspaces (id, slug, name, plan_id) VALUES (gen_random_uuid(), $1, $2, $3) ON CONFLICT (slug) DO NOTHING",
        [ws.slug, ws.name, ws.plan]);
      for (const [name, email, role] of ws.members) {
        if (known.has(email)) continue;
        await person(name, email, false);
        await client.query(
          `INSERT INTO members (workspace_id, user_id, role)
           SELECT w.id, u.id, $3 FROM workspaces w, users u WHERE w.slug = $1 AND lower(u.email) = $2
           ON CONFLICT DO NOTHING`, [ws.slug, email, role]);
      }
      for (const [name, placement] of ws.buckets) {
        await client.query(
          `INSERT INTO buckets (workspace_id, name, placement, created_at)
           SELECT id, $2, $3, now() FROM workspaces WHERE slug = $1 ON CONFLICT (name) DO NOTHING`,
          [ws.slug, name, placement]);
      }
    }
    const open = await query(client, "SELECT 1 FROM usage_windows WHERE end_at IS NULL");
    if (open.length === 0) {
      await client.query("INSERT INTO usage_windows (start_at) VALUES (date_trunc('hour', now())) ON CONFLICT DO NOTHING");
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(424242)").catch(() => undefined);
    client.release();
  }
}
