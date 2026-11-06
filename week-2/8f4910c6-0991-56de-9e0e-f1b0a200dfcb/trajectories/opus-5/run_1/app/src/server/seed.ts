import { query, queryOne, transaction, withAdvisoryLock } from './db.js';
import { newId, newToken } from './ids.js';
import { hashPassword } from './data/members.js';
import { insertTalent } from './data/talent.js';
import { talentAccount, writeMovement } from './data/ledger.js';
import { generatePortrait } from './services/images.js';
import { putObject } from './services/storage.js';
import { automaticReleaseInstant, isBusinessDay } from './domain/offices.js';
import { loadOffice } from './data/offices.js';
import { nextCounter } from './schema.js';
import { addDays, addMonthsClamped, formatIsoDate, officeDate, parseIsoDate } from '../shared/zone.js';
import type { Board, Media, OfficeId, Role, Territory } from '../shared/types.js';

const SEED_LOCK = 814_003;
const SEED_PASSWORD = 'Rungboard-2027';

const OFFICES: Array<{ id: OfficeId; city: string; timeZone: string }> = [
  { id: 'toronto', city: 'Toronto', timeZone: 'America/Toronto' },
  { id: 'vancouver', city: 'Vancouver', timeZone: 'America/Vancouver' },
];

const CLOSURES: Record<OfficeId, string[]> = {
  toronto: [
    '2026-01-01', '2026-02-16', '2026-04-03', '2026-05-18', '2026-07-01',
    '2026-08-03', '2026-09-07', '2026-10-12', '2026-12-25', '2026-12-28',
    '2027-01-01', '2027-02-15', '2027-03-26', '2027-05-24', '2027-07-01',
    '2027-08-02', '2027-09-06', '2027-10-11', '2027-12-27', '2027-12-28',
  ],
  vancouver: [
    '2026-01-01', '2026-02-16', '2026-04-03', '2026-05-18', '2026-07-01',
    '2026-08-03', '2026-09-07', '2026-09-30', '2026-10-12', '2026-11-11', '2026-12-25',
    '2027-01-01', '2027-02-15', '2027-03-26', '2027-05-24', '2027-07-01',
    '2027-08-02', '2027-09-06', '2027-09-30', '2027-10-11', '2027-11-11', '2027-12-27',
  ],
};

const CLIENTS = [
  {
    slug: 'northbound',
    company: 'Northbound Outfitters',
    contactName: 'Sam Arsenault',
    contactEmail: 'sam@northbound.example',
    timeZone: 'America/Toronto',
  },
  {
    slug: 'lakeshore',
    company: 'Lakeshore Beauty',
    contactName: 'Kit Ferreira',
    contactEmail: 'kit@lakeshore.example',
    timeZone: 'America/Toronto',
  },
  {
    slug: 'tidewater',
    company: 'Tidewater Coffee Co.',
    contactName: 'Robin Aucoin',
    contactEmail: 'robin@tidewater.example',
    timeZone: 'America/Halifax',
  },
  {
    slug: 'cedar-pine',
    company: 'Cedar & Pine Apparel',
    contactName: 'Alex Nakamura',
    contactEmail: 'alex@cedarpine.example',
    timeZone: 'America/Vancouver',
  },
];

type SeedTalent = {
  slug: string;
  displayName: string;
  office: OfficeId;
  board: Board;
  height: number;
  chest: number;
  waist: number;
  hips: number;
  instagram: number;
  tiktok: number;
  youtube: number;
  dateOfBirth: string;
  phone: string;
  homeAddress: string;
  officeNote: string;
  guardian?: { name: string; email: string; phone: string };
};

