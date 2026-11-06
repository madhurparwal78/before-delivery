import { one, withTransaction, type Tx } from "../db.js";
import { hashPassword } from "../passwords.js";
import { randomToken, CLOSURE_DATES, type Board, type Office } from "../../shared/domain.js";
import { checkBucket, storePortfolioPhoto } from "./storage.js";
import { addWholeMonths } from "./licences.js";

/** One-time seed, safe when several copies start together. */

export const SEED_PASSWORD = "Rungboard-2027";

interface TalentSeed {
  slug: string;
  displayName: string;
  office: Office;
  board: Board;
  height: number;
  chest: number;
  waist: number;
  hips: number;
  instagram: number;
  tiktok: number;
  youtube: number;
  email: string;
  dob: string;
  phone: string;
  home: string;
  note: string;
  guardian?: { name: string; email: string; phone: string };
}

const TALENT: TalentSeed[] = [
  { slug: "ines-okoro", displayName: "Ines Okoro", office: "toronto", board: "women", height: 178, chest: 84, waist: 61, hips: 89, instagram: 374650, tiktok: 125350, youtube: 0, email: "ines-okoro@talent.vesperrowe.example", dob: "2001-05-14", phone: "+1 416 555 0142", home: "41 Wychwood Avenue, Toronto ON M6G 2T7", note: "Prefers morning call times" },
  { slug: "amara-lindqvist", displayName: "Amara Lindqvist", office: "toronto", board: "women", height: 175, chest: 81, waist: 60, hips: 88, instagram: 999999, tiktok: 0, youtube: 0, email: "amara-lindqvist@talent.vesperrowe.example", dob: "2000-01-31", phone: "+1 416 555 0151", home: "12 Ossington Avenue, Toronto ON M6J 2Y7", note: "Winter bookings only" },
  { slug: "sofia-reyes-park", displayName: "Sofia Reyes-Park", office: "toronto", board: "women", height: 173, chest: 83, waist: 62, hips: 90, instagram: 999, tiktok: 0, youtube: 0, email: "sofia-reyes-park@talent.vesperrowe.example", dob: "2002-08-03", phone: "+1 416 555 0152", home: "8 Balliol Street, Toronto ON M4S 1E1", note: "" },
  { slug: "nadia-belhaj", displayName: "Nadia Belhaj", office: "toronto", board: "women", height: 180, chest: 82, waist: 61, hips: 89, instagram: 1000000, tiktok: 0, youtube: 0, email: "nadia-belhaj@talent.vesperrowe.example", dob: "1999-11-12", phone: "+1 416 555 0153", home: "77 Vaughan Road, Toronto ON M6G 2N7", note: "" },
  { slug: "elodie-fournier", displayName: "Élodie Fournier", office: "toronto", board: "women", height: 176, chest: 80, waist: 59, hips: 87, instagram: 48210, tiktok: 3020, youtube: 0, email: "elodie-fournier@talent.vesperrowe.example", dob: "2001-02-27", phone: "+1 416 555 0154", home: "220 College Street, Toronto ON M5T 1R2", note: "" },
  { slug: "june-takahashi", displayName: "June Takahashi", office: "vancouver", board: "women", height: 174, chest: 82, waist: 60, hips: 88, instagram: 22140, tiktok: 61875, youtube: 0, email: "june-takahashi@talent.vesperrowe.example", dob: "2000-06-21", phone: "+1 604 555 0161", home: "1810 Fir Street, Vancouver BC V6J 3C1", note: "" },
  { slug: "maren-holt", displayName: "Maren Holt", office: "vancouver", board: "women", height: 177, chest: 83, waist: 61, hips: 90, instagram: 8800, tiktok: 0, youtube: 0, email: "maren-holt@talent.vesperrowe.example", dob: "2003-01-08", phone: "+1 604 555 0162", home: "3550 W 4th Avenue, Vancouver BC V6R 1M1", note: "" },
  { slug: "talia-brandt", displayName: "Talia Brandt", office: "vancouver", board: "women", height: 172, chest: 81, waist: 62, hips: 89, instagram: 151999, tiktok: 48001, youtube: 0, email: "talia-brandt@talent.vesperrowe.example", dob: "1999-09-30", phone: "+1 604 555 0163", home: "2205 Maple Street, Vancouver BC V6J 3S3", note: "" },
  { slug: "callum-reid", displayName: "Callum Reid", office: "toronto", board: "men", height: 188, chest: 97, waist: 76, hips: 94, instagram: 64300, tiktok: 0, youtube: 0, email: "callum-reid@talent.vesperrowe.example", dob: "1998-04-17", phone: "+1 416 555 0164", home: "55 Crawford Street, Toronto ON M6G 3K4", note: "" },
  { slug: "marcus-adeyemi", displayName: "Marcus Adeyemi", office: "toronto", board: "men", height: 185, chest: 99, waist: 79, hips: 96, instagram: 1250000, tiktok: 0, youtube: 0, email: "marcus-adeyemi@talent.vesperrowe.example", dob: "1997-07-25", phone: "+1 416 555 0165", home: "90 Dovercourt Road, Toronto ON M6J 3C1", note: "" },
  { slug: "tomas-varga", displayName: "Tomas Varga", office: "toronto", board: "men", height: 183, chest: 96, waist: 77, hips: 95, instagram: 5400, tiktok: 0, youtube: 0, email: "tomas-varga@talent.vesperrowe.example", dob: "2001-10-04", phone: "+1 416 555 0166", home: "14 Shanly Street, Toronto ON M6H 2J5", note: "" },
  { slug: "kenji-morales", displayName: "Kenji Morales", office: "vancouver", board: "men", height: 186, chest: 98, waist: 78, hips: 95, instagram: 31750, tiktok: 0, youtube: 0, email: "kenji-morales@talent.vesperrowe.example", dob: "1999-03-11", phone: "+1 604 555 0167", home: "1128 Cardero Street, Vancouver BC V6E 3Z5", note: "" },
  { slug: "olu-bankole", displayName: "Olu Bankole", office: "vancouver", board: "men", height: 189, chest: 100, waist: 80, hips: 97, instagram: 87420, tiktok: 12580, youtube: 0, email: "olu-bankole@talent.vesperrowe.example", dob: "1998-12-02", phone: "+1 604 555 0168", home: "2780 W Broadway, Vancouver BC V6K 2G5", note: "" },
  { slug: "ethan-mcleod", displayName: "Ethan McLeod", office: "vancouver", board: "men", height: 184, chest: 95, waist: 76, hips: 93, instagram: 2100, tiktok: 0, youtube: 0, email: "ethan-mcleod@talent.vesperrowe.example", dob: "2002-05-19", phone: "+1 604 555 0169", home: "1605 Lameys Mill Road, Vancouver BC V6K 4M3", note: "" },
  { slug: "riley-chen", displayName: "Riley Chen", office: "vancouver", board: "creators", height: 168, chest: 86, waist: 68, hips: 92, instagram: 2450000, tiktok: 1830500, youtube: 412000, email: "riley-chen@talent.vesperrowe.example", dob: "2000-08-08", phone: "+1 604 555 0170", home: "3588 W 10th Avenue, Vancouver BC V6R 2G1", note: "" },
  { slug: "zara-qureshi", displayName: "Zara Qureshi", office: "toronto", board: "creators", height: 165, chest: 84, waist: 66, hips: 91, instagram: 712300, tiktok: 1499999, youtube: 0, email: "zara-qureshi@talent.vesperrowe.example", dob: "2001-03-23", phone: "+1 416 555 0171", home: "684 Dovercourt Road, Toronto ON M6H 1W1", note: "" },
  { slug: "noah-belanger", displayName: "Noah Bélanger", office: "toronto", board: "creators", height: 179, chest: 94, waist: 78, hips: 94, instagram: 99950, tiktok: 0, youtube: 250050, email: "noah-belanger@talent.vesperrowe.example", dob: "1999-01-16", phone: "+1 416 555 0172", home: "103 Palmerston Avenue, Toronto ON M6J 2H6", note: "" },
  { slug: "lumi-sato", displayName: "Lumi Sato", office: "vancouver", board: "creators", height: 170, chest: 85, waist: 66, hips: 91, instagram: 640000, tiktok: 0, youtube: 0, email: "lumi-sato@talent.vesperrowe.example", dob: "2002-11-28", phone: "+1 604 555 0173", home: "2090 W 12th Avenue, Vancouver BC V6K 2N2", note: "" },
  { slug: "ava-sinclair", displayName: "Ava Sinclair", office: "toronto", board: "new_faces", height: 171, chest: 80, waist: 60, hips: 86, instagram: 0, tiktok: 0, youtube: 0, email: "ava-sinclair@talent.vesperrowe.example", dob: "2010-03-02", phone: "+1 416 555 0174", home: "32 Brookfield Street, Toronto ON M6P 3A1", note: "", guardian: { name: "Morgan Sinclair", email: "morgan.sinclair@guardian.example", phone: "+1 416 555 0190" } },
  { slug: "leo-dubois", displayName: "Léo Dubois", office: "vancouver", board: "new_faces", height: 187, chest: 94, waist: 74, hips: 92, instagram: 1200, tiktok: 0, youtube: 0, email: "leo-dubois@talent.vesperrowe.example", dob: "2007-06-19", phone: "+1 604 555 0175", home: "3350 E 8th Avenue, Vancouver BC V5N 1S6", note: "" },
];

