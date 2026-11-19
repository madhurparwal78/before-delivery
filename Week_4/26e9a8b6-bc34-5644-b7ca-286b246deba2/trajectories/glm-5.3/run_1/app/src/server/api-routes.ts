// Route handlers: reading JSON, models, versions, publish, forks, questions, search,
// dashboard, collections and stills.

import type { ApiContext } from './api';
import { errors } from './errors';
import { limits } from './limits';
import { checkRate } from './rate';
import { newId, sha256Hex } from './ids';
import { checkGlb } from '../shared/glb';
import { formatCost } from '../shared/cost';
import { canRead, canSee, checkPublish, transition } from './domain';
import { compareVersions, wordDiff } from './compare';
import {
  editableGuideOf, visibleGuideOf, requireConfirmed, requireSession, sendJson, readJsonBody,
  pageParams, codePoints, sessionAccount,
} from './api-helpers';
import type { GuideAccess } from './store-types';

// ---- guide reading JSON ---------------------------------------------------

export async function sendGuideReading(context: ApiContext, access: GuideAccess): Promise<void> {
  const store = context.app.store;
  const guide = access.guide;
  // Withdrawn answers 410 to everyone but owner and co-authors.
  if (guide.state === 'withdrawn' && !access.isOwner && !access.isCoauthor) throw errors.withdrawn();
  const versionNumber = guide.state === 'published' ? guide.published_version : guide.latest_version;
  if (versionNumber === null) throw errors.notFound();
  const version = await store.versionRow(guide.id, versionNumber);
  if (!version) throw errors.notFound();
  const steps = version.steps;
  const parts = version.parts;
  const stepsWithCost = steps.map((step) => {
    const total = runningCostOf(steps, parts, step.id);
    return {
      id: step.id,
      number: step.number,
      title: step.title,
      text: step.text,
      phase: step.phase,
      explode: step.explode,
      focus_parts: step.focus_parts,
      camera: step.camera,
      callouts: step.callouts,
      parts_cost: total,
      parts_cost_text: formatCost(total, guide.currency),
    };
  });
  const totalCost = Number(version.parts_cost);
  const likeCount = await store.likeCount(guide.id);
  const forkCount = await store.forkCount(guide.id);
  const authorName = (await store.accountName(guide.owner_id)) ?? '';
  sendJson(context, 200, {
    id: guide.id,
    slug: guide.slug,
    title: guide.title,
    author: { id: guide.owner_id, name: authorName },
    state: guide.state,
    visibility: guide.visibility,
    currency: guide.currency,
    tags: await store.tags(guide.id),
    published_version: guide.published_version,
    like_count: likeCount,
    fork_count: forkCount,
    model_id: version.model_id,
    total_cost: totalCost,
    total_cost_text: formatCost(totalCost, guide.currency),
    part_count: parts.length,
    step_count: steps.length,
    parts,
    steps: stepsWithCost,
    forked_from: guide.forked_from_guide_id
      ? { guide_id: guide.forked_from_guide_id, title: guide.forked_from_title ?? '', author_name: guide.forked_from_author ?? '', version: guide.forked_from_version ?? 0 }
      : null,
  });
}

function runningCostOf(steps: { id: string }[], parts: { fitted_at: string | null; quantity: number; unit_price: number }[], stepId: string): number {
  const fitIndex = new Map(steps.map((step, index) => [step.id, index]));
  const limit = fitIndex.get(stepId) ?? -1;
  let total = 0;
  for (const part of parts) {
    if (part.fitted_at === null) continue;
    const at = fitIndex.get(part.fitted_at);
    if (at === undefined || at > limit) continue;
    total += part.quantity * part.unit_price;
  }
  return total;
}

// ---- working copy commit ---------------------------------------------------

export async function commitField(context: ApiContext, idOrSlug: string): Promise<void> {
  const store = context.app.store;
  const access = await editableGuideOf(context, idOrSlug);
  if (!access) throw errors.notFound();
  const account = await requireConfirmed(context);
  if (!access.isOwner && !access.isCoauthor) {
    if (access.guide.state === 'withdrawn') throw errors.withdrawn();
    throw errors.forbidden();
  }
  const body = await readJsonBody(context);
  await doCommit(context, access, account.name, body);
}

import { bumpFieldRevision } from './domain';
import { checkFieldValue, parseFieldPath, type WorkingJson } from '../shared/working';
import type { PoolClient } from 'pg';

