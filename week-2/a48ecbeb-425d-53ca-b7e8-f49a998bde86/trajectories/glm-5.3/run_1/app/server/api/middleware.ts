import type { NextFunction, Request, Response, RequestHandler } from 'express';
import { pool } from '../db.js';
import { env } from '../env.js';
import * as kb from '../services/killbill.js';
import * as pb from '../services/pocketbase.js';
import { getObject } from '../services/s3.js';

export const JSON_BODY_LIMIT = 64_000;

export function sameOrigin(req: Request): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  const host = req.headers.host;
  if (typeof host !== 'string') return false;
  return origin === `http://${host}`;
}

export function jsonBodyLimit(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS' || req.path === '/retailer-applications') {
    next();
    return;
  }
  const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') {
    res.status(415).json({ error: 'unsupported_type', message: 'Send JSON for this endpoint.' });
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;
  req.on('data', (c: Buffer) => {
    size += c.length;
    if (size > JSON_BODY_LIMIT) {
      tooLarge = true;
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on('end', () => {
    if (tooLarge || size > JSON_BODY_LIMIT) {
      res.status(413).json({ error: 'too_large', message: 'That request is too large.' });
      return;
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    if (raw.trim().length === 0) {
      req.body = {};
      next();
      return;
    }
    try {
      req.body = JSON.parse(raw);
    } catch {
      res.status(422).json({ error: 'validation', message: 'Check the highlighted fields.', fields: { body: 'Send valid JSON.' } });
      return;
    }
    next();
  });
  req.on('error', () => {
    if (!res.headersSent) res.status(413).json({ error: 'too_large', message: 'That request is too large.' });
  });
}

export const serviceStatus: Record<'killbill' | 'postgres' | 'pocketbase' | 'minio' | 'mailpit', 'up' | 'down'> = {
  killbill: 'up',
  postgres: 'up',
  pocketbase: 'up',
  minio: 'up',
  mailpit: 'up',
};

let lastCheck = 0;

export async function refreshServiceStatus(force = false): Promise<void> {
  if (!force && Date.now() - lastCheck < 4000) return;
  lastCheck = Date.now();
  try {
    await pool.query('select 1');
    serviceStatus.postgres = 'up';
  } catch {
    serviceStatus.postgres = 'down';
  }
  try {
    await kb.kb('GET', '/1.0/kb/test/clock');
    serviceStatus.killbill = 'up';
  } catch {
    serviceStatus.killbill = 'down';
  }
  try {
    await pb.findUserByEmail('status-probe@ceibo.test');
    serviceStatus.pocketbase = 'up';
  } catch {
    serviceStatus.pocketbase = 'down';
  }
  try {
    await getObject('health/health.txt');
    serviceStatus.minio = 'up';
  } catch (e) {
    if (e instanceof (await import('../services/s3.js')).S3Unavailable) {
      serviceStatus.minio = 'down';
    } else {
      serviceStatus.minio = 'up';
    }
  }
  try {
    const res = await fetch(`${env.mailpitUrl}/api/v1/messages`, { signal: AbortSignal.timeout(4000) });
    serviceStatus.mailpit = res.ok ? 'up' : 'down';
  } catch {
    serviceStatus.mailpit = 'down';
  }
}

export const requireOrigin: RequestHandler = (req, res, next) => {
  const stateChanging = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
  if (stateChanging && !sameOrigin(req)) {
    res.status(403).json({ error: 'cross_origin', message: 'Requests must come from this site.' });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  next();
};
