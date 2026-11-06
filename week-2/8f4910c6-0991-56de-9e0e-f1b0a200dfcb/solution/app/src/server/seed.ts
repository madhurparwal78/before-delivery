// The invented seed: offices and closure dates, members, clients, talent with portraits, the 2026 rate card,
// and the relative records for the screens. It runs once, when the database is empty.

import { readFile } from "node:fs/promises";
import type { PoolClient } from "pg";
import { exec, one, rows } from "./db.js";
import { hashPassword, hashToken, randomToken } from "./auth.js";
import { newId } from "./util.js";
import { processPhoto } from "./images.js";
import { putObject } from "./storage.js";
import { OFFICES, OFFICE_IDS, addDays, addMonths, officeToday, type OfficeId } from "../shared/zones.js";
import { autoReleaseAt, closuresOf, isBusinessDay } from "./domain/offices.js";

const CLOSURES: Record<OfficeId, string[]> = {
  toronto: [
    "2026-01-01", "2026-02-16", "2026-04-03", "2026-05-18", "2026-07-01", "2026-08-03", "2026-09-07", "2026-10-12",
    "2026-12-25", "2026-12-28", "2027-01-01", "2027-02-15", "2027-03-26", "2027-05-24", "2027-07-01", "2027-08-02",
    "2027-09-06", "2027-10-11", "2027-12-27", "2027-12-28",
  ],
  vancouver: [
    "2026-01-01", "2026-02-16", "2026-04-03", "2026-05-18", "2026-07-01", "2026-08-03", "2026-09-07", "2026-09-30",
    "2026-10-12", "2026-11-11", "2026-12-25", "2027-01-01", "2027-02-15", "2027-03-26", "2027-05-24", "2027-07-01",
    "2027-08-02", "2027-09-06", "2027-09-30", "2027-10-11", "2027-11-11", "2027-12-27",
  ],
};

const PASSWORD = "Rungboard-2027";

const MEMBERS = [
  ["Margot Vesper", "director@vesperrowe.example", "agency_director", "toronto", null],
  ["Priya Shah", "priya.shah@vesperrowe.example", "booker", "toronto", null],
  ["Jonah Ellis", "jonah.ellis@vesperrowe.example", "booker", "toronto", null],
  ["Mei Castillo", "mei.castillo@vesperrowe.example", "booker", "vancouver", null],
  ["Rosa Delgado", "rosa.delgado@vesperrowe.example", "accounts_lead", "toronto", null],
  ["Theo Marchand", "theo.marchand@vesperrowe.example", "scout", "vancouver", null],
  ["Ines Okoro", "ines-okoro@talent.vesperrowe.example", "talent", "toronto", "ines-okoro"],
  ["Callum Reid", "callum-reid@talent.vesperrowe.example", "talent", "toronto", "callum-reid"],
] as const;

const CLIENTS = [
  ["northbound", "Northbound Outfitters", "Sam Arsenault", "sam@northbound.example", "America/Toronto"],
  ["lakeshore", "Lakeshore Beauty", "Kit Ferreira", "kit@lakeshore.example", "America/Toronto"],
  ["tidewater", "Tidewater Coffee Co.", "Robin Aucoin", "robin@tidewater.example", "America/Halifax"],
  ["cedar-pine", "Cedar & Pine Apparel", "Alex Nakamura", "alex@cedarpine.example", "America/Vancouver"],
] as const;

