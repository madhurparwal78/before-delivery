import { rows, query, one } from './db.js';
import { hashPassword, seal, workspaceKey, wrapDataKey, versionId, md5Hex, sha256Hex, encryptBytes } from './crypto.js';
import { config } from './config.js';
import { putRegionCiphertext } from './storage.js';
import { randomBytes } from 'node:crypto';

const REGIONS = [
  { id: 'cascade', name: 'Cascade', continent: 'North America West', lon: -122, lat: 47 },
  { id: 'meridian', name: 'Meridian', continent: 'Europe Central', lon: 9, lat: 50 },
  { id: 'monsoon', name: 'Monsoon', continent: 'Southeast Asia', lon: 104, lat: 1 },
  { id: 'pampas', name: 'Pampas', continent: 'South America East', lon: -47, lat: -23 },
];

const PLANS = [
  ['sandbox', 'Sandbox', '$0.00', 1_000_000, 2_000_000, 'none', 'none', 'none', 'farshore-sandbox-monthly'],
  ['indie', 'Indie', '$19.00', 50_000_000_000, 100_000_000_000,
    '$0.006 per GB-month, billed by the GB-hour', '$0.010 per GB', '$0.40 per million', 'farshore-indie-monthly'],
];

const USERS: Array<[id: string, email: string, name: string, operator: boolean]> = [
  ['u-mara', 'mara@lanternfish.test', 'Mara Okonkwo', false],
  ['u-theo', 'theo@lanternfish.test', 'Theo Lindqvist', false],
  ['u-priya', 'priya@lanternfish.test', 'Priya Raman', false],
  ['u-jun', 'jun@paperkite.test', 'Jun Arai', false],
  ['u-sol', 'sol@paperkite.test', 'Sol Benitez', false],
  ['u-ada', 'ada@tidepool.test', 'Ada Nwosu', false],
  ['u-rui', 'operator@farshore.test', 'Rui Castellan', true],
];

const WORKSPACES: Array<[slug: string, name: string, plan: string]> = [
  ['lanternfish', 'Lanternfish Games', 'indie'],
  ['paperkite', 'Paper Kite Studio', 'indie'],
  ['tidepool', 'Tidepool Tools', 'sandbox'],
];

const MEMBERS: Array<[ws: string, user: string, role: string]> = [
  ['lanternfish', 'u-mara', 'owner'],
  ['lanternfish', 'u-theo', 'developer'],
  ['lanternfish', 'u-priya', 'viewer'],
  ['paperkite', 'u-jun', 'owner'],
  ['paperkite', 'u-sol', 'developer'],
  ['tidepool', 'u-ada', 'owner'],
];

const BUCKETS: Array<[name: string, ws: string, placement: string[]]> = [
  ['lanternfish-replays', 'lanternfish', ['cascade', 'meridian', 'monsoon']],
  ['lanternfish-avatars', 'lanternfish', ['meridian', 'cascade']],
  ['paperkite-replays', 'paperkite', ['monsoon', 'cascade']],
  ['tidepool-builds', 'tidepool', ['cascade']],
];

interface SeedObj { bucket: string; key: string; type: string; bytes: Buffer; tags: Record<string, string> }

const SEED_OBJECTS: SeedObj[] = [
  {
    bucket: 'lanternfish-replays', key: 'season-1/manifest.json', type: 'application/json',
    bytes: Buffer.from('{"season":1,"build":"1.4.2"}'), tags: { env: 'prod', team: 'netcode' },
  },
  {
    bucket: 'lanternfish-replays', key: 'season-1/replays/r-0001.bin', type: 'application/octet-stream',
    bytes: Buffer.alloc(2048), tags: { env: 'qa' },
  },
  {
    bucket: 'lanternfish-avatars', key: 'avatars/README.txt', type: 'text/plain',
    bytes: Buffer.from('Avatar uploads land here.\n'), tags: {},
  },
  {
    bucket: 'paperkite-replays', key: 'season-1/manifest.json', type: 'application/json',
    bytes: Buffer.from('{"studio":"paperkite","season":1}'), tags: { env: 'prod' },
  },
  {
    bucket: 'tidepool-builds', key: 'builds/tidepool-0.9.0.txt', type: 'text/plain',
    bytes: Buffer.from('tidepool build 0.9.0\n'), tags: {},
  },
];

const JUN_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const JUN_RECOVERY = ['kite1-jun01','kite1-jun02','kite1-jun03','kite1-jun04','kite1-jun05','kite1-jun06','kite1-jun07','kite1-jun08','kite1-jun09','kite1-jun10'];

/** Applies schema migrations idempotently. Safe on an empty database. */
export async function migrate(): Promise<void> {
  const { readdirSync, readFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const here = dirname(fileURLToPath(import.meta.url));
  const files = readdirSync(join(here, 'schema')).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    await query(readFileSync(join(here, 'schema', f), 'utf8'));
  }
}

export async function seed(): Promise<void> {
  await seedRegions();
  await seedPlans();
  await seedUsers();
  await seedWorkspaces();
  await seedBuckets();
  await seedTwoStep();
  await seedObjects();
}

async function seedRegions(): Promise<void> {
  for (const r of REGIONS) {
    await query(
      `INSERT INTO regions (id, name, continent, lon, lat) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, continent = EXCLUDED.continent, lon = EXCLUDED.lon, lat = EXCLUDED.lat`,
      [r.id, r.name, r.continent, r.lon, r.lat]
    );
  }
}

