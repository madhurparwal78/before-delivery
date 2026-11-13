import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { derive } from "../shared/optics";
import { eveningDate, localClock, offsetAt } from "../shared/time";
import type { Derived, ObjectKind, Optics } from "../shared/types";
import { hashPassword } from "./auth";
import { idFrom, pool } from "./db";
import { SCHEMA } from "./schema";
import { digest, headObject, putObject, strokeKey } from "./storage";

const CATALOGUE: [string, string, string, ObjectKind][] = [
  ["m2", "M2", "Globular cluster in Aquarius", "globular"],
  ["m3", "M3", "Globular cluster in Canes Venatici", "globular"],
  ["m5", "M5", "Globular cluster in Serpens", "globular"],
  ["m8", "M8", "Lagoon Nebula", "nebula"],
  ["m11", "M11", "Wild Duck Cluster", "open_cluster"],
  ["m13", "M13", "Great Globular Cluster in Hercules", "globular"],
  ["m15", "M15", "Globular cluster in Pegasus", "globular"],
  ["m27", "M27", "Dumbbell Nebula", "planetary_nebula"],
  ["m31", "M31", "Andromeda Galaxy", "galaxy"],
  ["m42", "M42", "Orion Nebula", "nebula"],
  ["m45", "M45", "Pleiades", "open_cluster"],
  ["m51", "M51", "Whirlpool Galaxy", "galaxy"],
  ["m57", "M57", "Ring Nebula", "planetary_nebula"],
  ["m81", "M81", "Bode's Galaxy", "galaxy"],
  ["m82", "M82", "Cigar Galaxy", "galaxy"],
  ["m92", "M92", "Globular cluster in Hercules", "globular"],
  ["albireo", "Albireo", "Beta Cygni", "double_star"],
];

const PROGRAMS = [
  {
    id: "globulars-by-hand",
    name: "Globular Clusters by Hand",
    required: 5,
    coordinator: ["Odile Marsh", "globulars@coordinators.lowlamp.test"],
    objects: ["m13", "m92", "m3", "m5", "m15", "m2"],
    editions: [
      [1, "2000-01-01", 60, true, false, false],
      [2, "2026-09-01", 80, true, true, false],
    ],
  },
  {
    id: "twelve-showpieces",
    name: "Twelve Showpieces",
    required: 10,
    coordinator: ["Bram Ellery", "showpieces@coordinators.lowlamp.test"],
    objects: ["m13", "albireo", "m51", "m57", "m27", "m31", "m42", "m45", "m81", "m82", "m8", "m11"],
    editions: [
      [1, "2000-01-01", 40, false, false, false],
      [2, "2026-10-01", 40, false, false, true],
    ],
  },
] as const;

interface SeedObservation {
  object: string;
  at: string;
  seeing: number | null;
  nelm: number;
  conc?: string;
  sketch: boolean;
  description: string;
  eyepiece?: string;
  key: string;
}

interface SeedSession {
  key: string;
  site: string;
  started: string;
  eyepiece: string;
  observations: SeedObservation[];
}

