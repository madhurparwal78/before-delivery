import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { pool, newId } from './db';
import { hashPassword } from './http/session';
import { localParts, instantFromLocal } from './domain/time';

const OPEN_PROGRAM = 'Cutline Open Call';
const OPEN_ZONE = 'Asia/Kolkata';
const PAST_ZONE = 'Europe/Lisbon';

interface SeedStudio {
  name: string;
  contact: string;
  email: string;
  password: string;
}

const STUDIOS: SeedStudio[] = [
  { name: 'Halftone Works', contact: 'Dario Feld', email: 'studio@halftone.example', password: 'halftone-pass-26' },
  { name: 'Fieldnote Studio', contact: 'Leni Marsh', email: 'hello@fieldnote.example', password: 'fieldnote-pass-26' },
  { name: 'Parallax & Pine', contact: 'Ayo Mensah', email: 'team@parallaxpine.example', password: 'parallax-pass-26' },
  { name: 'Mono Harbour', contact: 'Kit Okonkwo', email: 'desk@monoharbour.example', password: 'monoharbour-pass-26' },
];

const JURORS: { name: string; email: string; homeStudio: string | null; conflicts: [string, string][] }[] = [
  { name: 'Ines Varga', email: 'ines@jury.example', homeStudio: 'Halftone Works', conflicts: [] },
  { name: 'Teo Brandt', email: 'teo@jury.example', homeStudio: null, conflicts: [] },
  { name: 'Priya Raman', email: 'priya@jury.example', homeStudio: null, conflicts: [] },
  { name: 'Olu Adeyemi', email: 'olu@jury.example', homeStudio: null, conflicts: [] },
  {
    name: 'Sana Kobayashi',
    email: 'sana@jury.example',
    homeStudio: null,
    conflicts: [['Fieldnote Studio', 'Former client']],
  },
  { name: 'Ruth Calder', email: 'ruth@jury.example', homeStudio: null, conflicts: [] },
];

interface SeedEntry {
  entryNumber: number;
  title: string;
  studio: string;
  roundOneRank: number;
  roundOneScore: string;
  finalRank: number;
  finalScore: string;
  award: 'winner' | 'finalist' | 'honourable_mention';
}

interface SeedCategory {
  name: string;
  shortlistSize: number;
  finalistCount: number;
  entries: SeedEntry[];
}

interface SeedProgram {
  name: string;
  year: number;
  earlyBirdDate: string;
  deadlineDate: string;
  embargoAt: string;
  categories: SeedCategory[];
}

const PAST_PROGRAMS: SeedProgram[] = [
  {
    name: 'Cutline Annual 2025',
    year: 2025,
    earlyBirdDate: '2025-03-31',
    deadlineDate: '2025-04-30',
    embargoAt: '2025-06-12T19:00:00Z',
    categories: [
      {
        name: 'Portfolio',
        shortlistSize: 4,
        finalistCount: 2,
        entries: [
          { entryNumber: 3, title: 'Tidewater Archive', studio: 'Parallax & Pine', roundOneRank: 2, roundOneScore: '7.10', finalRank: 1, finalScore: '8.42', award: 'winner' },
          { entryNumber: 7, title: 'Glasshouse Index', studio: 'Mono Harbour', roundOneRank: 1, roundOneScore: '7.65', finalRank: 2, finalScore: '7.91', award: 'finalist' },
          { entryNumber: 12, title: 'Northbound Letters', studio: 'Fieldnote Studio', roundOneRank: 3, roundOneScore: '6.48', finalRank: 3, finalScore: '6.88', award: 'honourable_mention' },
          { entryNumber: 11, title: 'Small Hours Press', studio: 'Halftone Works', roundOneRank: 4, roundOneScore: '6.20', finalRank: 4, finalScore: '6.05', award: 'honourable_mention' },
        ],
      },
      {
        name: 'Editorial',
        shortlistSize: 3,
        finalistCount: 2,
        entries: [
          { entryNumber: 2, title: 'Paper Weather', studio: 'Fieldnote Studio', roundOneRank: 3, roundOneScore: '6.02', finalRank: 1, finalScore: '7.88', award: 'winner' },
          { entryNumber: 5, title: 'The Long Table', studio: 'Halftone Works', roundOneRank: 1, roundOneScore: '7.44', finalRank: 2, finalScore: '7.20', award: 'finalist' },
          { entryNumber: 9, title: 'Signal Garden', studio: 'Mono Harbour', roundOneRank: 2, roundOneScore: '6.90', finalRank: 3, finalScore: '6.31', award: 'honourable_mention' },
        ],
      },
    ],
  },
  {
    name: 'Cutline Annual 2024',
    year: 2024,
    earlyBirdDate: '2024-03-31',
    deadlineDate: '2024-04-30',
    embargoAt: '2024-06-13T19:00:00Z',
    categories: [
      {
        name: 'Portfolio',
        shortlistSize: 3,
        finalistCount: 2,
        entries: [
          { entryNumber: 4, title: 'Quiet Machines', studio: 'Mono Harbour', roundOneRank: 1, roundOneScore: '7.80', finalRank: 1, finalScore: '8.05', award: 'winner' },
          { entryNumber: 6, title: 'Saltmarsh Almanac', studio: 'Parallax & Pine', roundOneRank: 2, roundOneScore: '7.02', finalRank: 2, finalScore: '7.12', award: 'finalist' },
          { entryNumber: 8, title: 'Index of Rooms', studio: 'Halftone Works', roundOneRank: 3, roundOneScore: '6.66', finalRank: 3, finalScore: '6.40', award: 'honourable_mention' },
        ],
      },
    ],
  },
];

