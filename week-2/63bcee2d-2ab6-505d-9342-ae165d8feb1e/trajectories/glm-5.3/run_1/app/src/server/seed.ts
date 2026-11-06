// Seed data: applied on every start without duplicating anything.
// Seed files are rewritten to the bucket when storage is reachable.

import { randomUUID } from 'node:crypto';
import { one, query } from './lib/db.js';
import { hashPassword } from './lib/auth.js';
import type { Storage } from './lib/s3.js';
import { coverSvg, seedPdf, seedSheetSvg, viewpointPhotoPng, viewpointRenderPng } from './covers.js';
import { sha256Hex } from './lib/files.js';

const PASSWORD = 'Marrow-Hall-2026';

interface SeedMember {
  email: string;
  name: string;
  role: 'director' | 'project_lead' | 'designer' | 'finance' | 'client_approver' | 'contractor';
  phone: string;
  brand?: string;
  company?: string;
  approvalHkd?: number;
  approvalSgd?: number;
}

const SEED_MEMBERS: SeedMember[] = [
  { email: 'avery.tsang@marrowhall.example', name: 'Avery Tsang', role: 'director', phone: '+852 5550 0101' },
  { email: 'jordan.lim@marrowhall.example', name: 'Jordan Lim', role: 'project_lead', phone: '+852 5550 0102', approvalHkd: 5_000_000, approvalSgd: 850_000 },
  { email: 'casey.wong@marrowhall.example', name: 'Casey Wong', role: 'project_lead', phone: '+852 5550 0103', approvalHkd: 20_000_000, approvalSgd: 3_500_000 },
  { email: 'rin.mok@marrowhall.example', name: 'Rin Mok', role: 'designer', phone: '+852 5550 0104' },
  { email: 'sam.teo@marrowhall.example', name: 'Sam Teo', role: 'designer', phone: '+65 5550 0105' },
  { email: 'morgan.ho@marrowhall.example', name: 'Morgan Ho', role: 'finance', phone: '+852 5550 0106' },
  { email: 'dana.cheung@kestreltea.example', name: 'Dana Cheung', role: 'client_approver', phone: '+852 5550 0201', brand: 'Kestrel Tea House' },
  { email: 'quinn.yeo@kestreltea.example', name: 'Quinn Yeo', role: 'client_approver', phone: '+852 5550 0202', brand: 'Kestrel Tea House' },
  { email: 'robin.chan@northvane.example', name: 'Robin Chan', role: 'client_approver', phone: '+65 5550 0203', brand: 'Northvane Optics' },
  { email: 'ash.kwok@harbourline.example', name: 'Ash Kwok', role: 'contractor', phone: '+852 5550 0301', company: 'Harbourline Fit-Out Ltd' },
  { email: 'kai.ng@tideway.example', name: 'Kai Ng', role: 'contractor', phone: '+65 5550 0302', company: 'Tideway Joinery Pte Ltd' },
  { email: 'lee.fong@granitepier.example', name: 'Lee Fong', role: 'contractor', phone: '+852 5550 0303', company: 'Granite Pier Builders' },
];

const BRANDS = ['Kestrel Tea House', 'Northvane Optics', 'Cinder Lane Coffee', 'Fernhill Paper Goods', 'Tallis Audio', 'Lattice Works'];
const COMPANIES = ['Harbourline Fit-Out Ltd', 'Tideway Joinery Pte Ltd', 'Granite Pier Builders'];

async function ensureBrand(name: string): Promise<string> {
  const existing = await one<{ id: string }>('SELECT id FROM brands WHERE name = $1', [name]);
  if (existing) return existing.id;
  const id = randomUUID();
  await query('INSERT INTO brands (id, name) VALUES ($1,$2)', [id, name]);
  return id;
}

async function ensureCompany(name: string): Promise<string> {
  const existing = await one<{ id: string }>('SELECT id FROM companies WHERE name = $1', [name]);
  if (existing) return existing.id;
  const id = randomUUID();
  await query('INSERT INTO companies (id, name) VALUES ($1,$2)', [id, name]);
  return id;
}

