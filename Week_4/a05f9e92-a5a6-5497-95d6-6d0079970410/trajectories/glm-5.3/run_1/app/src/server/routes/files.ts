// Files: attachments, imports, exports and configuration sets.

import { RouteContext } from '../api.js';
import { SessionUser } from '../auth.js';
import { sendJson } from '../apibase.js';
import { ApiError, notFound, forbidden, operatorOnly } from '../errors.js';
import { clock, randomBytes } from '../db.js';
import { loadSnapshot } from '../recordengine.js';

const ATTACHMENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.csv': 'text/csv',
};

export async function files(route: RouteContext, user: SessionUser, pathIn?: string): Promise<boolean> {
  const { method } = route;
  const path = pathIn ?? route.path;

  const attachMatch = /^\/api\/records\/([A-Za-z]+-\d+)\/attachments$/.exec(path);
  if (attachMatch && method === 'POST') return attachmentUpload(route, user, attachMatch[1]);
  const attachGetMatch = /^\/api\/attachments\/([^/]+)$/.exec(path);
  if (attachGetMatch && method === 'GET') return attachmentDownload(route, user, attachGetMatch[1]);

  if (path === '/api/imports' && method === 'POST') return importUpload(route, user);
  const importCommit = /^\/api\/imports\/(\d+)\/commit$/.exec(path);
  if (importCommit && method === 'POST') return importCommitRun(route, user, Number(importCommit[1]));

  if (path === '/api/exports' && method === 'POST') return exportCreate(route, user);
  const exportMatch = /^\/api\/exports\/(\d+)$/.exec(path);
  if (exportMatch && method === 'GET') return exportRead(route, user, Number(exportMatch[1]));
  const retryMatch = /^\/api\/exports\/(\d+)\/retry$/.exec(path);
  if (retryMatch && method === 'POST') return exportRetry(route, user, Number(retryMatch[1]));
  const fileMatch = /^\/api\/exports\/(\d+)\/file$/.exec(path);
  if (fileMatch && method === 'GET') return exportFile(route, user, Number(fileMatch[1]));

  if (path === '/api/config-sets' && method === 'POST') return configSetCreate(route, user);
  const setExport = /^\/api\/config-sets\/(\d+)\/export$/.exec(path);
  if (setExport && method === 'POST') return configSetExport(route, user, Number(setExport[1]));
  const setPreview = /^\/api\/config-sets\/(\d+)\/preview$/.exec(path);
  if (setPreview && method === 'POST') return configSetPreview(route, user, Number(setPreview[1]));
  const setCommit = /^\/api\/config-sets\/(\d+)\/commit$/.exec(path);
  if (setCommit && method === 'POST') return configSetCommit(route, user, Number(setCommit[1]));
  const setBackout = /^\/api\/config-sets\/(\d+)\/backout$/.exec(path);
  if (setBackout && method === 'POST') return configSetBackout(route, user, Number(setBackout[1]));
  if (path === '/api/config-sets/upload' && method === 'POST') return configSetUpload(route, user);

  return false;
}

function deskOnly(user: SessionUser): boolean {
  return user.roles.includes('operator') || user.roles.includes('technician');
}