const ARTWORK_WIDTH = 1024;
const ARTWORK_HEIGHT = 768;
const PALETTE = [
  [250, 248, 243],
  [23, 22, 20],
  [214, 64, 35],
  [21, 52, 173],
  [168, 162, 150],
];

/** A deterministic flat-colour composition so the gallery ships no raster files. */
export function drawArtwork(seed: string): Buffer {
  const digest = createHash('sha256').update(seed).digest();
  const png = new PNG({ width: ARTWORK_WIDTH, height: ARTWORK_HEIGHT });
  const ground = PALETTE[0];
  const bars = 4 + (digest[0] % 4);
  for (let y = 0; y < ARTWORK_HEIGHT; y += 1) {
    for (let x = 0; x < ARTWORK_WIDTH; x += 1) {
      const band = Math.floor((x / ARTWORK_WIDTH) * bars);
      const wave = Math.sin((x / ARTWORK_WIDTH) * Math.PI * (1 + (digest[band % 32] % 3)));
      const edge = ARTWORK_HEIGHT * (0.25 + 0.5 * ((digest[(band * 3) % 32] / 255) * 0.6 + wave * 0.2));
      const colour = y > edge ? PALETTE[1 + (digest[(band + 7) % 32] % 4)] : ground;
      const index = (y * ARTWORK_WIDTH + x) << 2;
      png.data[index] = colour[0];
      png.data[index + 1] = colour[1];
      png.data[index + 2] = colour[2];
      png.data[index + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

export const ARTWORK_SIZE = { width: ARTWORK_WIDTH, height: ARTWORK_HEIGHT };

async function studioIdByName(name: string): Promise<string> {
  const found = await pool.query<{ id: string }>('SELECT id FROM studios WHERE name = $1', [name]);
  return found.rows[0].id;
}

async function seedPeople(): Promise<void> {
  const director = await pool.query('SELECT 1 FROM users WHERE email = $1', ['director@cutline.example']);
  if (director.rowCount === 0) {
    await pool.query(
      "INSERT INTO users (id, role, name, email, password_hash) VALUES ($1, 'director', $2, $3, $4)",
      [newId('usr'), 'Mara Lindqvist', 'director@cutline.example', await hashPassword('director-pass-26')],
    );
  }
  for (const studio of STUDIOS) {
    const existing = await pool.query('SELECT 1 FROM studios WHERE name = $1', [studio.name]);
    if (existing.rowCount !== 0) continue;
    const studioId = newId('std');
    await pool.query('INSERT INTO studios (id, name, contact_name, email) VALUES ($1, $2, $3, $4)', [
      studioId,
      studio.name,
      studio.contact,
      studio.email,
    ]);
    await pool.query(
      "INSERT INTO users (id, role, name, email, password_hash, studio_id) VALUES ($1, 'studio', $2, $3, $4, $5)",
      [newId('usr'), studio.contact, studio.email, await hashPassword(studio.password), studioId],
    );
  }
  for (const juror of JURORS) {
    const existing = await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [juror.email]);
    let jurorId = existing.rows[0]?.id;
    if (jurorId === undefined) {
      jurorId = newId('usr');
      await pool.query(
        "INSERT INTO users (id, role, name, email, password_hash, studio_id) VALUES ($1, 'juror', $2, $3, $4, $5)",
        [
          jurorId,
          juror.name,
          juror.email,
          await hashPassword('juror-pass-26'),
          juror.homeStudio === null ? null : await studioIdByName(juror.homeStudio),
        ],
      );
    }
    for (const [studioName, note] of juror.conflicts) {
      await pool.query(
        'INSERT INTO conflicts (juror_id, studio_id, note) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [jurorId, await studioIdByName(studioName), note],
      );
    }
  }
}

function shiftDays(from: Date, days: number, timeZone: string): string {
  const parts = localParts(from, timeZone);
  const moved = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`;
}

async function seedOpenProgram(): Promise<void> {
  const existing = await pool.query('SELECT 1 FROM programs WHERE name = $1', [OPEN_PROGRAM]);
  if (existing.rowCount !== 0) return;
  const now = new Date();
  const earlyBirdDate = shiftDays(now, 30, OPEN_ZONE);
  const deadlineDate = shiftDays(now, 60, OPEN_ZONE);
  const programId = newId('prg');
  await pool.query(
    `INSERT INTO programs (id, name, year, time_zone, early_bird_date, deadline_date,
       early_bird_fee_cents, standard_fee_cents)
     VALUES ($1, $2, $3, $4, $5, $6, 4500, 7000)`,
    [programId, OPEN_PROGRAM, Number(deadlineDate.slice(0, 4)), OPEN_ZONE, earlyBirdDate, deadlineDate],
  );
  for (const [name, shortlist, finalists] of [
    ['Portfolio', 5, 3],
    ['Editorial', 5, 3],
    ['Commerce', 4, 2],
  ] as [string, number, number][]) {
    const categoryId = newId('cat');
    await pool.query(
      'INSERT INTO categories (id, program_id, name, shortlist_size, finalist_count) VALUES ($1, $2, $3, $4, $5)',
      [categoryId, programId, name, shortlist, finalists],
    );
    await pool.query(
      `INSERT INTO rounds (id, category_id, name, kind) VALUES ($1, $2, 'Round 1', 'round_1'), ($3, $2, 'Final round', 'final')`,
      [newId('rnd'), categoryId, newId('rnd')],
    );
  }
}

async function seedPastProgram(program: SeedProgram): Promise<void> {
  const existing = await pool.query('SELECT 1 FROM programs WHERE name = $1', [program.name]);
  if (existing.rowCount !== 0) return;

  const programId = newId('prg');
  const numbers = program.categories.flatMap((category) => category.entries.map((entry) => entry.entryNumber));
  await pool.query(
    `INSERT INTO programs (id, name, year, time_zone, early_bird_date, deadline_date,
       early_bird_fee_cents, standard_fee_cents, next_entry_number)
     VALUES ($1, $2, $3, $4, $5, $6, 4500, 7000, $7)`,
    [
      programId,
      program.name,
      program.year,
      PAST_ZONE,
      program.earlyBirdDate,
      program.deadlineDate,
      Math.max(...numbers) + 1,
    ],
  );

  for (const category of program.categories) {
    const categoryId = newId('cat');
    await pool.query(
      `INSERT INTO categories (id, program_id, name, shortlist_size, finalist_count, published, embargo_at, results_queued)
       VALUES ($1, $2, $3, $4, $5, true, $6, true)`,
      [categoryId, programId, category.name, category.shortlistSize, category.finalistCount, program.embargoAt],
    );
    const roundOneId = newId('rnd');
    const finalId = newId('rnd');
    const ballotDeadline = program.deadlineDate;
    await pool.query(
      `INSERT INTO rounds (id, category_id, name, kind, state, ballot_deadline, opened_at, closed_at)
       VALUES ($1, $2, 'Round 1', 'round_1', 'published', $3, $4, $4),
              ($5, $2, 'Final round', 'final', 'published', $3, $4, $4)`,
      [roundOneId, categoryId, ballotDeadline, program.embargoAt, finalId],
    );

    for (const entry of category.entries) {
      const entryId = newId('ent');
      const submittedAt = instantFromLocal(
        {
          year: program.year,
          month: 4,
          day: 10,
          hour: 9,
          minute: entry.entryNumber,
          second: 0,
        },
        PAST_ZONE,
      );
      await pool.query(
        `INSERT INTO entries (id, program_id, category_id, studio_id, entry_number, title, summary,
           site_url, credits, state, award, submitted_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'published', $10, $11, $11)`,
        [
          entryId,
          programId,
          categoryId,
          await studioIdByName(entry.studio),
          entry.entryNumber,
          entry.title,
          `${entry.title} is a ${category.name.toLowerCase()} case study built for ${entry.studio}: a slow, typographic site that puts the work before the interface.`,
          `https://${entry.title.toLowerCase().replace(/[^a-z]+/g, '-')}.example`,
          `Design and build: ${entry.studio}`,
          entry.award,
          submittedAt,
        ],
      );
      for (let index = 0; index < 2; index += 1) {
        const assetId = newId('ast');
        const artwork = drawArtwork(assetId);
        await pool.query(
          `INSERT INTO assets (id, entry_id, storage_key, name, content_type, width, height, bytes, generated)
           VALUES ($1, $2, $3, $4, 'image/png', $5, $6, $7, true)`,
          [
            assetId,
            entryId,
            `entries/${entryId}/${assetId}.png`,
            `${entry.title.toLowerCase().replace(/[^a-z]+/g, '-')}-${index + 1}.png`,
            ARTWORK_WIDTH,
            ARTWORK_HEIGHT,
            artwork.length,
          ],
        );
      }
      await pool.query(
        `INSERT INTO round_results (round_id, entry_id, score, idea_mean, ballots_counted, rank, cut)
         VALUES ($1, $2, $3, $4, 0, $5, $6), ($7, $2, $8, $9, 0, $10, $11)`,
        [
          roundOneId,
          entryId,
          entry.roundOneScore,
          entry.roundOneScore,
          entry.roundOneRank,
          entry.roundOneRank <= category.shortlistSize ? 'above' : 'below',
          finalId,
          entry.finalScore,
          entry.finalScore,
          entry.finalRank,
          entry.finalRank <= category.finalistCount ? 'above' : 'below',
        ],
      );
    }
  }
}

export async function applySeed(): Promise<void> {
  await seedPeople();
  await seedOpenProgram();
  for (const program of PAST_PROGRAMS) await seedPastProgram(program);
}
