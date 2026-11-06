CREATE TABLE IF NOT EXISTS client_orgs (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  time_zone   text NOT NULL,
  seed_order  integer NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  email         text NOT NULL UNIQUE,
  role          text NOT NULL,
  client_org_id text REFERENCES client_orgs(id),
  units         text NOT NULL DEFAULT 'metric',
  password_hash text NOT NULL,
  last_screen   text,
  seed_order    integer NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS sign_in_attempts (
  email            text PRIMARY KEY,
  fail_count       integer NOT NULL DEFAULT 0,
  window_started_at timestamptz,
  locked_until     timestamptz
);

CREATE TABLE IF NOT EXISTS vessels (
  id                   text PRIMARY KEY,
  name                 text NOT NULL,
  ingest_key           text NOT NULL UNIQUE,
  thruster_hours_total double precision NOT NULL,
  hours_since_service  double precision NOT NULL,
  service_interval_h   double precision NOT NULL,
  afloat               boolean NOT NULL DEFAULT false,
  version              integer NOT NULL DEFAULT 1,
  seed_order           integer NOT NULL
);

CREATE TABLE IF NOT EXISTS missions (
  id                   text PRIMARY KEY,
  name                 text NOT NULL,
  client_org_id        text NOT NULL REFERENCES client_orgs(id),
  survey_date          date NOT NULL,
  status               text NOT NULL,
  survey_order         text NOT NULL,
  survey_area          jsonb NOT NULL,
  geofence             jsonb NOT NULL,
  planned_depth_m      double precision NOT NULL,
  swath_ratio          double precision NOT NULL,
  overlap_pct          double precision NOT NULL,
  line_azimuth_deg     double precision NOT NULL,
  planned_speed_mps    double precision NOT NULL,
  swath_width_m        double precision NOT NULL,
  line_spacing_m       double precision NOT NULL,
  line_count           integer NOT NULL,
  crossline_count      integer NOT NULL,
  estimated_duration_s integer NOT NULL,
  owner_id             text NOT NULL REFERENCES users(id),
  version              integer NOT NULL DEFAULT 1,
  hold                 jsonb,
  report_state         text NOT NULL DEFAULT 'None',
  report_sha256        text,
  report_size_bytes    integer,
  report_stored_at     timestamptz,
  report_generated_at  timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  launched_at          timestamptz,
  completed_at         timestamptz,
  next_label_num       integer NOT NULL DEFAULT 1,
  next_holiday_num     integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS holidays (
  id              text PRIMARY KEY,
  mission_id      text NOT NULL REFERENCES missions(id),
  label           text NOT NULL,
  label_num       integer NOT NULL,
  status          text NOT NULL,
  cells           jsonb NOT NULL,
  infill_line_id  text
);
CREATE INDEX IF NOT EXISTS holidays_mission_idx ON holidays(mission_id);

CREATE TABLE IF NOT EXISTS lines (
  id            text PRIMARY KEY,
  mission_id    text NOT NULL REFERENCES missions(id),
  label         text NOT NULL,
  kind          text NOT NULL,
  status        text NOT NULL,
  rerun_of      text REFERENCES lines(id),
  rerun_seq     integer NOT NULL DEFAULT 0,
  vessel_id     text REFERENCES vessels(id),
  start_e       double precision NOT NULL,
  start_n       double precision NOT NULL,
  end_e         double precision NOT NULL,
  end_n         double precision NOT NULL,
  length_m      double precision NOT NULL,
  holiday_id    text REFERENCES holidays(id),
  label_num     integer NOT NULL,
  infill_order  double precision,
  file_state    text,
  file_name     text,
  file_size     integer,
  file_sha256   text,
  file_stored_at timestamptz
);
CREATE INDEX IF NOT EXISTS lines_mission_idx ON lines(mission_id);
CREATE INDEX IF NOT EXISTS lines_vessel_idx ON lines(vessel_id);

CREATE TABLE IF NOT EXISTS fixes (
  id          bigserial PRIMARY KEY,
  vessel_id   text NOT NULL REFERENCES vessels(id),
  t           timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  easting     double precision NOT NULL,
  northing    double precision NOT NULL,
  heading_deg double precision NOT NULL,
  speed_mps   double precision NOT NULL,
  battery_pct double precision NOT NULL,
  depth_m     double precision NOT NULL,
  line_id     text REFERENCES lines(id),
  mission_id  text REFERENCES missions(id),
  UNIQUE (vessel_id, t)
);
CREATE INDEX IF NOT EXISTS fixes_vessel_t_idx ON fixes(vessel_id, t DESC);
CREATE INDEX IF NOT EXISTS fixes_line_idx ON fixes(line_id, t);
CREATE INDEX IF NOT EXISTS fixes_mission_idx ON fixes(mission_id);

CREATE TABLE IF NOT EXISTS alerts (
  id               text PRIMARY KEY,
  mission_id       text NOT NULL REFERENCES missions(id),
  vessel_id        text NOT NULL REFERENCES vessels(id),
  kind             text NOT NULL,
  state            text NOT NULL,
  heading          text NOT NULL,
  raised_at        timestamptz NOT NULL,
  rectified_at     timestamptz,
  position         jsonb,
  acknowledged_at  timestamptz,
  acknowledged_by  text,
  email_state      text NOT NULL DEFAULT 'Queued',
  escalation_state text NOT NULL DEFAULT 'None',
  history          jsonb NOT NULL,
  seq              bigserial
);
CREATE INDEX IF NOT EXISTS alerts_mission_idx ON alerts(mission_id);
CREATE INDEX IF NOT EXISTS alerts_open_idx ON alerts(state);

CREATE TABLE IF NOT EXISTS excursions (
  id         text PRIMARY KEY,
  mission_id text NOT NULL REFERENCES missions(id),
  vessel_id  text NOT NULL REFERENCES vessels(id),
  alert_id   text REFERENCES alerts(id),
  started_at timestamptz NOT NULL,
  ended_at   timestamptz
);
CREATE INDEX IF NOT EXISTS excursions_open_idx ON excursions(mission_id, vessel_id, ended_at);

CREATE TABLE IF NOT EXISTS lost_spells (
  id         text PRIMARY KEY,
  mission_id text NOT NULL REFERENCES missions(id),
  vessel_id  text NOT NULL REFERENCES vessels(id),
  alert_id   text REFERENCES alerts(id),
  started_at timestamptz NOT NULL,
  ended_at   timestamptz
);
CREATE INDEX IF NOT EXISTS lost_spells_open_idx ON lost_spells(mission_id, vessel_id, ended_at);

CREATE TABLE IF NOT EXISTS overdue_spells (
  id         text PRIMARY KEY,
  mission_id text NOT NULL REFERENCES missions(id),
  vessel_id  text NOT NULL REFERENCES vessels(id),
  alert_id   text REFERENCES alerts(id),
  started_at timestamptz NOT NULL,
  ended_at   timestamptz
);
CREATE INDEX IF NOT EXISTS overdue_spells_open_idx ON overdue_spells(mission_id, vessel_id, ended_at);

CREATE TABLE IF NOT EXISTS services (
  id               text PRIMARY KEY,
  vessel_id        text NOT NULL REFERENCES vessels(id),
  logged_at        timestamptz NOT NULL,
  logged_by        text NOT NULL,
  hours_at_service double precision NOT NULL,
  note             text NOT NULL
);
CREATE INDEX IF NOT EXISTS services_vessel_idx ON services(vessel_id, logged_at DESC);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id    text NOT NULL,
  endpoint   text NOT NULL,
  key        text NOT NULL,
  body_hash  text NOT NULL,
  status     integer NOT NULL,
  response   jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, endpoint, key)
);

