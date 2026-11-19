import type { PoolClient } from 'pg';
import type { Files } from '../../shared/api';
import { transact } from '../db';
import { apiError } from '../errors';
import { getObject, putObject } from '../storage';
import { canonicalSha256, parseSnapshot, snapshotBytes, snapshotKey } from './canonical';
import { diffFiles, EMPTY_FILES } from './diff';
import type { VersionRow } from './pens';

export interface AppendInput {
  penId: string;
  baseVersion: number;
  files: Files;
  libraries: string[];
  restoredFrom: number | null;
  createdAt?: Date;
}

const previousFiles = async (
  client: PoolClient,
  penId: string,
  number: number,
): Promise<{ files: Files; libraries: string[] }> => {
  if (number <= 1) return { files: EMPTY_FILES, libraries: [] };
  const result = await client.query<VersionRow>(
    'select * from versions where pen_id = $1 and number = $2',
    [penId, number - 1],
  );
  const row = result.rows[0];
  if (!row) return { files: EMPTY_FILES, libraries: [] };
  return { files: { html: row.html, css: row.css, js: row.js }, libraries: row.libraries };
};

/**
 * The one place that assigns a version number, checks base_version, confirms the snapshot in
 * storage and inserts the version row. Numbers per pen are gapless and never reused.
 */
export const appendVersion = async (input: AppendInput): Promise<VersionRow> =>
  transact(async (client) => {
    const locked = await client.query<{ head: number }>(
      'select head from pens where id = $1 for update',
      [input.penId],
    );
    const head = locked.rows[0]?.head;
    if (head === undefined) throw apiError('not_found');
    if (head !== input.baseVersion) throw apiError('version_conflict', { head });

    const number = head + 1;
    const sha256 = canonicalSha256(input.files, input.libraries);
    const key = snapshotKey(input.penId, number);
    const body = snapshotBytes({
      pen_id: input.penId,
      number,
      sha256,
      files: input.files,
      libraries: input.libraries,
    });

    await putObject(key, body, 'application/json');
    const readBack = await getObject(key);
    if (!readBack || !readBack.equals(body)) throw apiError('storage_unavailable');
    const stored = parseSnapshot(readBack);
    if (canonicalSha256(stored.files, stored.libraries) !== sha256) {
      throw apiError('storage_unavailable');
    }

    const previous = await previousFiles(client, input.penId, number);
    const counts = diffFiles(previous.files, input.files);

    const inserted = await client.query<VersionRow>(
      `insert into versions (pen_id, number, created_at, sha256, restored_from, html, css, js,
                             libraries, added, removed, changed_chars)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       returning *`,
      [
        input.penId,
        number,
        input.createdAt ?? new Date(),
        sha256,
        input.restoredFrom,
        input.files.html,
        input.files.css,
        input.files.js,
        input.libraries,
        counts.added,
        counts.removed,
        counts.changed_chars,
      ],
    );
    await client.query('update pens set head = $2, updated_at = $3 where id = $1', [
      input.penId,
      number,
      input.createdAt ?? new Date(),
    ]);
    return inserted.rows[0]!;
  });
