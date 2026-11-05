import { query, one, withTransaction } from '../db/db.js';
import { hashPassword, sha256Hex } from '../domain/ids.js';
import { buildGlb, buildBoxMesh, buildCylinderMesh, mergeMeshes, meshBounds, scaleMesh, type Mesh, type Box } from '../geometry/glb.js';
import { buildStl } from '../geometry/stl.js';
import { renderPreview } from '../geometry/raster.js';
import { putObject, derivativeKey, originalKey, ensureBucket } from '../providers/storage.js';
import { ensureIndex } from '../providers/search.js';
import { ensureBillingSetup } from '../domain/plan-service.js';
import { hashKey } from '../domain/api-keys.js';

interface SeedUser {
  email: string;
  password: string;
  role: string;
}

const USERS: SeedUser[] = [
  { email: 'author@ashgrove.test', password: 'turnstone-author-1', role: 'author' },
  { email: 'editor@ashgrove.test', password: 'turnstone-editor-1', role: 'editor' },
  { email: 'kit@contrib.test', password: 'turnstone-contrib-1', role: 'contributor' },
  { email: 'sol@contrib.test', password: 'turnstone-contrib-2', role: 'contributor' },
  { email: 'support@ashgrove.test', password: 'turnstone-staff-1', role: 'staff' },
];

interface SeedModel {
  slug: string;
  title: string;
  category: string;
  state: 'draft' | 'in_review' | 'published' | 'withdrawn';
  visibility: 'public' | 'unlisted' | 'private' | 'password';
  firstPublishedAt?: string;
  dims: { width: number; height: number; depth: number };
  shape: 'plain' | 'lantern' | 'warden' | 'filler';
  scaleDenominator: number;
  camera: { azimuth: number; tilt: number; distance: number; fov: number };
  hotspots: { label: string; x_mm: number; y_mm: number; z_mm: number }[];
  prices: { personal: number; commercial?: number; studio?: number };
  discount: number;
  edition?: { total: number; price: number };
  owner?: string;
  password?: string;
  hasStl: boolean;
  description?: string;
}

const BASE_MODEL: Omit<SeedModel, 'slug' | 'title' | 'category' | 'state' | 'visibility' | 'dims' | 'shape' | 'prices' | 'hasStl'> = {
  scaleDenominator: 1,
  camera: { azimuth: 30, tilt: 20, distance: 2.4, fov: 35 },
  hotspots: [],
  discount: 0,
};