interface ClientSeed {
  slug: string;
  company: string;
  contactName: string;
  contactEmail: string;
  timeZone: string;
}

const CLIENTS: ClientSeed[] = [
  { slug: "northbound", company: "Northbound Outfitters", contactName: "Sam Arsenault", contactEmail: "sam@northbound.example", timeZone: "America/Toronto" },
  { slug: "lakeshore", company: "Lakeshore Beauty", contactName: "Kit Ferreira", contactEmail: "kit@lakeshore.example", timeZone: "America/Toronto" },
  { slug: "tidewater", company: "Tidewater Coffee Co.", contactName: "Robin Aucoin", contactEmail: "robin@tidewater.example", timeZone: "America/Halifax" },
  { slug: "cedar-pine", company: "Cedar & Pine Apparel", contactName: "Alex Nakamura", contactEmail: "alex@cedarpine.example", timeZone: "America/Vancouver" },
];

/** Generates a simple portrait illustration as a JPEG buffer. */
async function portrait(index: number): Promise<Buffer> {
  const { generatedPortrait } = await import("../infra/images.js");
  return generatedPortrait(index);
}

export async function seedIfEmpty(): Promise<boolean> {
  const claim = await withTransaction(async (tx) => {
    const inserted = await tx.one<{ key: string }>(
      `INSERT INTO seed_state (key, value) VALUES ('seeded', 'yes') ON CONFLICT (key) DO NOTHING RETURNING key`
    );
    return !!inserted;
  });
  if (!claim) return false;
  const hash = await hashPassword(SEED_PASSWORD);
  await withTransaction(async (tx) => {
    await seedMembers(hash);
    await seedClients(tx);
    await seedRateCard(tx);
    await seedOffices(tx);
  });
  await checkBucket().catch(() => {});
  await withTransaction(async (tx) => {
    await seedTalent(tx);
  });
  await seedRelative().catch(() => {});
  return true;
}

