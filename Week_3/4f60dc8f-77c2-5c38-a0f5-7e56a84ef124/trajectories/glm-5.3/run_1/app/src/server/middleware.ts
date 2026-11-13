import type { Request, Response, NextFunction } from 'express';
import type { App } from './app';
import { ApiError, errorBody } from './errors';
import { newId, randomToken, sha256 } from './domain';

export interface ClientSession {
  sessionId: string;
  brandId: string;
  contactId: string;
  contactEmail: string;
  contactName: string;
}

export async function readClientSession(app: App, req: Request): Promise<ClientSession | null> {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) {
    return null;
  }
  const token = parseCookie(cookieHeader, 'gw_session');
  if (!token) {
    return null;
  }
  const result = await app.pool.query(
    `SELECT s.id AS session_id, s.brand_id, s.contact_id, s.expires_at, c.email, c.name
     FROM sessions s JOIN contacts c ON c.id = s.contact_id
     WHERE s.token = $1 AND s.kind = 'client' AND s.expires_at > now()`,
    [sha256(token)],
  );
  if (result.rows.length === 0) {
    return null;
  }
  const row = result.rows[0];
  return {
    sessionId: row.session_id,
    brandId: row.brand_id,
    contactId: row.contact_id,
    contactEmail: row.email,
    contactName: row.name,
  };
}

export async function readStudioSession(app: App, req: Request): Promise<boolean> {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) {
    return false;
  }
  const token = parseCookie(cookieHeader, 'gw_studio');
  if (!token) {
    return false;
  }
  const result = await app.pool.query(
    `SELECT 1 FROM sessions WHERE token = $1 AND kind = 'studio' AND expires_at > now()`,
    [sha256(token)],
  );
  return result.rows.length > 0;
}

export function parseCookie(header: string, name: string): string | null {
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      return decodeURIComponent(rest.join('='));
    }
  }
  return null;
}

export async function createClientSession(app: App, brandId: string, contactId: string): Promise<string> {
  const token = randomToken(32);
  const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  await app.pool.query(
    `INSERT INTO sessions (id, token, brand_id, contact_id, kind, expires_at) VALUES ($1, $2, $3, $4, 'client', $5)`,
    [newId(), sha256(token), brandId, contactId, expires.toISOString()],
  );
  return token;
}

export async function createStudioSession(app: App): Promise<string> {
  const token = randomToken(32);
  const expires = new Date(Date.now() + 12 * 3600 * 1000);
  await app.pool.query(
    `INSERT INTO sessions (id, token, kind, expires_at) VALUES ($1, $2, 'studio', $3)`,
    [newId(), sha256(token), expires.toISOString()],
  );
  return token;
}

export function setCookie(res: Response, name: string, value: string): void {
  res.setHeader('Set-Cookie', `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 24 * 3600}`);
}

export function clearCookie(res: Response, name: string): void {
  res.setHeader('Set-Cookie', `${name}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

export function requireClient(app: App) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const session = await readClientSession(app, req);
      if (!session) {
        throw new ApiError('unauthenticated');
      }
      (req as unknown as { session: ClientSession }).session = session;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireStudio(app: App) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const valid = await readStudioSession(app, req);
      if (!valid) {
        throw new ApiError('unauthenticated');
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Cross-origin writes are refused, and JSON bodies are capped at 65,536 bytes. */
export function boundaryMiddleware(app: App) {
  const JSON_LIMIT = 65_536;
  return (req: Request, res: Response, next: NextFunction): void => {
    const method = req.method.toUpperCase();
    const stateChanging = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
    if (stateChanging) {
      const origin = req.headers.origin;
      if (origin) {
        const allowed = new Set([`http://127.0.0.1:${app.config.port}`, `http://localhost:${app.config.port}`, app.config.publicUrl]);
        if (!allowed.has(origin)) {
          res.status(403).json(errorBody(new ApiError('cross_origin')));
          return;
        }
      }
      const contentType = req.headers['content-type'] ?? '';
      if (contentType.includes('application/json')) {
        const length = Number(req.headers['content-length'] ?? '0');
        if (Number.isFinite(length) && length > JSON_LIMIT) {
          res.status(413).json(errorBody(new ApiError('payload_too_large')));
          return;
        }
      }
    }
    next();
  };
}

export function errorHandler(_error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const error = _error instanceof ApiError ? _error : new ApiError('not_found');
  if (error.headers) {
    for (const [key, value] of Object.entries(error.headers)) {
      res.setHeader(key, value);
    }
  }
  res.status(error.status).json(errorBody(error));
}
