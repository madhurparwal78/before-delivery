import type { IncomingMessage } from 'node:http';

/** Standard response headers for API JSON and HTML. */
export function stdHeaders(): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store'
  };
}

export const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

export const MIME: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.ttf': 'font/ttf',
  '.html': 'text/html; charset=utf-8'
};

export function peerAddress(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? '?';
}
