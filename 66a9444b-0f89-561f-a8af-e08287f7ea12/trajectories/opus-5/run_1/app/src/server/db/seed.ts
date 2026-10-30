import { hashPassword, newId } from '../lib/codes.js';
import { resolveLocalTime } from '../lib/time.js';
import { one, pool, type Queryable } from './pool.js';

const SEED_PASSWORD = 'kerf-festival-2027';

const VENUES: ReadonlyArray<readonly [string, string]> = [
  ['remise-noord', 'Remise Noord (disused tram depot)'],
  ['planetarium-dome', 'Planetarium Dome'],
  ['lab-hoogstraat', 'Lab Hoogstraat (university lab)'],
  ['black-box-kanaal', 'Black Box Kanaal'],
  ['riverside-pavilion', 'Riverside Pavilion'],
];

const DISCIPLINES: ReadonlyArray<readonly [string, string]> = [
  ['sound', 'Sound'],
  ['light', 'Light'],
  ['performance', 'Performance'],
  ['moving-image', 'Moving image'],
  ['code', 'Code'],
];

interface SeedUser {
  email: string;
  name: string;
  role: string;
  organisationId: string | null;
}

const USERS: readonly SeedUser[] = [
  { email: 'admin@kerf.example', name: 'Ines Vandeput', role: 'admin', organisationId: null },
  { email: 'curator@kerf.example', name: 'Bram Okafor', role: 'curator', organisationId: null },
  { email: 'curator2@kerf.example', name: 'Lotte Riss', role: 'curator', organisationId: null },
  { email: 'boxoffice@kerf.example', name: 'Sami Haddad', role: 'box_office', organisationId: null },
  { email: 'finance@kerf.example', name: 'Elif Marchal', role: 'finance', organisationId: null },
  { email: 'artist@kerf.example', name: 'Yara Delcour', role: 'artist', organisationId: null },
  { email: 'artist2@kerf.example', name: 'Tom Achterberg', role: 'artist', organisationId: null },
  { email: 'mira@visitors.example', name: 'Mira Janssens', role: 'visitor', organisationId: null },
  { email: 'jonas@visitors.example', name: 'Jonas Peeters', role: 'visitor', organisationId: null },
  {
    email: 'bookings@vierwinden.example',
    name: 'Hanne De Wit',
    role: 'group_booker',
    organisationId: 'vierwinden',
  },
  {
    email: 'bookings@quai-lumiere.example',
    name: 'Karim Lambrecht',
    role: 'group_booker',
    organisationId: 'quai-lumiere',
  },
];

interface SeedSession {
  id: string;
  title: string;
  discipline: string;
  venueId: string;
  admission: 'pass' | 'seat';
  capacity: number | null;
  priceFull: number | null;
  priceReduced: number | null;
  startsLocal: string;
  endsLocal: string;
  status: string;
}