async function attachmentUpload(route: RouteContext, user: SessionUser, number: string): Promise<boolean> {
  const maxBytes = Number(route.ctx.settings.get('ATTACHMENT_MAX_BYTES') ?? 5_000_000);
  const quotaBytes = Number(route.ctx.settings.get('ATTACHMENT_QUOTA_BYTES') ?? 20_000_000);
  const shownLimit = maxBytes.toLocaleString('en-US');

  // Multipart body parsing: find the file part.
  const { buffer, filename: parsedName } = await readMultipart(route);
  const filename = parsedName ?? 'file.txt';
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  const declared = String(route.req.headers['content-type'] ?? '').includes('multipart/form-data') ? ATTACHMENT_TYPES[ext] : undefined;
  if (!declared) {
    throw new ApiError(422, 'bad_type', 'Switchyard accepts PNG, JPEG, PDF, TXT, LOG and CSV files.');
  }
  if (buffer.length > maxBytes) {
    throw new ApiError(413, 'too_large', `Files can be at most ${shownLimit} bytes.`);
  }

  // Quota over stored and queued uploads by this uploader.
  const used = await route.ctx.db.query(
    `SELECT COALESCE(SUM(bytes), 0) AS total FROM attachments WHERE uploader = $1`,
    [user.username],
  );
  if (Number(used.rows[0].total) + buffer.length > quotaBytes) {
    throw new ApiError(422, 'over_quota', `This upload would take you past your ${quotaBytes.toLocaleString('en-US')}-byte attachment quota.`);
  }

  const id = randomBytes(12);
  const now = new Date(clock.nowMs());

  // Storage down: queue the bytes and answer 202.
  if (!route.ctx.storage.isAvailable) {
    await route.ctx.db.query(
      `INSERT INTO attachments(id, record, name, bytes, type, status, uploader, created_at) VALUES ($1,$2,$3,$4,$5,'queued',$6,$7)`,
      [id, number, filename, buffer.length, declared, user.username, now],
    );
    await route.ctx.db.query(`INSERT INTO attachment_blobs(id, data) VALUES ($1,$2)`, [id, buffer]);
    sendJson(route.res, 202, { attachment: { id, name: filename, bytes: buffer.length, type: declared, status: 'queued' } });
    return true;
  }

  const key = `attachments/${number}/${id}/${filename}`;
  const stored = await route.ctx.storage.put(key, buffer, declared);
  if (stored) {
    await route.ctx.db.query(
      `INSERT INTO attachments(id, record, name, bytes, type, status, uploader, created_at, stored_at) VALUES ($1,$2,$3,$4,$5,'stored',$6,$7,$8)`,
      [id, number, filename, buffer.length, declared, user.username, now, now],
    );
    sendJson(route.res, 201, { attachment: { id, name: filename, bytes: buffer.length, type: declared, status: 'stored' } });
  } else {
    await route.ctx.db.query(
      `INSERT INTO attachments(id, record, name, bytes, type, status, uploader, created_at) VALUES ($1,$2,$3,$4,$5,'queued',$6,$7)`,
      [id, number, filename, buffer.length, declared, user.username, now],
    );
    await route.ctx.db.query(`INSERT INTO attachment_blobs(id, data) VALUES ($1,$2)`, [id, buffer]);
    sendJson(route.res, 202, { attachment: { id, name: filename, bytes: buffer.length, type: declared, status: 'queued' } });
  }
  return true;
}

interface MultipartResult { buffer: Buffer; contentType: string; filename: string | null }

async function readMultipart(route: RouteContext): Promise<MultipartResult> {
  const req = route.req;
  const body = route.rawBody ?? await rawBody(req);
  const contentTypeHeader = String(req.headers['content-type'] ?? '');
  const boundaryMatch = /boundary="?([^";]+)"?/.exec(contentTypeHeader);
  const boundary = boundaryMatch?.[1];
  if (!boundary) return { buffer: body, contentType: contentTypeHeader, filename: null };

  // Split the body into parts on the boundary and find the file part.
  const delimiter = Buffer.from(`--${boundary}`);
  let cursor = body.indexOf(delimiter);
  while (cursor >= 0) {
    const next = body.indexOf(delimiter, cursor + delimiter.length);
    if (next < 0) break;
    const part = body.subarray(cursor + delimiter.length, next);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd >= 0) {
      const headers = part.subarray(0, headerEnd).toString('utf8');
      if (/name="file"/.test(headers)) {
        // The content runs to the CRLF before the closing boundary.
        let content = part.subarray(headerEnd + 4);
        if (content.subarray(content.length - 2).toString('utf8') === '\r\n') {
          content = content.subarray(0, content.length - 2);
        }
        const name = /filename="([^"]+)"/.exec(headers)?.[1] ?? null;
        const type = /Content-Type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim() ?? 'application/octet-stream';
        return { buffer: Buffer.from(content), contentType: headers, filename: name ?? `file.${extFor(type)}` };
      }
    }
    cursor = next;
  }
  return { buffer: body, contentType: contentTypeHeader, filename: null };
}

function extFor(type: string): string {
  const byType: Record<string, string> = {
    'text/plain': 'txt',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'application/pdf': 'pdf',
    'text/csv': 'csv',
  };
  return byType[type] ?? 'txt';
}

function fileNameOf(contentType: string): string | null {
  return /filename="([^"]+)"/.exec(contentType)?.[1] ?? null;
}

async function attachmentDownload(route: RouteContext, user: SessionUser, id: string): Promise<boolean> {
  void user;
  const res = await route.ctx.db.query(`SELECT * FROM attachments WHERE id = $1`, [id]);
  if (!res.rows.length) throw notFound();
  const row = res.rows[0];
  if (row.status === 'queued') {
    throw new ApiError(409, 'not_stored', 'This file is still waiting for storage.');
  }
  if (!route.ctx.storage.isAvailable) {
    throw new ApiError(503, 'storage_unavailable', 'File storage is unreachable. Try again when it returns.');
  }
  const key = `attachments/${row.record}/${id}/${row.name}`;
  const file = await route.ctx.storage.get(key);
  if (!file) {
    throw new ApiError(503, 'storage_unavailable', 'File storage is unreachable. Try again when it returns.');
  }
  route.res.writeHead(200, { 'Content-Type': String(row.type), 'Content-Length': file.body.length });
  route.res.end(file.body);
  return true;
}

