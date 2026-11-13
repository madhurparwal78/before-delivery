import { pool } from './db';
import { ApiError } from '../errors';
import { copy } from '../shared/copy';
import { MAX_OPENAPI_BYTES } from '../shared/rules';
import { storage } from './storage';
import { newId, sha256Hex } from './ids';
import { getPage, getTabs, navigationJson } from './queries';
import type { PageRow } from './queries';

export type OpenApiOperation = {
  operationId: string;
  method: string;
  path: string;
  summary: string;
  description: string;
  parameters: { name: string; in: string; required: boolean; description: string; type: string }[];
  bodyExample: unknown | null;
  bodyRequired: boolean;
  responses: { code: string; description: string; example: unknown }[];
};

export type ParsedOpenApi = { operations: OpenApiOperation[] };

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

export function parseOpenApi(bytes: Buffer): ParsedOpenApi {
  if (bytes.length > MAX_OPENAPI_BYTES) throw new ApiError('too_large', copy.importTooLarge);
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new ApiError('invalid_openapi', copy.importInvalid);
  }
  if (typeof parsed !== 'object' || parsed === null) throw new ApiError('invalid_openapi', copy.importInvalid);
  const doc = parsed as Record<string, unknown>;
  if (typeof doc.openapi !== 'string' || !doc.openapi.startsWith('3.0.')) throw new ApiError('invalid_openapi', copy.importInvalid);
  const paths = doc.paths;
  if (typeof paths !== 'object' || paths === null) throw new ApiError('invalid_openapi', copy.importInvalid);

  const operations: OpenApiOperation[] = [];
  const seenOperationIds = new Set<string>();
  for (const [path, pathItem] of Object.entries(paths as Record<string, unknown>)) {
    if (typeof pathItem !== 'object' || pathItem === null) continue;
    for (const method of METHODS) {
      const op = (pathItem as Record<string, unknown>)[method];
      if (typeof op !== 'object' || op === null) continue;
      const o = op as Record<string, unknown>;
      const operationId = o.operationId;
      if (typeof operationId !== 'string' || operationId.length === 0) throw new ApiError('invalid_openapi', copy.importInvalid);
      if (seenOperationIds.has(operationId)) throw new ApiError('invalid_openapi', copy.importInvalid);
      seenOperationIds.add(operationId);
      operations.push(buildOperation(operationId, method, path, o));
    }
  }
  return { operations };
}

function buildOperation(operationId: string, method: string, path: string, o: Record<string, unknown>): OpenApiOperation {
  const summary = typeof o.summary === 'string' ? o.summary : '';
  const description = typeof o.description === 'string' ? o.description : '';
  const parameters: OpenApiOperation['parameters'] = [];
  const rawParams = Array.isArray(o.parameters) ? o.parameters : [];
  for (const p of rawParams) {
    if (typeof p !== 'object' || p === null) continue;
    const pp = p as Record<string, unknown>;
    if (typeof pp.name !== 'string') continue;
    const inWhere = typeof pp.in === 'string' ? pp.in : '';
    const schema = typeof pp.schema === 'object' && pp.schema !== null ? (pp.schema as Record<string, unknown>) : {};
    parameters.push({
      name: pp.name, in: inWhere,
      required: inWhere === 'path' ? true : pp.required === true,
      description: typeof pp.description === 'string' ? pp.description : '',
      type: typeof schema.type === 'string' ? schema.type : 'string',
    });
  }
  let bodyExample: unknown = null;
  let bodyRequired = false;
  const rb = o.requestBody;
  if (typeof rb === 'object' && rb !== null) {
    const r = rb as Record<string, unknown>;
    bodyRequired = r.required === true;
    bodyExample = extractExample(r.content);
  }
  const responses: OpenApiOperation['responses'] = [];
  const rawResponses = typeof o.responses === 'object' && o.responses !== null ? o.responses as Record<string, unknown> : {};
  for (const [code, resp] of Object.entries(rawResponses)) {
    if (typeof resp !== 'object' || resp === null) continue;
    const rr = resp as Record<string, unknown>;
    responses.push({
      code,
      description: typeof rr.description === 'string' ? rr.description : '',
      example: extractExample(rr.content) ?? null,
    });
  }
  responses.sort((a, b) => Number(a.code) - Number(b.code));
  return { operationId, method: method.toUpperCase(), path, summary, description, parameters, bodyExample, bodyRequired, responses };
}