// slug, display name, office, board, height, chest, waist, hips, instagram, tiktok, youtube
type TalentSeed = [string, string, OfficeId, string, number, number, number, number, number, number, number];
const SEED_TALENT: TalentSeed[] = [
  ["ines-okoro", "Ines Okoro", "toronto", "women", 178, 84, 61, 89, 374650, 125350, 0],
  ["amara-lindqvist", "Amara Lindqvist", "toronto", "women", 175, 81, 60, 88, 999999, 0, 0],
  ["sofia-reyes-park", "Sofia Reyes-Park", "toronto", "women", 173, 83, 62, 90, 999, 0, 0],
  ["nadia-belhaj", "Nadia Belhaj", "toronto", "women", 180, 82, 61, 89, 1000000, 0, 0],
  ["elodie-fournier", "Élodie Fournier", "toronto", "women", 176, 80, 59, 87, 48210, 3020, 0],
  ["june-takahashi", "June Takahashi", "vancouver", "women", 174, 82, 60, 88, 22140, 61875, 0],
  ["maren-holt", "Maren Holt", "vancouver", "women", 177, 83, 61, 90, 8800, 0, 0],
  ["talia-brandt", "Talia Brandt", "vancouver", "women", 172, 81, 62, 89, 151999, 48001, 0],
  ["callum-reid", "Callum Reid", "toronto", "men", 188, 97, 76, 94, 64300, 0, 0],
  ["marcus-adeyemi", "Marcus Adeyemi", "toronto", "men", 185, 99, 79, 96, 1250000, 0, 0],
  ["tomas-varga", "Tomas Varga", "toronto", "men", 183, 96, 77, 95, 5400, 0, 0],
  ["kenji-morales", "Kenji Morales", "vancouver", "men", 186, 98, 78, 95, 31750, 0, 0],
  ["olu-bankole", "Olu Bankole", "vancouver", "men", 189, 100, 80, 97, 87420, 12580, 0],
  ["ethan-mcleod", "Ethan McLeod", "vancouver", "men", 184, 95, 76, 93, 2100, 0, 0],
  ["riley-chen", "Riley Chen", "vancouver", "creators", 168, 86, 68, 92, 2450000, 1830500, 412000],
  ["zara-qureshi", "Zara Qureshi", "toronto", "creators", 165, 84, 66, 91, 712300, 1499999, 0],
  ["noah-belanger", "Noah Bélanger", "toronto", "creators", 179, 94, 78, 94, 99950, 0, 250050],
  ["lumi-sato", "Lumi Sato", "vancouver", "creators", 170, 85, 66, 91, 640000, 0, 0],
  ["ava-sinclair", "Ava Sinclair", "toronto", "new_faces", 171, 80, 60, 86, 0, 0, 0],
  ["leo-dubois", "Léo Dubois", "vancouver", "new_faces", 187, 94, 74, 92, 1200, 0, 0],
];

const STREETS = ["Harbord Street", "Roncesvalles Avenue", "Dovercourt Road", "Ossington Avenue", "Palmerston Boulevard",
  "Commercial Drive", "Main Street", "Kitsilano Point", "Fraser Street", "Cambie Street"];
const NOTES = ["Available for travel with a week's notice", "Prefers studio work", "Holds a valid passport",
  "Rate review in spring", "Strong on movement and runway", "Comfortable on camera for long takes"];

function privateDetails(slug: string, index: number, office: OfficeId) {
  if (slug === "ines-okoro") {
    return { dob: "2001-05-14", address: "41 Wychwood Avenue, Toronto ON M6G 2T7", note: "Prefers morning call times" };
  }
  if (slug === "ava-sinclair") return { dob: "2010-03-02", address: "18 Brunswick Avenue, Toronto ON M5S 2L9", note: NOTES[1] };
  if (slug === "leo-dubois") return { dob: "2007-06-19", address: "2210 Cornwall Avenue, Vancouver BC V6K 1B5", note: NOTES[0] };
  const city = office === "toronto" ? "Toronto ON M6J" : "Vancouver BC V5L";
  return {
    dob: `${1994 + (index % 9)}-${String((index % 12) + 1).padStart(2, "0")}-${String((index * 7) % 27 + 1).padStart(2, "0")}`,
    address: `${20 + index * 3} ${STREETS[index % STREETS.length]}, ${city} ${index}A${index % 10}`,
    note: NOTES[index % NOTES.length],
  };
}

async function insertOption(client: PoolClient, talentId: string, office: OfficeId, clientId: string, day: string,
  rank: number, jobTitle: string, booker: { id: string; name: string }, now: number): Promise<void> {
  const closures = await closuresOf(client, office);
  await exec(
    client,
    `INSERT INTO options (id, talent_id, client_id, job_date, job_title, note, rank, last_rank, state, auto_release_at,
       placed_by_id, placed_by_name, placed_at, saved_by, saved_at)
     VALUES ($1, $2, $3, $4, $5, '', $6, $6, 'placed', $7, $8, $9, $10, $9, $10)`,
    [newId(), talentId, clientId, day, jobTitle, rank, new Date(autoReleaseAt(day, office, closures)), booker.id,
      booker.name, new Date(now)],
  );
}

