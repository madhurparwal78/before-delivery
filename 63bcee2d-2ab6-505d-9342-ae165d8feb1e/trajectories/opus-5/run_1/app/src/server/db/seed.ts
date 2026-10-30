/**
 * The seeded practice, applied on every start without duplicating anything.
 * Every person, brand, company and project here is invented.
 */

import { createHash } from 'node:crypto';
import {
  FEE_STAGE_KEYS,
  STAGE_KEYS,
  type Currency,
  type Region,
  type Role,
  type Sector,
} from '../../shared/domain.js';
import { hashPassword } from '../http/session.js';
import { reviewDueOn } from '../domain/reviewClock.js';
import {
  renderImageBytes,
  sheetPdfBytes,
  sheetSvgBytes,
  sitePhotoBytes,
} from '../services/procedural.js';
import { objectExists, putObject } from '../services/storage.js';
import { seedId } from './ids.js';
import { firstRow, pool, rows, transact, type Queryable } from './pool.js';

const SEED_PASSWORD = 'Marrow-Hall-2026';

const BRANDS = [
  'Kestrel Tea House',
  'Northvane Optics',
  'Cinder Lane Coffee',
  'Fernhill Paper Goods',
  'Tallis Audio',
  'Lattice Works',
];

const COMPANIES = ['Harbourline Fit-Out Ltd', 'Tideway Joinery Pte Ltd', 'Granite Pier Builders'];

interface SeedMember {
  name: string;
  email: string;
  role: Role;
  brand?: string;
  company?: string;
  phone: string;
  limits?: { HKD: number; SGD: number };
}

const MEMBERS: SeedMember[] = [
  {
    name: 'Avery Tsang',
    email: 'avery.tsang@marrowhall.example',
    role: 'director',
    phone: '+852 5550 0101',
  },
  {
    name: 'Jordan Lim',
    email: 'jordan.lim@marrowhall.example',
    role: 'project_lead',
    phone: '+852 5550 0102',
    limits: { HKD: 5_000_000, SGD: 850_000 },
  },
  {
    name: 'Casey Wong',
    email: 'casey.wong@marrowhall.example',
    role: 'project_lead',
    phone: '+852 5550 0103',
    limits: { HKD: 20_000_000, SGD: 3_500_000 },
  },
  { name: 'Rin Mok', email: 'rin.mok@marrowhall.example', role: 'designer', phone: '+852 5550 0104' },
  { name: 'Sam Teo', email: 'sam.teo@marrowhall.example', role: 'designer', phone: '+65 5550 0105' },
  {
    name: 'Morgan Ho',
    email: 'morgan.ho@marrowhall.example',
    role: 'finance',
    phone: '+852 5550 0106',
  },
  {
    name: 'Dana Cheung',
    email: 'dana.cheung@kestreltea.example',
    role: 'client_approver',
    brand: 'Kestrel Tea House',
    phone: '+852 5550 0201',
  },
  {
    name: 'Quinn Yeo',
    email: 'quinn.yeo@kestreltea.example',
    role: 'client_approver',
    brand: 'Kestrel Tea House',
    phone: '+852 5550 0202',
  },
  {
    name: 'Robin Chan',
    email: 'robin.chan@northvane.example',
    role: 'client_approver',
    brand: 'Northvane Optics',
    phone: '+65 5550 0203',
  },
  {
    name: 'Ash Kwok',
    email: 'ash.kwok@harbourline.example',
    role: 'contractor',
    company: 'Harbourline Fit-Out Ltd',
    phone: '+852 5550 0301',
  },
  {
    name: 'Kai Ng',
    email: 'kai.ng@tideway.example',
    role: 'contractor',
    company: 'Tideway Joinery Pte Ltd',
    phone: '+65 5550 0302',
  },
  {
    name: 'Lee Fong',
    email: 'lee.fong@granitepier.example',
    role: 'contractor',
    company: 'Granite Pier Builders',
    phone: '+852 5550 0303',
  },
];

