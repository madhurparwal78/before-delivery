import { PoolClient } from 'pg';
import { pool, query } from './db';
import { hashPassword } from './auth';

interface SeedDestination {
  code: string;
  name: string;
  zone: string;
  cx: number;
  cy: number;
  vat_pct: number;
  city_minor: number;
  levy_pct: number;
  policy: { days_before: number; hour: number; refund_pct: number }[];
}

interface SeedProperty {
  code: string;
  name: string;
  destination: string;
  x: number;
  y: number;
  stars: number;
  amenities: string[];
  dbl: [number, number];
  fam: [number, number];
  breakfast_minor: number;
}

export const BASE_DESTINATIONS: SeedDestination[] = [
  {
    code: 'harrowmere',
    name: 'Harrowmere Bay',
    zone: 'Europe/Lisbon',
    cx: 300,
    cy: 400,
    vat_pct: 6,
    city_minor: 200,
    levy_pct: 10,
    policy: [
      { days_before: 3, hour: 18, refund_pct: 100 },
      { days_before: 1, hour: 18, refund_pct: 50 },
    ],
  },
  {
    code: 'vellicombe',
    name: 'Vellicombe Heights',
    zone: 'Europe/Berlin',
    cx: 650,
    cy: 250,
    vat_pct: 7,
    city_minor: 300,
    levy_pct: 10,
    policy: [
      { days_before: 7, hour: 12, refund_pct: 100 },
      { days_before: 2, hour: 12, refund_pct: 30 },
    ],
  },
  {
    code: 'qasrayn',
    name: 'Qasr Ayn Oasis',
    zone: 'Asia/Kuwait',
    cx: 700,
    cy: 750,
    vat_pct: 5,
    city_minor: 400,
    levy_pct: 5,
    policy: [{ days_before: 1, hour: 14, refund_pct: 100 }],
  },
];

export const BASE_PROPERTIES: SeedProperty[] = [
  { code: 'HRB-QUAY', name: 'Quayside Lantern House', destination: 'harrowmere', x: 306, y: 404, stars: 4, amenities: ['wifi', 'parking'], dbl: [12000, 15000], fam: [18000, 21000], breakfast_minor: 1200 },
  { code: 'HRB-GULL', name: 'The Gullrest Inn', destination: 'harrowmere', x: 290, y: 395, stars: 3, amenities: ['wifi', 'pets'], dbl: [8500, 9900], fam: [13000, 15000], breakfast_minor: 900 },
  { code: 'HRB-NETT', name: "Netmender's Rooms", destination: 'harrowmere', x: 312, y: 410, stars: 3, amenities: ['wifi'], dbl: [7900, 8900], fam: [12500, 14000], breakfast_minor: 800 },
  { code: 'HRB-TIDE', name: 'Tidewrack Hotel', destination: 'harrowmere', x: 320, y: 380, stars: 5, amenities: ['pool', 'spa', 'wifi', 'parking'], dbl: [21000, 26000], fam: [30000, 36000], breakfast_minor: 1800 },
  { code: 'HRB-SALT', name: 'Saltgrass Guesthouse', destination: 'harrowmere', x: 280, y: 420, stars: 4, amenities: ['wifi', 'pets', 'parking'], dbl: [11000, 12500], fam: [16500, 18500], breakfast_minor: 1000 },
  { code: 'HRB-BEAC', name: 'Beaconfold Lodge', destination: 'harrowmere', x: 340, y: 430, stars: 4, amenities: ['pool', 'wifi'], dbl: [13500, 16000], fam: [19500, 23000], breakfast_minor: 1100 },
  { code: 'HRB-OYST', name: 'Oyster Lane Rooms', destination: 'harrowmere', x: 296, y: 412, stars: 3, amenities: ['wifi'], dbl: [7200, 8400], fam: [11500, 13000], breakfast_minor: 800 },
  { code: 'VLC-PINE', name: 'Pinecrest Hall', destination: 'vellicombe', x: 655, y: 245, stars: 4, amenities: ['spa', 'wifi', 'parking'], dbl: [14000, 17000], fam: [20000, 24000], breakfast_minor: 1300 },
  { code: 'VLC-LARK', name: 'Larkspur Chalet', destination: 'vellicombe', x: 640, y: 262, stars: 3, amenities: ['pets', 'wifi'], dbl: [9000, 10500], fam: [14000, 16000], breakfast_minor: 1000 },
  { code: 'VLC-FERN', name: 'Fernhollow House', destination: 'vellicombe', x: 668, y: 238, stars: 5, amenities: ['pool', 'spa'], dbl: [24000, 29000], fam: [33000, 39000], breakfast_minor: 2000 },
  { code: 'QSA-PALM', name: 'Palmshade Courtyard', destination: 'qasrayn', x: 705, y: 748, stars: 4, amenities: ['pool', 'wifi'], dbl: [15000, 16500], fam: [22000, 24000], breakfast_minor: 1200 },
  { code: 'QSA-DUNE', name: 'Dunewatch Rooms', destination: 'qasrayn', x: 690, y: 760, stars: 3, amenities: ['parking', 'wifi'], dbl: [8000, 8800], fam: [12500, 13500], breakfast_minor: 700 },
];