function extractExample(content: unknown): unknown {
  if (typeof content !== 'object' || content === null) return null;
  const c = content as Record<string, unknown>;
  const json = c['application/json'];
  if (typeof json !== 'object' || json === null) return null;
  const example = (json as Record<string, unknown>).example;
  return example === undefined ? null : example;
}

export function referencePageSource(op: OpenApiOperation): string {
  const lines: string[] = [];
  lines.push('```');
  lines.push(`${op.method} ${op.path}`);
  lines.push('```');
  lines.push('');
  lines.push(`# ${op.summary}`);
  if (op.description) {
    lines.push('');
    lines.push(op.description);
  }
  const pathParams = op.parameters.filter((p) => p.in === 'path');
  const queryParams = op.parameters.filter((p) => p.in === 'query');
  const headerParams = op.parameters.filter((p) => p.in === 'header');
  const paramRows = [...pathParams, ...queryParams, ...headerParams];
  if (paramRows.length > 0) {
    lines.push('');
    lines.push('## Parameters');
    lines.push('');
    lines.push('| Name | In | Type | Required | Description |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const p of paramRows) {
      lines.push(`| ${p.name} | ${p.in} | ${p.type} | ${p.required ? 'Yes' : 'No'} | ${p.description} |`);
    }
  }
  if (op.bodyExample !== null) {
    lines.push('');
    lines.push('## Request body');
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(op.bodyExample, null, 2));
    lines.push('```');
  }
  if (op.responses.length > 0) {
    lines.push('');
    lines.push('## Responses');
    for (const r of op.responses) {
      lines.push('');
      lines.push(`### ${r.code} ${r.description}`);
      lines.push('');
      lines.push('```json');
      lines.push(JSON.stringify(r.example, null, 2));
      lines.push('```');
    }
  }
  lines.push('');
  lines.push('## Try it');
  lines.push('');
  lines.push(`<TryIt operationId="${op.operationId}" />`);
  lines.push('');
  return lines.join('\n');
}

export type ImportResult = { importId: string; groupId: string; pages: { id: string; path: string; title: string; operationId: string }[] };

export async function importOpenApi(versionId: string, fileName: string, bytes: Buffer): Promise<ImportResult> {
  const parsed = parseOpenApi(bytes);
  const versionRow = await pool.query<{ site_id: string }>('SELECT site_id FROM versions WHERE id = $1', [versionId]);
  const siteId = versionRow.rows[0].site_id;
  const importId = newId('imp');
  try {
    await storage.openapiFile(siteId, versionId, importId, bytes);
  } catch {
    throw new ApiError('storage_unavailable', copy.importOutage);
  }
  await pool.query(
    'INSERT INTO openapi_imports (id, version_id, file_name, bytes, sha256) VALUES ($1, $2, $3, $4, $5)',
    [importId, versionId, fileName, bytes.length, sha256Hex(bytes)],
  );

  const tabs = await getTabs(versionId);
  let lastTab = tabs[tabs.length - 1];
  if (!lastTab) {
    const id = newId('tab');
    await pool.query('INSERT INTO tabs (id, version_id, title, position) VALUES ($1, $2, $3, 0)', [id, versionId, 'Reference']);
    lastTab = { id, version_id: versionId, title: 'Reference', position: 0 };
  }
  let group = await pool.query<{ id: string }>(
    "SELECT id FROM groups WHERE tab_id = $1 AND title = 'API reference'", [lastTab.id],
  );
  let groupId = group.rows[0]?.id;
  if (!groupId) {
    groupId = newId('grp');
    const pos = await pool.query<{ n: number }>('SELECT coalesce(max(position), -1) + 1 AS n FROM groups WHERE tab_id = $1', [lastTab.id]);
    await pool.query('INSERT INTO groups (id, tab_id, title, position) VALUES ($1, $2, $3, $4)', [groupId, lastTab.id, 'API reference', pos.rows[0].n]);
  }

  const existing = await pool.query<PageRow>(
    "SELECT * FROM pages WHERE version_id = $1 AND kind = 'reference' ORDER BY position", [versionId],
  );
  const byOperation = new Map(existing.rows.map((p) => [p.operation_id!, p]));
  const maxPos = await pool.query<{ n: number }>(
    "SELECT coalesce(max(position), -1) + 1 AS n FROM pages WHERE version_id = $1", [versionId],
  );
  let nextPos = maxPos.rows[0].n;

  const results: ImportResult['pages'] = [];
  const kept = new Set<string>();
  for (const op of parsed.operations) {
    const path = `api/${op.operationId}`;
    const existingPage = byOperation.get(op.operationId);
    if (existingPage) {
      await pool.query(
        'UPDATE pages SET title = $2, source = $3, revision = revision + 1, has_draft_changes = true, updated_at = now() WHERE id = $1',
        [existingPage.id, op.summary || op.operationId, referencePageSource(op)],
      );
      kept.add(op.operationId);
      results.push({ id: existingPage.id, path: existingPage.path, title: op.summary, operationId: op.operationId });
      continue;
    }
    const id = newId('pg');
    await pool.query(
      `INSERT INTO pages (id, version_id, group_id, position, path, title, kind, operation_id, source, revision, state, has_draft_changes)
       VALUES ($1, $2, $3, $4, $5, $6, 'reference', $7, $8, 0, 'draft', true)`,
      [id, versionId, groupId, nextPos++, path, op.summary || op.operationId, op.operationId, referencePageSource(op)],
    );
    results.push({ id, path, title: op.summary, operationId: op.operationId });
  }
  for (const p of existing.rows) {
    if (!kept.has(p.operation_id!)) {
      await pool.query("UPDATE pages SET state = 'removed' WHERE id = $1", [p.id]);
    }
  }
  await pool.query(
    "DELETE FROM openapi_imports WHERE version_id = $1 AND id != $2", [versionId, importId],
  );
  return { importId, groupId, pages: results };
}