async function doCommit(context: ApiContext, access: GuideAccess, byName: string, body: Record<string, unknown>): Promise<void> {
  const store = context.app.store;
  const guide = access.guide;
  const field = body.field;
  const value = body.value;
  const basedOn = body.based_on;
  if (typeof field !== 'string') throw errors.invalid('field');
  if (typeof basedOn !== 'number' || !Number.isInteger(basedOn) || basedOn < 0) throw errors.invalid('based_on');
  const parsed = parseFieldPath(field);
  if (parsed.kind === 'guide' && !['title', 'currency', 'tags', 'visibility', 'model_scale', 'model_scale_confirmed'].includes(parsed.field)) {
    throw errors.invalid('field');
  }
  const shape = checkFieldValue(field as never, value);
  if (!shape.valid) throw errors.invalid('field');

  const limitFor = textLimitFor(field, parsed.field);
  if (limitFor !== null && typeof value === 'string' && codePoints(value) > limitFor) {
    throw errors.tooLong(field, limitFor);
  }
  if (parsed.field === 'tags' && Array.isArray(value)) {
    if (value.length > limits.guide_tag_max) throw errors.tooMany('tags', limits.guide_tag_max);
    for (const tag of value) {
      if (typeof tag !== 'string') throw errors.invalid('tags');
      if (codePoints(tag) > limits.tag_text_max) throw errors.tooLong('tags', limits.tag_text_max);
    }
  }
  if (parsed.field === 'callouts' && Array.isArray(value)) {
    if (value.length > limits.step_callout_max) throw errors.tooMany('callouts', limits.step_callout_max);
    for (const callout of value) {
      const text = (callout as { text?: unknown }).text;
      if (typeof text !== 'string' || codePoints(text) > limits.callout_text_max) throw errors.tooLong('callouts', limits.callout_text_max);
    }
  }
  if (parsed.kind === 'step') {
    const step = await store.stepById(guide.id, parsed.id ?? '');
    if (!step) throw errors.notFound();
  }
  if (parsed.kind === 'part') {
    const part = await store.partById(guide.id, parsed.id ?? '');
    if (!part) throw errors.notFound();
  }

  const commitResult = await context.app.db.tx(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`commit:${guide.id}`]);
    const revisions = await store.fieldRevisions(guide.id);
    const current = revisions[field] ?? 0;
    if (current !== basedOn) {
      const winner = await fieldLastEditor(client, guide.id, field);
      throw errors.editConflict(field, value, {
        value: await storedFieldValue(client, store, guide.id, field),
        revision: current,
        by: winner,
      });
    }
    await applyField(context, client, store, guide.id, parsed, value);
    const fieldRevision = await bumpFieldRevision(client, guide.id, field, byName);
    const working = await store.workingJsonTx(client, guide);
    return { fieldRevision, working };
  });
  context.app.live.publish({
    type: 'edit',
    guide_id: guide.id,
    field,
    value,
    revision: commitResult.working.revision,
    field_revision: commitResult.fieldRevision,
    by: byName,
  });
  sendJson(context, 200, {
    revision: commitResult.working.revision,
    field_revision: commitResult.fieldRevision,
    guide_total: commitResult.working.guide_total,
    guide_total_text: commitResult.working.guide_total_text,
  });
}

async function fieldLastEditor(client: PoolClient, guideId: string, field: string): Promise<string> {
  const result = await client.query<{ updated_by: string }>('SELECT updated_by FROM field_revisions WHERE guide_id = $1 AND field_path = $2', [guideId, field]);
  return result.rows[0]?.updated_by ?? '';
}

async function storedFieldValue(client: PoolClient, store: import('./store').Store, guideId: string, field: string): Promise<unknown> {
  const guide = await store.guideById(guideId);
  if (!guide) return undefined;
  const working = await store.workingJson(guide);
  const parsed = parseFieldPath(field);
  if (parsed.kind === 'guide') return (working as unknown as Record<string, unknown>)[parsed.field];
  if (parsed.kind === 'step') {
    const step = working.steps.find((s) => s.id === parsed.id);
    return step ? (step as unknown as Record<string, unknown>)[parsed.field] : undefined;
  }
  const part = working.parts.find((p) => p.id === parsed.id);
  return part ? (part as unknown as Record<string, unknown>)[parsed.field] : undefined;
}

async function applyField(context: ApiContext, client: PoolClient, store: import('./store').Store, guideId: string, parsed: { kind: string; field: string; id?: string }, value: unknown): Promise<void> {
  if (parsed.kind === 'guide') {
    switch (parsed.field) {
      case 'title': await client.query('UPDATE guides SET title = $2 WHERE id = $1', [guideId, value]); break;
      case 'currency': await client.query('UPDATE guides SET currency = $2 WHERE id = $1', [guideId, value]); break;
      case 'tags': await store.setTags(client, guideId, value as string[]); break;
      case 'visibility': await client.query('UPDATE guides SET visibility = $2 WHERE id = $1', [guideId, value]); break;
      case 'model_scale': await client.query('UPDATE models SET scale = $2 WHERE id = (SELECT model_id FROM guides WHERE id = $1)', [guideId, value]); break;
      case 'model_scale_confirmed': await client.query('UPDATE models SET scale_confirmed = $2 WHERE id = (SELECT model_id FROM guides WHERE id = $1)', [guideId, value]); break;
    }
    return;
  }
  if (parsed.kind === 'step') {
    const stepId = parsed.id!;
    switch (parsed.field) {
      case 'title': await client.query('UPDATE steps SET title = $3 WHERE guide_id = $1 AND id = $2', [guideId, stepId, value]); break;
      case 'text': await client.query('UPDATE steps SET text = $3 WHERE guide_id = $1 AND id = $2', [guideId, stepId, value]); break;
      case 'phase': await client.query('UPDATE steps SET phase = $3 WHERE guide_id = $1 AND id = $2', [guideId, stepId, value]); break;
      case 'explode': await client.query('UPDATE steps SET explode = $3 WHERE guide_id = $1 AND id = $2', [guideId, stepId, value]); break;
      case 'focus_parts': await client.query('UPDATE steps SET focus_parts = $3::jsonb WHERE guide_id = $1 AND id = $2', [guideId, stepId, JSON.stringify(value)]); break;
      case 'camera': await client.query('UPDATE steps SET camera = $3::jsonb WHERE guide_id = $1 AND id = $2', [guideId, stepId, JSON.stringify(value)]); break;
      case 'callouts': await store.setStepCallouts(client, guideId, stepId, value as { part_id: string; text: string }[]); break;
    }
    return;
  }
  const partId = parsed.id!;
  switch (parsed.field) {
    case 'name': await client.query('UPDATE parts SET name = $3 WHERE guide_id = $1 AND id = $2', [guideId, partId, value]); break;
    case 'axis': await client.query('UPDATE parts SET axis = $3 WHERE guide_id = $1 AND id = $2', [guideId, partId, value]); break;
    case 'apart_mm': await client.query('UPDATE parts SET apart_mm = $3 WHERE guide_id = $1 AND id = $2', [guideId, partId, value]); break;
    case 'quantity': await client.query('UPDATE parts SET quantity = $3 WHERE guide_id = $1 AND id = $2', [guideId, partId, value]); break;
    case 'unit_price': await client.query('UPDATE parts SET unit_price = $3 WHERE guide_id = $1 AND id = $2', [guideId, partId, value]); break;
    case 'fitted_at': await client.query('UPDATE parts SET fitted_at = $3 WHERE guide_id = $1 AND id = $2', [guideId, partId, value]); break;
    case 'node_path': await client.query('UPDATE parts SET node_path = $3, unbound = false WHERE guide_id = $1 AND id = $2', [guideId, partId, value]); break;
  }
}

