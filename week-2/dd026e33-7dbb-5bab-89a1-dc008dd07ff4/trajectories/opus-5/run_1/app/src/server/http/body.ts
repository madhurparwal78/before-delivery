import type { IncomingMessage } from 'node:http';
import { JSON_BODY_LIMIT, UPLOAD_BODY_LIMIT } from '../config';
import { ApiError, ClientGone, fail } from './errors';

export function declaredLength(request: IncomingMessage): number | null {
  const header = request.headers['content-length'];
  if (typeof header !== 'string' || !/^\d+$/.test(header)) return null;
  return Number(header);
}

export function contentType(request: IncomingMessage): string {
  const header = request.headers['content-type'];
  return typeof header === 'string' ? header.toLowerCase() : '';
}

/** Reads a stream to the end, refusing anything past the limit. */
async function readToLimit(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const part = chunk as Buffer;
    total += part.length;
    if (total > limit) throw fail.payloadTooLarge();
    chunks.push(part);
  }
  if (!request.complete) throw new ClientGone();
  return Buffer.concat(chunks);
}

export async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const length = declaredLength(request);
  if (length !== null && length > JSON_BODY_LIMIT) throw fail.payloadTooLarge();
  if (length === 0) return {};
  const raw = await readToLimit(request, JSON_BODY_LIMIT);
  if (raw.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8')) as unknown;
  } catch {
    throw new ApiError(422, { errors: { body: 'Send a JSON object.' } });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ApiError(422, { errors: { body: 'Send a JSON object.' } });
  }
  return parsed as Record<string, unknown>;
}

export interface MultipartPart {
  readonly name: string;
  readonly filename: string | null;
  readonly contentType: string;
}

const CRLF = Buffer.from('\r\n');
const DOUBLE_CRLF = Buffer.from('\r\n\r\n');

/**
 * Walks a multipart body one part at a time, so an upload route can claim its stay
 * before the file bytes are read.
 */
export class MultipartReader {
  private buffer = Buffer.alloc(0);
  private readonly iterator: AsyncIterator<Buffer>;
  private readonly delimiter: Buffer;
  private readonly closing: Buffer;
  private finished = false;
  private started = false;
  private total = 0;

  constructor(
    private readonly request: IncomingMessage,
    boundary: string,
  ) {
    this.iterator = request[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
    this.delimiter = Buffer.from(`--${boundary}`);
    this.closing = Buffer.from(`--${boundary}--`);
  }

  private async pull(): Promise<boolean> {
    const next = await this.iterator.next();
    if (next.done === true) {
      if (!this.request.complete) throw new ClientGone();
      this.finished = true;
      return false;
    }
    const chunk = next.value;
    this.total += chunk.length;
    if (this.total > UPLOAD_BODY_LIMIT) throw fail.payloadTooLarge();
    this.buffer = Buffer.concat([this.buffer, chunk]);
    return true;
  }

  private async fill(until: (buffer: Buffer) => boolean): Promise<void> {
    while (!until(this.buffer)) {
      const more = await this.pull();
      if (!more) return;
    }
  }

  /** Advances to the next part, or null once the body is done. */
  async nextPart(): Promise<MultipartPart | null> {
    if (!this.started) {
      this.started = true;
      await this.fill((buffer) => buffer.indexOf(this.delimiter) >= 0);
      const start = this.buffer.indexOf(this.delimiter);
      if (start < 0) throw this.malformed();
      this.buffer = this.buffer.subarray(start);
    }
    await this.fill((buffer) => buffer.length >= this.closing.length + 2);
    if (this.buffer.subarray(0, this.closing.length).equals(this.closing)) return null;
    if (!this.buffer.subarray(0, this.delimiter.length).equals(this.delimiter)) {
      throw new ApiError(422, { errors: { file: 'Send one multipart body.' } });
    }
    this.buffer = this.buffer.subarray(this.delimiter.length);
    if (this.buffer.subarray(0, 2).equals(CRLF)) this.buffer = this.buffer.subarray(2);
    await this.fill((buffer) => buffer.indexOf(DOUBLE_CRLF) >= 0);
    const headerEnd = this.buffer.indexOf(DOUBLE_CRLF);
    if (headerEnd < 0) throw this.malformed();
    const headerText = this.buffer.subarray(0, headerEnd).toString('utf8');
    this.buffer = this.buffer.subarray(headerEnd + DOUBLE_CRLF.length);
    return parsePartHeaders(headerText);
  }

  /** Reads the current part fully into memory. */
  async readPart(): Promise<Buffer> {
    let searchFrom = 0;
    for (;;) {
      const marker = indexOfFrom(this.buffer, this.delimiter, searchFrom);
      if (marker >= 2) {
        const content = this.buffer.subarray(0, marker - 2);
        this.buffer = this.buffer.subarray(marker);
        return Buffer.from(content);
      }
      searchFrom = Math.max(0, this.buffer.length - this.delimiter.length - 2);
      const more = await this.pull();
      if (!more) throw this.malformed();
    }
  }

  /** A body that ran out without its boundary: a bad request, not a lost client. */
  private malformed(): ApiError | ClientGone {
    if (!this.request.complete) return new ClientGone();
    return new ApiError(422, { errors: { file: 'Send one multipart body.' } });
  }

  get bytesRead(): number {
    return this.total;
  }

  get done(): boolean {
    return this.finished;
  }
}

function indexOfFrom(haystack: Buffer, needle: Buffer, from: number): number {
  return haystack.indexOf(needle, from);
}

function parsePartHeaders(headerText: string): MultipartPart {
  let name = '';
  let filename: string | null = null;
  let type = 'application/octet-stream';
  for (const line of headerText.split('\r\n')) {
    const lower = line.toLowerCase();
    if (lower.startsWith('content-disposition:')) {
      const nameMatch = /name="([^"]*)"/i.exec(line);
      const fileMatch = /filename="([^"]*)"/i.exec(line);
      name = nameMatch?.[1] ?? '';
      filename = fileMatch?.[1] ?? null;
    } else if (lower.startsWith('content-type:')) {
      type = line.slice('content-type:'.length).trim().toLowerCase();
    }
  }
  return { name, filename, contentType: type };
}

export function multipartBoundary(request: IncomingMessage): string | null {
  const header = request.headers['content-type'];
  if (typeof header !== 'string') return null;
  if (!header.toLowerCase().includes('multipart/form-data')) return null;
  const match = /boundary=("?)([^";]+)\1/i.exec(header);
  return match?.[2] ?? null;
}
