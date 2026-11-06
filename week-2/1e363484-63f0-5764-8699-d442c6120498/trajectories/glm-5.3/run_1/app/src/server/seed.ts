import type { Client } from 'pg'
import { hashSync } from 'bcryptjs'

/**
 * Idempotent seed. Runs under the seed advisory lock, so two instances
 * starting at once apply it exactly once.
 */

function rect(x1: number, y1: number, x2: number, y2: number): [number, number][] {
  return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]
}

type SeedPerson = { id: string; name: string; email: string; org_role: 'admin' | 'steward' | 'member' }
const PEOPLE: SeedPerson[] = [
  { id: 'p-ines', name: 'Ines Okafor', email: 'ines@levelmoor.example', org_role: 'admin' },
  { id: 'p-priya', name: 'Priya Nand', email: 'priya@levelmoor.example', org_role: 'steward' },
  { id: 'p-tomas', name: 'Tomas Reyes', email: 'tomas@levelmoor.example', org_role: 'member' },
  { id: 'p-hal', name: 'Hal Brennan', email: 'hal@levelmoor.example', org_role: 'member' },
  { id: 'p-odile', name: 'Odile Marsh', email: 'odile@levelmoor.example', org_role: 'member' },
  { id: 'p-wren', name: 'Wren Adeyemi', email: 'wren@levelmoor.example', org_role: 'member' },
]
const PASSWORD = 'moss-and-tower-26'

type SeedProject = {
  slug: string; name: string; kind: string; code: string
  floor_pct: string; buffer_pct: string; lead: string
  boundary: [number, number][]; sensors: { id: string; kind: 'tower' | 'satellite'; polygon: [number, number][] }[]
}
const PROJECTS: SeedProject[] = [
  {
    slug: 'blackmere-moss', name: 'Blackmere Moss', kind: 'peatland rewetting', code: 'BM',
    floor_pct: '60.0', buffer_pct: '15.0', lead: 'p-hal',
    boundary: rect(0, 0, 1000, 600),
    sensors: [
      { id: 'BM-T1', kind: 'tower', polygon: rect(100, 100, 500, 500) },
      { id: 'BM-T2', kind: 'tower', polygon: rect(400, 200, 800, 500) },
      { id: 'BM-S1', kind: 'satellite', polygon: rect(0, 0, 500, 300) },
      { id: 'BM-S2', kind: 'satellite', polygon: rect(500, 0, 1000, 300) },
      { id: 'BM-S3', kind: 'satellite', polygon: rect(0, 300, 500, 600) },
      { id: 'BM-S4', kind: 'satellite', polygon: rect(500, 300, 1000, 600) },
    ],
  },
  {
    slug: 'saltings-reach', name: 'Saltings Reach', kind: 'wetland restoration', code: 'SR',
    floor_pct: '50.0', buffer_pct: '10.0', lead: 'p-hal',
    boundary: rect(0, 0, 800, 500),
    sensors: [
      { id: 'SR-T1', kind: 'tower', polygon: rect(200, 100, 600, 400) },
      { id: 'SR-S1', kind: 'satellite', polygon: rect(0, 0, 400, 500) },
      { id: 'SR-S2', kind: 'satellite', polygon: rect(400, 0, 800, 500) },
    ],
  },
  {
    slug: 'hollin-wood', name: 'Hollin Wood', kind: 'managed forest', code: 'HW',
    floor_pct: '70.0', buffer_pct: '20.0', lead: 'p-hal',
    boundary: rect(0, 0, 400, 400),
    sensors: [
      { id: 'HW-T1', kind: 'tower', polygon: rect(0, 0, 400, 300) },
      { id: 'HW-S1', kind: 'satellite', polygon: rect(0, 0, 400, 400) },
    ],
  },
]

const GRANTS: { person_id: string; project: string; role: 'viewer' | 'analyst' | 'sealer' }[] = [
  { person_id: 'p-priya', project: 'blackmere-moss', role: 'viewer' },
  { person_id: 'p-priya', project: 'saltings-reach', role: 'viewer' },
  { person_id: 'p-priya', project: 'hollin-wood', role: 'viewer' },
  { person_id: 'p-tomas', project: 'blackmere-moss', role: 'sealer' },
  { person_id: 'p-tomas', project: 'saltings-reach', role: 'analyst' },
  { person_id: 'p-hal', project: 'blackmere-moss', role: 'sealer' },
  { person_id: 'p-hal', project: 'saltings-reach', role: 'sealer' },
  { person_id: 'p-hal', project: 'hollin-wood', role: 'sealer' },
  { person_id: 'p-odile', project: 'blackmere-moss', role: 'analyst' },
  { person_id: 'p-wren', project: 'blackmere-moss', role: 'viewer' },
]

function halfHourStamps(from: string, toInclusive: string): string[] {
  const out: string[] = []
  let t = new Date(from).getTime()
  const end = new Date(toInclusive).getTime()
  while (t <= end) {
    out.push(new Date(t).toISOString().replace('.000Z', 'Z'))
    t += 1800000
  }
  return out
}

type SeedReading = { project: string; sensor_id: string; interval_start: string; fc: string; fch4: string; qc: number }