async function importUpload(route: RouteContext, user: SessionUser): Promise<boolean> {
  if (!user.roles.includes('operator')) throw operatorOnly();
  if (!route.ctx.storage.isAvailable) {
    throw new ApiError(503, 'storage_unavailable', 'File storage is unreachable. Try again when it returns.');
  }

  const { buffer, filename: importName } = await readMultipart(route);
  const table = route.url.searchParams.get('table') ?? String(route.body.table ?? '');
  if (table !== 'people' && table !== 'configuration_items') {
    throw new ApiError(422, 'validation', 'table must be people or configuration_items.');
  }

  const text = buffer.toString('utf8');
  const lines = text.split(/\r?\n/);
  const rows = parseImport(table, lines);

  // Department existence is checked against the database.
  const departments = new Set((await route.ctx.db.query(`SELECT name FROM departments`)).rows.map((r: Record<string, unknown>) => String(r.name)));
  for (const row of rows) {
    if (row.action !== 'error') continue;
    row.errors = row.errors.filter(e => !e.startsWith('__DEPT__'));
  }
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const values = parseCsvLine(line);
    if (values.length < 2) continue;
    const record: Record<string, string> = {};
    parseCsvLine(lines[1]).forEach((c, idx) => { record[c] = values[idx]; });
    if (table === 'people' && record.department && !departments.has(record.department)) {
      const row = rows.find(r => r.line === i + 1);
      if (row) {
        row.action = 'error';
        row.errors.push(`Line ${i + 1}: department "${record.department}" does not exist.`);
      }
    }
  }

  // Classify against stored rows by match key.
  for (const row of rows) {
    if (row.action === 'error' || !row.key) continue;
    if (table === 'people') {
      const existing = await route.ctx.db.query(`SELECT username, display_name, department, active FROM people WHERE username = $1`, [row.key]);
      if (!existing.rows.length) { row.action = 'create'; continue; }
      const stored = existing.rows[0];
      const values = parseCsvLine(lines[row.line - 1]);
      const header = parseCsvLine(lines[1]);
      const record: Record<string, string> = {};
      header.forEach((c, idx) => { record[c] = values[idx]; });
      const same = String(stored.display_name) === record.display_name
        && String(stored.department ?? '') === record.department
        && String(stored.active) === (record.active ?? 'true');
      row.action = same ? 'unchanged' : 'update';
    } else {
      const existing = await route.ctx.db.query(`SELECT name FROM cis WHERE lower(name) = lower($1)`, [row.key]);
      row.action = existing.rows.length ? 'update' : 'create';
    }
  }

  // The import id comes from its own sequence; the file is stored under it.
  const idRes = await route.ctx.db.query(`INSERT INTO import_ids DEFAULT VALUES RETURNING id`);
  const importId = Number(idRes.rows[0].id);
  const counts = {
    create: rows.filter(r => r.action === 'create').length,
    update: rows.filter(r => r.action === 'update').length,
    unchanged: rows.filter(r => r.action === 'unchanged').length,
    error: rows.filter(r => r.action === 'error').length,
  };
  await route.ctx.db.query(
    `INSERT INTO imports(id, "table", key, rows, counts, committed) VALUES ($1,$2,$3,$4,$5,FALSE)`,
    [importId, table, table === 'people' ? 'username' : 'name', JSON.stringify(rows), JSON.stringify(counts)],
  );

  const key = `imports/${importId}/${importName ?? 'import.csv'}`;
  const stored = await route.ctx.storage.put(key, buffer, 'text/csv');
  if (!stored) {
    throw new ApiError(503, 'storage_unavailable', 'File storage is unreachable. Try again when it returns.');
  }

  sendJson(route.res, 201, {
    import: { id: importId, table, key: table === 'people' ? 'username' : 'name', rows, counts },
  });
  return true;
}

interface ImportRow { line: number; action: string; key: string | null; errors: string[]; display_name?: string; department?: string; active?: string; class?: string; criticality?: string; business_critical?: string; owner_department?: string }