const TALENT: SeedTalent[] = [
  { slug: 'ines-okoro', displayName: 'Ines Okoro', office: 'toronto', board: 'women', height: 178, chest: 84, waist: 61, hips: 89, instagram: 374650, tiktok: 125350, youtube: 0, dateOfBirth: '2001-05-14', phone: '+1 416 555 0101', homeAddress: '41 Wychwood Avenue, Toronto ON M6G 2T7', officeNote: 'Prefers morning call times' },
  { slug: 'amara-lindqvist', displayName: 'Amara Lindqvist', office: 'toronto', board: 'women', height: 175, chest: 81, waist: 60, hips: 88, instagram: 999999, tiktok: 0, youtube: 0, dateOfBirth: '1999-11-02', phone: '+1 416 555 0102', homeAddress: '88 Shuter Street, Toronto ON M5B 2H6', officeNote: 'Editorial first, no fur' },
  { slug: 'sofia-reyes-park', displayName: 'Sofia Reyes-Park', office: 'toronto', board: 'women', height: 173, chest: 83, waist: 62, hips: 90, instagram: 999, tiktok: 0, youtube: 0, dateOfBirth: '2003-02-20', phone: '+1 416 555 0103', homeAddress: '12 Howard Park Avenue, Toronto ON M6R 1V2', officeNote: 'Strong runway walk' },
  { slug: 'nadia-belhaj', displayName: 'Nadia Belhaj', office: 'toronto', board: 'women', height: 180, chest: 82, waist: 61, hips: 89, instagram: 1000000, tiktok: 0, youtube: 0, dateOfBirth: '1998-07-07', phone: '+1 416 555 0104', homeAddress: '301 Markham Street, Toronto ON M6J 2G6', officeNote: 'Travels from Montreal often' },
  { slug: 'elodie-fournier', displayName: 'Élodie Fournier', office: 'toronto', board: 'women', height: 176, chest: 80, waist: 59, hips: 87, instagram: 48210, tiktok: 3020, youtube: 0, dateOfBirth: '2000-09-30', phone: '+1 416 555 0105', homeAddress: '55 Rue Clark, Toronto ON M5T 1W6', officeNote: 'Bilingual, French first' },
  { slug: 'june-takahashi', displayName: 'June Takahashi', office: 'vancouver', board: 'women', height: 174, chest: 82, waist: 60, hips: 88, instagram: 22140, tiktok: 61875, youtube: 0, dateOfBirth: '2002-04-11', phone: '+1 604 555 0106', homeAddress: '920 Nelson Street, Vancouver BC V6Z 2H1', officeNote: 'Skincare client favourite' },
  { slug: 'maren-holt', displayName: 'Maren Holt', office: 'vancouver', board: 'women', height: 177, chest: 83, waist: 61, hips: 90, instagram: 8800, tiktok: 0, youtube: 0, dateOfBirth: '1997-12-18', phone: '+1 604 555 0107', homeAddress: '77 Keefer Place, Vancouver BC V6B 0B8', officeNote: 'Available weekends only' },
  { slug: 'talia-brandt', displayName: 'Talia Brandt', office: 'vancouver', board: 'women', height: 172, chest: 81, waist: 62, hips: 89, instagram: 151999, tiktok: 48001, youtube: 0, dateOfBirth: '2001-01-25', phone: '+1 604 555 0108', homeAddress: '255 East 8th Avenue, Vancouver BC V5T 1R8', officeNote: 'Keen on swim' },
  { slug: 'callum-reid', displayName: 'Callum Reid', office: 'toronto', board: 'men', height: 188, chest: 97, waist: 76, hips: 94, instagram: 64300, tiktok: 0, youtube: 0, dateOfBirth: '1996-06-09', phone: '+1 416 555 0109', homeAddress: '18 Strachan Avenue, Toronto ON M6J 2S7', officeNote: 'Tailoring specialist' },
  { slug: 'marcus-adeyemi', displayName: 'Marcus Adeyemi', office: 'toronto', board: 'men', height: 185, chest: 99, waist: 79, hips: 96, instagram: 1250000, tiktok: 0, youtube: 0, dateOfBirth: '1995-03-14', phone: '+1 416 555 0110', homeAddress: '240 Jarvis Street, Toronto ON M5B 2L4', officeNote: 'Books fitness campaigns' },
  { slug: 'tomas-varga', displayName: 'Tomas Varga', office: 'toronto', board: 'men', height: 183, chest: 96, waist: 77, hips: 95, instagram: 5400, tiktok: 0, youtube: 0, dateOfBirth: '2000-10-05', phone: '+1 416 555 0111', homeAddress: '9 Dovercourt Road, Toronto ON M6J 3C2', officeNote: 'New to commercial work' },
  { slug: 'kenji-morales', displayName: 'Kenji Morales', office: 'vancouver', board: 'men', height: 186, chest: 98, waist: 78, hips: 95, instagram: 31750, tiktok: 0, youtube: 0, dateOfBirth: '1994-08-22', phone: '+1 604 555 0112', homeAddress: '1450 Davie Street, Vancouver BC V6G 1Z8', officeNote: 'Surf and outdoor' },
  { slug: 'olu-bankole', displayName: 'Olu Bankole', office: 'vancouver', board: 'men', height: 189, chest: 100, waist: 80, hips: 97, instagram: 87420, tiktok: 12580, youtube: 0, dateOfBirth: '1998-05-02', phone: '+1 604 555 0113', homeAddress: '600 Drake Street, Vancouver BC V6B 5Z2', officeNote: 'Ask about travel days' },
  { slug: 'ethan-mcleod', displayName: 'Ethan McLeod', office: 'vancouver', board: 'men', height: 184, chest: 95, waist: 76, hips: 93, instagram: 2100, tiktok: 0, youtube: 0, dateOfBirth: '2002-02-02', phone: '+1 604 555 0114', homeAddress: '330 East Georgia Street, Vancouver BC V6A 1Z7', officeNote: 'Strong with movement' },
  { slug: 'riley-chen', displayName: 'Riley Chen', office: 'vancouver', board: 'creators', height: 168, chest: 86, waist: 68, hips: 92, instagram: 2450000, tiktok: 1830500, youtube: 412000, dateOfBirth: '1999-04-19', phone: '+1 604 555 0115', homeAddress: '1188 Richards Street, Vancouver BC V6B 3E6', officeNote: 'Three-post packages only' },
  { slug: 'zara-qureshi', displayName: 'Zara Qureshi', office: 'toronto', board: 'creators', height: 165, chest: 84, waist: 66, hips: 91, instagram: 712300, tiktok: 1499999, youtube: 0, dateOfBirth: '2000-12-01', phone: '+1 416 555 0116', homeAddress: '70 Distillery Lane, Toronto ON M5A 3C3', officeNote: 'Beauty and wellness' },
  { slug: 'noah-belanger', displayName: 'Noah Bélanger', office: 'toronto', board: 'creators', height: 179, chest: 94, waist: 78, hips: 94, instagram: 99950, tiktok: 0, youtube: 250050, dateOfBirth: '1997-07-23', phone: '+1 416 555 0117', homeAddress: '150 Dan Leckie Way, Toronto ON M5V 2V1', officeNote: 'Long-form video' },
  { slug: 'lumi-sato', displayName: 'Lumi Sato', office: 'vancouver', board: 'creators', height: 170, chest: 85, waist: 66, hips: 91, instagram: 640000, tiktok: 0, youtube: 0, dateOfBirth: '2001-09-08', phone: '+1 604 555 0118', homeAddress: '488 Helmcken Street, Vancouver BC V6B 0E3', officeNote: 'Styles own shoots' },
  { slug: 'ava-sinclair', displayName: 'Ava Sinclair', office: 'toronto', board: 'new_faces', height: 171, chest: 80, waist: 60, hips: 86, instagram: 0, tiktok: 0, youtube: 0, dateOfBirth: '2010-03-02', phone: '+1 416 555 0119', homeAddress: '24 Hillsdale Avenue East, Toronto ON M4S 1T4', officeNote: 'School hours only', guardian: { name: 'Morgan Sinclair', email: 'morgan.sinclair@guardian.example', phone: '+1 416 555 0190' } },
  { slug: 'leo-dubois', displayName: 'Léo Dubois', office: 'vancouver', board: 'new_faces', height: 187, chest: 94, waist: 74, hips: 92, instagram: 1200, tiktok: 0, youtube: 0, dateOfBirth: '2007-06-19', phone: '+1 604 555 0120', homeAddress: '1255 Seymour Street, Vancouver BC V6B 0H1', officeNote: 'First season' },
];

