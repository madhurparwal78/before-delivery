import type pg from 'pg';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DeferredResponse } from './api.js';
import { apiError, validationError, sendJson, readJsonBody, newId, sha256Hex, readRawBody } from './http.js';
import { isClient, isoT } from './api-utils.js';
import { recordEvent, recomputeCoverage } from './core.js';
import { putObject, getObject, objectKeyLineFile, storageStatus, markStorageDown } from './storage.js';
import type { SessionUser } from './auth.js';

const MAX_FILE = 50_000_000;

async function loadLineForStaff(c: pg.PoolClient, user: SessionUser, lineId: string): Promise<Record<string, unknown>> {
  if (isClient(user)) throw apiError(403, 'forbidden', 'You may not do this');
  const line = (await c.query(`SELECT * FROM lines WHERE id = $1 FOR UPDATE`, [lineId])).rows[0];
  if (!line) throw apiError(404, 'not_found', 'That record does not exist or is not shared with you.');
  return line;
}

export async function lineWithVesselName(c: pg.PoolClient, lineId: string): Promise<Record<string, unknown>> {
  const line = (await c.query(`SELECT * FROM lines WHERE id = $1`, [lineId])).rows[0]!;
  let vesselName = null;
  if (line.vessel_id) {
    vesselName = (await c.query(`SELECT name FROM vessels WHERE id = $1`, [line.vessel_id])).rows[0]?.name ?? null;
  }
  return lineFileBody(line, vesselName as string | null);
}

export function lineFileBody(l: Record<string, unknown>, vesselName: string | null): Record<string, unknown> {
  return {
    id: l.id, mission_id: l.mission_id, label: l.label, kind: l.kind,
    status: l.status, rerun_of: l.rerun_of, vessel_id: l.vessel_id, vessel_name: vesselName,
    start: l.start, end: l.end, length_m: l.length_m, covered_m: l.covered_m,
    holiday_id: l.holiday_id,
    file: ['Surveyed', 'Delivered', 'Superseded'].includes(l.status as string)
      ? (l.file_sha256
        ? {
          state: 'Stored', name: l.file_name, size_bytes: Number(l.file_size_bytes),
          sha256: l.file_sha256, stored_at: isoT(new Date(l.file_stored_at as string)),
        }
        : { state: 'Awaiting upload', name: null, size_bytes: null, sha256: null, stored_at: null })
      : null,
  };
}

function validateFileName(name: string | undefined): string | null {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(name)) return null;
  return name;
}

function validateSha(s: string | undefined): string | null {
  if (typeof s !== 'string' || !/^[0-9a-fA-F]{64}$/.test(s)) return null;
  return s.toLowerCase();
}

async function storeLineFile(c: pg.PoolClient, user: SessionUser, line: Record<string, unknown>, body: Buffer, fileName: string, sha: string): Promise<void> {
  const missionId = line.mission_id as string;
  await putObject(objectKeyLineFile(missionId, line.id as string, fileName), body, sha);
  await c.query(
    `UPDATE lines SET status = 'Delivered', file_name = $2, file_size_bytes = $3, file_sha256 = $4, file_stored_at = now()
     WHERE id = $1`,
    [line.id, fileName, body.length, sha]);
  await recordEvent(c, missionId, 'file', user.name, `${line.label} file stored`);
  // A re-run that becomes Delivered supersedes its original.
  if (line.rerun_of) {
    const orig = (await c.query(`SELECT * FROM lines WHERE id = $1 AND status IN ('Surveyed','Delivered')`, [line.rerun_of])).rows[0];
    if (orig) {
      await c.query(`UPDATE lines SET status = 'Superseded' WHERE id = $1`, [orig.id]);
      await recordEvent(c, missionId, 'line', user.name, `${orig.label} ${orig.status} → Superseded`);
    }
  }
  await recomputeCoverage(c, missionId);
}

