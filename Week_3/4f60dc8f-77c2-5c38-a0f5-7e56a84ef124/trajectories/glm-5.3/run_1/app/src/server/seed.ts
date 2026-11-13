import type { App } from './app';
import { newId } from './domain';
import { hashPassword } from './routes/public';
import type { CaseStudy, ServiceRecord } from './types';
import type { Pool } from './db';

/**
 * Seeds are applied on every serve, only where missing. Seeded records
 * get random ids; tests find them by reference, email, code or slug.
 */

const SEED_BRANDS = [
  { reference: 'GW-1001', title: 'H3 launch stills', brand: 'Hollin Audio', currency: 'GBP', owner: { name: 'Maren Holt', email: 'maren@hollin-audio.test' }, finance: 'accounts@hollin-audio.test', reviewer: 'review@hollin-audio.test' },
  { reference: 'GW-1002', title: 'Arc kettle colourways', brand: 'Brant & Vale Kitchen', currency: 'EUR', owner: { name: 'Joss Brant', email: 'joss@brantvale.test' }, finance: 'finance@brantvale.test', reviewer: 'studio@brantvale.test' },
  { reference: 'GW-1003', title: 'E7 hub motor exploded view', brand: 'Ridgeway Cycles', currency: 'USD', owner: { name: 'Dev Okafor', email: 'dev@ridgeway-cycles.test' }, finance: 'ap@ridgeway-cycles.test', reviewer: 'design@ridgeway-cycles.test' },
  { reference: 'GW-1004', title: 'K-2 grip launch stills', brand: 'Sorane Instruments', currency: 'JPY', owner: { name: 'Aiko Sato', email: 'aiko@sorane.test' }, finance: 'keiri@sorane.test', reviewer: 'design@sorane.test' },
];

const SEED_RATES = [
  { currency: 'EUR', rate: '1.1650' },
  { currency: 'USD', rate: '1.2725' },
  { currency: 'JPY', rate: '205.4175' },
];

const SEED_SERVICES: ServiceRecord[] = [
  { code: 'hero_front', title: 'Hero front', list_price_pence: 45000, azimuth_deg: 0, elevation_deg: 5, sort: 1 },
  { code: 'three_quarter', title: 'Three-quarter', list_price_pence: 45000, azimuth_deg: 45, elevation_deg: 20, sort: 2 },
  { code: 'top_down', title: 'Top-down', list_price_pence: 38000, azimuth_deg: 0, elevation_deg: 90, sort: 3 },
  { code: 'detail_macro', title: 'Detail macro', list_price_pence: 52000, azimuth_deg: 300, elevation_deg: 15, sort: 4 },
  { code: 'turntable_360', title: '360 turntable', list_price_pence: 145000, azimuth_deg: 90, elevation_deg: 10, sort: 5 },
  { code: 'exploded_view', title: 'Exploded view', list_price_pence: 185000, azimuth_deg: 135, elevation_deg: 30, sort: 6 },
];

const SEED_CASE_STUDIES: CaseStudy[] = [
  { slug: 'hollin-h2-headphones', title: 'Hollin H2 over-ear headphones', client: 'Hollin Audio', summary: 'Nine stills and a 360 turntable took the H2 from CAD to launch in three weeks, with the headband hinge re-lit for the hero shot.', scene: { primitives: ['torus', 'torus', 'capsule', 'cylinder'], accent: 'violet' }, published: true, sort: 1 },
  { slug: 'brant-vale-arc-kettle', title: 'Brant & Vale Arc kettle', client: 'Brant & Vale Kitchen', summary: 'Four colourways of the Arc kettle, each from the same CAD pass, with a top-down layout built for the brand\'s kettle launch grid.', scene: { primitives: ['cylinder', 'sphere', 'torus', 'box'], accent: 'ember' }, published: true, sort: 2 },
  { slug: 'ridgeway-e7-hub-motor', title: 'Ridgeway E7 hub motor', client: 'Ridgeway Cycles', summary: 'An exploded view of the E7 hub motor, forty-one parts separated along their axes, lit to keep every thread readable at poster size.', scene: { primitives: ['cylinder', 'cylinder', 'torus', 'box', 'box'], accent: 'cobalt' }, published: true, sort: 3 },
  { slug: 'tallow-t18-drill', title: 'Tallow T18 drill driver', client: 'Tallow Tools', summary: 'A draft study of the T18 driver, held back until the brand\'s packaging settles, with the chuck measured from the client\'s own GLB.', scene: { primitives: ['box', 'cylinder', 'capsule'], accent: 'ember' }, published: false, sort: 4 },
];

const SEED_TEAM = [
  { name: 'Ines Varga', role: 'Founder and lead artist', bio: 'Ines spent a decade lighting consumer-hardware renders for agency clients before opening Gloamwork. She answers every enquiry herself, usually within the hour, and quotes from your CAD before you commit to anything.' },
];

