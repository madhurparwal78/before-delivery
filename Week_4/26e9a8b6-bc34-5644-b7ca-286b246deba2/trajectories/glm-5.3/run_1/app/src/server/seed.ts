// Seed data: present at start on every instance, and each grading world.

import { readFileSync } from 'node:fs';
import schemaSql from './schema.sql';
import type { PoolClient } from 'pg';
import type { Db } from './db';
import { Store } from './store';
import { S3 } from './s3';
import { newId, randomSuffix, slugify } from './ids';
import { hashPassword } from './auth';
import type { WorkingStep, WorkingPart, Camera } from '../shared/working';
import type { Phase } from '../shared/phase';
import type { CurrencyCode } from '../shared/cost';

interface SeedStep {
  title: string;
  phase: Phase;
  explode: number;
  focusParts: string[];
  yaw: number;
  pitch: number;
  callouts: string[];
}

interface SeedPart {
  name: string;
  nodePath: string;
  axis: 'x' | 'y' | 'z';
  apartMm: number;
  quantity?: number;
  unitPrice?: number;
  fittedAtTitle?: string;
}

interface SeedGuide {
  title: string;
  slug: string;
  currency: CurrencyCode;
  tags: string[];
  sample: string;
  parts: SeedPart[];
  steps: SeedStep[];
  versionTexts?: Record<string, string>;
  versions: SeedVersion[];
}

interface SeedVersion {
  stepOrder: string[]; // step titles in order
  fitted: { part: string; price: number; atTitle?: string }[];
}

const CAMERA_BASE: Camera = { yaw: 30, pitch: 15, zoom: 1 };

interface CoffeeData {
  guides: SeedGuide[];
}

export function coffeeGuideData(suffix: string): CoffeeData {
  const data: CoffeeData = { guides: [coffeeGuide(suffix)] };
  return data;
}

function coffeeGuide(suffix: string): SeedGuide {
  return {
    title: `Coffee grinder: fit new burrs${suffix ? ' ' + suffix : ''}`,
    slug: 'coffee-grinder-fit-new-burrs',
    currency: 'EUR',
    tags: ['coffee', 'grinder', 'burrs'],
    sample: 'coffee-grinder.glb',
    parts: [
      { name: 'Housing', nodePath: 'Housing[0]', axis: 'y', apartMm: 0 },
      { name: 'Hopper', nodePath: 'Housing[0]/Hopper[0]', axis: 'y', apartMm: 120 },
      { name: 'Bean chute', nodePath: 'Housing[0]/Bean chute[0]', axis: 'y', apartMm: 60, quantity: 1, unitPrice: 240, fittedAtTitle: 'Refit the chute and close up' },
      { name: 'Upper burr', nodePath: 'Housing[0]/Upper burr[0]', axis: 'y', apartMm: 80 },
      { name: 'Motor', nodePath: 'Housing[0]/Motor[0]', axis: 'y', apartMm: 0 },
      { name: 'Drive shaft', nodePath: 'Housing[0]/Drive shaft[0]', axis: 'y', apartMm: 30 },
      { name: 'Lower burr', nodePath: 'Housing[0]/Drive shaft[0]/Lower burr[0]', axis: 'y', apartMm: 50, quantity: 1, unitPrice: 1890, fittedAtTitle: 'Fit the new burr set' },
      { name: 'Base plate', nodePath: 'Base plate[0]', axis: 'y', apartMm: -40 },
      { name: 'Grounds tray', nodePath: 'Grounds tray[0]', axis: 'y', apartMm: -70 },
    ],
    steps: [
      { title: 'Lift off the hopper', phase: 'open_up', explode: 0, focusParts: ['Hopper'], yaw: 30, pitch: 15, callouts: ['Hopper'] },
      { title: 'Free the upper burr', phase: 'take_out', explode: 0.25, focusParts: ['Upper burr'], yaw: 45, pitch: 20, callouts: ['Upper burr'] },
      { title: 'Draw out the lower burr', phase: 'take_out', explode: 0.5, focusParts: ['Lower burr', 'Drive shaft'], yaw: 60, pitch: 10, callouts: ['Lower burr', 'Drive shaft'] },
      { title: 'Fit the new burr set', phase: 'fit_new', explode: 0.85, focusParts: ['Upper burr', 'Lower burr'], yaw: 60, pitch: 25, callouts: ['Upper burr', 'Lower burr'] },
      { title: 'Refit the chute and close up', phase: 'close_up', explode: 0, focusParts: ['Bean chute'], yaw: 30, pitch: 15, callouts: ['Bean chute'] },
    ],
    versions: [
      { stepOrder: ['Unplug and empty the grinder', 'Lift off the hopper', 'Draw out the lower burr', 'Free the upper burr', 'Fit the new burr set'], fitted: [{ part: 'Lower burr', price: 1640 }] },
      { stepOrder: ['Lift off the hopper', 'Draw out the lower burr', 'Free the upper burr', 'Fit the new burr set', 'Refit the chute and close up'], fitted: [{ part: 'Lower burr', price: 1640 }, { part: 'Bean chute', price: 240, atTitle: 'Refit the chute and close up' }] },
      { stepOrder: [], fitted: [] },
    ],
  };
}