type SeedTx = Tx;

async function query0(text: string, params: unknown[]): Promise<void> {
  const { query } = await import("../db.js");
  await query(text, params);
}

async function seedMembers(hash: string): Promise<void> {
  const members = [
    ["mem_margot", "Margot Vesper", "director@vesperrowe.example", "agency_director", "toronto", null],
    ["mem_priya", "Priya Shah", "priya.shah@vesperrowe.example", "booker", "toronto", null],
    ["mem_jonah", "Jonah Ellis", "jonah.ellis@vesperrowe.example", "booker", "toronto", null],
    ["mem_mei", "Mei Castillo", "mei.castillo@vesperrowe.example", "booker", "vancouver", null],
    ["mem_rosa", "Rosa Delgado", "rosa.delgado@vesperrowe.example", "accounts_lead", "toronto", null],
    ["mem_theo", "Theo Marchand", "theo.marchand@vesperrowe.example", "scout", "vancouver", null],
  ];
  for (const [id, name, email, role, office] of members) {
    await query0(
      `INSERT INTO members (id, name, email, password_hash, role, office) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (email) DO NOTHING`,
      [id, name, email, hash, role, office]
    );
  }
}

async function seedClients(tx: SeedTx): Promise<void> {
  for (const c of CLIENTS) {
    await tx.query(
      `INSERT INTO clients (id, slug, company, contact_name, contact_email, time_zone) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (slug) DO NOTHING`,
      [`cli_${c.slug}`, c.slug, c.company, c.contactName, c.contactEmail, c.timeZone]
    );
  }
}

async function seedRateCard(tx: SeedTx): Promise<void> {
  const id = "rc_2026_standard";
  await tx.query(`INSERT INTO rate_cards (id, name, effective_from) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`, [id, "2026 standard", "2026-01-01"]);
  const boards: Array<[Board, number, number, number]> = [
    ["women", 250000, 150000, 9400],
    ["men", 220000, 130000, 8300],
    ["creators", 180000, 110000, 6800],
    ["new_faces", 120000, 75000, 4500],
  ];
  for (const [board, full, half, ot] of boards) {
    await tx.query(
      `INSERT INTO rate_card_boards (rate_card_id, board, full_day_cents, half_day_cents, overtime_qh_cents) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [id, board, full, half, ot]
    );
  }
  const usage: Array<[string, number]> = [["digital", 60000], ["print", 80000], ["out_of_home", 120000], ["broadcast", 200000]];
  for (const [media, base] of usage) {
    await tx.query(`INSERT INTO rate_card_usage (rate_card_id, media, base_cents) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [id, media, base]);
  }
}