function nthBusinessDay(from: string, n: number, closures: Set<string>): string {
  let day = from;
  let count = 0;
  while (count < n) {
    day = addDays(day, 1);
    if (isBusinessDay(day, closures)) count++;
  }
  return day;
}

/** Seeds every row. Returns false when the database already held data. */
export async function seedRows(client: PoolClient, now: number): Promise<boolean> {
  const existing = await one<{ count: number }>(client, "SELECT count(*)::int AS count FROM members");
  if (existing && existing.count > 0) return false;
  for (const office of OFFICE_IDS) {
    await exec(client, "INSERT INTO offices (id, city, time_zone) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [office, OFFICES[office].city, OFFICES[office].timeZone]);
    for (const day of CLOSURES[office]) {
      await exec(client, "INSERT INTO office_closures (office_id, day) VALUES ($1, $2) ON CONFLICT DO NOTHING", [office, day]);
    }
  }
  const talentIds = new Map<string, string>();
  for (const [index, [slug, name, office, board, height, chest, waist, hips, ig, tt, yt]] of SEED_TALENT.entries()) {
    const id = newId();
    talentIds.set(slug, id);
    const details = privateDetails(slug, index, office);
    const phone = `+1 ${office === "toronto" ? "416" : "604"} 555 ${String(110 + index).padStart(4, "0")}`;
    await exec(
      client,
      `INSERT INTO talent (id, slug, display_name, state, office_id, board, date_of_birth, email, phone, home_address,
         guardian_name, guardian_email, guardian_phone, height_cm, chest_cm, waist_cm, hips_cm, instagram, tiktok, youtube,
         office_note, created_at)
       VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
      [id, slug, name, office, board, details.dob, `${slug}@talent.vesperrowe.example`, phone, details.address,
        slug === "ava-sinclair" ? "Morgan Sinclair" : null,
        slug === "ava-sinclair" ? "morgan.sinclair@guardian.example" : null,
        slug === "ava-sinclair" ? "+1 416 555 0190" : null,
        height, chest, waist, hips, ig, tt, yt, details.note, new Date(now - (SEED_TALENT.length - index) * 1000)],
    );
  }
  const passwordHash = await hashPassword(PASSWORD);
  const members = new Map<string, { id: string; name: string }>();
  for (const [name, email, role, office, talentSlug] of MEMBERS) {
    const id = newId();
    members.set(email, { id, name });
    await exec(
      client,
      `INSERT INTO members (id, name, email, role, office_id, talent_id, password_hash) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, name, email, role, office, talentSlug ? talentIds.get(talentSlug) : null, passwordHash],
    );
  }
  const clientIds = new Map<string, string>();
  for (const [slug, company, contact, email, zone] of CLIENTS) {
    const id = newId();
    clientIds.set(slug, id);
    await exec(
      client,
      `INSERT INTO clients (id, slug, company, contact_name, contact_email, time_zone) VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, slug, company, contact, email, zone],
    );
  }
  await exec(
    client,
    `INSERT INTO rate_cards (id, name, effective_from, boards, usage_base) VALUES ($1, '2026 standard', '2026-01-01', $2, $3)`,
    [
      newId(),
      JSON.stringify({
        women: { fullDayCents: 250000, halfDayCents: 150000, overtimeQuarterHourCents: 9400 },
        men: { fullDayCents: 220000, halfDayCents: 130000, overtimeQuarterHourCents: 8300 },
        creators: { fullDayCents: 180000, halfDayCents: 110000, overtimeQuarterHourCents: 6800 },
        new_faces: { fullDayCents: 120000, halfDayCents: 75000, overtimeQuarterHourCents: 4500 },
      }),
      JSON.stringify({ digital: 60000, print: 80000, out_of_home: 120000, broadcast: 200000 }),
    ],
  );

  // Relative records for the screens.
  const ines = talentIds.get("ines-okoro") ?? "";
  const priya = members.get("priya.shah@vesperrowe.example") ?? { id: "", name: "" };
  const rosa = members.get("rosa.delgado@vesperrowe.example") ?? { id: "", name: "" };
  const today = officeToday("toronto", now);
  const closures = await closuresOf(client, "toronto");
  const fifth = nthBusinessDay(today, 5, closures);
  const seventh = nthBusinessDay(today, 7, closures);
  await insertOption(client, ines, "toronto", clientIds.get("northbound") ?? "", fifth, 1, "Autumn outerwear lookbook", priya, now);
  await insertOption(client, ines, "toronto", clientIds.get("lakeshore") ?? "", fifth, 2, "Skin care campaign", priya, now);
  await insertOption(client, ines, "toronto", clientIds.get("tidewater") ?? "", seventh, 1, "Café opening stills", priya, now);
  const northbound = clientIds.get("northbound") ?? "";
  for (const [firstUse, term] of [[addMonths(today, -1), 12], [addMonths(addDays(today, 14), -1), 1],
    [addMonths(today, -3), 1]] as const) {
    await exec(
      client,
      `INSERT INTO licences (id, client_id, talent_id, media, territory, first_use_date, term_months, monthly_fee_cents,
         created_by) VALUES ($1, $2, $3, 'digital', 'canada', $4, $5, 45000, $6)`,
      [newId(), northbound, ines, firstUse, term, rosa.name],
    );
  }
  const advance = newId();
  await exec(
    client,
    `INSERT INTO movements (id, kind, reference, talent_id, note, created_by, created_at, office_date)
     VALUES ($1, 'advance', 'ADV-000001', $2, 'Travel to Vancouver shoot', $3, $4, $5)`,
    [advance, ines, rosa.name, new Date(now), today],
  );
  await exec(client, "INSERT INTO counters (name, value) VALUES ('advance', 1)");
  await exec(client, `INSERT INTO entries (movement_id, position, account, amount_cents) VALUES
    ($1, 0, $2, -50000), ($1, 1, 'agency_cash', 50000)`, [advance, `talent:${ines}`]);
  await exec(
    client,
    `INSERT INTO applications (id, token_hash, status, office_id, first_name, last_name, email, date_of_birth, height_cm,
       instagram, bio, submitted_at, created_at)
     VALUES ($1, $2, 'submitted', 'toronto', 'Jordan', 'Ashby', 'jordan.ashby@applicant.example', '1999-08-21', 181,
       3400, 'Climber and amateur jazz drummer from Leslieville. Happiest outdoors and on the move.', $3, $3)`,
    [newId(), hashToken(randomToken()), new Date(now)],
  );
  return true;
}

const SEED_DIR = new URL("../seed/portraits/", import.meta.url);

/** Uploads the seed portraits that are not stored yet; false while storage is unreachable. */
export async function seedPhotos(client: PoolClient): Promise<boolean> {
  const talent = await rows<{ id: string; slug: string; count: number }>(
    client,
    `SELECT t.id, t.slug, count(p.id)::int AS count FROM talent t LEFT JOIN photos p ON p.talent_id = t.id
      WHERE t.slug = ANY($1) GROUP BY t.id, t.slug`,
    [SEED_TALENT.map(([slug]) => slug)],
  );
  try {
    for (const { id, slug, count } of talent) {
      for (let n = count + 1; n <= 3; n++) {
        const photo = await processPhoto(await readFile(new URL(`${slug}-${n}.jpg`, SEED_DIR)));
        if (!photo) throw new Error(`seed portrait ${slug}-${n} is not a photo`);
        const photoId = newId();
        await putObject(`portfolio/${id}/${photoId}.jpg`, photo.jpeg, "image/jpeg");
        await exec(client, "INSERT INTO photos (id, talent_id, position, width, height) VALUES ($1, $2, $3, $4, $5)",
          [photoId, id, n, photo.width, photo.height]);
      }
    }
    const pending = await rows<{ id: string }>(
      client,
      `SELECT a.id FROM applications a WHERE a.first_name = 'Jordan' AND a.last_name = 'Ashby'
         AND NOT EXISTS (SELECT 1 FROM application_photos p WHERE p.application_id = a.id)`,
    );
    for (const { id } of pending) {
      for (const slot of ["front", "profile", "full_length", "smile"]) {
        const photo = await processPhoto(await readFile(new URL(`jordan-ashby-${slot}.jpg`, SEED_DIR)));
        if (!photo) throw new Error(`seed application photo ${slot} is not a photo`);
        await putObject(`applications/${id}/${slot}.jpg`, photo.jpeg, "image/jpeg");
        await exec(client, "INSERT INTO application_photos (application_id, slot, width, height) VALUES ($1, $2, $3, $4)",
          [id, slot, photo.width, photo.height]);
      }
    }
    return true;
  } catch (error) {
    console.error("seed photos not stored yet:", (error as Error).message);
    return false;
  }
}
