import { Router } from 'express';
import { pool } from '../db.js';
import { config } from '../config.js';
import { ApiError, notFound, validation, handle } from '../errors.js';
import { newToken, sha256Hex } from '../ids.js';
import { requireUser } from '../auth.js';
import { getObject, putObject, storageUp } from '../services.js';
import { getObject as readObject } from '../services.js';
import { formatUtcDate } from '../../shared/text.js';
import { validateSteps } from '../../shared/catalogue.js';
import { ttlSeconds } from '../config.js';
import type { Step } from '../../shared/catalogue.js';

export const snapshotsRouter = Router();

interface SnapshotRow {
  token: string;
  status: string;
  revoked: boolean;
  created_at: Date;
  expires_at: Date;
  recipe_name: string | null;
  recipe_version: number | null;
  steps: Step[];
  input_bytes: number;
  output_bytes: number;
  input_b64: string | null;
  input_file_id: string | null;
  output_b64: string | null;
  output_file_id: string | null;
}

/** The one place snapshot status is computed: server clock first, revoked wins (DP-31). */
function statusOf(row: { revoked: boolean; expires_at: Date; stored: boolean }): 'pending' | 'active' | 'expired' | 'revoked' {
  if (row.revoked) return 'revoked';
  if (row.expires_at.getTime() <= Date.now()) return 'expired';
  return row.stored ? 'active' : 'pending';
}

export async function snapshotBody(token: string): Promise<{ row: SnapshotRow; status: string; body: Record<string, unknown> } | null> {
  const r = await pool.query<SnapshotRow & { input_stored: boolean; output_stored: boolean }>(
    `SELECT token, status, revoked, created_at, expires_at, recipe_name, recipe_version, steps, input_bytes, output_bytes,
            input_b64, input_file_id, output_b64, output_file_id,
            (input_file_id IS NOT NULL) AS input_stored, (output_file_id IS NOT NULL) AS output_stored
     FROM snapshots WHERE token = $1`,
    [token],
  );
  const row = r.rows[0];
  if (!row) return null;
  const status = statusOf({ revoked: row.revoked, expires_at: row.expires_at, stored: row.input_stored && row.output_stored });
  const body: Record<string, unknown> = {
    token: row.token,
    status,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    recipe: status === 'expired' || status === 'revoked'
      ? null
      : { name: row.recipe_name ?? 'Shared recipe', version: row.recipe_version, steps: row.steps },
    inputBytes: row.input_bytes,
    outputBytes: row.output_bytes,
    url: `/s/${row.token}`,
  };
  return { row, status, body };
}

snapshotsRouter.post('/', handle(async (req, res) => {
  const user = requireUser(req);
  const body = req.body ?? {};
  const ttl = body.ttl;
  if (typeof ttl !== 'string' || !config().shareTtlChoices.includes(ttl)) {
    throw validation({ ttl: 'Choose one of the configured expiry choices.' });
  }
  const stepsV = validateSteps(Array.isArray(body.steps) ? body.steps : []);
  if ('fields' in stepsV) throw validation(stepsV.fields);
  if (stepsV.steps.length === 0) throw validation({ steps: 'A recipe needs at least one step.' });

  const inputB64 = typeof body.inputBase64 === 'string' ? body.inputBase64 : null;
  const fileId = typeof body.fileId === 'string' ? body.fileId : null;
  const outputB64 = typeof body.outputBase64 === 'string' ? body.outputBase64 : null;
  if (!inputB64 && !fileId) throw validation({ input: 'An input is needed.' });
  if (!outputB64) throw validation({ output: 'An output is needed.' });

  let inputBytes = 0;
  let inputFileId: string | null = null;
  let inputBase: string | null = null;
  if (fileId) {
    const f = await pool.query<{ id: string; bytes: number; sha256: string; owner_id: string }>(
      'SELECT id, bytes, sha256, owner_id FROM files WHERE id = $1',
      [fileId],
    );
    if (!f.rows[0] || f.rows[0].owner_id !== user.id) throw notFound();
    inputFileId = f.rows[0].id;
    inputBytes = f.rows[0].bytes;
  } else {
    inputBase = inputB64;
    inputBytes = Buffer.from(inputB64!, 'base64').length;
  }
  const outputBytes = Buffer.from(outputB64!, 'base64').length;

  const recipeRef = body.recipe && typeof body.recipe === 'object' ? (body.recipe as { id?: string; version?: number; name?: string }) : null;
  const token = newToken(16);
  const expiresAt = new Date(Date.now() + ttlSeconds(ttl) * 1000);
  await pool.query(
    `INSERT INTO snapshots (token, owner_id, recipe_id, recipe_version, recipe_name, steps, input_file_id, input_b64, input_bytes, output_file_id, output_b64, output_bytes, ttl, status, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'pending', now(), $14)`,
    [
      token,
      user.id,
      recipeRef?.id ?? null,
      typeof recipeRef?.version === 'number' ? recipeRef.version : null,
      recipeRef?.name ?? recipeRef?.id ?? 'Shared recipe',
      JSON.stringify(stepsV.steps),
      inputFileId,
      inputBase,
      inputBytes,
      null,
      outputB64,
      outputBytes,
      ttl,
      expiresAt,
    ],
  );

  // Try to write both objects now; pending bytes stay in the database and a retry loop confirms them.
  void confirmSnapshot(token).catch(() => undefined);
  const bodyResult = await snapshotBody(token);
  res.status(201).json({ snapshot: bodyResult!.body, serverTime: new Date().toISOString() });
}));

