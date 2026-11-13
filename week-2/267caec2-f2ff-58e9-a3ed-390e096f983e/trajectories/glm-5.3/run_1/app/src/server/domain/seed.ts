import type { Db, PoolClient } from "../db.js";
import { newId, row, rows } from "../db.js";
import { hashPassword, formatStoredHash } from "./passwords.js";
import { addDaysInZone, isoDate } from "./time.js";
import { drawSeedImage, assetKey } from "./images.js";
import type { Storage } from "../providers/storage.js";

interface SeedStudio {
  name: string;
  contact: string;
  email: string;
  password: string;
}

const SEED_STUDIOS: SeedStudio[] = [
  { name: "Halftone Works", contact: "Dario Feld", email: "studio@halftone.example", password: "halftone-pass-26" },
  { name: "Fieldnote Studio", contact: "Leni Marsh", email: "hello@fieldnote.example", password: "fieldnote-pass-26" },
  { name: "Parallax & Pine", contact: "Ayo Mensah", email: "team@parallaxpine.example", password: "parallax-pass-26" },
  { name: "Mono Harbour", contact: "Kit Okonkwo", email: "desk@monoharbour.example", password: "monoharbour-pass-26" },
];

interface SeedJuror {
  name: string;
  email: string;
  homeStudio: string | null;
  conflicts: { studio: string; note: string | null }[];
}

const SEED_JURORS: SeedJuror[] = [
  { name: "Ines Varga", email: "ines@jury.example", homeStudio: "Halftone Works", conflicts: [] },
  { name: "Teo Brandt", email: "teo@jury.example", homeStudio: null, conflicts: [] },
  { name: "Priya Raman", email: "priya@jury.example", homeStudio: null, conflicts: [] },
  { name: "Olu Adeyemi", email: "olu@jury.example", homeStudio: null, conflicts: [] },
  { name: "Sana Kobayashi", email: "sana@jury.example", homeStudio: null, conflicts: [{ studio: "Fieldnote Studio", note: "Former client" }] },
  { name: "Ruth Calder", email: "ruth@jury.example", homeStudio: null, conflicts: [] },
];

interface PastEntry {
  entryNumber: number;
  title: string;
  studio: string;
  category: string;
  r1Rank: number;
  r1Score: string;
  finalRank: number;
  finalScore: string;
  award: "winner" | "finalist" | "honourable_mention";
}

interface PastCategory {
  name: string;
  shortlistSize: number;
  finalists: number;
  entries: PastEntry[];
}

interface PastProgram {
  name: string;
  year: number;
  categories: PastCategory[];
}

const PAST_PROGRAMS: PastProgram[] = [
  {
    name: "Cutline Annual 2025",
    year: 2025,
    categories: [
      {
        name: "Portfolio",
        shortlistSize: 4,
        finalists: 2,
        entries: [
          { entryNumber: 3, title: "Tidewater Archive", studio: "Parallax & Pine", category: "Portfolio", r1Rank: 2, r1Score: "7.10", finalRank: 1, finalScore: "8.42", award: "winner" },
          { entryNumber: 7, title: "Glasshouse Index", studio: "Mono Harbour", category: "Portfolio", r1Rank: 1, r1Score: "7.65", finalRank: 2, finalScore: "7.91", award: "finalist" },
          { entryNumber: 12, title: "Northbound Letters", studio: "Fieldnote Studio", category: "Portfolio", r1Rank: 3, r1Score: "6.48", finalRank: 3, finalScore: "6.88", award: "honourable_mention" },
          { entryNumber: 11, title: "Small Hours Press", studio: "Halftone Works", category: "Portfolio", r1Rank: 4, r1Score: "6.20", finalRank: 4, finalScore: "6.05", award: "honourable_mention" },
        ],
      },
      {
        name: "Editorial",
        shortlistSize: 3,
        finalists: 2,
        entries: [
          { entryNumber: 2, title: "Paper Weather", studio: "Fieldnote Studio", category: "Editorial", r1Rank: 3, r1Score: "6.02", finalRank: 1, finalScore: "7.88", award: "winner" },
          { entryNumber: 5, title: "The Long Table", studio: "Halftone Works", category: "Editorial", r1Rank: 1, r1Score: "7.44", finalRank: 2, finalScore: "7.20", award: "finalist" },
          { entryNumber: 9, title: "Signal Garden", studio: "Mono Harbour", category: "Editorial", r1Rank: 2, r1Score: "6.90", finalRank: 3, finalScore: "6.31", award: "honourable_mention" },
        ],
      },
    ],
  },
  {
    name: "Cutline Annual 2024",
    year: 2024,
    categories: [
      {
        name: "Portfolio",
        shortlistSize: 3,
        finalists: 2,
        entries: [
          { entryNumber: 4, title: "Quiet Machines", studio: "Mono Harbour", category: "Portfolio", r1Rank: 1, r1Score: "7.80", finalRank: 1, finalScore: "8.05", award: "winner" },
          { entryNumber: 6, title: "Saltmarsh Almanac", studio: "Parallax & Pine", category: "Portfolio", r1Rank: 2, r1Score: "7.02", finalRank: 2, finalScore: "7.12", award: "finalist" },
          { entryNumber: 8, title: "Index of Rooms", studio: "Halftone Works", category: "Portfolio", r1Rank: 3, r1Score: "6.66", finalRank: 3, finalScore: "6.40", award: "honourable_mention" },
        ],
      },
    ],
  },
];

