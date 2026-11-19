import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { execute, queryOne, withSeedLock } from './db/index.js';
import { checkGlb, type GlbPart } from '../shared/glb.js';
import { createAccount, findUserByEmail } from './domain/accounts.js';
import {
  createGuide,
  loadGuide,
  refreshSearchText,
  type GuideRow,
  type VersionSnapshot,
} from './domain/guides.js';
import { applySnapshotToWorkingCopy, saveVersion } from './domain/versions.js';
import { modelConfirmed, putModel, StorageUnreachable } from './storage/s3.js';
import { isSampleName, sampleBytes } from './samples.js';
import { START_ACCOUNT, START_GUIDES, type GuideSpec } from './seed-data.js';
import type { Visibility } from '../shared/types.js';

interface SampleInspection {
  parts: GlbPart[];
  bboxMm: [number, number, number];
  bytes: Buffer;
}

function inspectSample(name: string): SampleInspection {
  if (!isSampleName(name)) throw new Error(`unknown sample ${name}`);
  const bytes = sampleBytes(name);
  const checked = checkGlb(new Uint8Array(bytes), config.limits);
  if (!checked.ok) throw new Error(`sample ${name} failed its own checks`);
  return { parts: checked.value.parts, bboxMm: checked.value.bboxMm, bytes };
}

/** Each world stores its own copy of the sample model in MinIO. */
async function storeSampleCopy(sample: SampleInspection): Promise<string> {
  const modelId = randomUUID();
  const confirmation = await putModel(modelId, sample.bytes);
  await execute(
    'INSERT INTO models (id, bytes, sha256, bbox_mm, node_paths) VALUES ($1, $2, $3, $4, $5)',
    [
      modelId,
      confirmation.bytes,
      confirmation.sha256,
      sample.bboxMm,
      sample.parts.map((part) => part.nodePath),
    ],
  );
  return modelId;
}

function buildSnapshot(
  spec: GuideSpec,
  versionIndex: number,
  title: string,
  modelId: string,
  partIdByNodePath: ReadonlyMap<string, string>,
  stepIdByKey: ReadonlyMap<string, string>,
  glbParts: readonly GlbPart[],
): VersionSnapshot {
  const version = spec.versions[versionIndex];
  if (!version) throw new Error('version spec missing');
  const nameByNodePath = new Map(glbParts.map((part) => [part.nodePath, part.name]));

  const steps = version.stepKeys.map((key, index) => {
    const step = spec.steps[key];
    if (!step) throw new Error(`step spec ${key} missing`);
    const focusIds = step.focus.map((nodePath) => partIdByNodePath.get(nodePath) ?? '');
    return {
      id: stepIdByKey.get(key) ?? '',
      number: index + 1,
      title: step.title,
      text: version.stepTextOverrides?.[key] ?? step.text,
      phase: step.phase,
      explode: step.explode,
      focus_parts: focusIds,
      camera: { yaw: step.yaw, pitch: step.pitch, zoom: 1 },
      callouts: step.focus.map((nodePath) => ({
        part_id: partIdByNodePath.get(nodePath) ?? '',
        text: nameByNodePath.get(nodePath) ?? '',
      })),
    };
  });

  const parts = glbParts.map((part) => {
    const pricing = version.pricing[part.nodePath];
    const fittedKey = pricing?.fittedAtKey ?? null;
    const fittedId = fittedKey !== null && version.stepKeys.includes(fittedKey)
      ? stepIdByKey.get(fittedKey) ?? null
      : null;
    return {
      id: partIdByNodePath.get(part.nodePath) ?? '',
      name: part.name,
      node_path: part.nodePath,
      unbound: false,
      axis: spec.axis,
      apart_mm: spec.apartMm[part.nodePath] ?? 0,
      quantity: pricing?.quantity ?? 1,
      unit_price: pricing?.unitPrice ?? 0,
      fitted_at: fittedId,
    };
  });

  return {
    title,
    currency: spec.currency,
    tags: [...spec.tags],
    model_id: modelId,
    model_scale: 1,
    model_scale_confirmed: true,
    steps,
    parts,
  };
}

export interface SeedGuideOptions {
  ownerId: string;
  title: string;
  slug?: string;
  spec: GuideSpec;
  visibility: Visibility;
  /** The version to publish, or null to leave the guide a draft. */
  publishVersion: number | null;
  withdrawn?: boolean;
  coauthorId?: string;
}