const SESSIONS: readonly SeedSession[] = [
  {
    id: 'feedback-gardens',
    title: 'Feedback Gardens',
    discipline: 'sound',
    venueId: 'lab-hoogstraat',
    admission: 'seat',
    capacity: 12,
    priceFull: 1800,
    priceReduced: 1000,
    startsLocal: '2027-10-29T14:00+02:00',
    endsLocal: '2027-10-29T16:30+02:00',
    status: 'published',
  },
  {
    id: 'shader-sketching',
    title: 'Shader Sketching',
    discipline: 'code',
    venueId: 'lab-hoogstraat',
    admission: 'seat',
    capacity: 12,
    priceFull: 1800,
    priceReduced: 1000,
    startsLocal: '2027-10-30T11:00+02:00',
    endsLocal: '2027-10-30T13:00+02:00',
    status: 'published',
  },
  {
    id: 'signal-bodies',
    title: 'Signal Bodies',
    discipline: 'performance',
    venueId: 'black-box-kanaal',
    admission: 'seat',
    capacity: 60,
    priceFull: 1200,
    priceReduced: 700,
    startsLocal: '2027-10-29T20:00+02:00',
    endsLocal: '2027-10-29T21:00+02:00',
    status: 'published',
  },
  {
    id: 'delta-choir',
    title: 'Delta Choir',
    discipline: 'sound',
    venueId: 'riverside-pavilion',
    admission: 'pass',
    capacity: null,
    priceFull: null,
    priceReduced: null,
    startsLocal: '2027-10-29T20:30+02:00',
    endsLocal: '2027-10-29T21:30+02:00',
    status: 'published',
  },
  {
    id: 'orbit-index',
    title: 'Orbit Index',
    discipline: 'moving-image',
    venueId: 'planetarium-dome',
    admission: 'pass',
    capacity: null,
    priceFull: null,
    priceReduced: null,
    startsLocal: '2027-10-28T21:00+02:00',
    endsLocal: '2027-10-28T21:45+02:00',
    status: 'published',
  },
  {
    id: 'lumen-drift',
    title: 'Lumen Drift',
    discipline: 'light',
    venueId: 'remise-noord',
    admission: 'pass',
    capacity: null,
    priceFull: null,
    priceReduced: null,
    startsLocal: '2027-10-28T18:00+02:00',
    endsLocal: '2027-10-28T23:00+02:00',
    status: 'published',
  },
  {
    id: 'nachtstroom',
    title: 'Nachtstroom',
    discipline: 'sound',
    venueId: 'remise-noord',
    admission: 'pass',
    capacity: null,
    priceFull: null,
    priceReduced: null,
    startsLocal: '2027-10-31T01:30+02:00',
    endsLocal: '2027-10-31T02:30+02:00',
    status: 'published',
  },
  {
    id: 'second-hour-summer',
    title: 'The Second Hour (first pass)',
    discipline: 'light',
    venueId: 'riverside-pavilion',
    admission: 'pass',
    capacity: null,
    priceFull: null,
    priceReduced: null,
    startsLocal: '2027-10-31T02:15+02:00',
    endsLocal: '2027-10-31T02:45+02:00',
    status: 'published',
  },
  {
    id: 'second-hour-winter',
    title: 'The Second Hour (second pass)',
    discipline: 'light',
    venueId: 'black-box-kanaal',
    admission: 'pass',
    capacity: null,
    priceFull: null,
    priceReduced: null,
    startsLocal: '2027-10-31T02:15+01:00',
    endsLocal: '2027-10-31T02:45+01:00',
    status: 'published',
  },
  {
    id: 'dawn-patch',
    title: 'Dawn Patch',
    discipline: 'code',
    venueId: 'riverside-pavilion',
    admission: 'pass',
    capacity: null,
    priceFull: null,
    priceReduced: null,
    startsLocal: '2027-10-31T06:00+01:00',
    endsLocal: '2027-10-31T07:00+01:00',
    status: 'published',
  },
  {
    id: 'residency-showing',
    title: 'Untitled residency showing',
    discipline: 'performance',
    venueId: 'black-box-kanaal',
    admission: 'pass',
    capacity: null,
    priceFull: null,
    priceReduced: null,
    startsLocal: '2027-10-30T16:00+02:00',
    endsLocal: '2027-10-30T17:00+02:00',
    status: 'draft',
  },
];

interface SeedEntry {
  id: string;
  title: string;
  artistEmail: string;
  discipline: string;
  status: string;
}

const ENTRIES: readonly SeedEntry[] = [
  {
    id: 'e-tidal-mesh',
    title: 'Tidal Mesh',
    artistEmail: 'artist@kerf.example',
    discipline: 'light',
    status: 'published',
  },
  {
    id: 'e-quiet-servo',
    title: 'Quiet Servo',
    artistEmail: 'artist2@kerf.example',
    discipline: 'code',
    status: 'published',
  },
  {
    id: 'e-rust-chorus',
    title: 'Rust Chorus',
    artistEmail: 'artist@kerf.example',
    discipline: 'sound',
    status: 'published',
  },
  {
    id: 'e-slow-orbit',
    title: 'Slow Orbit',
    artistEmail: 'artist2@kerf.example',
    discipline: 'moving-image',
    status: 'published',
  },
  {
    id: 'e-wet-signal',
    title: 'Wet Signal',
    artistEmail: 'artist@kerf.example',
    discipline: 'performance',
    status: 'published',
  },
  {
    id: 'e-salt-print',
    title: 'Salt Print',
    artistEmail: 'artist@kerf.example',
    discipline: 'light',
    status: 'review',
  },
  {
    id: 'e-ghost-loop',
    title: 'Ghost Loop',
    artistEmail: 'artist2@kerf.example',
    discipline: 'code',
    status: 'draft',
  },
];

const VOUCHERS: ReadonlyArray<readonly [string, number]> = [
  ['KERF-GIFT-A1', 4000],
  ['KERF-GIFT-B2', 2500],
];

