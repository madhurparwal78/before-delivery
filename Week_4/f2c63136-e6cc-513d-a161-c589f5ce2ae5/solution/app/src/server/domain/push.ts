import type { Row, Tx } from '../db.ts';
import { HttpError } from '../errors.ts';
import { Events } from './events.ts';
import { Contents, createRevision, loadSnap, storeBytes, type Author, type FileRef, type Snap } from './revisions.ts';
import { headAdvanced, unmergedChanges, stackNumbers } from './stack.ts';
import { mainMoved, removeEntry } from './queue.ts';

export type FileChange = { bytes: Buffer } | { delete: true };

interface PushInput {
  branch: string;
  expectedHead: string | null;
  from: string | null;
  message: string;
  files: Map<string, FileChange>;
}

export async function branchHead(tx: Pick<Tx, 'q'>, repoId: number, name: string): Promise<string | null> {
  const rows = await tx.q<Row>('SELECT revision FROM branches WHERE repo_id = $1 AND name = $2', [repoId, name]);
  return rows[0]?.revision ?? null;
}

export const staleHead = (current: string): HttpError => new HttpError(409, { error: 'Stale head', current_head: current });

/** Uploads every submitted object; storage must confirm each before the push is accepted. */
export async function uploadFiles(files: Map<string, FileChange>, contents: Contents): Promise<Map<string, FileRef | null>> {
  const stored = new Map<string, FileRef | null>();
  await Promise.all(
    [...files].map(async ([path, change]) => {
      stored.set(path, 'delete' in change ? null : await storeBytes(change.bytes, contents));
    }),
  );
  return stored;
}

/** What happens once a branch has moved: change heads advance, bases are recomputed, the queue restarts. */
async function branchMoved(tx: Tx, repo: Row, branch: string, previous: string | null, author: Author, contents: Contents): Promise<void> {
  const events = new Events();
  const all = await unmergedChanges(tx, repo.id);
  const headOf = all.find((change) => change.head === branch);
  if (headOf && previous) {
    await headAdvanced(tx, repo, headOf, previous, author, contents, events, (entry, reason) => removeEntry(tx, repo, entry, reason, contents, events));
  }
  const basedOn = all.filter((change) => change.base === branch);
  events.touch(basedOn.flatMap((change) => stackNumbers(all, change)));
  if (branch === 'main') await mainMoved(tx, repo, contents, events);
  events.emit(tx, repo.id);
}

/** Creates the one revision of a push and moves (or creates) the branch, under the repository lock. */
export async function performPush(tx: Tx, repo: Row, input: PushInput, stored: Map<string, FileRef | null>, author: Author, contents: Contents): Promise<{ revision: string; parent: string }> {
  await tx.lockRepo(repo.id);
  const current = await branchHead(tx, repo.id, input.branch);
  if (input.expectedHead === null ? current !== null : current !== input.expectedHead) throw staleHead(current ?? '');
  const parent = current ?? (await branchHead(tx, repo.id, input.from!))!;
  const snap: Snap = new Map(await loadSnap(tx, repo.id, parent));
  for (const [path, ref] of stored) {
    if (ref) snap.set(path, ref);
    else snap.delete(path);
  }
  const revision = await createRevision(tx, repo.id, { parents: [parent], message: input.message, snap, author }, contents);
  await tx.q(
    `INSERT INTO branches (repo_id, name, revision) VALUES ($1, $2, $3) ON CONFLICT (repo_id, name) DO UPDATE SET revision = EXCLUDED.revision`,
    [repo.id, input.branch, revision],
  );
  await branchMoved(tx, repo, input.branch, current, author, contents);
  return { revision, parent };
}