function parseImport(table: string, lines: string[]): ImportRow[] {
  const rows: ImportRow[] = [];
  if (!lines.length || lines[0] !== `#switchyard-import v1 ${table}`) {
    rows.push({ line: 1, action: 'error', key: null, errors: [`Line 1: the first line must be "#switchyard-import v1 ${table}".`] });
    return rows;
  }
  if (lines.length < 2) return rows;

  const header = parseCsvLine(lines[1]);
  const allowed = table === 'people'
    ? ['username', 'display_name', 'department', 'active']
    : ['name', 'class', 'criticality', 'business_critical', 'owner_department'];
  const columns: string[] = [];
  for (const column of header) {
    if (!allowed.includes(column)) {
      rows.push({ line: 2, action: 'error', key: null, errors: [`Line 2: unknown column "${column}".`] });
      return rows;
    }
    columns.push(column);
  }

  const seenKeys = new Map<string, number>();
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const values = parseCsvLine(line);
    if (values.length !== columns.length) {
      rows.push({ line: i + 1, action: 'error', key: null, errors: [`Line ${i + 1}: expected ${columns.length} values, found ${values.length}.`] });
      continue;
    }
    const record: Record<string, string> = {};
    columns.forEach((c, idx) => { record[c] = values[idx]; });
    const key = record[table === 'people' ? 'username' : 'name'] ?? '';
    const rowErrors: string[] = [];
    for (const required of allowed.filter(c => table === 'people' ? c === 'username' || c === 'display_name' : c === 'name' || c === 'class')) {
      if (!record[required]) rowErrors.push(`Line ${i + 1}: ${required} is required.`);
    }
    if (table === 'people') {
      if (record.department) {
        // Departments are validated against the database by the caller.
        rowErrors.push(...validateDepartmentLater(i + 1, record.department));
      }
      if (record.active && !['true', 'false'].includes(record.active)) {
        rowErrors.push(`Line ${i + 1}: active "${record.active}" is not one of true, false.`);
      }
    } else {
      const classLabels: Record<string, string> = {
        'Configuration item': 'configuration_item', 'Business service': 'business_service',
        'Application': 'application', 'Server': 'server', 'Virtual server': 'virtual_server',
        'Cluster': 'cluster', 'Network device': 'network_device', 'Storage': 'storage',
      };
      if (record.class && !classLabels[record.class]) {
        rowErrors.push(`Line ${i + 1}: class "${record.class}" is not one of ${Object.keys(classLabels).join(', ')}.`);
      }
      if (record.criticality && !['1', '2', '3'].includes(record.criticality)) {
        rowErrors.push(`Line ${i + 1}: criticality "${record.criticality}" is not one of 1, 2, 3.`);
      }
      if (record.business_critical && !['true', 'false'].includes(record.business_critical)) {
        rowErrors.push(`Line ${i + 1}: business_critical "${record.business_critical}" is not one of true, false.`);
      }
    }
    if (key && seenKeys.has(key)) {
      rowErrors.push(`Line ${i + 1}: duplicate key "${key}" also on line ${seenKeys.get(key)}.`);
    } else if (key) {
      seenKeys.set(key, i + 1);
    }
    if (rowErrors.length) {
      rows.push({ line: i + 1, action: 'error', key: key || null, errors: rowErrors, display_name: record.display_name, department: record.department, active: record.active, class: record.class, criticality: record.criticality, business_critical: record.business_critical, owner_department: record.owner_department });
      continue;
    }
    rows.push({
      line: i + 1, action: 'create', key: key || null, errors: [],
      display_name: record.display_name, department: record.department, active: record.active,
      class: record.class, criticality: record.criticality, business_critical: record.business_critical,
      owner_department: record.owner_department,
    });
  }
  return rows;
}

/** Departments are checked against the database after the parse. */
function validateDepartmentLater(line: number, department: string): string[] {
  void line;
  void department;
  return [];
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { current += '"'; i++; }
        else quoted = false;
      } else {
        current += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      out.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  out.push(current);
  return out;
}