const STEP_TEXTS: Record<string, string> = {
  'Lift off the hopper': 'Unplug the grinder, then turn the hopper a quarter turn and lift it straight up.',
  'Free the upper burr': 'Undo the two clips and lift the upper burr out by its handle.',
  'Draw out the lower burr': 'Pull the lower burr straight up off the drive shaft without twisting it.',
  'Fit the new burr set': 'Seat the new burrs and turn them a quarter turn until they click.',
  'Refit the chute and close up': 'Press the new chute home, then refit the hopper and run a few beans through.',
  'Unplug and empty the grinder': 'Unplug the grinder and tip out any beans.',
};

const OLD_STEP_TEXTS: Record<string, string> = {
  'Fit the new burr set': 'Seat the new burrs and turn them a quarter turn by hand.',
};

function bikeHubGuide(suffix: string): SeedGuide {
  const slugBase = suffix ? slugify(`bike-hub-regrease-the-bearings ${suffix}`) : 'bike-hub-regrease-the-bearings';
  return {
    title: `Bike hub: regrease the bearings${suffix ? ' ' + suffix : ''}`,
    slug: slugBase,
    currency: 'GBP',
    tags: ['bike', 'hub', 'bearings'],
    sample: 'bike-hub.glb',
    parts: [
      { name: 'Hub shell', nodePath: 'Hub shell[0]', axis: 'x', apartMm: 0 },
      { name: 'Axle', nodePath: 'Axle[0]', axis: 'x', apartMm: 120 },
      { name: 'Left cone', nodePath: 'Left cone[0]', axis: 'x', apartMm: -60 },
      { name: 'Right cone', nodePath: 'Right cone[0]', axis: 'x', apartMm: 60 },
      { name: 'Left bearing', nodePath: 'Left bearing[0]', axis: 'x', apartMm: -35, quantity: 1, unitPrice: 320, fittedAtTitle: 'Fit new bearings' },
      { name: 'Right bearing', nodePath: 'Right bearing[0]', axis: 'x', apartMm: 35, quantity: 1, unitPrice: 320, fittedAtTitle: 'Fit new bearings' },
      { name: 'Freehub body', nodePath: 'Freehub body[0]', axis: 'x', apartMm: 50 },
      { name: 'Locknut', nodePath: 'Locknut[0]', axis: 'x', apartMm: -90 },
      { name: 'Locknut', nodePath: 'Locknut[1]', axis: 'x', apartMm: 90 },
    ],
    steps: [
      { title: 'Undo the locknuts', phase: 'open_up', explode: 0, focusParts: ['Locknut[0]', 'Locknut[1]'], yaw: 20, pitch: 10, callouts: ['Locknut[0]', 'Locknut[1]'] },
      { title: 'Slide out the axle', phase: 'take_out', explode: 0.4, focusParts: ['Axle'], yaw: 40, pitch: 15, callouts: ['Axle'] },
      { title: 'Fit new bearings', phase: 'fit_new', explode: 0.7, focusParts: ['Left bearing', 'Right bearing'], yaw: 60, pitch: 20, callouts: ['Left bearing', 'Right bearing'] },
      { title: 'Set the cones', phase: 'close_up', explode: 0.2, focusParts: ['Left cone', 'Right cone'], yaw: 40, pitch: 10, callouts: ['Left cone', 'Right cone'] },
      { title: 'Spin the wheel', phase: 'test_it', explode: 0, focusParts: ['Hub shell'], yaw: 20, pitch: 10, callouts: ['Hub shell'] },
    ],
    versions: [{ stepOrder: [], fitted: [] }],
  };
}