async function seedOffices(tx: SeedTx): Promise<void> {
  for (const office of ["toronto", "vancouver"] as const) {
    for (const date of CLOSURE_DATES[office]) {
      await tx.query(`INSERT INTO office_closures (office, date) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [office, date]);
    }
  }
}

async function seedTalent(tx: SeedTx): Promise<void> {
  const inesId = "tal_ines_okoro";
  const callumId = "tal_callum_reid";
  for (const t of TALENT) {
    const id = t.slug === "ines-okoro" ? inesId : t.slug === "callum-reid" ? callumId : `tal_${randomToken(10)}`;
    await tx.query(
      `INSERT INTO talent (id, slug, display_name, state, office, board, email, phone, home_address, date_of_birth, guardian_name, guardian_email, guardian_phone, height_cm, chest_cm, waist_cm, hips_cm, instagram, tiktok, youtube, office_note, feed_token)
       VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
       ON CONFLICT DO NOTHING`,
      [
        id,
        t.slug,
        t.displayName,
        t.office,
        t.board,
        t.email,
        t.phone,
        t.home,
        t.dob,
        t.guardian?.name ?? null,
        t.guardian?.email ?? null,
        t.guardian?.phone ?? null,
        t.height,
        t.chest,
        t.waist,
        t.hips,
        t.instagram,
        t.tiktok,
        t.youtube,
        t.note,
        randomToken(40),
      ]
    );
    if (t.slug === "ines-okoro") {
      await tx.query(`INSERT INTO talent_links (talent_id, member_id) VALUES ($1, (SELECT id FROM members WHERE email = 'ines-okoro@talent.vesperrowe.example')) ON CONFLICT DO NOTHING`, [id]);
      await tx.query(
        `INSERT INTO members (id, name, email, password_hash, role, office, talent_id)
         VALUES ('mem_ines', 'Ines Okoro', 'ines-okoro@talent.vesperrowe.example', $1, 'talent', 'toronto', $2)
         ON CONFLICT (email) DO NOTHING`,
        [await hashPassword(SEED_PASSWORD), id]
      );
    }
    if (t.slug === "callum-reid") {
      await tx.query(
        `INSERT INTO members (id, name, email, password_hash, role, office, talent_id)
         VALUES ('mem_callum', 'Callum Reid', 'callum-reid@talent.vesperrowe.example', $1, 'talent', 'toronto', $2)
         ON CONFLICT (email) DO NOTHING`,
        [await hashPassword(SEED_PASSWORD), id]
      );
      await tx.query(`INSERT INTO talent_links (talent_id, member_id) VALUES ($1, 'mem_callum') ON CONFLICT DO NOTHING`, [id]);
    }
  }
}

/** Screens-only relative seed: options, licences, an advance, one application. */
async function seedRelative(): Promise<void> {
  const now = new Date();
  const inesId = (await one<{ id: string }>(`SELECT id FROM talent WHERE slug = 'ines-okoro'`))?.id;
  const northboundId = (await one<{ id: string }>(`SELECT id FROM clients WHERE slug = 'northbound'`))?.id;
  const lakeshoreId = (await one<{ id: string }>(`SELECT id FROM clients WHERE slug = 'lakeshore'`))?.id;
  const tidewaterId = (await one<{ id: string }>(`SELECT id FROM clients WHERE slug = 'tidewater'`))?.id;
  const priyaId = (await one<{ id: string }>(`SELECT id FROM members WHERE email = 'priya.shah@vesperrowe.example'`))?.id;
  if (!inesId || !northboundId || !lakeshoreId || !tidewaterId || !priyaId) return;
  const businessDays = businessDaysFrom(5);
  const { autoReleaseInstant } = await import("./time.js");
  const { query } = await import("../db.js");
  const closures = new Set(CLOSURE_DATES.toronto);
  const seq = await one<{ value: number }>(`SELECT value FROM counters WHERE name = 'option_sequence'`);
  let sequence = seq?.value ?? 0;
  for (const [i, day] of businessDays.entries()) {
    const clientId = i === 0 ? northboundId : i === 1 ? lakeshoreId : tidewaterId;
    const rank = 1;
    const auto = autoReleaseInstant(day, "toronto", closures);
    sequence += 1;
    await query(
      `INSERT INTO options (id, talent_id, client_id, date, job_title, rank, state, auto_release_at, release_at, placed_by, sequence)
       VALUES ($1, $2, $3, $4, $5, $6, 'placed', $7, $7, $8, $9) ON CONFLICT DO NOTHING`,
      [`opt_seed_${i}`, inesId, clientId, day, "Spring lookbook", rank, auto, priyaId, sequence]
    );
  }
  await query(`INSERT INTO counters (name, value) VALUES ('option_sequence', $1) ON CONFLICT (name) DO UPDATE SET value = $1`, [sequence]);
  // Licences: active, expiring and expired
  const today = new Date();
  const active = addWholeMonths(today.toISOString().slice(0, 10), 3);
  const expiring = new Date(today.getTime() + 15 * 86400 * 1000).toISOString().slice(0, 10);
  const expired = new Date(today.getTime() - 40 * 86400 * 1000).toISOString().slice(0, 10);
  const licenceSeeds = [
    { id: "lic_seed_active", firstUse: active, months: 1, fee: 45000 },
    { id: "lic_seed_expiring", firstUse: expiring, months: 1, fee: 45000 },
    { id: "lic_seed_expired", firstUse: expired, months: 1, fee: 45000 },
  ];
  for (const lic of licenceSeeds) {
    const endsOn = addWholeMonths(lic.firstUse, 1);
    await query(
      `INSERT INTO licences (id, client_id, talent_id, media, territory, first_use_date, term_months, ends_on, monthly_fee_cents, version)
       VALUES ($1, $2, $3, 'digital', 'canada', $4, 1, $5, $6, 1) ON CONFLICT DO NOTHING`,
      [lic.id, northboundId, inesId, lic.firstUse, endsOn, lic.fee]
    );
  }
  // Advance
  await query(
    `INSERT INTO ledger_movements (id, kind, reference, talent_id, created_by, created_at, office_date, reason)
     VALUES ('mov_seed_advance', 'advance', 'ADV-SEED01', $1, $2, $3, $4, 'Travel to Vancouver shoot') ON CONFLICT DO NOTHING`,
    [inesId, priyaId, now, today.toISOString().slice(0, 10)]
  );
  await query(
    `INSERT INTO ledger_entries (id, movement_id, account, amount_cents) VALUES ('le_seed_a', 'mov_seed_advance', $1, -50000), ('le_seed_b', 'mov_seed_advance', 'agency_cash', 50000) ON CONFLICT DO NOTHING`,
    [`talent:${inesId}`]
  );
  // Submitted adult application
  const appId = "app_seed_jordan";
  await query(
    `INSERT INTO applications (id, token, office, first_name, last_name, email, date_of_birth, height_cm, instagram_followers, bio, status, minor, submitted_at)
     VALUES ($1, $2, 'toronto', 'Jordan', 'Ashby', 'jordan.ashby@example.com', '2003-04-09', 176, 3400, 'Studio and street work.', 'submitted', false, now())
     ON CONFLICT DO NOTHING`,
    [appId, randomToken(40)]
  );
}

function businessDaysFrom(count: number): string[] {
  const { addDays, isBusinessDay } = { addDays: dateAdd, isBusinessDay: (d: string) => {
    const [y, m, dd] = d.split("-").map(Number);
    const wd = new Date(Date.UTC(y, m - 1, dd)).getUTCDay();
    return wd !== 0 && wd !== 6 && !CLOSURE_DATES.toronto.includes(d);
  } };
  const out: string[] = [];
  let cursor = new Date().toISOString().slice(0, 10);
  while (out.length < count) {
    cursor = addDays(cursor, 1);
    if (isBusinessDay(cursor)) out.push(cursor);
  }
  return out;
}

function dateAdd(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

/** Stores a portrait photo for a seeded talent. */
export async function seedPhotoFor(talentId: string, index: number): Promise<void> {
  const { query } = await import("../db.js");
  const existing = await query<{ id: string }>(`SELECT id FROM photos WHERE talent_id = $1`, [talentId]);
  if (existing.length > 0) return;
  const buffer = await portrait(index);
  for (let i = 0; i < 3; i++) {
    const photoId = `ph_${randomToken(10)}`;
    const normalized = await storePortfolioPhoto(talentId, photoId, buffer);
    await query(`INSERT INTO photos (id, talent_id, position, width, height) VALUES ($1, $2, $3, $4, $5)`, [photoId, talentId, i, normalized.width, normalized.height]);
  }
  await query(`UPDATE talent SET portfolio_version = 3 WHERE id = $1 AND portfolio_version = 0`, [talentId]);
}