async function importCommitRun(route: RouteContext, user: SessionUser, id: number): Promise<boolean> {
  if (!user.roles.includes('operator')) throw operatorOnly();
  const res = await route.ctx.db.query(`SELECT * FROM imports WHERE id = $1`, [id]);
  if (!res.rows.length) throw notFound();
  if (res.rows[0].committed) throw new ApiError(409, 'already_committed', 'This import was already committed.');

  const table = String(res.rows[0].table);
  const rows = res.rows[0].rows as ImportRow[];
  const results: Array<{ line: number; outcome: string; errors: string[] }> = [];

  await route.ctx.db.withTransaction(async (client) => {
    for (const row of rows) {
      if (row.action === 'error') {
        results.push({ line: row.line, outcome: 'failed', errors: row.errors });
        continue;
      }
      // The stored rows list carries the parsed values for each row.
      if (table === 'people') {
        if (row.action === 'create') {
          await client.query(
            `INSERT INTO people(username, display_name, department, roles, password_hash, time_zone, active)
             VALUES ($1,$2,$3,NULL,NULL,'Europe/Berlin',$4) ON CONFLICT (username) DO NOTHING`,
            [row.key, row.display_name ?? String(row.key), row.department ?? null, (row.active ?? 'true') === 'true'],
          );
        } else if (row.action === 'update') {
          await client.query(
            `UPDATE people SET display_name = $2, department = $3, active = $4 WHERE username = $1`,
            [row.key, row.display_name ?? String(row.key), row.department ?? null, (row.active ?? 'true') === 'true'],
          );
        }
        results.push({ line: row.line, outcome: row.action === 'create' ? 'created' : row.action === 'update' ? 'updated' : 'unchanged', errors: [] });
      } else {
        if (row.action === 'create') {
          await client.query(
            `INSERT INTO cis(name, "class", criticality, business_critical, owner_department, status, attributes, used_by_departments, used_by_people)
             VALUES ($1,$2,$3,$4,$5,'healthy','{}','{}','{}') ON CONFLICT DO NOTHING`,
            [row.key, row.class ?? 'configuration_item', Number(row.criticality ?? 3), (row.business_critical ?? 'false') === 'true', row.owner_department ?? null],
          );
        } else if (row.action === 'update') {
          await client.query(
            `UPDATE cis SET "class" = $2, criticality = $3, business_critical = $4, owner_department = $5 WHERE lower(name) = lower($1)`,
            [row.key, row.class ?? 'configuration_item', Number(row.criticality ?? 3), (row.business_critical ?? 'false') === 'true', row.owner_department ?? null],
          );
        }
        results.push({ line: row.line, outcome: row.action === 'create' ? 'created' : row.action === 'update' ? 'updated' : 'unchanged', errors: [] });
      }
    }
    await client.query(`UPDATE imports SET committed = TRUE WHERE id = $1`, [id]);
  });

  sendJson(route.res, 200, { import: { id, results } });
  return true;
}

async function exportCreate(route: RouteContext, user: SessionUser): Promise<boolean> {
  if (!(deskOnly(user) || user.roles.includes('manager'))) throw forbidden();
  const body = route.body;
  const { summaryWithSla } = await import('./summary.js');
  void summaryWithSla;
  const res = await route.ctx.db.query(
    `INSERT INTO exports(owner, "table", filter, columns, status, rows_total, rows_done) VALUES ($1,$2,$3,$4,'queued',0,0) RETURNING id`,
    [user.username, body.table, String(body.filter ?? ''), JSON.stringify(body.columns ?? []), ],
  );
  const id = Number(res.rows[0].id);
  const { runExportJob } = await import('./exportjob.js');
  void runExportJob;
  sendJson(route.res, 202, { export: { id, status: 'queued', rows_total: 0, rows_done: 0 } });
  return true;
}

async function exportRead(route: RouteContext, user: SessionUser, id: number): Promise<boolean> {
  const res = await route.ctx.db.query(`SELECT * FROM exports WHERE id = $1`, [id]);
  if (!res.rows.length) throw notFound();
  const row = res.rows[0];
  if (row.owner !== user.username && !user.roles.includes('operator')) throw notFound();
  sendJson(route.res, 200, {
    export: {
      id: Number(row.id), status: row.status, rows_total: Number(row.rows_total),
      rows_done: Number(row.rows_done), error: row.error ?? null, key: row.key ?? null,
    },
  });
  return true;
}

async function exportRetry(route: RouteContext, user: SessionUser, id: number): Promise<boolean> {
  const res = await route.ctx.db.query(`SELECT * FROM exports WHERE id = $1`, [id]);
  if (!res.rows.length) throw notFound();
  const row = res.rows[0];
  if (row.owner !== user.username && !user.roles.includes('operator')) throw notFound();
  if (row.status !== 'failed') throw new ApiError(409, 'not_failed', 'Only failed exports can be retried.');
  if (!route.ctx.storage.isAvailable) {
    throw new ApiError(503, 'storage_unavailable', 'File storage is unreachable. Try again when it returns.');
  }
  const { runExportJob } = await import('./exportjob.js');
  const updated = await runExportJob(route.ctx, Number(row.id));
  sendJson(route.res, 202, { export: updated });
  return true;
}

async function exportFile(route: RouteContext, user: SessionUser, id: number): Promise<boolean> {
  const res = await route.ctx.db.query(`SELECT * FROM exports WHERE id = $1`, [id]);
  if (!res.rows.length) throw notFound();
  const row = res.rows[0];
  if (row.owner !== user.username && !user.roles.includes('operator')) throw notFound();
  if (row.status !== 'complete') throw new ApiError(409, 'not_complete', 'This export is not complete yet.');
  if (!route.ctx.storage.isAvailable) {
    throw new ApiError(503, 'storage_unavailable', 'File storage is unreachable. Try again when it returns.');
  }
  const file = await route.ctx.storage.get(String(row.key));
  if (!file) {
    throw new ApiError(503, 'storage_unavailable', 'File storage is unreachable. Try again when it returns.');
  }
  route.res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Length': file.body.length });
  route.res.end(file.body);
  return true;
}