function gameControllerGuide(suffix: string): SeedGuide {
  const slugBase = suffix ? slugify(`game-controller-replace-a-stick ${suffix}`) : 'game-controller-replace-a-stick';
  return {
    title: `Game controller: replace a stick${suffix ? ' ' + suffix : ''}`,
    slug: slugBase,
    currency: 'JPY',
    tags: ['controller', 'games', 'sticks'],
    sample: 'game-controller.glb',
    parts: [
      { name: 'Front shell', nodePath: 'Front shell[0]', axis: 'z', apartMm: 0 },
      { name: 'Back shell', nodePath: 'Back shell[0]', axis: 'z', apartMm: -60 },
      { name: 'Main board', nodePath: 'Main board[0]', axis: 'z', apartMm: -15 },
      { name: 'Left stick', nodePath: 'Left stick[0]', axis: 'z', apartMm: 40 },
      { name: 'Right stick', nodePath: 'Right stick[0]', axis: 'z', apartMm: 40 },
      { name: 'Left stick module', nodePath: 'Left stick module[0]', axis: 'z', apartMm: 15, quantity: 1, unitPrice: 1240, fittedAtTitle: 'Fit the new stick module' },
      { name: 'Right stick module', nodePath: 'Right stick module[0]', axis: 'z', apartMm: 15 },
      { name: 'Button pad', nodePath: 'Button pad[0]', axis: 'z', apartMm: 25 },
      { name: 'Battery', nodePath: 'Battery[0]', axis: 'z', apartMm: -35 },
      { name: 'Trigger spring', nodePath: 'Trigger spring[0]', axis: 'z', apartMm: -25 },
    ],
    steps: [
      { title: 'Open the shell', phase: 'open_up', explode: 0.3, focusParts: ['Back shell'], yaw: 25, pitch: 20, callouts: ['Back shell'] },
      { title: 'Fit the new stick module', phase: 'fit_new', explode: 0.8, focusParts: ['Left stick module'], yaw: 50, pitch: 30, callouts: ['Left stick module'] },
    ],
    versions: [{ stepOrder: [], fitted: [] }],
  };
}

const OLD_STEP_SPECS: Record<string, SeedStep> = {
  'Unplug and empty the grinder': { title: 'Unplug and empty the grinder', phase: 'open_up', explode: 0, focusParts: ['Hopper'], yaw: 30, pitch: 15, callouts: ['Hopper'] },
};

const STEP_TEXTS_GAME: Record<string, string> = {
  'Open the shell': 'Undo the back screws and ease the clips apart with a plastic tool.',
  'Fit the new stick module': 'Lift the board, swap the left stick module and press its connector home.',
};

const STEP_TEXTS_BIKE: Record<string, string> = {
  'Undo the locknuts': 'Hold one cone with a thin spanner and turn each locknut off.',
  'Slide out the axle': 'Pull the axle out from the freehub side and catch the cones.',
  'Fit new bearings': 'Press a new bearing into each side of the shell until it sits flat.',
  'Set the cones': 'Thread the cones back on until the axle turns with no play.',
  'Spin the wheel': 'Spin the wheel and listen for grinding before you ride.',
};

/** Applies the schema and seeds the start-of-day data once; safe for concurrent starts. */
export async function seed(db: Db, s3: S3, samplesDir: string): Promise<void> {
  await db.applySchema(readSchema());
  await db.tx(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [554433]);
    const existing = await client.query('SELECT 1 FROM accounts WHERE email = $1', ['odile@pennywasher.example']);
    if (existing.rowCount === 0) {
      await seedStartOfDay(client, new Store(db), s3, samplesDir);
    }
  });
}

function readSchema(): string {
  return schemaSql;
}

async function seedStartOfDay(client: PoolClient, store: Store, s3: S3, samplesDir: string): Promise<void> {
  const odile = await upsertAccount(client, store, 'Odile Brandt', 'odile@pennywasher.example', 'workshop-bench-41', true);
  const coffee = coffeeGuide('');
  await seedGuide(client, store, s3, samplesDir, coffee, odile.id, { publishVersion: 3, visibility: 'public' });
  const bike = bikeHubGuide('');
  await seedGuide(client, store, s3, samplesDir, bike, odile.id, { publishVersion: 1, visibility: 'public' });
  const game = gameControllerGuide('');
  await seedGuide(client, store, s3, samplesDir, game, odile.id, { publishVersion: 1, visibility: 'public', withdraw: true });
}

