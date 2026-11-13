import { Worker } from "node:worker_threads";
import { type Measurement, type MeasureRequest } from "./pixels.js";

const MAX_CONCURRENT_DECODES = 2;
const DECODE_MEMORY_MB = 3072;

export class UndecodablePhoto extends Error {}

let running = 0;
const waiting: (() => void)[] = [];

async function turn(): Promise<void> {
  if (running >= MAX_CONCURRENT_DECODES) await new Promise<void>((resolve) => waiting.push(resolve));
  running += 1;
}

function finished(): void {
  running -= 1;
  waiting.shift()?.();
}

/** Runs one decode in a worker thread so decoding never stalls the server. */
async function inWorker<T>(data: unknown): Promise<T> {
  await turn();
  try {
    return await new Promise<T>((resolve, reject) => {
      const worker = new Worker(new URL("./imageWorker.js", import.meta.url), {
        workerData: data,
        resourceLimits: { maxOldGenerationSizeMb: DECODE_MEMORY_MB },
      });
      worker.once("message", (reply: { result: T } | { failure: string }) => {
        if ("result" in reply) resolve(reply.result);
        else reject(new UndecodablePhoto(reply.failure));
      });
      worker.once("error", (error: unknown) => reject(new UndecodablePhoto(String(error))));
      worker.once("exit", () => reject(new UndecodablePhoto("the decoder stopped")));
    });
  } finally {
    finished();
  }
}

/** Measures a photo in a worker thread. */
export function measurePhoto(request: MeasureRequest): Promise<Measurement> {
  return inWorker<Measurement>(request);
}

const SHRUNK_KEPT = 512;
const shrunk = new Map<string, Buffer>();

/** A display crop averaged down to one of the served widths, kept in memory once made (crops never change). */
export async function shrinkPhoto(key: string, bytes: Buffer, width: number): Promise<Buffer> {
  const cacheKey = `${key}:${bytes.length}:${width}`;
  const kept = shrunk.get(cacheKey);
  if (kept) return kept;
  let result: Buffer;
  try {
    result = Buffer.from(await inWorker<Uint8Array>({ shrink: { bytes, width } }));
  } catch {
    return bytes; // the full crop still shows; it is only larger than needed
  }
  if (shrunk.size >= SHRUNK_KEPT) shrunk.delete(shrunk.keys().next().value as string);
  shrunk.set(cacheKey, result);
  return result;
}
