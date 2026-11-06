// Image work runs off the request thread in a small pool of worker threads.
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import type { Derivatives, ImageJob, ImageResult } from "./image-worker.js";

type JobInput = ImageJob extends infer J ? (J extends ImageJob ? Omit<J, "id"> : never) : never;

interface Pending {
  resolve: (result: ImageResult) => void;
}

/** One thread per core beyond the request thread, between 2 and 4. */
const POOL_SIZE = Math.min(4, Math.max(2, availableParallelism() - 1));
const workers: Worker[] = [];
const waiting = new Map<number, Pending>();
let nextId = 1;
let turn = 0;

function worker(): Worker {
  if (workers.length < POOL_SIZE) {
    const w = new Worker(new URL("./image-worker.js", import.meta.url));
    w.on("message", (result: ImageResult) => {
      waiting.get(result.id)?.resolve(result);
      waiting.delete(result.id);
    });
    w.unref();
    workers.push(w);
    return w;
  }
  turn = (turn + 1) % workers.length;
  return workers[turn] as Worker;
}

function run(job: JobInput): Promise<ImageResult> {
  const id = nextId++;
  return new Promise((resolve) => {
    waiting.set(id, { resolve });
    worker().postMessage({ ...job, id });
  });
}

/** Decodes an original and renders its derivatives; null when it cannot be read as an image. */
export async function deriveFrame(bytes: Buffer, type: "image/jpeg" | "image/png"): Promise<Derivatives | null> {
  const result = await run({ kind: "derive", bytes: new Uint8Array(bytes), type });
  return result.ok ? result.derivatives : null;
}

export async function drawSeedFrame(essayId: string, position: number, width: number, height: number):
  Promise<{ original: Uint8Array; derivatives: Derivatives } | null> {
  const result = await run({ kind: "seed", essayId, position, width, height });
  return result.ok && result.original ? { original: result.original, derivatives: result.derivatives } : null;
}

/** JPEG starts FF D8 FF; PNG starts 89 50 4E 47 0D 0A 1A 0A. Nothing else is accepted. */
export function sniff(bytes: Buffer): "image/jpeg" | "image/png" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((b, i) => bytes[i] === b)) return "image/png";
  return null;
}
