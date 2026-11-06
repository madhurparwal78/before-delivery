import sharp from "sharp";
import type { Sql } from "./db.js";
import { resolveLiftLocal, isoInstant } from "../shared/time.js";
import { START_CLOCK_MS } from "./clock.js";
import { putOriginal, makeDerivatives } from "./storage.js";
import type { Storage } from "./storage.js";
import { hashPassword } from "./auth.js";

// Seeded frames are procedurally generated halftone images: no stock or copied
// photographs are used. The schema and seed are applied idempotently on every
// boot, and a fresh database also stores the starting clock offset.
const SEED_PASSWORD = "darkroom-proof-26";
let seedPasswordHash: string | null = null;

async function seedHash(): Promise<string> {
  if (!seedPasswordHash) seedPasswordHash = await hashPassword(SEED_PASSWORD);
  return seedPasswordHash;
}

export interface SeedEssay {
  id: string;
  title: string;
  caption: string;
  credits: { handle: string; split_bp: number }[];
  state: "live" | "embargoed" | "in_review" | "draft";
  lift_local: string;
  exclusive_days: number;
  exclusive_price_minor: number;
  standard_days: number;
  standard_price_minor: number;
  frames: number;
  deskNotes?: { note: string }[];
}

export const SEED_ESSAYS: SeedEssay[] = [
  { id: "floodplain-ledger", title: "Floodplain Ledger", caption: "Six months on the levee road after the spring crest.", credits: [{ handle: "ada-reyes", split_bp: 6000 }, { handle: "noor-haddad", split_bp: 4000 }], state: "live", lift_local: "2026-10-20T09:00", exclusive_days: 3, exclusive_price_minor: 45000, standard_days: 7, standard_price_minor: 12000, frames: 6, deskNotes: [{ note: "Family on frame 4 gave consent by phone; keep this off newsroom copy." }] },
  { id: "night-shift-grain", title: "Night Shift at the Grain Elevator", caption: "Harvest crews working the overnight load-out.", credits: [{ handle: "tomas-whitcombe", split_bp: 10000 }], state: "embargoed", lift_local: "2026-11-01T01:30", exclusive_days: 2, exclusive_price_minor: 30000, standard_days: 5, standard_price_minor: 9000, frames: 4 },
  { id: "salt-marsh-census", title: "Salt Marsh Census", caption: "Volunteers counting nesting rails at dawn.", credits: [{ handle: "ada-reyes", split_bp: 5000 }, { handle: "tomas-whitcombe", split_bp: 3333 }, { handle: "noor-haddad", split_bp: 1667 }], state: "live", lift_local: "2026-10-12T07:00", exclusive_days: 1, exclusive_price_minor: 25000, standard_days: 3, standard_price_minor: 8000, frames: 5 },
  { id: "border-choir", title: "Border Choir", caption: "A church choir that rehearses on both banks.", credits: [{ handle: "noor-haddad", split_bp: 10000 }], state: "in_review", lift_local: "2026-11-05T07:00", exclusive_days: 2, exclusive_price_minor: 20000, standard_days: 7, standard_price_minor: 6000, frames: 3 },
  { id: "river-series-draft", title: "Untitled river series", caption: "", credits: [{ handle: "ada-reyes", split_bp: 10000 }], state: "draft", lift_local: "2026-11-20T08:00", exclusive_days: 3, exclusive_price_minor: 15000, standard_days: 7, standard_price_minor: 5000, frames: 2 },
];

