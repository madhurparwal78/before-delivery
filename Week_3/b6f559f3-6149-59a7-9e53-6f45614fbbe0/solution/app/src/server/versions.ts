/** Numbered, immutable versions: publishing as one unit, the version list and exports. */
import { createHash } from 'node:crypto';
import { MESSAGES, publishLimit } from '../shared/messages';
import type { VersionInfo } from '../shared/types';
import { assertActive, openProject, refuseTrashed, requireOwner } from './access';
import { now } from './clock';
import { config } from './config';
import { query, transaction } from './db';
import { loadDocument } from './documents';
import { announceVersion } from './hub';
import { fail, invalid, json, notFound, router, storageDown, type Ctx, type Reply } from './http';
import { fingerprint, rememberReply, storedReply } from './idempotency';
import { deliverNow, enqueue, publishMail, queuedMailSql } from './outbox';
import { bundleKey, StorageUnavailable } from './s3';
import { storage } from './services';

interface PublishInput {
  projectId: string;
  publishedBy: string;
  /** Republish this version's stored bundle; checked inside the publish, after the state checks. */
  fromVersion?: unknown;
  /** The Idempotency-Key of the request and the fingerprint of its body. */
  idempotency?: { key: string; hash: string };
}

interface PublishedVersion {
  number: number;
  status: 'live';
  publishedAt: string;
  publishedBy: string;
  sha256: string;
}

interface VersionRow {
  number: number;
  status: VersionInfo['status'];
  sha256: string;
  published_at: Date;
  published_by: string;
  queued: boolean;
}

const sha256Of = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

const idempotencyScope = (projectId: string): string => `publish:${projectId}`;

/**
 * The publish unit, in one transaction: replay a repeated key, reserve the next number, store and confirm the bundle,
 * go live (the previous live version becomes superseded), record the key and queue the notices. Anything that fails
 * rolls everything back, leaving no gap in the numbering.
 */
export async function publishVersion(input: PublishInput): Promise<{ version: PublishedVersion; replayed: boolean }> {
  let mailIds: number[] = [];
  let storedKey: string | null = null;
  try {
    const published = await transaction(async (client) => {
      const { idempotency } = input;
      if (idempotency) {
        const stored = await storedReply(client, idempotencyScope(input.projectId), idempotency.key, idempotency.hash);
        if (stored) return { version: (stored.body as { version: PublishedVersion }).version, replayed: true };
      }
      await assertActive(client, input.projectId);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`publish:${input.projectId}`]);
      let source: Buffer | null = null;
      if (input.fromVersion !== undefined) {
        const found = Number.isInteger(input.fromVersion)
          ? await client.query<{ bundle: Buffer }>('SELECT bundle FROM versions WHERE project_id = $1 AND number = $2', [input.projectId, input.fromVersion])
          : null;
        if (!found?.rows[0]) return invalid('fromVersion', MESSAGES.invalidValue);
        source = found.rows[0].bundle;
      }
      const summary = (await client.query<{ count: string; highest: number | null }>(
        'SELECT count(*) AS count, max(number) AS highest FROM versions WHERE project_id = $1',
        [input.projectId],
      )).rows[0] as { count: string; highest: number | null };
      if (Number(summary.count) >= config.publishLimit) fail(409, 'limit_reached', publishLimit(config.publishLimit));
      const number = (summary.highest ?? 0) + 1;
      const bundle = source ?? Buffer.from(JSON.stringify((await loadDocument(client, input.projectId)).document));
      const sha256 = sha256Of(bundle);
      const at = await now(client);
      const key = bundleKey(input.projectId, number);
      try {
        await storage.put(key, bundle, 'application/json');
        storedKey = key;
        const head = await storage.head(key);
        if (!head || head.size !== bundle.length) throw new StorageUnavailable('bundle not confirmed');
      } catch (error) {
        if (error instanceof StorageUnavailable) return storageDown(MESSAGES.storagePublish);
        throw error;
      }
      await client.query(`UPDATE versions SET status = 'superseded' WHERE project_id = $1 AND status = 'live'`, [input.projectId]);
      await client.query(
        `INSERT INTO versions (project_id, number, status, document, bundle, sha256, published_by, published_at)
         VALUES ($1, $2, 'live', $3, $4, $5, $6, $7)`,
        [input.projectId, number, bundle.toString('utf8'), bundle, sha256, input.publishedBy, at.toISOString()],
      );
      const project = (await client.query<{ name: string }>('SELECT name FROM projects WHERE id = $1', [input.projectId])).rows[0] as { name: string };
      const publisher = (await client.query<{ name: string }>('SELECT name FROM people WHERE id = $1', [input.publishedBy])).rows[0] as { name: string };
      const recipients = await client.query<{ email: string }>(
        `SELECT p.email FROM members m JOIN people p ON p.id = m.person_id WHERE m.project_id = $1 AND m.role IN ('Owner', 'Editor') ORDER BY p.email`,
        [input.projectId],
      );
      mailIds = await enqueue(
        client,
        recipients.rows.map((r) => publishMail({ projectId: input.projectId, projectName: project.name, version: number, publisher: publisher.name, to: r.email })),
      );
      const version: PublishedVersion = { number, status: 'live', publishedAt: at.toISOString(), publishedBy: publisher.name, sha256 };
      if (idempotency) await rememberReply(client, idempotencyScope(input.projectId), idempotency.key, idempotency.hash, json(201, { version }));
      return { version, replayed: false };
    });
    if (!published.replayed) {
      announceVersion(input.projectId, published.version.number);
      await deliverNow(mailIds);
    }
    return published;
  } catch (error) {
    if (storedKey) await storage.delete(storedKey).catch(() => undefined);
    throw error;
  }
}