interface SeedProject {
  reference: string;
  name: string;
  brand: string;
  region: Region;
  currency: Currency;
  defectsPeriodMonths: number;
  stores: { code: string; name: string; weight: number }[];
  fees: Record<string, number>;
}

const PROJECTS: SeedProject[] = [
  {
    reference: 'MH-2601',
    name: 'Kestrel Tea House HK rollout',
    brand: 'Kestrel Tea House',
    region: 'HK',
    currency: 'HKD',
    defectsPeriodMonths: 12,
    stores: [
      { code: 'HK-CWB-01', name: 'Causeway Bay', weight: 120 },
      { code: 'HK-TST-02', name: 'Tsim Sha Tsui', weight: 95 },
      { code: 'HK-MK-03', name: 'Mong Kok', weight: 80 },
      { code: 'HK-CEN-04', name: 'Central', weight: 105 },
      { code: 'HK-SHT-05', name: 'Sha Tin', weight: 100 },
      { code: 'HK-KT-06', name: 'Kwun Tong', weight: 100 },
    ],
    fees: {
      groundwork: 6_000_000,
      scheme: 18_000_000,
      detailing: 24_000_000,
      tender_award: 9_000_000,
      build: 32_000_000,
      handover: 7_000_000,
    },
  },
  {
    reference: 'MH-2602',
    name: 'Kestrel Tea House Macao',
    brand: 'Kestrel Tea House',
    region: 'MO',
    currency: 'HKD',
    defectsPeriodMonths: 12,
    stores: [
      { code: 'MO-SEN-01', name: 'Senado', weight: 1 },
      { code: 'MO-TAI-02', name: 'Taipa', weight: 1 },
    ],
    fees: {
      groundwork: 4_000_000,
      scheme: 4_000_000,
      detailing: 4_000_000,
      tender_award: 4_000_000,
      build: 4_000_000,
      handover: 4_000_000,
    },
  },
  {
    reference: 'MH-2603',
    name: 'Northvane Optics Singapore',
    brand: 'Northvane Optics',
    region: 'SG',
    currency: 'SGD',
    defectsPeriodMonths: 12,
    stores: [
      { code: 'SG-ORC-01', name: 'Orchard', weight: 3 },
      { code: 'SG-JEM-02', name: 'Jurong East', weight: 2 },
      { code: 'SG-TPN-03', name: 'Tampines', weight: 2 },
    ],
    fees: {
      groundwork: 3_000_000,
      scheme: 3_000_000,
      detailing: 3_000_000,
      tender_award: 3_000_000,
      build: 3_000_000,
      handover: 3_000_000,
    },
  },
];

interface SeedCaseStudy {
  slug: string;
  title: string;
  sector: Sector;
  brand: string;
  location: string;
  summary: string;
  body: string;
  featuredOrder: number | null;
  state: 'published' | 'draft';
  publishedDaysAgo: number;
}