const BASE_USERS: { username: string; password: string; role: string; manages: string[] }[] = [
  { username: 'founder', password: 'kipwell-founder-01', role: 'operator', manages: [] },
  { username: 'mara', password: 'kipwell-mara-01', role: 'manager', manages: ['HRB-QUAY', 'HRB-GULL'] },
  { username: 'tomas', password: 'kipwell-tomas-01', role: 'manager', manages: ['VLC-PINE'] },
  { username: 'ada', password: 'kipwell-ada-01', role: 'guest', manages: [] },
];

export const NIGHTS_FROM = '2026-01-01';
export const NIGHTS_TO = '2028-12-31';

export const BASE_CURRENCY = { EUR: 1000000, USD: 1080000, JPY: 161500000, KWD: 332000 };

/** Inserts nights for a room type, with a weekend rate on Friday and Saturday. */
export async function insertNights(
  client: PoolClient,
  roomType: string,
  from: string,
  to: string,
  weekdayRate: number,
  weekendRate: number,
  rooms: number,
): Promise<void> {
  await client.query(
    `insert into nights (room_type, date, base_rate_minor, allotment, min_stay, max_stay,
       closed_to_arrival, closed_to_departure, stop_sell, release_days)
     select $1, d::date,
       case when extract(dow from d) in (5, 6) then $5::int else $4::int end,
       $6::int, 1, 30, false, false, false, 0
     from generate_series($2::date, $3::date, interval '1 day') as d
     on conflict (room_type, date) do nothing`,
    [roomType, from, to, weekdayRate, weekendRate, rooms],
  );
}

export async function ensureBaseSeed(): Promise<void> {
  const present = await query('select 1 from settings where key = $1', ['base_seed']);
  if (present.length > 0) return;
  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const d of BASE_DESTINATIONS) {
      await client.query(
        `insert into destinations (code, name, zone, cx, cy, vat_pct, city_minor, levy_pct, policy)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (code) do nothing`,
        [d.code, d.name, d.zone, d.cx, d.cy, d.vat_pct, d.city_minor, d.levy_pct, JSON.stringify(d.policy)],
      );
    }
    for (const p of BASE_PROPERTIES) {
      const dest = BASE_DESTINATIONS.find((d) => d.code === p.destination)!;
      await client.query(
        `insert into properties (code, name, destination, x, y, stars, amenities, zone, vat_pct,
           city_minor, levy_pct, breakfast_minor, single_pct, policy)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) on conflict (code) do nothing`,
        [
          p.code,
          p.name,
          p.destination,
          p.x,
          p.y,
          p.stars,
          p.amenities,
          dest.zone,
          dest.vat_pct,
          dest.city_minor,
          dest.levy_pct,
          p.breakfast_minor,
          10,
          JSON.stringify(dest.policy),
        ],
      );
      const types: { code: string; name: string; max_adults: number; max_guests: number; rooms: number; rates: [number, number] }[] = [
        { code: `${p.code}-DBL`, name: 'Double', max_adults: 2, max_guests: 3, rooms: 5, rates: p.dbl },
        { code: `${p.code}-FAM`, name: 'Family', max_adults: 4, max_guests: 5, rooms: 2, rates: p.fam },
      ];
      for (const t of types) {
        await client.query(
          `insert into room_types (code, property, name, included_adults, max_adults, max_guests,
             extra_adult_minor, child_minor, rooms, base_rate_minor)
           values ($1,$2,$3,2,$4,$5,2500,1500,$6,$7) on conflict (code) do nothing`,
          [t.code, p.code, t.name, t.max_adults, t.max_guests, t.rooms, t.rates[0]],
        );
        await insertNights(client, t.code, NIGHTS_FROM, NIGHTS_TO, t.rates[0], t.rates[1], t.rooms);
      }
    }
    for (const u of BASE_USERS) {
      await client.query(
        `insert into users (username, password, role) values ($1,$2,$3) on conflict (username) do nothing`,
        [u.username, hashPassword(u.password), u.role],
      );
      for (const code of u.manages) {
        await client.query(`insert into manages (username, property) values ($1,$2) on conflict do nothing`, [
          u.username,
          code,
        ]);
      }
    }
    await client.query(`insert into settings (key, value) values ('currency', $1) on conflict (key) do nothing`, [
      JSON.stringify(BASE_CURRENCY),
    ]);
    await client.query(`insert into settings (key, value) values ('clock_offset_ms', '0') on conflict (key) do nothing`);
    await client.query(`insert into settings (key, value) values ('base_seed', '1')`);
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}