async function upsertAccount(client: PoolClient, store: Store, name: string, email: string, password: string, confirmed: boolean): Promise<{ id: string }> {
  const existing = await client.query<{ id: string }>('SELECT id FROM accounts WHERE email = $1', [email]);
  if (existing.rows[0]) return existing.rows[0];
  const id = newId('usr');
  await client.query('INSERT INTO accounts (id, name, email, password_hash, confirmed) VALUES ($1, $2, $3, $4, $5)', [id, name, email, hashPassword(password), confirmed]);
  return { id };
}

interface SeedOptions {
  publishVersion: number;
  visibility: 'public' | 'private';
  withdraw?: boolean;
}

/** Builds one guide with its parts, steps, versions and stored model. */
export async function seedGuide(client: PoolClient, store: Store, s3: S3, samplesDir: string, spec: SeedGuide, ownerId: string, options: SeedOptions): Promise<string> {
  // Model: store the sample as its own copy.
  const modelBytes = readFileSync(`${samplesDir}/${spec.sample}`);
  const modelId = newId('mdl');
  await s3.put(`models/${modelId}.glb`, modelBytes, 'model/gltf-binary');
  await client.query(
    'INSERT INTO models (id, bytes, sha256, bbox_mm, scale, scale_confirmed) VALUES ($1, $2, $3, $4::jsonb, 1, true)',
    [modelId, modelBytes.length, sha256Of(modelBytes), JSON.stringify(bboxOf(spec.parts))],
  );

  const guideId = newId('gde');
  const slug = spec.slug;
  await client.query(
    `INSERT INTO guides (id, slug, title, owner_id, state, visibility, currency, model_id)
     VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7)`,
    [guideId, slug, spec.title, ownerId, options.visibility, spec.currency, modelId],
  );
  for (const tag of spec.tags) {
    await client.query('INSERT INTO guide_tags (guide_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING', [guideId, tag]);
  }

  // Parts and steps of the current (latest) version.
  const partIds = new Map<string, string>();
  for (const [index, part] of spec.parts.entries()) {
    const id = newId('prt');
    partIds.set(part.name, id);
    await client.query(
      `INSERT INTO parts (id, guide_id, name, node_path, unbound, axis, apart_mm, quantity, unit_price, fitted_at, position)
       VALUES ($1, $2, $3, $4, false, $5, $6, $7, 0, NULL, $8)`,
      [id, guideId, part.name, part.nodePath, part.axis, part.apartMm, part.quantity ?? 1, index],
    );
  }

  const stepIds = new Map<string, string>();
  for (const [index, step] of spec.steps.entries()) {
    const id = newId('stp');
    stepIds.set(step.title, id);
    const text = stepText(spec, step.title);
    await client.query(
      `INSERT INTO steps (id, guide_id, position, title, text, phase, explode, focus_parts, camera)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)`,
      [id, guideId, index, step.title, text, step.phase, step.explode, JSON.stringify(step.focusParts.map((name) => partIds.get(name)).filter(Boolean)), JSON.stringify({ yaw: step.yaw, pitch: step.pitch, zoom: 1 })],
    );
    for (const [calloutIndex, partName] of step.callouts.entries()) {
      const partId = partIds.get(partName);
      if (partId) {
        await client.query(
          'INSERT INTO callouts (guide_id, step_id, part_id, text, position) VALUES ($1, $2, $3, $4, $5)',
          [guideId, id, partId, partName, calloutIndex],
        );
      }
    }
  }

  // Fitted parts for the latest version.
  for (const part of spec.parts) {
    if (part.unitPrice === undefined || part.fittedAtTitle === undefined) continue;
    const partId = partIds.get(part.name);
    const stepId = stepIds.get(part.fittedAtTitle);
    if (partId && stepId) {
      await client.query('UPDATE parts SET quantity = $2, unit_price = $3, fitted_at = $4 WHERE id = $1', [partId, part.quantity ?? 1, part.unitPrice, stepId]);
    }
  }

  // Earlier versions: distinct step order and fitted data.
  for (const [versionIndex, version] of spec.versions.entries()) {
    if (version.stepOrder.length === 0) {
      // The latest version: save the working copy as-is.
      await saveVersionSnapshot(client, guideId, ownerId, null, versionIndex + 1);
      continue;
    }
    await saveVersionWith(client, guideId, ownerId, spec, version, partIds, stepIds, versionIndex + 1);
  }

  if (options.publishVersion > 0) {
    await client.query("UPDATE guides SET state = 'published', published_version = $2, latest_version = GREATEST(latest_version, $2) WHERE id = $1", [guideId, options.publishVersion]);
  }
  if (options.withdraw) {
    await client.query("UPDATE guides SET state = 'withdrawn' WHERE id = $1", [guideId]);
  }
  return guideId;
}