async function seedPlans(): Promise<void> {
  for (const p of PLANS) {
    await query(
      `INSERT INTO plans (id, name, price, included_storage_bytes, included_egress_bytes, storage_overage, egress_overage, request_units, kb_plan_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
      p
    );
  }
}

async function seedUsers(): Promise<void> {
  const pw = hashPassword('farshore-demo-26');
  for (const [id, email, name, operator] of USERS) {
    await query(
      `INSERT INTO users (id, email, email_lower, name, password_hash, operator) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (email_lower) DO NOTHING`,
      [id, email, email.toLowerCase(), name, pw, operator]
    );
  }
}

async function seedWorkspaces(): Promise<void> {
  for (const [slug, name, plan] of WORKSPACES) {
    await query(
      `INSERT INTO workspaces (slug, name, plan) VALUES ($1,$2,$3) ON CONFLICT (slug) DO NOTHING`,
      [slug, name, plan]
    );
  }
  for (const [ws, user, role] of MEMBERS) {
    await query(
      `INSERT INTO members (workspace_slug, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [ws, user, role]
    );
  }
}

async function seedBuckets(): Promise<void> {
  for (const [name, ws, placement] of BUCKETS) {
    const existing = await rows<{ workspace_slug: string }>(`SELECT workspace_slug FROM buckets WHERE name = $1`, [name]);
    if (existing.length > 0) continue;
    await query(`INSERT INTO buckets (name, workspace_slug, placement) VALUES ($1,$2,$3)`, [name, ws, placement]);
    await query(`INSERT INTO lifecycle (bucket_name, noncurrent_days, keep_newest_noncurrent, abort_multipart_days) VALUES ($1, NULL, 0, NULL)`, [name]);
  }
}

async function seedTwoStep(): Promise<void> {
  const sealed = seal(config.secretKey, JUN_SECRET);
  await query(
    `INSERT INTO two_step (user_id, sealed_secret, enabled, enabled_at, last_accepted_step, setup_at)
     VALUES ('u-jun', $1, true, now(), -1, now()) ON CONFLICT (user_id) DO NOTHING`,
    [sealed]
  );
  const existing = await rows<{ c: string }>(`SELECT count(*)::text AS c FROM recovery_codes WHERE user_id = 'u-jun'`);
  if (existing[0].c === '0') {
    for (let i = 0; i < JUN_RECOVERY.length; i++) {
      await query(`INSERT INTO recovery_codes (user_id, idx, hash, used) VALUES ('u-jun',$1,$2,false)`, [i, sha256Hex(JUN_RECOVERY[i])]);
    }
  }
}

async function seedObjects(): Promise<void> {
  for (const obj of SEED_OBJECTS) {
    const existing = await rows<{ c: string }>(
      `SELECT count(*)::text AS c FROM versions WHERE bucket_name = $1 AND key = $2 AND state = 'current'`,
      [obj.bucket, obj.key]
    );
    if (existing[0].c !== '0') continue;
    await writeSeedObject(obj);
  }
}

async function writeSeedObject(obj: SeedObj): Promise<void> {
  const bucketRow = await rows<{ workspace_slug: string; placement: string[] }>(
    `SELECT workspace_slug, placement FROM buckets WHERE name = $1`, [obj.bucket]
  );
  if (bucketRow.length === 0) return;
  const { workspace_slug, placement } = bucketRow[0];
  const vid = versionId();
  const now = new Date();
  const etag = '"' + md5Hex(obj.bytes) + '"';
  const dataKey = randomBytes(32);
  // Seed objects are written at the workspace's current generation.
  const wsRow = await one<{ key_generation: number }>(`SELECT key_generation FROM workspaces WHERE slug = $1`, [workspace_slug]);
  const generation = wsRow?.key_generation ?? 1;
  const wk = workspaceKey(config.secretKey, workspace_slug, generation);
  const wrapped = wrapDataKey(wk, dataKey);
  const ciphertext = encryptBytes(dataKey, obj.bytes);
  await query(
    `INSERT INTO versions (version_id, bucket_name, key, etag, size, content_type, metadata, tags, state, acknowledged_at, wrapped_key, key_generation, part_count, part_sizes)
     VALUES ($1,$2,$3,$4,$5,$6,'{}'::jsonb,$7::jsonb,'current',$8,$9,$10,NULL,NULL)`,
    [vid, obj.bucket, obj.key, etag, obj.bytes.length, obj.type, JSON.stringify(obj.tags), now, wrapped, generation]
  );
  let position = 0;
  for (const region of placement) {
    const isOrigin = position === 0;
    await query(
      `INSERT INTO replicas (version_id, region, position, role, state, attempts, settled_at, settle_ms, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL)`,
      [vid, region, position, isOrigin ? 'origin' : 'replica', isOrigin ? 'settled' : 'pending', isOrigin ? 0 : 0, isOrigin ? now : null, isOrigin ? 0 : null]
    );
    position++;
  }
  await query(`UPDATE buckets SET object_count = object_count + 1, stored_bytes = stored_bytes + $1 WHERE name = $2`,
    [BigInt(obj.bytes.length) * BigInt(placement.length), obj.bucket]);
  // The ciphertext goes to every region; the worker settles pending replicas.
  for (const region of placement) {
    await putRegionCiphertext(region, obj.bucket, vid, ciphertext);
  }
}
