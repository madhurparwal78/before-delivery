import type { PoolClient } from 'pg'
import type { PolicyTier } from '../shared/types'
import { hashPassword } from './auth'
import { withSeedLock } from './db'
import { DEFAULT_RATES } from './quotes'

interface BaseDestination { code: string; name: string; zone: string; cx: number; cy: number; vat: number; city: number; levy: number; policy: PolicyTier[] }

const DESTINATIONS: BaseDestination[] = [
  { code: 'harrowmere', name: 'Harrowmere Bay', zone: 'Europe/Lisbon', cx: 300, cy: 400, vat: 6, city: 200, levy: 10, policy: [{ days_before: 3, hour: 18, refund_pct: 100 }, { days_before: 1, hour: 18, refund_pct: 50 }] },
  { code: 'vellicombe', name: 'Vellicombe Heights', zone: 'Europe/Berlin', cx: 650, cy: 250, vat: 7, city: 300, levy: 10, policy: [{ days_before: 7, hour: 12, refund_pct: 100 }, { days_before: 2, hour: 12, refund_pct: 30 }] },
  { code: 'qasrayn', name: 'Qasr Ayn Oasis', zone: 'Asia/Kuwait', cx: 700, cy: 750, vat: 5, city: 400, levy: 5, policy: [{ days_before: 1, hour: 14, refund_pct: 100 }] },
]

type Row = [code: string, name: string, dest: string, x: number, y: number, stars: number, amenities: string[], dbl: [number, number], fam: [number, number], breakfast: number]

const PROPERTIES: Row[] = [
  ['HRB-QUAY', 'Quayside Lantern House', 'harrowmere', 306, 404, 4, ['wifi', 'parking'], [12000, 15000], [18000, 21000], 1200],
  ['HRB-GULL', 'The Gullrest Inn', 'harrowmere', 290, 395, 3, ['wifi', 'pets'], [8500, 9900], [13000, 15000], 900],
  ['HRB-NETT', "Netmender's Rooms", 'harrowmere', 312, 410, 3, ['wifi'], [7900, 8900], [12500, 14000], 800],
  ['HRB-TIDE', 'Tidewrack Hotel', 'harrowmere', 320, 380, 5, ['pool', 'spa', 'wifi', 'parking'], [21000, 26000], [30000, 36000], 1800],
  ['HRB-SALT', 'Saltgrass Guesthouse', 'harrowmere', 280, 420, 4, ['wifi', 'pets', 'parking'], [11000, 12500], [16500, 18500], 1000],
  ['HRB-BEAC', 'Beaconfold Lodge', 'harrowmere', 340, 430, 4, ['pool', 'wifi'], [13500, 16000], [19500, 23000], 1100],
  ['HRB-OYST', 'Oyster Lane Rooms', 'harrowmere', 296, 412, 3, ['wifi'], [7200, 8400], [11500, 13000], 800],
  ['VLC-PINE', 'Pinecrest Hall', 'vellicombe', 655, 245, 4, ['spa', 'wifi', 'parking'], [14000, 17000], [20000, 24000], 1300],
  ['VLC-LARK', 'Larkspur Chalet', 'vellicombe', 640, 262, 3, ['pets', 'wifi'], [9000, 10500], [14000, 16000], 1000],
  ['VLC-FERN', 'Fernhollow House', 'vellicombe', 668, 238, 5, ['pool', 'spa'], [24000, 29000], [33000, 39000], 2000],
  ['QSA-PALM', 'Palmshade Courtyard', 'qasrayn', 705, 748, 4, ['pool', 'wifi'], [15000, 16500], [22000, 24000], 1200],
  ['QSA-DUNE', 'Dunewatch Rooms', 'qasrayn', 690, 760, 3, ['parking', 'wifi'], [8000, 8800], [12500, 13500], 700],
]

const SEED_FROM = '2026-01-01'
const SEED_TO = '2028-12-31'

/** Creates a room type's nights over the seeded range; Fri and Sat nights take the weekend rate when one is given. */
export async function seedNights(db: PoolClient, roomType: string, weekday: number, weekend: number, rooms: number): Promise<void> {
  await db.query(
    `INSERT INTO nights (room_type, date, rate_minor, allotment, min_stay, max_stay, closed_to_arrival, closed_to_departure, stop_sell, release_days)
     SELECT $1, d::date, CASE WHEN extract(isodow FROM d) IN (5, 6) THEN $3::int ELSE $2::int END, $4::int, 1, 30, false, false, false, 0
       FROM generate_series($5::date, $6::date, interval '1 day') d
     ON CONFLICT DO NOTHING`,
    [roomType, weekday, weekend, rooms, SEED_FROM, SEED_TO],
  )
}

export async function baseSeed(): Promise<string[]> {
  return withSeedLock(async (client) => {
    await client.query('BEGIN')
    try {
      for (const d of DESTINATIONS) {
        await client.query(`INSERT INTO destinations (code, name, zone, cx, cy) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [d.code, d.name, d.zone, d.cx, d.cy])
      }
      for (const [code, name, dest, x, y, stars, amenities, dbl, fam, breakfast] of PROPERTIES) {
        const d = DESTINATIONS.find((candidate) => candidate.code === dest) as BaseDestination
        await client.query(
          `INSERT INTO properties (code, name, destination, x, y, stars, amenities, policy, vat_pct, city_minor, levy_pct, breakfast_minor, single_pct)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,10) ON CONFLICT DO NOTHING`,
          [code, name, dest, x, y, stars, amenities, JSON.stringify(d.policy), d.vat, d.city, d.levy, breakfast],
        )
        for (const [suffix, label, included, maxAdults, maxGuests, rooms, rates] of [
          ['DBL', 'Double', 2, 2, 3, 5, dbl], ['FAM', 'Family', 2, 4, 5, 2, fam],
        ] as const) {
          await client.query(
            `INSERT INTO room_types (code, property, name, included_adults, max_adults, max_guests, extra_adult_minor, child_minor, rooms, base_rate_minor)
             VALUES ($1,$2,$3,$4,$5,$6,2500,1500,$7,$8) ON CONFLICT DO NOTHING`,
            [`${code}-${suffix}`, code, label, included, maxAdults, maxGuests, rooms, rates[0]],
          )
          await seedNights(client, `${code}-${suffix}`, rates[0], rates[1], rooms)
        }
      }
      const users: [string, string, string, string[]][] = [
        ['founder', 'kipwell-founder-01', 'operator', []], ['mara', 'kipwell-mara-01', 'manager', ['HRB-QUAY', 'HRB-GULL']],
        ['tomas', 'kipwell-tomas-01', 'manager', ['VLC-PINE']], ['ada', 'kipwell-ada-01', 'guest', []],
      ]
      for (const [username, password, role, manages] of users) {
        const created = await client.query(`INSERT INTO users (username, password_hash, role) VALUES ($1,$2,$3) ON CONFLICT (username) DO NOTHING RETURNING id`, [username, hashPassword(password), role])
        for (const property of manages) if (created.rows[0]) await client.query(`INSERT INTO manages (user_id, property) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [created.rows[0].id, property])
      }
      await client.query(`INSERT INTO settings (key, value) VALUES ('currency', $1) ON CONFLICT DO NOTHING`, [JSON.stringify(DEFAULT_RATES)])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    }
    return PROPERTIES.map((row) => row[0])
  })
}