const CASE_STUDIES: SeedCaseStudy[] = [
  {
    slug: 'kestrel-causeway-bay',
    title: 'Kestrel Tea House, Causeway Bay',
    sector: 'food_beverage',
    brand: 'Kestrel Tea House',
    location: 'Causeway Bay, Hong Kong',
    summary:
      'The first of six tea houses, built around a honed basalt counter and a brass service rail that the rollout now repeats store by store.',
    body:
      'Kestrel came to us with a single leased shell in Causeway Bay and a brief for six stores inside a year. We set the kit of parts first: a basalt counter, an ash laminate back bar, a brushed bronze service rail and a terrazzo floor that could be laid by two different contractors to the same tolerance.\n\nThe shopfront is a four-bay frame with a transom at 2,400, which gave the brand a signage band it can keep at every address. Joinery was tendered as one package so the counter profile stays identical across the rollout.\n\nGroundwork to handover ran seven months. Every stage gate was signed off by the brand inside Plumbline, and the drawing register carried the shopfront elevation to revision C before a single sheet went for construction.',
    featuredOrder: 1,
    state: 'published',
    publishedDaysAgo: 14,
  },
  {
    slug: 'cinder-lane-sheung-wan',
    title: 'Cinder Lane Coffee, Sheung Wan',
    sector: 'food_beverage',
    brand: 'Cinder Lane Coffee',
    location: 'Sheung Wan, Hong Kong',
    summary:
      'A twelve-seat roastery bar in a 1960s shophouse, where the existing terrazzo was lifted, catalogued and relaid.',
    body:
      'Sheung Wan gave us a narrow shophouse with a good floor and very little else. We lifted the original terrazzo in panels, catalogued them, and relaid the sound ones along the service run so the wear pattern reads as part of the room.\n\nThe roaster needed a flue, a make-up air path and a counter the baristas could work from both sides. Everything else is one material: oiled timber, cut on site from a single delivery.\n\nThe variation register tells the story of an old building. Eleven variations, every one agreed and priced before the work happened, and a final account that matched the certificate run to the cent.',
    featuredOrder: 2,
    state: 'published',
    publishedDaysAgo: 28,
  },
  {
    slug: 'northvane-orchard',
    title: 'Northvane Optics, Orchard Road',
    sector: 'retail',
    brand: 'Northvane Optics',
    location: 'Orchard Road, Singapore',
    summary:
      'A display wall of 240 frames on a bronze grid, lit so the lenses read true under both daylight and the mall lighting.',
    body:
      'Northvane sell by letting people hold the frames, so the display wall had to put 240 of them within reach without looking like a warehouse. The answer was a bronze grid at 150 centres with a sage felt back, and a lighting layout tuned so the lens tints read the same at the window and at the testing room.\n\nThe testing rooms are the technical heart: acoustically separated, with a 6 metre sight line folded into a 3 metre room by mirror.\n\nThree stores followed on the same shop-drawing set, with the joinery contractor reviewing the display wall to Code 2 at the first submission.',
    featuredOrder: 3,
    state: 'published',
    publishedDaysAgo: 46,
  },
  {
    slug: 'fernhill-paper-central',
    title: 'Fernhill Paper Goods, Central',
    sector: 'retail',
    brand: 'Fernhill Paper Goods',
    location: 'Central, Hong Kong',
    summary:
      'A stationer in 46 square metres, with a paper wall that doubles as the whole fit-out and a counter that folds away.',
    body:
      'Forty-six square metres, a single frontage and a brief that asked for the paper itself to be the fit-out. We built a wall of open trays in ash, 19 mm thick, sized to the four sheet formats Fernhill stock, so a restock is also a merchandising change.\n\nThe counter folds into the wall at closing, which gives the shop a second life for evening events.\n\nThe whole fit-out was one tender, one contractor and one certificate run of three interim certificates.',
    featuredOrder: null,
    state: 'published',
    publishedDaysAgo: 70,
  },
  {
    slug: 'tallis-audio-taikoo',
    title: 'Tallis Audio, Taikoo',
    sector: 'retail',
    brand: 'Tallis Audio',
    location: 'Taikoo, Hong Kong',
    summary:
      'Two listening rooms inside a mall unit, built as boxes within a box so the floorplate never carries the bass.',
    body:
      'A hi-fi shop in a mall is an acoustic problem before it is an interiors one. We built two listening rooms as isolated boxes on neoprene, with their own ceilings, and kept the shop floor as a plain plaster room so nothing competes.\n\nThe demonstration wall carries 14 pairs of speakers on a bronze rail, switchable from a single panel the staff keep behind the counter.\n\nHandover included a measured acoustic report for each room, which the brand now uses as the benchmark for every new store.',
    featuredOrder: 4,
    state: 'published',
    publishedDaysAgo: 96,
  },
  {
    slug: 'lattice-works-quarry-bay',
    title: 'Lattice Works, Quarry Bay headquarters',
    sector: 'workplace',
    brand: 'Lattice Works',
    location: 'Quarry Bay, Hong Kong',
    summary:
      'Eleven hundred square metres of workplace on one floorplate, planned around a long shared table and nine quiet rooms.',
    body:
      'Lattice asked for a headquarters that would still work when the company doubled. We planned it around one 14 metre table, nine quiet rooms on the core, and a perimeter left deliberately loose so desks can be added without touching services.\n\nThe ceiling is open, with services painted out and a plaster raft over the table to bring the acoustic down where people talk.\n\nThe fit-out was tendered to three contractors, levelled on exclusions and awarded to the second-lowest bid with a written reason that sits in the tender record.',
    featuredOrder: 5,
    state: 'published',
    publishedDaysAgo: 120,
  },
  {
    slug: 'kestrel-macao',
    title: 'Kestrel Tea House, Macao',
    sector: 'food_beverage',
    brand: 'Kestrel Tea House',
    location: 'Senado, Macao',
    summary:
      'Two Macao tea houses taking the Hong Kong kit of parts into a protected facade, with the counter turned to face the street.',
    body:
      'Senado is a protected frontage, so the shopfront had to be reversible and the signage had to sit behind the glass line. We turned the counter to face the street instead, which gave the brand its signature view without touching the facade.\n\nTaipa follows the same plan with a longer back of house.\n\nThis case study is in draft while the brand reviews the photography.',
    featuredOrder: 6,
    state: 'draft',
    publishedDaysAgo: 0,
  },
];

