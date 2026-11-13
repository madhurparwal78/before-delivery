import { createHash } from 'node:crypto';
import {
  createGroup,
  createPage,
  groupsOfVersion,
  importOfVersion,
  pagesOfVersion,
  saveImport,
  setPageState,
  siteBySlug,
  tabsOfVersion,
  versionBySlug,
  type Group,
} from '../db/content';
import { newId } from '../db/ids';
import { withTx } from '../db/pool';
import { messages, readerMessages } from '../domain/messages';
import {
  findOperation,
  parseSpec,
  referenceSource,
  type Operation,
} from '../domain/openapi';
import { ApiError, apiError, validationFailed } from '../http/errors';
import {
  mediaType,
  OPENAPI_LIMIT,
  readBody,
  readJsonBody,
  sendBytes,
  sendJson,
  type Ctx,
} from '../http/http';
import { emitNavigation } from '../services/events';
import { getObject, openapiKey, putObject, StorageUnavailable } from '../services/storage';
import { loadVersion, requireUser, requireWriter } from './auth';
import { navigationDocument } from './documents';

const REFERENCE_GROUP = 'API reference';

export async function postImport(ctx: Ctx): Promise<void> {
  let bytes: Buffer;
  try {
    bytes = await readBody(ctx, OPENAPI_LIMIT);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'too_large') {
      throw apiError('too_large', messages.importTooLarge);
    }
    throw error;
  }
  if (mediaType(ctx) !== 'application/json') throw apiError('unsupported_media_type');
  const user = await requireUser(ctx);
  const { version, site } = await loadVersion(user, ctx.params.versionId);
  requireWriter(user);
  const spec = parseSpec(bytes);
  if (spec === null) throw apiError('invalid_openapi');
  const fileName = ctx.url.searchParams.get('name') ?? 'openapi.json';
  const importId = newId('import');
  const key = openapiKey(site.id, version.id, importId);
  try {
    await putObject(key, bytes, 'application/json');
  } catch (error) {
    if (!(error instanceof StorageUnavailable)) throw error;
    throw apiError('storage_unavailable', messages.importOutage);
  }

  const pages = await withTx(async (tx) => {
    const tabs = await tabsOfVersion(tx, version.id);
    const groups = await groupsOfVersion(tx, version.id);
    let group: Group | undefined = groups.find((candidate) => candidate.title === REFERENCE_GROUP);
    if (group === undefined) {
      group = await createGroup(tx, {
        versionId: version.id,
        tabId: tabs[tabs.length - 1].id,
        title: REFERENCE_GROUP,
      });
    }
    const existing = (await pagesOfVersion(tx, version.id)).filter(
      (page) => page.kind === 'reference' && page.groupId === group.id,
    );
    const created: { id: string; path: string; title: string; operationId: string }[] = [];
    for (const operation of spec.operations) {
      const previous = existing.find((page) => page.operationId === operation.operationId);
      const source = referenceSource(operation);
      if (previous === undefined) {
        const page = await createPage(tx, {
          versionId: version.id,
          groupId: group.id,
          path: `api/${operation.operationId}`,
          title: operation.summary,
          source,
          kind: 'reference',
          operationId: operation.operationId,
          updatedBy: user.id,
        });
        created.push({
          id: page.id,
          path: page.path,
          title: page.title,
          operationId: operation.operationId,
        });
        continue;
      }
      await tx.query(
        `UPDATE pages SET title = $2, source = $3, state = CASE WHEN state = 'removed' THEN 'draft' ELSE state END,
                          has_draft_changes = true, updated_at = now(), updated_by = $4
         WHERE id = $1`,
        [previous.id, operation.summary, source, user.id],
      );
      created.push({
        id: previous.id,
        path: previous.path,
        title: operation.summary,
        operationId: operation.operationId,
      });
    }
    for (const page of existing) {
      if (!spec.operations.some((operation) => operation.operationId === page.operationId)) {
        await setPageState(tx, page.id, 'removed');
      }
    }
    await saveImport(tx, {
      id: importId,
      versionId: version.id,
      groupId: group.id,
      fileName,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      objectKey: key,
      spec: JSON.parse(bytes.toString('utf8')) as unknown,
    });
    return { groupId: group.id, pages: created };
  });

  emitNavigation(version.id, await navigationDocument(version.id));
  sendJson(ctx, 201, { importId, groupId: pages.groupId, pages: pages.pages });
}

export async function getImportSource(ctx: Ctx): Promise<void> {
  const user = await requireUser(ctx);
  const { version } = await loadVersion(user, ctx.params.versionId);
  const imported = await importOfVersion(version.id);
  if (imported === null) throw apiError('not_found');
  try {
    const stored = await getObject(imported.objectKey);
    sendBytes(ctx, 200, stored.bytes, 'application/json', {
      'Content-Disposition': `attachment; filename="${imported.fileName}"`,
      'Cache-Control': 'no-store',
    });
  } catch (error) {
    if (!(error instanceof StorageUnavailable)) throw error;
    throw apiError('storage_unavailable');
  }
}

export async function getImportInfo(ctx: Ctx): Promise<void> {
  const user = await requireUser(ctx);
  const { version } = await loadVersion(user, ctx.params.versionId);
  const imported = await importOfVersion(version.id);
  if (imported === null) throw apiError('not_found');
  sendJson(ctx, 200, {
    importId: imported.id,
    fileName: imported.fileName,
    bytes: imported.bytes,
    sha256: imported.sha256,
    importedAt: imported.importedAt.toISOString(),
  });
}

async function operationOf(siteSlug: string, versionSlug: string, operationId: string): Promise<Operation> {
  const site = await siteBySlug(siteSlug);
  if (site === null) throw apiError('not_found');
  const version = await versionBySlug(site.id, versionSlug);
  if (version === null) throw apiError('not_found');
  const imported = await importOfVersion(version.id);
  if (imported === null) throw apiError('not_found');
  const spec = parseSpec(Buffer.from(JSON.stringify(imported.spec)));
  const operation = spec === null ? undefined : findOperation(spec, operationId);
  if (operation === undefined) throw apiError('not_found');
  return operation;
}

/** The mock route answers with the chosen documented code and that code's example. */
export async function postMock(ctx: Ctx): Promise<void> {
  const body = await readJsonBody(ctx);
  const operation = await operationOf(
    ctx.params.siteSlug,
    ctx.params.versionSlug,
    ctx.params.operationId,
  );
  const parameters = (body.parameters ?? {}) as Record<string, unknown>;
  const fields: Record<string, string> = {};
  for (const parameter of operation.parameters) {
    if (!parameter.required) continue;
    const value = parameters[parameter.name];
    if (typeof value !== 'string' || value.trim() === '') {
      fields[parameter.name] = readerMessages.requiredParameter(parameter.name);
    }
  }
  if (operation.hasRequestBody) {
    const text = typeof body.body === 'string' ? body.body : '';
    try {
      JSON.parse(text);
    } catch {
      fields.body = readerMessages.invalidBody;
    }
  }
  if (Object.keys(fields).length > 0) throw validationFailed(fields);
  const code = typeof body.code === 'number' ? body.code : 0;
  const response = operation.responses.find((candidate) => candidate.code === code);
  if (response === undefined) throw apiError('mock_unknown_code');
  sendJson(ctx, response.code, response.example);
}