async function seedMember(member: SeedMember): Promise<string> {
  const existing = await one<{ id: string }>('SELECT id FROM members WHERE lower(email) = $1', [member.email.toLowerCase()]);
  if (existing) return existing.id;
  const brandId = member.brand ? await ensureBrand(member.brand) : null;
  const companyId = member.company ? await ensureCompany(member.company) : null;
  const id = randomUUID();
  await query(
    `INSERT INTO members (id, email, name, role, phone, brand_id, company_id, password_hash, approval_hkd, approval_sgd)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      id,
      member.email.toLowerCase(),
      member.name,
      member.role,
      member.phone,
      brandId,
      companyId,
      hashPassword(PASSWORD),
      member.approvalHkd ?? null,
      member.approvalSgd ?? null,
    ],
  );
  return id;
}

interface SeedProject {
  reference: string;
  name: string;
  brand: string;
  region: 'HK' | 'SG' | 'MO';
  currency: 'HKD' | 'SGD';
  defectsPeriodMonths: number;
  stores: { code: string; name: string; weight: number }[];
  fees: Record<string, number>;
  groundwork?: { requestedBy: string; note: string };
  contract?: { company: string; sumCents: number };
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
    fees: { groundwork: 6_000_000, scheme: 18_000_000, detailing: 24_000_000, tender_award: 9_000_000, build: 32_000_000, handover: 7_000_000 },
    groundwork: { requestedBy: 'jordan.lim@marrowhall.example', note: 'Courtesy discount agreed by director, do not quote to client' },
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
    fees: { groundwork: 4_000_000, scheme: 4_000_000, detailing: 4_000_000, tender_award: 4_000_000, build: 4_000_000, handover: 4_000_000 },
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
    fees: { groundwork: 3_000_000, scheme: 3_000_000, detailing: 3_000_000, tender_award: 3_000_000, build: 3_000_000, handover: 3_000_000 },
    contract: { company: 'Tideway Joinery Pte Ltd', sumCents: 124_000_000 },
  },
];

export async function seed(storage: Storage): Promise<void> {
  // Reference lists.
  for (const brand of BRANDS) {
    await ensureBrand(brand);
  }
  for (const company of COMPANIES) {
    await ensureCompany(company);
  }
  const memberIdByEmail = new Map<string, string>();
  for (const member of SEED_MEMBERS) {
    memberIdByEmail.set(member.email.toLowerCase(), await seedMember(member));
  }
  // Project sequence continues from the seed.
  await query(
    "INSERT INTO counter_state (name, value) VALUES ('project_seq', 2603) ON CONFLICT (name) DO UPDATE SET value = GREATEST(counter_state.value, 2603)",
  );

  for (const project of PROJECTS) {
    const existing = await one<{ id: string }>('SELECT id FROM projects WHERE reference = $1', [project.reference]);
    if (existing) continue;
    const brandId = await ensureBrand(project.brand);
    const projectId = randomUUID();
    const refSeq = parseInt(project.reference.slice(3), 10);
    const contractCompanyId = project.contract ? await ensureCompany(project.contract.company) : null;
    await query(
      `INSERT INTO projects (id, reference, name, brand_id, region, currency, ref_seq, defects_period_months, contract_company, contract_sum_cents, contract_awarded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        projectId,
        project.reference,
        project.name,
        brandId,
        project.region,
        project.currency,
        refSeq,
        project.defectsPeriodMonths,
        contractCompanyId,
        project.contract?.sumCents ?? null,
        contractCompanyId ? new Date() : null,
      ],
    );
    for (const store of project.stores) {
      await query('INSERT INTO stores (id, project_id, code, name, weight) VALUES ($1,$2,$3,$4,$5)', [
        randomUUID(),
        projectId,
        store.code,
        store.name,
        store.weight,
      ]);
    }
    const positions: Record<string, number> = { groundwork: 1, scheme: 2, detailing: 3, tender_award: 4, build: 5, handover: 6, aftercare: 7 };
    for (const [key, position] of Object.entries(positions)) {
      const fee = key === 'aftercare' ? null : project.fees[key];
      let state = 'not_started';
      let requestedBy: string | null = null;
      let requestedAt: Date | null = null;
      let note: string | null = null;
      if (key === 'groundwork' && project.groundwork) {
        state = 'requested';
        requestedBy = memberIdByEmail.get(project.groundwork.requestedBy) ?? null;
        requestedAt = new Date('2026-10-20T09:00:00Z');
        note = project.groundwork.note;
      }
      await query(
        `INSERT INTO stages (project_id, key, position, fee_cents, state, requested_at, requested_by, internal_note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [projectId, key, position, fee, state, requestedAt, requestedBy, note],
      );
    }
    if (project.reference === 'MH-2601') {
      await seedMh2601(projectId, memberIdByEmail, storage);
    }
    if (project.reference === 'MH-2603') {
      await seedMh2603(projectId, memberIdByEmail);
    }
  }

  await seedCaseStudies();
}

async function seedMh2601(projectId: string, memberIdByEmail: Map<string, string>, storage: Storage): Promise<void> {
  const designerId = memberIdByEmail.get('rin.mok@marrowhall.example')!;
  // Sheets: A-101 revisions A, B, C (PDFs, A and B superseded); A-201 revision A (SVG).
  const sheetA = randomUUID();
  const sheetB = randomUUID();
  await query('INSERT INTO sheets (id, project_id, code, title) VALUES ($1,$2,$3,$4)', [sheetA, projectId, 'A-101', 'General arrangement plan']);
  await query('INSERT INTO sheets (id, project_id, code, title) VALUES ($1,$2,$3,$4)', [sheetB, projectId, 'A-201', 'Shopfront elevation']);
  const pdfA = seedPdf('General arrangement plan', 'Revision A');
  const pdfB = seedPdf('General arrangement plan', 'Revision B');
  const pdfC = seedPdf('General arrangement plan', 'Revision C');
  const svg = seedSheetSvg();
  const uploadedAt = new Date('2026-10-18T02:00:00Z');
  await putIfAbsent(storage, `projects/${projectId}/sheets/A-101/A.pdf`, pdfA, 'application/pdf');
  await putIfAbsent(storage, `projects/${projectId}/sheets/A-101/B.pdf`, pdfB, 'application/pdf');
  await putIfAbsent(storage, `projects/${projectId}/sheets/A-101/C.pdf`, pdfC, 'application/pdf');
  await putIfAbsent(storage, `projects/${projectId}/sheets/A-201/A.svg`, svg, 'image/svg+xml');
  await query(
    `INSERT INTO sheet_revisions (id, sheet_id, revision, position, state, bytes, sha256, content_type, original_name, uploaded_by, uploaded_at)
     VALUES ($1,$2,'A',1,'superseded',$3,$4,'application/pdf','A-101.pdf',$5,$6)`,
    [randomUUID(), sheetA, pdfA.length, sha256Hex(pdfA), designerId, uploadedAt],
  );
  await query(
    `INSERT INTO sheet_revisions (id, sheet_id, revision, position, state, bytes, sha256, content_type, original_name, uploaded_by, uploaded_at)
     VALUES ($1,$2,'B',2,'superseded',$3,$4,'application/pdf','A-101.pdf',$5,$6)`,
    [randomUUID(), sheetA, pdfB.length, sha256Hex(pdfB), designerId, uploadedAt],
  );
  await query(
    `INSERT INTO sheet_revisions (id, sheet_id, revision, position, state, bytes, sha256, content_type, original_name, uploaded_by, uploaded_at)
     VALUES ($1,$2,'C',3,'current',$3,$4,'application/pdf','A-101.pdf',$5,$6)`,
    [randomUUID(), sheetA, pdfC.length, sha256Hex(pdfC), designerId, uploadedAt],
  );
  await query(
    `INSERT INTO sheet_revisions (id, sheet_id, revision, position, state, bytes, sha256, content_type, original_name, uploaded_by, uploaded_at)
     VALUES ($1,$2,'A',1,'current',$3,$4,'image/svg+xml','A-201.svg',$5,$6)`,
    [randomUUID(), sheetB, svg.length, sha256Hex(svg), designerId, uploadedAt],
  );

  // Tender in draft: Shopfront joinery package, contingency 5.00, no close set.
  const tenderId = randomUUID();
  await query(
    `INSERT INTO tenders (id, project_id, title, scope, contingency_percent, created_by, status)
     VALUES ($1,$2,$3,$4,500,$5,'draft')`,
    [
      tenderId,
      projectId,
      'Shopfront joinery package',
      'Supply and installation of shopfront joinery, glazing and entrance doors across the six-store rollout, including setting out, temporary works and making good.',
      memberIdByEmail.get('jordan.lim@marrowhall.example')!,
    ],
  );
  await query(
    'INSERT INTO bidders (id, tender_id, reference, company_name, contact_name, contact_email, member_id, position) VALUES ($1,$2,$3,$4,$5,$6,$7,1)',
    [randomUUID(), tenderId, 'B-01', 'Harbourline Fit-Out Ltd', 'Ash Kwok', 'ash.kwok@harbourline.example', memberIdByEmail.get('ash.kwok@harbourline.example')!],
  );
  await query(
    'INSERT INTO bidders (id, tender_id, reference, company_name, contact_name, contact_email, member_id, position) VALUES ($1,$2,$3,$4,$5,$6,$7,2)',
    [randomUUID(), tenderId, 'B-02', 'Granite Pier Builders', 'Lee Fong', 'lee.fong@granitepier.example', memberIdByEmail.get('lee.fong@granitepier.example')!],
  );

  // Viewpoint VP-01 Entrance elevation at HK-CWB-01 with render and photo.
  const viewpointId = randomUUID();
  await query('INSERT INTO viewpoints (id, project_id, name, store_code, render_ext) VALUES ($1,$2,$3,$4,$5)', [
    viewpointId,
    projectId,
    'VP-01 Entrance elevation',
    'HK-CWB-01',
    'png',
  ]);
  const render = viewpointRenderPng();
  const photo = viewpointPhotoPng();
  await putIfAbsent(storage, `projects/${projectId}/viewpoints/${viewpointId}/render.png`, render, 'image/png');
  const photoId = randomUUID();
  await putIfAbsent(storage, `projects/${projectId}/viewpoints/${viewpointId}/photos/${photoId}.png`, photo, 'image/png');
  await query(
    'INSERT INTO viewpoint_photos (id, viewpoint_id, width, height, ext, bytes, sha256) VALUES ($1,$2,1600,1000,$3,$4,$5)',
    [photoId, viewpointId, 'png', photo.length, sha256Hex(photo)],
  );
  await query('UPDATE viewpoints SET photo_id = $1 WHERE id = $2', [photoId, viewpointId]);
  await query(
    'INSERT INTO snags (id, viewpoint_id, number, s, y, title, note, observed_on, state, raised_by) VALUES ($1,$2,1,32,58,$3,$4,$5,$6,$7)',
    [randomUUID(), viewpointId, 'Shopfront mullion out of line', null, '2026-10-20', 'open', designerId],
  );
  await query(
    'INSERT INTO snags (id, viewpoint_id, number, s, y, title, note, observed_on, state, raised_by) VALUES ($1,$2,2,71,40,$3,$4,$5,$6,$7)',
    [randomUUID(), viewpointId, 'Counter edge banding lifted', null, '2026-10-21', 'fixed', designerId],
  );
  await query(
    "INSERT INTO counter_state (name, value) VALUES ($1, 2) ON CONFLICT (name) DO UPDATE SET value = GREATEST(counter_state.value, 2)",
    [`snag_seq_${viewpointId}`],
  );

  // Finishes schedule.
  const finishes: [string, string, string, string, string, string][] = [
    ['PT-01', 'Warm white eggshell', 'Paint', 'Marrow Paint Works', 'EG-101', 'All walls'],
    ['PT-02', 'Oxide red accent', 'Paint', 'Marrow Paint Works', 'EG-204', 'Feature walls'],
    ['TL-01', 'Terrazzo floor tile', 'Tile', 'Pearl Terrazzo Ltd', 'TZ-600', 'Store floors'],
    ['LM-01', 'Ash laminate', 'Laminate', 'Ridge Boards', 'LM-12', 'Counters'],
    ['ST-01', 'Honed basalt counter', 'Stone', 'Quarry Nine', 'BA-30', 'Service counters'],
    ['MT-01', 'Brushed bronze trim', 'Metal', 'Harbour Metals', 'BR-08', 'Edges and reveals'],
  ];
  for (const [index, finish] of finishes.entries()) {
    await query(
      'INSERT INTO finishes (id, project_id, position, code, name, category, supplier, product_ref, location) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [randomUUID(), projectId, index + 1, finish[0], finish[1], finish[2], finish[3], finish[4], finish[5]],
    );
  }
}

async function seedMh2603(projectId: string, memberIdByEmail: Map<string, string>): Promise<void> {
  // Variation V-001 raised by Kai Ng.
  const kaiId = memberIdByEmail.get('kai.ng@tideway.example')!;
  await query(
    `INSERT INTO variations (id, project_id, number, seq, title, description, amount_cents, store_code, state, raised_by, updated_by)
     VALUES ($1,$2,'V-001',1,$3,$4,$5,'SG-ORC-01','raised',$6,$6)`,
    [
      randomUUID(),
      projectId,
      'Additional bulkhead at Orchard entrance',
      'A second bulkhead is needed over the Orchard entrance to conceal the upgraded air-handling unit. Agree the extra frame, plaster and paint with the site team before fixing off.',
      1_240_000,
      kaiId,
    ],
  );
  await query(
    "INSERT INTO counter_state (name, value) VALUES ($1, 1) ON CONFLICT (name) DO UPDATE SET value = GREATEST(counter_state.value, 1)",
    [`variation_seq_${projectId}`],
  );
  // Shop drawing SD-001, submission 1, received 19 Oct 2026 10:00 HKT, due 27 Oct 2026.
  const shopDrawingId = randomUUID();
  await query('INSERT INTO shop_drawings (id, project_id, reference, title) VALUES ($1,$2,$3,$4)', [
    shopDrawingId,
    projectId,
    'SD-001',
    'Display wall joinery',
  ]);
  const submissionId = randomUUID();
  const receivedAt = new Date('2026-10-19T02:00:00Z');
  await query(
    `INSERT INTO shop_submissions (id, shop_drawing_id, submission, status, received_at, review_due_on, file_bytes, sha256, content_type, file_name)
     VALUES ($1,$2,1,'received',$3,'2026-10-27',$4,$5,$6,$7)`,
    [submissionId, shopDrawingId, receivedAt, 1024, sha256Hex(Buffer.from('display-wall-joinery')), 'application/pdf', 'SD-001.pdf'],
  );
}

async function seedCaseStudies(): Promise<void> {
  const brandId = async (name: string) => (await one<{ id: string }>('SELECT id FROM brands WHERE name = $1', [name]))!.id;
  const studies: {
    title: string;
    slug: string;
    sector: 'retail' | 'workplace' | 'food_beverage';
    brand: string;
    location: string;
    featured: boolean;
    featuredOrder: number | null;
    state: 'published' | 'draft';
    publishedSeq: number | null;
  }[] = [
    { title: 'Kestrel Tea House, Causeway Bay', slug: 'kestrel-causeway-bay', sector: 'food_beverage', brand: 'Kestrel Tea House', location: 'Hong Kong', featured: true, featuredOrder: 1, state: 'published', publishedSeq: 6 },
    { title: 'Cinder Lane Coffee, Sheung Wan', slug: 'cinder-lane-sheung-wan', sector: 'food_beverage', brand: 'Cinder Lane Coffee', location: 'Hong Kong', featured: true, featuredOrder: 2, state: 'published', publishedSeq: 5 },
    { title: 'Northvane Optics, Orchard Road', slug: 'northvane-orchard', sector: 'retail', brand: 'Northvane Optics', location: 'Singapore', featured: true, featuredOrder: 3, state: 'published', publishedSeq: 4 },
    { title: 'Fernhill Paper Goods, Central', slug: 'fernhill-paper-central', sector: 'retail', brand: 'Fernhill Paper Goods', location: 'Hong Kong', featured: false, featuredOrder: null, state: 'published', publishedSeq: 3 },
    { title: 'Tallis Audio, Taikoo', slug: 'tallis-audio-taikoo', sector: 'retail', brand: 'Tallis Audio', location: 'Hong Kong', featured: true, featuredOrder: 4, state: 'published', publishedSeq: 2 },
    { title: 'Lattice Works, Quarry Bay headquarters', slug: 'lattice-works-quarry-bay', sector: 'workplace', brand: 'Lattice Works', location: 'Hong Kong', featured: true, featuredOrder: 5, state: 'published', publishedSeq: 1 },
    { title: 'Kestrel Tea House, Macao', slug: 'kestrel-macao', sector: 'food_beverage', brand: 'Kestrel Tea House', location: 'Macao', featured: true, featuredOrder: null, state: 'draft', publishedSeq: null },
  ];
  for (const study of studies) {
    const existing = await one<{ id: string }>('SELECT id FROM case_studies WHERE slug = $1', [study.slug]);
    if (existing) continue;
    await query(
      `INSERT INTO case_studies (id, title, slug, sector, brand_id, location, summary, body, featured, featured_order, state, published_at, published_seq)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        randomUUID(),
        study.title,
        study.slug,
        study.sector,
        await brandId(study.brand),
        study.location,
        `${study.title} — a rollout delivered store by store, signed off stage by stage.`,
        `${study.title} shows how a multi-store rollout is run on Plumbline. The studio drew the scheme, levelled the tender, and held each stage to its gate. Every drawing stayed current in the register, every shop drawing came back with a code, and retention moved only through the ledger.`,
        study.featured,
        study.featuredOrder,
        study.state,
        study.state === 'published' ? new Date() : null,
        study.publishedSeq,
      ],
    );
  }
  await query(
    "INSERT INTO counter_state (name, value) VALUES ('case_study_pub_seq', 6) ON CONFLICT (name) DO UPDATE SET value = GREATEST(counter_state.value, 6)",
  );
}

async function putIfAbsent(storage: Storage, key: string, data: Buffer, contentType: string): Promise<void> {
  try {
    await storage.get(key);
  } catch {
    try {
      await storage.put(key, data, contentType);
    } catch {
      // Storage unreachable at boot: seed files are rewritten on a later start.
    }
  }
}

export { coverSvg };
