import { createHash } from 'node:crypto';
import type { Db, Row, Tx } from '../db.ts';
import { iso, now, wholeSecond } from '../clock.ts';
import { getContent, putContent, sha256 } from '../s3.ts';
import { byteOrder } from './validate.ts';

export interface FileRef {
  sha: string;
  size: number;
}
export type Snap = Map<string, FileRef>;
export interface Author {
  username: string;
  name: string;
}

export async function loadSnap(db: Db, repoId: number, revision: string): Promise<Snap> {
  const rows = await db.q<Row>('SELECT path, sha, size FROM revision_files WHERE repo_id = $1 AND revision_id = $2', [repoId, revision]);
  return new Map(rows.map((row) => [row.path, { sha: row.sha, size: row.size }]));
}

export async function loadRevision(db: Db, repoId: number, id: string): Promise<Row | null> {
  const rows = await db.q<Row>('SELECT * FROM revisions WHERE repo_id = $1 AND id = $2', [repoId, id]);
  return rows[0] ?? null;
}

/** Object contents read from storage once per operation. */
export class Contents {
  private readonly memo = new Map<string, Promise<Buffer>>();

  get(sha: string): Promise<Buffer> {
    let found = this.memo.get(sha);
    if (!found) {
      found = getContent(sha);
      this.memo.set(sha, found);
    }
    return found;
  }

  /** Bytes just submitted, kept so they need no round trip. */
  known(bytes: Buffer): string {
    const sha = sha256(bytes);
    this.memo.set(sha, Promise.resolve(bytes));
    return sha;
  }
}

/** The revision id: SHA-256 of the canonical text, first 12 hex characters (brief: Revisions). */
function revisionId(parents: string[], message: string, files: { path: string; bytes: Buffer }[]): string {
  const hash = createHash('sha256');
  for (const parent of parents) hash.update(`parent ${parent}\n`);
  const text = Buffer.from(message);
  hash.update(`message ${text.length}\n`);
  hash.update(text);
  hash.update('\n');
  for (const file of [...files].sort((a, b) => byteOrder(a.path, b.path))) {
    hash.update(`file ${file.bytes.length} ${file.path}\n`);
    hash.update(file.bytes);
    hash.update('\n');
  }
  return hash.digest('hex').slice(0, 12);
}

interface NewRevision {
  parents: string[];
  message: string;
  snap: Snap;
  author: Author;
}

/** Stores the revision (every object is already confirmed by storage) and returns its id. */
export async function createRevision(tx: Tx, repoId: number, input: NewRevision, contents: Contents): Promise<string> {
  const entries = [...input.snap.entries()];
  const files = await Promise.all(entries.map(async ([path, ref]) => ({ path, bytes: await contents.get(ref.sha) })));
  const id = revisionId(input.parents, input.message, files);
  const created = await tx.q(
    `INSERT INTO revisions (repo_id, id, parents, message, author_username, author_name, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING RETURNING id`,
    [repoId, id, JSON.stringify(input.parents), input.message, input.author.username, input.author.name, wholeSecond(now())],
  );
  if (created.length && entries.length) {
    await tx.q(
      `INSERT INTO revision_files (repo_id, revision_id, path, sha, size)
       SELECT $1, $2, * FROM unnest($3::text[], $4::text[], $5::int[])`,
      [repoId, id, entries.map(([path]) => path), entries.map(([, ref]) => ref.sha), entries.map(([, ref]) => ref.size)],
    );
  }
  return id;
}

/** Uploads submitted bytes and returns them as a file reference; storage must confirm first. */
export async function storeBytes(bytes: Buffer, contents: Contents): Promise<FileRef> {
  const sha = await putContent(bytes);
  contents.known(bytes);
  return { sha, size: bytes.length };
}

export function describeRevision(row: Row) {
  return {
    id: row.id as string,
    parents: row.parents as string[],
    message: row.message as string,
    author: row.author_username as string,
    created_at: iso(row.created_at as Date),
  };
}