async function configSetCreate(route: RouteContext, user: SessionUser): Promise<boolean> {
  if (!user.roles.includes('operator')) throw operatorOnly();
  const existing = await route.ctx.db.query(`SELECT id FROM config_sets WHERE state IN ('open','exported')`);
  if (existing.rows.length) throw new ApiError(409, 'set_already_open', 'A set is already open.');

  const { allocateNamedNumber } = await import('../recordengine.js');
  const number = await allocateNamedNumber(route.ctx.db, 'set');
  const res = await route.ctx.db.query(
    `INSERT INTO config_sets(number, name, state, items) VALUES ($1,$2,'open','[]') RETURNING id`,
    [number, String(route.body.name ?? number)],
  );
  sendJson(route.res, 201, {
    set: { id: Number(res.rows[0].id), number, name: String(route.body.name ?? number), state: 'open', items: [] },
  });
  return true;
}

async function configSetExport(route: RouteContext, user: SessionUser, id: number): Promise<boolean> {
  if (!user.roles.includes('operator')) throw operatorOnly();
  if (!route.ctx.storage.isAvailable) {
    throw new ApiError(503, 'storage_unavailable', 'File storage is unreachable. Try again when it returns.');
  }
  const res = await route.ctx.db.query(`SELECT * FROM config_sets WHERE id = $1`, [id]);
  if (!res.rows.length) throw notFound();
  const row = res.rows[0];
  const file = {
    format: 'switchyard-config-set',
    version: 1,
    number: row.number,
    name: row.name,
    exported_at: new Date(clock.nowMs()).toISOString(),
    items: row.items,
  };
  const key = `config-sets/${row.number}.json`;
  const stored = await route.ctx.storage.put(key, Buffer.from(JSON.stringify(file, null, 2)), 'application/json');
  if (!stored) {
    throw new ApiError(503, 'storage_unavailable', 'File storage is unreachable. Try again when it returns.');
  }
  await route.ctx.db.query(`UPDATE config_sets SET state = 'exported', key = $2 WHERE id = $1`, [id, key]);
  sendJson(route.res, 201, { set: { ...row, state: 'exported', key } });
  return true;
}

async function configSetPreview(route: RouteContext, user: SessionUser, id: number): Promise<boolean> {
  if (!user.roles.includes('operator')) throw operatorOnly();
  if (!route.ctx.storage.isAvailable) {
    throw new ApiError(503, 'storage_unavailable', 'File storage is unreachable. Try again when it returns.');
  }
  const res = await route.ctx.db.query(`SELECT * FROM config_sets WHERE id = $1`, [id]);
  if (!res.rows.length) throw notFound();
  const row = res.rows[0];
  if (row.state === 'open') throw new ApiError(409, 'not_exported', 'Export the set first.');

  const file = await route.ctx.storage.get(String(row.key));
  if (!file) {
    throw new ApiError(503, 'storage_unavailable', 'File storage is unreachable. Try again when it returns.');
  }
  const parsed = JSON.parse(file.body.toString('utf8')) as { items: Array<{ kind: string; name: string; deleted: boolean; content: unknown }> };

  const items: unknown[] = [];
  for (const item of parsed.items ?? []) {
    const existing = await findLive(route.ctx.db, item.kind, item.name);
    if (item.deleted) {
      items.push({ kind: item.kind, name: item.name, action: existing ? 'delete' : 'unchanged' });
      continue;
    }
    if (!existing) items.push({ kind: item.kind, name: item.name, action: 'create' });
    else {
      const promoted = await route.ctx.db.query(
        `SELECT at FROM config_promotions WHERE kind = $1 AND name = $2 ORDER BY at DESC LIMIT 1`,
        [item.kind, item.name],
      );
      void promoted;
      items.push({ kind: item.kind, name: item.name, action: JSON.stringify(existing) === JSON.stringify(item.content) ? 'unchanged' : 'update' });
    }
  }
  sendJson(route.res, 200, { items });
  return true;
}

async function findLive(db: RouteContext['ctx']['db'], kind: string, name: string): Promise<unknown> {
  const table = tableForKind(kind);
  if (!table) return null;
  const hasWorkspace = await tableHasWorkspaceColumn(db, table);
  const res = hasWorkspace
    ? await db.query(`SELECT * FROM ${table} WHERE ${keyForTable(table)} = $1 AND workspace = 'live'`, [name])
    : await db.query(`SELECT * FROM ${table} WHERE ${keyForTable(table)} = $1`, [name]);
  return res.rows.length ? res.rows[0] : null;
}

async function tableHasWorkspaceColumn(db: RouteContext['ctx']['db'], table: string): Promise<boolean> {
  const res = await db.query(
    `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = $1 AND column_name = 'workspace'`,
    [table],
  );
  return Number(res.rows[0].n) > 0;
}

