import type pg from 'pg';
import { ApiError } from '../../shared/errors.ts';
import type { Attachment, DocTopic, ExportFormat, OpsResponse } from '../../shared/model.ts';
import { parseOutline, previewOf, type OutlineParse } from '../../shared/outline.ts';
import { COPY, can, isClientId, noticeTooLarge } from '../../shared/rules.ts';
import {
  IMAGE_MIME,
  assertWithinQuota,
  attachmentKey,
  findAttachment,
  imageType,
  sha256Hex,
  storeAttachment,
} from '../attachments.ts';
import { requirePrincipal } from '../auth.ts';
import { clipBranches, clipOf, commitBranch, nextRank, outlineBranches, type Clip, type Placement } from '../branches.ts';
import { serverNow, toIso } from '../clock.ts';
import { config } from '../config.ts';
import { database, query, withMapLock } from '../db.ts';
import { FORMATS, createExport, exportKey, findExport, infoOf, isFormat, retryExport, type ExportRow } from '../exports.ts';
import { Effects } from '../groups.ts';
import { empty, json, route, type Ctx, type Principal, type Reply, type StageFn } from '../http.ts';
import { randomId } from '../ids.ts';
import { accessMap, loadMap, visibleDoc, type MapRow } from '../mapStore.ts';
import { getObject } from '../s3.ts';
import { OUTLINE_TYPE, STORAGE_DOWN, orUnavailable, putConfirmed } from '../storage.ts';
import { resolveMap, scopeOf } from './maps.ts';
import { storedResponse } from './ops.ts';

const person = (ctx: Ctx): Principal => {
  if (!ctx.principal) throw new ApiError('unauthenticated', 'Sign in to continue.');
  return ctx.principal;
};

/** The JSON body's fields without validating them: stages that run before validation read it loosely. */
const looseBody = (ctx: Ctx): Record<string, unknown> =>
  typeof ctx.body === 'object' && ctx.body !== null && !Array.isArray(ctx.body) ? (ctx.body as Record<string, unknown>) : {};

const invalid = (field: string, message: string): ApiError => new ApiError('invalid', message, { fields: { [field]: message } });

const mayEdit: StageFn = (ctx) => {
  if (!can(scopeOf(ctx).role, 'edit')) throw new ApiError('forbidden', COPY.read_only);
};

/** A stage that a replayed group skips: its stored answer is returned before any later check. */
const unlessReplayed =
  (stage: StageFn): StageFn =>
  (ctx) =>
    ctx.scope.replay ? undefined : stage(ctx);

async function lockedMap(client: pg.PoolClient, mapId: string): Promise<MapRow> {
  const map = await loadMap(client, mapId, true);
  if (!map) throw new ApiError('not_found', "We couldn't find that map.");
  return map;
}

// ------------------------------------------------------------------ attachments

const uploadOf = (ctx: Ctx): Attachment => ctx.scope.upload as Attachment;

