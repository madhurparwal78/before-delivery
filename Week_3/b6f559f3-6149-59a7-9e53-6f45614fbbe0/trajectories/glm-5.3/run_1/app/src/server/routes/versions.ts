// Versions: gapless, immutable publishing with storage confirmation,
// idempotency and one notice mail per owner and editor.
import { sendJson } from '../http';
import { notFound, forbidden, conflict, validationMessage, storageUnavailable } from '../errors';
import { COPY } from '../../domain/copy';
import type { RouteCtx } from '../routes';
import { requirePersonRoute, openProjectById } from '../store';
import { queueMail } from '../mailer';
import { createHash } from 'node:crypto';
import { formatDate, formatTime } from '../../domain/format';

export async function handleVersions(
  ctx: RouteCtx,
  projectId: string,
  sub: string,
): Promise<void> {
  if (sub === '' && ctx.method === 'GET') return listVersions(ctx, projectId);
  if (sub === '' && ctx.method === 'POST') return publish(ctx, projectId);
  const number = Number(sub);
  if (sub !== '' && sub === 'export') {
    // handled by the caller
  }
  if (!Number.isInteger(number)) throw notFound();
  throw notFound();
}

async function listVersions(ctx: RouteCtx, projectId: string): Promise<void> {
  const person = await requirePersonRoute(ctx);
  await openProjectById(ctx.app, ctx, projectId, person);
  const res = await ctx.app.pool.query<{
    number: number;
    status: string;
    published_at: Date;
    published_by: string;
    sha256: string;
  }>(
    `SELECT number, status, published_at, published_by, sha256
     FROM versions WHERE project_id = $1 ORDER BY number`,
    [projectId],
  );
  const versions = [];
  for (const row of res.rows) {
    const notices = await ctx.app.pool.query<{ status: string }>(
      `SELECT status FROM publish_notices WHERE project_id = $1 AND number = $2 LIMIT 1`,
      [projectId, row.number],
    );
    versions.push({
      number: row.number,
      status: row.status,
      publishedAt: row.published_at.toISOString(),
      publishedBy: row.published_by,
      sha256: row.sha256,
      notice: notices.rows[0]?.status ?? 'sent',
    });
  }
  sendJson(ctx.res, 200, { versions });
}

