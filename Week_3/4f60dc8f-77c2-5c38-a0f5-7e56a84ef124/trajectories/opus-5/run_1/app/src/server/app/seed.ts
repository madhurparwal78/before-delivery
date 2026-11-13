import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { query } from '../db/pool.js';
import { hasRateFor, insertRate } from '../db/fx.js';
import { parseRateToE4, type CurrencyCode } from '../../shared/money.js';
import {
  createRecord,
  ensureCollections,
  findRecordId,
  loadContent,
} from '../services/pocketbase.js';
import type { CaseStudy, Service } from '../../shared/domain.js';
import { syncSearchIndex } from './content.js';

const STUDIO_PASSWORD = 'rig-founder-2026';
const STUDIO_PASSWORD_KEY = 'studio_password';

export const hashPassword = (password: string): string => {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`;
};

export const verifyPassword = (password: string, stored: string): boolean => {
  const [saltHex, digestHex] = stored.split(':');
  if (saltHex === undefined || digestHex === undefined) return false;
  const expected = Buffer.from(digestHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

export const studioPasswordHash = async (): Promise<string | null> =>
  (await query<{ value: string }>('SELECT value FROM studio_settings WHERE key = $1', [
    STUDIO_PASSWORD_KEY,
  ])).rows[0]?.value ?? null;

const SEED_SERVICES: Service[] = [
  { code: 'hero_front', title: 'Hero front', list_price_pence: 45000, azimuth_deg: 0, elevation_deg: 5, sort: 1 },
  { code: 'three_quarter', title: 'Three-quarter', list_price_pence: 45000, azimuth_deg: 45, elevation_deg: 20, sort: 2 },
  { code: 'top_down', title: 'Top-down', list_price_pence: 38000, azimuth_deg: 0, elevation_deg: 90, sort: 3 },
  { code: 'detail_macro', title: 'Detail macro', list_price_pence: 52000, azimuth_deg: 300, elevation_deg: 15, sort: 4 },
  { code: 'turntable_360', title: '360 turntable', list_price_pence: 145000, azimuth_deg: 90, elevation_deg: 10, sort: 5 },
  { code: 'exploded_view', title: 'Exploded view', list_price_pence: 185000, azimuth_deg: 135, elevation_deg: 30, sort: 6 },
];

const SEED_CASE_STUDIES: CaseStudy[] = [
  {
    slug: 'hollin-h2-headphones',
    title: 'Hollin H2 over-ear headphones',
    client: 'Hollin Audio',
    summary:
      'Hollin came to us with a headband assembly modelled in four separate files and no idea how the earcups would read under studio light. We rebuilt the shot list around two hero angles and a slow turntable, and the launch page shipped with renders the team could not tell from photography.',
    scene: { primitives: ['torus', 'torus', 'capsule', 'cylinder'], accent: 'violet' },
    published: true,
    sort: 1,
  },
  {
    slug: 'brant-vale-arc-kettle',
    title: 'Brant & Vale Arc kettle',
    client: 'Brant & Vale Kitchen',
    summary:
      'Six colourways of one kettle, shot once and relit five times. The brushed body needed a cobalt rake to keep the spout from flattening out, and the exploded view earned its keep when the retailer asked how the filter came apart.',
    scene: { primitives: ['cylinder', 'sphere', 'torus', 'box'], accent: 'ember' },
    published: true,
    sort: 2,
  },
  {
    slug: 'ridgeway-e7-hub-motor',
    title: 'Ridgeway E7 hub motor',
    client: 'Ridgeway Cycles',
    summary:
      'An e-bike hub motor arrived as a STEP export in millimetres, which put the first measurement somewhere past the horizon. Once the unit was confirmed the exploded view became the centrepiece of the dealer pack.',
    scene: { primitives: ['cylinder', 'cylinder', 'torus', 'box', 'box'], accent: 'cobalt' },
    published: true,
    sort: 3,
  },
  {
    slug: 'tallow-t18-drill',
    title: 'Tallow T18 drill driver',
    client: 'Tallow Tools',
    summary:
      'A cordless driver with a soft-touch grip that swallowed light until we moved the violet fill behind the chuck. This one is still in look-dev while the battery pack is re-tooled.',
    scene: { primitives: ['box', 'cylinder', 'capsule'], accent: 'ember' },
    published: false,
    sort: 4,
  },
];

const SEED_TEAM = [
  {
    name: 'Ines Varga',
    role: 'Founder and lead artist',
    bio: 'Ines lights hardware for a living and has spent eleven years turning engineering files into launch imagery, mostly on her own, mostly at night.',
    sort: 1,
  },
];

const SEED_INSIGHTS = [
  {
    slug: 'glb-thousand-times-too-big',
    title: 'Why your GLB arrives a thousand times too big',
    summary: 'glTF measures in metres, your CAD measures in millimetres, and nobody tells the exporter.',
    sort: 1,
  },
  {
    slug: 'what-a-turntable-needs',
    title: 'What a 360 turntable needs from your CAD',
    summary: 'Clean normals, a closed shell and one agreed pivot save a day of clean-up per product.',
    sort: 2,
  },
];

const SEED_MARQUEE = [
  'Hollin Audio',
  'Brant & Vale Kitchen',
  'Ridgeway Cycles',
  'Sorane Instruments',
  'Tallow Tools',
  'Marrow Optics',
  'Fenwick Lamps',
];

type SeedBrand = {
  reference: string;
  engagementTitle: string;
  brand: string;
  currency: CurrencyCode;
  ownerName: string;
  ownerEmail: string;
  financeEmail: string;
  reviewerEmail: string;
};

const SEED_BRANDS: SeedBrand[] = [
  {
    reference: 'GW-1001',
    engagementTitle: 'H3 launch stills',
    brand: 'Hollin Audio',
    currency: 'GBP',
    ownerName: 'Maren Holt',
    ownerEmail: 'maren@hollin-audio.test',
    financeEmail: 'accounts@hollin-audio.test',
    reviewerEmail: 'review@hollin-audio.test',
  },
  {
    reference: 'GW-1002',
    engagementTitle: 'Arc kettle colourways',
    brand: 'Brant & Vale Kitchen',
    currency: 'EUR',
    ownerName: 'Joss Brant',
    ownerEmail: 'joss@brantvale.test',
    financeEmail: 'finance@brantvale.test',
    reviewerEmail: 'studio@brantvale.test',
  },
  {
    reference: 'GW-1003',
    engagementTitle: 'E7 hub motor exploded view',
    brand: 'Ridgeway Cycles',
    currency: 'USD',
    ownerName: 'Dev Okafor',
    ownerEmail: 'dev@ridgeway-cycles.test',
    financeEmail: 'ap@ridgeway-cycles.test',
    reviewerEmail: 'design@ridgeway-cycles.test',
  },
  {
    reference: 'GW-1004',
    engagementTitle: 'K-2 grip launch stills',
    brand: 'Sorane Instruments',
    currency: 'JPY',
    ownerName: 'Aiko Sato',
    ownerEmail: 'aiko@sorane.test',
    financeEmail: 'keiri@sorane.test',
    reviewerEmail: 'design@sorane.test',
  },
];

const SEED_RATES: { currency: CurrencyCode; rate: string }[] = [
  { currency: 'EUR', rate: '1.1650' },
  { currency: 'USD', rate: '1.2725' },
  { currency: 'JPY', rate: '205.4175' },
];

export const seedPostgres = async (): Promise<void> => {
  const existing = await studioPasswordHash();
  if (existing === null)
    await query(
      'INSERT INTO studio_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
      [STUDIO_PASSWORD_KEY, hashPassword(STUDIO_PASSWORD)],
    );

  for (const rate of SEED_RATES) {
    if (await hasRateFor(rate.currency)) continue;
    const rateE4 = parseRateToE4(rate.rate);
    if (rateE4 !== null) await insertRate(rate.currency, rateE4, new Date());
  }

  for (const seed of SEED_BRANDS) {
    const present = await query<{ id: string }>('SELECT id FROM engagements WHERE reference = $1', [
      seed.reference,
    ]);
    if (present.rowCount === 1) continue;
    const brandId = randomUUID();
    await query('INSERT INTO brands (id, name, currency) VALUES ($1, $2, $3)', [
      brandId,
      seed.brand,
      seed.currency,
    ]);
    for (const contact of [
      { role: 'owner', name: seed.ownerName, email: seed.ownerEmail },
      { role: 'finance', name: seed.ownerName, email: seed.financeEmail },
      { role: 'reviewer', name: seed.ownerName, email: seed.reviewerEmail },
    ])
      await query(
        `INSERT INTO contacts (id, brand_id, role, name, email, email_lc)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (brand_id, role) DO NOTHING`,
        [randomUUID(), brandId, contact.role, contact.name, contact.email, contact.email.toLowerCase()],
      );
    await query(
      `INSERT INTO engagements (id, brand_id, reference, title, state)
       VALUES ($1, $2, $3, $4, 'quoted')`,
      [randomUUID(), brandId, seed.reference, seed.engagementTitle],
    );
    await query(
      `SELECT setval('engagement_reference_seq',
         greatest(nextval('engagement_reference_seq'), $1::bigint), true)`,
      [seed.reference.replace('GW-', '')],
    );
  }
};

export const seedPocketBase = async (): Promise<void> => {
  await ensureCollections();
  for (const service of SEED_SERVICES) {
    if ((await findRecordId('services', 'code', service.code)) !== null) continue;
    await createRecord('services', { ...service });
  }
  for (const study of SEED_CASE_STUDIES) {
    if ((await findRecordId('case_studies', 'slug', study.slug)) !== null) continue;
    await createRecord('case_studies', {
      slug: study.slug,
      title: study.title,
      client: study.client,
      summary: study.summary,
      primitives: study.scene.primitives,
      accent: study.scene.accent,
      published: study.published,
      sort: study.sort,
    });
  }
  for (const member of SEED_TEAM) {
    if ((await findRecordId('team', 'name', member.name)) !== null) continue;
    await createRecord('team', { ...member });
  }
  for (const insight of SEED_INSIGHTS) {
    if ((await findRecordId('insights', 'slug', insight.slug)) !== null) continue;
    await createRecord('insights', { ...insight });
  }
  for (const [index, name] of SEED_MARQUEE.entries()) {
    if ((await findRecordId('marquee', 'name', name)) !== null) continue;
    await createRecord('marquee', { name, sort: index + 1 });
  }
};

export const seedSearch = async (): Promise<void> => {
  await syncSearchIndex(await loadContent());
};
