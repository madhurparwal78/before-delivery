import type { ServerResponse } from 'node:http';

const SAFE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
} as const;

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    ...SAFE_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  response.end(text);
}

export function sendEmpty(response: ServerResponse, status: number): void {
  response.writeHead(status, { ...SAFE_HEADERS, 'Cache-Control': 'no-store' });
  response.end();
}

export function sendBytes(
  response: ServerResponse,
  status: number,
  body: Buffer,
  contentType: string,
  extra: Record<string, string> = {},
): void {
  response.writeHead(status, {
    ...SAFE_HEADERS,
    'Content-Type': contentType,
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    ...extra,
  });
  response.end(body);
}

export function sendHtml(response: ServerResponse, status: number, html: string): void {
  response.writeHead(status, {
    ...SAFE_HEADERS,
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    'Cache-Control': 'no-store',
  });
  response.end(html);
}

export function redirect(response: ServerResponse, to: string): void {
  response.writeHead(302, { ...SAFE_HEADERS, Location: to, 'Cache-Control': 'no-store' });
  response.end();
}
