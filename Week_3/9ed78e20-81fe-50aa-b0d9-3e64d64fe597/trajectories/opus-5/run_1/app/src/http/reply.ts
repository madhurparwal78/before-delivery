import type { Raw } from './html.js';

export type Reply = {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Buffer;
  readonly json: unknown;
};

function build(
  status: number,
  contentType: string | null,
  body: Buffer,
  headers: Readonly<Record<string, string>>,
  json: unknown,
): Reply {
  const merged: Record<string, string> = { ...headers };
  if (contentType !== null) merged['Content-Type'] = contentType;
  return { status, headers: merged, body, json };
}

export function jsonReply(
  status: number,
  payload: unknown,
  headers: Readonly<Record<string, string>> = {},
): Reply {
  return build(
    status,
    'application/json; charset=utf-8',
    Buffer.from(JSON.stringify(payload), 'utf8'),
    headers,
    payload,
  );
}

export function htmlReply(
  status: number,
  markup: Raw,
  headers: Readonly<Record<string, string>> = {},
): Reply {
  return build(
    status,
    'text/html; charset=utf-8',
    Buffer.from(markup.value, 'utf8'),
    headers,
    undefined,
  );
}

export function textReply(
  status: number,
  contentType: string,
  text: string,
  headers: Readonly<Record<string, string>> = {},
): Reply {
  return build(status, contentType, Buffer.from(text, 'utf8'), headers, undefined);
}

export function bytesReply(
  status: number,
  contentType: string,
  body: Buffer,
  headers: Readonly<Record<string, string>> = {},
): Reply {
  return build(status, contentType, body, headers, undefined);
}

export function noContentReply(headers: Readonly<Record<string, string>> = {}): Reply {
  return build(204, null, Buffer.alloc(0), headers, undefined);
}

export function redirectReply(
  location: string,
  headers: Readonly<Record<string, string>> = {},
): Reply {
  return build(303, null, Buffer.alloc(0), { ...headers, Location: location }, undefined);
}
