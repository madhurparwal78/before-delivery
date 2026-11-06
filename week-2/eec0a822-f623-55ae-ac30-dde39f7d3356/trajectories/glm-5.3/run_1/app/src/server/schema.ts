import { Client } from 'pg';
import { randomBytes, scryptSync } from 'node:crypto';

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 32).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split(':');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  return scryptSync(password, salt, 32).toString('hex') === hash;
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS workspaces (
  slug text PRIMARY KEY,
  name text NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  id text PRIMARY KEY,
  workspace_slug text NOT NULL REFERENCES workspaces(slug),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('fleet_director','charter_manager','finance_lead','captain','crew_member')),
  yacht_slug text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  ends_at timestamptz NOT NULL,
  signed_out boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS yachts (
  slug text PRIMARY KEY,
  workspace_slug text NOT NULL REFERENCES workspaces(slug),
  name text NOT NULL,
  base text NOT NULL CHECK (base IN ('split','lavrio')),
  status text NOT NULL DEFAULT 'on_sale' CHECK (status IN ('on_sale','withdrawn')),
  cabins integer NOT NULL,
  length_m text NOT NULL,
  beam_m text NOT NULL,
  draft_m text NOT NULL,
  battery_kwh text NOT NULL,
  hotel_kw text NOT NULL,
  solar_kw text NOT NULL,
  drag_kw_per_kn_cubed text NOT NULL,
  shore_power_kw integer NOT NULL,
  low_minor bigint NOT NULL,
  shoulder_minor bigint NOT NULL,
  high_minor bigint NOT NULL,
  sort_order integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS crew (
  id text PRIMARY KEY,
  yacht_slug text NOT NULL REFERENCES yachts(slug),
  name text NOT NULL,
  position text NOT NULL,
  sort_order integer NOT NULL
);
CREATE TABLE IF NOT EXISTS anchorages (
  id text PRIMARY KEY,
  workspace_slug text NOT NULL REFERENCES workspaces(slug),
  name text NOT NULL,
  base text NOT NULL,
  latitude text NOT NULL,
  longitude text NOT NULL,
  sort_order integer NOT NULL
);
CREATE TABLE IF NOT EXISTS holds (
  id text PRIMARY KEY,
  workspace_slug text NOT NULL REFERENCES workspaces(slug),
  yacht_slug text NOT NULL REFERENCES yachts(slug),
  week_start date NOT NULL,
  week_end date NOT NULL,
  client_name text NOT NULL,
  placed_by_kind text NOT NULL CHECK (placed_by_kind IN ('member','broker')),
  placed_by_id text,
  placed_by_name text NOT NULL,
  broker_id text,
  status text NOT NULL CHECK (status IN ('waiting','live','lapsed','released','charter')),
  position integer,
  queue boolean NOT NULL DEFAULT false,
  placed_at timestamptz NOT NULL,
  live_since timestamptz,
  lapses_at timestamptz,
  charter_id text,
  yacht_length_m text NOT NULL,
  season text NOT NULL,
  weekly_rate_minor bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS holds_week ON holds (yacht_slug, week_start);
CREATE INDEX IF NOT EXISTS holds_status ON holds (status);
CREATE TABLE IF NOT EXISTS exchange_tables (
  id text PRIMARY KEY,
  workspace_slug text NOT NULL REFERENCES workspaces(slug),
  effective_date date NOT NULL,
  gbp text NOT NULL,
  usd text NOT NULL,
  UNIQUE (workspace_slug, effective_date)
);
CREATE TABLE IF NOT EXISTS charters (
  id text PRIMARY KEY,
  workspace_slug text NOT NULL REFERENCES workspaces(slug),
  hold_id text,
  yacht_slug text NOT NULL REFERENCES yachts(slug),
  week_start date NOT NULL,
  week_end date NOT NULL,
  client_name text NOT NULL,
  client_email text NOT NULL,
  currency text NOT NULL,
  season text NOT NULL,
  deposit_date date NOT NULL,
  exchange_table_id text,
  rate text NOT NULL,
  lines jsonb NOT NULL,
  total_eur_minor bigint NOT NULL,
  total_minor bigint NOT NULL,
  invoice_status text NOT NULL DEFAULT 'not_invoiced' CHECK (invoice_status IN ('invoiced','not_invoiced')),
  killbill_invoice_id text,
  invoiced_at timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  closed_at timestamptz,
  erases_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS charters_hold ON charters (hold_id) WHERE hold_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS charters_yacht_week ON charters (yacht_slug, week_start);
CREATE TABLE IF NOT EXISTS passages (
  id text PRIMARY KEY,
  workspace_slug text NOT NULL REFERENCES workspaces(slug),
  yacht_slug text NOT NULL REFERENCES yachts(slug),
  name text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','sent')),
  base text NOT NULL,
  start_anchorage_id text NOT NULL,
  departure_date date NOT NULL,
  departure_time text NOT NULL,
  departs_at timestamptz NOT NULL,
  start_charge_pct integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS passage_legs (
  id text PRIMARY KEY,
  passage_id text NOT NULL REFERENCES passages(id) ON DELETE CASCADE,
  idx integer NOT NULL,
  to_anchorage_id text NOT NULL,
  speed_kn text NOT NULL,
  UNIQUE (passage_id, idx)
);
CREATE TABLE IF NOT EXISTS rotas (
  yacht_slug text NOT NULL REFERENCES yachts(slug),
  week_start date NOT NULL,
  version integer NOT NULL,
  saved_by text,
  saved_at timestamptz,
  work jsonb NOT NULL,
  PRIMARY KEY (yacht_slug, week_start)
);
CREATE TABLE IF NOT EXISTS marinas (
  id text PRIMARY KEY,
  workspace_slug text NOT NULL REFERENCES workspaces(slug),
  name text NOT NULL,
  base text NOT NULL
);
CREATE TABLE IF NOT EXISTS berths (
  workspace_slug text NOT NULL REFERENCES workspaces(slug),
  marina_id text NOT NULL REFERENCES marinas(id),
  code text NOT NULL,
  length_m text NOT NULL,
  width_m text NOT NULL,
  depth_m text NOT NULL,
  PRIMARY KEY (marina_id, code)
);
CREATE TABLE IF NOT EXISTS pontoons (
  workspace_slug text NOT NULL REFERENCES workspaces(slug),
  marina_id text NOT NULL REFERENCES marinas(id),
  code text NOT NULL,
  limit_kw integer NOT NULL,
  PRIMARY KEY (marina_id, code)
);
CREATE TABLE IF NOT EXISTS marina_tariffs (
  id text PRIMARY KEY,
  marina_id text NOT NULL REFERENCES marinas(id),
  workspace_slug text NOT NULL REFERENCES workspaces(slug),
  effective_date date NOT NULL,
  rate_per_metre_minor bigint NOT NULL,
  UNIQUE (marina_id, effective_date)
);
CREATE TABLE IF NOT EXISTS berth_bookings (
  id text PRIMARY KEY,
  workspace_slug text NOT NULL REFERENCES workspaces(slug),
  yacht_slug text NOT NULL REFERENCES yachts(slug),
  marina_id text NOT NULL REFERENCES marinas(id),
  berth_code text NOT NULL,
  arrival_date date NOT NULL,
  departure_date date NOT NULL,
  nights jsonb NOT NULL,
  yacht_length_m text NOT NULL,
  total_minor bigint NOT NULL,
  currency text NOT NULL,
  booked_by text NOT NULL,
  booked_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS shore_power_bookings (
  id text PRIMARY KEY,
  workspace_slug text NOT NULL REFERENCES workspaces(slug),
  yacht_slug text NOT NULL REFERENCES yachts(slug),
  yacht_name text NOT NULL,
  marina_id text NOT NULL REFERENCES marinas(id),
  pontoon_code text NOT NULL,
  slot_start timestamptz NOT NULL,
  slot_end timestamptz NOT NULL,
  kw integer NOT NULL,
  booked_by text NOT NULL,
  booked_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS shore_slot ON shore_power_bookings (marina_id, pontoon_code, slot_start);
CREATE TABLE IF NOT EXISTS store_items (
  id text PRIMARY KEY,
  workspace_slug text NOT NULL REFERENCES workspaces(slug),
  yacht_slug text NOT NULL REFERENCES yachts(slug),
  name text NOT NULL,
  unit text NOT NULL,
  category text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS store_items_unique ON store_items (yacht_slug, lower(name));
CREATE TABLE IF NOT EXISTS store_movements (
  id text PRIMARY KEY,
  item_id text NOT NULL REFERENCES store_items(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('received','used','spoiled')),
  quantity integer NOT NULL,
  logged_by text NOT NULL,
  logged_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS store_movements_item ON store_movements (item_id);
CREATE TABLE IF NOT EXISTS energy_logs (
  id text PRIMARY KEY,
  workspace_slug text NOT NULL REFERENCES workspaces(slug),
  yacht_slug text NOT NULL REFERENCES yachts(slug),
  file_name text NOT NULL,
  size_bytes bigint NOT NULL,
  object_key text NOT NULL,
  uploaded_at timestamptz NOT NULL,
  uploaded_by text NOT NULL,
  day_count integer NOT NULL
);
CREATE TABLE IF NOT EXISTS energy_days (
  yacht_slug text NOT NULL REFERENCES yachts(slug),
  log_id text NOT NULL REFERENCES energy_logs(id) ON DELETE CASCADE,
  upload_order integer NOT NULL,
  day_date date NOT NULL,
  start_charge_pct integer NOT NULL,
  end_charge_pct integer NOT NULL,
  lowest_charge_pct integer NOT NULL,
  solar_kwh text NOT NULL,
  PRIMARY KEY (log_id, day_date)
);
CREATE TABLE IF NOT EXISTS private_pages (
  token text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('manifest','broker')),
  workspace_slug text NOT NULL REFERENCES workspaces(slug),
  charter_id text REFERENCES charters(id),
  broker_id text,
  status text NOT NULL CHECK (status IN ('live','ended')),
  issued_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS broker_rate_events (
  token text NOT NULL,
  at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS broker_rate_idx ON broker_rate_events (token, at);
CREATE TABLE IF NOT EXISTS guests (
  id text PRIMARY KEY,
  charter_id text NOT NULL REFERENCES charters(id),
  full_name text NOT NULL,
  nationality text,
  date_of_birth date,
  passport_number text,
  photo_key text,
  photo_type text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sort_order integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS brokers (
  id text PRIMARY KEY,
  workspace_slug text NOT NULL REFERENCES workspaces(slug),
  name text NOT NULL,
  contact_name text NOT NULL,
  email text NOT NULL,
  notes text NOT NULL
);
CREATE TABLE IF NOT EXISTS seed_state (
  id integer PRIMARY KEY DEFAULT 1,
  seeded boolean NOT NULL DEFAULT false
);
INSERT INTO seed_state (id) VALUES (1) ON CONFLICT DO NOTHING;
`;

interface SeedYacht {
  slug: string;
  name: string;
  base: 'split' | 'lavrio';
  cabins: number;
  length: string;
  beam: string;
  draft: string;
  battery: string;
  hotel: string;
  solar: string;
  drag: string;
  low: number;
  shoulder: number;
  high: number;
}

interface CrewSeed {
  id: string;
  name: string;
  position: string;
  order: number;
}

const CREW: Record<string, CrewSeed[]> = {
  sunwake: [
    { id: 'crew-sunwake-1', name: 'Ivo Matic', position: 'captain', order: 1 },
    { id: 'crew-sunwake-2', name: 'Nina Horvat', position: 'deckhand', order: 2 },
    { id: 'crew-sunwake-3', name: 'Petra Juric', position: 'chef', order: 3 },
  ],
  'halcyon-drift': [
    { id: 'crew-halcyon-1', name: 'Tomislav Rados', position: 'captain', order: 1 },
    { id: 'crew-halcyon-2', name: 'Marta Vukovic', position: 'stewardess', order: 2 },
    { id: 'crew-halcyon-3', name: 'Dario Simic', position: 'deckhand', order: 3 },
  ],
  'kelp-lantern': [
    { id: 'crew-kelp-1', name: 'Stavros Mela', position: 'captain', order: 1 },
    { id: 'crew-kelp-2', name: 'Irini Daskalou', position: 'chef', order: 2 },
    { id: 'crew-kelp-3', name: 'Marko Lisac', position: 'deckhand', order: 3 },
  ],
  'meltemi-glow': [
    { id: 'crew-meltemi-1', name: 'Yannis Karras', position: 'captain', order: 1 },
    { id: 'crew-meltemi-2', name: 'Dimitra Lekka', position: 'deckhand', order: 2 },
    { id: 'crew-meltemi-3', name: 'Thanos Ritsos', position: 'chef', order: 3 },
  ],
  brightwater: [
    { id: 'crew-bright-1', name: 'Josip Bilic', position: 'captain', order: 1 },
    { id: 'crew-bright-2', name: 'Lea Grgic', position: 'stewardess', order: 2 },
    { id: 'crew-bright-3', name: 'Pavlos Zervas', position: 'deckhand', order: 3 },
  ],
  'salt-ember': [
    { id: 'crew-salt-1', name: 'Kresimir Tadic', position: 'captain', order: 1 },
    { id: 'crew-salt-2', name: 'Vesna Bozic', position: 'chef', order: 2 },
    { id: 'crew-salt-3', name: 'Andreas Mavros', position: 'deckhand', order: 3 },
  ],
};

const YACHTS: Array<{ ws: string } & SeedYacht> = [
  { ws: 'adriatic-sunline', slug: 'sunwake', name: 'Sunwake', base: 'split', cabins: 4, length: '18.29', beam: '9.04', draft: '1.55', battery: '280', hotel: '3.0', solar: '9.0', drag: '0.110', low: 1890000, shoulder: 2450000, high: 3290000 },
  { ws: 'adriatic-sunline', slug: 'halcyon-drift', name: 'Halcyon Drift', base: 'split', cabins: 6, length: '24.40', beam: '11.20', draft: '1.80', battery: '420', hotel: '4.5', solar: '14.0', drag: '0.160', low: 3150000, shoulder: 3980000, high: 5200000 },
  { ws: 'adriatic-sunline', slug: 'kelp-lantern', name: 'Kelp Lantern', base: 'lavrio', cabins: 4, length: '16.15', beam: '8.65', draft: '1.35', battery: '240', hotel: '2.5', solar: '8.0', drag: '0.095', low: 1450000, shoulder: 1890000, high: 2490000 },
  { ws: 'saronic-lightwater', slug: 'meltemi-glow', name: 'Meltemi Glow', base: 'lavrio', cabins: 5, length: '19.65', beam: '9.85', draft: '1.60', battery: '300', hotel: '3.2', solar: '10.0', drag: '0.120', low: 2100000, shoulder: 2750000, high: 3600000 },
  { ws: 'saronic-lightwater', slug: 'brightwater', name: 'Brightwater', base: 'split', cabins: 3, length: '14.95', beam: '7.95', draft: '1.20', battery: '200', hotel: '2.0', solar: '7.0', drag: '0.080', low: 1245000, shoulder: 1590000, high: 2150000 },
  { ws: 'saronic-lightwater', slug: 'salt-ember', name: 'Salt Ember', base: 'split', cabins: 5, length: '21.35', beam: '10.40', draft: '1.65', battery: '360', hotel: '4.0', solar: '12.0', drag: '0.140', low: 2600000, shoulder: 3300000, high: 4450000 },
];

const MEMBERS: Array<{ ws: string; id: string; name: string; email: string; role: string; yacht: string | null }> = [
  { ws: 'adriatic-sunline', id: 'member-mira', name: 'Mira Kovac', email: 'mira.kovac@adriatic-sunline.example', role: 'fleet_director', yacht: null },
  { ws: 'adriatic-sunline', id: 'member-luka', name: 'Luka Babic', email: 'luka.babic@adriatic-sunline.example', role: 'charter_manager', yacht: null },
  { ws: 'adriatic-sunline', id: 'member-ana', name: 'Ana Peric', email: 'ana.peric@adriatic-sunline.example', role: 'finance_lead', yacht: null },
  { ws: 'adriatic-sunline', id: 'member-ivo', name: 'Ivo Matic', email: 'ivo.matic@adriatic-sunline.example', role: 'captain', yacht: null },
  { ws: 'adriatic-sunline', id: 'member-nina', name: 'Nina Horvat', email: 'nina.horvat@adriatic-sunline.example', role: 'crew_member', yacht: 'sunwake' },
  { ws: 'saronic-lightwater', id: 'member-eleni', name: 'Eleni Papadaki', email: 'eleni.papadaki@saronic-lightwater.example', role: 'fleet_director', yacht: null },
  { ws: 'saronic-lightwater', id: 'member-nikos', name: 'Nikos Vlachos', email: 'nikos.vlachos@saronic-lightwater.example', role: 'charter_manager', yacht: null },
  { ws: 'saronic-lightwater', id: 'member-sofia', name: 'Sofia Andreou', email: 'sofia.andreou@saronic-lightwater.example', role: 'finance_lead', yacht: null },
  { ws: 'saronic-lightwater', id: 'member-yannis', name: 'Yannis Karras', email: 'yannis.karras@saronic-lightwater.example', role: 'captain', yacht: null },
  { ws: 'saronic-lightwater', id: 'member-dimitra', name: 'Dimitra Lekka', email: 'dimitra.lekka@saronic-lightwater.example', role: 'crew_member', yacht: 'meltemi-glow' },
];

const ANCHORAGES: Array<{ id: string; name: string; base: string; lat: string; lon: string; order: number }> = [
  { id: 'split-base', name: 'Split Marina', base: 'split', lat: '43.5040', lon: '16.4290', order: 1 },
  { id: 'solta-maslinica', name: 'Maslinica, Solta', base: 'split', lat: '43.3985', lon: '16.2060', order: 2 },
  { id: 'hvar-stari-grad', name: 'Stari Grad, Hvar', base: 'split', lat: '43.1855', lon: '16.5960', order: 3 },
  { id: 'pakleni-palmizana', name: 'Palmizana, Pakleni Islands', base: 'split', lat: '43.1620', lon: '16.3940', order: 4 },
  { id: 'vis-town', name: 'Vis Town', base: 'split', lat: '43.0615', lon: '16.1855', order: 5 },
  { id: 'brac-bol', name: 'Bol, Brac', base: 'split', lat: '43.2600', lon: '16.6550', order: 6 },
  { id: 'lavrio-base', name: 'Lavrio Marina', base: 'lavrio', lat: '37.7150', lon: '24.0580', order: 7 },
  { id: 'kea-vourkari', name: 'Vourkari, Kea', base: 'lavrio', lat: '37.6670', lon: '24.3230', order: 8 },
  { id: 'kythnos-kolona', name: 'Kolona, Kythnos', base: 'lavrio', lat: '37.4300', lon: '24.3950', order: 9 },
  { id: 'poros-town', name: 'Poros Town', base: 'lavrio', lat: '37.4985', lon: '23.4555', order: 10 },
  { id: 'aegina-port', name: 'Aegina Port', base: 'lavrio', lat: '37.7465', lon: '23.4275', order: 11 },
  { id: 'sounio-bay', name: 'Sounio Bay', base: 'lavrio', lat: '37.6520', lon: '24.0250', order: 12 },
];

interface MarinaSeed {
  id: string;
  name: string;
  base: string;
  berths: Array<[string, string, string, string]>;
  pontoons: Array<[string, number]>;
  tariffs: Array<[string, number]>;
}

const MARINAS: MarinaSeed[] = [
  {
    id: 'split-marina',
    name: 'Split Marina',
    base: 'split',
    berths: [
      ['A1', '15.00', '8.00', '3.00'],
      ['A2', '20.00', '10.00', '3.50'],
      ['A3', '25.00', '12.00', '4.00'],
      ['A4', '18.29', '9.04', '1.85'],
      ['A5', '18.29', '9.04', '1.84'],
      ['A6', '14.95', '7.95', '1.50'],
    ],
    pontoons: [
      ['C', 44],
      ['D', 22],
    ],
    tariffs: [
      ['2026-01-01', 450],
      ['2028-04-01', 520],
    ],
  },
  {
    id: 'lavrio-marina',
    name: 'Lavrio Marina',
    base: 'lavrio',
    berths: [
      ['B1', '17.00', '9.00', '3.00'],
      ['B2', '22.00', '11.00', '3.20'],
      ['B3', '16.15', '8.65', '1.65'],
      ['B4', '19.65', '9.85', '1.90'],
    ],
    pontoons: [['P', 22]],
    tariffs: [
      ['2026-01-01', 380],
      ['2028-04-01', 430],
    ],
  },
];

const STORE_ITEMS: Array<[string, string, string, number, number, number]> = [
  ['Still water', 'bottles', 'drinks', 48, 12, 0],
  ['Olive oil', 'litres', 'provisions', 10, 3, 0],
  ['Lemons', 'kg', 'provisions', 8, 2, 1],
  ['Deck cleaner', 'bottles', 'cleaning', 6, 1, 0],
];

const BROKERS: Array<{ ws: string; id: string; name: string; contact: string; email: string; notes: string }> = [
  { ws: 'adriatic-sunline', id: 'bluewake', name: 'Bluewake Brokers', contact: 'Hana Ostrova', email: 'desk@bluewake-brokers.example', notes: 'Commission 10%, pays within 14 days' },
  { ws: 'adriatic-sunline', id: 'cetina', name: 'Cetina Yacht Partners', contact: 'Rafael Oyelaran', email: 'charters@cetina-partners.example', notes: 'Commission 12%, prefers July weeks' },
  { ws: 'saronic-lightwater', id: 'aegean-keel', name: 'Aegean Keel Agency', contact: 'Clio Varga', email: 'hello@aegean-keel.example', notes: 'Commission 10%, Greek clients only' },
  { ws: 'saronic-lightwater', id: 'northstar', name: 'Northstar Charter Desk', contact: 'Bram Ellery', email: 'desk@northstar-charter.example', notes: 'Commission 11%, invoices quarterly' },
];

function id(prefix: string): string {
  return `${prefix}-${randomBytes(10).toString('base64url')}`;
}

export async function applySchemaAndSeed(client: Client): Promise<void> {
  await client.query(SCHEMA);
  const state = await client.query<{ seeded: boolean }>('SELECT seeded FROM seed_state WHERE id = 1');
  if (state.rows[0]?.seeded) return;
  const lock = await client.query(`SELECT pg_try_advisory_lock(918273645) AS ok`);
  if (!lock.rows[0].ok) return;
  try {
    const again = await client.query<{ seeded: boolean }>('SELECT seeded FROM seed_state WHERE id = 1');
    if (again.rows[0]?.seeded) return;
    const passwordHash = hashPassword('Sunlit-Tide-2027');
    for (const [slug, name] of [
      ['adriatic-sunline', 'Adriatic Sunline Charters'],
      ['saronic-lightwater', 'Saronic Lightwater Yachts'],
    ]) {
      await client.query('INSERT INTO workspaces (slug, name) VALUES ($1, $2) ON CONFLICT DO NOTHING', [slug, name]);
    }
    for (const m of MEMBERS) {
      await client.query(
        'INSERT INTO members (id, workspace_slug, name, email, password_hash, role, yacht_slug) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',
        [m.id, m.ws, m.name, m.email, passwordHash, m.role, m.yacht],
      );
    }
    let order = 0;
    for (const y of YACHTS) {
      order += 1;
      await client.query(
        'INSERT INTO yachts (slug, workspace_slug, name, base, status, cabins, length_m, beam_m, draft_m, battery_kwh, hotel_kw, solar_kw, drag_kw_per_kn_cubed, shore_power_kw, low_minor, shoulder_minor, high_minor, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) ON CONFLICT DO NOTHING',
        [y.slug, y.ws, y.name, y.base, 'on_sale', y.cabins, y.length, y.beam, y.draft, y.battery, y.hotel, y.solar, y.drag, 22, y.low, y.shoulder, y.high, order],
      );
    }
    for (const [slug, crew] of Object.entries(CREW)) {
      for (const c of crew) {
        await client.query('INSERT INTO crew (id, yacht_slug, name, position, sort_order) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [c.id, slug, c.name, c.position, c.order]);
      }
    }
    for (const ws of ['adriatic-sunline', 'saronic-lightwater']) {
      for (const a of ANCHORAGES) {
        await client.query('INSERT INTO anchorages (id, workspace_slug, name, base, latitude, longitude, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING', [a.id, ws, a.name, a.base, a.lat, a.lon, a.order]);
      }
      for (const marina of MARINAS) {
        await client.query('INSERT INTO marinas (id, workspace_slug, name, base) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [marina.id, ws, marina.name, marina.base]);
        for (const [code, l, w, d] of marina.berths) {
          await client.query('INSERT INTO berths (workspace_slug, marina_id, code, length_m, width_m, depth_m) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING', [ws, marina.id, code, l, w, d]);
        }
        for (const [code, kw] of marina.pontoons) {
          await client.query('INSERT INTO pontoons (workspace_slug, marina_id, code, limit_kw) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [ws, marina.id, code, kw]);
        }
        for (const [date, rate] of marina.tariffs) {
          await client.query("INSERT INTO marina_tariffs (id, marina_id, workspace_slug, effective_date, rate_per_metre_minor) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", [id('tariff'), marina.id, ws, date, rate]);
        }
      }
      await client.query('INSERT INTO exchange_tables (id, workspace_slug, effective_date, gbp, usd) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [id('ext'), ws, '2026-01-01', '0.8450', '1.0820']);
      await client.query('INSERT INTO exchange_tables (id, workspace_slug, effective_date, gbp, usd) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [id('ext'), ws, '2028-04-01', '0.8700', '1.1500']);
    }
    for (const y of YACHTS) {
      for (const [name, unit, category, received, used, spoiled] of STORE_ITEMS) {
        const itemId = id('store');
        await client.query('INSERT INTO store_items (id, workspace_slug, yacht_slug, name, unit, category) VALUES ($1,$2,$3,$4,$5,$6)', [itemId, y.ws, y.slug, name, unit, category]);
        if (received > 0) {
          await client.query('INSERT INTO store_movements (id, item_id, kind, quantity, logged_by, logged_at) VALUES ($1,$2,$3,$4,$5,$6)', [id('mov'), itemId, 'received', received, 'seed', new Date(0).toISOString()]);
        }
        if (used > 0) {
          await client.query('INSERT INTO store_movements (id, item_id, kind, quantity, logged_by, logged_at) VALUES ($1,$2,$3,$4,$5,$6)', [id('mov'), itemId, 'used', used, 'seed', new Date(0).toISOString()]);
        }
        if (spoiled > 0) {
          await client.query('INSERT INTO store_movements (id, item_id, kind, quantity, logged_by, logged_at) VALUES ($1,$2,$3,$4,$5,$6)', [id('mov'), itemId, 'spoiled', spoiled, 'seed', new Date(0).toISOString()]);
        }
      }
    }
    for (const b of BROKERS) {
      await client.query('INSERT INTO brokers (id, workspace_slug, name, contact_name, email, notes) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING', [b.id, b.ws, b.name, b.contact, b.email, b.notes]);
    }
    await client.query('UPDATE seed_state SET seeded = true WHERE id = 1');
  } finally {
    await client.query(`SELECT pg_advisory_unlock(918273645)`);
  }
}
