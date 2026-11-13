import type { IncomingMessage } from 'node:http';

export type PartHeader = { name: string; filename: string | null; contentType: string | null };

export class MultipartMalformed extends Error {}

export const boundaryOf = (contentType: string | undefined): string | null => {
  if (contentType === undefined) return null;
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = match?.[1] ?? match?.[2];
  return boundary === undefined ? null : boundary.trim();
};

/**
 * A pull-based multipart/form-data reader: the file part is streamed out chunk by chunk so
 * uploaded bytes never gather on the app's disk or in one buffer.
 */
export class MultipartReader {
  private buffer = Buffer.alloc(0);
  private readonly iterator: AsyncIterator<Buffer>;
  private readonly delimiter: Buffer;
  private exhausted = false;
  private started = false;

  constructor(request: IncomingMessage, boundary: string) {
    this.iterator = request[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
    this.delimiter = Buffer.from(`\r\n--${boundary}`, 'utf8');
  }

  private async pull(): Promise<boolean> {
    if (this.exhausted) return false;
    const next = await this.iterator.next();
    if (next.done === true) {
      this.exhausted = true;
      return false;
    }
    this.buffer = Buffer.concat([this.buffer, next.value]);
    return true;
  }

  private async fill(minimum: number): Promise<void> {
    while (this.buffer.length < minimum) {
      if (!(await this.pull())) return;
    }
  }

  async nextPart(): Promise<PartHeader | null> {
    if (!this.started) {
      this.buffer = Buffer.concat([Buffer.from('\r\n', 'utf8'), this.buffer]);
      this.started = true;
    }
    let index = this.buffer.indexOf(this.delimiter);
    while (index === -1) {
      if (!(await this.pull())) throw new MultipartMalformed('no boundary');
      index = this.buffer.indexOf(this.delimiter);
    }
    this.buffer = this.buffer.subarray(index + this.delimiter.length);
    await this.fill(2);
    if (this.buffer.subarray(0, 2).toString('utf8') === '--') return null;
    this.buffer = this.buffer.subarray(2);

    let end = this.buffer.indexOf('\r\n\r\n');
    while (end === -1) {
      if (!(await this.pull())) throw new MultipartMalformed('no part headers');
      end = this.buffer.indexOf('\r\n\r\n');
    }
    const raw = this.buffer.subarray(0, end).toString('utf8');
    this.buffer = this.buffer.subarray(end + 4);

    let name = '';
    let filename: string | null = null;
    let contentType: string | null = null;
    for (const line of raw.split('\r\n')) {
      const colon = line.indexOf(':');
      if (colon === -1) continue;
      const header = line.slice(0, colon).trim().toLowerCase();
      const value = line.slice(colon + 1).trim();
      if (header === 'content-disposition') {
        name = /name="([^"]*)"/.exec(value)?.[1] ?? '';
        const star = /filename\*=UTF-8''([^;]*)/i.exec(value)?.[1];
        filename =
          star !== undefined
            ? decodeURIComponent(star)
            : (/filename="([^"]*)"/.exec(value)?.[1] ?? null);
      } else if (header === 'content-type') {
        contentType = value;
      }
    }
    return { name, filename, contentType };
  }

  /** Streams the current part's body, stopping at the boundary. */
  async streamPart(onChunk: (chunk: Buffer) => Promise<void>): Promise<number> {
    let total = 0;
    for (;;) {
      const index = this.buffer.indexOf(this.delimiter);
      if (index !== -1) {
        const chunk = this.buffer.subarray(0, index);
        this.buffer = this.buffer.subarray(index);
        if (chunk.length > 0) {
          total += chunk.length;
          await onChunk(chunk);
        }
        return total;
      }
      const keep = this.delimiter.length - 1;
      if (this.buffer.length > keep) {
        const chunk = this.buffer.subarray(0, this.buffer.length - keep);
        this.buffer = this.buffer.subarray(this.buffer.length - keep);
        total += chunk.length;
        await onChunk(chunk);
      }
      if (!(await this.pull())) throw new MultipartMalformed('part not terminated');
    }
  }

  async readPartText(limit: number): Promise<string> {
    const chunks: Buffer[] = [];
    let total = 0;
    await this.streamPart(async (chunk) => {
      total += chunk.length;
      if (total <= limit) chunks.push(chunk);
    });
    return Buffer.concat(chunks).toString('utf8');
  }
}
