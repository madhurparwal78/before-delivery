// Minimal cookie parsing for the session cookie.
import type { Request, Response, NextFunction } from 'express';

declare module 'http' {
  interface IncomingMessage {
    cookies?: Record<string, string>;
  }
}

export function cookieParser(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.cookie ?? '';
  const cookies: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }
  req.cookies = cookies;
  next();
}
