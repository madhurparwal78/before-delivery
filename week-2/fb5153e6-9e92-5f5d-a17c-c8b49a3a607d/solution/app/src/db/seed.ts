import { createHash } from 'node:crypto';
import { query, queryOne } from './pool.js';
import { createConfirmedUpload } from './uploads.js';
import type { Category, Format, Visibility } from '../domain/model.js';
import type { ModelState } from '../domain/states.js';
import type { Camera, Hotspot } from '../shared/viewer.js';
import { round1 } from '../shared/viewer.js';
import { hashPassword } from '../domain/session.js';
import type { Role } from '../domain/session.js';
import { compositeGlb } from '../media/geometry.js';
import { parseGlb, readGeometry, scaleGlbPositions } from '../media/gltf.js';
import { writeBinaryStl } from '../media/stl.js';
import { renderPreview } from '../media/render.js';
import { objectKeys, putObject } from '../services/s3.js';

interface SeedUser {
  readonly name: string;
  readonly email: string;
  readonly password: string;
  readonly role: Role;
}

const USERS: readonly SeedUser[] = [
  { name: 'Rowan Teague', email: 'author@ashgrove.test', password: 'turnstone-author-1', role: 'author' },
  { name: 'Imre Castell', email: 'editor@ashgrove.test', password: 'turnstone-editor-1', role: 'editor' },
  { name: 'Kit Arden', email: 'kit@contrib.test', password: 'turnstone-contrib-1', role: 'contributor' },
  { name: 'Sol Varga', email: 'sol@contrib.test', password: 'turnstone-contrib-2', role: 'contributor' },
  { name: 'Dana Mire', email: 'support@ashgrove.test', password: 'turnstone-staff-1', role: 'staff' },
];

const DEFAULT_CAMERA: Camera = { azimuth: 30, tilt: 20, distance: 2.4, fov: 35 };
const DEFAULT_SIZE: readonly [number, number, number] = [50, 50, 50];
const BOTH_FORMATS: readonly Format[] = ['glb', 'stl'];
const GLB_ONLY: readonly Format[] = ['glb'];

interface SeedModel {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly category: Category;
  readonly state: ModelState;
  readonly visibility: Visibility;
  readonly firstPublished: string | null;
  readonly ownerEmail: string;
  readonly sizeMm: readonly [number, number, number];
  readonly camera: Camera;
  readonly scaleDenominator: number;
  readonly formats: readonly Format[];
  readonly personalCents: number;
  readonly commercialCents: number | null;
  readonly studioCents: number | null;
  readonly discountPercent: number;
  readonly editionTotal: number | null;
  readonly editionPriceCents: number | null;
  readonly editionClaimed: number;
  readonly hotspots: readonly Hotspot[];
  readonly password: string | null;
  readonly shareToken: string | null;
  readonly embedToken: string | null;
}

const AUTHOR = 'author@ashgrove.test';
const KIT = 'kit@contrib.test';
const SOL = 'sol@contrib.test';

function model(partial: Partial<SeedModel> & Pick<SeedModel, 'slug' | 'title' | 'category' | 'state' | 'visibility'>): SeedModel {
  return {
    description: '',
    firstPublished: null,
    ownerEmail: AUTHOR,
    sizeMm: DEFAULT_SIZE,
    camera: DEFAULT_CAMERA,
    scaleDenominator: 1,
    formats: BOTH_FORMATS,
    personalCents: 1000,
    commercialCents: null,
    studioCents: null,
    discountPercent: 0,
    editionTotal: null,
    editionPriceCents: null,
    editionClaimed: 0,
    hotspots: [],
    password: null,
    shareToken: null,
    embedToken: null,
    ...partial,
  };
}