CREATE TABLE IF NOT EXISTS outbox (
  id          bigserial PRIMARY KEY,
  dedupe_key  text NOT NULL UNIQUE,
  to_addr     text NOT NULL,
  subject     text NOT NULL,
  body        text NOT NULL,
  state       text NOT NULL DEFAULT 'Queued',
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz,
  alert_id    text,
  purpose     text NOT NULL
);
CREATE INDEX IF NOT EXISTS outbox_state_idx ON outbox(state);

CREATE TABLE IF NOT EXISTS mission_events (
  seq        bigserial PRIMARY KEY,
  mission_id text NOT NULL REFERENCES missions(id),
  at         timestamptz NOT NULL DEFAULT now(),
  kind       text NOT NULL,
  actor      text NOT NULL,
  summary    text NOT NULL
);
CREATE INDEX IF NOT EXISTS mission_events_idx ON mission_events(mission_id, at DESC, seq DESC);

CREATE TABLE IF NOT EXISTS flags (
  id            text PRIMARY KEY,
  mission_id    text NOT NULL REFERENCES missions(id),
  line_id       text NOT NULL REFERENCES lines(id),
  client_org_id text NOT NULL REFERENCES client_orgs(id),
  by_user_id    text NOT NULL REFERENCES users(id),
  comment       text NOT NULL,
  at            timestamptz NOT NULL DEFAULT now(),
  state         text NOT NULL DEFAULT 'Open',
  reply         text,
  reply_at      timestamptz,
  reply_by      text
);
CREATE INDEX IF NOT EXISTS flags_state_idx ON flags(state, at DESC);

CREATE TABLE IF NOT EXISTS uploads (
  id             text PRIMARY KEY,
  line_id        text NOT NULL REFERENCES lines(id),
  size_bytes     integer NOT NULL,
  sha256         text NOT NULL,
  received_bytes integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  open           boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS uploads_line_idx ON uploads(line_id, open);

CREATE TABLE IF NOT EXISTS upload_parts (
  upload_id  text NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  first_byte integer NOT NULL,
  bytes      bytea NOT NULL,
  PRIMARY KEY (upload_id, first_byte)
);

CREATE TABLE IF NOT EXISTS service_probes (
  name       text PRIMARY KEY,
  state      text NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now()
);
