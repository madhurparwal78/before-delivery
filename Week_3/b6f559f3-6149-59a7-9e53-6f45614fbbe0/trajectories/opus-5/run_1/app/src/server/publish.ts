import { createHash } from 'node:crypto';
import { errors } from './http';
import { MSG } from '../shared/messages';
import { config } from './config';
import { query, queryOne, transaction } from './db';
import { serverNow } from './clock';
import { loadDocument } from './repo';
import { completeDocument } from '../shared/scene-doc';
import type { SceneDocument } from '../shared/types';
import { putObject, confirmObject, storageKeys, StorageUnavailable } from './storage';
import { enqueueMail, flushOutbox } from './mail';
import { broadcastVersion } from './ws';
import type { Person } from './access';

export interface VersionInfo {
  number: number;
  status: string;
  publishedAt: string;
  publishedBy: string;
  sha256: string;
}

export function bundleBytes(document: SceneDocument): Buffer {
  return Buffer.from(JSON.stringify(completeDocument(document)), 'utf8');
}

export async function publishVersion(
  projectId: string,
  projectName: string,
  person: Person,
  fromVersion: number | null,
): Promise<VersionInfo> {
  let document: SceneDocument;
  if (fromVersion !== null) {
    const source = await queryOne<{ bundle: string }>(
      `SELECT bundle FROM versions WHERE project_id = $1 AND number = $2`,
      [projectId, fromVersion],
    );
    if (!source) throw errors.validation({ fromVersion: 'Choose a version that exists.' });
    document = JSON.parse(source.bundle) as SceneDocument;
  } else {
    document = await loadDocument(projectId);
  }

  const count = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM versions WHERE project_id = $1`,
    [projectId],
  );
  if (Number(count?.count ?? '0') >= config.publishLimit) {
    throw errors.limitReached(config.publishLimit);
  }

  const bundle = bundleBytes(document);
  const sha256 = createHash('sha256').update(bundle).digest('hex');
  const now = await serverNow();

  const number = await transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [projectId]);
    const highest = await client.query<{ number: number | null }>(
      `SELECT MAX(number) AS number FROM versions WHERE project_id = $1`,
      [projectId],
    );
    const next = (highest.rows[0]?.number ?? 0) + 1;
    await client.query(
      `INSERT INTO versions (project_id, number, status, published_at, published_by, sha256, bundle)
       VALUES ($1,$2,'publishing',$3,$4,$5,$6)`,
      [projectId, next, now.toISOString(), person.id, sha256, bundle.toString('utf8')],
    );
    return next;
  });

  try {
    const key = storageKeys.versionBundle(projectId, number);
    await putObject(key, bundle, 'application/json');
    const confirmed = await confirmObject(key, bundle.byteLength);
    if (!confirmed) throw new StorageUnavailable('bundle not confirmed');
  } catch (error) {
    await query(`DELETE FROM versions WHERE project_id = $1 AND number = $2`, [projectId, number]);
    if (error instanceof StorageUnavailable) {
      throw errors.storageUnavailable(MSG.storagePublishing);
    }
    throw error;
  }

  await transaction(async (client) => {
    await client.query(
      `UPDATE versions SET status = 'superseded' WHERE project_id = $1 AND status = 'live'`,
      [projectId],
    );
    await client.query(
      `UPDATE versions SET status = 'live' WHERE project_id = $1 AND number = $2`,
      [projectId, number],
    );
    const recipients = await client.query<{ email: string; role: string }>(
      `SELECT p.email, m.role FROM members m JOIN people p ON p.id = m.person_id
       WHERE m.project_id = $1 AND m.role IN ('Owner','Editor')`,
      [projectId],
    );
    for (const recipient of recipients.rows) {
      await enqueueMail(client, {
        kind: 'publish',
        toEmail: recipient.email,
        subject: `${projectName} version ${number} is live`,
        body: [
          `${person.name} published ${projectName} version ${number}.`,
          '',
          `Open the project: ${config.publicUrl}/projects/${projectId}`,
        ].join('\n'),
        projectId,
        versionNumber: number,
        inviteId: null,
      });
    }
  });

  broadcastVersion(projectId, number);
  await flushOutbox().catch(() => undefined);

  return {
    number,
    status: 'live',
    publishedAt: now.toISOString(),
    publishedBy: person.id,
    sha256,
  };
}

export async function liveVersion(
  projectId: string,
): Promise<{ number: number; bundle: string } | null> {
  return queryOne<{ number: number; bundle: string }>(
    `SELECT number, bundle FROM versions WHERE project_id = $1 AND status = 'live'
     ORDER BY number DESC LIMIT 1`,
    [projectId],
  );
}
