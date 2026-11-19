package seed

// schemaSQL is applied idempotently every time the server starts.
const schemaSQL = `CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  keycloak_sub TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  keycloak_sub TEXT NOT NULL,
  name TEXT NOT NULL,
  roles TEXT[] NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS signin_attempts (
  state TEXT PRIMARY KEY,
  verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  return_to TEXT NOT NULL DEFAULT '',
  used BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS registrations (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL UNIQUE REFERENCES people(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('bidder','consignor','specialist','cashier','admin')),
  status TEXT NOT NULL CHECK (status IN ('pending','active')),
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  paddle INTEGER UNIQUE,
  spending_limit INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS paddle_seq START 104;

-- The roles grew to include staff desks; correct an older database in place.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints
             WHERE table_name = 'registrations' AND constraint_name = 'registrations_role_check') THEN
    ALTER TABLE registrations DROP CONSTRAINT registrations_role_check;
  END IF;
END $$;
ALTER TABLE registrations ADD CONSTRAINT registrations_role_check
  CHECK (role IN ('bidder','consignor','specialist','cashier','admin'));

CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  first_lot_number INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('draft','open','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lots (
  id TEXT PRIMARY KEY,
  sale_id TEXT REFERENCES sales(id),
  consignor_id TEXT NOT NULL REFERENCES people(id),
  position INTEGER,
  lot_number INTEGER,
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('wristwatch','camera')),
  description TEXT NOT NULL DEFAULT '',
  condition TEXT NOT NULL DEFAULT '',
  portrait TEXT NOT NULL DEFAULT '',
  estimate_low INTEGER,
  estimate_high INTEGER,
  opening_bid INTEGER,
  reserve INTEGER,
  price INTEGER,
  leader_bid_id TEXT,
  reserve_met BOOLEAN NOT NULL DEFAULT FALSE,
  state TEXT NOT NULL CHECK (state IN ('intake','estimated','placed','open','extended','closed_sold','closed_unsold','second_chance_offered','underbidder_offered','sold_by_offer','offer_lapsed','invoiced','paid','defaulted')),
  closes_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  hammer INTEGER,
  second_chance_done BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lots_sale_idx ON lots (sale_id, position);
CREATE INDEX IF NOT EXISTS lots_consignor_idx ON lots (consignor_id);

CREATE TABLE IF NOT EXISTS bids (
  id TEXT PRIMARY KEY,
  lot_id TEXT NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
  bidder_id TEXT NOT NULL REFERENCES people(id),
  max_amount INTEGER NOT NULL,
  price_after INTEGER NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL,
  removed_at TIMESTAMPTZ,
  removed_reason TEXT,
  seq INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS bids_lot_idx ON bids (lot_id, accepted_at, id);

CREATE TABLE IF NOT EXISTS idempotency (
  key TEXT NOT NULL,
  bidder_id TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  status INTEGER NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bidder_id, key)
);

CREATE TABLE IF NOT EXISTS watches (
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  lot_id TEXT NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, lot_id)
);

CREATE TABLE IF NOT EXISTS offers (
  id TEXT PRIMARY KEY,
  lot_id TEXT NOT NULL REFERENCES lots(id),
  to_person_id TEXT NOT NULL REFERENCES people(id),
  kind TEXT NOT NULL CHECK (kind IN ('second_chance','default')),
  amount INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','accepted','declined','expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS offers_open_lot_idx ON offers (lot_id) WHERE status = 'open';

CREATE SEQUENCE IF NOT EXISTS invoice_seq START 1;
CREATE SEQUENCE IF NOT EXISTS statement_seq START 1;

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  number TEXT UNIQUE NOT NULL,
  sale_id TEXT REFERENCES sales(id),
  sale_title TEXT NOT NULL,
  paddle INTEGER NOT NULL,
  bidder_id TEXT NOT NULL REFERENCES people(id),
  status TEXT NOT NULL CHECK (status IN ('issued','paid','defaulted')),
  issued_at TIMESTAMPTZ NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  paid INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS invoice_lines (
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  lot_id TEXT NOT NULL REFERENCES lots(id),
  lot_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('hammer','second_chance','default_offer')),
  hammer INTEGER NOT NULL,
  premium INTEGER NOT NULL,
  vat INTEGER NOT NULL,
  PRIMARY KEY (invoice_id, position)
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('bank_transfer','card','cash')),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS statements (
  id TEXT PRIMARY KEY,
  number TEXT UNIQUE,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  sale_title TEXT NOT NULL,
  consignor_id TEXT NOT NULL REFERENCES people(id),
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','issued','superseded')),
  issued_at TIMESTAMPTZ,
  supersedes TEXT,
  superseded_by TEXT,
  lines JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS statements_draft_idx ON statements (sale_id, consignor_id) WHERE status = 'draft';

-- An older database made the statement number mandatory; drafts now receive
-- their number only when they are issued.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'statements' AND column_name = 'number' AND is_nullable = 'NO') THEN
    ALTER TABLE statements ALTER COLUMN number DROP NOT NULL;
    ALTER TABLE statements ALTER COLUMN number SET DEFAULT NULL;
    UPDATE statements SET number = NULL WHERE status = 'draft' AND number = '';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS notices (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  lot_id TEXT,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS notices_person_idx ON notices (person_id, created_at DESC);

CREATE TABLE IF NOT EXISTS events (
  seq BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  lot_id TEXT,
  person_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS closing_notices (
  lot_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  PRIMARY KEY (lot_id, person_id)
);

CREATE TABLE IF NOT EXISTS due_events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  lot_id TEXT,
  person_id TEXT,
  invoice_id TEXT,
  offer_id TEXT,
  due_at TIMESTAMPTZ NOT NULL,
  done BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS due_events_pending_idx ON due_events (due_at) WHERE NOT done;
`
