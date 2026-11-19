import type { Db } from '../server/db.js';
import { invalidFields, notFound, staleHead } from '../server/errors.js';
import type { EventSink } from '../server/live.js';
import { applyHeadUpdate } from './headupdate.js';
import { changeForHeadBranch, getChangeById, type RepoRow } from './model.js';
import { removeEntryForUpdatedChange, resetAllEntries } from './queue.js';
import { clearResultsAtAndBelow, restackAbove, restackOnto, type Actor } from './restack.js';
import {
  createRevision,
  getBranchRevision,
  getSnapshot,
  loadContents,
  setBranchRevision,
  type Contents,
} from './revisions.js';

export interface PushInput {
  branch: string;
  expectedHead: string | null;
  from: string | null;
  message: unknown;
  files: unknown;
  actor: Actor;
}

interface ResolvedFile {
  path: string;
  content: Buffer | null;
}

const BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function isValidBranchName(name: string): boolean {
  return BRANCH_PATTERN.test(name);
}

export function isValidPath(path: string): boolean {
  if (path.length === 0) return false;
  const bytes = Buffer.from(path, 'utf8').length;
  if (bytes > 255) return false;
  if (path.startsWith('/') || path.endsWith('/')) return false;
  if (path.includes('\\') || path.includes('\u0000')) return false;
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

export interface PushResult {
  revision: string;
  branch: string;
  parent: string | null;
}

export async function performPush(
  tx: Db,
  repo: RepoRow,
  input: PushInput,
  sink: EventSink,
): Promise<PushResult> {
  await tx.query('SELECT id FROM rs_repos WHERE id = $1 FOR UPDATE', [repo.id]);

  const currentHead = await getBranchRevision(tx, repo.id, input.branch);
  let parent: string;
  if (input.expectedHead === null) {
    if (input.from === null) throw invalidFields({ expected_head: 'expected_head is required' });
    const fromHead = await getBranchRevision(tx, repo.id, input.from);
    if (fromHead === null) throw notFound();
    if (currentHead !== null) throw staleHead(currentHead);
    parent = fromHead;
  } else {
    if (currentHead === null) throw notFound();
    if (currentHead !== input.expectedHead) throw staleHead(currentHead);
    parent = currentHead;
  }

  const errors: Record<string, string> = {};
  if (!isValidBranchName(input.branch)) errors.branch = 'Invalid branch name';
  if (typeof input.message !== 'string') errors.message = 'Message is required';
  else if (input.message.length === 0 || input.message.length > 500) errors.message = 'Message is required';
  if (!Array.isArray(input.files)) errors.files = 'files is required';
  else if (input.files.length < 1 || input.files.length > 200) errors.files = 'files is required';

  const parentSnapshot = await getSnapshot(tx, repo.id, parent);
  const resolved: ResolvedFile[] = [];
  const seen = new Set<string>();
  if (Array.isArray(input.files)) {
    input.files.forEach((raw, index) => {
      const entry = (raw ?? {}) as Record<string, unknown>;
      const path = entry.path;
      if (typeof path !== 'string' || !isValidPath(path)) {
        errors[`files.${index}.path`] = 'Invalid path';
        return;
      }
      if (seen.has(path)) {
        errors[`files.${index}.path`] = 'Duplicate path';
        return;
      }
      seen.add(path);
      if (entry.delete === true) {
        if (!parentSnapshot.has(path)) errors[`files.${index}.path`] = 'Path does not exist';
        else resolved.push({ path, content: null });
        return;
      }
      if (typeof entry.content === 'string') {
        resolved.push({ path, content: Buffer.from(entry.content, 'utf8') });
        return;
      }
      if (typeof entry.content_base64 === 'string') {
        const bytes = Buffer.from(entry.content_base64, 'base64');
        try {
          new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch {
          errors[`files.${index}.content_base64`] = `File ${path} is not UTF-8 text`;
          return;
        }
        resolved.push({ path, content: bytes });
        return;
      }
      errors[`files.${index}.content`] = 'content is required';
    });
  }
  if (Object.keys(errors).length > 0) throw invalidFields(errors);

  const contents: Contents = await loadContents(parentSnapshot);
  for (const file of resolved) {
    if (file.content === null) contents.delete(file.path);
    else contents.set(file.path, file.content);
  }

  const revision = await createRevision(tx, repo.id, {
    parents: [parent],
    message: input.message as string,
    authorUsername: input.actor.username,
    authorName: input.actor.name,
    contents,
  });
  await setBranchRevision(tx, repo.id, input.branch, revision);
  await afterRevisionOnBranch(tx, repo, input.branch, parent, revision, sink, input.actor);
  return { revision, branch: input.branch, parent };
}

/** Everything a new head revision on a branch causes: dismissal, threads, restacks and the queue. */
export async function afterRevisionOnBranch(
  tx: Db,
  repo: RepoRow,
  branch: string,
  previousHead: string,
  revision: string,
  sink: EventSink,
  actor: Actor,
): Promise<void> {
  const change = await changeForHeadBranch(tx, repo.id, branch);
  if (change) {
    await clearResultsAtAndBelow(tx, repo, change);
    const update = await applyHeadUpdate(
      tx,
      repo,
      change,
      { head: previousHead, base: change.baseRevision },
      { head: revision, base: change.baseRevision },
    );
    sink.add({
      kind: 'revision',
      text: `#${change.number}: new revision ${revision} from ${actor.name}, approvals ${
        update.kept ? 'kept' : 'dismissed'
      }`,
      change: change.number,
      walkFrom: change.number,
    });

    if (change.state === 'queued') {
      await removeEntryForUpdatedChange(tx, repo, change, sink);
    } else if (change.state === 'removed') {
      await tx.query('UPDATE rs_changes SET removal_reason = NULL WHERE id = $1', [change.id]);
    }

    const refreshed = (await getChangeById(tx, change.id))!;
    const lower = await changeForHeadBranch(tx, repo.id, refreshed.baseBranch);
    const lowerHead = lower ? await getBranchRevision(tx, repo.id, lower.headBranch) : null;
    if (lower && lowerHead !== null && lowerHead !== refreshed.baseRevision) {
      await restackOnto(tx, repo, refreshed, lower, lowerHead, sink, actor, null);
    } else {
      await restackAbove(tx, repo, refreshed, sink, actor);
    }
  }

  if (branch === repo.defaultBranch && repo.queueOn) {
    await resetAllEntries(tx, repo, sink);
  }
}