const FINISHES = [
  { code: 'PT-01', name: 'Warm white eggshell', category: 'Paint' },
  { code: 'PT-02', name: 'Oxide red accent', category: 'Paint' },
  { code: 'TL-01', name: 'Terrazzo floor tile', category: 'Tile' },
  { code: 'LM-01', name: 'Ash laminate', category: 'Laminate' },
  { code: 'ST-01', name: 'Honed basalt counter', category: 'Stone' },
  { code: 'MT-01', name: 'Brushed bronze trim', category: 'Metal' },
];

const GROUNDWORK_REQUESTED_AT = new Date('2026-10-16T01:00:00.000Z');
const SD_RECEIVED_AT = new Date('2026-10-19T02:00:00.000Z');
const VARIATION_RAISED_AT = new Date('2026-10-22T03:30:00.000Z');

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function idFor(client: Queryable, table: string, name: string): Promise<string> {
  const row = await firstRow<{ id: string }>(
    client,
    `SELECT id FROM ${table} WHERE name = $1`,
    [name],
  );
  if (!row) throw new Error(`Seed expected ${table} named ${name}`);
  return row.id;
}

interface SheetFile {
  storageKey: string;
  bytes: Buffer;
  contentType: string;
}

/** Applies the seed. Returns the files that belong in the bucket. */
export async function applySeed(): Promise<SheetFile[]> {
  const files: SheetFile[] = [];

  await transact(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [728_311_046]);

    for (const name of BRANDS) {
      await client.query(
        'INSERT INTO brands (id, name) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING',
        [seedId(`brand:${name}`), name],
      );
    }
    for (const name of COMPANIES) {
      await client.query(
        'INSERT INTO companies (id, name) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING',
        [seedId(`company:${name}`), name],
      );
    }

    for (const member of MEMBERS) {
      const id = seedId(`member:${member.email}`);
      const present = await firstRow(client, 'SELECT 1 FROM members WHERE id = $1', [id]);
      if (present) continue;
      const passwordHash = await hashPassword(SEED_PASSWORD);
      await client.query(
        `INSERT INTO members (id, name, email, phone, role, brand_id, company_id, password_hash,
                              approval_limit_hkd_cents, approval_limit_sgd_cents)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO NOTHING`,
        [
          id,
          member.name,
          member.email,
          member.phone,
          member.role,
          member.brand ? await idFor(client, 'brands', member.brand) : null,
          member.company ? await idFor(client, 'companies', member.company) : null,
          passwordHash,
          member.limits?.HKD ?? null,
          member.limits?.SGD ?? null,
        ],
      );
    }

    await client.query(
      `INSERT INTO counters (name, value) VALUES ('project_reference', 2603), ('enquiry_reference', 0)
       ON CONFLICT (name) DO NOTHING`,
    );

    for (const project of PROJECTS) {
      const projectId = seedId(`project:${project.reference}`);
      await client.query(
        `INSERT INTO projects (id, reference, name, brand_id, region, currency, defects_period_months)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
        [
          projectId,
          project.reference,
          project.name,
          await idFor(client, 'brands', project.brand),
          project.region,
          project.currency,
          project.defectsPeriodMonths,
        ],
      );
      for (const [index, store] of project.stores.entries()) {
        await client.query(
          `INSERT INTO project_stores (id, project_id, code, name, weight, ord)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
          [
            seedId(`store:${project.reference}:${store.code}`),
            projectId,
            store.code,
            store.name,
            store.weight,
            index,
          ],
        );
      }
      for (const [index, key] of STAGE_KEYS.entries()) {
        await client.query(
          `INSERT INTO stages (id, project_id, key, ord, fee_cents)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
          [
            seedId(`stage:${project.reference}:${key}`),
            projectId,
            key,
            index,
            FEE_STAGE_KEYS.includes(key) ? project.fees[key] ?? null : null,
          ],
        );
      }
    }

    const hkRollout = seedId('project:MH-2601');
    const singapore = seedId('project:MH-2603');
    const jordan = seedId('member:jordan.lim@marrowhall.example');
    const rin = seedId('member:rin.mok@marrowhall.example');
    const kai = seedId('member:kai.ng@tideway.example');

    await client.query(
      `UPDATE stages SET state = 'requested', requested_at = $2, requested_by = $3,
                         internal_note = $4
        WHERE id = $1 AND state = 'not_started' AND requested_at IS NULL`,
      [
        seedId('stage:MH-2601:groundwork'),
        GROUNDWORK_REQUESTED_AT,
        jordan,
        'Courtesy discount agreed by director, do not quote to client',
      ],
    );

    await client.query(
      `INSERT INTO contracts (id, project_id, company_id, contract_sum_cents)
       VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
      [
        seedId('contract:MH-2603'),
        singapore,
        await idFor(client, 'companies', 'Tideway Joinery Pte Ltd'),
        124_000_000,
      ],
    );

    const sheetPlan = [
      { code: 'A-101', title: 'General arrangement plan', revisions: ['A', 'B', 'C'], kind: 'pdf' },
      { code: 'A-201', title: 'Shopfront elevation', revisions: ['A'], kind: 'svg' },
    ] as const;

    for (const sheet of sheetPlan) {
      const sheetId = seedId(`sheet:MH-2601:${sheet.code}`);
      await client.query(
        `INSERT INTO sheets (id, project_id, code, title) VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [sheetId, hkRollout, sheet.code, sheet.title],
      );
      for (const [index, revision] of sheet.revisions.entries()) {
        const bytes =
          sheet.kind === 'pdf'
            ? sheetPdfBytes(sheet.code, sheet.title, revision)
            : sheetSvgBytes(sheet.code, sheet.title, revision);
        const extension = sheet.kind === 'pdf' ? 'pdf' : 'svg';
        const storageKey = `projects/${hkRollout}/sheets/${sheet.code}/${revision}.${extension}`;
        files.push({
          storageKey,
          bytes,
          contentType: sheet.kind === 'pdf' ? 'application/pdf' : 'image/svg+xml',
        });
        await client.query(
          `INSERT INTO sheet_revisions (id, sheet_id, revision, seq, state, bytes, sha256,
                                        content_type, original_name, storage_key, uploaded_by,
                                        uploaded_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT (id) DO NOTHING`,
          [
            seedId(`revision:MH-2601:${sheet.code}:${revision}`),
            sheetId,
            revision,
            index + 1,
            index === sheet.revisions.length - 1 ? 'current' : 'superseded',
            bytes.byteLength,
            sha256Hex(bytes),
            sheet.kind === 'pdf' ? 'application/pdf' : 'image/svg+xml',
            `${sheet.code}.${extension}`,
            storageKey,
            rin,
            new Date(GROUNDWORK_REQUESTED_AT.getTime() + index * 86_400_000),
          ],
        );
      }
    }

    const tenderId = seedId('tender:MH-2601:shopfront-joinery');
    await client.query(
      `INSERT INTO tenders (id, project_id, title, scope, contingency_percent, status)
       VALUES ($1, $2, $3, $4, $5, 'draft') ON CONFLICT (id) DO NOTHING`,
      [
        tenderId,
        hkRollout,
        'Shopfront joinery package',
        'Supply and install the shopfront frame, transom, display joinery and service counter to all six Kestrel Tea House stores, to the drawing register current at tender close.',
        '5.00',
      ],
    );
    const bidders = [
      {
        reference: 'B-01',
        company: 'Harbourline Fit-Out Ltd',
        contactName: 'Ash Kwok',
        contactEmail: 'ash.kwok@harbourline.example',
      },
      {
        reference: 'B-02',
        company: 'Granite Pier Builders',
        contactName: 'Lee Fong',
        contactEmail: 'lee.fong@granitepier.example',
      },
    ];
    for (const [index, bidder] of bidders.entries()) {
      await client.query(
        `INSERT INTO tender_bidders (id, tender_id, reference, company_id, contact_name,
                                     contact_email, member_id, ord)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
        [
          seedId(`bidder:${tenderId}:${bidder.reference}`),
          tenderId,
          bidder.reference,
          await idFor(client, 'companies', bidder.company),
          bidder.contactName,
          bidder.contactEmail,
          seedId(`member:${bidder.contactEmail}`),
          index,
        ],
      );
    }

    const viewpointId = seedId('viewpoint:MH-2601:VP-01');
    const renderKey = `projects/${hkRollout}/viewpoints/${viewpointId}/render.jpg`;
    files.push({ storageKey: renderKey, bytes: renderImageBytes(1600, 1000), contentType: 'image/jpeg' });
    await client.query(
      `INSERT INTO viewpoints (id, project_id, name, store_code, render_key, render_content_type)
       VALUES ($1, $2, $3, $4, $5, 'image/jpeg') ON CONFLICT (id) DO NOTHING`,
      [viewpointId, hkRollout, 'VP-01 Entrance elevation', 'HK-CWB-01', renderKey],
    );
    const photoId = seedId('photo:MH-2601:VP-01');
    const photoKey = `projects/${hkRollout}/viewpoints/${viewpointId}/photos/${photoId}.jpg`;
    files.push({ storageKey: photoKey, bytes: sitePhotoBytes(1600, 1000), contentType: 'image/jpeg' });
    await client.query(
      `INSERT INTO viewpoint_photos (id, viewpoint_id, storage_key, content_type, width, height)
       VALUES ($1, $2, $3, 'image/jpeg', 1600, 1000) ON CONFLICT (id) DO NOTHING`,
      [photoId, viewpointId, photoKey],
    );

    const snags = [
      {
        number: 1,
        s: 32,
        y: 58,
        title: 'Shopfront mullion out of line',
        observedOn: '2026-10-20',
        state: 'open',
        note: 'Second mullion from the entrance leans about 9 mm off plumb at the transom.',
      },
      {
        number: 2,
        s: 71,
        y: 40,
        title: 'Counter edge banding lifted',
        observedOn: '2026-10-21',
        state: 'fixed',
        note: 'Edge banding lifting on the return nearest the till.',
      },
    ];
    for (const snag of snags) {
      await client.query(
        `INSERT INTO snags (id, viewpoint_id, number, s, y, title, note, observed_on, state)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING`,
        [
          seedId(`snag:MH-2601:VP-01:${snag.number}`),
          viewpointId,
          snag.number,
          snag.s,
          snag.y,
          snag.title,
          snag.note,
          snag.observedOn,
          snag.state,
        ],
      );
    }

    for (const [index, finish] of FINISHES.entries()) {
      await client.query(
        `INSERT INTO finishes (id, project_id, position, code, name, category, supplier,
                               product_ref, location)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING`,
        [
          seedId(`finish:MH-2601:${finish.code}`),
          hkRollout,
          index + 1,
          finish.code,
          finish.name,
          finish.category,
          '',
          '',
          '',
        ],
      );
    }

    await client.query(
      `INSERT INTO variations (id, project_id, number, title, description, amount_cents, currency,
                               store_code, state, raised_by, raised_at, version, updated_by,
                               updated_at)
       VALUES ($1, $2, 'V-001', $3, $4, $5, 'SGD', 'SG-ORC-01', 'raised', $6, $7, 1, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [
        seedId('variation:MH-2603:V-001'),
        singapore,
        'Additional bulkhead at Orchard entrance',
        'Form a new plasterboard bulkhead over the Orchard entrance to conceal the revised sprinkler run, including framing, two-coat finish and making good to the adjacent ceiling.',
        1_240_000,
        kai,
        VARIATION_RAISED_AT,
      ],
    );

    const shopDrawingId = seedId('shopdrawing:MH-2603:SD-001');
    await client.query(
      `INSERT INTO shop_drawings (id, project_id, reference, title) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [shopDrawingId, singapore, 'SD-001', 'Display wall joinery'],
    );
    const submissionBytes = sheetPdfBytes('SD-001', 'Display wall joinery', '1');
    const submissionKey = `projects/${singapore}/shop-drawings/${shopDrawingId}/1.pdf`;
    files.push({ storageKey: submissionKey, bytes: submissionBytes, contentType: 'application/pdf' });
    await client.query(
      `INSERT INTO shop_drawing_submissions (id, shop_drawing_id, submission, received_at,
                                             review_due_on, storage_key, bytes, content_type,
                                             original_name)
       VALUES ($1, $2, 1, $3, $4, $5, $6, 'application/pdf', 'SD-001.pdf')
       ON CONFLICT (id) DO NOTHING`,
      [
        seedId('submission:MH-2603:SD-001:1'),
        shopDrawingId,
        SD_RECEIVED_AT,
        reviewDueOn(SD_RECEIVED_AT),
        submissionKey,
        submissionBytes.byteLength,
      ],
    );

    const now = Date.now();
    for (const study of CASE_STUDIES) {
      await client.query(
        `INSERT INTO case_studies (id, title, slug, sector, brand_id, location, summary, body,
                                   featured, featured_order, state, published_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (id) DO NOTHING`,
        [
          seedId(`casestudy:${study.slug}`),
          study.title,
          study.slug,
          study.sector,
          await idFor(client, 'brands', study.brand),
          study.location,
          study.summary,
          study.body,
          study.featuredOrder !== null,
          study.featuredOrder,
          study.state,
          study.state === 'published'
            ? new Date(now - study.publishedDaysAgo * 86_400_000)
            : null,
        ],
      );
    }
  });

  return files;
}

/** Rewrites any seeded file that is missing from the bucket. */
export async function restoreSeedFiles(files: readonly SheetFile[]): Promise<void> {
  for (const file of files) {
    if (await objectExists(file.storageKey)) continue;
    await putObject(file.storageKey, file.bytes, file.contentType);
  }
}

/** The next value of a sequence counter, taken under a row lock. */
export async function nextCounter(client: Queryable, name: string): Promise<number> {
  const row = await rows<{ value: number }>(
    client,
    `INSERT INTO counters (name, value) VALUES ($1, 1)
     ON CONFLICT (name) DO UPDATE SET value = counters.value + 1
     RETURNING value`,
    [name],
  );
  const value = row[0]?.value;
  if (value === undefined) throw new Error(`Counter ${name} did not advance`);
  return value;
}
