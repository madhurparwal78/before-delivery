import { IncomingMessage } from 'node:http';

export interface ParsedBody {
  ok: boolean;
  value?: unknown;
  tooLarge?: boolean;
}

const MAX_DEPTH_NESTING = 16;

export function readBody(req: IncomingMessage, maxBytes: number): Promise<ParsedBody> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (result: ParsedBody): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        // Keep draining the socket so the response can still be sent.
        chunks.length = 0;
        finish({ ok: false, tooLarge: true });
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) {
        finish({ ok: false, tooLarge: true });
        return;
      }
      finish({ ok: true, value: Buffer.concat(chunks) });
    });
    req.on('error', () => {
      if (!settled) finish({ ok: false });
    });
    req.on('close', () => {
      if (!settled) finish({ ok: false });
    });
  });
}

export function parseJsonBody(bytes: Buffer): { ok: boolean; value?: unknown; invalid?: boolean; depthExceeded?: boolean } {
  const text = bytes.toString('utf8');
  if (text.trim() === '') return { ok: false, invalid: true };
  try {
    const value = JSON.parse(text) as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { ok: false, invalid: true };
    }
    if (depthOf(value) > MAX_DEPTH_NESTING) {
      return { ok: false, value, depthExceeded: true };
    }
    return { ok: true, value };
  } catch {
    return { ok: false, invalid: true };
  }
}

function depthOf(value: unknown): number {
  if (Array.isArray(value)) {
    let max = 1;
    for (const item of value) max = Math.max(max, 1 + depthOf(item));
    return max;
  }
  if (typeof value === 'object' && value !== null) {
    let max = 1;
    for (const [, item] of Object.entries(value)) max = Math.max(max, 1 + depthOf(item));
    return max;
  }
  return 1;
}

export function invalidFields(fields: Record<string, string>): { code: 'INVALID_FIELDS'; fields: Record<string, string> } {
  return { code: 'INVALID_FIELDS', fields };
}