route('POST', '/api/maps/:id/topics/:tid/attachments', {
  body: { raw: () => config.attachMaxBytes, message: noticeTooLarge },
  stages: {
    authenticate: requirePrincipal,
    resolve: async (ctx) => {
      await resolveMap(ctx);
      const { map, role } = scopeOf(ctx);
      if (!visibleDoc(map.doc, role).topics[ctx.params.tid ?? '']) throw new ApiError('not_found', COPY.missing_topic);
    },
    authorize: mayEdit,
    validate: (ctx) => {
      const type = imageType(ctx.bytes);
      if (type === null) throw new ApiError('wrong_type', COPY.wrong_type);
      ctx.scope.upload = { id: randomId(), sha256: sha256Hex(ctx.bytes), bytes: ctx.bytes.length, type } satisfies Attachment;
    },
    quota: (ctx) => assertWithinQuota(scopeOf(ctx).map.doc, [uploadOf(ctx)]),
  },
  handle: async (ctx) => {
    const { map, role } = scopeOf(ctx);
    const principal = person(ctx);
    const upload = uploadOf(ctx);
    const topicId = ctx.params.tid ?? '';
    const fx = new Effects();
    const stored = await withMapLock(map.id, async (client) => {
      const fresh = await lockedMap(client, map.id);
      const topic = fresh.doc.topics[topicId];
      if (!topic) throw new ApiError('not_found', COPY.missing_topic);
      assertWithinQuota(fresh.doc, [upload]);
      const written = await storeAttachment(client, map.id, topicId, upload, () =>
        putConfirmed(attachmentKey(map.id, upload), ctx.bytes, IMAGE_MIME[upload.type]),
      );
      if (!written) return false;
      await commitBranch({
        client,
        map: fresh,
        principal,
        role,
        fx,
        origin: 'edit',
        groupId: `attach-${randomId(14)}`,
        base: fresh.revision,
        placement: { topics: [{ ...topic, attachments: [...topic.attachments, upload] }], links: [] },
        sentence: `${principal.name} attached an image to ${topic.title}`,
      });
      return true;
    });
    if (!stored) throw new ApiError('storage_unavailable', COPY.storage_upload);
    fx.run();
    return json(201, { attachment: { ...upload, state: 'stored' } });
  },
});

/** Find the attachment among the topics the caller can see; anything else does not exist for them. */
const locateAttachment: StageFn = async (ctx) => {
  const rows = await query<{ map_id: string }>(database(), 'SELECT map_id FROM attachments WHERE id = $1', [ctx.params.id]);
  const row = rows[0];
  if (!row) throw new ApiError('not_found', "We couldn't find that image.");
  ctx.scope.access = await accessMap(database(), row.map_id, person(ctx));
  const { map, role } = scopeOf(ctx);
  const found = findAttachment(visibleDoc(map.doc, role), ctx.params.id ?? '');
  if (!found) throw new ApiError('not_found', "We couldn't find that image.");
  ctx.scope.attachment = found.attachment;
};

route('GET', '/api/attachments/:id', {
  stages: { authenticate: requirePrincipal, resolve: locateAttachment },
  handle: async (ctx) => {
    const attachment = ctx.scope.attachment as Attachment;
    const bytes = await orUnavailable(() => getObject(attachmentKey(scopeOf(ctx).map.id, attachment)), STORAGE_DOWN);
    return { status: 200, bytes, headers: { 'content-type': IMAGE_MIME[attachment.type] } };
  },
});

route('DELETE', '/api/attachments/:id', {
  stages: { authenticate: requirePrincipal, resolve: locateAttachment, authorize: mayEdit },
  handle: async (ctx) => {
    const { map, role } = scopeOf(ctx);
    const principal = person(ctx);
    const fx = new Effects();
    await withMapLock(map.id, async (client) => {
      const fresh = await lockedMap(client, map.id);
      const found = findAttachment(fresh.doc, ctx.params.id ?? '');
      if (!found) throw new ApiError('not_found', "We couldn't find that image.");
      await commitBranch({
        client,
        map: fresh,
        principal,
        role,
        fx,
        origin: 'edit',
        groupId: `detach-${randomId(14)}`,
        base: fresh.revision,
        placement: { topics: [{ ...found.topic, attachments: found.topic.attachments.filter((a) => a.id !== found.attachment.id) }], links: [] },
        sentence: `${principal.name} removed an image from ${found.topic.title}`,
      });
    });
    fx.run();
    return empty();
  },
});

// -------------------------------------------------------------- imports and graft

const importKey = (mapId: string, sha256: string): string => `imports/${mapId}/${sha256}.sprig.txt`;

function outlineOf(bytes: Uint8Array): OutlineParse {
  const parsed = parseOutline(bytes);
  if (Array.isArray(parsed)) throw new ApiError('invalid_outline', "This file can't be imported:", { lines: parsed });
  return parsed;
}

