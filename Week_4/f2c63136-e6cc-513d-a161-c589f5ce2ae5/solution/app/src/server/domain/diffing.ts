import type { Db, Row } from '../db.ts';
import { config } from '../config.ts';
import { diffHunks } from '../../shared/diff.ts';
import type { DiffFile } from '../../shared/types.ts';
import { combinedDiff } from './combined.ts';
import { Contents, loadSnap } from './revisions.ts';

/** The combined diff of a change with both texts and the hunks of every path. */
export async function changeDiff(db: Db, repo: Row, change: Row, contents: Contents, onlyPath?: string): Promise<DiffFile[]> {
  const changed = combinedDiff(await loadSnap(db, repo.id, change.base_revision), await loadSnap(db, repo.id, change.head_revision));
  const wanted = onlyPath === undefined ? changed : changed.filter((file) => file.path === onlyPath);
  return Promise.all(
    wanted.map(async (file) => {
      const baseText = file.baseSha ? (await contents.get(file.baseSha)).toString('utf8') : null;
      const headText = file.headSha ? (await contents.get(file.headSha)).toString('utf8') : null;
      return {
        path: file.path,
        status: file.status,
        base_text: baseText,
        head_text: headText,
        hunks: diffHunks(baseText ?? '', headText ?? '', config.diffContextLines),
      };
    }),
  );
}
