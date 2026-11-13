// Seed data: the catalogue, programs, two observer accounts with their
// kits, sites, sessions and observations (Seed data in the brief).
import { randomUUID, createHash } from "node:crypto";
import type { Pool } from "pg";
import { catalogue, programSeeds } from "#shared/catalogue.js";
import { deriveOptics, type OpticsChoice } from "#shared/optics.js";
import {
  eveningDateFor,
  localHHMM,
  parseInputTime,
  utcOffset,
} from "#shared/time.js";
import type { StrokeFile } from "#shared/strokes.js";
import { strokesToJson } from "#shared/strokes.js";
import { hashPassword } from "./auth.js";

export interface SeedSketch {
  readonly strokes: StrokeFile;
  readonly raster: null;
}

function hash(text: string): string {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

// A simple deterministic stroke file with at least three stars and one stroke.
function sketch(stars: readonly [number, number][], strokes: readonly { width: "fine" | "medium" | "broad"; points: readonly [number, number][] }[]): StrokeFile {
  return { format: "lowlamp-strokes/1", strokes, stars: stars.map((at, i) => ({ at, brightness: (i % 5) + 1 })) };
}

const genericSketches: Record<string, StrokeFile> = {
  m13_2025: sketch(
    [[-6, 4], [5, 7], [2, -5]],
    [{ width: "medium", points: [[-8, -6], [-2, -1], [3, 3]] }],
  ),
  m92_2025: sketch(
    [[-4, -3], [6, 2], [1, 6]],
    [{ width: "fine", points: [[-7, 5], [0, 0], [6, -4]] }],
  ),
  m13_2026: sketch(
    [[0, 10], [-7, -2], [4, -6]],
    [
      { width: "medium", points: [[-6, 6], [-1, 2], [4, -2]] },
      { width: "fine", points: [[-3, -8], [2, -7]] },
    ],
  ),
  m3_2026: sketch(
    [[-5, 3], [3, 6], [7, -3]],
    [{ width: "medium", points: [[-6, -5], [0, -1], [5, 4]] }],
  ),
  m5_2026: sketch(
    [[-3, 6], [6, 1], [-6, -4]],
    [{ width: "broad", points: [[-2, 2], [3, 5]] }, { width: "fine", points: [[-4, -7], [1, -3], [6, 1]] }],
  ),
  m15_2026: sketch(
    [[-2, 5], [4, -6], [8, 3]],
    [{ width: "medium", points: [[-5, -2], [0, 3], [6, 7]] }],
  ),
  m15_s3: sketch(
    [[-1, 4], [3, 2], [5, -5]],
    [{ width: "fine", points: [[-7, 7], [-2, 2], [2, -3]] }],
  ),
  m27_s3a: sketch(
    [[-4, 2], [2, 5], [6, -2]],
    [{ width: "broad", points: [[-3, -4], [1, 0], [5, 4]] }],
  ),
  m2_s3: sketch(
    [[-5, -5], [0, 7], [7, 1]],
    [{ width: "medium", points: [[-6, 3], [-1, -1], [4, -5]] }],
  ),
  m27_s3b: sketch(
    [[-2, 3], [4, 4], [6, -5]],
    [{ width: "fine", points: [[-8, -2], [-2, 1], [3, -2]] }],
  ),
  m13_ines: sketch(
    [[-6, 1], [2, 6], [5, -3]],
    [{ width: "medium", points: [[-4, 5], [0, 1], [5, -6]] }],
  ),
};

export interface SeededObservationSpec {
  readonly object: string;
  readonly observedAt: string | null;
  readonly seeing: number | null;
  readonly nelm: number | null;
  readonly description: string;
  readonly concentration: string | null;
  readonly optics: OpticsChoice | null;
  readonly sketch: StrokeFile | null;
}

export interface SeededSessionSpec {
  readonly site: string;
  readonly startedAt: string;
  readonly optics: OpticsChoice;
  readonly observations: readonly SeededObservationSpec[];
}

export interface SeededAccountSpec {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
  readonly telescopes: readonly { name: string; aperture_mm: number; focal_length_mm: number }[];
  readonly eyepieces: readonly { name: string; focal_length_mm: number; apparent_field_deg: number }[];
  readonly barlows: readonly { name: string; factor: number }[];
  readonly sites: readonly { name: string; latitude: number; longitude: number; time_zone: string }[];
  readonly follows: readonly string[];
  readonly sessions: readonly SeededSessionSpec[];
  readonly packets: readonly { program: string; observationKey: string }[];
}

const rowanOptics = (telescope: string, eyepiece: string, barlow: string | null, train: OpticsChoice["train"]): OpticsChoice =>
  ({ telescope_id: telescope, eyepiece_id: eyepiece, barlow_id: barlow, train });

export const seedAccounts: readonly SeededAccountSpec[] = [
  {
    email: "rowan@lowlamp.test",
    password: "dark-adapted-01",
    displayName: "Rowan Pell",
    telescopes: [
      { name: "10-inch Dobsonian", aperture_mm: 254, focal_length_mm: 1200 },
      { name: "80 mm refractor", aperture_mm: 80, focal_length_mm: 480 },
    ],
    eyepieces: [
      { name: "25 mm wide", focal_length_mm: 25, apparent_field_deg: 67 },
      { name: "10 mm wide", focal_length_mm: 10, apparent_field_deg: 67 },
      { name: "6 mm", focal_length_mm: 6, apparent_field_deg: 60 },
    ],
    barlows: [{ name: "2× Barlow", factor: 2.0 }],
    sites: [
      { name: "Hollow Field", latitude: 38.95, longitude: -105.4, time_zone: "America/Denver" },
      { name: "Back garden", latitude: 39.74, longitude: -104.99, time_zone: "America/Denver" },
    ],
    follows: ["globulars-by-hand"],
    sessions: [
      {
        site: "Hollow Field",
        startedAt: "2025-06-22T03:30:00Z",
        optics: rowanOptics("t0", "e1", null, "straight"),
        observations: [
          {
            object: "m13",
            observedAt: "2025-06-22T04:10:00Z",
            seeing: 6,
            nelm: 6.2,
            description: "Bright, large and grainy; resolved to the core with averted vision, three dark lanes forming the propeller.",
            concentration: null,
            optics: null,
            sketch: genericSketches["m13_2025"]!,
          },
          {
            object: "m92",
            observedAt: "2025-06-22T04:45:00Z",
            seeing: 6,
            nelm: 6.2,
            description: "Smaller and more concentrated than M13; outer stars resolved, core a tight bright knot at 120x.",
            concentration: null,
            optics: null,
            sketch: genericSketches["m92_2025"]!,
          },
        ],
      },
      {
        site: "Hollow Field",
        startedAt: "2026-07-18T02:45:00Z",
        optics: rowanOptics("t0", "e1", null, "straight"),
        observations: [
          {
            object: "m13",
            observedAt: "2026-07-18T03:20:00Z",
            seeing: 8,
            nelm: 6.5,
            description: "Steadier night than last year. Core fully resolved at 120x with chains of stars spilling to the northwest.",
            concentration: null,
            optics: null,
            sketch: genericSketches["m13_2026"]!,
          },
          {
            object: "m3",
            observedAt: "2026-07-18T03:55:00Z",
            seeing: 7,
            nelm: 6.5,
            description: "Round glow with a bright broad centre; edges resolved under averted vision.",
            concentration: null,
            optics: null,
            sketch: genericSketches["m3_2026"]!,
          },
          {
            object: "m5",
            observedAt: "2026-07-18T04:30:00Z",
            seeing: 7,
            nelm: 6.5,
            description: "Slightly oval with a very bright core; outer halo well resolved and a noticeable double star nearby.",
            concentration: null,
            optics: rowanOptics("t0", "e0", null, "straight"),
            sketch: genericSketches["m5_2026"]!,
          },
          {
            object: "m15",
            observedAt: "2026-07-18T08:05:00Z",
            seeing: 7,
            nelm: 6.5,
            description: "Small, intensely bright core like a star; halo partly resolved, low in the east after midnight.",
            concentration: null,
            optics: null,
            sketch: genericSketches["m15_2026"]!,
          },
          {
            object: "m2",
            observedAt: "2026-07-18T08:40:00Z",
            seeing: null,
            nelm: 6.5,
            description: "Faint, round, grainy.",
            concentration: null,
            optics: null,
            sketch: null,
          },
        ],
      },
      {
        site: "Back garden",
        startedAt: "2026-11-01T01:30:00Z",
        optics: rowanOptics("t0", "e2", null, "straight"),
        observations: [
          {
            object: "m15",
            observedAt: "2026-11-01T07:20:00Z",
            seeing: 7,
            nelm: 6.3,
            description: "Tiny blazing core like a bright star; halo resolved into many faint stars at 200x, very steady.",
            concentration: "IV",
            optics: null,
            sketch: genericSketches["m15_s3"]!,
          },
          {
            object: "m27",
            observedAt: "2026-11-01T07:25:00Z",
            seeing: 7,
            nelm: 6.3,
            description: "Dumbbell shape, bright.",
            concentration: null,
            optics: null,
            sketch: genericSketches["m27_s3a"]!,
          },
          {
            object: "m2",
            observedAt: "2026-11-01T08:20:00Z",
            seeing: 7,
            nelm: 6.3,
            description: "Bright round glow with a grainy halo; core unresolved at 200x tonight.",
            concentration: null,
            optics: null,
            sketch: genericSketches["m2_s3"]!,
          },
          {
            object: "m27",
            observedAt: "2026-11-01T08:25:00Z",
            seeing: 7,
            nelm: 6.3,
            description: "Dumbbell shape, bright.",
            concentration: null,
            optics: null,
            sketch: genericSketches["m27_s3b"]!,
          },
        ],
      },
    ],
    packets: [],
  },
  {
    email: "ines@lowlamp.test",
    password: "dark-adapted-02",
    displayName: "Ines Varga",
    telescopes: [{ name: "8-inch Dobsonian", aperture_mm: 203.2, focal_length_mm: 1200 }],
    eyepieces: [{ name: "20 mm", focal_length_mm: 20, apparent_field_deg: 68 }],
    barlows: [],
    sites: [{ name: "Ridge Lot", latitude: 47.5, longitude: 19.04, time_zone: "Europe/Budapest" }],
    follows: [],
    sessions: [
      {
        site: "Ridge Lot",
        startedAt: "2026-08-09T19:30:00Z",
        optics: rowanOptics("t0", "e0", null, "straight"),
        observations: [
          {
            object: "m13",
            observedAt: "2026-08-09T20:05:00Z",
            seeing: 6,
            nelm: 5.9,
            description: "Large bright ball, resolved at the edges, core grainy with averted vision.",
            concentration: null,
            optics: null,
            sketch: genericSketches["m13_ines"]!,
          },
        ],
      },
    ],
    packets: [{ program: "twelve-showpieces", observationKey: "ines-m13" }],
  },
];

export interface SeedOutcome {
  readonly strokeObjects: readonly { key: string; text: string }[];
}

export async function seedDatabase(pool: Pool): Promise<SeedOutcome> {
  await pool.query("INSERT INTO seed_markers (key) VALUES ('catalogue') ON CONFLICT (key) DO NOTHING");
  for (const obj of catalogue) {
    await pool.query(
      `INSERT INTO objects (id, designation, name, kind) VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO UPDATE SET designation = EXCLUDED.designation, name = EXCLUDED.name, kind = EXCLUDED.kind`,
      [obj.id, obj.designation, obj.name, obj.kind],
    );
  }
  for (const program of programSeeds) {
    await pool.query(
      `INSERT INTO programs (id, name, required_count, coordinator_name, coordinator_email) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, required_count = EXCLUDED.required_count,
       coordinator_name = EXCLUDED.coordinator_name, coordinator_email = EXCLUDED.coordinator_email`,
      [program.id, program.name, program.required_count, program.coordinator_name, program.coordinator_email],
    );
    await pool.query("DELETE FROM program_objects WHERE program_id = $1", [program.id]);
    for (let i = 0; i < program.object_ids.length; i++) {
      const objectId = program.object_ids[i]!;
      await pool.query("INSERT INTO program_objects (program_id, object_id, position) VALUES ($1,$2,$3)", [program.id, objectId, i]);
    }
    await pool.query("DELETE FROM program_editions WHERE program_id = $1", [program.id]);
    for (const edition of program.editions) {
      await pool.query(
        `INSERT INTO program_editions (program_id, edition, effective_from, min_description, sketch_required, concentration_required, pair_required)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [program.id, edition.edition, edition.effective_from, edition.min_description, edition.sketch_required, edition.concentration_required, edition.pair_required],
      );
    }
  }
  return { strokeObjects: [] };
}

// The seeded accounts, sessions and observations are inserted by
// seedAccountsIntoDatabase, which also returns the stroke objects to write.
export interface SeedAccountOutcome {
  readonly accountId: string;
  readonly strokeObjects: readonly { key: string; text: string }[];
}

export async function seedAccountsIntoDatabase(pool: Pool): Promise<readonly SeedAccountOutcome[]> {
  const outcomes: SeedAccountOutcome[] = [];
  for (const account of seedAccounts) {
    const existing = await pool.query<{ id: string }>("SELECT id FROM accounts WHERE email_normalised = $1", [account.email]);
    if (existing.rows.length > 0) continue;
    const accountId = randomUUID();
    const passwordHash = hashPassword(account.password);
    await pool.query(
      "INSERT INTO accounts (id, email, email_normalised, display_name, password_hash) VALUES ($1,$2,$3,$4,$5)",
      [accountId, account.email, account.email, account.displayName, passwordHash],
    );
    const telescopeIds = new Map<string, string>();
    for (const t of account.telescopes) {
      const id = randomUUID();
      telescopeIds.set(t.name, id);
      await pool.query("INSERT INTO telescopes (id, account_id, name, aperture_mm, focal_length_mm, position) VALUES ($1,$2,$3,$4,$5,$6)", [id, accountId, t.name, t.aperture_mm, t.focal_length_mm, telescopeIds.size]);
    }
    const eyepieceIds = new Map<string, string>();
    let eyepiecePos = 0;
    for (const e of account.eyepieces) {
      const id = randomUUID();
      eyepieceIds.set(e.name, id);
      eyepiecePos++;
      await pool.query("INSERT INTO eyepieces (id, account_id, name, focal_length_mm, apparent_field_deg) VALUES ($1,$2,$3,$4,$5)", [id, accountId, e.name, e.focal_length_mm, e.apparent_field_deg]);
    }
    const barlowIds = new Map<string, string>();
    for (const b of account.barlows) {
      const id = randomUUID();
      barlowIds.set(b.name, id);
      await pool.query("INSERT INTO barlows (id, account_id, name, factor) VALUES ($1,$2,$3,$4)", [id, accountId, b.name, b.factor]);
    }
    const siteIds = new Map<string, string>();
    let sitePos = 0;
    for (const s of account.sites) {
      sitePos++;
      const id = randomUUID();
      siteIds.set(s.name, id);
      await pool.query("INSERT INTO sites (id, account_id, name, latitude, longitude, time_zone, position) VALUES ($1,$2,$3,$4,$5,$6,$7)", [id, accountId, s.name, s.latitude, s.longitude, s.time_zone, sitePos]);
    }
    for (const programId of account.follows) {
      await pool.query("INSERT INTO program_follows (account_id, program_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [accountId, programId]);
    }

    const telescopeById = new Map(account.telescopes.map((t) => [telescopeIds.get(t.name)!, t]));
    const eyepieceById = new Map(account.eyepieces.map((e) => [eyepieceIds.get(e.name)!, e]));
    const barlowById = new Map(account.barlows.map((b) => [barlowIds.get(b.name)!, b]));

    // Resolve the seed specs' placeholder keys to the generated uuids.
    const telescopeKey = (index: number) => telescopeIds.get(account.telescopes[index]!.name)!;
    const eyepieceKey = (index: number) => eyepieceIds.get(account.eyepieces[index]!.name)!;
    const resolveOptics = (optics: OpticsChoice): OpticsChoice => ({
      telescope_id: optics.telescope_id === "t0" ? telescopeKey(0) : optics.telescope_id,
      eyepiece_id: optics.eyepiece_id === "e0" ? eyepieceKey(0) : optics.eyepiece_id === "e1" ? eyepieceKey(1) : optics.eyepiece_id === "e2" ? eyepieceKey(2) : optics.eyepiece_id,
      barlow_id: optics.barlow_id,
      train: optics.train,
    });

    const strokeObjects: { key: string; text: string }[] = [];
    const observationIds = new Map<string, string>();

    for (const session of account.sessions) {
      const sessionId = randomUUID();
      const site = account.sites.find((s) => s.name === session.site)!;
      const timeZone = site.time_zone;
      const start = parseInputTime(session.startedAt)!;
      const optics = resolveOptics(session.optics);
      const derived = deriveOptics(telescopeById.get(optics.telescope_id)!, eyepieceById.get(optics.eyepiece_id)!, optics.barlow_id ? barlowById.get(optics.barlow_id)!.factor : 1, optics.train);
      await pool.query(
        `INSERT INTO observing_sessions (id, account_id, site_id, started_at, started_at_text, evening_date, local_start, local_start_offset, telescope_id, eyepiece_id, barlow_id, train, derived)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [sessionId, accountId, siteIds.get(session.site)!, new Date(start.epochMs), start.text, eveningDateFor(start.epochMs, timeZone), localHHMM(start.epochMs, timeZone), utcOffset(start.epochMs, timeZone), optics.telescope_id, optics.eyepiece_id, optics.barlow_id, optics.train, JSON.stringify(derived)],
      );
      for (const obs of session.observations) {
        const observationId = randomUUID();
        const object = catalogue.find((o) => o.id === obs.object)!;
        const opticsForObs = obs.optics ? resolveOptics(obs.optics) : optics;
        const derivedForObs = deriveOptics(telescopeById.get(opticsForObs.telescope_id)!, eyepieceById.get(opticsForObs.eyepiece_id)!, opticsForObs.barlow_id ? barlowById.get(opticsForObs.barlow_id)!.factor : 1, opticsForObs.train);
        const observed = obs.observedAt ? parseInputTime(obs.observedAt) : null;
        const sha = obs.sketch ? hash(strokesToJson(obs.sketch)) : null;
        const size = obs.sketch ? Buffer.byteLength(strokesToJson(obs.sketch), "utf8") : null;
        if (obs.sketch) {
          strokeObjects.push({ key: `observers/${accountId}/strokes/${observationId}/${sha}.json`, text: strokesToJson(obs.sketch) });
        }
        await pool.query(
          `INSERT INTO observations (id, account_id, session_id, object_id, observed_at, observed_at_text, local_time, local_offset, evening_date,
             seeing, transparency_nelm, concentration_class, description, telescope_id, eyepiece_id, barlow_id, train, derived,
             strokes_sha256, strokes_size, version)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,1)`,
          [
            observationId, accountId, sessionId, object.id,
            observed ? new Date(observed.epochMs) : null, observed ? observed.text : null,
            observed ? localHHMM(observed.epochMs, timeZone) : null, observed ? utcOffset(observed.epochMs, timeZone) : null,
            eveningDateFor(start.epochMs, timeZone),
            obs.seeing, obs.nelm, obs.concentration, obs.description,
            opticsForObs.telescope_id, opticsForObs.eyepiece_id, opticsForObs.barlow_id, opticsForObs.train, JSON.stringify(derivedForObs),
            sha, size,
          ],
        );
        // Field edit times: seeded edits carry device 'seed' and the
        // observation's own time as edited_at.
        const editedAt = observed ? observed.text : start.text;
        for (const field of ["observed_at", "seeing", "transparency_nelm", "concentration_class", "description", "optics"] as const) {
          await pool.query(
            "INSERT INTO observation_field_edits (observation_id, field, edited_at_text, edited_epoch_ms, device) VALUES ($1,$2,$3,$4,'seed')",
            [observationId, field, editedAt, observed ? observed.epochMs : start.epochMs],
          );
        }
        if (sha) {
          await pool.query(
            "INSERT INTO observation_field_edits (observation_id, field, edited_at_text, edited_epoch_ms, device) VALUES ($1,'sketch',$2,$3,'seed')",
            [observationId, editedAt, observed ? observed.epochMs : start.epochMs],
          );
        }
        observationIds.set(`${session.startedAt}:${obs.object}`, observationId);
      }
    }

    let packetNumber = 0;
    for (const packet of account.packets) {
      packetNumber++;
      const observationId = packet.observationKey === "ines-m13" ? [...observationIds.values()][0]! : null;
      if (!observationId) continue;
      const createdAt = new Date();
      await pool.query(
        `INSERT INTO packets (id, account_id, program_id, number, state, revision, observation_ids, rows, returned_to_draft, created_at, created_at_text)
         VALUES ($1,$2,$3,$4,'draft',1,$5,'[]'::jsonb,false,$6,$7)`,
        [randomUUID(), accountId, packet.program, packetNumber, JSON.stringify([observationId]), createdAt, createdAt.toISOString().replace(/\.\d{3}Z$/, "Z")],
      );
    }
    outcomes.push({ accountId, strokeObjects });
  }
  return outcomes;
}