function textLimitFor(field: string, fieldName: string): number | null {
  if (fieldName === 'title' && field === 'title') return limits.guide_title_max;
  if (fieldName === 'title') return limits.step_title_max;
  if (fieldName === 'text') return limits.step_text_max;
  if (fieldName === 'name' && field.startsWith('part/')) return limits.part_name_max;
  return null;
}

// ---- model upload ----------------------------------------------------------

export async function uploadModel(context: ApiContext, idOrSlug: string): Promise<void> {
  const store = context.app.store;
  const access = await editableGuideOf(context, idOrSlug);
  if (!access) throw errors.notFound();
  const account = await requireConfirmed(context);
  if (!access.isOwner && !access.isCoauthor) {
    if (access.guide.state === 'withdrawn') throw errors.withdrawn();
    throw errors.forbidden();
  }
  const contentType = String(context.request.headers['content-type'] ?? '');
  if (contentType !== 'model/gltf-binary' && contentType !== 'application/octet-stream') {
    throw errors.unsupportedMediaType();
  }
  const chunks: Buffer[] = [];
  let length = 0;
  await new Promise<void>((resolve, reject) => {
    context.request.on('data', (chunk: Buffer) => {
      length += chunk.length;
      if (length > limits.model_max_bytes) {
        reject(errors.modelTooLarge(limits.model_max_bytes));
        context.request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    context.request.on('end', () => resolve());
    context.request.on('error', reject);
  });
  const data = Buffer.concat(chunks);
  const check = checkGlb(new Uint8Array(data), { model_max_bytes: limits.model_max_bytes, model_max_parts: limits.model_max_parts });
  if (!check.ok) {
    const refusal = check.refusal;
    if (refusal.code === 'model_too_large') throw errors.modelTooLarge(refusal.limit);
    if (refusal.code === 'not_glb') throw errors.notGlb();
    if (refusal.code === 'external_uri') throw errors.externalUri();
    throw errors.tooManyParts(refusal.count, refusal.limit);
  }
  const modelId = newId('mdl');
  const sha = sha256Hex(new Uint8Array(data));
  let stored: boolean;
  try {
    await context.app.s3.put(`models/${modelId}.glb`, data, 'model/gltf-binary');
    const confirm = await context.app.s3.head(`models/${modelId}.glb`);
    stored = confirm !== null && confirm.bytes === data.length;
  } catch {
    throw errors.storageUnavailable();
  }
  if (!stored) throw errors.storageUnavailable();

  await context.app.db.tx(async (client) => {
    // Replace: keep every part; missing node paths become unbound, new nodes become parts.
    const bboxMm: [number, number, number] = [
      Math.round(check.model.bboxM[0] * 1000),
      Math.round(check.model.bboxM[1] * 1000),
      Math.round(check.model.bboxM[2] * 1000),
    ];
    await client.query(
      'INSERT INTO models (id, bytes, sha256, bbox_mm, scale, scale_confirmed) VALUES ($1, $2, $3, $4::jsonb, 1, false)',
      [modelId, data.length, sha, JSON.stringify(bboxMm)],
    );
    const parts = await store.parts(access.guide.id);
    const newNodePaths = new Set(check.model.parts);
    for (const part of parts) {
      if (newNodePaths.has(part.node_path)) {
        newNodePaths.delete(part.node_path);
      } else {
        await client.query('UPDATE parts SET unbound = true WHERE id = $1', [part.id]);
      }
    }
    let position = parts.length;
    for (const path of newNodePaths) {
      const id = newId('prt');
      const name = path.split('/').pop() ?? path;
      const cleanName = name.replace(/\[\d+\]$/, '');
      await client.query(
        `INSERT INTO parts (id, guide_id, name, node_path, unbound, axis, apart_mm, quantity, unit_price, fitted_at, position)
         VALUES ($1, $2, $3, $4, false, 'y', 0, 1, 0, NULL, $5)`,
        [id, access.guide.id, cleanName, path, position++],
      );
    }
    await client.query('UPDATE guides SET model_id = $2 WHERE id = $1', [access.guide.id, modelId]);
  });
  const model = await store.modelRow(access.guide.id);
  const parts = await store.parts(access.guide.id);
  const unbound = parts.filter((part) => part.unbound).map((part) => part.name);
  context.app.live.publish({ type: 'revision', guide_id: access.guide.id, revision: access.guide.revision + 1 });
  sendJson(context, 201, { model, parts, unbound });
}

export async function modelFile(context: ApiContext, modelId: string): Promise<void> {
  const store = context.app.store;
  // A model is readable by anyone who can see a guide or fork that references it.
  const result = await context.app.db.query<{ guide_id: string }>(
    'SELECT id AS guide_id FROM guides WHERE model_id = $1',
    [modelId],
  );
  let allowed = false;
  for (const row of result.rows) {
    const guide = await store.guideById(row.guide_id);
    if (!guide) continue;
    const account = await sessionAccount(context);
    const isCoauthor = account ? await store.isCoauthor(guide.id, account.id) : false;
    if (canSee(account, guide, isCoauthor)) {
      allowed = true;
      break;
    }
  }
  if (!allowed) throw errors.notFound();
  let bytes: Buffer | null;
  try {
    bytes = await context.app.s3.get(`models/${modelId}.glb`);
  } catch {
    throw errors.storageUnavailable();
  }
  if (!bytes) throw errors.notFound();
  context.response.writeHead(200, { 'content-type': 'model/gltf-binary' });
  context.response.end(bytes);
}

// ---- versions ----------------------------------------------------------------

export async function saveVersionRoute(context: ApiContext, idOrSlug: string): Promise<void> {
  const store = context.app.store;
  const access = await editableGuideOf(context, idOrSlug);
  if (!access) throw errors.notFound();
  const account = await requireConfirmed(context);
  if (!access.isOwner && !access.isCoauthor) {
    if (access.guide.state === 'withdrawn') throw errors.withdrawn();
    throw errors.forbidden();
  }
  const body = await readJsonBody(context);
  const baseVersion = body.base_version;
  const number = await context.app.db.tx(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`version:${access.guide.id}`]);
    const guide = (await store.guideById(access.guide.id))!;
    if (typeof baseVersion === 'number' && baseVersion !== (guide.latest_version ?? 0)) {
      const fields = await versionDiffFields(store, guide, baseVersion);
      throw errors.versionConflict(guide.latest_version ?? 0, fields);
    }
    return store.saveVersion(client, guide, account.id, null);
  });
  context.app.live.publish({ type: 'version', guide_id: access.guide.id, number, by: account.name });
  sendJson(context, 201, { number });
}