const SEED_INSIGHTS = [
  { slug: 'glb-thousand-times-too-big', title: 'Why your GLB arrives a thousand times too big', summary: 'Most CAD exporters write millimetres into a metre format, and the fix takes one click if you know where to look.' },
  { slug: 'what-a-turntable-needs', title: 'What a 360 turntable needs from your CAD', summary: 'A clean turntable starts with tidy topology and a model that sits on its own base plane.' },
];

const SEED_MARQUEE = ['Hollin Audio', 'Brant & Vale Kitchen', 'Ridgeway Cycles', 'Sorane Instruments', 'Tallow Tools', 'Marrow Optics', 'Fenwick Lamps'];

export async function seed(app: App): Promise<void> {
  const pool = app.pool;
  try {
    await seedStudioState(pool, app);
    await seedRates(pool);
    await seedBrands(pool);
    await seedPocketBase(app);
  } catch (error) {
    console.error('seed failed:', error instanceof Error ? error.stack : error);
    throw error;
  }
}

async function seedStudioState(pool: Pool, app: App): Promise<void> {
  const existing = await pool.query(`SELECT 1 FROM studio_state WHERE id = 'founder_password_hash'`);
  if (existing.rows.length === 0) {
    await pool.query(
      `INSERT INTO studio_state (id, value) VALUES ('founder_password_hash', $1)`,
      [hashPassword(app.config.studioPassword)],
    );
  }
}

async function seedRates(pool: Pool): Promise<void> {
  const existing = await pool.query(`SELECT COUNT(*) AS count FROM fx_rates`);
  if (Number(existing.rows[0].count) === 0) {
    for (const rate of SEED_RATES) {
      await pool.query(
        `INSERT INTO fx_rates (id, currency, rate, effective_at) VALUES ($1, $2, $3, now())`,
        [newId(), rate.currency, rate.rate],
      );
    }
  }
}

async function seedBrands(pool: Pool): Promise<void> {
  for (const seedBrand of SEED_BRANDS) {
    const existing = await pool.query(`SELECT 1 FROM engagements WHERE reference = $1`, [seedBrand.reference]);
    if (existing.rows.length > 0) {
      continue;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const brandId = newId();
      await client.query(
        `INSERT INTO brands (id, name, currency) VALUES ($1, $2, $3)`,
        [brandId, seedBrand.brand, seedBrand.currency],
      );
      await client.query(
        `INSERT INTO contacts (id, brand_id, name, email, role) VALUES ($1, $2, $3, $4, 'owner')`,
        [newId(), brandId, seedBrand.owner.name, seedBrand.owner.email],
      );
      await client.query(
        `INSERT INTO contacts (id, brand_id, name, email, role) VALUES ($1, $2, $3, $4, 'finance')`,
        [newId(), brandId, 'Finance contact', seedBrand.finance],
      );
      await client.query(
        `INSERT INTO contacts (id, brand_id, name, email, role) VALUES ($1, $2, $3, $4, 'reviewer')`,
        [newId(), brandId, 'Reviewer', seedBrand.reviewer],
      );
      // The reference sequence keeps new engagements continuing from GW-1005.
      await client.query(
        `INSERT INTO engagements (id, brand_id, reference, title, state, fx_rate) VALUES ($1, $2, $3, $4, 'quoted', $5)`,
        [newId(), brandId, seedBrand.reference, seedBrand.title, seedBrand.currency === 'GBP' ? '1.0000' : (SEED_RATES.find(r => r.currency === seedBrand.currency)?.rate ?? '1.0000')],
      );
      const maxSeq = await client.query(
        `SELECT last_value AS v FROM engagement_reference_seq`,
      );
      const referenceNumber = Number.parseInt(seedBrand.reference.slice(3), 10);
      const current = Number(maxSeq.rows[0]?.v ?? 1000);
      if (referenceNumber >= current) {
        const bump = await client.query(
          `SELECT setval('engagement_reference_seq', $1, true) AS v`,
          [referenceNumber],
        );
        void bump;
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

async function seedPocketBase(app: App): Promise<void> {
  await app.pocketbase.ensureCollections();
  const existingServices = await app.pocketbase.getServices();
  if (existingServices.length === 0) {
    for (const service of SEED_SERVICES) {
      await app.pocketbase.createService(service);
    }
  }
  const existingStudies = await app.pocketbase.getCaseStudies(true);
  if (existingStudies.length === 0) {
    for (const study of SEED_CASE_STUDIES) {
      await app.pocketbase.createCaseStudy(study);
    }
  }
  await app.pocketbase.ensureTeam(SEED_TEAM);
  await app.pocketbase.ensureInsights(SEED_INSIGHTS);
  await app.pocketbase.ensureMarquee(SEED_MARQUEE);
  await app.search.ensureIndex();
  const { reindexSearch } = await import('./routes/studio');
  await reindexSearch(app);
}