const NAMED_MODELS: readonly SeedModel[] = [
  model({
    slug: 'survey-lantern',
    title: 'Survey Lantern',
    category: 'hard-surface',
    state: 'published',
    visibility: 'public',
    firstPublished: '2026-10-20T10:00:00Z',
    sizeMm: [80, 120, 90],
    personalCents: 2161,
    commercialCents: 6483,
    studioCents: 17288,
    discountPercent: 15,
    hotspots: [
      { label: 'Handle loop', x_mm: 0, y_mm: 55, z_mm: 0 },
      { label: 'Glass panel', x_mm: 40, y_mm: 0, z_mm: 0 },
      { label: 'Fuel cap', x_mm: 30, y_mm: -50, z_mm: 20 },
    ],
    embedToken: 'emb_seed_lantern_7f3a91c2',
  }),
  model({
    slug: 'basalt-warden',
    title: 'Basalt Warden',
    category: 'miniature',
    state: 'published',
    visibility: 'public',
    firstPublished: '2026-10-25T10:00:00Z',
    sizeMm: [20, 60, 30],
    scaleDenominator: 30,
    camera: { azimuth: 0, tilt: 10, distance: 3.0, fov: 30 },
    personalCents: 1200,
    commercialCents: 3600,
    editionTotal: 25,
    editionPriceCents: 3400,
    editionClaimed: 24,
    hotspots: [
      { label: 'Rune shield', x_mm: 8, y_mm: 5, z_mm: 12 },
      { label: 'Basalt base', x_mm: 0, y_mm: -28, z_mm: 0 },
    ],
  }),
  model({
    slug: 'gearbox-cutaway',
    title: 'Gearbox Cutaway',
    category: 'hard-surface',
    state: 'published',
    visibility: 'unlisted',
    firstPublished: '2026-10-15T10:00:00Z',
    personalCents: 1500,
    shareToken: 'shr_seed_gearbox_4kq7w2',
  }),
  model({
    slug: 'commission-ketch',
    title: 'Commission Ketch',
    category: 'scan',
    state: 'published',
    visibility: 'password',
    firstPublished: '2026-10-18T10:00:00Z',
    personalCents: 4000,
    formats: GLB_ONLY,
    password: 'ketch-proof-7',
  }),
  model({
    slug: 'client-bust-halden',
    title: 'Client Bust Halden',
    category: 'scan',
    state: 'published',
    visibility: 'private',
    firstPublished: '2026-08-20T10:00:00Z',
    personalCents: 9000,
    formats: GLB_ONLY,
  }),
  model({
    slug: 'pressure-gauge-mk1',
    title: 'Pressure Gauge Mk1',
    category: 'hard-surface',
    state: 'withdrawn',
    visibility: 'public',
    firstPublished: '2026-08-25T10:00:00Z',
    personalCents: 800,
  }),
  model({
    slug: 'arch-window-trim',
    title: 'Arch Window Trim',
    category: 'hard-surface',
    state: 'draft',
    visibility: 'private',
    personalCents: 1000,
  }),
  model({
    slug: 'lichen-plinth',
    title: 'Lichen Plinth',
    category: 'scan',
    state: 'draft',
    visibility: 'private',
    ownerEmail: KIT,
    personalCents: 1000,
  }),
  model({
    slug: 'ferry-bollard',
    title: 'Ferry Bollard',
    category: 'hard-surface',
    state: 'in_review',
    visibility: 'public',
    ownerEmail: KIT,
    personalCents: 1100,
  }),
  model({
    slug: 'tin-robot',
    title: 'Tin Robot',
    category: 'miniature',
    state: 'draft',
    visibility: 'private',
    ownerEmail: SOL,
    personalCents: 900,
  }),
];

const FILLER_CATEGORIES: readonly Category[] = ['scan', 'hard-surface', 'miniature'];

function fillerModels(): readonly SeedModel[] {
  const out: SeedModel[] = [];
  for (let n = 1; n <= 40; n += 1) {
    const nn = String(n).padStart(2, '0');
    const personal = 500 + 37 * n;
    const published = new Date(Date.UTC(2026, 8, 1, 10, 0, 0) + (n - 1) * 86_400_000);
    out.push(
      model({
        slug: `workshop-piece-${nn}`,
        title: `Workshop Piece ${nn}`,
        description: `Workshop study piece ${nn} for the demo catalogue.`,
        category: FILLER_CATEGORIES[n % 3] ?? 'scan',
        state: 'published',
        visibility: 'public',
        firstPublished: published.toISOString(),
        personalCents: personal,
        commercialCents: n % 3 === 0 ? null : personal * 3,
        studioCents: n % 5 === 0 ? personal * 8 : null,
        formats: n % 4 === 0 ? GLB_ONLY : BOTH_FORMATS,
      }),
    );
  }
  return out;
}

interface SeedCollection {
  readonly slug: string;
  readonly name: string;
  readonly models: readonly string[];
}