const MEMBERS: Array<{ name: string; email: string; role: Role; office: OfficeId; talentSlug?: string }> = [
  { name: 'Margot Vesper', email: 'director@vesperrowe.example', role: 'agency_director', office: 'toronto' },
  { name: 'Priya Shah', email: 'priya.shah@vesperrowe.example', role: 'booker', office: 'toronto' },
  { name: 'Jonah Ellis', email: 'jonah.ellis@vesperrowe.example', role: 'booker', office: 'toronto' },
  { name: 'Mei Castillo', email: 'mei.castillo@vesperrowe.example', role: 'booker', office: 'vancouver' },
  { name: 'Rosa Delgado', email: 'rosa.delgado@vesperrowe.example', role: 'accounts_lead', office: 'toronto' },
  { name: 'Theo Marchand', email: 'theo.marchand@vesperrowe.example', role: 'scout', office: 'vancouver' },
  { name: 'Ines Okoro', email: 'ines-okoro@talent.vesperrowe.example', role: 'talent', office: 'toronto', talentSlug: 'ines-okoro' },
  { name: 'Callum Reid', email: 'callum-reid@talent.vesperrowe.example', role: 'talent', office: 'toronto', talentSlug: 'callum-reid' },
];

const SEED_RATE_CARD = {
  name: '2026 standard',
  effectiveFrom: '2026-01-01',
  boards: {
    women: { fullDayCents: 250_000, halfDayCents: 150_000, overtimeQuarterHourCents: 9_400 },
    men: { fullDayCents: 220_000, halfDayCents: 130_000, overtimeQuarterHourCents: 8_300 },
    creators: { fullDayCents: 180_000, halfDayCents: 110_000, overtimeQuarterHourCents: 6_800 },
    new_faces: { fullDayCents: 120_000, halfDayCents: 75_000, overtimeQuarterHourCents: 4_500 },
  },
  usageBaseCents: { digital: 60_000, print: 80_000, out_of_home: 120_000, broadcast: 200_000 },
};