route('POST', '/api/maps/:id/imports', {
  body: { raw: () => config.outlineMaxBytes },
  stages: { authenticate: requirePrincipal, resolve: resolveMap, authorize: mayEdit },
  handle: async (ctx) => {
    const { map } = scopeOf(ctx);
    const sha256 = sha256Hex(ctx.bytes);
    await orUnavailable(() => putConfirmed(importKey(map.id, sha256), ctx.bytes, OUTLINE_TYPE), COPY.storage_upload);
    const parsed = outlineOf(ctx.bytes);
    const id = randomId();
    await query(database(), 'INSERT INTO imports (id, map_id, sha256, bytes, topic_count, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [
      id,
      map.id,
      sha256,
      ctx.bytes.length,
      parsed.count,
      toIso(serverNow()),
    ]);
    return json(201, { import: { id, sha256, bytes: ctx.bytes.length, topic_count: parsed.count }, preview: previewOf(parsed.roots) });
  },
});

interface Target {
  parent_id: string;
  group_id: string;
  base_revision: number;
}

const targetOf = (ctx: Ctx): Target => ctx.scope.target as Target;

/** Resolve stage for grafts and pastes: the parent must be a topic the caller can see. */
const parentVisible = (ctx: Ctx): void => {
  const parent = looseBody(ctx).parent_id;
  const { map, role } = scopeOf(ctx);
  if (typeof parent === 'string' && !visibleDoc(map.doc, role).topics[parent]) throw new ApiError('not_found', COPY.missing_topic);
};

const replayStage: StageFn = async (ctx) => {
  const groupId = looseBody(ctx).group_id;
  if (typeof groupId !== 'string') return;
  const stored = await storedResponse(database(), ctx.params.id ?? '', groupId, []);
  if (stored) ctx.scope.replay = stored;
};

const validateTarget: StageFn = (ctx) => {
  const { parent_id, group_id, base_revision } = looseBody(ctx);
  if (!isClientId(group_id)) throw invalid('group_id', 'group_id must be 1 to 40 letters, digits, _ or -.');
  if (typeof parent_id !== 'string') throw invalid('parent_id', 'parent_id must name a topic.');
  if (typeof base_revision !== 'number' || !Number.isInteger(base_revision) || base_revision < 0) throw invalid('base_revision', 'base_revision must be a whole number.');
  ctx.scope.target = { parent_id, group_id, base_revision } satisfies Target;
};

const VERB = { graft: 'imported', paste: 'pasted' } as const;

/**
 * Add a placement as the last children of the target topic in one group, answering a repeated group id with
 * its stored response. The builder returns null when storage was down; nothing is then added.
 */
async function placeUnder(
  ctx: Ctx,
  origin: keyof typeof VERB,
  build: (map: MapRow, parent: DocTopic, client: pg.PoolClient) => Promise<Placement | null>,
): Promise<Reply> {
  const replay = ctx.scope.replay as OpsResponse | undefined;
  if (replay) return json(200, { ...replay, replayed: true });
  const { map, role } = scopeOf(ctx);
  const principal = person(ctx);
  const target = targetOf(ctx);
  const fx = new Effects();
  const response = await withMapLock(map.id, async (client) => {
    const again = await storedResponse(client, map.id, target.group_id, []);
    if (again) return { ...again, replayed: true };
    const fresh = await lockedMap(client, map.id);
    const parent = fresh.doc.topics[target.parent_id];
    if (!parent) throw new ApiError('not_found', COPY.missing_topic);
    const placement = await build(fresh, parent, client);
    if (!placement) return null;
    return commitBranch({
      client,
      map: fresh,
      principal,
      role,
      fx,
      origin,
      groupId: target.group_id,
      base: target.base_revision,
      placement,
      sentence: `${principal.name} ${VERB[origin]} ${placement.topics.length} topics under ${parent.title}`,
    });
  });
  if (!response) throw new ApiError('storage_unavailable', COPY.storage_upload);
  fx.run();
  return json(200, response);
}

