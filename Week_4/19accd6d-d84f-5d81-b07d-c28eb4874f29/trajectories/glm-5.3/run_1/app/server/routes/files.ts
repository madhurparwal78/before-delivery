import { Router } from 'express';
import { raw } from 'express';
import { pool } from '../db.js';
import { config } from '../config.js';
import { ApiError, notFound, handle } from '../errors.js';
import { newId, sha256Hex } from '../ids.js';
import { requireUser } from '../auth.js';
import { getObject, putObject, storageUp } from '../services.js';

export const filesRouter = Router();

filesRouter.post('/', raw({ type: 'application/octet-stream', limit: 64 * 1024 * 1024 }), handle(async (req, res) => {
  const user = requireUser(req);
  const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const limit = config().fileMaxBytes;
  if (bytes.length > limit) throw new ApiError(413, 'file_too_large', `File too large: ${bytes.length} bytes (limit ${limit} bytes).`);
  // An over-cap body is refused before parsing by the global Content-Length check (DP-05).
  const name = (req.headers['x-file-name'] as string | undefined) ?? 'file';
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  const clean = decoded.length >= 1 && decoded.length <= 200 ? decoded : name.slice(0, 200);
  if (!(await storageUp())) throw new ApiError(503, 'storage_unavailable', 'Storage is unavailable. The file was not saved.');
  const id = newId('f');
  try {
    await putObject(`files/${id}`, bytes, config().s3.bucket);
  } catch {
    throw new ApiError(503, 'storage_unavailable', 'Storage is unavailable. The file was not saved.');
  }
  await pool.query('INSERT INTO files (id, owner_id, name, bytes, sha256) VALUES ($1, $2, $3, $4, $5)', [
    id,
    user.id,
    clean,
    bytes.length,
    sha256Hex(bytes),
  ]);
  res.status(201).json({ file: { id, name: clean, bytes: bytes.length, sha256: sha256Hex(bytes) } });
}));

filesRouter.get('/:id', handle(async (req, res) => {
  const user = requireUser(req);
  const r = await pool.query<{ name: string; bytes: number; owner_id: string }>('SELECT name, bytes, owner_id FROM files WHERE id = $1', [req.params.id]);
  if (!r.rows[0] || r.rows[0].owner_id !== user.id) throw notFound();
  let data: Buffer;
  try {
    data = await getObject(`files/${req.params.id}`, config().s3.bucket);
  } catch {
    throw new ApiError(503, 'storage_unavailable', 'Storage is unavailable. The file was not saved.');
  }
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', String(data.length));
  res.end(data);
}));