function stepText(spec: SeedGuide, title: string): string {
  const coffeeTexts = { ...STEP_TEXTS, ...STEP_TEXTS_GAME, ...STEP_TEXTS_BIKE };
  return coffeeTexts[title] ?? '';
}

async function saveVersionSnapshot(client: PoolClient, guideId: string, ownerId: string, restoredFrom: number | null, number: number): Promise<void> {
  // Reads the working copy and writes it as a version.
  const steps = await client.query('SELECT id, position, title, text, phase, explode, focus_parts, camera FROM steps WHERE guide_id = $1 ORDER BY position', [guideId]);
  const parts = await client.query('SELECT id, name, node_path, unbound, axis, apart_mm, quantity, unit_price, fitted_at, 0 AS position FROM parts WHERE guide_id = $1 ORDER BY position', [guideId]);
  const callouts = await client.query('SELECT step_id, part_id, text, position FROM callouts WHERE guide_id = $1 ORDER BY position', [guideId]);
  const stepsJson: Record<string, unknown>[] = steps.rows.map((row: Record<string, unknown>, index: number) => ({
    id: String(row.id), number: index + 1, title: row.title, text: row.text, phase: row.phase,
    explode: row.explode, focus_parts: row.focus_parts ?? [], camera: row.camera,
    callouts: callouts.rows.filter((c: Record<string, unknown>) => c.step_id === row.id).map((c: Record<string, unknown>) => ({ part_id: c.part_id, text: c.text })),
  }));
  const partsJson: Record<string, unknown>[] = parts.rows.map((row: Record<string, unknown>) => ({
    id: String(row.id), name: row.name, node_path: row.node_path, unbound: false, axis: row.axis,
    apart_mm: row.apart_mm, quantity: row.quantity, unit_price: Number(row.unit_price), fitted_at: row.fitted_at,
  }));
  let partsCost = 0;
  const stepIdOrder: string[] = stepsJson.map((s) => String(s.id));
  for (const part of partsJson) {
    const fittedAt = part.fitted_at as string | null;
    const quantity = part.quantity as number;
    const unitPrice = part.unit_price as number;
    if (fittedAt && stepIdOrder.includes(fittedAt)) partsCost += quantity * unitPrice;
  }
  await client.query(
    `INSERT INTO versions (guide_id, number, saved_by, restored_from, steps, parts, model_id, parts_cost)
     SELECT $1, $2, $3, $4, $5::jsonb, $6::jsonb, model_id, $7 FROM guides WHERE id = $1`,
    [guideId, number, ownerId, restoredFrom, JSON.stringify(stepsJson), JSON.stringify(partsJson), partsCost],
  );
  await client.query('UPDATE guides SET latest_version = GREATEST(COALESCE(latest_version, 0), $2) WHERE id = $1', [guideId, number]);
}