const COLLECTIONS: readonly SeedCollection[] = [
  {
    slug: 'workshop-lighting',
    name: 'Workshop Lighting',
    models: ['survey-lantern', 'workshop-piece-01', 'workshop-piece-04'],
  },
  {
    slug: 'tabletop-wardens',
    name: 'Tabletop Wardens',
    models: ['basalt-warden', 'workshop-piece-02', 'workshop-piece-05', 'workshop-piece-08'],
  },
  { slug: 'client-work', name: 'Client Work', models: ['client-bust-halden', 'commission-ketch'] },
];

const READ_KEY = {
  ref: 'k_seed0001',
  name: 'Demo reader',
  key: 'tsr_seed_5d0c2b7e91a4f368',
} as const;

export function hashReadKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

async function seedUsers(): Promise<void> {
  for (const user of USERS) {
    const existing = await queryOne<{ id: number }>(`SELECT id FROM users WHERE email = $1`, [
      user.email,
    ]);
    if (existing !== null) continue;
    await query(`INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4)`, [
      user.email,
      user.name,
      user.role,
      await hashPassword(user.password),
    ]);
  }
}

interface BuiltGeometry {
  readonly original: Buffer;
  readonly sha256: string;
  readonly glb: Buffer;
  readonly stl: Buffer;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly depthMm: number;
  readonly boundingRadiusMm: number;
  readonly triangles: Float32Array;
  readonly box: { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] };
}

/** Seed geometry is generated procedurally, once per distinct size. */
function buildGeometry(size: readonly [number, number, number]): BuiltGeometry {
  const original = compositeGlb(size[0], size[1], size[2]);
  const glb = scaleGlbPositions(parseGlb(original), 0.001);
  const geometry = readGeometry(parseGlb(glb));
  const widthMm = round1((geometry.box.max[0] - geometry.box.min[0]) * 1000);
  const heightMm = round1((geometry.box.max[1] - geometry.box.min[1]) * 1000);
  const depthMm = round1((geometry.box.max[2] - geometry.box.min[2]) * 1000);
  return {
    original,
    sha256: createHash('sha256').update(original).digest('hex'),
    glb,
    stl: writeBinaryStl(geometry.triangles),
    widthMm,
    heightMm,
    depthMm,
    boundingRadiusMm: round1(Math.hypot(widthMm, heightMm, depthMm) / 2),
    triangles: geometry.triangles,
    box: geometry.box,
  };
}

function sizeKey(size: readonly [number, number, number]): string {
  return size.join('x');
}

function cameraKey(camera: Camera): string {
  return `${camera.azimuth}/${camera.tilt}/${camera.distance}/${camera.fov}`;
}

