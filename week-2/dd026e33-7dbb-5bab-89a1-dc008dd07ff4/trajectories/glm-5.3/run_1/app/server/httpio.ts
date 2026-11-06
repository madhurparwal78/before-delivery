import type { IncomingMessage } from 'node:http';

import { ERRORS, ApiError } from './errors.ts';

export const JSON_BODY_LIMIT = 100_000;
export const UPLOAD_BODY_LIMIT = 10_000_000;

export class ClientGone extends Error {}

export interface JsonBody {
  json: unknown;
  raw: string;
}

export interface MultipartFile {
  filename: string;
  contentType: string;
  data: Buffer;
}

export interface MultipartResult {
  fields: Record<string, string>;
  file: MultipartFile | null;
}

interface PartHeader {
  name: string;
  filename?: string;
  contentType: string;
}

interface MultipartState {
  buffer: Buffer;
  phase: 'boundary' | 'headers' | 'body';
  part: PartHeader | null;
}

/**
 * Streaming multipart/form-data parser. Calls onChunk as file bytes arrive so
 * an abandoned upload can be aborted without buffering the whole body.
 */
export async function readMultipart(
  req: IncomingMessage,
  onChunk: (chunk: Buffer, file: MultipartFile | null) => Promise<void>,
): Promise<MultipartResult> {
  const declared = Number(req.headers['content-length'] ?? '0');
  if (Number.isFinite(declared) && declared > UPLOAD_BODY_LIMIT) {
    throw ERRORS.payloadTooLarge();
  }
  const contentType = req.headers['content-type'] ?? '';
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!contentType.includes('multipart/form-data') || !match) {
    throw ERRORS.unsupportedMediaType();
  }
  const boundary = Buffer.from(`--${(match[1] ?? match[2] ?? '').trim()}`);
  const fields: Record<string, string> = {};
  const file: { current: MultipartFile | null } = { current: null };
  const state: MultipartState = { buffer: Buffer.alloc(0), phase: 'boundary', part: null };
  let size = 0;
  let clientGone = false;
  req.once('aborted', () => {
    clientGone = true;
  });

  const emitBody = async (chunk: Buffer): Promise<void> => {
    const part = state.part;
    if (!part) return;
    if (part.filename !== undefined) {
      size += chunk.length;
      if (size > UPLOAD_BODY_LIMIT) {
        req.destroy();
        throw ERRORS.payloadTooLarge();
      }
      if (file.current) {
        file.current.data = Buffer.concat([file.current.data, chunk]);
        await onChunk(chunk, file.current);
      }
    } else {
      fields[part.name] = (fields[part.name] ?? '') + chunk.toString('utf8');
    }
  };

  const consume = async (chunk: Buffer): Promise<void> => {
    state.buffer = Buffer.concat([state.buffer, chunk]);
    for (;;) {
      if (state.phase === 'boundary') {
        // after a part (or at the start) the next delimiter must appear
        const idx = state.buffer.indexOf(boundary);
        if (idx === -1) {
          state.buffer = state.buffer.slice(Math.max(0, state.buffer.length - boundary.length));
          return;
        }
        const after = state.buffer.slice(idx + boundary.length);
        if (after.length >= 2 && after[0] === 0x2d && after[1] === 0x2d) {
          // the closing delimiter; the body is complete
          state.buffer = Buffer.alloc(0);
          state.part = null;
          return;
        }
        // skip the CRLF that follows a delimiter, then read part headers
        const withoutCrLf = after.length >= 2 && after[0] === 0x0d && after[1] === 0x0a ? after.slice(2) : after;
        state.buffer = withoutCrLf;
        state.phase = 'headers';
        continue;
      }
      if (state.phase === 'headers') {
        const headEnd = state.buffer.indexOf('\r\n\r\n');
        if (headEnd === -1) {
          if (state.buffer.length > 64 * 1024) throw ERRORS.payloadTooLarge();
          return;
        }
        const headerText = state.buffer.slice(0, headEnd).toString('utf8');
        const part = parsePartHeader(headerText);
        state.part = part;
        if (part.filename !== undefined) {
          file.current = {
            filename: part.filename,
            contentType: part.contentType || 'application/octet-stream',
            data: Buffer.alloc(0),
          };
        } else {
          fields[part.name] = '';
        }
        state.buffer = state.buffer.slice(headEnd + 4);
        state.phase = 'body';
        continue;
      }
      // body phase: everything up to the next delimiter belongs to this part
      const idx = state.buffer.indexOf(boundary);
      const candidate = idx === -1 ? state.buffer : state.buffer.slice(0, idx);
      const bodyChunk = idx === -1
        ? candidate
        : candidate.slice(0, Math.max(0, candidate.length - 2)); // strip the trailing CRLF
      if (bodyChunk.length > 0) {
        await emitBody(bodyChunk);
      }
      if (idx === -1) {
        // keep a tail that could hold the start of the next delimiter
        state.buffer = state.buffer.slice(Math.max(0, state.buffer.length - boundary.length));
        return;
      }
      state.buffer = state.buffer.slice(idx);
      state.part = null;
      state.phase = 'boundary';
    }
  };

  try {
    for await (const chunk of req) {
      if (clientGone) throw new ClientGone();
      await consume(chunk as Buffer);
    }
  } catch (err) {
    if (err instanceof ApiError || err instanceof ClientGone) throw err;
    throw new ClientGone();
  }
  return { fields, file: file.current };
}

function parsePartHeader(text: string): PartHeader {
  const lines = text.split('\r\n');
  const disposition = lines.find((line) => line.toLowerCase().startsWith('content-disposition:'));
  const contentTypeLine = lines.find((line) => line.toLowerCase().startsWith('content-type:'));
  let name = '';
  let filename: string | undefined;
  if (disposition) {
    const nameMatch = /name="([^"]*)"/.exec(disposition);
    const fileMatch = /filename="([^"]*)"/.exec(disposition);
    name = nameMatch?.[1] ?? '';
    if (fileMatch) filename = fileMatch[1];
  }
  const contentType = contentTypeLine ? contentTypeLine.slice(contentTypeLine.indexOf(':') + 1).trim() : '';
  return { name, filename, contentType };
}
export async function readJsonBody(req: IncomingMessage): Promise<JsonBody> {
  const declared = Number(req.headers['content-length'] ?? '0');
  if (Number.isFinite(declared) && declared > JSON_BODY_LIMIT) {
    throw ERRORS.payloadTooLarge();
  }
  const contentType = req.headers['content-type'] ?? '';
  if (!contentType.includes('application/json')) {
    throw ERRORS.unsupportedMediaType();
  }
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > JSON_BODY_LIMIT) {
        req.destroy();
        throw ERRORS.payloadTooLarge();
      }
      chunks.push(chunk as Buffer);
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ClientGone();
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  let json: unknown;
  try {
    json = raw === '' ? {} : JSON.parse(raw);
  } catch {
    throw ERRORS.unsupportedMediaType();
  }
  return { json, raw };
}

