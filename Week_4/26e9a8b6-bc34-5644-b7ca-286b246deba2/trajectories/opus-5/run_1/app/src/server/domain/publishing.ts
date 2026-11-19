import { randomUUID } from 'node:crypto';
import { ApiError, illegalTransition, notFound } from '../http/errors.js';
import { execute, queryOne } from '../db/index.js';
import { modelConfirmed, StorageUnreachable } from '../storage/s3.js';
import {
  createGuide,
  latestVersionNumber,
  loadModel,
  refreshSearchText,
  uniqueSlug,
  versionSnapshot,
  type GuideRow,
} from './guides.js';
import { applySnapshotToWorkingCopy, saveVersion } from './versions.js';

export interface PublishOutcome {
  state: 'published';
  published_version: number;
}

/** Publish checks run in this order after the state check. */
export async function publishGuide(
  guide: GuideRow,
  requested: number | null,
): Promise<PublishOutcome> {
  const latest = await latestVersionNumber(guide.id);
  const target = requested ?? latest;
  if (guide.state === 'published' && target !== null && guide.published_version === target) {
    throw illegalTransition('published', 'published');
  }
  if (target === null) throw new ApiError(422, { error: 'no_version' });

  const snapshot = await versionSnapshot(guide.id, target);
  if (snapshot === null) throw notFound();

  const model = await loadModel(snapshot.model_id);
  if (model === null) throw new ApiError(422, { error: 'model_not_stored' });

  try {
    if (!(await modelConfirmed(model.id, Number(model.bytes)))) {
      throw new ApiError(503, { error: 'storage_unavailable' });
    }
  } catch (error) {
    if (error instanceof StorageUnreachable) throw new ApiError(503, { error: 'storage_unavailable' });
    throw error;
  }

  const unbound = snapshot.parts.filter((part) => part.node_path === null).map((part) => part.name);
  if (unbound.length > 0) throw new ApiError(422, { error: 'unbound_parts', parts: unbound });

  if (!snapshot.model_scale_confirmed) throw new ApiError(422, { error: 'scale_unconfirmed' });

  await execute(
    `UPDATE guides SET state = 'published', published_version = $2,
       published_at = coalesce(published_at, now()) WHERE id = $1`,
    [guide.id, target],
  );
  await refreshSearchText({ ...guide, published_version: target });
  return { state: 'published', published_version: target };
}

export async function withdrawGuide(guide: GuideRow): Promise<{ state: 'withdrawn' }> {
  if (guide.state !== 'published') throw illegalTransition(guide.state, 'withdrawn');
  await execute("UPDATE guides SET state = 'withdrawn' WHERE id = $1", [guide.id]);
  return { state: 'withdrawn' };
}

export interface ForkOutcome {
  id: string;
  slug: string;
  forked_from: { guide_id: string; title: string; author_name: string; version: number };
}

/**
 * Only a public published guide can be forked. The fork pins the source's
 * published version, title and author name as written then, and starts as a
 * public draft with a copy of the pinned version as its own version 1.
 */
export async function forkGuide(source: GuideRow, forkerId: string): Promise<ForkOutcome> {
  if (source.visibility !== 'public' || source.state !== 'published') throw notFound();
  const pinned = source.published_version;
  if (pinned === null) throw notFound();
  const snapshot = await versionSnapshot(source.id, pinned);
  if (snapshot === null) throw notFound();

  const author = await queryOne<{ name: string }>('SELECT name FROM users WHERE id = $1', [
    source.owner_id,
  ]);
  const title = `${source.title} (fork)`;
  const fork = await createGuide(forkerId, title, snapshot.currency, await uniqueSlug(title));

  const credit = {
    guide_id: source.id,
    title: source.title,
    author_name: author?.name ?? '',
    version: pinned,
  };
  await execute(
    `UPDATE guides SET forked_from_guide_id = $2, forked_from_title = $3,
       forked_from_author = $4, forked_from_version = $5 WHERE id = $1`,
    [fork.id, credit.guide_id, credit.title, credit.author_name, credit.version],
  );

  const copied = {
    ...snapshot,
    title,
    steps: snapshot.steps.map((step) => ({ ...step })),
    parts: snapshot.parts.map((part) => ({ ...part, id: randomUUID() })),
  };
  const partIdByOld = new Map(snapshot.parts.map((part, index) => [part.id, copied.parts[index]?.id ?? part.id]));
  const stepIdByOld = new Map(snapshot.steps.map((step) => [step.id, randomUUID()]));
  copied.steps = copied.steps.map((step) => ({
    ...step,
    id: stepIdByOld.get(step.id) ?? step.id,
    focus_parts: step.focus_parts.map((id) => partIdByOld.get(id) ?? id),
    callouts: step.callouts.map((callout) => ({
      ...callout,
      part_id: partIdByOld.get(callout.part_id) ?? callout.part_id,
    })),
  }));
  copied.parts = copied.parts.map((part) => ({
    ...part,
    fitted_at: part.fitted_at === null ? null : stepIdByOld.get(part.fitted_at) ?? null,
  }));

  await applySnapshotToWorkingCopy(fork, copied);
  await saveVersion({ ...fork, title }, null, forkerId, null, copied);
  await execute('DELETE FROM field_revisions WHERE guide_id = $1', [fork.id]);

  return { id: fork.id, slug: fork.slug, forked_from: credit };
}

export async function deleteGuide(guideId: string): Promise<void> {
  await execute('DELETE FROM guides WHERE id = $1', [guideId]);
}
