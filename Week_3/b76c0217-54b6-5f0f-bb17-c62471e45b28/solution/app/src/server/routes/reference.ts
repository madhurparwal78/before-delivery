import { createHash } from 'node:crypto';
import { copy } from '../../shared/copy';
import type { ImportResult, OpenApiMeta } from '../../shared/types';
import { db, transaction } from '../db';
import { fail } from '../errors';
import { emit } from '../events';
import { endpoint, reply } from '../http';
import { newId } from '../ids';
import { Fields } from '../input';
import { latestImport } from '../domain/reference';
import { addGroup, addTab, loadNavigation, lockVersion } from '../domain/navigation';
import { InvalidOpenApiError, parseOpenApi, referenceSource, type Operation } from '../domain/openapi';
import { insertPage, loadPage, pageJson, removePage, requirePage, writePage } from '../domain/pages';
import { versionScope } from '../domain/scopes';
import { getObject, putObject, StorageUnavailableError } from '../storage';

const GROUP_TITLE = 'API reference';

export function referenceRoutes(): void {
  endpoint('POST', '/api/versions/:versionId/openapi', {
    access: 'editor',
    body: 'openapi',
    prepare: (ctx) => versionScope(ctx.principal, ctx.params.versionId ?? ''),
    handle: async (ctx, version) => {
      const fields = new Fields({ name: ctx.url.searchParams.get('name') ?? '' });
      const fileName = fields.text('name', 200).replace(/["\\\r\n]/g, '_');
      fields.check();
      const text = ctx.raw.toString('utf8');
      let operations: Operation[];
      try {
        operations = parseOpenApi(text);
      } catch (error) {
        throw error instanceof InvalidOpenApiError ? fail.invalidOpenapi() : error;
      }
      const importId = newId('imp');
      const key = `sites/${version.siteId}/versions/${version.id}/openapi/${importId}.json`;
      try {
        await putObject(key, ctx.raw, 'application/json');
      } catch (error) {
        throw error instanceof StorageUnavailableError ? fail.storageUnavailable(copy.importOutage) : error;
      }
      const userId = ctx.principal.user.id;
      const result = await transaction(async (tx) => {
        await lockVersion(tx, version.id);
        await tx.query(
          'insert into openapi_imports (id, version_id, file_name, bytes, sha256, s3_key, document) values ($1, $2, $3, $4, $5, $6, $7)',
          [importId, version.id, fileName, ctx.raw.length, createHash('sha256').update(ctx.raw).digest('hex'), key, text],
        );
        const navigation = await loadNavigation(tx, version.id);
        const existing = navigation.tabs.flatMap((tab) => tab.groups).find((group) => group.title === GROUP_TITLE);
        const lastTab = navigation.tabs[navigation.tabs.length - 1];
        const groupId = existing?.id ?? (await addGroup(tx, version.id, lastTab?.id ?? (await addTab(tx, version.id, GROUP_TITLE)), GROUP_TITLE));
        const current = await tx.query<{ id: string; path: string; title: string; source: string; operationId: string | null }>(
          'select id, path, title, source, operation_id from pages where version_id = $1 and not removed and operation_id is not null',
          [version.id],
        );
        const wanted = new Set(operations.map((operation) => operation.operationId));
        for (const stale of current.filter((page) => !wanted.has(page.operationId ?? ''))) {
          await removePage(tx, await requirePage(tx, stale.id));
        }
        const pages: ImportResult['pages'] = [];
        for (const [position, operation] of operations.entries()) {
          const source = referenceSource(operation);
          const match = current.find((page) => page.operationId === operation.operationId);
          let id = match?.id;
          const path = match?.path ?? `api/${operation.operationId}`;
          if (match === undefined) {
            id = await insertPage(tx, { versionId: version.id, groupId, path, title: operation.summary, source, userId, kind: 'reference', operationId: operation.operationId });
          } else {
            if (match.title !== operation.summary || match.source !== source) {
              await writePage(tx, match.id, { path: match.path, title: operation.summary, source, userId });
            }
            await tx.query('update pages set group_id = $2 where id = $1', [match.id, groupId]);
          }
          await tx.query('update pages set position = $2 where id = $1', [id, position]);
          pages.push({ id: id as string, path, title: operation.summary, operationId: operation.operationId });
        }
        return { importId, groupId, pages } satisfies ImportResult;
      });
      emit('navigation', await loadNavigation(db, version.id), { versionId: version.id });
      for (const page of result.pages) {
        const row = await loadPage(db, page.id);
        if (row !== null) {
          emit('page', pageJson(row), { versionId: version.id, pageId: page.id });
        }
      }
      return reply.json(201, result);
    },
  });

  endpoint('GET', '/api/versions/:versionId/openapi', {
    access: 'member',
    prepare: (ctx) => versionScope(ctx.principal, ctx.params.versionId ?? ''),
    handle: async (_ctx, version) => {
      const row = await latestImport(version.id);
      if (row === null) {
        throw fail.notFound();
      }
      const meta: OpenApiMeta = { importId: row.id, fileName: row.fileName, bytes: row.bytes, sha256: row.sha256, importedAt: row.importedAt.toISOString() };
      return reply.json(200, meta);
    },
  });

  endpoint('GET', '/api/versions/:versionId/openapi/source', {
    access: 'member',
    prepare: (ctx) => versionScope(ctx.principal, ctx.params.versionId ?? ''),
    handle: async (_ctx, version) => {
      const row = await latestImport(version.id);
      if (row === null) {
        throw fail.notFound();
      }
      try {
        const bytes = await getObject(row.s3Key);
        if (bytes === null) {
          throw fail.notFound();
        }
        return reply.bytes(200, bytes, 'application/json', { 'Content-Disposition': `attachment; filename="${row.fileName}"` });
      } catch (error) {
        throw error instanceof StorageUnavailableError ? fail.storageUnavailable('File storage is unavailable.') : error;
      }
    },
  });
}