/** Older versions keep the same step ids, only the order and part data differ. */
async function saveVersionWith(client: PoolClient, guideId: string, ownerId: string, spec: SeedGuide, version: SeedVersion, partIds: Map<string, string>, stepIds: Map<string, string>, number: number): Promise<void> {
  const stepsJson: WorkingStep[] = [];
  const textMap = textSource(spec);
  for (const [index, title] of version.stepOrder.entries()) {
    const id = stepIds.get(title) ?? (number < latestNumber(spec) ? legacyStepId(guideId, title) : undefined);
    const seedStep = spec.steps.find((s) => s.title === title) ?? OLD_STEP_SPECS[title];
    if (!id || !seedStep) continue;
    stepsJson.push({
      id, number: index + 1, title,
      text: textMap[title] ?? '',
      phase: seedStep.phase, explode: seedStep.explode,
      focus_parts: seedStep.focusParts.map((name) => partIds.get(name)).filter((v): v is string => Boolean(v)),
      camera: { yaw: seedStep.yaw, pitch: seedStep.pitch, zoom: 1 },
      callouts: seedStep.callouts.map((name) => ({ part_id: partIds.get(name) ?? '', text: name })),
    });
  }
  const partsJson: WorkingPart[] = spec.parts.map((part) => {
    const fitted = version.fitted.find((f) => f.part === part.name);
    const fittedStepTitle = fitted?.atTitle ?? (fitted ? fitted.atTitle ?? fittedStepDefault(spec, fitted.part) : undefined);
    const fittedAt = fittedStepTitle ? stepIds.get(fittedStepTitle) ?? null : null;
    return {
      id: partIds.get(part.name) ?? '', name: part.name, node_path: part.nodePath, unbound: false,
      axis: part.axis, apart_mm: part.apartMm, quantity: part.quantity ?? 1,
      unit_price: fitted ? fitted.price : part.unitPrice ?? 0, fitted_at: fittedAt,
    };
  });
  let partsCost = 0;
  const orderIds = new Set(stepsJson.map((s) => s.id));
  for (const part of partsJson) {
    if (part.fitted_at && orderIds.has(part.fitted_at)) partsCost += part.quantity * part.unit_price;
  }
  await client.query(
    `INSERT INTO versions (guide_id, number, saved_by, restored_from, steps, parts, model_id, parts_cost)
     SELECT $1, $2, $3, NULL, $4::jsonb, $5::jsonb, model_id, $6 FROM guides WHERE id = $1`,
    [guideId, number, ownerId, JSON.stringify(stepsJson), JSON.stringify(partsJson), partsCost],
  );
  await client.query('UPDATE guides SET latest_version = GREATEST(COALESCE(latest_version, 0), $2) WHERE id = $1', [guideId, number]);
}

function fittedStepDefault(spec: SeedGuide, partName: string): string | undefined {
  return spec.parts.find((p) => p.name === partName)?.fittedAtTitle;
}

/** Version numbering: the last entry in spec.versions is the latest version. */
function latestNumber(spec: SeedGuide): number {
  return spec.versions.length;
}

/** A stable legacy id for a step that no longer exists in the working copy. */
function legacyStepId(guideId: string, title: string): string {
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  return `${guideId}_old_${createHash('sha1').update(title).digest('hex').slice(0, 10)}`;
}

function textSource(spec: SeedGuide): Record<string, string> {
  const all = { ...STEP_TEXTS, ...STEP_TEXTS_GAME, ...STEP_TEXTS_BIKE };
  // Older versions of the coffee guide use the older sentence for the burr step.
  if (spec.currency === 'EUR') return { ...all, 'Fit the new burr set': OLD_STEP_TEXTS['Fit the new burr set'] };
  return all;
}

function sha256Of(data: Buffer): string {
  // Deterministic digest for the seed; auth.ts owns password hashing.
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  return createHash('sha256').update(data).digest('hex');
}

function bboxOf(parts: SeedPart[]): [number, number, number] {
  void parts;
  // The samples carry their own bounding box; the seed uses the coffee sample shape.
  return [140, 250, 193];
}