function instantOf(local: string): Date {
  const resolved = resolveLocalTime(local);
  if (typeof resolved === 'string') throw new Error(`bad seed time ${local}`);
  return resolved.instant;
}

export async function applySeed(): Promise<void> {
  const db: Queryable = pool;

  await db.query(
    `INSERT INTO edition (id, name, first_day, last_day) VALUES (1, $1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    ['Kerf Frequencies 2027', '2027-10-28', '2027-10-31'],
  );

  for (const [index, [id, name]] of VENUES.entries()) {
    await db.query(
      `INSERT INTO venues (id, name, position) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [id, name, index],
    );
  }

  for (const [index, [id, name]] of DISCIPLINES.entries()) {
    await db.query(
      `INSERT INTO disciplines (id, name, position) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [id, name, index],
    );
  }

  await db.query(
    `INSERT INTO price_policy (id, full_festival_full_cents, full_festival_reduced_cents,
       day_full_cents, day_reduced_cents, group_discount_percent, version)
     VALUES (1, 9500, 5500, 3500, 2000, 15, 1) ON CONFLICT (id) DO NOTHING`,
  );

  for (const [id, name] of [
    ['vierwinden', 'Atheneum Vierwinden'],
    ['quai-lumiere', 'École Quai-Lumière'],
  ] as ReadonlyArray<readonly [string, string]>) {
    await db.query(
      `INSERT INTO organisations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
      [id, name],
    );
  }

  for (const user of USERS) {
    await db.query(
      `INSERT INTO users (id, email, name, password_hash, role, organisation_id)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (email) DO NOTHING`,
      [newId(), user.email, user.name, hashPassword(SEED_PASSWORD), user.role, user.organisationId],
    );
  }

  for (const session of SESSIONS) {
    const inserted = await one<{ id: string }>(
      db,
      `INSERT INTO programme_sessions (id, title, description, discipline, venue_id, admission,
         capacity, price_full_cents, price_reduced_cents, starts_at, ends_at, status, version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 1)
       ON CONFLICT (id) DO NOTHING RETURNING id`,
      [
        session.id,
        session.title,
        `${session.title} at ${session.venueId}.`,
        session.discipline,
        session.venueId,
        session.admission,
        session.capacity,
        session.priceFull,
        session.priceReduced,
        instantOf(session.startsLocal),
        instantOf(session.endsLocal),
        session.status,
      ],
    );
    if (inserted !== null) {
      await db.query(
        `INSERT INTO session_history (id, session_id, from_state, to_state, at, actor)
         VALUES ($1, $2, NULL, $3, now(), 'system')`,
        [newId(), session.id, session.status],
      );
    }
  }

  for (const entry of ENTRIES) {
    const artist = await one<{ id: string }>(db, `SELECT id FROM users WHERE email = $1`, [
      entry.artistEmail,
    ]);
    if (artist === null) continue;
    const inserted = await one<{ id: string }>(
      db,
      `INSERT INTO entries (id, artist_id, title, statement, discipline, medium, year, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING RETURNING id`,
      [
        entry.id,
        artist.id,
        entry.title,
        `${entry.title} is a work for Kerf Frequencies 2027.`,
        entry.discipline,
        'Mixed media',
        '2027',
        entry.status,
      ],
    );
    if (inserted !== null) {
      await db.query(
        `INSERT INTO entry_history (id, entry_id, from_state, to_state, at, actor)
         VALUES ($1, $2, NULL, $3, now(), 'system')`,
        [newId(), entry.id, entry.status],
      );
    }
  }

  const financeEmail = 'finance@kerf.example';
  for (const [code, amount] of VOUCHERS) {
    const inserted = await one<{ code: string }>(
      db,
      `INSERT INTO vouchers (code, note) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING RETURNING code`,
      [code, 'Seeded gift voucher'],
    );
    if (inserted === null) continue;
    const movementId = newId();
    await db.query(
      `INSERT INTO ledger_movements (id, kind, amount_cents, actor, order_ref, voucher_code)
       VALUES ($1, 'issue', $2, $3, NULL, $4)`,
      [movementId, amount, financeEmail, code],
    );
    await db.query(
      `INSERT INTO ledger_entries (id, movement_id, account, side, amount_cents)
       VALUES ($1, $2, 'voucher-sales', 'debit', $3), ($4, $2, $5, 'credit', $3)`,
      [newId(), movementId, amount, newId(), `voucher:${code}`],
    );
  }
}