const ZONE_PAST = "Europe/Lisbon";
const ZONE_OPEN = "Asia/Kolkata";

export async function applySeed(db: Db, storage: Storage): Promise<void> {
  const seeded = await row<{ id: string }>(db, "SELECT id FROM users WHERE email = 'director@cutline.example'");
  if (seeded) {
    return;
  }
  await db.transaction(async (client) => {
    const studioIds = await seedPeople(client);
    await seedOpenProgram(client);
    await seedPastPrograms(client, storage, studioIds);
  });
}

async function seedPeople(db: PoolClient): Promise<Map<string, string>> {
  const directorId = newId("usr");
  await db.query(
    "INSERT INTO users (id, role, name, email, password_hash) VALUES ($1, 'director', $2, $3, $4)",
    [directorId, "Mara Lindqvist", "director@cutline.example", formatStoredHash(hashPassword("director-pass-26"))],
  );
  const studioIds = new Map<string, string>();
  for (const studio of SEED_STUDIOS) {
    const studioId = newId("stu");
    await db.query(
      "INSERT INTO studios (id, name, contact_name, email) VALUES ($1, $2, $3, $4)",
      [studioId, studio.name, studio.contact, studio.email],
    );
    await db.query(
      "INSERT INTO users (id, role, name, email, password_hash, studio_id) VALUES ($1, 'studio', $2, $3, $4, $5)",
      [newId("usr"), studio.contact, studio.email, formatStoredHash(hashPassword(studio.password)), studioId],
    );
    studioIds.set(studio.name, studioId);
  }
  for (const juror of SEED_JURORS) {
    const homeStudioId = juror.homeStudio ? (studioIds.get(juror.homeStudio) ?? null) : null;
    await db.query(
      "INSERT INTO users (id, role, name, email, password_hash, studio_id) VALUES ($1, 'juror', $2, $3, $4, $5)",
      [newId("usr"), juror.name, juror.email, formatStoredHash(hashPassword("juror-pass-26")), homeStudioId],
    );
  }
  const jurors = await rows<{ id: string; email: string }>(db, "SELECT id, email FROM users WHERE role = 'juror'");
  for (const juror of SEED_JURORS) {
    const dbJuror = jurors.find((j) => j.email === juror.email);
    if (!dbJuror) {
      continue;
    }
    for (const conflict of juror.conflicts) {
      const studioId = studioIds.get(conflict.studio);
      if (!studioId) {
        continue;
      }
      await db.query(
        "INSERT INTO conflicts (id, juror_id, studio_id, note) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
        [newId("con"), dbJuror.id, studioId, conflict.note],
      );
    }
  }
  return studioIds;
}

