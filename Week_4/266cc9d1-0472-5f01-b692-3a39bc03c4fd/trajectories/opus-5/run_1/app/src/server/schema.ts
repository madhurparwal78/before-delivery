import { pool, withAdvisoryLock } from "./db.js";

const DDL = `
CREATE TABLE IF NOT EXISTS tenants (
  id          text PRIMARY KEY,
  name        text NOT NULL
);

CREATE TABLE IF NOT EXISTS staff (
  id          text PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id),
  name        text NOT NULL,
  role        text NOT NULL,
  email       text NOT NULL,
  access_code text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS utilities (
  id             text PRIMARY KEY,
  tenant_id      text NOT NULL REFERENCES tenants(id),
  name           text NOT NULL,
  time_zone      text NOT NULL,
  forester_name  text NOT NULL,
  forester_email text NOT NULL
);

CREATE TABLE IF NOT EXISTS corridors (
  id                     text PRIMARY KEY,
  tenant_id              text NOT NULL REFERENCES tenants(id),
  utility_id             text NOT NULL REFERENCES utilities(id),
  name                   text NOT NULL,
  voltage_kv             integer NOT NULL,
  clearance_threshold_m  double precision NOT NULL,
  origin_lon_deg         double precision NOT NULL,
  origin_lat_deg         double precision NOT NULL,
  azimuth_deg            double precision NOT NULL,
  length_m               double precision NOT NULL,
  inspection_due         date NOT NULL
);

CREATE TABLE IF NOT EXISTS towers (
  corridor_id           text NOT NULL REFERENCES corridors(id),
  number                integer NOT NULL,
  chainage_m            double precision NOT NULL,
  base_height_m         double precision NOT NULL,
  attachment_height_m   double precision NOT NULL,
  lon_deg               double precision NOT NULL,
  lat_deg               double precision NOT NULL,
  PRIMARY KEY (corridor_id, number)
);

CREATE TABLE IF NOT EXISTS assets (
  id              text PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenants(id),
  corridor_id     text NOT NULL REFERENCES corridors(id),
  kind            text NOT NULL,
  state           text NOT NULL,
  rejected_reason text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  stored_at       timestamptz
);
CREATE INDEX IF NOT EXISTS assets_corridor_idx ON assets (corridor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS asset_files (
  asset_id   text NOT NULL REFERENCES assets(id),
  path       text NOT NULL,
  size_bytes bigint NOT NULL,
  sha256     text NOT NULL,
  state      text NOT NULL,
  position   integer NOT NULL,
  PRIMARY KEY (asset_id, path)
);

CREATE TABLE IF NOT EXISTS flight_samples (
  asset_id     text NOT NULL REFERENCES assets(id),
  ordinal      integer NOT NULL,
  interval_idx integer NOT NULL,
  sample_time  timestamptz NOT NULL,
  lon_deg      double precision NOT NULL,
  lat_deg      double precision NOT NULL,
  height_m     double precision NOT NULL,
  chainage_m   double precision NOT NULL,
  PRIMARY KEY (asset_id, ordinal)
);

CREATE TABLE IF NOT EXISTS flight_coverage (
  asset_id text NOT NULL REFERENCES assets(id),
  ordinal  integer NOT NULL,
  from_m   double precision NOT NULL,
  to_m     double precision NOT NULL,
  PRIMARY KEY (asset_id, ordinal)
);

CREATE TABLE IF NOT EXISTS findings_sets (
  id                     text PRIMARY KEY,
  tenant_id              text NOT NULL REFERENCES tenants(id),
  corridor_id            text NOT NULL REFERENCES corridors(id),
  revision               integer NOT NULL,
  state                  text NOT NULL,
  previous_set_id        text REFERENCES findings_sets(id),
  label_seq              integer NOT NULL DEFAULT 0,
  submitted_at           timestamptz,
  submitted_by           text REFERENCES staff(id),
  frozen_finding_count   integer,
  frozen_violation_count integer,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS findings_sets_one_open
  ON findings_sets (corridor_id) WHERE state <> 'closed';
CREATE UNIQUE INDEX IF NOT EXISTS findings_sets_revision
  ON findings_sets (corridor_id, revision);

CREATE TABLE IF NOT EXISTS findings (
  id                   text PRIMARY KEY,
  set_id               text NOT NULL REFERENCES findings_sets(id),
  label_n              integer NOT NULL,
  chainage_m           double precision NOT NULL,
  offset_m             double precision NOT NULL,
  lon_deg              double precision NOT NULL,
  lat_deg              double precision NOT NULL,
  ecef_x               double precision NOT NULL,
  ecef_y               double precision NOT NULL,
  ecef_z               double precision NOT NULL,
  ground_height_m      double precision NOT NULL,
  terrain_level        integer,
  canopy_height_m      double precision NOT NULL,
  canopy_top_height_m  double precision NOT NULL,
  canopy_radius_m      double precision NOT NULL,
  span_from            integer NOT NULL,
  span_to              integer NOT NULL,
  clearance_m          double precision NOT NULL,
  status               text NOT NULL,
  comment              text NOT NULL DEFAULT '',
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS findings_label ON findings (set_id, label_n);
CREATE INDEX IF NOT EXISTS findings_set_idx ON findings (set_id, chainage_m, label_n);

CREATE TABLE IF NOT EXISTS decisions (
  set_id     text NOT NULL REFERENCES findings_sets(id),
  finding_id text NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  decision   text NOT NULL,
  note       text NOT NULL DEFAULT '',
  decided_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (set_id, finding_id)
);

CREATE TABLE IF NOT EXISTS review_links (
  id         text PRIMARY KEY,
  set_id     text NOT NULL REFERENCES findings_sets(id),
  token      text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS review_links_set_idx ON review_links (set_id, created_at DESC);

CREATE TABLE IF NOT EXISTS emails (
  id             text PRIMARY KEY,
  kind           text NOT NULL,
  review_link_id text REFERENCES review_links(id),
  to_address     text NOT NULL,
  subject        text NOT NULL,
  body           text NOT NULL,
  state          text NOT NULL,
  claimed_until  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  sent_at        timestamptz
);
CREATE INDEX IF NOT EXISTS emails_queued_idx ON emails (state, claimed_until);

CREATE TABLE IF NOT EXISTS idempotency_records (
  scope      text NOT NULL,
  route      text NOT NULL,
  key        text NOT NULL,
  body_hash  text NOT NULL,
  status     integer,
  response   text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, route, key)
);

CREATE TABLE IF NOT EXISTS sessions (
  id         text PRIMARY KEY,
  staff_id   text NOT NULL REFERENCES staff(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

export async function applySchema(): Promise<void> {
  // Several processes may start together; one applies, the others wait and skip.
  const applied = await withAdvisoryLock(0x5041_4e31, async () => {
    await pool.query(DDL);
    return true;
  });
  if (applied === null) {
    await pool.query("SELECT pg_advisory_lock($1)", [0x5041_4e31]);
    await pool.query("SELECT pg_advisory_unlock($1)", [0x5041_4e31]);
  }
}