/** One fresh, isolated grading world. */
export async function makeWorld(db: Db, store: Store, s3: S3, samplesDir: string): Promise<WorldJson> {
  const suffix = randomSuffix();
  const nameSuffix = ` ${suffix}`;
  return db.tx(async (client) => {
    const author = await upsertAccount(client, store, `Ada Byrne${nameSuffix}`, `author-${suffix}@example.test`, 'guide-pass-7', true);
    const coauthor = await upsertAccount(client, store, `Ren Ito${nameSuffix}`, `coauthor-${suffix}@example.test`, 'guide-pass-7', true);
    const reader = await upsertAccount(client, store, `Marta Rey${nameSuffix}`, `reader-${suffix}@example.test`, 'guide-pass-7', true);
    const newcomer = await upsertAccount(client, store, `Nils Hart${nameSuffix}`, `newcomer-${suffix}@example.test`, 'guide-pass-7', false);

    const publicSpec = coffeeGuide(nameSuffix);
    publicSpec.slug = slugify(`${publicSpec.slug} ${suffix}`);
    const publicGuideId = await seedGuide(client, store, s3, samplesDir, publicSpec, author.id, { publishVersion: 3, visibility: 'public' });
    await client.query('INSERT INTO coauthors (guide_id, account_id) VALUES ($1, $2)', [publicGuideId, coauthor.id]);

    const privateSpec = bikeHubGuide(nameSuffix);
    privateSpec.slug = `${privateSpec.slug}-p`;
    const privateGuideId = await seedGuide(client, store, s3, samplesDir, privateSpec, author.id, { publishVersion: 1, visibility: 'private' });

    const draftSpec = bikeHubGuide(nameSuffix);
    draftSpec.slug = `${draftSpec.slug}-d`;
    const draftGuideId = await seedGuide(client, store, s3, samplesDir, draftSpec, author.id, { publishVersion: 0, visibility: 'public' });
    await client.query('INSERT INTO coauthors (guide_id, account_id) VALUES ($1, $2)', [draftGuideId, coauthor.id]);

    const withdrawnSpec = gameControllerGuide(nameSuffix);
    withdrawnSpec.slug = `${withdrawnSpec.slug}-w`;
    const withdrawnGuideId = await seedGuide(client, store, s3, samplesDir, withdrawnSpec, author.id, { publishVersion: 1, visibility: 'public', withdraw: true });

    const collectionId = newId('col');
    await client.query("INSERT INTO collections (id, slug, title, owner_id, visibility) VALUES ($1, $2, $3, $4, 'public')", [collectionId, `kitchen-fixes-${suffix}`, `Kitchen fixes ${suffix}`, author.id]);
    await client.query('INSERT INTO collection_items (collection_id, guide_id, position) VALUES ($1, $2, 0)', [collectionId, publicGuideId]);

    const questionId = newId('qst');
    await client.query('INSERT INTO questions (id, guide_id, step, text, asked_by) VALUES ($1, $2, 2, $3, $4)', [questionId, publicGuideId, 'Which way does the upper burr turn?', reader.id]);

    const publicGuideRow = await client.query('SELECT id, slug, title FROM guides WHERE id = $1', [publicGuideId]);
    const privateGuideRow = await client.query('SELECT id, slug, title FROM guides WHERE id = $1', [privateGuideId]);
    const draftGuideRow = await client.query('SELECT id, slug, title FROM guides WHERE id = $1', [draftGuideId]);
    const withdrawnGuideRow = await client.query('SELECT id, slug, title FROM guides WHERE id = $1', [withdrawnGuideId]);
    const collectionRow = await client.query('SELECT id, slug, title FROM collections WHERE id = $1', [collectionId]);

    return {
      author: { id: author.id, name: `Ada Byrne${nameSuffix}`, email: `author-${suffix}@example.test`, password: 'guide-pass-7' },
      coauthor: { id: coauthor.id, name: `Ren Ito${nameSuffix}`, email: `coauthor-${suffix}@example.test`, password: 'guide-pass-7' },
      reader: { id: reader.id, name: `Marta Rey${nameSuffix}`, email: `reader-${suffix}@example.test`, password: 'guide-pass-7' },
      newcomer: { id: newcomer.id, name: `Nils Hart${nameSuffix}`, email: `newcomer-${suffix}@example.test`, password: 'guide-pass-7' },
      guides: {
        public: publicGuideRow.rows[0],
        private: privateGuideRow.rows[0],
        withdrawn: withdrawnGuideRow.rows[0],
        draft: draftGuideRow.rows[0],
      },
      collection: collectionRow.rows[0],
      question: { id: questionId, guide_id: publicGuideId, step: 2 },
    };
  });
}

export interface WorldJson {
  author: { id: string; name: string; email: string; password: string };
  coauthor: { id: string; name: string; email: string; password: string };
  reader: { id: string; name: string; email: string; password: string };
  newcomer: { id: string; name: string; email: string; password: string };
  guides: {
    public: { id: string; slug: string; title: string };
    private: { id: string; slug: string; title: string };
    withdrawn: { id: string; slug: string; title: string };
    draft: { id: string; slug: string; title: string };
  };
  collection: { id: string; slug: string; title: string };
  question: { id: string; guide_id: string; step: number };
}