export async function operationFor(siteSlug: string, versionSlug: string, operationId: string): Promise<OpenApiOperation | null> {
  const version = await pool.query<{ id: string }>(
    'SELECT v.id FROM versions v JOIN sites s ON s.id = v.site_id WHERE s.slug = $1 AND v.slug = $2', [siteSlug, versionSlug],
  );
  if (version.rows.length === 0) return null;
  const importRow = await pool.query<{ id: string; site_id: string }>(
    'SELECT i.id, v.site_id FROM openapi_imports i JOIN versions v ON v.id = i.version_id WHERE i.version_id = $1 ORDER BY i.imported_at DESC LIMIT 1',
    [version.rows[0].id],
  );
  if (importRow.rows.length === 0) return null;
  const source = await storage.tryGet(`sites/${importRow.rows[0].site_id}/versions/${version.rows[0].id}/openapi/${importRow.rows[0].id}.json`);
  if (!source) return null;
  const parsed = parseOpenApi(source);
  return parsed.operations.find((o) => o.operationId === operationId) ?? null;
}

export async function storedOpenApi(versionId: string): Promise<{ fileName: string; bytes: Buffer; sha256: string } | null> {
  const r = await pool.query<{ id: string; file_name: string; bytes: number; sha256: string }>(
    'SELECT id, file_name, bytes, sha256 FROM openapi_imports WHERE version_id = $1 ORDER BY imported_at DESC LIMIT 1', [versionId],
  );
  const row = r.rows[0];
  if (!row) return null;
  const versionRow = await pool.query<{ site_id: string }>('SELECT site_id FROM versions WHERE id = $1', [versionId]);
  const source = await storage.tryGet(`sites/${versionRow.rows[0].site_id}/versions/${versionId}/openapi/${row.id}.json`);
  if (!source) return null;
  return { fileName: row.file_name, bytes: source, sha256: row.sha256 };
}

export async function openapiInfo(versionId: string): Promise<{ importId: string; fileName: string; bytes: number; sha256: string; importedAt: string } | null> {
  const r = await pool.query<{ id: string; file_name: string; bytes: number; sha256: string; imported_at: Date }>(
    'SELECT id, file_name, bytes, sha256, imported_at FROM openapi_imports WHERE version_id = $1 ORDER BY imported_at DESC LIMIT 1', [versionId],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    importId: row.id, fileName: row.file_name, bytes: row.bytes, sha256: row.sha256,
    importedAt: new Date(row.imported_at).toISOString(),
  };
}

export { getPage };