async function postVersion(ctx: Ctx): Promise<Reply> {
  const { person, project } = await openProject(ctx, ctx.param('id'));
  requireOwner(project, MESSAGES.publishRefusal);
  const key = ctx.header('idempotency-key');
  const raw = await ctx.jsonObject();
  if (key === undefined || key.length < 1 || key.length > 100) {
    refuseTrashed(project.status);
    return invalid('Idempotency-Key', MESSAGES.invalidValue);
  }
  const { version } = await publishVersion({
    projectId: project.id,
    publishedBy: person.id,
    fromVersion: raw['fromVersion'],
    idempotency: { key, hash: fingerprint('POST', ctx.path, raw) },
  });
  return json(201, { version });
}

async function listVersions(ctx: Ctx): Promise<Reply> {
  const { project } = await openProject(ctx, ctx.param('id'));
  const rows = await query<VersionRow>(
    `SELECT v.number, v.status, v.sha256, v.published_at, p.name AS published_by,
            ${queuedMailSql('publish', 'v.number::text', 'v.project_id')} AS queued
     FROM versions v JOIN people p ON p.id = v.published_by WHERE v.project_id = $1 ORDER BY v.number DESC`,
    [project.id],
  );
  const versions: VersionInfo[] = rows.map((row) => ({
    number: row.number,
    status: row.status,
    publishedAt: row.published_at.toISOString(),
    publishedBy: row.published_by,
    sha256: row.sha256,
    notice: row.queued ? 'queued' : 'sent',
  }));
  return json(200, { versions });
}

async function exportVersion(ctx: Ctx): Promise<Reply> {
  const { project } = await openProject(ctx, ctx.param('id'));
  const number = Number(ctx.param('n'));
  const rows = Number.isInteger(number) ? await query<{ bundle: Buffer }>('SELECT bundle FROM versions WHERE project_id = $1 AND number = $2', [project.id, number]) : [];
  const row = rows[0] ?? notFound();
  return { status: 200, raw: row.bundle, contentType: 'application/json' };
}

async function immutable(ctx: Ctx): Promise<Reply> {
  await openProject(ctx, ctx.param('id'));
  return fail(405, 'immutable', MESSAGES.immutable);
}

export function registerVersionRoutes(): void {
  router.post('/api/projects/:id/versions', postVersion);
  router.get('/api/projects/:id/versions', listVersions);
  router.get('/api/projects/:id/versions/:n/export', exportVersion);
  for (const method of ['PUT', 'PATCH', 'DELETE']) router.route(method, '/api/projects/:id/versions/:n', immutable);
}
