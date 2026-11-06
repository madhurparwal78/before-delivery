import { createHash } from "node:crypto";
import type pg from "pg";
import { hashPassword } from "./auth.js";
import { one, pool, rows } from "./db.js";
import { reviewDueOn } from "./domain/reviewclock.js";
import { revisionLetter } from "./domain/revisions.js";
import { STAGES } from "./domain/stages.js";
import { CONTENT_TYPE } from "./services/files.js";
import { seedPhoto, seedRender } from "./services/images.js";
import { objectExists, putObject } from "./services/storage.js";

// The brief's seed data (Seed data), applied on every start without duplicating anything: each record is
// keyed by its natural key, and a seeded project's children are written only in the start that creates it.

const SEED_PASSWORD = "Marrow-Hall-2026";

const BRANDS = ["Kestrel Tea House", "Northvane Optics", "Cinder Lane Coffee", "Fernhill Paper Goods", "Tallis Audio", "Lattice Works"];
const COMPANIES = ["Harbourline Fit-Out Ltd", "Tideway Joinery Pte Ltd", "Granite Pier Builders"];

const MEMBERS: { name: string; email: string; role: string; org?: string; phone: string; limits?: [number, number] }[] = [
  { name: "Avery Tsang", email: "avery.tsang@marrowhall.example", role: "director", phone: "+852 5550 0101" },
  { name: "Jordan Lim", email: "jordan.lim@marrowhall.example", role: "project_lead", phone: "+852 5550 0102", limits: [5_000_000, 850_000] },
  { name: "Casey Wong", email: "casey.wong@marrowhall.example", role: "project_lead", phone: "+852 5550 0103", limits: [20_000_000, 3_500_000] },
  { name: "Rin Mok", email: "rin.mok@marrowhall.example", role: "designer", phone: "+852 5550 0104" },
  { name: "Sam Teo", email: "sam.teo@marrowhall.example", role: "designer", phone: "+65 5550 0105" },
  { name: "Morgan Ho", email: "morgan.ho@marrowhall.example", role: "finance", phone: "+852 5550 0106" },
  { name: "Dana Cheung", email: "dana.cheung@kestreltea.example", role: "client_approver", org: "Kestrel Tea House", phone: "+852 5550 0201" },
  { name: "Quinn Yeo", email: "quinn.yeo@kestreltea.example", role: "client_approver", org: "Kestrel Tea House", phone: "+852 5550 0202" },
  { name: "Robin Chan", email: "robin.chan@northvane.example", role: "client_approver", org: "Northvane Optics", phone: "+65 5550 0203" },
  { name: "Ash Kwok", email: "ash.kwok@harbourline.example", role: "contractor", org: "Harbourline Fit-Out Ltd", phone: "+852 5550 0301" },
  { name: "Kai Ng", email: "kai.ng@tideway.example", role: "contractor", org: "Tideway Joinery Pte Ltd", phone: "+65 5550 0302" },
  { name: "Lee Fong", email: "lee.fong@granitepier.example", role: "contractor", org: "Granite Pier Builders", phone: "+852 5550 0303" },
];

interface SeedProject {
  number: number;
  name: string;
  brand: string;
  region: "HK" | "SG" | "MO";
  stores: [string, string, number][];
  fees: number[];
  defects: number;
}

const PROJECTS: SeedProject[] = [
  { number: 2601, name: "Kestrel Tea House HK rollout", brand: "Kestrel Tea House", region: "HK", defects: 12,
    stores: [["HK-CWB-01", "Causeway Bay", 120], ["HK-TST-02", "Tsim Sha Tsui", 95], ["HK-MK-03", "Mong Kok", 80],
      ["HK-CEN-04", "Central", 105], ["HK-SHT-05", "Sha Tin", 100], ["HK-KT-06", "Kwun Tong", 100]],
    fees: [6_000_000, 18_000_000, 24_000_000, 9_000_000, 32_000_000, 7_000_000] },
  { number: 2602, name: "Kestrel Tea House Macao", brand: "Kestrel Tea House", region: "MO", defects: 12,
    stores: [["MO-SEN-01", "Senado", 1], ["MO-TAI-02", "Taipa", 1]], fees: Array(6).fill(4_000_000) },
  { number: 2603, name: "Northvane Optics Singapore", brand: "Northvane Optics", region: "SG", defects: 12,
    stores: [["SG-ORC-01", "Orchard", 3], ["SG-JEM-02", "Jurong East", 2], ["SG-TPN-03", "Tampines", 2]], fees: Array(6).fill(3_000_000) },
];

