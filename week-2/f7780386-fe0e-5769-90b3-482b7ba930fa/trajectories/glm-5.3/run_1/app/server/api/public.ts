// The public packet page's JSON and PDF, read-only, no session. Tokens are
// unguessable and never logged.

import { Router, type Response } from 'express';
import { pool, isDbUp } from '../db.js';
import { ApiError } from '../http.js';
import { kitchenNow } from '../clock.js';
import { getObject, packetKey, StorageUnavailable } from '../storage.js';
import type { PacketContent } from '../../shared/types.js';

export const router = Router();

const TOKEN_RE = /^[A-Za-z0-9_-]{43,}$/;

function packetNotFound(res: Response): void {
  res.status(404).json({ error: 'not_found' });
}

async function activePacket(token: string): Promise<{ id: string; content: PacketContent } | null> {
  const q = await pool.query(`SELECT id, status, expires_at, snapshot FROM packets WHERE token = $1`, [token]);
  const row = q.rows[0] as { id: string; status: string; expires_at: Date; snapshot: PacketContent } | undefined;
  if (!row) return null;
  if (row.status !== 'active') return null;
  if (kitchenNow().epochMillis >= row.expires_at.getTime()) return null;
  return { id: row.id, content: row.snapshot };
}

router.get('/api/packet/:token', async (req, res, next) => {
  try {
    if (!isDbUp()) throw new ApiError(503, 'database_unavailable');
    const token = req.params['token'] ?? '';
    if (!TOKEN_RE.test(token)) {
      packetNotFound(res);
      return;
    }
    const packet = await activePacket(token);
    if (!packet) {
      packetNotFound(res);
      return;
    }
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    res.json(packet.content);
  } catch (err) {
    next(err);
  }
});

router.get('/api/packet/:token/pdf', async (req, res, next) => {
  try {
    if (!isDbUp()) throw new ApiError(503, 'database_unavailable');
    const token = req.params['token'] ?? '';
    if (!TOKEN_RE.test(token)) {
      packetNotFound(res);
      return;
    }
    const packet = await activePacket(token);
    if (!packet) {
      packetNotFound(res);
      return;
    }
    let bytes: Buffer;
    try {
      bytes = await getObject(packetKey(packet.id));
    } catch (err) {
      if (err instanceof StorageUnavailable) throw new ApiError(503, 'storage_unavailable');
      throw err;
    }
    res.set({
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="compliance-packet-${packet.content.from}-to-${packet.content.to}.pdf"`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': 'sandbox',
    });
    res.send(bytes);
  } catch (err) {
    next(err);
  }
});
