/**
 * Server boundary: one place checks payload size, content type, and
 * cross-origin writes, before any session lookup.
 */
import { IncomingMessage } from 'node:http';
import { ApiError } from '../shared/errors.js';

const MAX_BODY = 1_000_000;

export interface BodyRead {
  text: string;
  tooLarge: boolean;
}

export async function readBody(req: IncomingMessage): Promise<BodyRead> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (tooLarge) return;
      if (size > MAX_BODY) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve({ text: tooLarge ? '' : Buffer.concat(chunks).toString('utf8'), tooLarge }));
    req.on('error', () => resolve({ text: tooLarge ? '' : Buffer.concat(chunks).toString('utf8'), tooLarge }));
  });
}

const sameOrigin = (origin: string, host: string): boolean => {
  try {
    const url = new URL(origin);
    const expected = `http://${host}`;
    const hostUrl = new URL(expected);
    return (
      url.protocol === hostUrl.protocol &&
      url.hostname === hostUrl.hostname &&
      (url.port || (url.protocol === 'https:' ? '443' : '80')) ===
        (hostUrl.port || (hostUrl.protocol === 'https:' ? '443' : '80'))
    );
  } catch {
    return false;
  }
};

const publicOriginOk = (origin: string, publicUrl: string): boolean => {
  try {
    const a = new URL(origin);
    const b = new URL(publicUrl);
    return a.origin === b.origin;
  } catch {
    return false;
  }
};

/** The boundary checks, in order, before any session lookup. */
export function boundaryCheck(
  req: IncomingMessage,
  isStateChanging: boolean,
  publicUrl: string,
): { tooLarge: boolean; error: ApiError | null } {
  // size and content type are checked by the caller with the body read result
  if (isStateChanging) {
    const origin = req.headers.origin;
    const host = String(req.headers.host ?? '');
    if (origin !== undefined) {
      if (origin === 'null') {
        return { tooLarge: false, error: new ApiError(403, 'cross_origin', 'This request came from another site.') };
      }
      const originOk = sameOrigin(origin, host) || publicOriginOk(origin, publicUrl);
      if (!originOk) {
        return { tooLarge: false, error: new ApiError(403, 'cross_origin', 'This request came from another site.') };
      }
    } else {
      const fetchSite = req.headers['sec-fetch-site'];
      if (fetchSite === 'cross-site' || fetchSite === 'same-site') {
        return { tooLarge: false, error: new ApiError(403, 'cross_origin', 'This request came from another site.') };
      }
    }
  }
  return { tooLarge: false, error: null };
}

export function contentTypeCheck(req: IncomingMessage): ApiError | null {
  const type = req.headers['content-type'];
  if (type === undefined) return null;
  const base = type.split(';')[0]!.trim().toLowerCase();
  if (base !== 'application/json') {
    return new ApiError(415, 'unsupported_media_type', 'Send application/json.');
  }
  return null;
}

export const payloadTooLarge = (): ApiError =>
  new ApiError(413, 'payload_too_large', 'The request body is too large.');