const CASE_STUDIES: { slug: string; title: string; sector: string; brand: string; location: string; featured: number | null;
  state: "published" | "draft"; summary: string; body: string }[] = [
  { slug: "kestrel-causeway-bay", title: "Kestrel Tea House, Causeway Bay", sector: "food_beverage", brand: "Kestrel Tea House",
    location: "Causeway Bay, Hong Kong", featured: 1, state: "published",
    summary: "A flagship tea house fitted out over eleven weeks, with the counter, tea wall and shopfront signed off stage by stage.",
    body: "The Causeway Bay store set the pattern for the rollout. We drew the shopfront and the tea wall once, issued them as a single transmittal and levelled four joinery bids against the same scope.\n\nEvery stage was signed off by the brand in Plumbline, so each fee was invoiced on the day it was earned. The store opened on programme, and its finishes schedule became the template for five more." },
  { slug: "cinder-lane-sheung-wan", title: "Cinder Lane Coffee, Sheung Wan", sector: "food_beverage", brand: "Cinder Lane Coffee",
    location: "Sheung Wan, Hong Kong", featured: 2, state: "published",
    summary: "A narrow-frontage espresso bar where the brew bar, seating rail and back-of-house were built inside a forty-square-metre shell.",
    body: "Sheung Wan's lots are narrow and deep. We placed the brew bar on the long wall and kept the seating rail clear of the service route.\n\nShop drawings for the bar joinery came back within the five-working-day review clock, and the snag list closed before the opening weekend." },
  { slug: "northvane-orchard", title: "Northvane Optics, Orchard Road", sector: "retail", brand: "Northvane Optics",
    location: "Orchard Road, Singapore", featured: 3, state: "published",
    summary: "An optical store with lit display walls, two eye-test rooms and a dispensing counter, delivered for a mall opening date.",
    body: "Mall fit-outs run on the landlord's programme. We tendered the display walls early, priced every exclusion before award and held retention per store.\n\nThe Orchard store was the first of three in Singapore, and its certificates split cleanly across the rollout's stores." },
  { slug: "fernhill-paper-central", title: "Fernhill Paper Goods, Central", sector: "retail", brand: "Fernhill Paper Goods",
    location: "Central, Hong Kong", featured: null, state: "published",
    summary: "A stationery store of timber shelving and a long wrapping counter, built in a heritage arcade with strict working hours.",
    body: "Working hours in the arcade were short, so the joinery was made off site and installed over four nights.\n\nVariations raised on site were priced and approved before work started, so the final account closed without dispute." },
  { slug: "tallis-audio-taikoo", title: "Tallis Audio, Taikoo", sector: "retail", brand: "Tallis Audio",
    location: "Taikoo, Hong Kong", featured: 4, state: "published",
    summary: "A listening store with two acoustic rooms, a demo wall and a repair counter, tuned before the first customer walked in.",
    body: "Acoustic rooms need their linings checked before the ceilings close. We walked each room with the Intent seam, comparing the approved render to the site photo, and pinned every snag where it sat.\n\nThe rooms passed their first measurement, and the store opened a week early." },
  { slug: "lattice-works-quarry-bay", title: "Lattice Works, Quarry Bay headquarters", sector: "workplace", brand: "Lattice Works",
    location: "Quarry Bay, Hong Kong", featured: 5, state: "published",
    summary: "Two floors of studio, meeting rooms and a town-hall stair for a design consultancy of two hundred people.",
    body: "The headquarters was delivered in two phases so the client could move in floor by floor.\n\nEach phase had its own tender, its own certificates and its own retention, all reconciled to the cent across both floors." },
  { slug: "kestrel-macao", title: "Kestrel Tea House, Macao", sector: "food_beverage", brand: "Kestrel Tea House",
    location: "Senado, Macao", featured: 6, state: "draft",
    summary: "The first two Kestrel Tea House stores in Macao, adapted from the Hong Kong pattern for Senado and Taipa.",
    body: "Macao's stores reuse the Hong Kong tea wall and counter, adjusted for smaller frontages.\n\nThe rollout is billed in Hong Kong dollars and signed off by the same brand approvers as Hong Kong." },
];

// Procedural seed files

