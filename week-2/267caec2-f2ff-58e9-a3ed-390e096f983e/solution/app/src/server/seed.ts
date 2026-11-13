import { createHash } from "node:crypto";
import type pg from "pg";
import { hashPassword } from "./auth.js";
import { encodePng } from "./images.js";
import { StorageUnavailable, objectExists, putObject } from "./storage.js";
import type { Award } from "./rules.js";
import { zoneDate } from "./time.js";

// Seed data, inserted only when missing (brief: Seed data). Ids are derived from stable seed keys.

function seedId(key: string): string {
  const hex = createHash("sha256").update(`cutline-seed:${key}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const STUDIOS = [
  { name: "Halftone Works", contact: "Dario Feld", email: "studio@halftone.example", password: "halftone-pass-26" },
  { name: "Fieldnote Studio", contact: "Leni Marsh", email: "hello@fieldnote.example", password: "fieldnote-pass-26" },
  { name: "Parallax & Pine", contact: "Ayo Mensah", email: "team@parallaxpine.example", password: "parallax-pass-26" },
  { name: "Mono Harbour", contact: "Kit Okonkwo", email: "desk@monoharbour.example", password: "monoharbour-pass-26" },
] as const;

const JURORS = [
  { name: "Ines Varga", email: "ines@jury.example", home: "Halftone Works", conflict: null },
  { name: "Teo Brandt", email: "teo@jury.example", home: null, conflict: null },
  { name: "Priya Raman", email: "priya@jury.example", home: null, conflict: null },
  { name: "Olu Adeyemi", email: "olu@jury.example", home: null, conflict: null },
  { name: "Sana Kobayashi", email: "sana@jury.example", home: null, conflict: { studio: "Fieldnote Studio", note: "Former client" } },
  { name: "Ruth Calder", email: "ruth@jury.example", home: null, conflict: null },
] as const;


interface PastEntry {
  number: number;
  title: string;
  studio: string;
  r1: [number, string];
  final: [number, string];
  award: Award;
}

interface PastCategory {
  name: string;
  shortlist: number;
  finalists: number;
  embargo: string;
  entries: PastEntry[];
}

const PAST: { name: string; year: number; earlyBird: string; deadline: string; categories: PastCategory[] }[] = [
  {
    name: "Cutline Annual 2025", year: 2025, earlyBird: "2025-08-15", deadline: "2025-09-30",
    categories: [
      {
        name: "Portfolio", shortlist: 4, finalists: 2, embargo: "2025-11-20T19:00:00Z",
        entries: [
          { number: 3, title: "Tidewater Archive", studio: "Parallax & Pine", r1: [2, "7.10"], final: [1, "8.42"], award: "winner" },
          { number: 7, title: "Glasshouse Index", studio: "Mono Harbour", r1: [1, "7.65"], final: [2, "7.91"], award: "finalist" },
          { number: 12, title: "Northbound Letters", studio: "Fieldnote Studio", r1: [3, "6.48"], final: [3, "6.88"], award: "honourable_mention" },
          { number: 11, title: "Small Hours Press", studio: "Halftone Works", r1: [4, "6.20"], final: [4, "6.05"], award: "honourable_mention" },
        ],
      },
      {
        name: "Editorial", shortlist: 3, finalists: 2, embargo: "2025-11-20T19:00:00Z",
        entries: [
          { number: 2, title: "Paper Weather", studio: "Fieldnote Studio", r1: [3, "6.02"], final: [1, "7.88"], award: "winner" },
          { number: 5, title: "The Long Table", studio: "Halftone Works", r1: [1, "7.44"], final: [2, "7.20"], award: "finalist" },
          { number: 9, title: "Signal Garden", studio: "Mono Harbour", r1: [2, "6.90"], final: [3, "6.31"], award: "honourable_mention" },
        ],
      },
    ],
  },
  {
    name: "Cutline Annual 2024", year: 2024, earlyBird: "2024-08-15", deadline: "2024-09-30",
    categories: [
      {
        name: "Portfolio", shortlist: 3, finalists: 2, embargo: "2024-11-21T19:00:00Z",
        entries: [
          { number: 4, title: "Quiet Machines", studio: "Mono Harbour", r1: [1, "7.80"], final: [1, "8.05"], award: "winner" },
          { number: 6, title: "Saltmarsh Almanac", studio: "Parallax & Pine", r1: [2, "7.02"], final: [2, "7.12"], award: "finalist" },
          { number: 8, title: "Index of Rooms", studio: "Halftone Works", r1: [3, "6.66"], final: [3, "6.40"], award: "honourable_mention" },
        ],
      },
    ],
  },
];

const OPEN_CATEGORIES = [
  { name: "Portfolio", shortlist: 5, finalists: 3 },
  { name: "Editorial", shortlist: 5, finalists: 3 },
  { name: "Commerce", shortlist: 4, finalists: 2 },
];

const IMAGE_WIDTH = 1280;
const IMAGE_HEIGHT = 800;

/** A drawn case-study screenshot: a browser frame, a hero band, a type block and a card grid in one palette. */
function drawCaseStudy(seed: string): Buffer {
  const bytes = createHash("sha256").update(seed).digest();
  const pick = (i: number) => bytes[i % bytes.length] ?? 0;
  const hue = (pick(0) / 255) * 360;
  const colour = (h: number, s: number, l: number): [number, number, number] => {
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
    return [f(0), f(8), f(4)];
  };
  const ground = colour(hue, 0.25, 0.94);
  const ink = colour(hue, 0.35, 0.14);
  const accent = colour((hue + 150) % 360, 0.7, 0.52);
  const soft = colour(hue, 0.3, 0.82);
  const data = Buffer.alloc(IMAGE_WIDTH * IMAGE_HEIGHT * 4);
  const rect = (x: number, y: number, w: number, h: number, [r, g, b]: [number, number, number]) => {
    for (let row = Math.max(0, y); row < Math.min(IMAGE_HEIGHT, y + h); row++) {
      for (let col = Math.max(0, x); col < Math.min(IMAGE_WIDTH, x + w); col++) {
        const i = (row * IMAGE_WIDTH + col) * 4;
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
      }
    }
  };
  rect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT, ground);
  rect(0, 0, IMAGE_WIDTH, 44, ink);
  [0, 1, 2].forEach((i) => rect(24 + i * 26, 15, 14, 14, i === 0 ? accent : soft));
  rect(120, 12, 560, 20, colour(hue, 0.2, 0.3));
  const heroHeight = 220 + (pick(1) % 120);
  rect(64, 92, IMAGE_WIDTH - 128, heroHeight, pick(2) % 2 ? accent : ink);
  rect(104, 132, 420 + (pick(3) % 260), 54, ground);
  rect(104, 204, 300 + (pick(4) % 200), 18, soft);
  rect(104, 234, 240 + (pick(5) % 180), 18, soft);
  const top = 92 + heroHeight + 48;
  const columns = 3 + (pick(6) % 2);
  const gap = 32;
  const width = Math.floor((IMAGE_WIDTH - 128 - gap * (columns - 1)) / columns);
  for (let c = 0; c < columns; c++) {
    const x = 64 + c * (width + gap);
    rect(x, top, width, 150, c === pick(7) % columns ? accent : soft);
    rect(x, top + 170, Math.floor(width * 0.8), 16, ink);
    rect(x, top + 196, Math.floor(width * 0.6), 12, colour(hue, 0.2, 0.55));
  }
  return encodePng({ width: IMAGE_WIDTH, height: IMAGE_HEIGHT, data, alpha: false });
}

async function seedPeople(client: pg.PoolClient): Promise<void> {
  const director = seedId("user:director");
  await client.query(`INSERT INTO users (id, role, name, email, password_hash) VALUES ($1, 'director', 'Mara Lindqvist',
    'director@cutline.example', $2) ON CONFLICT DO NOTHING`, [director, await hashPassword("director-pass-26")]);
  for (const studio of STUDIOS) {
    const studioId = seedId(`studio:${studio.name}`);
    await client.query("INSERT INTO studios (id, name, contact_name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [studioId, studio.name, studio.contact]);
    await client.query(`INSERT INTO users (id, role, name, email, password_hash, studio_id) VALUES ($1, 'studio', $2, $3, $4, $5)
      ON CONFLICT DO NOTHING`, [seedId(`user:${studio.email}`), studio.contact, studio.email, await hashPassword(studio.password), studioId]);
  }
  for (const juror of JURORS) {
    const jurorId = seedId(`user:${juror.email}`);
    await client.query(`INSERT INTO users (id, role, name, email, password_hash, studio_id) VALUES ($1, 'juror', $2, $3, $4, $5)
      ON CONFLICT DO NOTHING`, [jurorId, juror.name, juror.email, await hashPassword("juror-pass-26"),
      juror.home ? seedId(`studio:${juror.home}`) : null]);
    if (juror.conflict) {
      await client.query("INSERT INTO conflicts (juror_id, studio_id, note) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        [jurorId, seedId(`studio:${juror.conflict.studio}`), juror.conflict.note]);
    }
  }
}

async function seedOpenProgram(client: pg.PoolClient): Promise<void> {
  const id = seedId("program:open-call");
  const zone = "Asia/Kolkata";
  const now = new Date();
  const deadline = zoneDate(now, zone, 60);
  const inserted = await client.query(`INSERT INTO programs (id, name, year, time_zone, early_bird_date, deadline_date,
    early_bird_fee_cents, standard_fee_cents) VALUES ($1, 'Cutline Open Call', $2, $3, $4, $5, 4500, 7000) ON CONFLICT DO NOTHING`,
  [id, Number(deadline.slice(0, 4)), zone, zoneDate(now, zone, 30), deadline]);
  if (!inserted.rowCount) return;
  for (const category of OPEN_CATEGORIES) {
    const categoryId = seedId(`category:open-call:${category.name}`);
    await client.query("INSERT INTO categories (id, program_id, name, shortlist_size, finalist_count) VALUES ($1, $2, $3, $4, $5)",
      [categoryId, id, category.name, category.shortlist, category.finalists]);
    await client.query(`INSERT INTO rounds (id, category_id, kind, name) VALUES ($1, $3, 'round_1', 'Round 1'), ($2, $3, 'final', 'Final round')`,
      [seedId(`round:${categoryId}:round_1`), seedId(`round:${categoryId}:final`), categoryId]);
  }
}

async function seedPastPrograms(client: pg.PoolClient): Promise<void> {
  for (const program of PAST) {
    const programId = seedId(`program:${program.name}`);
    const inserted = await client.query(`INSERT INTO programs (id, name, year, time_zone, early_bird_date, deadline_date,
      early_bird_fee_cents, standard_fee_cents, last_entry_number) VALUES ($1, $2, $3, 'Europe/Lisbon', $4, $5, 4500, 7000, 12)
      ON CONFLICT DO NOTHING`, [programId, program.name, program.year, program.earlyBird, program.deadline]);
    if (!inserted.rowCount) continue;
    for (const category of program.categories) {
      const categoryId = seedId(`category:${program.name}:${category.name}`);
      const r1 = seedId(`round:${categoryId}:round_1`);
      const fin = seedId(`round:${categoryId}:final`);
      await client.query(`INSERT INTO categories (id, program_id, name, shortlist_size, finalist_count, embargo_at)
        VALUES ($1, $2, $3, $4, $5, $6)`, [categoryId, programId, category.name, category.shortlist, category.finalists, category.embargo]);
      await client.query(`INSERT INTO rounds (id, category_id, kind, name, state, ballot_deadline, opened_at, closed_at)
        VALUES ($1, $3, 'round_1', 'Round 1', 'published', $4, $5, $5), ($2, $3, 'final', 'Final round', 'published', $4, $5, $5)`,
      [r1, fin, categoryId, program.deadline, `${program.deadline}T12:00:00Z`]);
      for (const entry of category.entries) {
        const entryId = seedId(`entry:${program.name}:${entry.number}`);
        await client.query(`INSERT INTO entries (id, program_id, category_id, studio_id, entry_number, title, summary, site_url, credits,
          state, award, submitted_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '', 'published', $9, $10)`,
        [entryId, programId, categoryId, seedId(`studio:${entry.studio}`), entry.number, entry.title,
          `${entry.title} — a case study entered in ${category.name}, ${program.year}.`,
          `https://${entry.title.toLowerCase().replace(/[^a-z]+/g, "-")}.example`, entry.award, `${program.deadline}T09:00:00Z`]);
        for (const [roundId, [rank, score]] of [[r1, entry.r1], [fin, entry.final]] as const) {
          const cut = rank <= (roundId === r1 ? category.shortlist : category.finalists) ? "above" : "below";
          await client.query("INSERT INTO round_entries (round_id, entry_id) VALUES ($1, $2)", [roundId, entryId]);
          await client.query(`INSERT INTO round_results (round_id, entry_id, rank, score, ballots_counted, cut, award)
            VALUES ($1, $2, $3, $4, 0, $5, $6)`, [roundId, entryId, rank, score, cut, roundId === fin ? entry.award : null]);
        }
        for (const k of [1, 2]) {
          const assetId = seedId(`asset:${entryId}:${k}`);
          const bytes = drawCaseStudy(assetId).length;
          await client.query(`INSERT INTO assets (id, entry_id, name, type, width, height, bytes, storage_key)
            VALUES ($1, $2, $3, 'image/png', $4, $5, $6, $7)`,
          [assetId, entryId, `${entry.title.toLowerCase().replace(/[^a-z]+/g, "-")}-${k}.png`, IMAGE_WIDTH, IMAGE_HEIGHT, bytes,
            `entries/${entryId}/${assetId}.png`]);
        }
      }
    }
  }
}

export async function seed(client: pg.PoolClient): Promise<void> {
  await seedPeople(client);
  await seedOpenProgram(client);
  await seedPastPrograms(client);
}

/** Writes each seeded gallery image to storage when missing. */
async function seedImages(): Promise<void> {
  for (const program of PAST) {
    for (const category of program.categories) {
      for (const entry of category.entries) {
        const entryId = seedId(`entry:${program.name}:${entry.number}`);
        for (const k of [1, 2]) {
          const assetId = seedId(`asset:${entryId}:${k}`);
          const key = `entries/${entryId}/${assetId}.png`;
          if (!(await objectExists(key))) await putObject(key, drawCaseStudy(assetId), "image/png");
        }
      }
    }
  }
}

/** Retries the seeded images every 5 seconds until storage has accepted all of them. */
export async function runSeedImages(): Promise<void> {
  for (;;) {
    try {
      await seedImages();
      return;
    } catch (error) {
      if (!(error instanceof StorageUnavailable)) console.error(`seed images: ${(error as Error).message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}