function tableForKind(kind: string): string | null {
  const map: Record<string, string> = {
    catalog_item: 'catalog_items',
    workflow: 'workflows',
    business_rule: 'business_rules',
    access_rule: 'access_rules',
    form_policy: 'form_policies',
    sla_definition: 'sla_definitions',
    schedule: 'schedules',
    assignment_rule: 'assignment_rules',
    inbox_rule: 'inbox_rules',
  };
  return map[kind] ?? null;
}

/** The match key column of a kind's table. */
function keyForTable(table: string): string {
  return table === 'catalog_items' ? 'id' : 'name';
}

async function configSetCommit(route: RouteContext, user: SessionUser, id: number): Promise<boolean> {
  if (!user.roles.includes('operator')) throw operatorOnly();
  const res = await route.ctx.db.query(`SELECT * FROM config_sets WHERE id = $1`, [id]);
  if (!res.rows.length) throw notFound();
  const row = res.rows[0];
  if (row.state === 'open') throw new ApiError(409, 'not_exported', 'Export the set first.');

  const file = await route.ctx.storage.get(String(row.key));
  if (!file) {
    throw new ApiError(503, 'storage_unavailable', 'File storage is unreachable. Try again when it returns.');
  }
  const parsed = JSON.parse(file.body.toString('utf8')) as { items: Array<{ kind: string; name: string; deleted: boolean; content: Record<string, unknown> }> };
  const choices = (route.body.choices ?? {}) as Record<string, string>;

  // Preview actions, requiring a choice for every collision.
  const plan: Array<{ kind: string; name: string; content: Record<string, unknown>; action: string }> = [];
  const snapshots: Array<{ kind: string; name: string; action: string; before: unknown }> = [];
  for (const item of parsed.items ?? []) {
    const table = tableForKind(item.kind);
    if (!table) continue;
    const existing = await findLive(route.ctx.db, item.kind, item.name);
    const isCollision = !item.deleted && existing && JSON.stringify(existing) !== JSON.stringify(item.content);
    if (isCollision) {
      const choice = choices[`${item.kind}:${item.name}`];
      if (!choice) {
        throw new ApiError(422, 'choice_required', `Choose Take set or Keep live for ${item.name}.`);
      }
      if (choice === 'keep_live') {
        plan.push({ kind: item.kind, name: item.name, content: item.content, action: 'unchanged' });
        continue;
      }
    }
    const action = item.deleted ? 'delete' : existing ? 'update' : 'create';
    plan.push({ kind: item.kind, name: item.name, content: item.content, action });
    snapshots.push({ kind: item.kind, name: item.name, action, before: existing ?? null });
  }

  // Apply in one transaction: workflows before catalog items.
  let applied = 0;
  await route.ctx.db.withTransaction(async (client) => {
    const ordered = [...plan].sort((a, b) => (a.kind === 'workflow' ? -1 : 0) - (b.kind === 'workflow' ? -1 : 0));
    for (const entry of ordered) {
      if (entry.action === 'unchanged') continue;
      const table = tableForKind(entry.kind);
      if (!table) continue;
      if (entry.action === 'delete') {
        await client.query(`DELETE FROM ${table} WHERE name = $1`, [entry.name]);
        applied++;
        continue;
      }
      const mapping = commitColumnMap(entry.kind);
      const columns: string[] = [];
      const params: unknown[] = [];
      for (const [key, column] of Object.entries(mapping)) {
        if (!(key in entry.content)) continue;
        columns.push(`"${column}"`);
        params.push(commitValue(key, entry.content[key]));
      }
      if (entry.action === 'create') {
        const insertColumns = [...columns];
        const insertParams = [...params];
        if (await tableHasWorkspaceColumn(route.ctx.db, table)) {
          insertColumns.push('"workspace"');
          insertParams.push('live');
        }
        await client.query(
          `INSERT INTO ${table} (${insertColumns.join(', ')}) VALUES (${insertParams.map((_, i) => `$${i + 1}`).join(', ')})`,
          insertParams,
        );
      } else {
        await client.query(
          `UPDATE ${table} SET ${columns.map((c, i) => `${c} = $${i + 1}`).join(', ')} WHERE name = $${params.length + 1}`,
          [...params, entry.name],
        );
      }
      applied++;
    }
  });

  await route.ctx.db.query(`UPDATE config_sets SET state = 'committed', snapshots = $2, committed_at = $3, applied_count = $4 WHERE id = $1`,
    [id, JSON.stringify(snapshots), new Date(clock.nowMs()), applied]);
  sendJson(route.res, 200, { set: { ...row, state: 'committed' }, applied });
  return true;
}