export async function handleFileUpload(c: pg.PoolClient, req: IncomingMessage, res: DeferredResponse, user: SessionUser, lineId: string): Promise<void> {
  const line = await loadLineForStaff(c, user, lineId);
  const fileName = validateFileName(req.headers['x-line-file-name'] as string | undefined);
  const declaredSha = validateSha(req.headers['x-content-sha256'] as string | undefined);
  if (line.status === 'Delivered') {
    const body = await readRawBody(req, MAX_FILE);
    if (declaredSha === line.file_sha256 && sha256Hex(body) === line.file_sha256) {
      sendJson(res, 200, await lineWithVesselName(c, lineId));
      return;
    }
    throw apiError(409, 'already_delivered', `${line.label} already holds a different file`);
  }
  if (line.status !== 'Surveyed') {
    throw apiError(409, 'line_not_surveyed', `${line.label} is not awaiting an upload`);
  }
  if (!fileName) throw validationError({ file_name: 'Use a file name of 1 to 120 letters, digits, dots, underscores or hyphens' });
  if (!declaredSha) throw validationError({ sha256: 'Enter the 64-character SHA-256 from the logger' });
  const body = await readRawBody(req, MAX_FILE);
  if (body.length === 0) throw validationError({ file: 'The file is empty' });
  const actualSha = sha256Hex(body);
  if (actualSha !== declaredSha) {
    throw validationError({ sha256: 'Checksum does not match this file. Nothing was stored.' });
  }
  if (storageStatus() === 'down') {
    throw apiError(503, 'storage_unavailable', 'Storage is unavailable. Try again in a moment.');
  }
  try {
    await storeLineFile(c, user, line, body, fileName, declaredSha);
  } catch {
    markStorageDown();
    throw apiError(503, 'storage_unavailable', 'Storage is unavailable. Try again in a moment.');
  }
  sendJson(res, 201, await lineWithVesselName(c, lineId));
}

export async function handleFileDownload(c: pg.PoolClient, req: IncomingMessage, res: DeferredResponse, user: SessionUser, lineId: string): Promise<void> {
  const line = (await c.query(`SELECT * FROM lines WHERE id = $1`, [lineId])).rows[0];
  if (!line) throw apiError(404, 'not_found', 'That record does not exist or is not shared with you.');
  if (isClient(user)) {
    const mission = (await c.query(`SELECT client_org_id FROM missions WHERE id = $1`, [line.mission_id])).rows[0]!;
    if (mission.client_org_id !== user.client_org_id) {
      throw apiError(404, 'not_found', 'That record does not exist or is not shared with you.');
    }
  }
  // Storage check right after step 4: before any 409
  if (storageStatus() === 'down') {
    throw apiError(503, 'storage_unavailable', 'Storage is unavailable. Try again in a moment.');
  }
  if (!line.file_sha256) throw apiError(409, 'file_not_stored', 'This line has no stored file');
  // The object streams after the transaction commits.
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${line.file_name}"`,
    'X-Content-SHA256': line.file_sha256 as string,
  });
  res.downloadKey = objectKeyLineFile(line.mission_id as string, lineId, line.file_name as string);
  res.downloadStream = async () => {
    try {
      const { stream } = await getObject(res.downloadKey!);
      return stream;
    } catch {
      markStorageDown();
      throw apiError(503, 'storage_unavailable', 'Storage is unavailable. Try again in a moment.');
    }
  };
}

// ---------------- resumable uploads ----------------

const PART_BYTES = 4_000_000;

