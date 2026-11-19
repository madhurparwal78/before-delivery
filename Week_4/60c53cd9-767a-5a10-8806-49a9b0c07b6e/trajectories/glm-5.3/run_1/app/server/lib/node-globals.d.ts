// Ambient types for the Node globals and built-in modules this app uses, kept
// in the repository so the build needs no extra type packages.

interface Buffer extends Uint8Array<ArrayBufferLike> {
  readonly buffer: ArrayBuffer;
  length: number;
  toString(encoding?: string, start?: number, end?: number): string;
  subarray(start?: number, end?: number): Buffer;
  slice(start?: number, end?: number): Buffer;
  indexOf(value: number | string, start?: number): number;
  set(target: ArrayLike<number>, offset?: number): number;
  copy(target: Uint8Array<ArrayBufferLike>, offset?: number): number;
  equals(other: Uint8Array<ArrayBufferLike>): boolean;
  readInt32BE(offset: number): number;
  readInt16BE(offset: number): number;
  readUInt16BE(offset: number): number;
  writeInt32BE(value: number, offset: number): number;
  writeInt16BE(value: number, offset: number): number;
  writeUInt32BE(value: number, offset: number): number;
  readUInt32BE(offset: number): number;
  writeUInt8(value: number, offset: number): number;
  readUInt8(offset: number): number;
  write(text: string, offset?: number, encoding?: string): number;
}

interface BufferConstructor {
  new (data: string | number[] | ArrayBufferLike | Uint8Array): Buffer;
  alloc(size: number, fill?: string | number): Buffer;
  from(data: string | number[] | ArrayBufferLike | Uint8Array, encoding?: string): Buffer;
  byteLength(text: string, encoding?: string): number;
  concat(parts: readonly Uint8Array[]): Buffer;
  isBuffer(value: unknown): value is Buffer;
}

declare const Buffer: BufferConstructor;

interface Process {
  env: Record<string, string | undefined>;
  argv: string[];
  platform: string;
  execPath: string;
  cwd(): string;
  exit(code?: number): void;
  on(event: string, listener: (...args: never[]) => void): Process;
  off(event: string, listener: (...args: never[]) => void): Process;
  hrtime: { bigint(): bigint };
  memoryUsage(): { rss: number };
}

declare const process: Process;
declare const performance: { now(): number };
declare const crypto: { randomUUID(): string };

declare function setTimeout(cb: (...args: never[]) => void, ms: number, ...args: never[]): unknown;
declare function clearTimeout(handle: unknown): void;
declare function setInterval(cb: () => void, ms: number): unknown;
declare function clearInterval(handle: unknown): void;
declare function queueMicrotask(cb: () => void): void;
declare function setImmediate(cb: () => void): unknown;
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void; warn(...args: unknown[]): void };

declare module 'node:crypto' {
  export interface Hash {
    update(data: string | Uint8Array<ArrayBufferLike>): Hash;
    digest(encoding: 'hex' | 'base64' | 'base64url' | 'latin1'): string;
    digest(): Buffer;
  }
  export interface Hmac {
    update(data: string | Uint8Array<ArrayBufferLike>): Hmac;
    digest(encoding: 'hex' | 'base64' | 'base64url' | 'latin1'): string;
    digest(): Buffer;
  }
  export function createHash(algorithm: 'md5' | 'sha256' | 'sha1'): Hash;
  export function createHmac(algorithm: 'sha256', key: string | Uint8Array<ArrayBufferLike>): Hmac;
  export function randomBytes(size: number): Buffer;
  export function timingSafeEqual(a: Uint8Array<ArrayBufferLike>, b: Uint8Array<ArrayBufferLike>): boolean;
  export function scryptSync(password: string | Uint8Array<ArrayBufferLike>, salt: string | Uint8Array<ArrayBufferLike>, keylen: number, options?: { N?: number; r?: number; p?: number }): Buffer;
}

declare module 'node:http' {
  export interface IncomingMessage {
    method?: string;
    url?: string;
    statusCode?: number;
    headers: Record<string, string | string[] | undefined>;
    socket: { remoteAddress?: string };
    on(event: 'data' | 'end' | 'error', listener: (chunk: Buffer) => void): void;
    resume(): void;
  }
  export interface ServerResponse {
    headersSent: boolean;
    writeHead(status: number, headers?: Record<string, string | string[] | number>): void;
    end(data?: Uint8Array | string): void;
  }
  export interface Server {
    listen(port: number, host: string, callback?: () => void): Server;
    keepAliveTimeout: number;
  }
  export interface ClientRequest {
    on(event: 'error', listener: (err: Error) => void): ClientRequest;
    write(chunk: Uint8Array): boolean;
    end(): void;
  }
  export function createServer(
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>,
  ): Server;
  export function request(
    options: { host?: string; hostname?: string; port?: number; method?: string; path?: string; headers?: Record<string, string | number | string[]> },
    callback: (res: IncomingMessage) => void,
  ): ClientRequest;
}

declare module 'node:net' {
  import * as net from 'net';
  export const connect: (port: number, host: string) => net.Socket;
  export type Socket = net.Socket;
}

declare module 'node:fs' {
  export function readFileSync(path: string): Buffer;
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function writeFileSync(path: string, data: string | Uint8Array): void;
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): string | undefined;
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
  export function statSync(path: string): { isFile(): boolean; isDirectory(): boolean; size: number };
  export function readdirSync(path: string, options?: { withFileTypes?: boolean; recursive?: boolean }): Array<{ name: string; isFile(): boolean; isDirectory(): boolean; parentPath?: string; path?: string } | string>;
  export function copyFileSync(from: string, to: string): void;
}

declare module 'node:path' {
  export const sep: string;
  export function resolve(...parts: string[]): string;
  export function join(...parts: string[]): string;
  export function dirname(path: string): string;
  export function basename(path: string): string;
  export function extname(path: string): string;
  export function relative(from: string, to: string): string;
  export function normalize(path: string): string;
}

declare module 'node:url' {
  export function fileURLToPath(url: string): string;
}

declare module 'node:querystring' {
  export function decode(text: string): Record<string, string | string[]>;
  export function encode(object: Record<string, string | string[]>): string;
}

declare module 'node:events' {
  export class EventEmitter {
    on(event: string, listener: (...args: never[]) => void): this;
    once(event: string, listener: (...args: never[]) => void): this;
    off(event: string, listener: (...args: never[]) => void): this;
    emit(event: string, ...args: never[]): boolean;
  }
}

declare module 'node:stream' {
  import { Readable, Writable, Transform, PassThrough } from 'stream';
  export { Readable, Writable, Transform, PassThrough };
}

declare module 'node:zlib' {
  export function gzipSync(data: Uint8Array): Buffer;
  export function gunzipSync(data: Uint8Array): Buffer;
  export function deflateRawSync(data: Uint8Array): Buffer;
  export function inflateRawSync(data: Uint8Array): Buffer;
}