const NAMED_MODELS: SeedModel[] = [
  {
    ...BASE_MODEL,
    slug: 'survey-lantern',
    title: 'Survey Lantern',
    category: 'hard-surface',
    state: 'published',
    visibility: 'public',
    firstPublishedAt: '2026-10-20T10:00:00Z',
    dims: { width: 80, height: 120, depth: 90 },
    shape: 'lantern',
    camera: { azimuth: 30, tilt: 20, distance: 2.4, fov: 35 },
    hotspots: [
      { label: 'Handle loop', x_mm: 0, y_mm: 55, z_mm: 0 },
      { label: 'Glass panel', x_mm: 40, y_mm: 0, z_mm: 0 },
      { label: 'Fuel cap', x_mm: 30, y_mm: -50, z_mm: 20 },
    ],
    prices: { personal: 2161, commercial: 6483, studio: 17288 },
    discount: 15,
    hasStl: true,
  },
  {
    ...BASE_MODEL,
    slug: 'basalt-warden',
    title: 'Basalt Warden',
    category: 'miniature',
    state: 'published',
    visibility: 'public',
    firstPublishedAt: '2026-10-25T10:00:00Z',
    dims: { width: 20, height: 60, depth: 30 },
    shape: 'warden',
    scaleDenominator: 30,
    camera: { azimuth: 0, tilt: 10, distance: 3.0, fov: 30 },
    hotspots: [
      { label: 'Rune shield', x_mm: 8, y_mm: 5, z_mm: 12 },
      { label: 'Basalt base', x_mm: 0, y_mm: -28, z_mm: 0 },
    ],
    prices: { personal: 1200, commercial: 3600 },
    edition: { total: 25, price: 3400 },
    hasStl: true,
  },
  {
    ...BASE_MODEL,
    slug: 'gearbox-cutaway',
    title: 'Gearbox Cutaway',
    category: 'hard-surface',
    state: 'published',
    visibility: 'unlisted',
    firstPublishedAt: '2026-10-15T10:00:00Z',
    dims: { width: 50, height: 50, depth: 50 },
    shape: 'plain',
    prices: { personal: 1500 },
    hasStl: true,
  },
  {
    ...BASE_MODEL,
    slug: 'commission-ketch',
    title: 'Commission Ketch',
    category: 'scan',
    state: 'published',
    visibility: 'password',
    firstPublishedAt: '2026-10-18T10:00:00Z',
    dims: { width: 50, height: 50, depth: 50 },
    shape: 'plain',
    prices: { personal: 4000 },
    password: 'ketch-proof-7',
    hasStl: false,
  },
  {
    ...BASE_MODEL,
    slug: 'client-bust-halden',
    title: 'Client Bust Halden',
    category: 'scan',
    state: 'published',
    visibility: 'private',
    firstPublishedAt: '2026-08-20T10:00:00Z',
    dims: { width: 50, height: 50, depth: 50 },
    shape: 'plain',
    prices: { personal: 9000 },
    hasStl: false,
  },
  {
    ...BASE_MODEL,
    slug: 'pressure-gauge-mk1',
    title: 'Pressure Gauge Mk1',
    category: 'hard-surface',
    state: 'withdrawn',
    visibility: 'public',
    firstPublishedAt: '2026-08-25T10:00:00Z',
    dims: { width: 50, height: 50, depth: 50 },
    shape: 'plain',
    prices: { personal: 800 },
    hasStl: true,
  },
  {
    ...BASE_MODEL,
    slug: 'arch-window-trim',
    title: 'Arch Window Trim',
    category: 'hard-surface',
    state: 'draft',
    visibility: 'private',
    dims: { width: 50, height: 50, depth: 50 },
    shape: 'plain',
    prices: { personal: 1000 },
    hasStl: true,
  },
  {
    ...BASE_MODEL,
    slug: 'lichen-plinth',
    title: 'Lichen Plinth',
    category: 'scan',
    state: 'draft',
    visibility: 'private',
    dims: { width: 50, height: 50, depth: 50 },
    shape: 'plain',
    prices: { personal: 1000 },
    owner: 'kit@contrib.test',
    hasStl: true,
  },
  {
    ...BASE_MODEL,
    slug: 'ferry-bollard',
    title: 'Ferry Bollard',
    category: 'hard-surface',
    state: 'in_review',
    visibility: 'public',
    dims: { width: 50, height: 50, depth: 50 },
    shape: 'plain',
    prices: { personal: 1100 },
    owner: 'kit@contrib.test',
    hasStl: true,
  },
  {
    ...BASE_MODEL,
    slug: 'tin-robot',
    title: 'Tin Robot',
    category: 'miniature',
    state: 'draft',
    visibility: 'private',
    dims: { width: 50, height: 50, depth: 50 },
    shape: 'plain',
    prices: { personal: 900 },
    owner: 'sol@contrib.test',
    hasStl: true,
  },
];

function fillerModels(): SeedModel[] {
  const models: SeedModel[] = [];
  for (let n = 1; n <= 40; n++) {
    const nn = String(n).padStart(2, '0');
    const category = n % 3 === 1 ? 'hard-surface' : n % 3 === 2 ? 'miniature' : 'scan';
    const personal = 500 + 37 * n;
    const publishedAt = new Date(Date.parse('2026-09-01T10:00:00Z') + (n - 1) * 86_400_000);
    models.push({
      ...BASE_MODEL,
      slug: `workshop-piece-${nn}`,
      title: `Workshop Piece ${nn}`,
      category,
      state: 'published',
      visibility: 'public',
      firstPublishedAt: publishedAt.toISOString(),
      dims: { width: 50, height: 50, depth: 50 },
      shape: n % 5 === 0 ? 'filler' : 'plain',
      prices: {
        personal,
        ...(n % 3 !== 0 ? { commercial: personal * 3 } : {}),
        ...(n % 5 === 0 ? { studio: personal * 8 } : {}),
      },
      discount: 0,
      hasStl: n % 4 !== 0,
      description: `Workshop study piece ${nn} for the demo catalogue.`,
    });
  }
  return models;
}