async function versionDiffFields(store: import('./store').Store, guide: import('./store-types').GuideRow, baseVersion: number): Promise<string[]> {
  const base = await store.versionRow(guide.id, baseVersion);
  const working = await store.workingJson(guide);
  const fields: string[] = [];
  if (base) {
    const baseSteps = new Map((base.steps as unknown as { id: string; title: string; text: string }[]).map((step) => [step.id, step]));
    for (const step of working.steps) {
      const old = baseSteps.get(step.id);
      if (!old) continue;
      if (old.title !== step.title) fields.push(`step/${step.id}/title`);
      if (old.text !== step.text) fields.push(`step/${step.id}/text`);
    }
  }
  return fields;
}

export async function restoreVersionRoute(context: ApiContext, idOrSlug: string, versionNumber: number): Promise<void> {
  const store = context.app.store;
  const access = await editableGuideOf(context, idOrSlug);
  if (!access) throw errors.notFound();
  const account = await requireConfirmed(context);
  if (!access.isOwner && !access.isCoauthor) {
    if (access.guide.state === 'withdrawn') throw errors.withdrawn();
    throw errors.forbidden();
  }
  const version = await store.versionRow(access.guide.id, versionNumber);
  if (!version) throw errors.notFound();
  let result: { number: number; restoredFrom: number } | null = null;
  await context.app.db.tx(async (client) => {
    result = await store.restoreVersion(client, access.guide, version, account.id);
  });
  context.app.live.publish({ type: 'version', guide_id: access.guide.id, number: result!.number, by: account.name });
  context.app.live.publish({ type: 'steps', guide_id: access.guide.id });
  sendJson(context, 201, { number: result!.number, restored_from: result!.restoredFrom });
}

// ---- publish -------------------------------------------------------------------

export async function publishGuide(context: ApiContext, idOrSlug: string): Promise<void> {
  const store = context.app.store;
  const access = await editableGuideOf(context, idOrSlug);
  if (!access) throw errors.notFound();
  if (!access.isOwner) {
    if (access.guide.state === 'withdrawn') throw errors.withdrawn();
    throw errors.forbidden();
  }
  await requireConfirmed(context);
  const body = await readJsonBody(context);
  const guide = access.guide;
  const result = transition(guide.state, 'publish');
  if (!result.ok) throw errors.illegalTransition(result.from, result.to);
  if (result.to === 'published' && guide.state === 'published' && typeof body.version === 'number' && body.version === guide.published_version) {
    throw errors.illegalTransition('published', 'published');
  }
  // Publish checks in order after the state check.
  if (guide.latest_version === null) throw errors.publishChecks.noVersion();
  const targetVersion = typeof body.version === 'number' ? body.version : guide.latest_version;
  const version = await store.versionRow(guide.id, targetVersion);
  if (!version) throw errors.publishChecks.noVersion();
  const parts = version.parts;
  const unbound = parts.filter((part) => part.unbound).map((part) => part.name);
  const modelRow = version.model_id ? await context.app.db.one<{ scale_confirmed: boolean; bytes: number }>('SELECT scale_confirmed, bytes FROM models WHERE id = $1', [version.model_id]) : null;
  let storageOk = true;
  if (version.model_id) {
    try {
      const confirm = await context.app.s3.head(`models/${version.model_id}.glb`);
      storageOk = confirm !== null && confirm.bytes === (modelRow?.bytes ?? 0);
    } catch {
      storageOk = false;
    }
  }
  const refusal = checkPublish(
    { latest_version: guide.latest_version, model_id: version.model_id, storageOk },
    unbound,
    modelRow?.scale_confirmed ?? null,
  );
  if (refusal) {
    if (refusal.error === 'no_version') throw errors.publishChecks.noVersion();
    if (refusal.error === 'model_not_stored') throw errors.publishChecks.modelNotStored();
    if (refusal.error === 'storage_unavailable') throw errors.storageUnavailable();
    if (refusal.error === 'unbound_parts') throw errors.publishChecks.unboundParts(refusal.parts);
    throw errors.publishChecks.scaleUnconfirmed();
  }
  await context.app.db.tx(async (client) => {
    await client.query("UPDATE guides SET state = 'published', published_version = $2 WHERE id = $1", [guide.id, targetVersion]);
  });
  context.app.live.publish({ type: 'state', guide_id: guide.id, state: 'published' });
  sendJson(context, 200, { state: 'published', published_version: targetVersion });
}

// ---- forks ----------------------------------------------------------------------

