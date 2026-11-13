import { Worker } from 'node:worker_threads';
import type { AnalyseFailure, AnalyseResult } from '../imageWorker.js';

/** The request thread's side of the image worker. */

export interface Analysis {
  width: number;
  height: number;
  swatch: string;
  display: Buffer | null;
}

export class UndecodablePhoto extends Error {
  constructor() {
    super('the photograph could not be decoded');
    this.name = 'UndecodablePhoto';
  }
}

type Pending = {
  resolve: (analysis: Analysis) => void;
  reject: (error: Error) => void;
};

const pending = new Map<number, Pending>();
let worker: Worker | null = null;
let nextId = 1;

function ensureWorker(): Worker {
  if (worker) return worker;
  const created = new Worker(new URL('./image-worker.js', import.meta.url));
  created.on('message', (message: AnalyseResult | AnalyseFailure) => {
    const waiting = pending.get(message.id);
    if (!waiting) return;
    pending.delete(message.id);
    if (message.ok) {
      waiting.resolve({
        width: message.width,
        height: message.height,
        swatch: message.swatch,
        display: message.display ? Buffer.from(message.display) : null,
      });
    } else {
      waiting.reject(new UndecodablePhoto());
    }
  });
  created.on('error', (error) => {
    for (const waiting of pending.values()) waiting.reject(error);
    pending.clear();
    worker = null;
  });
  created.unref();
  worker = created;
  return created;
}

/** Measures the swatch, and optionally makes the display crop, from the uploaded bytes. */
export function analysePhoto(
  bytes: Buffer,
  options: { point?: { x: number; y: number } | null; wantDisplayCrop: boolean },
): Promise<Analysis> {
  const id = nextId;
  nextId += 1;
  return new Promise<Analysis>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ensureWorker().postMessage({
      id,
      bytes: new Uint8Array(bytes),
      point: options.point ?? null,
      wantDisplayCrop: options.wantDisplayCrop,
    });
  });
}