/** Composites whose union spans exactly the stated dimensions. */
export function seedMesh(model: SeedModel): { mesh: Mesh; box: Box } {
  const { width: w, height: h, depth: d } = model.dims;
  if (model.shape === 'lantern') {
    const body = buildBoxMesh(w, h * 0.55, d, { x: 0, y: -h * 0.225, z: 0 });
    const top = buildCylinderMesh(Math.min(w, d) * 0.4, h * 0.45, { x: 0, y: h * 0.275, z: 0 }, 14);
    return { mesh: mergeMeshes([body, top]), box: meshBounds(mergeMeshes([body, top])) };
  }
  if (model.shape === 'warden') {
    const base = buildBoxMesh(w, h * 0.3, d, { x: 0, y: -h * 0.35, z: 0 });
    const body = buildCylinderMesh(Math.min(w, d) * 0.4, h * 0.7, { x: 0, y: h * 0.15, z: 0 }, 14);
    return { mesh: mergeMeshes([base, body]), box: meshBounds(mergeMeshes([base, body])) };
  }
  if (model.shape === 'filler') {
    const lower = buildBoxMesh(w, h * 0.7, d, { x: 0, y: -h * 0.15, z: 0 });
    const upper = buildBoxMesh(w * 0.85, h * 0.3, d * 0.85, { x: 0, y: h * 0.35, z: 0 });
    return { mesh: mergeMeshes([lower, upper]), box: meshBounds(mergeMeshes([lower, upper])) };
  }
  const mesh = buildBoxMesh(w, h, d);
  return { mesh, box: meshBounds(mesh) };
}