export async function applySeed(sql: Sql, storage: Storage | null): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS app_meta (key text PRIMARY KEY, value text NOT NULL)`;
  const seeded = await sql`SELECT value FROM app_meta WHERE key = 'seeded'`;
  if (seeded.length > 0) return;

  await sql.begin(async (tx) => {
    await tx`INSERT INTO clock_offsets (id, offset_ms, seeded_at) VALUES (1, ${BigInt(START_CLOCK_MS - Date.now())}, now())
             ON CONFLICT (id) DO UPDATE SET offset_ms = clock_offsets.offset_ms`;

    const newsrooms = await tx`
      INSERT INTO newsrooms (slug, name, home_zone) VALUES
        ('harbor-light', 'Harbor Light Herald', 'America/New_York'),
        ('mesa-sentinel', 'Mesa Daily Sentinel', 'America/Phoenix'),
        ('thames-post', 'Thames Evening Post', 'Europe/London')
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING id, slug`;
    const newsroomId = (slug: string): number => {
      const row = newsrooms.find((n) => n.slug === slug);
      if (!row) throw new Error(`Seed newsroom ${slug} missing`);
      return Number(row.id);
    };

    const passwordHash = await seedHash();
    const people = await tx`
      INSERT INTO people (email, name, password_hash, role, newsroom_id, contributor_handle, payout_account) VALUES
        ('ines@saltprint.example', 'Ines Okafor-Lund', ${passwordHash}, 'desk_editor', NULL, NULL, NULL),
        ('bram@saltprint.example', 'Bram Kettleworth', ${passwordHash}, 'treasurer', NULL, NULL, NULL),
        ('ada@contributors.saltprint.example', 'Ada Reyes', ${passwordHash}, 'contributor', NULL, 'ada-reyes', 'Ozark Teachers Credit Union ••4417'),
        ('tomas@contributors.saltprint.example', 'Tomas Whitcombe', ${passwordHash}, 'contributor', NULL, 'tomas-whitcombe', 'Prairie Mutual Savings ••0932'),
        ('noor@contributors.saltprint.example', 'Noor Haddad', ${passwordHash}, 'contributor', NULL, 'noor-haddad', 'Gulfside Community Bank ••2268'),
        ('priya@harbor-light.example', 'Priya Lowell', ${passwordHash}, 'picture_editor', ${newsroomId("harbor-light")}, NULL, NULL),
        ('dev@harbor-light.example', 'Dev Marsh', ${passwordHash}, 'picture_editor', ${newsroomId("harbor-light")}, NULL, NULL),
        ('june@harbor-light.example', 'June Castellanos', ${passwordHash}, 'licensing_manager', ${newsroomId("harbor-light")}, NULL, NULL),
        ('wes@mesa-sentinel.example', 'Wes Tallbridge', ${passwordHash}, 'picture_editor', ${newsroomId("mesa-sentinel")}, NULL, NULL),
        ('carmen@mesa-sentinel.example', 'Carmen Oduya', ${passwordHash}, 'licensing_manager', ${newsroomId("mesa-sentinel")}, NULL, NULL),
        ('hollis@thames-post.example', 'Hollis Brandt', ${passwordHash}, 'picture_editor', ${newsroomId("thames-post")}, NULL, NULL),
        ('margot@thames-post.example', 'Margot Fenwick', ${passwordHash}, 'licensing_manager', ${newsroomId("thames-post")}, NULL, NULL)
      ON CONFLICT (email) DO NOTHING
      RETURNING id, email, contributor_handle`;
    const personByHandle = (handle: string): number => {
      const row = people.find((p) => p.contributor_handle === handle);
      if (!row) throw new Error(`Seed contributor ${handle} missing`);
      return Number(row.id);
    };

    await tx`INSERT INTO commission_rates (effective_from, rate_bp) VALUES ('2026-01-01', 3000) ON CONFLICT (effective_from) DO NOTHING`;

    for (const essay of SEED_ESSAYS) {
      const lift = resolveLiftLocal(essay.lift_local);
      if (!lift) throw new Error(`Bad seed lift ${essay.lift_local}`);
      const creditsJson = JSON.stringify(essay.deskNotes ?? []);
      await tx`
        INSERT INTO essays (id, version, title, caption, state, lift_local, lift_at, lift_resolution, exclusive_days, standard_days, exclusive_price_minor, standard_price_minor, desk_notes, lifted_at, submitted_at)
        VALUES (${essay.id}, 1, ${essay.title}, ${essay.caption}, ${essay.state}, ${essay.lift_local}, ${lift.instant}, ${lift.resolution}, ${essay.exclusive_days}, ${essay.standard_days}, ${essay.exclusive_price_minor}, ${essay.standard_price_minor}, ${creditsJson}, ${essay.state === "live" ? lift.instant : null}, ${essay.state === "in_review" || essay.state === "embargoed" || essay.state === "live" ? lift.instant : null})
        ON CONFLICT (id) DO NOTHING`;
      for (const credit of essay.credits) {
        const pid = personByHandle(credit.handle);
        const pos = essay.credits.indexOf(credit) + 1;
        await tx`INSERT INTO credits (essay_id, person_id, handle, position, split_bp) VALUES (${essay.id}, ${pid}, ${credit.handle}, ${pos}, ${credit.split_bp})
                 ON CONFLICT (essay_id, person_id) DO NOTHING`;
      }
    }
    await tx`INSERT INTO app_meta (key, value) VALUES ('seeded', '1') ON CONFLICT (key) DO NOTHING`;
  });

  if (storage) {
    for (const essay of SEED_ESSAYS) {
      for (let n = 1; n <= essay.frames; n++) {
        const frameId = `${essay.id}-f${n}`;
        const exists = await sql`SELECT id FROM frames WHERE id = ${frameId}`;
        if (exists.length > 0) continue;
        const jpeg = await generateHalftone(essay.id, n);
        const size = await sharp(jpeg).metadata();
        await putOriginal(storage, essay.id, frameId, jpeg);
        await makeDerivatives(storage, essay.id, frameId, jpeg);
        const frameCaption = `${essay.title}, frame ${n}`;
        const frameFilename = `${frameId}.jpg`;
        await sql`INSERT INTO frames (id, essay_id, position, caption, filename, bytes, type, width, height)
                  VALUES (${frameId}, ${essay.id}, ${n}, ${frameCaption}, ${frameFilename}, ${jpeg.length}, 'image/jpeg', ${size.width}, ${size.height})
                  ON CONFLICT (id) DO NOTHING`;
      }
    }
  }
}

// A halftone: dots on a diagonal grid, sized from a deterministic seed.
async function generateHalftone(essayId: string, n: number): Promise<Buffer> {
  const W = 1200;
  const H = 900;
  const seed = [...`${essayId}${n}`].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 7);
  let s = seed;
  const rand = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const svg = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="100%" height="100%" fill="#efe9dc"/>
  <g fill="#26292f">
    ${halftoneDots(W, H, rand)}
  </g>
</svg>`);
  return sharp(svg).jpeg({ quality: 88 }).toBuffer();
}

function halftoneDots(W: number, H: number, rand: () => number): string {
  const parts: string[] = [];
  const step = 22;
  for (let y = step; y < H; y += step) {
    for (let x = step; x < W; x += step) {
      const wave = 0.5 + 0.5 * Math.sin((x / 90) + (y / 70) + rand() * 0.4);
      const r = 1.5 + wave * 7;
      parts.push(`<circle cx="${x}" cy="${y}" r="${r.toFixed(2)}"/>`);
    }
  }
  return parts.join("\n  ");
}

export function seedInstantDisplay(epochMs: number): string {
  return isoInstant(epochMs);
}