const ROWAN_SESSIONS: SeedSession[] = [
  {
    key: "s1", site: "hollow", started: "2025-06-22T03:30:00Z", eyepiece: "10mm",
    observations: [
      { key: "s1-m13", object: "m13", at: "2025-06-22T04:10:00Z", seeing: 6, nelm: 6.2, sketch: true, description: "Bright, large and grainy; resolved to the core with averted vision, three dark lanes forming the propeller." },
      { key: "s1-m92", object: "m92", at: "2025-06-22T04:45:00Z", seeing: 6, nelm: 6.2, sketch: true, description: "Smaller and more concentrated than M13; outer stars resolved, core a tight bright knot at 120x." },
    ],
  },
  {
    key: "s2", site: "hollow", started: "2026-07-18T02:45:00Z", eyepiece: "10mm",
    observations: [
      { key: "s2-m13", object: "m13", at: "2026-07-18T03:20:00Z", seeing: 8, nelm: 6.5, sketch: true, description: "Steadier night than last year. Core fully resolved at 120x with chains of stars spilling to the northwest." },
      { key: "s2-m3", object: "m3", at: "2026-07-18T03:55:00Z", seeing: 7, nelm: 6.5, sketch: true, description: "Round glow with a bright broad centre; edges resolved under averted vision." },
      { key: "s2-m5", object: "m5", at: "2026-07-18T04:30:00Z", seeing: 7, nelm: 6.5, sketch: true, eyepiece: "25mm", description: "Slightly oval with a very bright core; outer halo well resolved and a noticeable double star nearby." },
      { key: "s2-m15", object: "m15", at: "2026-07-18T08:05:00Z", seeing: 7, nelm: 6.5, sketch: true, description: "Small, intensely bright core like a star; halo partly resolved, low in the east after midnight." },
      { key: "s2-m2", object: "m2", at: "2026-07-18T08:40:00Z", seeing: null, nelm: 6.5, sketch: false, description: "Faint, round, grainy." },
    ],
  },
  {
    key: "s3", site: "garden", started: "2026-11-01T01:30:00Z", eyepiece: "6mm",
    observations: [
      { key: "s3-m15", object: "m15", at: "2026-11-01T07:20:00Z", seeing: 7, nelm: 6.3, conc: "IV", sketch: true, description: "Tiny blazing core like a bright star; halo resolved into many faint stars at 200x, very steady." },
      { key: "s3-m27a", object: "m27", at: "2026-11-01T07:25:00Z", seeing: 7, nelm: 6.3, sketch: true, description: "Dumbbell shape, bright." },
      { key: "s3-m2", object: "m2", at: "2026-11-01T08:20:00Z", seeing: 7, nelm: 6.3, sketch: true, description: "Bright round glow with a grainy halo; core unresolved at 200x tonight." },
      { key: "s3-m27b", object: "m27", at: "2026-11-01T08:25:00Z", seeing: 7, nelm: 6.3, sketch: true, description: "Dumbbell shape, bright." },
    ],
  },
];

/** A small deterministic generator so seeded sketches are the same bytes on every start. */
function generator(seed: string): () => number {
  let state = createHash("sha256").update(seed).digest().readUInt32LE(0);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function seedStrokeFile(key: string): string {
  const next = generator(key);
  const strokes = [0, 1].map((i) => {
    const cx = (next() - 0.5) * 16;
    const cy = (next() - 0.5) * 16;
    return {
      width: (["fine", "medium"] as const)[i % 2] as "fine" | "medium",
      points: Array.from({ length: 7 }, (_, k) => [r2(cx + k * 0.9 + next() * 0.6), r2(cy + Math.sin(k + i) * 1.4 + next() * 0.4)] as [number, number]),
    };
  });
  const anchor: [number, number] | null = key === "s2-m13" ? [0, 10] : null;
  const stars: { at: [number, number]; brightness: number }[] = anchor ? [{ at: anchor, brightness: 5 }] : [];
  while (stars.length < (anchor ? 5 : 4)) {
    const angle = next() * Math.PI * 2;
    const radius = 3 + next() * 11;
    const at: [number, number] = [r2(Math.cos(angle) * radius), r2(Math.sin(angle) * radius)];
    if (anchor && Math.hypot(at[0] - anchor[0], at[1] - anchor[1]) < 4) continue;
    stars.push({ at, brightness: 1 + Math.floor(next() * 5) });
  }
  return JSON.stringify({ format: "lowlamp-strokes/1", strokes, stars });
}

interface PendingStroke {
  accountId: string;
  observationId: string;
  text: string;
}

const pendingStrokes: PendingStroke[] = [];

async function insertAccount(client: PoolClient, key: string, email: string, password: string, name: string): Promise<string> {
  const id = idFrom(`account:${key}`);
  const exists = await client.query("SELECT 1 FROM accounts WHERE id = $1", [id]);
  if (exists.rows.length === 0) {
    await client.query("INSERT INTO accounts (id, email, password_hash, display_name) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [
      id,
      email,
      await hashPassword(password),
      name,
    ]);
  }
  return id;
}

interface KitIds {
  telescope: { id: string; aperture_mm: number; focal_length_mm: number };
  eyepieces: Record<string, { id: string; focal_length_mm: number; apparent_field_deg: number }>;
  sites: Record<string, { id: string; time_zone: string }>;
  barlow?: string;
}