export async function runSeed(): Promise<void> {
  await ensureBucket();
  await ensureIndex();
  await ensureBillingSetup();
  const seeded = await one<{ value: string }>(`SELECT value FROM app_config WHERE key = 'seed_done'`);
  if (seeded !== null) return;

  const users = new Map<string, number>();
  for (const user of USERS) {
    const existing = await one<{ id: number }>('SELECT id FROM users WHERE lower(email) = lower($1)', [user.email]);
    if (existing !== null) {
      users.set(user.email, existing.id);
      continue;
    }
    const row = await query<{ id: number }>(
      'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id',
      [user.email, hashPassword(user.password), user.role],
    );
    users.set(user.email, row.rows[0]!.id);
  }

  const authorId = users.get('author@ashgrove.test')!;
  const allModels = [...NAMED_MODELS, ...fillerModels()];
  const ordered = [...allModels]
    .filter(model => model.firstPublishedAt !== undefined)
    .sort((a, b) => Date.parse(a.firstPublishedAt ?? '') - Date.parse(b.firstPublishedAt ?? ''));

  for (const model of allModels) {
    await seedModel(model, authorId, users, ordered.indexOf(model) + 1);
  }

  await seedEditionCopies();
  await seedCollections();
  await seedTokens();
  await seedApiKey();

  await withTransaction(async client => {
    await client.query(
      `INSERT INTO app_config (key, value) VALUES ('seed_done', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [new Date().toISOString()],
    );
  });
}

async function seedModel(
  model: SeedModel,
  authorId: number,
  users: Map<string, number>,
  publishRank: number,
): Promise<void> {
  const existing = await one<{ id: number }>('SELECT id FROM models WHERE slug = $1', [model.slug]);
  if (existing !== null) return;
  const ownerId = model.owner === undefined ? authorId : (users.get(model.owner) ?? authorId);

  const { mesh, box } = seedMesh(model);
  const original = buildGlb(mesh, { title: model.title });
  const checksum = sha256Hex(original);
  await putObject(originalKey(checksum), original, 'model/octet-stream');

  const metresMesh = scaleMesh(mesh, 0.001);
  const glb = buildGlb(metresMesh, { title: model.title });
  const stl = buildStl(metresMesh);
  const png = renderPreview(
    metresMesh,
    { azimuth: model.camera.azimuth, tilt: model.camera.tilt, distanceFactor: model.camera.distance, fov: model.camera.fov },
    meshBounds(metresMesh),
  );
  await putObject(derivativeKey(model.slug, 1, 'model.glb'), glb, 'model/gltf-binary');
  if (model.hasStl) {
    await putObject(derivativeKey(model.slug, 1, 'model.stl'), stl, 'application/octet-stream');
  }
  await putObject(derivativeKey(model.slug, 1, 'preview.png'), png, 'image/png');

  const width = Math.round((box.max[0] - box.min[0]) * 10) / 10;
  const height = Math.round((box.max[1] - box.min[1]) * 10) / 10;
  const depth = Math.round((box.max[2] - box.min[2]) * 10) / 10;
  const radius = Math.round((Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]) / 2) * 10) / 10;

  const modelId = await withTransaction(async client => {
    const insert = await client.query<{ id: number }>(
      `INSERT INTO models (slug, title, description, category, state, visibility, password_hash, owner_id,
         revision, revision_count, has_glb, has_stl, width_mm, height_mm, depth_mm, bounding_radius_mm,
         scale_denominator, cam_azimuth, cam_tilt, cam_distance_factor, cam_fov, hotspots,
         price_personal_cents, price_commercial_cents, price_studio_cents, discount_percent,
         edition_total, edition_price_cents, first_published_at, publish_seq, source_unit, source_name,
         index_state)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, 1, true, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
         $20, $21, $22, $23, $24, $25, $26, $27, 'mm', $28, $29)
       RETURNING id`,
      [
        model.slug,
        model.title,
        model.description ?? `${model.title} from the Ashgrove Mesh Works workshop.`,
        model.category,
        model.state,
        model.visibility,
        model.password === undefined ? null : hashPassword(model.password),
        ownerId,
        model.hasStl,
        width,
        height,
        depth,
        radius,
        model.scaleDenominator,
        model.camera.azimuth,
        model.camera.tilt,
        model.camera.distance,
        model.camera.fov,
        JSON.stringify(model.hotspots),
        model.prices.personal,
        model.prices.commercial ?? null,
        model.prices.studio ?? null,
        model.discount,
        model.edition?.total ?? null,
        model.edition?.price ?? null,
        model.firstPublishedAt ?? null,
        model.firstPublishedAt === undefined ? null : publishRank,
        `${model.slug}-seed.glb`,
        model.state === 'published' && model.visibility === 'public' ? 'dirty' : 'out',
      ],
    );
    const id = insert.rows[0]!.id;
    const revision = await client.query<{ id: number }>(
      `INSERT INTO model_revisions (model_id, revision_no, source_checksum, source_name, source_size, source_unit, current, dims_set, width_mm, height_mm, depth_mm, bounding_radius_mm)
       VALUES ($1, 1, $2, $3, $4, 'mm', true, true, $5, $6, $7, $8) RETURNING id`,
      [id, checksum, `${model.slug}-seed.glb`, original.length, width, height, depth, radius],
    );
    const uploadRef = `up_seed${sha256Hex(Buffer.from(model.slug)).slice(0, 9)}`;
    await client.query(
      `INSERT INTO uploads (ref, model_id, revision_id, status) VALUES ($1, $2, $3, 'completed')`,
      [uploadRef, id, revision.rows[0]!.id],
    );
    const stages: [string, number][] = [['validate', 0], ['transcode', 1], ['preview', 2], ['index', 3], ['publish', 4]];
    for (const [name, idx] of stages) {
      await client.query(
        `INSERT INTO upload_stages (upload_ref, name, idx, status, attempts, confirmed_at) VALUES ($1, $2, $3, 'confirmed', 1, now())`,
        [uploadRef, name, idx],
      );
    }
    return id;
  });
  void modelId;
}

async function seedEditionCopies(): Promise<void> {
  const model = await one<{ id: number; edition_total: number }>(
    `SELECT id, edition_total FROM models WHERE slug = 'basalt-warden' AND edition_total IS NOT NULL`,
  );
  if (model === null) return;
  const existing = await one<{ count: string }>(
    'SELECT count(*)::text AS count FROM edition_copies WHERE model_id = $1',
    [model.id],
  );
  if (Number(existing?.count ?? '0') > 0) return;
  for (let number = 1; number <= 24; number++) {
    await query(
      `INSERT INTO edition_copies (model_id, number, status) VALUES ($1, $2, 'claimed') ON CONFLICT DO NOTHING`,
      [model.id, number],
    );
  }
  await query('UPDATE models SET edition_sales = 24 WHERE id = $1', [model.id]);
}

async function seedCollections(): Promise<void> {
  const collections: { slug: string; name: string; models: string[] }[] = [
    { slug: 'workshop-lighting', name: 'Workshop Lighting', models: ['survey-lantern', 'workshop-piece-01', 'workshop-piece-04'] },
    { slug: 'tabletop-wardens', name: 'Tabletop Wardens', models: ['basalt-warden', 'workshop-piece-02', 'workshop-piece-05', 'workshop-piece-08'] },
    { slug: 'client-work', name: 'Client Work', models: ['client-bust-halden', 'commission-ketch'] },
  ];
  for (const collection of collections) {
    const existing = await one<{ id: number }>('SELECT id FROM collections WHERE slug = $1', [collection.slug]);
    if (existing !== null) continue;
    const id = await withTransaction(async client => {
      const inserted = await client.query<{ id: number }>(
        'INSERT INTO collections (slug, name) VALUES ($1, $2) RETURNING id',
        [collection.slug, collection.name],
      );
      const collectionId = inserted.rows[0]!.id;
      for (const slug of collection.models) {
        const model = await client.query<{ id: number }>('SELECT id FROM models WHERE slug = $1', [slug]);
        if (model.rows[0] !== undefined) {
          await client.query(
            'INSERT INTO collection_items (collection_id, model_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [collectionId, model.rows[0].id],
          );
        }
      }
      return collectionId;
    });
    void id;
  }
}

async function seedTokens(): Promise<void> {
  const gearbox = await one<{ id: number }>(`SELECT id FROM models WHERE slug = 'gearbox-cutaway'`);
  if (gearbox !== null) {
    await query(
      `INSERT INTO share_tokens (model_id, token) VALUES ($1, 'shr_seed_gearbox_4kq7w2')
       ON CONFLICT (model_id) DO UPDATE SET token = 'shr_seed_gearbox_4kq7w2'`,
      [gearbox.id],
    );
  }
  const lantern = await one<{ id: number }>(`SELECT id FROM models WHERE slug = 'survey-lantern'`);
  if (lantern !== null) {
    const existing = await one<{ token: string }>('SELECT token FROM embeds WHERE token = $1', ['emb_seed_lantern_7f3a91c2']);
    if (existing === null) {
      await query('INSERT INTO embeds (token, model_id) VALUES ($1, $2)', ['emb_seed_lantern_7f3a91c2', lantern.id]);
    }
  }
}

async function seedApiKey(): Promise<void> {
  const existing = await one<{ id: number }>(`SELECT id FROM api_keys WHERE ref = 'k_seed0001'`);
  if (existing !== null) return;
  await query(
    `INSERT INTO api_keys (ref, name, key_hash, active) VALUES ('k_seed0001', 'Demo reader', $1, true)`,
    [hashKey('tsr_seed_5d0c2b7e91a4f368')],
  );
}

export async function seedDone(): Promise<boolean> {
  const row = await one<{ value: string }>(`SELECT value FROM app_config WHERE key = 'seed_done'`);
  return row !== null;
}