interface ImportRow {
  sha256: string;
}

route('POST', '/api/maps/:id/imports/:iid/graft', {
  body: 'json',
  stages: {
    authenticate: requirePrincipal,
    resolve: async (ctx) => {
      await resolveMap(ctx);
      const rows = await query<ImportRow>(database(), 'SELECT sha256 FROM imports WHERE id = $1 AND map_id = $2', [ctx.params.iid, ctx.params.id]);
      if (!rows[0]) throw new ApiError('not_found', "We couldn't find that import.");
      ctx.scope.imported = rows[0];
      parentVisible(ctx);
    },
    replay: replayStage,
    authorize: unlessReplayed(mayEdit),
    validate: unlessReplayed(validateTarget),
    services: unlessReplayed(async (ctx) => {
      const imported = ctx.scope.imported as ImportRow;
      const bytes = await orUnavailable(() => getObject(importKey(scopeOf(ctx).map.id, imported.sha256)), COPY.storage_upload);
      ctx.scope.outline = outlineOf(bytes);
    }),
  },
  handle: (ctx) =>
    placeUnder(ctx, 'graft', async (map, parent) => outlineBranches((ctx.scope.outline as OutlineParse).roots, parent.id, nextRank(map.doc, parent.id))),
});

// ------------------------------------------------------------ clipboard and paste

route('POST', '/api/clipboard', {
  body: 'json',
  stages: {
    authenticate: requirePrincipal,
    resolve: async (ctx) => {
      const { map_id, topic_ids } = looseBody(ctx);
      if (typeof map_id !== 'string') return;
      ctx.scope.access = await accessMap(database(), map_id, person(ctx));
      const { map, role } = scopeOf(ctx);
      const visible = visibleDoc(map.doc, role);
      if (Array.isArray(topic_ids) && topic_ids.some((id) => typeof id === 'string' && !visible.topics[id])) {
        throw new ApiError('not_found', COPY.missing_topic);
      }
    },
    validate: (ctx) => {
      const { map_id, topic_ids } = looseBody(ctx);
      if (typeof map_id !== 'string') throw invalid('map_id', 'map_id must name a map.');
      if (!Array.isArray(topic_ids) || topic_ids.length === 0 || !topic_ids.every((id): id is string => typeof id === 'string')) {
        throw invalid('topic_ids', 'topic_ids must list at least one topic.');
      }
      ctx.scope.topicIds = topic_ids;
    },
  },
  handle: async (ctx) => {
    const { map, role } = scopeOf(ctx);
    const clip = clipOf(visibleDoc(map.doc, role), map.id, ctx.scope.topicIds as string[]);
    await query(database(), 'INSERT INTO clipboards (user_id, payload) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET payload = EXCLUDED.payload', [
      person(ctx).id,
      JSON.stringify(clip),
    ]);
    return json(200, { topics: clip.topics.length });
  },
});

const clipOfRequest = (ctx: Ctx): Clip => ctx.scope.clip as Clip;

route('POST', '/api/maps/:id/paste', {
  body: 'json',
  stages: {
    authenticate: requirePrincipal,
    resolve: async (ctx) => {
      await resolveMap(ctx);
      parentVisible(ctx);
    },
    replay: replayStage,
    authorize: unlessReplayed(mayEdit),
    state: unlessReplayed(async (ctx) => {
      const rows = await query<{ payload: Clip }>(database(), 'SELECT payload FROM clipboards WHERE user_id = $1', [person(ctx).id]);
      if (!rows[0]) throw new ApiError('clipboard_empty', COPY.nothing_paste);
      ctx.scope.clip = rows[0].payload;
    }),
    validate: unlessReplayed(validateTarget),
    quota: unlessReplayed((ctx) => assertWithinQuota(scopeOf(ctx).map.doc, clipOfRequest(ctx).topics.flatMap((t) => t.attachments))),
  },
  handle: (ctx) =>
    placeUnder(ctx, 'paste', async (map, parent, client) => {
      const clip = clipOfRequest(ctx);
      const placement = clipBranches(clip, parent.id, nextRank(map.doc, parent.id));
      // The quota is checked again under the map lock, so two pastes cannot both fit.
      assertWithinQuota(map.doc, placement.topics.flatMap((t) => t.attachments));
      for (const topic of placement.topics) {
        for (const attachment of topic.attachments) {
          const copied = await storeAttachment(client, map.id, topic.id, attachment, async () => {
            const bytes = await getObject(attachmentKey(clip.map_id, attachment));
            await putConfirmed(attachmentKey(map.id, attachment), bytes, IMAGE_MIME[attachment.type]);
          });
          if (!copied) return null;
        }
      }
      return placement;
    }),
});

