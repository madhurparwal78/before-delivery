import { tooLarge } from './errors';

export interface PartLimit {
  limit: number;
  message: string;
}

export interface MultipartPart {
  name: string;
  filename: string | null;
  contentType: string | null;
  bytes: Buffer;
}

interface OpenPart {
  name: string;
  filename: string | null;
  contentType: string | null;
  chunks: Buffer[];
  size: number;
}

/** Reads multipart bodies incrementally so a part over its limit is refused as it streams. */
export class MultipartParser {
  private state: 'preamble' | 'afterDelimiter' | 'headers' | 'body' | 'done' = 'preamble';
  private buffer: Buffer = Buffer.alloc(0);
  private open: OpenPart | null = null;
  private readonly delimiter: Buffer;
  private readonly firstDelimiter: Buffer;

  readonly parts = new Map<string, MultipartPart>();
  malformed = false;

  constructor(
    boundary: string,
    private readonly limits: Record<string, PartLimit>,
  ) {
    this.delimiter = Buffer.from(`\r\n--${boundary}`);
    this.firstDelimiter = Buffer.from(`--${boundary}`);
  }

  push(chunk: Buffer): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    this.run();
  }

  end(): void {
    if (this.state !== 'done') this.malformed = true;
  }

  private run(): void {
    for (;;) {
      if (this.state === 'done') return;
      if (this.state === 'preamble') {
        const index = this.buffer.indexOf(this.firstDelimiter);
        if (index < 0) return;
        this.buffer = this.buffer.subarray(index + this.firstDelimiter.length);
        this.state = 'afterDelimiter';
        continue;
      }
      if (this.state === 'afterDelimiter') {
        if (this.buffer.length < 2) return;
        if (this.buffer.subarray(0, 2).toString() === '--') {
          this.state = 'done';
          return;
        }
        this.buffer = this.buffer.subarray(2);
        this.state = 'headers';
        continue;
      }
      if (this.state === 'headers') {
        const end = this.buffer.indexOf('\r\n\r\n');
        if (end < 0) return;
        const headerText = this.buffer.subarray(0, end).toString('utf8');
        this.buffer = this.buffer.subarray(end + 4);
        this.open = this.readHeaders(headerText);
        this.state = 'body';
        continue;
      }
      const index = this.buffer.indexOf(this.delimiter);
      if (index < 0) {
        const keep = this.delimiter.length;
        if (this.buffer.length > keep) {
          this.collect(this.buffer.subarray(0, this.buffer.length - keep));
          this.buffer = this.buffer.subarray(this.buffer.length - keep);
        }
        return;
      }
      this.collect(this.buffer.subarray(0, index));
      this.finish();
      this.buffer = this.buffer.subarray(index + this.delimiter.length);
      this.state = 'afterDelimiter';
    }
  }

  private readHeaders(headerText: string): OpenPart {
    let name = '';
    let filename: string | null = null;
    let contentType: string | null = null;
    for (const line of headerText.split('\r\n')) {
      const colon = line.indexOf(':');
      if (colon < 0) continue;
      const header = line.slice(0, colon).trim().toLowerCase();
      const value = line.slice(colon + 1).trim();
      if (header === 'content-disposition') {
        name = /name="([^"]*)"/.exec(value)?.[1] ?? '';
        filename = /filename="([^"]*)"/.exec(value)?.[1] ?? null;
      } else if (header === 'content-type') {
        contentType = value;
      }
    }
    if (name === '') this.malformed = true;
    return { name, filename, contentType, chunks: [], size: 0 };
  }

  private collect(bytes: Buffer): void {
    const open = this.open;
    if (!open || bytes.length === 0) return;
    open.size += bytes.length;
    const limit = this.limits[open.name];
    if (limit && open.size > limit.limit) throw tooLarge(limit.message);
    open.chunks.push(Buffer.from(bytes));
  }

  private finish(): void {
    const open = this.open;
    if (!open) return;
    this.parts.set(open.name, {
      name: open.name,
      filename: open.filename,
      contentType: open.contentType,
      bytes: Buffer.concat(open.chunks),
    });
    this.open = null;
  }
}

export function boundaryOf(contentType: string | undefined): string | null {
  if (!contentType || !contentType.toLowerCase().includes('multipart/form-data')) return null;
  const match = /boundary="?([^";]+)"?/i.exec(contentType);
  return match ? (match[1] as string) : null;
}

export function partText(part: MultipartPart | undefined): string | null {
  return part ? part.bytes.toString('utf8') : null;
}