async function seedOpenProgram(db: PoolClient): Promise<void> {
  const today = isoDate(new Date());
  const earlyBirdDate = addDaysInZone(today, ZONE_OPEN, 30);
  const deadlineDate = addDaysInZone(today, ZONE_OPEN, 60);
  const year = Number(deadlineDate.slice(0, 4));
  const programId = newId("prg");
  await db.query(
    `INSERT INTO programs (id, name, year, time_zone, early_bird_date, deadline_date, early_bird_fee_cents, standard_fee_cents)
     VALUES ($1, $2, $3, $4, $5, $6, 4500, 7000)`,
    [programId, "Cutline Open Call", year, ZONE_OPEN, earlyBirdDate, deadlineDate],
  );
  await db.query("INSERT INTO program_counters (program_id, next_entry_number) VALUES ($1, 1)", [programId]);
  const categories: { name: string; shortlist: number; finalists: number }[] = [
    { name: "Portfolio", shortlist: 5, finalists: 3 },
    { name: "Editorial", shortlist: 5, finalists: 3 },
    { name: "Commerce", shortlist: 4, finalists: 2 },
  ];
  for (const category of categories) {
    await db.query(
      "INSERT INTO categories (id, program_id, name, shortlist_size, finalist_count) VALUES ($1, $2, $3, $4, $5)",
      [newId("cat"), programId, category.name, category.shortlist, category.finalists],
    );
    await db.query(
      "INSERT INTO rounds (id, category_id, name, kind, seq, state) VALUES ($1, (SELECT id FROM categories WHERE program_id = $2 AND name = $3), 'Round 1', 'round_1', 1, 'scheduled')",
      [newId("rnd"), programId, category.name],
    );
    await db.query(
      "INSERT INTO rounds (id, category_id, name, kind, seq, state) VALUES ($1, (SELECT id FROM categories WHERE program_id = $2 AND name = $3), 'Final round', 'final', 2, 'scheduled')",
      [newId("rnd"), programId, category.name],
    );
  }
}

async function seedPastPrograms(db: PoolClient, storage: Storage, studioIds: Map<string, string>): Promise<void> {
  for (const program of PAST_PROGRAMS) {
    const programId = newId("prg");
    const deadlineDate = `${program.year}-11-30`;
    await db.query(
      `INSERT INTO programs (id, name, year, time_zone, early_bird_date, deadline_date, early_bird_fee_cents, standard_fee_cents, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 4500, 7000, now() - interval '400 days')`,
      [programId, program.name, program.year, ZONE_PAST, `${program.year}-09-30`, deadlineDate],
    );
    await db.query("INSERT INTO program_counters (program_id, next_entry_number) VALUES ($1, 1)", [programId]);
    for (const category of program.categories) {
      const categoryId = newId("cat");
      const embargoAt = new Date(Date.UTC(program.year, 11, 15, 12, 0, 0));
      await db.query(
        `INSERT INTO categories (id, program_id, name, shortlist_size, finalist_count, embargo_at, published_at, results_email_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6, $6)`,
        [categoryId, programId, category.name, category.shortlistSize, category.finalists, embargoAt],
      );
      const round1Id = newId("rnd");
      const finalId = newId("rnd");
      await db.query(
        "INSERT INTO rounds (id, category_id, name, kind, seq, state, opened_at, closed_at) VALUES ($1, $2, 'Round 1', 'round_1', 1, 'published', now() - interval '380 days', now() - interval '370 days')",
        [round1Id, categoryId],
      );
      await db.query(
        "INSERT INTO rounds (id, category_id, name, kind, seq, state, opened_at, closed_at) VALUES ($1, $2, 'Final round', 'final', 2, 'published', now() - interval '365 days', now() - interval '360 days')",
        [finalId, categoryId],
      );
      for (const entry of category.entries) {
        await seedPastEntry(db, storage, studioIds, {
          programId,
          categoryId,
          round1Id,
          entry,
        });
      }
      // Stored round results for the leaderboard and gallery.
      const ranked = [...category.entries].sort((a, b) => a.finalRank - b.finalRank);
      const finalRows = ranked.map((entry) => ({
        rank: entry.finalRank,
        entryId: entrySeedKey(programId, categoryId, entry.entryNumber),
        entryNumber: entry.entryNumber,
        title: entry.title,
        categoryName: category.name,
        score: entry.finalScore,
        ideaMean: null,
        ballotsCounted: 0,
        cut: entry.finalRank <= category.finalists ? "above" : "below",
        award: entry.award,
      }));
      await db.query(
        "INSERT INTO round_results (round_id, provisional, rows) VALUES ($1, false, $2)",
        [finalId, JSON.stringify({ provisional: false, cut: category.finalists, cutLabel: "Finalist cut", rows: finalRows })],
      );
      const r1Ranked = [...category.entries].sort((a, b) => a.r1Rank - b.r1Rank);
      const r1Rows = r1Ranked.map((entry) => ({
        rank: entry.r1Rank,
        entryId: entrySeedKey(programId, categoryId, entry.entryNumber),
        entryNumber: entry.entryNumber,
        title: entry.title,
        categoryName: category.name,
        score: entry.r1Score,
        ideaMean: null,
        ballotsCounted: 0,
        cut: entry.r1Rank <= category.shortlistSize ? "above" : "below",
        award: null,
      }));
      await db.query(
        "INSERT INTO round_results (round_id, provisional, rows) VALUES ($1, false, $2)",
        [round1Id, JSON.stringify({ provisional: false, cut: category.shortlistSize, cutLabel: "Shortlist cut", rows: r1Rows })],
      );
    }
  }
}

