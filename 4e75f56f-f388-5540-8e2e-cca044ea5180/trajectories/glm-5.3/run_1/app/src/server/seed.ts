import type { Config } from "./config.js";
import { COURSE, STAFF } from "./config.js";
import { query } from "./db.js";
import { hashPassword } from "./auth.js";
import { newId } from "./ids.js";
import { PocketBase, COLLECTIONS, COLLECTION_FIELDS } from "./pocketbase.js";

/**
 * Applied on every serve, idempotently: the PocketBase collections and their
 * seed rows, and the staff accounts.
 */
export async function seed(cfg: Config, pb: PocketBase): Promise<void> {
  for (const [collection, fields] of Object.entries(COLLECTION_FIELDS)) {
    await pb.ensureCollection(collection, fields).catch(() => undefined);
  }
  for (const [collection, seedRows] of Object.entries(SEEDS)) {
    const existing = await pb.list(collection).catch(() => null);
    if (existing === null) continue;
    if (existing.length === 0) {
      for (const row of seedRows) {
        await pb.create(collection, row).catch(() => undefined);
      }
    }
  }
  for (const staff of STAFF) {
    await query(
      `INSERT INTO accounts (id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO NOTHING`,
      [newId("acc"), staff.name, staff.email.toLowerCase(), hashPassword(staff.password), staff.role]
    );
  }
  void cfg;
  void COURSE;
}

const SEEDS: Record<string, Record<string, unknown>[]> = {
  [COLLECTIONS.sessions]: [
    { number: 1, day: 1, format: "lecture", minutes: 90, title: "Shade and translucency mapping", outcomes: "Read chroma, value and translucency zones on a natural incisor" },
    { number: 2, day: 1, format: "hands-on", minutes: 150, title: "Palatal shell from a silicone index", outcomes: "Build a thin, even palatal shell from a wax-up index" },
    { number: 3, day: 1, format: "lecture", minutes: 60, title: "Dentin mamelons and internal effects", outcomes: "Plan mamelon shape and halo before layering" },
    { number: 4, day: 1, format: "hands-on", minutes: 180, title: "Class IV layering on the typodont", outcomes: "Layer dentin, effects and enamel to a natural incisal edge" },
    { number: 5, day: 2, format: "lecture", minutes: 60, title: "Posterior anatomy and occlusal stamping", outcomes: "Choose between freehand anatomy and occlusal stamps" },
    { number: 6, day: 2, format: "hands-on", minutes: 180, title: "Class II with sectional matrices", outcomes: "Place tight contacts with sectional rings and wedges" },
    { number: 7, day: 2, format: "lecture", minutes: 60, title: "Finishing and polishing sequence", outcomes: "Order discs, rubbers and pastes for lasting gloss" },
    { number: 8, day: 2, format: "hands-on", minutes: 180, title: "Polish to gloss and photograph", outcomes: "Finish to gloss and record cross-polarised photographs" },
  ],
  [COLLECTIONS.hospitality]: [
    { title: "Welcome reception", day: 1, starts_at: "18:30", venue: "The Opaline Lab foyer", tier: "all", description: "Drinks and small plates with the instructor" },
    { title: "Atelier dinner with the instructor", day: 1, starts_at: "20:00", venue: "Larkspur Room, West Loop", tier: "atelier", description: "A seated tasting menu for Atelier guests and the course director" },
    { title: "Bench breakfast", day: 2, starts_at: "07:30", venue: "The Opaline Lab foyer", tier: "all", description: "Coffee and pastries before the lab opens" },
  ],
  [COLLECTIONS.hotels]: [
    { name: "Fulton Rail Hotel", distance: "0.4 miles", rate: "from $289 a night", map_url: "https://maps.example.com/fulton-rail-hotel" },
    { name: "Kinzie Loft Suites", distance: "0.7 miles", rate: "from $245 a night", map_url: "https://maps.example.com/kinzie-loft-suites" },
  ],
  [COLLECTIONS.faq]: [
    { question: "What should I bring?", answer: "Your own loupes. Typodonts, composites, instruments and curing lights are provided at every bench.", sort: 1 },
    { question: "How are CE credits awarded?", answer: "Credits are issued after both days of check-in and a matched licence on file.", sort: 2 },
    { question: "Can my clinic buy several seats?", answer: "Yes. A clinic account can hold up to six benches at once and pays one group invoice.", sort: 3 },
    { question: "What is the difference between Bench and Atelier?", answer: "Atelier seats sit in rows A and B nearest the demo station and include the Atelier dinner.", sort: 4 },
  ],
};