export async function forkGuide(context: ApiContext, idOrSlug: string): Promise<void> {
  const store = context.app.store;
  const account = await requireConfirmed(context);
  // Only a public published guide can be forked; anything else answers 404.
  const guide = (await store.guideById(idOrSlug)) ?? (await store.guideBySlug(idOrSlug));
  if (!guide) throw errors.notFound();
  const isCoauthor = await store.isCoauthor(guide.id, account.id);
  if (!canSee(account, guide, isCoauthor)) throw errors.notFound();
  if (guide.state === 'withdrawn') throw errors.notFound();
  if (guide.visibility !== 'public' || guide.state !== 'published' || guide.published_version === null) throw errors.notFound();
  const version = await store.versionRow(guide.id, guide.published_version);
  if (!version) throw errors.notFound();
  const authorName = (await store.accountName(guide.owner_id)) ?? '';
  const steps = version.steps;
  const parts = version.parts;

  let fork: { id: string; slug: string; title: string } | null = null;
  let forkedModelId: string | null = null;
  await context.app.db.tx(async (client) => {
    // Copy the model object so the fork keeps working whatever happens to the source.
    if (version.model_id) {
      const bytes = await context.app.s3.get(`models/${version.model_id}.glb`).catch(() => null);
      if (bytes) {
        forkedModelId = newId('mdl');
        await context.app.s3.put(`models/${forkedModelId}.glb`, bytes, 'model/gltf-binary');
        await client.query(
          'INSERT INTO models (id, bytes, sha256, bbox_mm, scale, scale_confirmed) SELECT $1, bytes, sha256, bbox_mm, scale, scale_confirmed FROM models WHERE id = $2',
          [forkedModelId, version.model_id],
        );
      }
    }
    const forkId = newId('gde');
    const title = `${guide.title} (fork)`;
    const slug = await store.uniqueSlug(title);
    await client.query(
      `INSERT INTO guides (id, slug, title, owner_id, state, visibility, currency, model_id, forked_from_guide_id, forked_from_title, forked_from_author, forked_from_version, latest_version)
       VALUES ($1, $2, $3, $4, 'draft', 'public', $5, $6, $7, $8, $9, $10, 1)`,
      [forkId, slug, title, account.id, guide.currency, forkedModelId, guide.id, guide.title, authorName, version.number],
    );
    for (const tag of await store.tags(guide.id)) {
      await client.query('INSERT INTO guide_tags (guide_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING', [forkId, tag]);
    }
    // Steps and parts get fresh ids, mapped so fitted_at and focus_parts stay correct.
    const stepIdMap = new Map<string, string>();
    const partIdMap = new Map<string, string>();
    const forkSteps = steps.map((step) => ({
      ...step,
      id: (stepIdMap.set(step.id, newId('stp')), stepIdMap.get(step.id))!,
      focus_parts: step.focus_parts.filter((id) => parts.some((part) => part.id === id)).map((id) => partIdMap.get(id) ?? id),
      callouts: (step.callouts ?? []).filter((callout) => parts.some((part) => part.id === callout.part_id)),
    }));
    for (const part of parts) {
      partIdMap.set(part.id, newId('prt'));
    }
    for (const step of forkSteps) {
      step.focus_parts = step.focus_parts
        .map((id) => partIdMap.get(id))
        .filter((id): id is string => id !== undefined);
      step.callouts = (step.callouts ?? []).map((callout) => ({
        part_id: partIdMap.get(callout.part_id) ?? callout.part_id,
        text: callout.text,
      }));
    }
    for (const [index, step] of forkSteps.entries()) {
      await client.query(
        `INSERT INTO steps (id, guide_id, position, title, text, phase, explode, focus_parts, camera)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)`,
        [step.id, forkId, index, step.title, step.text, step.phase, step.explode, JSON.stringify(step.focus_parts), JSON.stringify(step.camera)],
      );
      for (const [calloutIndex, callout] of (step.callouts ?? []).entries()) {
        await client.query(
          'INSERT INTO callouts (guide_id, step_id, part_id, text, position) VALUES ($1, $2, $3, $4, $5)',
          [forkId, step.id, callout.part_id, callout.text, calloutIndex],
        );
      }
    }
    for (const [index, part] of parts.entries()) {
      await client.query(
        `INSERT INTO parts (id, guide_id, name, node_path, unbound, axis, apart_mm, quantity, unit_price, fitted_at, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          partIdMap.get(part.id)!, forkId, part.name, part.node_path, part.unbound, part.axis,
          part.apart_mm, part.quantity, part.unit_price, part.fitted_at ? stepIdMap.get(part.fitted_at) ?? null : null, index,
        ],
      );
    }
    // The pinned version as the fork's own version 1.
    const versionSteps = forkSteps;
    const versionParts = parts.map((part) => ({ ...part, id: partIdMap.get(part.id)!, fitted_at: part.fitted_at ? stepIdMap.get(part.fitted_at) ?? null : null }));
    await client.query(
      `INSERT INTO versions (guide_id, number, saved_by, restored_from, steps, parts, model_id, parts_cost)
       VALUES ($1, 1, $2, NULL, $3::jsonb, $4::jsonb, $5, $6)`,
      [forkId, account.id, JSON.stringify(versionSteps), JSON.stringify(versionParts), forkedModelId, Number(version.parts_cost)],
    );
    const shelfResult = await client.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM guides WHERE forked_from_guide_id = $1', [guide.id]);
    context.app.live.publish({ type: 'fork', guide_id: guide.id, count: shelfResult.rows[0].count });
    fork = { id: forkId, slug, title };
  });
  sendJson(context, 201, {
    id: fork!.id,
    slug: fork!.slug,
    forked_from: { guide_id: guide.id, title: guide.title, author_name: authorName, version: version.number },
  });
}

// ---- questions -----------------------------------------------------------------

export async function askQuestion(context: ApiContext, idOrSlug: string): Promise<void> {
  const store = context.app.store;
  const account = await requireConfirmed(context);
  const access = await visibleGuideOf(context, idOrSlug);
  if (!access) throw errors.notFound();
  const guide = access.guide;
  if (guide.state === 'withdrawn' && !access.isOwner && !access.isCoauthor) throw errors.withdrawn();
  if (guide.published_version === null) throw errors.notFound();
  const body = await readJsonBody(context);
  const step = body.step;
  const text = body.text;
  if (typeof step !== 'number' || !Number.isInteger(step) || step < 1) throw errors.invalid('step');
  if (typeof text !== 'string' || text.length === 0) throw errors.invalid('text');
  if (codePoints(text) > limits.question_text_max) throw errors.tooLong('text', limits.question_text_max);
  const version = await store.versionRow(guide.id, guide.published_version);
  if (!version || step > version.steps.length) throw errors.invalid('step');
  // Only valid questions count toward the question limit.
  const key = `question:${account.id}`;
  const limited = await checkRate(context.app.db, key, limits.question_limit, limits.question_window_seconds, false);
  if (!limited.allowed) throw errors.rateLimited(limited.retryAfter);
  await checkRate(context.app.db, key, limits.question_limit, limits.question_window_seconds, true);
  let questionRow: import('./store').QuestionRow | null = null;
  await context.app.db.tx(async (client) => {
    questionRow = await store.createQuestion(client, guide.id, step, text, account.id);
  });
  const question = await store.questionJson(questionRow!);
  context.app.live.publish({ type: 'question', guide_id: guide.id, question_id: question.id });
  sendJson(context, 201, question);
}

export async function questionRoutes(context: ApiContext, path: string): Promise<void> {
  const store = context.app.store;
  const answerMatch = path.match(/^\/api\/questions\/([^/]+)\/answer$/);
  if (!answerMatch) throw errors.notFound();
  if (context.method !== 'POST') throw errors.methodNotAllowed(['POST']);
  const account = await requireConfirmed(context);
  const question = await store.questionById(answerMatch[1]);
  if (!question) throw errors.notFound();
  const guide = await store.guideById(question.guide_id);
  if (!guide) throw errors.notFound();
  const isCoauthor = await store.isCoauthor(guide.id, account.id);
  if (account.id !== guide.owner_id && !isCoauthor) {
    // The guide must still be visible to this person, else 404.
    if (!canSee(account, guide, isCoauthor)) throw errors.notFound();
    if (guide.state === 'withdrawn') throw errors.withdrawn();
    throw errors.forbidden();
  }
  if (question.answer !== null) throw errors.alreadyAnswered();
  const body = await readJsonBody(context);
  const text = body.text;
  if (typeof text !== 'string' || text.length === 0) throw errors.invalid('text');
  if (codePoints(text) > limits.answer_text_max) throw errors.tooLong('text', limits.answer_text_max);
  let updated: import('./store').QuestionRow | null = null;
  await context.app.db.tx(async (client) => {
    updated = await store.answerQuestion(client, question, text, account.id);
  });
  const json = await store.questionJson(updated!);
  context.app.live.publish({ type: 'answer', guide_id: guide.id, question_id: question.id });
  sendJson(context, 201, json);
}

// ---- search --------------------------------------------------------------------

/** Escapes pattern characters so words match literally. */
function literalWord(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function searchGuides(context: ApiContext): Promise<void> {
  const query = context.url.searchParams.get('q') ?? '';
  const tags = context.url.searchParams.getAll('tag');
  if (codePoints(query) > limits.search_query_max) throw errors.queryTooLong(limits.search_query_max);
  if (tags.length > limits.search_tag_max) throw errors.tooManyTags(limits.search_tag_max);
  const { cursor, limit } = pageParams(context);
  // Every word must match the start of a word in the published version's title,
  // step titles, step text, part names or tags.
  const words = query.split(/\s+/).filter(Boolean).map(literalWord);
  try {
    const rows = await withTimeout(async () => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      let paramIndex = 1;
      for (const word of words) {
        const pattern = `(^|[^[:alnum:]])${word}`;
        const p = paramIndex++;
        conditions.push(`(
          lower(g.title) ~ ($${p})
          OR EXISTS (SELECT 1 FROM guide_tags gt WHERE gt.guide_id = g.id AND lower(gt.tag) ~ $${p})
          OR EXISTS (SELECT 1 FROM versions v WHERE v.guide_id = g.id AND v.number = g.published_version AND (lower(v.steps::text) ~ $${p} OR lower(v.parts::text) ~ $${p}))
        )`);
        params.push(pattern);
      }
      let tagIndex = paramIndex;
      for (const tag of tags) {
        conditions.push(`EXISTS (SELECT 1 FROM guide_tags gt2 WHERE gt2.guide_id = g.id AND lower(gt2.tag) = $${tagIndex})`);
        params.push(tag.toLowerCase());
        tagIndex++;
      }
      const limitIndex = params.push(limit);
      const where = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';
      // The total count uses the same conditions with its own aliases.
      const totalConditions: string[] = [];
      let totalIndex = 1;
      for (const word of words) {
        const p = totalIndex++;
        totalConditions.push(`(
          lower(g2.title) ~ ($${p})
          OR EXISTS (SELECT 1 FROM guide_tags gtc WHERE gtc.guide_id = g2.id AND lower(gtc.tag) ~ $${p})
          OR EXISTS (SELECT 1 FROM versions v3 WHERE v3.guide_id = g2.id AND v3.number = g2.published_version AND (lower(v3.steps::text) ~ $${p} OR lower(v3.parts::text) ~ $${p}))
        )`);
      }
      let totalTagIndex = totalIndex;
      for (const tag of tags) {
        totalConditions.push(`EXISTS (SELECT 1 FROM guide_tags gtc2 WHERE gtc2.guide_id = g2.id AND lower(gtc2.tag) = $${totalTagIndex})`);
        totalTagIndex++;
      }
      const totalWhere = totalConditions.length > 0 ? `AND ${totalConditions.join(' AND ')}` : '';
      const cursorAfter = cursor !== null && cursor.length > 0;
      const sql = `
        SELECT g.id, g.slug, g.title, g.owner_id, g.created_at, v.parts_cost, v.steps,
               (SELECT COUNT(*)::int FROM guides g2
                 JOIN versions v3 ON v3.guide_id = g2.id AND v3.number = g2.published_version
                 WHERE g2.state = 'published' AND g2.visibility = 'public' ${totalWhere}) AS total
        FROM guides g
        JOIN versions v ON v.guide_id = g.id AND v.number = g.published_version
        WHERE g.state = 'published' AND g.visibility = 'public'
        ${where}
        ${cursorAfter ? 'AND (g.created_at, g.id) < ($' + (tagIndex + 1) + '::timestamptz, $' + (tagIndex + 2) + ')' : ''}
        ORDER BY g.created_at DESC, g.id DESC
        LIMIT $${limitIndex}`;
      if (cursorAfter) {
        const [afterTime, afterId] = decodeCursor(cursor);
        params.push(new Date(afterTime));
        params.push(afterId);
      }
      return context.app.db.query(sql, params);
    }, limits.search_db_timeout_ms);
    const items = [];
    for (const row of rows.rows as { id: string; slug: string; title: string; owner_id: string; parts_cost: string; steps: unknown[]; total: number }[]) {
      items.push({
        id: row.id,
        slug: row.slug,
        title: row.title,
        author_name: (await context.app.store.accountName(row.owner_id)) ?? '',
        tags: await context.app.store.tags(row.id),
        like_count: await context.app.store.likeCount(row.id),
        step_count: (row.steps as unknown[]).length,
        parts_cost_text: formatCost(Number(row.parts_cost), (await context.app.store.guideById(row.id))!.currency),
      });
    }
    const total = (rows.rows[0] as { total?: number } | undefined)?.total ?? 0;
    const nextCursor = rows.rows.length === limit
      ? encodeCursor((rows.rows as { created_at: Date; id: string }[])[rows.rows.length - 1].created_at, (rows.rows as { id: string }[])[rows.rows.length - 1].id)
      : null;
    sendJson(context, 200, { items, total, next_cursor: nextCursor });
  } catch (error) {
    if ((error as { code?: string }).code === '57014') {
      throw errors.searchTimeout();
    }
    throw error;
  }
}

function encodeCursor(time: Date, id: string): string {
  return Buffer.from(`${time.getTime()}:${id}`).toString('base64url');
}

function decodeCursor(cursor: string): [number, string] {
  const [time, id] = Buffer.from(cursor, 'base64url').toString('utf8').split(':');
  return [Number(time) || 0, id ?? ''];
}

function withTimeout<T>(fn: () => Promise<T>, ms: number): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(Object.assign(new Error('search_timeout'), { code: '57014' })), ms);
  });
  return Promise.race([fn(), timeout]);
}

// ---- dashboard -------------------------------------------------------------------

export async function dashboard(context: ApiContext, account: import('./store-types').AccountRow): Promise<void> {
  const store = context.app.store;
  const drafts = await context.app.db.query(
    "SELECT id, slug, title, state FROM guides WHERE owner_id = $1 AND state = 'draft' AND forked_from_guide_id IS NULL ORDER BY created_at DESC",
    [account.id],
  );
  const published = await context.app.db.query(
    "SELECT id, slug, title, state FROM guides WHERE owner_id = $1 AND (state = 'published' OR state = 'withdrawn') AND forked_from_guide_id IS NULL ORDER BY created_at DESC",
    [account.id],
  );
  const forks = await context.app.db.query(
    "SELECT id, slug, title, state FROM guides WHERE owner_id = $1 AND forked_from_guide_id IS NOT NULL ORDER BY created_at DESC",
    [account.id],
  );
  const collections = await context.app.db.query(
    'SELECT id, slug, title, visibility FROM collections WHERE owner_id = $1 ORDER BY created_at DESC',
    [account.id],
  );
  const questions = await context.app.db.query<{ id: string; guide_id: string; step: number; text: string; asked_by: string; asked_at: Date; answer: string | null; answered_by: string | null; answered_at: Date | null }>(
    `SELECT q.id, q.guide_id, q.step, q.text, q.asked_by, q.asked_at, q.answer, q.answered_by, q.answered_at
     FROM questions q JOIN guides g ON g.id = q.guide_id
     WHERE (g.owner_id = $1 OR EXISTS (SELECT 1 FROM coauthors c WHERE c.guide_id = g.id AND c.account_id = $1))
       AND q.answer IS NULL
     ORDER BY q.asked_at DESC LIMIT 24`,
    [account.id],
  );
  const questionItems = [];
  for (const row of questions.rows) {
    questionItems.push(await store.questionJson(row));
  }
  sendJson(context, 200, {
    drafts: drafts.rows,
    published: published.rows.map((row) => ({ ...row, state: row.state })),
    forks: forks.rows,
    collections: collections.rows,
    questions: questionItems,
    questions_next_cursor: null,
  });
}

// ---- collections ------------------------------------------------------------------

export async function createCollection(context: ApiContext, account: import('./store-types').AccountRow): Promise<void> {
  const body = await readJsonBody(context);
  const title = body.title;
  const visibility = body.visibility;
  if (typeof title !== 'string' || title.length === 0) throw errors.invalid('title');
  if (codePoints(title) > limits.guide_title_max) throw errors.tooLong('title', limits.guide_title_max);
  if (visibility !== 'public' && visibility !== 'private') throw errors.invalid('visibility');
  const id = newId('col');
  const slug = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'collection'}-${id.slice(-6).toLowerCase()}`;
  await context.app.db.tx(async (client) => {
    await client.query('INSERT INTO collections (id, slug, title, owner_id, visibility) VALUES ($1, $2, $3, $4, $5)', [id, slug, title, account.id, visibility]);
  });
  sendJson(context, 201, { id, slug, title });
}

export async function collectionRoutes(context: ApiContext, idOrSlug: string, rest: string): Promise<void> {
  const store = context.app.store;
  const collection = (await store.collectionById(idOrSlug));
  if (!collection) throw errors.notFound();
  const account = await sessionAccount(context);
  const isOwner = account?.id === collection.owner_id;
  if (collection.visibility === 'private' && !isOwner) throw errors.notFound();

  if (rest === '' && (context.method === 'GET' || context.method === 'HEAD')) {
    const items = [];
    for (const row of await store.collectionItems(collection.id)) {
      const guide = await store.guideById(row.guide_id);
      if (!guide) continue;
      const visible = canSee(account, guide, account ? await store.isCoauthor(guide.id, account.id) : false);
      if (!visible) continue; // left out without disturbing the order
      items.push({ guide_id: row.guide_id, title: row.title, slug: row.slug, position: row.position });
    }
    sendJson(context, 200, {
      id: collection.id,
      slug: collection.slug,
      title: collection.title,
      visibility: collection.visibility,
      owner_name: (await store.accountName(collection.owner_id)) ?? '',
      items,
    });
    return;
  }

  if (rest === '/items' && context.method === 'POST') {
    if (!isOwner) {
      if (account) throw errors.forbidden();
      throw errors.notSignedIn();
    }
    const owner = await requireConfirmed(context);
    void owner;
    const body = await readJsonBody(context);
    const guideId = body.guide_id;
    if (typeof guideId !== 'string') throw errors.invalid('guide_id');
    const guide = await store.guideById(guideId);
    if (!guide) throw errors.notFound();
    // Only public published guides, or the owner's own guides.
    const visibleToOwner = guide.owner_id === account?.id || (guide.state === 'published' && guide.visibility === 'public');
    if (!visibleToOwner) throw errors.notFound();
    const existing = await context.app.db.one('SELECT 1 FROM collection_items WHERE collection_id = $1 AND guide_id = $2', [collection.id, guideId]);
    if (existing) throw errors.alreadyInCollection();
    let position = 0;
    await context.app.db.tx(async (client) => {
      position = await store.addCollectionItem(client, collection.id, guideId);
    });
    sendJson(context, 201, { position });
    return;
  }

  const itemMatch = rest.match(/^\/items\/([^/]+)\/move$/);
  if (itemMatch && context.method === 'POST') {
    if (!isOwner) {
      if (account) throw errors.forbidden();
      throw errors.notSignedIn();
    }
    await requireConfirmed(context);
    const body = await readJsonBody(context);
    if (typeof body.position !== 'number' || !Number.isInteger(body.position)) throw errors.invalid('position');
    let order: string[] = [];
    await context.app.db.tx(async (client) => {
      order = await store.moveCollectionItem(client, collection.id, itemMatch[1], body.position as number);
    });
    if (order.length === 0) throw errors.invalid('position');
    sendJson(context, 200, { order });
    return;
  }

  throw errors.notFound();
}

// ---- stills ------------------------------------------------------------------------

export async function stillRoute(context: ApiContext, idOrSlug: string, stepPath: string): Promise<void> {
  const store = context.app.store;
  const match = stepPath.match(/^\/(\d+)$/);
  if (!match) throw errors.notFound();
  const access = await visibleGuideOf(context, idOrSlug);
  if (!access) throw errors.notFound();
  const guide = access.guide;
  if (guide.state === 'withdrawn' && !access.isOwner && !access.isCoauthor) throw errors.withdrawn();
  const versionNumber = guide.state === 'published' ? guide.published_version : guide.latest_version;
  if (versionNumber === null) throw errors.notFound();
  const version = await store.versionRow(guide.id, versionNumber);
  if (!version) throw errors.notFound();
  const stepNumber = Number.parseInt(match[1], 10);
  const step = (version.steps as { number: number }[]).find((s) => s.number === stepNumber);
  if (!step) throw errors.notFound();
  // A still drawn by the server for that step at its saved pose and apart amount.
  const svg = renderStillSvg(stepNumber, version, guide.title);
  context.response.writeHead(200, { 'content-type': 'image/svg+xml' });
  context.response.end(svg);
}

/** A still of one step: its parts drawn as exploded boxes at the saved pose. */
function renderStillSvg(stepNumber: number, version: import('./store').VersionRow, guideTitle: string): string {
  const steps = version.steps as { number: number; title: string; explode: number; camera: { yaw: number; pitch: number } }[];
  const parts = version.parts as { name: string; node_path: string; axis: 'x' | 'y' | 'z'; apart_mm: number }[];
  const step = steps.find((entry) => entry.number === stepNumber);
  if (!step) return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"></svg>`;
  const explode = step.explode;
  const yaw = (step.camera.yaw * Math.PI) / 180;
  const pitch = (step.camera.pitch * Math.PI) / 180;
  // Project each part's offset with the pose's yaw and pitch.
  const project = (x: number, y: number, z: number): [number, number] => {
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const x1 = x * cosY - z * sinY;
    const z1 = x * sinY + z * cosY;
    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);
    const y1 = y * cosP - z1 * sinP;
    const z2 = y * sinP + z1 * cosP;
    void z2;
    return [320 + x1 * 90, 240 - y1 * 90];
  };
  const boxes = parts.map((part) => {
    const offset = (part.apart_mm * explode) / 1000;
    const ox = part.axis === 'x' ? offset : 0;
    const oy = part.axis === 'y' ? offset : 0;
    const oz = part.axis === 'z' ? offset : 0;
    const [cx, cy] = project(ox, oy, oz);
    const size = 34;
    const shade = 40 + Math.min(35, part.name.length * 2);
    return `<rect x="${(cx - size / 2).toFixed(1)}" y="${(cy - size / 2).toFixed(1)}" width="${size}" height="${size}" fill="rgb(${shade},${Math.round(shade * 0.85)},${Math.round(shade * 0.7)})" stroke="#241a12" stroke-width="1.5"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
<rect width="640" height="480" fill="#efe6d3"/>
${boxes.join('\n')}
<text x="24" y="40" font-family="sans-serif" font-size="18" fill="#241a12">${escapeXml(guideTitle)}, step ${stepNumber} still</text>
<text x="24" y="464" font-family="sans-serif" font-size="16" fill="#241a12">${escapeXml(step.title)}</text>
</svg>`;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