function entrySeedKey(programId: string, categoryId: string, entryNumber: number): string {
  return `seed-${programId}-${categoryId}-${entryNumber}`;
}

async function seedPastEntry(
  db: PoolClient,
  storage: Storage,
  studioIds: Map<string, string>,
  data: {
    programId: string;
    categoryId: string;
    round1Id: string;
    entry: PastEntry;
  },
): Promise<void> {
  const { entry, programId, categoryId } = data;
  const studioId = studioIds.get(entry.studio);
  if (!studioId) {
    return;
  }
  const entryId = entrySeedKey(programId, categoryId, entry.entryNumber);
  await db.query(
    `INSERT INTO entries (id, program_id, category_id, studio_id, entry_number, title, summary, site_url, credits, state,
      submitted_at, paid_fee_cents, fee_tier, invoice_id, payment_id, paid_at, award, r1_score, r1_rank, final_score, final_rank)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'published',
      now() - interval '420 days', 4500, 'early_bird', $10, $11, now() - interval '420 days', $12, $13, $14, $15, $16)`,
    [
      entryId, programId, categoryId, studioId, entry.entryNumber, entry.title,
      `${entry.title} — a case study drawn from the ${entry.category} shortlist of a past Cutline year.`,
      "https://example.com/case-study",
      "Studio team",
      `kb-inv-${entryId}`, `kb-pay-${entryId}`, entry.award, entry.r1Score, entry.r1Rank, entry.finalScore, entry.finalRank,
    ],
  );
  await db.query(
    "INSERT INTO killbill_mirror (invoice_id, studio_id, entry_id, entry_number, amount_cents, currency, tier, status, paid_at) VALUES ($1, $2, $3, $4, 4500, 'USD', 'early_bird', 'refunded', now() - interval '420 days')",
    [`kb-inv-${entryId}`, studioId, entryId, entry.entryNumber],
  );
  for (let k = 0; k < 2; k++) {
    const assetId = `${entryId}-asset${k + 1}`;
    const image = drawSeedImage(`${entryId}-${k}`, 800, 600);
    await storage.put(assetKey(entryId, assetId, "image/png"), image, "image/png");
    await db.query(
      "INSERT INTO assets (id, entry_id, name, type, width, height, bytes, sort) VALUES ($1, $2, $3, 'image/png', 800, 600, $4, $5)",
      [assetId, entryId, `${entry.title.toLowerCase().replace(/\s+/g, "-")}-${k + 1}.png`, image.length, k],
    );
  }
}
