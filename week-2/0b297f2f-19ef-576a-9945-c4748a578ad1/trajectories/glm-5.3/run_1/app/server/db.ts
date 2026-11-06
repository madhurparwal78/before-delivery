import pg from 'pg';

export type DbClient = pg.PoolClient;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS staff (
  id text PRIMARY KEY,
  name text NOT NULL,
  role text NOT NULL
);

CREATE TABLE IF NOT EXISTS lenders (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL
);

CREATE TABLE IF NOT EXISTS exhibitions (
  id text PRIMARY KEY,
  title text NOT NULL,
  museum text NOT NULL,
  time_zone text NOT NULL,
  run_start date NOT NULL,
  run_end date NOT NULL,
  open_hours_per_day int NOT NULL,
  closed_weekdays int[] NOT NULL
);

CREATE TABLE IF NOT EXISTS galleries (
  id text PRIMARY KEY,
  exhibition_id text NOT NULL REFERENCES exhibitions(id),
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS walls (
  id text PRIMARY KEY,
  gallery_id text NOT NULL REFERENCES galleries(id),
  name text NOT NULL,
  length_mm int NOT NULL,
  height_mm int NOT NULL,
  planned_lux int NOT NULL,
  sort_order int NOT NULL
);

CREATE TABLE IF NOT EXISTS objects (
  id text PRIMARY KEY,
  object_number text NOT NULL UNIQUE,
  title text NOT NULL,
  medium text NOT NULL,
  lender_id text REFERENCES lenders(id),
  width_mm int NOT NULL,
  height_mm int NOT NULL,
  lux_limit int NOT NULL,
  lux_hour_budget bigint NOT NULL,
  insurance_value_gbp bigint NOT NULL,
  registrar_note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS placements (
  id text PRIMARY KEY,
  object_id text NOT NULL REFERENCES objects(id),
  wall_id text NOT NULL REFERENCES walls(id),
  offset_mm int NOT NULL,
  centre_height_mm int NOT NULL,
  height_override boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'proposed',
  claimed_by text REFERENCES staff(id),
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS photos (
  id text PRIMARY KEY,
  object_id text NOT NULL REFERENCES objects(id),
  key text NOT NULL,
  bytes bigint NOT NULL,
  sha256 text NOT NULL,
  content_type text NOT NULL,
  attached_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS undo_actions (
  action_id text PRIMARY KEY,
  staff_id text NOT NULL REFERENCES staff(id),
  placement_id text NOT NULL REFERENCES placements(id),
  kind text NOT NULL,
  before_wall_id text,
  before_offset_mm int,
  before_centre_height_mm int,
  before_height_override boolean,
  before_status text,
  before_claimed_by text,
  undo_until timestamptz NOT NULL,
  undone boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS events (
  seq bigserial PRIMARY KEY,
  kind text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  actor_id text REFERENCES staff(id),
  actor_name text NOT NULL,
  placement_id text,
  object_id text,
  wall_id text,
  title text,
  wall_name text,
  offset_mm int,
  planned_lux int,
  preview_id text,
  publish_at_display text,
  recipient_count int
);

CREATE TABLE IF NOT EXISTS previews (
  id text PRIMARY KEY,
  status text NOT NULL,
  date date,
  publish_at timestamptz,
  scheduled_at timestamptz,
  published_at timestamptz,
  withdrawn_at timestamptz
);

CREATE TABLE IF NOT EXISTS preview_recipients (
  preview_id text NOT NULL REFERENCES previews(id),
  lender_id text NOT NULL REFERENCES lenders(id),
  token text NOT NULL,
  delivery text NOT NULL,
  sent_at timestamptz,
  PRIMARY KEY (preview_id, lender_id)
);

CREATE TABLE IF NOT EXISTS idempotency (
  staff_id text NOT NULL,
  route text NOT NULL,
  key text NOT NULL,
  status int NOT NULL,
  body text NOT NULL,
  request_fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, route, key)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_placements_object_active
  ON placements (object_id)
  WHERE status <> 'removed';

CREATE INDEX IF NOT EXISTS idx_events_seq ON events (seq);

CREATE INDEX IF NOT EXISTS idx_undo_pending ON undo_actions (undo_until) WHERE NOT undone;

CREATE INDEX IF NOT EXISTS idx_previews_due ON previews (publish_at)
  WHERE status = 'scheduled';
`;

export const SEED_SQL = `
INSERT INTO exhibitions (id, title, museum, time_zone, run_start, run_end, open_hours_per_day, closed_weekdays)
VALUES ('exh-salt', 'Salt and Thread', 'Ashgrove Museum of Art', 'Europe/London',
        '2027-03-06', '2027-06-27', 7, '{1}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO galleries (id, exhibition_id, name)
VALUES ('gal-east', 'exh-salt', 'East Gallery')
ON CONFLICT (id) DO NOTHING;

INSERT INTO staff (id, name, role) VALUES
  ('cur-ines', 'Ines Calloway', 'curator'),
  ('reg-tomasz', 'Tomasz Adeyemi', 'registrar'),
  ('prep-ruth', 'Ruth Okonkwo-Hale', 'preparator'),
  ('prep-dev', 'Dev Malhotra', 'preparator')
ON CONFLICT (id) DO NOTHING;

INSERT INTO lenders (id, name, email) VALUES
  ('lender-harbourside', 'Harbourside Historical Society', 'loans@harbourside-history.example'),
  ('lender-oduya', 'Mirela Oduya', 'mirela.oduya@example.net'),
  ('lender-fenwick', 'Fenwick Maritime Trust', 'registrar@fenwick-trust.example')
ON CONFLICT (id) DO NOTHING;

INSERT INTO walls (id, gallery_id, name, length_mm, height_mm, planned_lux, sort_order) VALUES
  ('wall-north', 'gal-east', 'North wall', 12000, 4000, 50, 0),
  ('wall-east', 'gal-east', 'East wall', 6000, 4000, 50, 1),
  ('wall-south', 'gal-east', 'South wall', 12000, 4000, 150, 2),
  ('wall-west', 'gal-east', 'West wall', 6000, 4000, 150, 3)
ON CONFLICT (id) DO NOTHING;

INSERT INTO objects (id, object_number, title, medium, lender_id, width_mm, height_mm, lux_limit, lux_hour_budget, insurance_value_gbp, registrar_note) VALUES
  ('obj-herring', 'L-2027-001', 'Herring Girls at the Gutting Station', 'Watercolour on paper', 'lender-harbourside', 560, 380, 50, 50000, 18000, 'Slight foxing lower left; glazing replaced 2019.'),
  ('obj-sampler', 'L-2027-002', 'Net Mending Sampler', 'Wool on linen', 'lender-harbourside', 450, 600, 50, 30000, 9500, 'Loose stitching at upper edge; do not pin.'),
  ('obj-ganseys', 'L-2027-003', 'Ganseys Drying', 'Oil on canvas', 'lender-oduya', 762, 610, 200, 150000, 42000, 'Lender requires two-person handling.'),
  ('obj-quilt', 'L-2027-004', 'Tide Chart Quilt', 'Cotton patchwork', 'lender-oduya', 1400, 1800, 50, 50000, 26000, 'Hang on fabric batten only.'),
  ('obj-signal', 'L-2027-005', 'Signal Flag Pattern Book', 'Ink and watercolour on paper', 'lender-fenwick', 280, 360, 50, 50000, 7200, 'Open at plate 7 only.'),
  ('obj-logbook', 'AS-1961-14', 'Lighthouse Log, Skerrin Point', 'Ink on paper', NULL, 300, 420, 50, 50000, 4000, ''),
  ('obj-shore', 'AS-1974-02', 'Shore Light, Evening', 'Oil on board', NULL, 900, 700, 200, 150000, 31000, '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO placements (id, object_id, wall_id, offset_mm, centre_height_mm, height_override, status, claimed_by, version) VALUES
  ('pl-herring', 'obj-herring', 'wall-north', 2000, 1450, false, 'proposed', NULL, 1),
  ('pl-ganseys', 'obj-ganseys', 'wall-south', 3000, 1450, false, 'proposed', NULL, 1),
  ('pl-shore', 'obj-shore', 'wall-south', 6000, 1450, false, 'claimed', 'prep-ruth', 1),
  ('pl-logbook', 'obj-logbook', 'wall-east', 1500, 1450, false, 'hung', 'prep-dev', 1)
ON CONFLICT (id) DO NOTHING;
`;
