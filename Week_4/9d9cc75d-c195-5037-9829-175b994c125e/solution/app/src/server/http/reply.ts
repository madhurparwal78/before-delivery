import type { IncomingMessage, ServerResponse } from 'node:http';

export type Reply =
  | { kind: 'data'; status: number; headers: Record<string, string>; body: Buffer | null }
  | { kind: 'stream'; open: (req: IncomingMessage, res: ServerResponse) => void };

export function json(status: number, value: unknown, headers: Record<string, string> = {}): Reply {
  return {
    kind: 'data',
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
    body: Buffer.from(JSON.stringify(value)),
  };
}

export function noContent(headers: Record<string, string> = {}): Reply {
  return { kind: 'data', status: 204, headers, body: null };
}

export function bytes(status: number, body: Buffer, contentType: string, headers: Record<string, string> = {}): Reply {
  return { kind: 'data', status, headers: { 'Content-Type': contentType, ...headers }, body };
}

/** The handler writes the stream itself; see `events/hub.ts` for the text/event-stream framing. */
export function stream(open: (req: IncomingMessage, res: ServerResponse) => void): Reply {
  return { kind: 'stream', open };
}