function blackmereReadings(): SeedReading[] {
  const out: SeedReading[] = []
  for (const ts of halfHourStamps('2026-06-01T00:00:00Z', '2026-06-14T23:30:00Z')) {
    const hour = Number(ts.slice(11, 13))
    const daytime = hour >= 6 && hour <= 17
    out.push({ project: 'blackmere-moss', sensor_id: 'BM-T1', interval_start: ts, fc: daytime ? '-3.0000' : '1.5000', fch4: '15.0000', qc: 0 })
    out.push({ project: 'blackmere-moss', sensor_id: 'BM-T2', interval_start: ts, fc: daytime ? '-2.0000' : '1.0000', fch4: '30.0000', qc: 0 })
  }
  for (const ts of halfHourStamps('2026-06-03T00:00:00Z', '2026-06-14T23:30:00Z')) {
    const qc4 = ts >= '2026-06-08T00:00:00Z' ? 3 : 0
    for (const s of ['BM-S1', 'BM-S2', 'BM-S3', 'BM-S4']) {
      out.push({ project: 'blackmere-moss', sensor_id: s, interval_start: ts, fc: '-1.0000', fch4: '10.0000', qc: s === 'BM-S4' ? qc4 : 0 })
    }
  }
  return out
}

function saltingsReadings(): SeedReading[] {
  const out: SeedReading[] = []
  for (const ts of halfHourStamps('2026-06-01T00:00:00Z', '2026-06-14T23:30:00Z')) {
    out.push({ project: 'saltings-reach', sensor_id: 'SR-T1', interval_start: ts, fc: '-1.5000', fch4: '40.0000', qc: 0 })
    out.push({ project: 'saltings-reach', sensor_id: 'SR-S1', interval_start: ts, fc: '-0.5000', fch4: '25.0000', qc: 0 })
    out.push({ project: 'saltings-reach', sensor_id: 'SR-S2', interval_start: ts, fc: '-0.5000', fch4: '25.0000', qc: 0 })
  }
  return out
}

export async function seed(client: Client): Promise<void> {
  await client.query('SELECT pg_advisory_lock(97002)')
  try {
    const done = await client.query<{ value: string }>(
      "SELECT value FROM seed_state WHERE key = 'seeded'")
    if (done.rowCount && done.rows[0]!.value === 'v1') return

    const pwHash = hashSync(PASSWORD, 10)
    for (const p of PEOPLE) {
      await client.query(
        `INSERT INTO people (id, name, email, password_hash, org_role)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email,
           password_hash = EXCLUDED.password_hash, org_role = EXCLUDED.org_role`,
        [p.id, p.name, p.email, pwHash, p.org_role])
    }

    for (const proj of PROJECTS) {
      const area = Math.abs(proj.boundary.reduce((s, [x, y], i) => {
        const [nx, ny] = proj.boundary[(i + 1) % proj.boundary.length]!
        return s + x * ny - nx * y
      }, 0) / 2)
      await client.query(
        `INSERT INTO projects (slug, name, kind, code, floor_pct, buffer_pct, lead_person_id, boundary, boundary_area_m2)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind,
           code = EXCLUDED.code, floor_pct = EXCLUDED.floor_pct, buffer_pct = EXCLUDED.buffer_pct,
           lead_person_id = EXCLUDED.lead_person_id, boundary = EXCLUDED.boundary,
           boundary_area_m2 = EXCLUDED.boundary_area_m2`,
        [proj.slug, proj.name, proj.kind, proj.code, proj.floor_pct, proj.buffer_pct, proj.lead,
          JSON.stringify(proj.boundary), Math.round(area)])
      for (const s of proj.sensors) {
        await client.query(
          `INSERT INTO sensors (id, project, kind, polygon) VALUES ($1,$2,$3,$4)
           ON CONFLICT (project, id) DO UPDATE SET kind = EXCLUDED.kind, polygon = EXCLUDED.polygon`,
          [s.id, proj.slug, s.kind, JSON.stringify(s.polygon)])
      }
    }

    for (const g of GRANTS) {
      await client.query(
        `INSERT INTO grants (person_id, project, role) VALUES ($1,$2,$3)
         ON CONFLICT (person_id, project) DO UPDATE SET role = EXCLUDED.role`,
        [g.person_id, g.project, g.role])
    }

    const readings = [...blackmereReadings(), ...saltingsReadings()]
    const existing = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM readings')
    if (existing.rows[0]!.n === 0) {
      // batched inserts keep start-up quick
      for (let i = 0; i < readings.length; i += 500) {
        const chunk = readings.slice(i, i + 500)
        const values: unknown[] = []
        const placeholders = chunk.map((r, j) => {
          const b = j * 6
          values.push(r.project, r.sensor_id, r.interval_start, r.fc, r.fch4, r.qc)
          return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6})`
        })
        await client.query(
          `INSERT INTO readings (project, sensor_id, interval_start, fc, fch4, qc)
           VALUES ${placeholders.join(',')} ON CONFLICT DO NOTHING`,
          values)
      }
    }

    await client.query(
      `INSERT INTO seed_state (key, value) VALUES ('seeded','v1')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`)
  } finally {
    await client.query('SELECT pg_advisory_unlock(97002)')
  }
}
