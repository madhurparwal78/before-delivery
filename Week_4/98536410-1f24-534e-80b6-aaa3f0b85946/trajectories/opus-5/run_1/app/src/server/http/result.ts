export type ApiResult =
  | { kind: 'json'; status: number; body: unknown; headers?: Record<string, string> }
  | {
      kind: 'raw';
      status: number;
      body: Buffer;
      contentType: string;
      headers?: Record<string, string>;
    };

export function json(
  body: unknown,
  status = 200,
  headers?: Record<string, string>,
): ApiResult {
  return headers ? { kind: 'json', status, body, headers } : { kind: 'json', status, body };
}

export function raw(body: Buffer, contentType: string, status = 200): ApiResult {
  return { kind: 'raw', status, body, contentType };
}

export function noContent(headers?: Record<string, string>): ApiResult {
  return headers
    ? { kind: 'json', status: 204, body: null, headers }
    : { kind: 'json', status: 204, body: null };
}