async function storePortfolio(talentId: string, displayName: string): Promise<void> {
  for (let index = 0; index < 3; index += 1) {
    const portrait = generatePortrait(talentId, displayName, index);
    const photoId = newId('pho');
    const objectKey = `portfolio/${talentId}/${photoId}.jpg`;
    await putObject(objectKey, portrait.jpeg, 'image/jpeg');
    await query(
      `INSERT INTO photos (id, talent_id, position, object_key, width, height, bytes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [photoId, talentId, index, objectKey, portrait.width, portrait.height, portrait.jpeg.length],
    );
  }
}

/**
 * The seeded photos need MinIO. With storage unreachable the server still
 * starts, and the next start fills the photos in.
 */
export async function seedPhotosIfMissing(): Promise<void> {
  const slugs = TALENT.map((entry) => entry.slug);
  const missing = await query<{ id: string; slug: string; display_name: string }>(
    `SELECT t.id, t.slug, t.display_name FROM talent t
     WHERE t.slug = ANY($1::text[]) AND t.state = 'active'
       AND NOT EXISTS (SELECT 1 FROM photos p WHERE p.talent_id = t.id)`,
    [slugs],
  );
  for (const row of missing) {
    await storePortfolio(row.id, row.display_name);
  }
  const applications = await query<{ id: string }>(
    `SELECT a.id FROM applications a
     WHERE a.status = 'submitted' AND a.email = 'jordan.ashby@applicant.example'
       AND NOT EXISTS (SELECT 1 FROM application_photos p WHERE p.application_id = a.id)`,
  );
  for (const application of applications) {
    await storeApplicationPhotos(application.id, 'Jordan Ashby');
  }
}

async function storeApplicationPhotos(applicationId: string, label: string): Promise<void> {
  for (const slot of ['front', 'profile', 'full_length', 'smile']) {
    const portrait = generatePortrait(applicationId, label, slot.length);
    const objectKey = `applications/${applicationId}/${slot}.jpg`;
    await putObject(objectKey, portrait.jpeg, 'image/jpeg');
    await query(
      `INSERT INTO application_photos (application_id, slot, object_key, width, height)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (application_id, slot) DO NOTHING`,
      [applicationId, slot, objectKey, portrait.width, portrait.height],
    );
  }
}

async function seedRelativeRecords(nowMs: number): Promise<void> {
  const toronto = await loadOffice('toronto');
  const today = officeDate(toronto.timeZone, nowMs);
  const businessDays: string[] = [];
  let cursor = today;
  while (businessDays.length < 8) {
    cursor = addDays(cursor, 1);
    if (isBusinessDay(toronto, cursor)) businessDays.push(formatIsoDate(cursor));
  }
  const fifth = businessDays[4];
  const seventh = businessDays[6];

  const ines = await queryOne<{ id: string }>(`SELECT id FROM talent WHERE slug = 'ines-okoro'`);
  const clients = await query<{ id: string; slug: string }>('SELECT id, slug FROM clients');
  const director = await queryOne<{ id: string; name: string }>(
    `SELECT id, name FROM members WHERE email = 'director@vesperrowe.example'`,
  );
  const accounts = await queryOne<{ id: string; name: string }>(
    `SELECT id, name FROM members WHERE email = 'rosa.delgado@vesperrowe.example'`,
  );
  if (!ines || !director || !accounts) return;
  const clientId = (slug: string): string => clients.find((client) => client.slug === slug)?.id ?? '';

  const seededOptions = [
    { date: fifth, client: 'northbound', rank: 1, jobTitle: 'Spring lookbook' },
    { date: fifth, client: 'lakeshore', rank: 2, jobTitle: 'Serum campaign' },
    { date: seventh, client: 'tidewater', rank: 1, jobTitle: 'Autumn blend shoot' },
  ];
  for (const option of seededOptions) {
    const date = parseIsoDate(option.date);
    if (!date) continue;
    await query(
      `INSERT INTO options (
         id, talent_id, client_id, job_date, job_title, note, rank, state, auto_release_at,
         placed_by, placed_by_name, placed_at, saved_by_name, saved_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'placed', $8, $9, $10, $11, $10, $11)`,
      [
        newId('opt'),
        ines.id,
        clientId(option.client),
        option.date,
        option.jobTitle,
        null,
        option.rank,
        new Date(automaticReleaseInstant(toronto, date)),
        director.id,
        director.name,
        new Date(nowMs),
      ],
    );
  }

  const northbound = clientId('northbound');
  const licences: Array<{ firstUse: string; termMonths: number; media: Media; territory: Territory; fee: number }> = [
    { firstUse: formatIsoDate(today), termMonths: 12, media: 'digital', territory: 'canada', fee: 45_000 },
    {
      firstUse: formatIsoDate(addMonthsClamped(addDays(today, 10), -1)),
      termMonths: 1,
      media: 'print',
      territory: 'north_america',
      fee: 52_000,
    },
    {
      firstUse: formatIsoDate(addMonthsClamped(today, -2)),
      termMonths: 1,
      media: 'out_of_home',
      territory: 'canada',
      fee: 60_000,
    },
  ];
  for (const licence of licences) {
    await query(
      `INSERT INTO licences (id, client_id, talent_id, media, territory, first_use_date, term_months, monthly_fee_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [newId('lic'), northbound, ines.id, licence.media, licence.territory, licence.firstUse, licence.termMonths, licence.fee],
    );
  }

  const reference = `ADV-${String(await nextCounter('advance')).padStart(6, '0')}`;
  await transaction(async (tx) => {
    await writeMovement(tx, {
      kind: 'advance',
      reference,
      talentId: ines.id,
      bookingId: null,
      clientId: null,
      reversalOf: null,
      description: 'Travel advance',
      createdBy: accounts.id,
      createdByName: accounts.name,
      officeDate: formatIsoDate(today),
      nowMs,
      entries: [
        { account: talentAccount(ines.id), amountCents: -50_000 },
        { account: 'agency_cash', amountCents: 50_000 },
      ],
    });
  });

  const applicationId = newId('app');
  await query(
    `INSERT INTO applications (
       id, token, status, office_id, first_name, last_name, email, date_of_birth, height_cm,
       instagram_followers, bio, minor, submitted_at
     ) VALUES ($1, $2, 'submitted', 'toronto', 'Jordan', 'Ashby', $3, '2004-04-04', 176, 4100, $4, false, $5)`,
    [
      applicationId,
      newToken(),
      'jordan.ashby@applicant.example',
      'Street-cast in Kensington Market. Dancer, comfortable in front of film cameras.',
      new Date(nowMs),
    ],
  );
}

/** Seeds once when the database is empty; safe when several copies start together. */
export async function seedIfEmpty(nowMs: number): Promise<void> {
  await withAdvisoryLock(SEED_LOCK, async () => {
    const seeded = await queryOne<{ count: number }>('SELECT count(*)::int AS count FROM offices');
    if ((seeded?.count ?? 0) > 0) return;

    for (const office of OFFICES) {
      await query('INSERT INTO offices (id, city, time_zone) VALUES ($1, $2, $3)', [
        office.id,
        office.city,
        office.timeZone,
      ]);
      for (const closure of CLOSURES[office.id]) {
        await query('INSERT INTO office_closures (office_id, closure_date) VALUES ($1, $2)', [
          office.id,
          closure,
        ]);
      }
    }

    for (const client of CLIENTS) {
      await query(
        `INSERT INTO clients (id, slug, company, contact_name, contact_email, time_zone)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [newId('cli'), client.slug, client.company, client.contactName, client.contactEmail, client.timeZone],
      );
    }

    await query('INSERT INTO rate_cards (id, name, effective_from, data) VALUES ($1, $2, $3, $4)', [
      newId('rc'),
      SEED_RATE_CARD.name,
      SEED_RATE_CARD.effectiveFrom,
      { boards: SEED_RATE_CARD.boards, usageBaseCents: SEED_RATE_CARD.usageBaseCents },
    ]);

    for (const entry of TALENT) {
      const row = await insertTalent({
        displayName: entry.displayName,
        office: entry.office,
        board: entry.board,
        email: `${entry.slug}@talent.vesperrowe.example`,
        dateOfBirth: entry.dateOfBirth,
        phone: entry.phone,
        heightCm: entry.height,
        chestCm: entry.chest,
        waistCm: entry.waist,
        hipsCm: entry.hips,
        instagram: entry.instagram,
        tiktok: entry.tiktok,
        youtube: entry.youtube,
        officeNote: entry.officeNote,
        guardianName: entry.guardian?.name ?? null,
        guardianEmail: entry.guardian?.email ?? null,
        guardianPhone: entry.guardian?.phone ?? null,
      });
      await query('UPDATE talent SET home_address = $2 WHERE id = $1', [row.id, entry.homeAddress]);
    }

    const passwordHash = await hashPassword(SEED_PASSWORD);
    for (const member of MEMBERS) {
      const talent = member.talentSlug
        ? await queryOne<{ id: string }>('SELECT id FROM talent WHERE slug = $1', [member.talentSlug])
        : null;
      await query(
        `INSERT INTO members (id, name, email, role, office_id, talent_id, password_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [newId('mem'), member.name, member.email, member.role, member.office, talent?.id ?? null, passwordHash],
      );
    }

    await seedRelativeRecords(nowMs);
  });
}
