// Seed data (brief: Seed data), inserted at start only when missing. Every person, artist and venue is invented.
import { parseWall } from "../shared/brussels.ts";
import { hashPassword } from "./auth.ts";
import { db, transaction } from "./db/index.ts";
import { issueVoucher } from "./domain/vouchers.ts";

const SEED_PASSWORD = "kerf-festival-2027";

const VENUES = [
  ["remise-noord", "Remise Noord (disused tram depot)"],
  ["planetarium-dome", "Planetarium Dome"],
  ["lab-hoogstraat", "Lab Hoogstraat (university lab)"],
  ["black-box-kanaal", "Black Box Kanaal"],
  ["riverside-pavilion", "Riverside Pavilion"],
] as const;

const DISCIPLINES = [["sound", "Sound"], ["light", "Light"], ["performance", "Performance"], ["moving-image", "Moving image"], ["code", "Code"]] as const;

const ORGANISATIONS = [["vierwinden", "Atheneum Vierwinden", "school"], ["quai-lumiere", "École Quai-Lumière", "school"]] as const;

const ACCOUNTS = [
  ["admin@kerf.example", "Ines Vandeput", "admin", null],
  ["curator@kerf.example", "Bram Okafor", "curator", null],
  ["curator2@kerf.example", "Lotte Riss", "curator", null],
  ["boxoffice@kerf.example", "Sami Haddad", "box_office", null],
  ["finance@kerf.example", "Elif Marchal", "finance", null],
  ["artist@kerf.example", "Yara Delcour", "artist", null],
  ["artist2@kerf.example", "Tom Achterberg", "artist", null],
  ["mira@visitors.example", "Mira Janssens", "visitor", null],
  ["jonas@visitors.example", "Jonas Peeters", "visitor", null],
  ["bookings@vierwinden.example", "Hanne De Wit", "group_booker", "vierwinden"],
  ["bookings@quai-lumiere.example", "Karim Lambrecht", "group_booker", "quai-lumiere"],
] as const;

type SeedSession = [id: string, title: string, discipline: string, venue: string, admission: "seat" | "pass", capacity: number | null,
  full: number | null, reduced: number | null, starts: string, ends: string, status: "published" | "draft", description: string];

const SESSIONS: SeedSession[] = [
  ["feedback-gardens", "Feedback Gardens", "sound", "lab-hoogstraat", "seat", 12, 1800, 1000, "2027-10-29T14:00+02:00", "2027-10-29T16:30+02:00", "published",
    "A twelve-seat workshop growing self-oscillating circuits into a slow garden of tones."],
  ["shader-sketching", "Shader Sketching", "code", "lab-hoogstraat", "seat", 12, 1800, 1000, "2027-10-30T11:00+02:00", "2027-10-30T13:00+02:00", "published",
    "Write fragment shaders by hand and project them onto the lab's long wall."],
  ["signal-bodies", "Signal Bodies", "performance", "black-box-kanaal", "seat", 60, 1200, 700, "2027-10-29T20:00+02:00", "2027-10-29T21:00+02:00", "published",
    "Dancers wired to radio receivers move through a field of shortwave static."],
  ["delta-choir", "Delta Choir", "sound", "riverside-pavilion", "pass", null, null, null, "2027-10-29T20:30+02:00", "2027-10-29T21:30+02:00", "published",
    "Forty voices tuned to the tide tables of the river, sung on the pavilion steps."],
  ["orbit-index", "Orbit Index", "moving-image", "planetarium-dome", "pass", null, null, null, "2027-10-28T21:00+02:00", "2027-10-28T21:45+02:00", "published",
    "A dome-filling film catalogue of every satellite launched in a single year."],
  ["lumen-drift", "Lumen Drift", "light", "remise-noord", "pass", null, null, null, "2027-10-28T18:00+02:00", "2027-10-28T23:00+02:00", "published",
    "Slow beams sweep the old tram depot, tracing the routes that once ran through it."],
  ["nachtstroom", "Nachtstroom", "sound", "remise-noord", "pass", null, null, null, "2027-10-31T01:30+02:00", "2027-10-31T02:30+02:00", "published",
    "A night current of modular synthesis that plays through the change of the clocks."],
  ["second-hour-summer", "The Second Hour (first pass)", "light", "riverside-pavilion", "pass", null, null, null, "2027-10-31T02:15+02:00", "2027-10-31T02:45+02:00", "published",
    "A light piece staged inside the hour that happens twice: first, in summer time."],
  ["second-hour-winter", "The Second Hour (second pass)", "light", "black-box-kanaal", "pass", null, null, null, "2027-10-31T02:15+01:00", "2027-10-31T02:45+01:00", "published",
    "The same wall-clock minutes, an hour later in winter time."],
  ["dawn-patch", "Dawn Patch", "code", "riverside-pavilion", "pass", null, null, null, "2027-10-31T06:00+01:00", "2027-10-31T07:00+01:00", "published",
    "Live coders patch a morning chorus together as the river light comes up."],
  ["residency-showing", "Untitled residency showing", "performance", "black-box-kanaal", "pass", null, null, null, "2027-10-30T16:00+02:00", "2027-10-30T17:00+02:00", "draft",
    "Work in progress from this year's residency."],
];