// ----------------------------------------------------------------------- exports

interface ExportRequest {
  format: ExportFormat;
  topic_id: string | null;
}

route('POST', '/api/maps/:id/exports', {
  body: 'json',
  stages: {
    authenticate: requirePrincipal,
    resolve: async (ctx) => {
      await resolveMap(ctx);
      const topic = looseBody(ctx).topic_id;
      const { map, role } = scopeOf(ctx);
      if (typeof topic === 'string' && !visibleDoc(map.doc, role).topics[topic]) throw new ApiError('not_found', COPY.missing_topic);
    },
    validate: (ctx) => {
      const { format, topic_id = null } = looseBody(ctx);
      if (!isFormat(format)) throw invalid('format', 'format must be sprig or svg.');
      if (topic_id !== null && typeof topic_id !== 'string') throw invalid('topic_id', 'topic_id must be a topic id or null.');
      ctx.scope.request = { format, topic_id } satisfies ExportRequest;
    },
  },
  handle: async (ctx) => {
    const request = ctx.scope.request as ExportRequest;
    return json(202, { export: await createExport(scopeOf(ctx).map.id, person(ctx).id, request.format, request.topic_id) });
  },
});

/** An export belongs to the person who started it; anyone else, or someone who lost the map, does not see it. */
const resolveExport: StageFn = async (ctx) => {
  const principal = person(ctx);
  const job = await findExport(ctx.params.id ?? '');
  if (!job || job.user_id !== principal.id) throw new ApiError('not_found', "We couldn't find that export.");
  ctx.scope.access = await accessMap(database(), job.map_id, principal);
  ctx.scope.job = job;
};

const jobOf = (ctx: Ctx): ExportRow => ctx.scope.job as ExportRow;

route('GET', '/api/exports/:id', {
  stages: { authenticate: requirePrincipal, resolve: resolveExport },
  handle: async (ctx) => json(200, { export: infoOf(jobOf(ctx)) }),
});

route('POST', '/api/exports/:id/retry', {
  stages: { authenticate: requirePrincipal, resolve: resolveExport },
  handle: async (ctx) => json(202, { export: await retryExport(jobOf(ctx)) }),
});

/** A Content-Disposition value naming the file, with an ASCII fallback and the full name encoded for clients that read it. */
const attachmentHeader = (name: string): string => {
  const plain = name.replace(/[^\x20-\x7e]|["\\%]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${plain}"; filename*=UTF-8''${encoded}`;
};

route('GET', '/api/exports/:id/download', {
  stages: {
    authenticate: requirePrincipal,
    resolve: resolveExport,
    state: (ctx) => {
      if (jobOf(ctx).state !== 'ready') throw new ApiError('not_ready', 'The export is not ready yet.');
    },
  },
  handle: async (ctx) => {
    const job = jobOf(ctx);
    const bytes = await orUnavailable(() => getObject(exportKey(job)), STORAGE_DOWN);
    const { contentType, extension } = FORMATS[job.format];
    return { status: 200, bytes, headers: { 'content-type': contentType, 'content-disposition': attachmentHeader(`${scopeOf(ctx).map.title}.${extension}`) } };
  },
});
