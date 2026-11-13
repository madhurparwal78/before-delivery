import { randomUUID } from 'node:crypto';
import type { Bundle } from '../../shared/types.js';
import { isUniqueViolation, query, transaction } from '../db.js';
import { manifestRef } from '../domain/diff.js';
import { errors, fieldMessages } from '../errors.js';
import { bundleKey } from '../evidence.js';
import { membership, requireRole } from '../http/access.js';
import type { Ctx, Reply, Route } from '../http/types.js';
import { shortDigest } from '../repo.js';
import { bundleObjectBytes, digestOf, resourcesOf } from '../seed.js';
import { recordObject } from '../services/queues.js';
import { StorageUnreachable, putObject } from '../services/storage.js';
import { FieldErrors } from '../validate.js';

export const BUNDLE_BODY_LIMIT = 1_000_000;

const VERSION = /^[A-Za-z0-9.+-]{1,64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const RESOURCE_NAME = /^[a-z0-9.-]{1,253}$/;

function readManifests(value: unknown, fields: FieldErrors): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 200) {
    fields.add('manifests', fieldMessages.manifestShape);
    return [];
  }
  const manifests: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      fields.add('manifests', fieldMessages.manifestShape);
      return [];
    }
    const manifest = raw as Record<string, unknown>;
    const metadata = manifest.metadata;
    const named =
      typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>)
        : null;
    const name = named?.name;
    const namespace = named?.namespace;
    if (
      typeof manifest.apiVersion !== 'string' ||
      manifest.apiVersion === '' ||
      typeof manifest.kind !== 'string' ||
      manifest.kind === '' ||
      typeof name !== 'string' ||
      !RESOURCE_NAME.test(name) ||
      (namespace !== undefined && (typeof namespace !== 'string' || !RESOURCE_NAME.test(namespace)))
    ) {
      fields.add('manifests', fieldMessages.manifestShape);
      return [];
    }
    const ref = manifestRef(manifest);
    if (seen.has(ref)) {
      fields.add('manifests', fieldMessages.duplicateResource(ref));
      return [];
    }
    seen.add(ref);
    manifests.push(manifest);
  }
  return manifests;
}

/**
 * Stores the rendered manifests under the SHA-256 of the stored bytes before recording anything,
 * so a bundle never exists in the database without its object.
 */
async function ingestBundle(ctx: Ctx): Promise<Reply> {
  const { project, role } = await membership(ctx);
  requireRole(role, 'ingest_bundle');
  const fields = new FieldErrors();

  const version = typeof ctx.body.version === 'string' ? ctx.body.version : '';
  if (!VERSION.test(version)) fields.add('version', fieldMessages.version);
  const sourceCommit = typeof ctx.body.source_commit === 'string' ? ctx.body.source_commit : '';
  if (!COMMIT.test(sourceCommit)) fields.add('source_commit', fieldMessages.sourceCommit);
  const manifests = readManifests(ctx.body.manifests, fields);
  fields.throwIfAny();

  const existing = await query<{ version: string }>(
    'SELECT version FROM bundles WHERE project_id = $1 AND version = $2',
    [project.id, version],
  );
  if (existing.length > 0) throw errors.versionExists(version);

  const bytes = bundleObjectBytes(version, sourceCommit, manifests);
  const digest = digestOf(bytes);
  const objectKey = bundleKey(project.slug, digest);
  try {
    await putObject(objectKey, bytes);
  } catch (cause) {
    if (cause instanceof StorageUnreachable) throw errors.storageUnavailable();
    throw cause;
  }

  const resources = resourcesOf(manifests);
  const id = randomUUID();
  const person = ctx.person;
  if (!person) throw errors.unauthenticated();

  try {
    await transaction(async (tx) => {
      await tx.query(
        `INSERT INTO bundles
           (id, project_id, version, digest, source_commit, manifests, resources, ingested_at, ingested_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now(), $8)`,
        [
          id,
          project.id,
          version,
          digest,
          sourceCommit,
          JSON.stringify(manifests),
          JSON.stringify(resources),
          person.id,
        ],
      );
      await recordObject(tx, {
        objectKey,
        body: bytes,
        promotionId: null,
        snapshotNumber: null,
        stored: true,
      });
    });
  } catch (cause) {
    if (isUniqueViolation(cause)) throw errors.versionExists(version);
    throw cause;
  }

  const stored = await query<{ ingested_at: Date }>('SELECT ingested_at FROM bundles WHERE id = $1', [id]);
  const bundle: Bundle = {
    id,
    version,
    digest,
    short_digest: shortDigest(digest),
    source_commit: sourceCommit,
    resources,
    ingested_at: (stored[0]?.ingested_at ?? new Date()).toISOString(),
    ingested_by: person.email,
    verified_in: [],
  };
  return { status: 201, json: bundle };
}

async function listBundles(ctx: Ctx): Promise<Reply> {
  const { project } = await membership(ctx);
  const rows = await query<{
    id: string;
    version: string;
    digest: string;
    source_commit: string;
    resources: Bundle['resources'];
    ingested_at: Date;
    ingested_by: string;
    verified_in: string[];
  }>(
    `SELECT b.id, b.version, b.digest, b.source_commit, b.resources, b.ingested_at,
            who.email AS ingested_by,
            coalesce((
              SELECT array_agg(DISTINCT s.name ORDER BY s.name)
              FROM promotions p
              JOIN promotion_history h ON h.promotion_id = p.id AND h.to_state = 'healthy'
              JOIN stages s ON s.id = p.stage_id
              WHERE p.bundle_id = b.id
            ), '{}') AS verified_in
     FROM bundles b
     JOIN people who ON who.id = b.ingested_by
     WHERE b.project_id = $1
     ORDER BY b.ingested_at DESC, b.version DESC`,
    [project.id],
  );

  const bundles: Bundle[] = rows.map((row) => ({
    id: row.id,
    version: row.version,
    digest: row.digest,
    short_digest: shortDigest(row.digest),
    source_commit: row.source_commit,
    resources: row.resources,
    ingested_at: row.ingested_at.toISOString(),
    ingested_by: row.ingested_by,
    verified_in: row.verified_in,
  }));
  return { status: 200, json: { bundles } };
}

export const bundleRoutes: Route[] = [
  {
    method: 'POST',
    template: '/api/projects/:project/bundles',
    access: 'session',
    bodyLimit: BUNDLE_BODY_LIMIT,
    handler: ingestBundle,
  },
  { method: 'GET', template: '/api/projects/:project/bundles', access: 'session', handler: listBundles },
];