export async function seedGuide(options: SeedGuideOptions): Promise<GuideRow> {
  const sample = inspectSample(options.spec.sample);
  const modelId = await storeSampleCopy(sample);
  const guide = await createGuide(
    options.ownerId,
    options.title,
    options.spec.currency,
    options.slug,
  );
  try {
    return await fillSeededGuide(options, guide, modelId, sample);
  } catch (error) {
    await execute('DELETE FROM guides WHERE id = $1', [guide.id]);
    throw error;
  }
}

async function fillSeededGuide(
  options: SeedGuideOptions,
  guide: GuideRow,
  modelId: string,
  sample: SampleInspection,
): Promise<GuideRow> {

  const partIdByNodePath = new Map(sample.parts.map((part) => [part.nodePath, randomUUID()]));
  const stepKeys = new Set(options.spec.versions.flatMap((version) => version.stepKeys));
  const stepIdByKey = new Map([...stepKeys].map((key) => [key, randomUUID()]));

  for (let index = 0; index < options.spec.versions.length; index += 1) {
    const snapshot = buildSnapshot(
      options.spec,
      index,
      options.title,
      modelId,
      partIdByNodePath,
      stepIdByKey,
      sample.parts,
    );
    await saveVersion(guide, index === 0 ? null : index, options.ownerId, null, snapshot);
    if (index === options.spec.versions.length - 1) {
      await applySnapshotToWorkingCopy(guide, snapshot);
    }
  }

  for (const part of sample.parts) {
    await execute(
      'UPDATE parts SET bbox_min = $2, bbox_max = $3, colour = $4 WHERE id = $1',
      [partIdByNodePath.get(part.nodePath), part.bboxMin, part.bboxMax, part.colour],
    );
  }

  const state = options.withdrawn === true
    ? 'withdrawn'
    : options.publishVersion === null
      ? 'draft'
      : 'published';
  await execute(
    `UPDATE guides SET model_id = $2, model_scale = 1, model_scale_confirmed = true,
       visibility = $3, state = $4, published_version = $5,
       published_at = CASE WHEN $5::int IS NULL THEN NULL ELSE now() END
     WHERE id = $1`,
    [guide.id, modelId, options.visibility, state, options.publishVersion],
  );
  await execute('DELETE FROM field_revisions WHERE guide_id = $1', [guide.id]);
  if (options.coauthorId !== undefined) {
    await execute(
      'INSERT INTO guide_coauthors (guide_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [guide.id, options.coauthorId],
    );
  }

  const reloaded = await loadGuide(guide.id);
  if (reloaded === null) throw new Error('seeded guide vanished');
  await refreshSearchText(reloaded);
  return reloaded;
}

async function ensureStartAccount(): Promise<string> {
  const existing = await findUserByEmail(START_ACCOUNT.email);
  if (existing !== null) {
    await execute('UPDATE users SET confirmed = true WHERE id = $1', [existing.id]);
    return existing.id;
  }
  const created = await createAccount(
    START_ACCOUNT.name,
    START_ACCOUNT.email,
    START_ACCOUNT.password,
  );
  if (created === null) {
    const retry = await findUserByEmail(START_ACCOUNT.email);
    if (retry === null) throw new Error('could not seed the start account');
    return retry.id;
  }
  await execute('UPDATE users SET confirmed = true WHERE id = $1', [created.id]);
  return created.id;
}

/** Re-puts a seeded object once storage answers again. */
async function ensureObjectStored(guide: GuideRow, sampleName: string): Promise<void> {
  if (guide.model_id === null) return;
  const model = await queryOne<{ bytes: string }>('SELECT bytes FROM models WHERE id = $1', [
    guide.model_id,
  ]);
  if (model === null) return;
  if (await modelConfirmed(guide.model_id, Number(model.bytes))) return;
  const sample = inspectSample(sampleName);
  await putModel(guide.model_id, sample.bytes);
}

export async function applyStartSeed(): Promise<void> {
  await withSeedLock(async () => {
    const ownerId = await ensureStartAccount();
    for (const entry of START_GUIDES) {
      const existing = await loadGuide(entry.slug);
      if (existing !== null) {
        await ensureObjectStored(existing, entry.spec.sample);
        continue;
      }
      await seedGuide({
        ownerId,
        title: entry.title,
        slug: entry.slug,
        spec: entry.spec,
        visibility: 'public',
        publishVersion: entry.spec.versions.length,
      });
    }
  });
}

/** Keeps trying so the seed lands once MinIO answers, without blocking boot. */
export function startSeedWhenStorageAnswers(): void {
  const attempt = async (): Promise<void> => {
    try {
      await applyStartSeed();
    } catch (error) {
      process.stderr.write(`start seed deferred: ${String(error)}\n`);
      if (error instanceof StorageUnreachable) setTimeout(() => void attempt(), 5000);
    }
  };
  void attempt();
}