async function seedSession(client: PoolClient, accountId: string, who: string, kit: KitIds, session: SeedSession): Promise<void> {
  const site = kit.sites[session.site];
  const eyepiece = kit.eyepieces[session.eyepiece];
  if (!site || !eyepiece) throw new Error("seed kit incomplete");
  const optics = (ep: typeof eyepiece): { optics: Optics; derived: Derived } => ({
    optics: { telescope_id: kit.telescope.id, eyepiece_id: ep.id, barlow_id: null, train: "straight" },
    derived: derive({ telescope: kit.telescope, eyepiece: ep, barlow: null, train: "straight" }),
  });
  const started = new Date(session.started);
  const sessionId = idFrom(`session:${who}:${session.key}`);
  const base = optics(eyepiece);
  await client.query(
    `INSERT INTO obs_sessions (id, account_id, site_id, started_at, evening_date, local_start, local_start_offset, optics, derived)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
    [sessionId, accountId, site.id, started, eveningDate(started, site.time_zone), localClock(started, site.time_zone), offsetAt(started, site.time_zone), JSON.stringify(base.optics), JSON.stringify(base.derived)],
  );
  for (const o of session.observations) {
    const own = o.eyepiece ? optics(kit.eyepieces[o.eyepiece] ?? eyepiece) : base;
    const id = idFrom(`observation:${who}:${o.key}`);
    const at = new Date(o.at);
    const edit = { at: at.toISOString(), device: "seed", version: 1 };
    const meta: Record<string, typeof edit> = { observed_at: edit, transparency_nelm: edit, description: edit };
    if (o.seeing !== null) meta.seeing = edit;
    if (o.conc) meta.concentration_class = edit;
    let sketch: { strokes_sha256: string; strokes_size: number; has_raster: boolean } | null = null;
    let marks = 0;
    if (o.sketch) {
      const text = seedStrokeFile(o.key);
      const parsed = JSON.parse(text) as { strokes: unknown[]; stars: unknown[] };
      marks = parsed.strokes.length + parsed.stars.length;
      sketch = { strokes_sha256: digest(text), strokes_size: Buffer.byteLength(text), has_raster: false };
      meta.sketch = edit;
      pendingStrokes.push({ accountId, observationId: id, text });
    }
    await client.query(
      `INSERT INTO observations (id, account_id, session_id, object_id, observed_at, seeing, transparency_nelm, concentration_class,
         description, optics, derived, sketch, sketch_marks, version, field_meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1,$14) ON CONFLICT DO NOTHING`,
      [id, accountId, sessionId, o.object, at, o.seeing, o.nelm, o.conc ?? null, o.description, JSON.stringify(own.optics), JSON.stringify(own.derived), sketch ? JSON.stringify(sketch) : null, marks, JSON.stringify(meta)],
    );
  }
}

async function seedKit(client: PoolClient, accountId: string, who: string, telescope: [string, number, number], eyepieces: [string, string, number, number][], sites: [string, string, number, number, string][], barlow?: [string, number]): Promise<KitIds> {
  const tid = idFrom(`telescope:${who}:${telescope[0]}`);
  await client.query("INSERT INTO telescopes (id, account_id, name, aperture_mm, focal_length_mm) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", [tid, accountId, telescope[0], telescope[1], telescope[2]]);
  const ids: KitIds = { telescope: { id: tid, aperture_mm: telescope[1], focal_length_mm: telescope[2] }, eyepieces: {}, sites: {} };
  for (const [key, name, fl, field] of eyepieces) {
    const id = idFrom(`eyepiece:${who}:${key}`);
    await client.query("INSERT INTO eyepieces (id, account_id, name, focal_length_mm, apparent_field_deg) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", [id, accountId, name, fl, field]);
    ids.eyepieces[key] = { id, focal_length_mm: fl, apparent_field_deg: field };
  }
  if (barlow) {
    ids.barlow = idFrom(`barlow:${who}:${barlow[0]}`);
    await client.query("INSERT INTO barlows (id, account_id, name, factor) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [ids.barlow, accountId, barlow[0], barlow[1]]);
  }
  for (const [key, name, lat, lon, zone] of sites) {
    const id = idFrom(`site:${who}:${key}`);
    await client.query("INSERT INTO sites (id, account_id, name, latitude, longitude, time_zone) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING", [id, accountId, name, lat, lon, zone]);
    ids.sites[key] = { id, time_zone: zone };
  }
  return ids;
}

async function seedReference(client: PoolClient): Promise<void> {
  for (const [i, [id, designation, name, kind]] of CATALOGUE.entries()) {
    await client.query("INSERT INTO catalogue_objects (id, position, designation, name, kind) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", [id, i, designation, name, kind]);
  }
  for (const [i, p] of PROGRAMS.entries()) {
    await client.query("INSERT INTO programs (id, position, name, required_count, coordinator_name, coordinator_email) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING", [p.id, i, p.name, p.required, p.coordinator[0], p.coordinator[1]]);
    for (const [k, object] of p.objects.entries()) {
      await client.query("INSERT INTO program_objects (program_id, object_id, position) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [p.id, object, k]);
    }
    for (const e of p.editions) {
      await client.query(
        "INSERT INTO program_editions (program_id, edition, effective_from, min_description, sketch_required, concentration_required, pair_required) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING",
        [p.id, ...e],
      );
    }
  }
}

async function seedPeople(client: PoolClient): Promise<void> {
  const rowan = await insertAccount(client, "rowan", "rowan@lowlamp.test", "dark-adapted-01", "Rowan Pell");
  const kit = await seedKit(
    client, rowan, "rowan", ["10-inch Dobsonian", 254, 1200],
    [["25mm", "25 mm wide", 25, 67], ["10mm", "10 mm wide", 10, 67], ["6mm", "6 mm", 6, 60]],
    [["hollow", "Hollow Field", 38.95, -105.4, "America/Denver"], ["garden", "Back garden", 39.74, -104.99, "America/Denver"]],
    ["2× Barlow", 2],
  );
  await client.query("INSERT INTO telescopes (id, account_id, name, aperture_mm, focal_length_mm) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", [idFrom("telescope:rowan:refractor"), rowan, "80 mm refractor", 80, 480]);
  // The refractor was added second; its sequence number follows the Dobsonian's only on a first seed.
  await client.query("INSERT INTO follows (account_id, program_id) VALUES ($1,'globulars-by-hand') ON CONFLICT DO NOTHING", [rowan]);
  for (const session of ROWAN_SESSIONS) await seedSession(client, rowan, "rowan", kit, session);

  const ines = await insertAccount(client, "ines", "ines@lowlamp.test", "dark-adapted-02", "Ines Varga");
  const inesKit = await seedKit(client, ines, "ines", ["8-inch Dobsonian", 203.2, 1200], [["20mm", "20 mm", 20, 68]], [["ridge", "Ridge Lot", 47.5, 19.04, "Europe/Budapest"]]);
  await seedSession(client, ines, "ines", inesKit, {
    key: "s1", site: "ridge", started: "2026-08-09T19:30:00Z", eyepiece: "20mm",
    observations: [{ key: "s1-m13", object: "m13", at: "2026-08-09T20:05:00Z", seeing: 6, nelm: 5.9, sketch: true, description: "Large bright ball, resolved at the edges, core grainy with averted vision." }],
  });
  const observation = idFrom("observation:ines:s1-m13");
  const inserted = await client.query(
    `INSERT INTO packets (id, account_id, number, program_id, state, revision, observation_ids, created_at)
     VALUES ($1,$2,1,'twelve-showpieces','draft',1,$3,$4) ON CONFLICT DO NOTHING`,
    [idFrom("packet:ines:1"), ines, [observation], new Date(Date.UTC(2026, 7, 10, 9))],
  );
  if (inserted.rowCount) await client.query("UPDATE accounts SET packet_seq = GREATEST(packet_seq, 1) WHERE id = $1", [ines]);
}

/** Applies the schema and the seed under an advisory lock, so instances may start together. */
export async function migrateAndSeed(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(727001)");
    await client.query(SCHEMA);
    await client.query("BEGIN");
    pendingStrokes.length = 0;
    await seedReference(client);
    await seedPeople(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.query("SELECT pg_advisory_unlock(727001)").catch(() => undefined);
    client.release();
  }
}

/** Seeded stroke files are written once storage answers; until then reads of them answer 503. */
export async function writeSeededStrokes(): Promise<boolean> {
  for (let i = pendingStrokes.length - 1; i >= 0; i--) {
    const item = pendingStrokes[i];
    if (!item) continue;
    const live = await pool.query("SELECT 1 FROM observations WHERE id = $1 AND NOT deleted", [item.observationId]);
    try {
      if (live.rows.length > 0) {
        const key = strokeKey(item.accountId, item.observationId, digest(item.text));
        if (!(await headObject(key))) await putObject(key, Buffer.from(item.text), "application/json");
      }
      pendingStrokes.splice(i, 1);
    } catch {
      return false;
    }
  }
  return true;
}