async function publish(ctx: RouteCtx, projectId: string): Promise<void> {
  const person = await requirePersonRoute(ctx);
  const { project, role } = await openProjectById(ctx.app, ctx, projectId, person);
  if (role !== 'Owner') throw forbidden(COPY.ownerPublish);
  const key = ctx.req.headers['idempotency-key'];
  if (!key || typeof key !== 'string' || key.length < 1 || key.length > 100) {
    throw validationMessage('Enter a name.', 'idempotencyKey');
  }
  const body = (ctx.body ?? {}) as { fromVersion?: number };
  const scope = `publish:${projectId}`;
  const bodyStr = JSON.stringify(body);

  // Idempotency: the same key with the same body returns the stored response.
  const stored = await ctx.app.pool.query<{ body_hash: string; response: Record<string, unknown> }>(
    `SELECT body_hash, response FROM idempotency WHERE scope = $1 AND key = $2`,
    [scope, key],
  );
  const hash = createHash('sha256').update(bodyStr).digest('hex');
  if (stored.rows[0]) {
    if (stored.rows[0].body_hash !== hash) {
      throw conflict('idempotency_conflict', COPY.idempotencyConflict);
    }
    sendJson(ctx.res, 201, stored.rows[0].response);
    return;
  }

  if (project.status === 'trashed') throw conflict('trashed', COPY.trashed);

  const fromVersion = body.fromVersion;
  let doc: unknown;
  if (fromVersion !== undefined) {
    const res = await ctx.app.pool.query<{ doc: unknown }>(
      `SELECT doc FROM versions WHERE project_id = $1 AND number = $2`,
      [projectId, fromVersion],
    );
    if (!res.rows[0]) throw validationMessage(COPY.notFound, 'fromVersion');
    doc = res.rows[0].doc;
  } else {
    const vars = await ctx.app.pool.query<{ variables: unknown; presets: unknown }>(
      `SELECT variables, presets FROM scenes WHERE project_id = $1 ORDER BY ord LIMIT 1`,
      [projectId],
    );
    const scenes = await ctx.app.pool.query<{ doc: unknown }>(
      `SELECT doc FROM scenes WHERE project_id = $1 ORDER BY ord`,
      [projectId],
    );
    doc = {
      schemaVersion: 3,
      name: project.name,
      variables: vars.rows[0]?.variables ?? [],
      presets: vars.rows[0]?.presets ?? [],
      scenes: scenes.rows.map((s) => s.doc),
    };
  }

  const count = await ctx.app.pool.query<{ count: string }>(
    `SELECT count(*) FROM versions WHERE project_id = $1`,
    [projectId],
  );
  if (Number(count.rows[0]!.count) >= ctx.app.cfg.publishLimit) {
    throw conflict('limit_reached', COPY.publishLimit(ctx.app.cfg.publishLimit));
  }

  // One unit: reserve the number, write the row, store the bundle, confirm,
  // then go live. Any failure rolls the whole thing back.
  const bundleBytes = Buffer.from(JSON.stringify(doc), 'utf8');
  const sha256 = createHash('sha256').update(bundleBytes).digest('hex');
  const nextRes = await ctx.app.pool.query<{ next: string }>(
    `SELECT max(number) + 1 AS next FROM versions WHERE project_id = $1`,
    [projectId],
  );
  const number = Number(nextRes.rows[0]?.next ?? 1) || 1;

  const objectKey = `projects/${projectId}/versions/${number}/scene.json`;
  try {
    await ctx.app.s3.putObject(objectKey, bundleBytes, 'application/json');
    const head = await ctx.app.s3.headObject(objectKey);
    if (!head || head.size !== bundleBytes.length) {
      throw new Error('confirm failed');
    }
  } catch {
    throw storageUnavailable(COPY.publishOutage);
  }

  const client = await ctx.app.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE versions SET status = 'superseded' WHERE project_id = $1 AND status = 'live'`,
      [projectId],
    );
    await client.query(
      `INSERT INTO versions (project_id, number, status, published_at, published_by, sha256, bundle, doc)
       VALUES ($1, $2, 'live', now(), $3, $4, $5, $6::jsonb)`,
      [projectId, number, person.id, sha256, bundleBytes, JSON.stringify(doc)],
    );
    // One notice per owner and editor, written with the version.
    const recipients = await client.query<{ person_id: string; email: string }>(
      `SELECT m.person_id, p.email FROM members m JOIN people p ON p.id = m.person_id
       WHERE m.project_id = $1 AND m.role IN ('Owner', 'Editor')`,
      [projectId],
    );
    for (const r of recipients.rows) {
      const outboxId = await queueMail(client, {
        to: r.email,
        subject: `${project.name} version ${number} is live`,
        body: `${person.name} published version ${number} of ${project.name}.\n\n${ctx.app.cfg.publicUrl}/projects/${projectId}`,
      });
      await client.query(
        `INSERT INTO publish_notices (project_id, number, person_id, outbox_id, status)
         VALUES ($1, $2, $3, $4, 'queued')`,
        [projectId, number, r.person_id, outboxId],
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    client.release();
    throw e;
  }
  client.release();

  // Send queued notices now; failures leave them queued.
  const { flushOutbox } = await import('../mailer');
  await flushOutbox(ctx.app.pool, ctx.app.cfg, ctx.app.instanceId).catch(() => undefined);

  const response = {
    version: {
      number,
      status: 'live',
      publishedAt: ctx.app.clock.nowIso(),
      publishedBy: person.id,
      sha256,
    },
  };
  await ctx.app.pool.query(
    `INSERT INTO idempotency (key, scope, body_hash, response, created_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (scope, key) DO NOTHING`,
    [key, scope, hash, JSON.stringify(response)],
  );
  sendJson(ctx.res, 201, response);
  ctx.hub.broadcastVersion(projectId, number);
}

export async function handleVersionExport(
  ctx: RouteCtx,
  projectId: string,
  number: number,
): Promise<void> {
  const person = await requirePersonRoute(ctx);
  await openProjectById(ctx.app, ctx, projectId, person);
  const res = await ctx.app.pool.query<{ bundle: Buffer }>(
    `SELECT bundle FROM versions WHERE project_id = $1 AND number = $2`,
    [projectId, number],
  );
  const row = res.rows[0];
  if (!row) throw notFound();
  ctx.res.writeHead(200, { 'content-type': 'application/json' });
  ctx.res.end(row.bundle);
}

export function formatWhen(app: import('../app').App, iso: string): string {
  return `${formatDate(iso, app.cfg.timeZone)} ${formatTime(iso, app.cfg.timeZone)}`;
}
