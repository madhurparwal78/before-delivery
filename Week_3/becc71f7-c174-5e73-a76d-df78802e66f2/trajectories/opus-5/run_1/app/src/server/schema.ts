/** The shop's record in Postgres. The schema is applied idempotently when the app starts. */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS shop_state (
  id                  boolean PRIMARY KEY DEFAULT true CHECK (id),
  started_on          date NOT NULL,
  seeded_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS members (
  id                  uuid PRIMARY KEY,
  name                text NOT NULL,
  email               text NOT NULL,
  email_lower         text NOT NULL,
  password_hash       text NOT NULL,
  role                text NOT NULL,
  created_at          timestamptz NOT NULL,
  removed_at          timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS members_email_live
  ON members (email_lower) WHERE removed_at IS NULL;

CREATE TABLE IF NOT EXISTS sessions (
  token               text PRIMARY KEY,
  member_id           uuid NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  created_at          timestamptz NOT NULL,
  expires_at          timestamptz NOT NULL,
  ended_at            timestamptz
);

CREATE TABLE IF NOT EXISTS consignors (
  id                  uuid PRIMARY KEY,
  name                text NOT NULL,
  email               text,
  email_lower         text,
  phone               text,
  iban                text,
  status              text NOT NULL DEFAULT 'active',
  created_at          timestamptz NOT NULL,
  erased_at           timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS consignors_email_live
  ON consignors (email_lower) WHERE email_lower IS NOT NULL AND status <> 'erased';

CREATE TABLE IF NOT EXISTS ladders (
  id                        uuid PRIMARY KEY,
  effective_on              date NOT NULL UNIQUE,
  first_markdown_percent    integer NOT NULL,
  first_markdown_day        integer NOT NULL,
  second_markdown_percent   integer NOT NULL,
  second_markdown_day       integer NOT NULL,
  period_end_day            integer NOT NULL,
  created_at                timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS pieces (
  id                  uuid PRIMARY KEY,
  serial              integer NOT NULL UNIQUE,
  tag_code            text NOT NULL UNIQUE,
  consignor_id        uuid NOT NULL REFERENCES consignors (id),
  category            text NOT NULL,
  brand               text NOT NULL,
  description         text NOT NULL,
  size                text NOT NULL,
  condition           text NOT NULL,
  asking_price_cents  integer NOT NULL,
  intake_date         date NOT NULL,
  ladder_id           uuid NOT NULL REFERENCES ladders (id),
  choice              text,
  collected_at        timestamptz,
  archived_at         timestamptz,
  version             integer NOT NULL DEFAULT 1,
  import_item_no      text,
  created_at          timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS pieces_import_item_no ON pieces (import_item_no)
  WHERE import_item_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS pieces_consignor ON pieces (consignor_id);

CREATE TABLE IF NOT EXISTS asking_prices (
  id                  uuid PRIMARY KEY,
  piece_id            uuid NOT NULL REFERENCES pieces (id) ON DELETE CASCADE,
  asking_price_cents  integer NOT NULL,
  effective_from      timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS asking_prices_piece ON asking_prices (piece_id, effective_from);

CREATE TABLE IF NOT EXISTS photos (
  id                  uuid PRIMARY KEY,
  piece_id            uuid NOT NULL REFERENCES pieces (id) ON DELETE CASCADE,
  content_type        text NOT NULL,
  width               integer NOT NULL,
  height              integer NOT NULL,
  position            integer NOT NULL,
  created_at          timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS photos_piece ON photos (piece_id, position);

CREATE TABLE IF NOT EXISTS holds (
  id                  uuid PRIMARY KEY,
  piece_id            uuid NOT NULL REFERENCES pieces (id) ON DELETE CASCADE,
  token               text NOT NULL UNIQUE,
  shopper_name        text NOT NULL,
  shopper_email       text NOT NULL,
  starts_at           timestamptz NOT NULL,
  ends_at             timestamptz NOT NULL,
  released_at         timestamptz
);
CREATE INDEX IF NOT EXISTS holds_piece ON holds (piece_id);

CREATE TABLE IF NOT EXISTS sales (
  id                      uuid PRIMARY KEY,
  piece_id                uuid NOT NULL REFERENCES pieces (id) ON DELETE CASCADE,
  sold_at                 timestamptz NOT NULL,
  price_cents             integer NOT NULL,
  consignor_share_cents   integer NOT NULL,
  commission_cents        integer NOT NULL,
  vat_cents               integer NOT NULL,
  payment                 text NOT NULL,
  sold_by                 uuid NOT NULL REFERENCES members (id),
  refunded_at             timestamptz,
  created_at              timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sales_piece ON sales (piece_id);
CREATE UNIQUE INDEX IF NOT EXISTS sales_one_live_per_piece ON sales (piece_id)
  WHERE refunded_at IS NULL;

CREATE TABLE IF NOT EXISTS request_keys (
  member_id           uuid NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  request_key         text NOT NULL,
  body_hash           text NOT NULL,
  status_code         integer NOT NULL,
  response_body       text NOT NULL,
  created_at          timestamptz NOT NULL,
  PRIMARY KEY (member_id, request_key)
);

CREATE TABLE IF NOT EXISTS payout_runs (
  month               text PRIMARY KEY,
  status              text NOT NULL,
  started_at          timestamptz NOT NULL,
  started_by          uuid NOT NULL REFERENCES members (id),
  ready_at            timestamptz,
  msg_id              text NOT NULL,
  control_sum_cents   integer NOT NULL
);

CREATE TABLE IF NOT EXISTS payouts (
  id                  text PRIMARY KEY,
  month               text NOT NULL REFERENCES payout_runs (month) ON DELETE CASCADE,
  consignor_id        uuid NOT NULL REFERENCES consignors (id),
  consignor_name      text NOT NULL,
  creditor_name       text NOT NULL,
  iban                text,
  amount_cents        integer NOT NULL,
  status              text NOT NULL,
  reason              text,
  sequence            integer NOT NULL
);
CREATE INDEX IF NOT EXISTS payouts_month ON payouts (month, sequence);
CREATE INDEX IF NOT EXISTS payouts_consignor ON payouts (consignor_id);

CREATE TABLE IF NOT EXISTS payout_sales (
  payout_id           text NOT NULL REFERENCES payouts (id) ON DELETE CASCADE,
  sale_id             uuid NOT NULL REFERENCES sales (id) ON DELETE CASCADE,
  PRIMARY KEY (payout_id, sale_id)
);
CREATE INDEX IF NOT EXISTS payout_sales_sale ON payout_sales (sale_id);

CREATE TABLE IF NOT EXISTS portal_links (
  token               text PRIMARY KEY,
  consignor_id        uuid NOT NULL REFERENCES consignors (id) ON DELETE CASCADE,
  created_at          timestamptz NOT NULL,
  ends_at             timestamptz NOT NULL,
  ended_at            timestamptz
);
CREATE INDEX IF NOT EXISTS portal_links_consignor ON portal_links (consignor_id);

CREATE TABLE IF NOT EXISTS appointments (
  id                  uuid PRIMARY KEY,
  starts_at           timestamptz NOT NULL,
  ends_at             timestamptz NOT NULL,
  name                text NOT NULL,
  email               text NOT NULL,
  email_lower         text NOT NULL,
  cancel_token        text NOT NULL UNIQUE,
  created_at          timestamptz NOT NULL,
  cancelled_at        timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS appointments_one_per_slot ON appointments (starts_at)
  WHERE cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS appointments_email ON appointments (email_lower, created_at);

CREATE TABLE IF NOT EXISTS book_downloads (
  id                  uuid PRIMARY KEY,
  member_id           uuid NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  created_at          timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS book_downloads_member ON book_downloads (member_id, created_at);

CREATE TABLE IF NOT EXISTS erasures (
  consignor_id        uuid PRIMARY KEY REFERENCES consignors (id) ON DELETE CASCADE,
  requested_at        timestamptz NOT NULL,
  object_keys         text[] NOT NULL DEFAULT '{}',
  completed_at        timestamptz
);
`;