function commitColumnMap(kind: string): Record<string, string> {
  const maps: Record<string, Record<string, string>> = {
    business_rule: { name: 'name', table: 'table', when: 'when', order: 'order', operations: 'operations', condition: 'condition', actions: 'actions', active: 'active' },
    access_rule: { name: 'name', type: 'type', table: 'table', field: 'field', operation: 'operation', roles: 'roles', condition: 'condition', active: 'active' },
    assignment_rule: { name: 'name', order: 'order', table: 'table', condition: 'condition', group: 'group', active: 'active' },
    form_policy: { name: 'name', table: 'table', catalog_item: 'catalog_item', order: 'order', condition: 'condition', actions: 'actions' },
    sla_definition: { name: 'name', table: 'table', start: 'start_expr', pause: 'pause_expr', stop: 'stop_expr', schedule: 'schedule', targets: 'targets' },
    schedule: { name: 'name', time_zone: 'time_zone', hours: 'hours', holidays: 'holidays' },
    inbox_rule: { event: 'event', roles: 'roles', enabled: 'enabled' },
  };
  return maps[kind] ?? {};
}

function commitValue(key: string, value: unknown): unknown {
  if (['actions', 'targets', 'members', 'hours', 'levels'].includes(key)) return JSON.stringify(value);
  return value;
}

async function configSetBackout(route: RouteContext, user: SessionUser, id: number): Promise<boolean> {
  if (!user.roles.includes('operator')) throw operatorOnly();
  const res = await route.ctx.db.query(`SELECT * FROM config_sets WHERE id = $1`, [id]);
  if (!res.rows.length) throw notFound();
  const row = res.rows[0];
  if (row.state !== 'committed') throw new ApiError(409, 'not_committed', 'Only committed sets can be backed out.');

  // A later committed set touching the same items blocks the back-out.
  const later = await route.ctx.db.query(
    `SELECT id FROM config_sets WHERE state = 'committed' AND committed_at > $1 AND id != $2 LIMIT 1`,
    [row.committed_at ?? new Date(), id],
  );
  if (later.rows.length) {
    const laterSet = await route.ctx.db.query(`SELECT number FROM config_sets WHERE id = $1`, [Number(later.rows[0].id)]);
    throw new ApiError(409, 'later_set', `A later set changed ${String(laterSet.rows[0]?.number)}; back that out first.`);
  }

  // Restore each snapshot exactly; items the commit created are deleted.
  const snapshots = (row.snapshots ?? []) as Array<{ kind: string; name: string; action: string; before: Record<string, unknown> }>;
  await route.ctx.db.withTransaction(async (client) => {
    for (const snapshot of snapshots) {
      const table = tableForKind(snapshot.kind);
      if (!table) continue;
      const key = keyForTable(table);
      if (snapshot.action === 'create') {
        await client.query(`DELETE FROM ${table} WHERE ${key} = $1`, [snapshot.name]);
        continue;
      }
      const before = snapshot.before as Record<string, unknown>;
      const columns: string[] = [];
      const params: unknown[] = [];
      for (const [column, value] of Object.entries(before)) {
        if (column === 'id' && table !== 'catalog_items') continue;
        columns.push(`"${column}"`);
        params.push(typeof value === 'object' && value !== null ? JSON.stringify(value) : value);
      }
      await client.query(
        `UPDATE ${table} SET ${columns.map((c, i) => `${c} = $${i + 1}`).join(', ')} WHERE ${key} = $${params.length + 1}`,
        [...params, snapshot.name],
      );
    }
  });

  await route.ctx.db.query(`UPDATE config_sets SET state = 'backed_out' WHERE id = $1`, [id]);
  sendJson(route.res, 200, { set: { id, number: row.number, state: 'backed_out' } });
  return true;
}

async function configSetUpload(route: RouteContext, user: SessionUser): Promise<boolean> {
  if (!user.roles.includes('operator')) throw operatorOnly();
  const part = await readMultipart(route);
  const buffer = part.filename ? part.buffer : await rawBody(route.req);
  const parsed = JSON.parse(buffer.toString('utf8')) as { number: string; name: string; items: unknown[] };
  const { allocateNamedNumber } = await import('../recordengine.js');
  const number = await allocateNamedNumber(route.ctx.db, 'set');
  const res = await route.ctx.db.query(
    `INSERT INTO config_sets(number, name, state, items) VALUES ($1,$2,'exported',$3) RETURNING id`,
    [number, String(parsed.name ?? number), JSON.stringify(parsed.items ?? [])],
  );
  sendJson(route.res, 201, { set: { id: Number(res.rows[0].id), number, name: String(parsed.name ?? number), state: 'exported', items: parsed.items } });
  return true;
}

/** The whole request body, for uploads that are not multipart. */
async function rawBody(req: RouteContext['req']): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}