const seedPdf = (sheet: string, revision: string, title: string): Buffer => Buffer.from(
  `%PDF-1.4\n% Marrow Hall Interiors drawing ${sheet} revision ${revision}\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n` +
  `2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 1191 842]/Contents 4 0 R>>endobj\n` +
  `4 0 obj<</Length 60>>stream\nBT /F1 24 Tf 72 760 Td (${sheet} ${title} rev ${revision}) Tj ET\nendstream endobj\n` +
  `trailer<</Root 1 0 R>>\n%%EOF\n`);

const SHOPFRONT_SVG = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" width="1600" height="1000">
  <rect width="1600" height="1000" fill="#EFEBE2"/>
  <g fill="none" stroke="#191A17" stroke-width="3">
    <rect x="160" y="120" width="1280" height="130"/><rect x="160" y="250" width="1280" height="630"/>
    <rect x="200" y="290" width="1200" height="570"/><path d="M520 290V860M860 290V860M1180 290V860"/>
    <rect x="880" y="330" width="280" height="530"/><path d="M0 882H1600"/>
  </g>
  <text x="160" y="960" font-family="sans-serif" font-size="28" fill="#191A17">A-201 Shopfront elevation</text>
</svg>
`);

const sha256 = (data: Buffer): string => createHash("sha256").update(data).digest("hex");

/** Every seed file, keyed by its bucket key, derived from the seeded records. */
async function seedFiles(): Promise<{ key: string; data: () => Buffer; contentType: string }[]> {
  const files: { key: string; data: () => Buffer; contentType: string }[] = [];
  const sheets = await rows<{ project_id: string; code: string; title: string; revision: string; extension: string }>(pool,
    `SELECT s.project_id, s.code, s.title, r.revision, r.extension FROM sheets s JOIN sheet_revisions r ON r.sheet_id = s.id
     JOIN projects p ON p.id = s.project_id WHERE p.reference = 'MH-2601' AND s.code IN ('A-101', 'A-201')`);
  for (const sheet of sheets) {
    files.push({
      key: `projects/${sheet.project_id}/sheets/${sheet.code}/${sheet.revision}.${sheet.extension}`,
      data: () => (sheet.extension === "svg" ? SHOPFRONT_SVG : seedPdf(sheet.code, sheet.revision, sheet.title)),
      contentType: sheet.extension === "svg" ? CONTENT_TYPE.svg : CONTENT_TYPE.pdf,
    });
  }
  const view = await one<{ project_id: string; id: string; photo_id: string }>(pool,
    `SELECT v.project_id, v.id, ph.id AS photo_id FROM viewpoints v JOIN projects p ON p.id = v.project_id
     JOIN photos ph ON ph.viewpoint_id = v.id WHERE p.reference = 'MH-2601' AND v.name = 'VP-01 Entrance elevation'
     ORDER BY ph.uploaded_at LIMIT 1`);
  if (view) {
    const base = `projects/${view.project_id}/viewpoints/${view.id}`;
    files.push({ key: `${base}/render.png`, data: seedRender, contentType: CONTENT_TYPE.png });
    files.push({ key: `${base}/photos/${view.photo_id}.png`, data: seedPhoto, contentType: CONTENT_TYPE.png });
  }
  const drawing = await one<{ project_id: string; id: string }>(pool,
    `SELECT d.project_id, d.id FROM shop_drawings d JOIN projects p ON p.id = d.project_id
     WHERE p.reference = 'MH-2603' AND d.reference = 'SD-001'`);
  if (drawing) {
    files.push({ key: `projects/${drawing.project_id}/shop-drawings/${drawing.id}/1.pdf`,
      data: () => seedPdf("SD-001", "1", "Display wall joinery"), contentType: CONTENT_TYPE.pdf });
  }
  return files;
}

/** Rewrites any missing seed file; resolves false while storage is unreachable. */
export async function syncSeedFiles(): Promise<boolean> {
  try {
    for (const file of await seedFiles()) {
      if (!(await objectExists(file.key))) await putObject(file.key, file.data(), file.contentType);
    }
    return true;
  } catch {
    return false;
  }
}

// Seed records

async function id(client: pg.PoolClient, sql: string, params: unknown[]): Promise<string> {
  return (await client.query<{ id: string }>(sql, params)).rows[0].id;
}

export async function seed(client: pg.PoolClient): Promise<void> {
  for (const name of BRANDS) await client.query("INSERT INTO brands (name) VALUES ($1) ON CONFLICT (name) DO NOTHING", [name]);
  for (const name of COMPANIES) await client.query("INSERT INTO companies (name) VALUES ($1) ON CONFLICT (name) DO NOTHING", [name]);
  const brand = async (name: string): Promise<string> => id(client, "SELECT id FROM brands WHERE name = $1", [name]);
  const company = async (name: string): Promise<string> => id(client, "SELECT id FROM companies WHERE name = $1", [name]);

  for (const m of MEMBERS) {
    const exists = await client.query("SELECT 1 FROM members WHERE lower(email) = $1", [m.email]);
    if (exists.rowCount) continue;
    await client.query(
      `INSERT INTO members (email, name, phone, role, brand_id, company_id, password_hash, approval_limit_hkd, approval_limit_sgd)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [m.email, m.name, m.phone, m.role, m.role === "client_approver" ? await brand(m.org ?? "") : null,
        m.role === "contractor" ? await company(m.org ?? "") : null, await hashPassword(SEED_PASSWORD),
        m.limits?.[0] ?? null, m.limits?.[1] ?? null]);
  }
  const member = async (email: string): Promise<string> => id(client, "SELECT id FROM members WHERE lower(email) = $1", [email]);

  for (const p of PROJECTS) {
    const created = await client.query<{ id: string }>(
      `INSERT INTO projects (number, reference, name, brand_id, region, currency, time_zone, defects_period_months)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (reference) DO NOTHING RETURNING id`,
      [p.number, `MH-${p.number}`, p.name, await brand(p.brand), p.region, p.region === "SG" ? "SGD" : "HKD",
        p.region === "SG" ? "Asia/Singapore" : "Asia/Hong_Kong", p.defects]);
    const projectId = created.rows[0]?.id;
    if (!projectId) continue;
    for (const [index, [code, name, weight]] of p.stores.entries()) {
      await client.query("INSERT INTO stores (project_id, code, name, weight, position) VALUES ($1, $2, $3, $4, $5)",
        [projectId, code, name, weight, index + 1]);
    }
    for (const [index, stage] of STAGES.entries()) {
      await client.query("INSERT INTO stages (project_id, key, position, fee_cents, state) VALUES ($1, $2, $3, $4, 'not_started')",
        [projectId, stage.key, index + 1, stage.feeKey ? p.fees[index] : null]);
    }
    if (p.number === 2601) await seedKestrelHongKong(client, projectId, member, company);
    if (p.number === 2603) await seedNorthvane(client, projectId, member, company);
  }

  const featuredAt = Date.parse("2026-09-01T02:00:00Z");
  for (const [index, c] of CASE_STUDIES.entries()) {
    await client.query(
      `INSERT INTO case_studies (title, slug, sector, brand_id, location, summary, body, featured, featured_order, state, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (slug) DO NOTHING`,
      [c.title, c.slug, c.sector, await brand(c.brand), c.location, c.summary, c.body, c.featured !== null, c.featured,
        c.state, c.state === "published" ? new Date(featuredAt - index * 86_400_000 * 9).toISOString() : null]);
  }
}

