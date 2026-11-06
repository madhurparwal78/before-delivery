import type { ServerResponse } from 'node:http';

export type Result =
  | { kind: 'json'; status: number; body: unknown; headers?: Record<string, string> }
  | { kind: 'empty'; status: number; headers?: Record<string, string> }
  | {
      kind: 'binary';
      status: number;
      body: Buffer;
      contentType: string;
      headers?: Record<string, string>;
    };

export function json(status: number, body: unknown, headers?: Record<string, string>): Result {
  return headers ? { kind: 'json', status, body, headers } : { kind: 'json', status, body };
}

/** An idempotent replay, returned byte for byte as it was stored. */
export function storedJson(status: number, text: string): Result {
  return {
    kind: 'binary',
    status,
    body: Buffer.from(text, 'utf8'),
    contentType: 'application/json; charset=utf-8',
  };
}

/** Keeps only letters, digits, spaces, dots, hyphens and underscores. */
export function sanitiseFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const cleaned = [...base].filter((char) => /[A-Za-z0-9 ._-]/.test(char)).join('');
  return (cleaned.length > 0 ? cleaned : 'file').slice(0, 100);
}

export function write(response: ServerResponse, result: Result): void {
  const headers: Record<string, string> = {
    'cache-control': 'no-store',
    ...(result.headers ?? {}),
  };
  if (result.kind === 'json') {
    const payload = Buffer.from(JSON.stringify(result.body), 'utf8');
    headers['content-type'] = 'application/json; charset=utf-8';
    headers['content-length'] = String(payload.byteLength);
    response.writeHead(result.status, headers);
    response.end(payload);
    return;
  }
  if (result.kind === 'binary') {
    headers['content-type'] = result.contentType;
    headers['content-length'] = String(result.body.byteLength);
    response.writeHead(result.status, headers);
    response.end(result.body);
    return;
  }
  response.writeHead(result.status, headers);
  response.end();
}
