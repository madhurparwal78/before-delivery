import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createUser } from './auth';
import { limits } from './config';
import { insertContent, type Content } from './content';
import { one, transaction, withAdvisoryLock, type Db } from './db';
import { bikeHub, coffeeGrinder, gameController, type GuideSeed } from './seed-data';
import { insertGuide } from './lifecycle';
import { modelKey, objectLength, putConfirmed } from './s3';
import { setSearchText } from './search';
import { insertVersion } from './versions';
import { syncFieldPaths } from './working';
import { checkGlb } from '../shared/glb';
import type { Part, Step } from '../shared/types';

export const SAMPLES_DIR = join(import.meta.dirname, 'samples');
const SEED_LOCK = 7_431_903;

const sampleBytes = (name: string) => readFileSync(join(SAMPLES_DIR, `${name}.glb`));

const uuidFrom = (text: string) => {
  const h = createHash('sha1').update(text).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const ODILE = { name: 'Odile Brandt', email: 'odile@pennywasher.example', password: 'workshop-bench-41' };

function sampleModel(name: string) {
  const bytes = sampleBytes(name);
  const checked = checkGlb(bytes, { modelMaxBytes: limits.model_max_bytes, modelMaxParts: limits.model_max_parts });
  if (!checked.ok) throw new Error(`Sample ${name} is not a valid glb`);
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex'), model: checked.model };
}

export async function insertModel(db: Db, modelId: string, name: string): Promise<void> {
  const { bytes, sha256, model } = sampleModel(name);
  await db.query(
    'INSERT INTO models (id, bytes, sha256, bounds, nodes) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
    [modelId, bytes.length, sha256, JSON.stringify(model.bounds), JSON.stringify(model.parts)],
  );
}

export async function storeSampleObject(modelId: string, name: string): Promise<void> {
  const { bytes, sha256 } = sampleModel(name);
  await putConfirmed(modelKey(modelId), bytes, sha256);
}

interface GuideOptions {
  seed: GuideSeed;
  ownerId: string;
  title: string;
  slug?: string;
  modelId: string;
  visibility?: 'public' | 'private';
  state: 'draft' | 'published' | 'withdrawn';
  publishedVersion?: number;
  versionNumbers: number[];
}

/** Builds one guide from a fixture: the parts follow the sample's nodes, every version holds its own ordering and prices. */
export async function seedGuide(db: Db, options: GuideOptions): Promise<{ id: string; slug: string }> {
  const { seed } = options;
  const { model } = sampleModel(seed.sample);
  const { id, slug } = await insertGuide(db, options.ownerId, options.title, seed.currency, options.slug);
  const partIds = new Map(model.parts.map((p) => [p.nodePath, randomUUID()]));
  const stepIds = new Map(Object.keys(seed.steps).map((key) => [key, randomUUID()]));
  const partsFor = (version: number): Part[] =>
    model.parts.map((p) => {
      const fit = seed.fitted[p.nodePath];
      const price = fit ? (typeof fit.price === 'number' ? fit.price : fit.price[version] ?? 0) : 0;
      const fitted = fit && (fit.from ?? 1) <= version && seed.versions[version]?.order.includes(fit.step) ? stepIds.get(fit.step)! : null;
      return {
        id: partIds.get(p.nodePath)!, name: p.name, node_path: p.nodePath, unbound: false, axis: seed.axis, apart_mm: seed.apart[p.nodePath] ?? 0,
        quantity: 1, unit_price: price, fitted_at: fitted,
      };
    });
  const stepsFor = (version: number): Step[] => {
    const spec = seed.versions[version]!;
    return spec.order.map((key, i) => {
      const step = seed.steps[key]!;
      const focus = step.focus.map((path) => partIds.get(path)!);
      return {
        id: stepIds.get(key)!, number: i + 1, title: step.title, text: spec.text?.[key] ?? step.text, phase: step.phase, explode: step.explode,
        focus_parts: focus, camera: { yaw: step.yaw, pitch: step.pitch, zoom: 1 },
        callouts: step.focus.map((path) => ({ part_id: partIds.get(path)!, text: model.parts.find((p) => p.nodePath === path)!.name })),
      };
    });
  };
  const contentOf = (version: number): Content => ({
    steps: stepsFor(version), parts: partsFor(version), model_id: options.modelId, model_scale: 1, model_scale_confirmed: true,
  });
  const latest = Math.max(...options.versionNumbers);
  const working = contentOf(latest);
  await db.query(
    `UPDATE guides SET tags = $1, visibility = $2, state = $3, published_version = $4, model_id = $5, model_scale = 1, model_scale_confirmed = true,
            published_at = CASE WHEN $3 = 'draft' THEN NULL ELSE date_trunc('milliseconds', clock_timestamp()) END WHERE id = $6`,
    [JSON.stringify(seed.tags), options.visibility ?? 'public', options.state, options.state === 'draft' ? null : options.publishedVersion ?? latest, options.modelId, id],
  );
  await insertContent(db, id, working);
  await syncFieldPaths(db, id);
  for (const number of options.versionNumbers) await insertVersion(db, id, number, options.ownerId, contentOf(number), null);
  if (options.state === 'published') await setSearchText(db, id, options.title, seed.tags, contentOf(options.publishedVersion ?? latest));
  return { id, slug };
}

const SEEDED = [
  { seed: coffeeGrinder, versions: [1, 2, 3] },
  { seed: bikeHub, versions: [1] },
  { seed: gameController, versions: [1] },
];

const seededModelId = (sample: string) => uuidFrom(`pennywasher-seed-model-${sample}`);

/** Creates Odile Brandt and her three guides once; running it again changes nothing. */
export async function seedOdile(): Promise<void> {
  await transaction(async (db) =>
    withAdvisoryLock(SEED_LOCK, db, async () => {
      if (await one(db, 'SELECT 1 FROM users WHERE email = $1', [ODILE.email])) return;
      const odile = await createUser(db, ODILE.name, ODILE.email, ODILE.password, true);
      for (const { seed, versions } of SEEDED) {
        const modelId = seededModelId(seed.sample);
        await insertModel(db, modelId, seed.sample);
        await seedGuide(db, {
          seed, ownerId: odile.id, title: seed.titleForOdile, slug: seed.slugForOdile, modelId, state: 'published', versionNumbers: versions,
        });
      }
    }),
  );
}

/** Stores the seed's objects in MinIO whenever they are missing, so a storage outage at start heals itself. */
export async function ensureSeedObjects(): Promise<boolean> {
  try {
    for (const { seed } of SEEDED) {
      const modelId = seededModelId(seed.sample);
      const expected = sampleBytes(seed.sample).length;
      if ((await objectLength(modelKey(modelId))) !== expected) await storeSampleObject(modelId, seed.sample);
    }
    return true;
  } catch {
    return false;
  }
}