async function seedKestrelHongKong(client: pg.PoolClient, projectId: string, member: (email: string) => Promise<string>,
  company: (name: string) => Promise<string>): Promise<void> {
  const jordan = await member("jordan.lim@marrowhall.example");
  const rin = await member("rin.mok@marrowhall.example");
  await client.query(
    `UPDATE stages SET state = 'requested', requested_at = now(), requested_by = $2,
       internal_note = 'Courtesy discount agreed by director, do not quote to client'
     WHERE project_id = $1 AND key = 'groundwork'`, [projectId, jordan]);

  const sheetSpecs: [string, string, number, "pdf" | "svg"][] = [["A-101", "General arrangement plan", 3, "pdf"], ["A-201", "Shopfront elevation", 1, "svg"]];
  for (const [code, title, count, extension] of sheetSpecs) {
    const sheetId = await id(client, "INSERT INTO sheets (project_id, code, title) VALUES ($1, $2, $3) RETURNING id", [projectId, code, title]);
    for (let ordinal = 0; ordinal < count; ordinal++) {
      const revision = revisionLetter(ordinal);
      const data = extension === "svg" ? SHOPFRONT_SVG : seedPdf(code, revision, title);
      await client.query(
        `INSERT INTO sheet_revisions (sheet_id, ordinal, revision, state, bytes, sha256, content_type, extension, original_name, uploaded_by, uploaded_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now() - make_interval(days => $11))`,
        [sheetId, ordinal, revision, ordinal === count - 1 ? "current" : "superseded", data.length, sha256(data),
          CONTENT_TYPE[extension], extension, `${code}-${revision}.${extension}`, rin, (count - ordinal) * 14]);
    }
  }

  const tenderId = await id(client,
    `INSERT INTO tenders (project_id, title, scope, contingency_basis_points, status)
     VALUES ($1, 'Shopfront joinery package', 'Shopfront joinery, fascia and entrance door for the six Hong Kong stores.', 500, 'draft')
     RETURNING id`, [projectId]);
  const bidders: [string, string, string][] = [
    ["Harbourline Fit-Out Ltd", "Ash Kwok", "ash.kwok@harbourline.example"],
    ["Granite Pier Builders", "Lee Fong", "lee.fong@granitepier.example"],
  ];
  for (const [index, [companyName, contact, email]] of bidders.entries()) {
    await client.query(
      `INSERT INTO tender_bidders (tender_id, position, reference, company_id, company_name, contact_name, contact_email, member_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [tenderId, index + 1, `B-0${index + 1}`, await company(companyName), companyName, contact, email, await member(email)]);
  }

  const viewpointId = await id(client,
    `INSERT INTO viewpoints (project_id, name, store_code, render_extension, render_content_type)
     VALUES ($1, 'VP-01 Entrance elevation', 'HK-CWB-01', 'png', 'image/png') RETURNING id`, [projectId]);
  await client.query("INSERT INTO photos (viewpoint_id, width, height, extension, content_type) VALUES ($1, 1600, 1000, 'png', 'image/png')", [viewpointId]);
  await client.query(
    `INSERT INTO snags (viewpoint_id, number, s, y, title, observed_on, state) VALUES
       ($1, 1, 32, 58, 'Shopfront mullion out of line', '2026-10-20', 'open'),
       ($1, 2, 71, 40, 'Counter edge banding lifted', '2026-10-21', 'fixed')`, [viewpointId]);

  const finishes: [string, string, string][] = [["PT-01", "Warm white eggshell", "Paint"], ["PT-02", "Oxide red accent", "Paint"],
    ["TL-01", "Terrazzo floor tile", "Tile"], ["LM-01", "Ash laminate", "Laminate"], ["ST-01", "Honed basalt counter", "Stone"],
    ["MT-01", "Brushed bronze trim", "Metal"]];
  for (const [index, [code, name, category]] of finishes.entries()) {
    await client.query("INSERT INTO finishes (project_id, position, code, name, category) VALUES ($1, $2, $3, $4, $5)",
      [projectId, index + 1, code, name, category]);
  }
}

async function seedNorthvane(client: pg.PoolClient, projectId: string, member: (email: string) => Promise<string>,
  company: (name: string) => Promise<string>): Promise<void> {
  const kai = await member("kai.ng@tideway.example");
  await client.query("INSERT INTO contracts (project_id, company_id, contract_sum_cents) VALUES ($1, $2, 124000000)",
    [projectId, await company("Tideway Joinery Pte Ltd")]);
  const variationId = await id(client,
    `INSERT INTO variations (project_id, sequence, number, title, description, amount_cents, currency, store_code, state, raised_by, updated_by)
     VALUES ($1, 1, 'V-001', 'Additional bulkhead at Orchard entrance',
       'The mall asked for a bulkhead over the Orchard entrance to hide the sprinkler main.', 1240000, 'SGD', 'SG-ORC-01', 'raised', $2, $2)
     RETURNING id`, [projectId, kai]);
  await client.query("INSERT INTO variation_events (variation_id, action, state, by_member) VALUES ($1, 'raise', 'raised', $2)", [variationId, kai]);
  const drawingId = await id(client,
    "INSERT INTO shop_drawings (project_id, reference, title) VALUES ($1, 'SD-001', 'Display wall joinery') RETURNING id", [projectId]);
  const received = new Date("2026-10-19T10:00:00+08:00");
  const pdf = seedPdf("SD-001", "1", "Display wall joinery");
  await client.query(
    `INSERT INTO shop_drawing_submissions (shop_drawing_id, submission, received_at, review_due_on, extension, content_type, bytes, original_name, submitted_by)
     VALUES ($1, 1, $2, $3, 'pdf', 'application/pdf', $4, 'SD-001-display-wall.pdf', $5)`,
    [drawingId, received.toISOString(), reviewDueOn(received), pdf.length, kai]);
}