async function seedModel(
  spec: SeedModel,
  geometry: BuiltGeometry,
  preview: Buffer,
  userIds: ReadonlyMap<string, number>,
): Promise<void> {
  const existing = await queryOne<{ id: number }>(`SELECT id FROM models WHERE slug = $1`, [
    spec.slug,
  ]);
  if (existing !== null) return;

  const ownerId = userIds.get(spec.ownerEmail);
  if (ownerId === undefined) throw new Error(`Seed user ${spec.ownerEmail} is missing`);

  await putObject(objectKeys.original(geometry.sha256), geometry.original, 'model/gltf-binary');

  const inserted = await queryOne<{ id: number }>(
    `INSERT INTO models (
       slug, title, description, category, state, visibility, owner_user_id,
       password_hash, share_token, personal_cents, commercial_cents, studio_cents,
       discount_percent, edition_total, edition_price_cents, scale_denominator, formats,
       width_mm, height_mm, depth_mm, bounding_radius_mm, default_camera, hotspots,
       first_published_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,
             COALESCE($24, now()))
     RETURNING id`,
    [
      spec.slug,
      spec.title,
      spec.description,
      spec.category,
      spec.state,
      spec.visibility,
      ownerId,
      spec.password === null ? null : await hashPassword(spec.password),
      spec.shareToken,
      spec.personalCents,
      spec.commercialCents,
      spec.studioCents,
      spec.discountPercent,
      spec.editionTotal,
      spec.editionPriceCents,
      spec.scaleDenominator,
      spec.formats,
      geometry.widthMm,
      geometry.heightMm,
      geometry.depthMm,
      geometry.boundingRadiusMm,
      JSON.stringify(spec.camera),
      JSON.stringify(spec.hotspots),
      spec.firstPublished,
    ],
  );
  if (inserted === null) throw new Error(`Seed model ${spec.slug} was not created`);
  const modelId = inserted.id;

  const revision = await queryOne<{ id: number }>(
    `INSERT INTO revisions (model_id, revision, original_sha256, original_filename, original_bytes,
       source_unit, package_kind, width_mm, height_mm, depth_mm, bounding_radius_mm, published_at)
     VALUES ($1, 1, $2, $3, $4, 'mm', 'gltf-binary', $5, $6, $7, $8, now())
     RETURNING id`,
    [
      modelId,
      geometry.sha256,
      `${spec.slug}.glb`,
      geometry.original.length,
      geometry.widthMm,
      geometry.heightMm,
      geometry.depthMm,
      geometry.boundingRadiusMm,
    ],
  );
  if (revision === null) throw new Error(`Seed revision for ${spec.slug} was not created`);

  const files: readonly [kind: 'glb' | 'stl' | 'preview', file: 'model.glb' | 'model.stl' | 'preview.png', bytes: Buffer, type: string][] = [
    ['glb', 'model.glb', geometry.glb, 'model/gltf-binary'],
    ['stl', 'model.stl', geometry.stl, 'model/stl'],
    ['preview', 'preview.png', preview, 'image/png'],
  ];
  for (const [kind, file, body, contentType] of files) {
    const key = objectKeys.derivative(spec.slug, 1, file);
    await putObject(key, body, contentType);
    await query(
      `INSERT INTO derivatives (revision_id, kind, object_key, bytes) VALUES ($1, $2, $3, $4)`,
      [revision.id, kind, key, body.length],
    );
  }

  const uploadRef = `up_${createHash('sha256').update(spec.slug).digest('hex').slice(0, 12)}`;
  await createConfirmedUpload(uploadRef, modelId, revision.id);

  if (spec.embedToken !== null) {
    await query(`INSERT INTO embeds (token, model_id) VALUES ($1, $2)`, [spec.embedToken, modelId]);
  }
  for (let number = 1; number <= spec.editionClaimed; number += 1) {
    await query(`INSERT INTO edition_copies (model_id, number) VALUES ($1, $2)`, [modelId, number]);
  }
}

async function seedModels(): Promise<void> {
  const users = await query<{ id: number; email: string }>(`SELECT id, email FROM users`);
  const userIds = new Map(users.map((u) => [u.email, u.id]));

  const specs = [...NAMED_MODELS, ...fillerModels()];
  const geometries = new Map<string, BuiltGeometry>();
  const previews = new Map<string, Buffer>();

  for (const spec of specs) {
    const key = sizeKey(spec.sizeMm);
    let geometry = geometries.get(key);
    if (geometry === undefined) {
      geometry = buildGeometry(spec.sizeMm);
      geometries.set(key, geometry);
    }
    const previewKey = `${key}|${cameraKey(spec.camera)}`;
    let preview = previews.get(previewKey);
    if (preview === undefined) {
      preview = renderPreview(
        geometry.triangles,
        geometry.box,
        spec.camera,
        geometry.boundingRadiusMm,
      );
      previews.set(previewKey, preview);
    }
    await seedModel(spec, geometry, preview, userIds);
  }
}

async function seedCollections(): Promise<void> {
  for (const collection of COLLECTIONS) {
    const existing = await queryOne<{ id: number }>(`SELECT id FROM collections WHERE slug = $1`, [
      collection.slug,
    ]);
    if (existing !== null) continue;
    const inserted = await queryOne<{ id: number }>(
      `INSERT INTO collections (slug, name) VALUES ($1, $2) RETURNING id`,
      [collection.slug, collection.name],
    );
    if (inserted === null) continue;
    for (const slug of collection.models) {
      await query(
        `INSERT INTO collection_items (collection_id, model_id)
         SELECT $1, id FROM models WHERE slug = $2
         ON CONFLICT DO NOTHING`,
        [inserted.id, slug],
      );
    }
  }
}

async function seedReadKey(): Promise<void> {
  await query(
    `INSERT INTO read_keys (key_ref, name, key_hash) VALUES ($1, $2, $3)
     ON CONFLICT (key_ref) DO NOTHING`,
    [READ_KEY.ref, READ_KEY.name, hashReadKey(READ_KEY.key)],
  );
}

/** The seed is idempotent and never duplicates. */
export async function seed(): Promise<void> {
  await seedUsers();
  await seedModels();
  await seedCollections();
  await seedReadKey();
}