const ENTRIES = [
  ["e-tidal-mesh", "Tidal Mesh", "artist@kerf.example", "light", "published", "A net of fibre-optic threads that brightens with the river's tide.", "Fibre optics, tide data", 2026],
  ["e-quiet-servo", "Quiet Servo", "artist2@kerf.example", "code", "published", "A field of tiny motors that only move when the room falls silent.", "Servos, microcontrollers", 2025],
  ["e-rust-chorus", "Rust Chorus", "artist@kerf.example", "sound", "published", "Contact microphones on weathered steel sing the slow chemistry of rust.", "Steel, contact microphones", 2026],
  ["e-slow-orbit", "Slow Orbit", "artist2@kerf.example", "moving-image", "published", "A single camera orbit of a kitchen table, stretched over one hour.", "Single-channel video", 2024],
  ["e-wet-signal", "Wet Signal", "artist@kerf.example", "performance", "published", "Performers pass a radio signal hand to hand through a shallow pool.", "Performance, water, radio", 2027],
  ["e-salt-print", "Salt Print", "artist@kerf.example", "light", "review", "Sunlight exposures on salted paper, fixed with seawater.", "Salt print", 2026],
  ["e-ghost-loop", "Ghost Loop", "artist2@kerf.example", "code", "draft", "A feedback loop between two old monitors and a webcam.", "CRT monitors, webcam", 2027],
] as const;

const instant = (wall: string) => {
  const parsed = parseWall(wall);
  if (!parsed.ok) throw new Error(`bad seed time ${wall}`);
  return new Date(parsed.instant);
};

export async function seed(): Promise<void> {
  const missing = [];
  for (const [email] of ACCOUNTS) if (!(await db.one("SELECT 1 FROM users WHERE email = $1", [email]))) missing.push(email);
  const hashes = new Map<string, string>();
  for (const email of missing) hashes.set(email, await hashPassword(SEED_PASSWORD));

  await transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('kerf-seed'))");
    await tx.query("INSERT INTO edition (id, name, first_day, last_day) VALUES (1, 'Kerf Frequencies 2027', '2027-10-28', '2027-10-31') ON CONFLICT DO NOTHING");
    for (const [i, [id, name]] of VENUES.entries()) await tx.query("INSERT INTO venues (id, name, position) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [id, name, i + 1]);
    for (const [i, [id, name]] of DISCIPLINES.entries()) await tx.query("INSERT INTO disciplines (id, name, position) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [id, name, i + 1]);
    await tx.query(`INSERT INTO price_policy (id, full_festival_full_cents, full_festival_reduced_cents, day_full_cents, day_reduced_cents, group_discount_percent, version)
      VALUES (1, 9500, 5500, 3500, 2000, 15, 1) ON CONFLICT DO NOTHING`);
    for (const [id, name, kind] of ORGANISATIONS) await tx.query("INSERT INTO organisations (id, name, kind) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [id, name, kind]);
    for (const [email, name, role, organisation] of ACCOUNTS) {
      const hash = hashes.get(email);
      if (hash) {
        await tx.query("INSERT INTO users (id, email, name, password_hash, role, organisation_id) VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5) ON CONFLICT (email) DO NOTHING",
          [email, name, hash, role, organisation]);
      }
    }
    for (const [id, title, discipline, venue, admission, capacity, full, reduced, starts, ends, status, description] of SESSIONS) {
      await tx.query(`INSERT INTO sessions (id, title, description, discipline, venue_id, admission, capacity, price_full_cents, price_reduced_cents,
        starts_at, ends_at, status, version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1) ON CONFLICT DO NOTHING`,
        [id, title, description, discipline, venue, admission, capacity, full, reduced, instant(starts), instant(ends), status]);
    }
    for (const [id, title, artist, discipline, status, statement, medium, year] of ENTRIES) {
      await tx.query(`INSERT INTO entries (id, artist_id, title, statement, discipline, medium, year, status)
        SELECT $1, u.id, $2, $3, $4, $5, $6, $7 FROM users u WHERE u.email = $8 ON CONFLICT DO NOTHING`,
        [id, title, statement, discipline, medium, year, status, artist]);
    }
    for (const [code, cents] of [["KERF-GIFT-A1", 4000], ["KERF-GIFT-B2", 2500]] as const) {
      if (!(await tx.one("SELECT 1 FROM vouchers WHERE code = $1", [code]))) await issueVoucher(tx, code, cents, "Seeded gift voucher", "finance@kerf.example");
    }
  });
}
