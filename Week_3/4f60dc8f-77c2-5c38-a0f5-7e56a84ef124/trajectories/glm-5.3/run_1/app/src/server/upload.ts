import type { Request } from 'express';
import { ApiError } from './errors';

/**
 * Streaming multipart parser for intake uploads. The size cap is enforced
 * while the body streams in, so an oversize body stops being read, and
 * the file's bytes are never written to local disk.
 */

export interface UploadedFile {
  name: string;
  data: Buffer;
  length: number;
}

export interface UploadResult {
  file: UploadedFile | null;
  fileKind: 'model' | 'step' | 'reference' | null;
}

export interface ParseOptions {
  maxFileBytes: number;
  onFileStart?: (fileName: string) => string;
  sniff?: (name: string, head: Buffer) => 'model' | 'step' | 'reference' | null;
  caps?: Record<string, number>;
  validateGlb?: (buffer: Buffer) => ApiError | null;
}

interface ParserState {
  buffer: Buffer;
  phase: 'start' | 'headers' | 'body' | 'skip' | 'done';
  headerText: string;
  fileName: string | null;
  chunks: Buffer[];
  total: number;
}

export class UploadAborted extends Error {
  readonly error: ApiError;

  constructor(error: ApiError) {
    super(error.code);
    this.error = error;
  }
}

export function createMultipartParser(boundary: string): ParserState {
  return {
    buffer: Buffer.alloc(0),
    phase: 'start',
    headerText: '',
    fileName: null,
    chunks: [],
    total: 0,
  };
}

/**
 * Feed one chunk into the parser. Returns 'overflow' when the file part
 * crosses its cap, 'file' when a complete file part has been seen, and
 * null when more data is needed.
 */
export function feedChunk(state: ParserState, chunk: Buffer, boundary: string, cap: number): 'overflow' | 'file' | null {
  const delim = Buffer.from(`--${boundary}`);
  state.buffer = state.buffer.length === 0 ? chunk : Buffer.concat([state.buffer, chunk]);
  while (true) {
    if (state.phase === 'start') {
      const index = state.buffer.indexOf(delim);
      if (index === -1) {
        // Discard preamble bytes that cannot contain the delimiter.
        if (state.buffer.length > delim.length) {
          state.buffer = state.buffer.subarray(state.buffer.length - delim.length);
        }
        return null;
      }
      state.buffer = state.buffer.subarray(index + delim.length);
      if (state.buffer.subarray(0, 2).toString('latin1') === '--') {
        state.phase = 'done';
        state.buffer = Buffer.alloc(0);
        return null;
      }
      if (state.buffer.subarray(0, 2).toString('latin1') === '\r\n') {
        state.buffer = state.buffer.subarray(2);
      }
      state.phase = 'headers';
      state.headerText = '';
      continue;
    }
    if (state.phase === 'headers') {
      const end = state.buffer.indexOf(Buffer.from('\r\n\r\n'));
      if (end === -1) {
        if (state.buffer.length > 4) {
          state.headerText += state.buffer.subarray(0, state.buffer.length - 4).toString('utf8');
          state.buffer = state.buffer.subarray(state.buffer.length - 4);
        }
        return null;
      }
      state.headerText += state.buffer.subarray(0, end).toString('utf8');
      const match = /filename="([^"]*)"/.exec(state.headerText);
      state.fileName = match ? match[1] : null;
      state.buffer = state.buffer.subarray(end + 4);
      state.phase = state.fileName ? 'body' : 'skip';
      continue;
    }
    if (state.phase === 'body' || state.phase === 'skip') {
      const index = state.buffer.indexOf(delim);
      if (index === -1) {
        const keep = Math.min(state.buffer.length, delim.length + 1);
        const emit = state.buffer.subarray(0, state.buffer.length - keep);
        if (state.phase === 'body') {
          state.total += emit.length;
          if (state.total > cap) {
            return 'overflow';
          }
          if (emit.length > 0) {
            state.chunks.push(emit);
          }
        }
        state.buffer = state.buffer.subarray(state.buffer.length - keep);
        return null;
      }
      let body = state.buffer.subarray(0, index);
      if (state.phase === 'body') {
        if (body.length >= 2 && body.subarray(body.length - 2).toString('latin1') === '\r\n') {
          body = body.subarray(0, body.length - 2);
        }
        state.total += body.length;
        if (state.total > cap) {
          return 'overflow';
        }
        if (body.length > 0) {
          state.chunks.push(body);
        }
      }
      state.buffer = state.buffer.subarray(index + delim.length);
      if (state.buffer.subarray(0, 2).toString('latin1') === '--') {
        state.phase = 'done';
        return state.fileName ? 'file' : null;
      }
      if (state.buffer.subarray(0, 2).toString('latin1') === '\r\n') {
        state.buffer = state.buffer.subarray(2);
        state.phase = 'headers';
        state.headerText = '';
        state.fileName = null;
        continue;
      }
      continue;
    }
    return null;
  }
}

export async function parseMultipartStream(req: Request, boundary: string, options: ParseOptions): Promise<UploadResult> {
  return new Promise<UploadResult>((resolve, reject) => {
    const state = createMultipartParser(boundary);
    let aborted = false;
    let displayName: string | null = null;

    const abortWith = (error: ApiError): void => {
      if (aborted) {
        return;
      }
      aborted = true;
      req.removeAllListeners('data');
      req.removeAllListeners('end');
      req.removeAllListeners('error');
      req.destroy();
      reject(error);
    };

    req.on('data', (chunk: Buffer) => {
      if (aborted) {
        return;
      }
      const result = feedChunk(state, chunk, boundary, options.maxFileBytes);
      if (result === 'overflow') {
        abortWith(new ApiError('file_too_large'));
        return;
      }
      if (result === 'file' && state.fileName && displayName === null) {
        displayName = options.onFileStart ? options.onFileStart(state.fileName) : state.fileName;
      }
    });

    req.on('end', () => {
      if (aborted) {
        return;
      }
      const data = Buffer.concat(state.chunks);
      if (!displayName || !state.fileName || data.length === 0) {
        reject(new ApiError('file_type_mismatch'));
        return;
      }
      const kind = options.sniff ? options.sniff(displayName, data.subarray(0, 64)) : null;
      if (kind === null) {
        reject(new ApiError('file_type_mismatch'));
        return;
      }
      const cap = options.caps?.[kind] ?? options.maxFileBytes;
      if (data.length > cap) {
        reject(new ApiError('file_too_large'));
        return;
      }
      if (kind === 'model' && options.validateGlb) {
        const error = options.validateGlb(data);
        if (error) {
          reject(error);
          return;
        }
      }
      resolve({
        file: { name: displayName, data, length: data.length },
        fileKind: kind,
      });
    });

    req.on('error', (error) => {
      if (aborted) {
        return;
      }
      reject(error instanceof ApiError ? error : new ApiError('not_found'));
    });
  });
}
