import { insertMedia, storeMedia } from "./campaigns.js";
import { one, pool, rows, tx, type Db } from "./db.js";
import { insertPerson } from "./people.js";
import { coverPng, COVER_TONES } from "./png.js";
import { localText, zonedInstant } from "./time.js";
import type { MediaRecord } from "./views.js";

// The brief's invented seed records (Seed data), inserted once against an empty database.

const PEOPLE = [
  { id: "mara-quillfeather", name: "Mara Quillfeather", email: "mara@quillfeather.example", key: "dgk_mara_seed_4f1c0b7a9e2d4c68b3a1" },
  { id: "ines-calloway", name: "Ines Calloway", email: "ines@inkshelter.example", key: "dgk_ines_seed_8a2e6d1f0c9b4e37a5d2" },
  { id: "tobias-ferrante", name: "Tobias Ferrante", email: "tobias@reader.example", key: "dgk_tobias_seed_2b9c4e7a1d0f5e83c6" },
  { id: "wren-adeyemi", name: "Wren Adeyemi", email: "wren@reader.example", key: "dgk_wren_seed_6e3a9c2b8d1f4a70e5b9" },
];

interface SeedTier {
  id: string;
  title: string;
  description: string;
  price: number;
  quantity: number | null;
  shipping: [number, number, number];
}

interface SeedCampaign {
  id: string;
  creator: string;
  status: "live" | "draft";
  title: string;
  story: string;
  goal: number;
  minRun: number;
  stretch: { copies: number; amount: number }[];
  shipsFrom: string;
  zone: string;
  days: number;
  cover: keyof typeof COVER_TONES | null;
  tiers: SeedTier[];
}

const CAMPAIGNS: SeedCampaign[] = [
  {
    id: "saltmarsh-nocturnes", creator: "mara-quillfeather", status: "live", title: "Saltmarsh Nocturnes",
    story: "Saltmarsh Nocturnes is a 64-page comic about the night ferry that crosses the estuary after the last tide.\n\nIt is drawn in two inks and printed offset on uncoated stock. The printer's minimum run is 300 copies; at 500 the run moves to a heavier cover board, and at 1,000 it gains a fold-out map of the marsh.",
    goal: 240_000, minRun: 300, stretch: [{ copies: 500, amount: 340_000 }, { copies: 1000, amount: 560_000 }],
    shipsFrom: "GB", zone: "Europe/London", days: 30, cover: "saltmarsh",
    tiers: [
      { id: "saltmarsh-reading-copy", title: "Reading copy", description: "One copy of the book from the first run.", price: 1200, quantity: null, shipping: [350, 700, 1100] },
      { id: "saltmarsh-signed-variant", title: "Signed variant cover", description: "The book with the variant cover, signed and numbered.", price: 2500, quantity: 2, shipping: [350, 700, 1100] },
      { id: "saltmarsh-original-page", title: "Original page", description: "One original inked page from the book, with a signed copy.", price: 18_000, quantity: 1, shipping: [900, 1800, 3000] },
    ],
  },
  {
    id: "fold-here", creator: "ines-calloway", status: "live", title: "Fold Here",
    story: "Fold Here is a 24-page risograph zine about paper engineering: folds, cuts and the small machines that make them.\n\nThe minimum run is 100 copies. At 250 copies every zine comes with a die-cut pop-up insert.",
    goal: 60_000, minRun: 100, stretch: [{ copies: 250, amount: 120_000 }],
    shipsFrom: "IE", zone: "Europe/Dublin", days: 30, cover: "fold",
    tiers: [
      { id: "fold-here-zine", title: "Zine", description: "One copy of the zine.", price: 600, quantity: null, shipping: [120, 250, 400] },
      { id: "fold-here-zine-and-print", title: "Zine and risograph print", description: "The zine and an A3 two-colour risograph print.", price: 1500, quantity: 25, shipping: [200, 450, 750] },
    ],
  },
  {
    id: "wet-ink-almanac", creator: "mara-quillfeather", status: "draft", title: "Wet Ink Almanac",
    story: "A year of tide tables, moon phases and printing notes, one spread a week.",
    goal: 150_000, minRun: 200, stretch: [], shipsFrom: "GB", zone: "Europe/London", days: 21, cover: null,
    tiers: [{ id: "wet-ink-almanac-copy", title: "Almanac", description: "One copy of the almanac.", price: 1800, quantity: null, shipping: [400, 800, 1200] }],
  },
];

/** 20:00 local on the date `days` after today in `zone`. */
function deadline(zone: string, days: number): { local: string; utc: Date } {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  const local = { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: 20, minute: 0, second: 0 };
  return { local: localText(local), utc: new Date(zonedInstant(local, zone) as number) };
}

async function insertCampaign(db: Db, c: SeedCampaign, order: number): Promise<void> {
  const when = deadline(c.zone, c.days);
  await db.query(
    `INSERT INTO campaigns (id, creator_id, title, story, status, goal, min_run_copies, stretch, ships_from, time_zone, deadline_local, deadline_utc, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [c.id, c.creator, c.title, c.story, c.status, c.goal, c.minRun, JSON.stringify(c.stretch), c.shipsFrom, c.zone, when.local, when.utc, new Date(Date.now() + order)],
  );
  for (const [n, t] of c.tiers.entries()) {
    await db.query(
      `INSERT INTO tiers (id, campaign_id, title, description, price, quantity, ship_domestic, ship_europe, ship_rest_of_world, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [t.id, c.id, t.title, t.description, t.price, t.quantity, ...t.shipping, new Date(Date.now() + n)],
    );
  }
  if (c.cover) await insertMedia(db, c.id, "cover", "image/png", coverPng(COVER_TONES[c.cover]).length, `${c.id}-cover`);
}

export async function seed(): Promise<void> {
  if (await one(pool, "SELECT 1 FROM people WHERE id = $1", [PEOPLE[0].id])) return;
  await tx(async (db) => {
    for (const p of PEOPLE) await insertPerson(db, p.name, p.email, p.key, p.id);
    for (const [n, c] of CAMPAIGNS.entries()) await insertCampaign(db, c, n);
  });
}

/** Stores any seeded cover the bucket does not hold yet; runs at start and every 10 s while one is missing. */
export async function storeSeedCovers(): Promise<void> {
  const missing = await rows<MediaRecord>(pool, "SELECT * FROM media WHERE id = ANY($1) AND status <> 'stored'",
    [CAMPAIGNS.filter((c) => c.cover).map((c) => `${c.id}-cover`)]);
  for (const media of missing) {
    const seeded = CAMPAIGNS.find((c) => media.id === `${c.id}-cover`);
    if (seeded?.cover && !(await storeMedia(media, coverPng(COVER_TONES[seeded.cover])))) return;
  }
}