/** Writes pending snapshot bytes to storage and verifies them (Services). */
export async function confirmSnapshot(token: string): Promise<void> {
  const r = await pool.query(
    'SELECT token, input_b64, output_b64, input_file_id, output_file_id, input_bytes, output_bytes FROM snapshots WHERE token = $1',
    [token],
  );
  const row = r.rows[0];
  if (!row || row.input_file_id) return;
  if (!(await storageUp())) return;
  const inputBytes = row.input_b64 ? Buffer.from(row.input_b64, 'base64') : null;
  if (!inputBytes) return;
  try {
    await putObject(`snapshots/${token}/input`, inputBytes, config().s3.bucket);
    const outputBytes = Buffer.from(row.output_b64, 'base64');
    await putObject(`snapshots/${token}/output`, outputBytes, config().s3.bucket);
    // Verify by reading back size and hash before flipping to active.
    const backIn = await getObject(`snapshots/${token}/input`, config().s3.bucket);
    const backOut = await readObject(`snapshots/${token}/output`, config().s3.bucket);
    if (backIn.length !== inputBytes.length || backOut.length !== outputBytes.length) return;
    if (sha256Hex(backIn) !== sha256Hex(inputBytes) || sha256Hex(backOut) !== sha256Hex(outputBytes)) return;
    await pool.query('UPDATE snapshots SET input_file_id = $2, output_file_id = $3 WHERE token = $1', [
      token,
      `snapshots/${token}/input`,
      `snapshots/${token}/output`,
    ]);
    await pool.query('UPDATE snapshots SET input_b64 = NULL, output_b64 = NULL WHERE token = $1', [token]);
  } catch {
    return;
  }
}

snapshotsRouter.get('/:token', handle(async (req, res) => {
  const body = await snapshotBody(req.params.token);
  if (!body) throw notFound();
  res.json({ snapshot: body.body, serverTime: new Date().toISOString() });
}));

snapshotsRouter.get('/:token/input', handle(async (req, res) => {
  await serveSnapshotBytes(req, res, 'input');
}));

snapshotsRouter.get('/:token/output', handle(async (req, res) => {
  await serveSnapshotBytes(req, res, 'output');
}));

async function serveSnapshotBytes(req: import('express').Request, res: import('express').Response, which: 'input' | 'output'): Promise<void> {
  const body = await snapshotBody(req.params.token);
  if (!body) throw notFound();
    if (body.status === 'pending') throw new ApiError(409, 'snapshot_pending', 'This snapshot is waiting for storage to confirm its input.');
  if (body.status === 'expired') throw new ApiError(409, 'snapshot_expired', `This snapshot expired on ${formatUtcDate((body.row.expires_at as Date).toISOString())}.`);
  if (body.status === 'revoked') throw new ApiError(409, 'snapshot_revoked', 'This snapshot was revoked.');
  const key = which === 'input' ? body.row.input_file_id : body.row.output_file_id;
  if (!key) throw new ApiError(503, 'storage_unavailable', 'Storage is unavailable.');
  let bytes: Buffer;
  try {
    bytes = await getObject(key, config().s3.bucket);
  } catch {
    throw new ApiError(503, 'storage_unavailable', 'Storage is unavailable.');
  }
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${which}.bin"`);
  res.setHeader('Content-Length', String(bytes.length));
  res.end(bytes);
}

snapshotsRouter.delete('/:token', handle(async (req, res) => {
  const user = requireUser(req);
  const r = await pool.query<{ owner_id: string }>('SELECT owner_id FROM snapshots WHERE token = $1', [req.params.token]);
  if (!r.rows[0] || r.rows[0].owner_id !== user.id) throw notFound();
  await pool.query('UPDATE snapshots SET revoked = true WHERE token = $1', [req.params.token]);
  res.status(204).end();
}));