export async function handleUploadCreate(c: pg.PoolClient, req: IncomingMessage, res: DeferredResponse, user: SessionUser, lineId: string): Promise<void> {
  const line = await loadLineForStaff(c, user, lineId);
  const body = await readJsonBody(req, 64000) as Record<string, unknown>;
  const size = body.size_bytes;
  const sha = validateSha(body.sha256 as string | undefined);
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 1 || size > MAX_FILE) {
    throw validationError({ size_bytes: 'The file must be 1 to 50,000,000 bytes' });
  }
  if (!sha) throw validationError({ sha256: 'Enter the 64-character SHA-256 from the logger' });

  if (line.status === 'Delivered') {
    if (line.file_sha256 === sha && Number(line.file_size_bytes) === size) {
      sendJson(res, 200, await lineWithVesselName(c, lineId));
      return;
    }
    throw apiError(409, 'already_delivered', `${line.label} already holds a different file`);
  }
  if (line.status !== 'Surveyed') {
    throw apiError(409, 'line_not_surveyed', `${line.label} is not awaiting an upload`);
  }
  const open = (await c.query(
    `SELECT * FROM uploads WHERE line_id = $1 AND finished = false AND size_bytes = $2 AND sha256 = $3 ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
    [lineId, size, sha])).rows[0];
  if (open) {
    sendJson(res, 200, { upload_id: open.id, part_bytes: PART_BYTES, received_bytes: Number(open.received_bytes) });
    return;
  }
  const uploadId = newId('up');
  await c.query(`INSERT INTO uploads (id, line_id, size_bytes, sha256, received_bytes, created_at) VALUES ($1,$2,$3,$4,0, now())`,
    [uploadId, lineId, size, sha]);
  sendJson(res, 201, { upload_id: uploadId, part_bytes: PART_BYTES, received_bytes: 0 });
}

export async function handleUploadPart(c: pg.PoolClient, req: IncomingMessage, res: DeferredResponse, user: SessionUser, lineId: string, uploadId: string): Promise<void> {
  await loadLineForStaff(c, user, lineId);
  const upload = (await c.query(`SELECT * FROM uploads WHERE id = $1 AND line_id = $2 FOR UPDATE`, [uploadId, lineId])).rows[0];
  if (!upload) throw apiError(404, 'not_found', 'That record does not exist or is not shared with you.');
  const range = req.headers['content-range'] as string | undefined;
  const m = range ? /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range) : null;
  if (!m) throw validationError({ content_range: 'Send the part with a Content-Range header' });
  const first = Number(m[1]);
  const total = Number(m[3]);
  if (total !== Number(upload.size_bytes)) throw apiError(409, 'range_mismatch', 'This part does not match the upload', { received_bytes: Number(upload.received_bytes) });
  if (first !== Number(upload.received_bytes)) {
    throw apiError(409, 'range_mismatch', 'This part does not match the upload', { received_bytes: Number(upload.received_bytes) });
  }
  const maxPart = Math.min(PART_BYTES, Number(upload.size_bytes) - first);
  const body = await readRawBody(req, PART_BYTES + 1);
  if (body.length === 0 || body.length > maxPart) throw apiError(422, 'validation', 'Send a valid part', { errors: { part: 'Send a part of the published size' } });

  const receivedAfter = first + body.length;
  if (receivedAfter < Number(upload.size_bytes)) {
    // Append into the uploads record (Postgres bytea grows per part; abandoned parts leave nothing behind once the row goes)
    const existing = upload.parts as Uint8Array | null;
    const merged = existing ? Buffer.concat([Buffer.from(existing), body]) : body;
    await c.query(`UPDATE uploads SET received_bytes = $2, parts = $3 WHERE id = $1`, [uploadId, receivedAfter, merged]);
    sendJson(res, 200, { received_bytes: receivedAfter });
    return;
  }
  // Final part: verify checksum then store
  const existing = upload.parts as Uint8Array | null;
  const whole = existing ? Buffer.concat([Buffer.from(existing), body]) : body;
  if (whole.length !== Number(upload.size_bytes)) {
    throw apiError(409, 'range_mismatch', 'This part does not match the upload', { received_bytes: Number(upload.received_bytes) });
  }
  const actualSha = sha256Hex(whole);
  if (actualSha !== upload.sha256) {
    await c.query(`DELETE FROM uploads WHERE id = $1`, [uploadId]);
    throw validationError({ sha256: 'Checksum does not match this file. Nothing was stored.' });
  }
  if (storageStatus() === 'down') {
    throw apiError(503, 'storage_unavailable', 'Storage is unavailable. Try again in a moment.');
  }
  const line = (await c.query(`SELECT * FROM lines WHERE id = $1 FOR UPDATE`, [lineId])).rows[0];
  if (line.status !== 'Surveyed') {
    throw apiError(409, 'line_not_surveyed', `${line.label} is not awaiting an upload`);
  }
  const fileNameHeader = validateFileName(req.headers['x-line-file-name'] as string | undefined);
  if (!fileNameHeader) throw validationError({ file_name: 'Use a file name of 1 to 120 letters, digits, dots, underscores or hyphens' });
  try {
    await storeLineFile(c, user, line, whole, fileNameHeader, actualSha);
  } catch {
    markStorageDown();
    throw apiError(503, 'storage_unavailable', 'Storage is unavailable. Try again in a moment.');
  }
  await c.query(`DELETE FROM uploads WHERE id = $1`, [uploadId]);
  sendJson(res, 201, await lineWithVesselName(c, lineId));
}
