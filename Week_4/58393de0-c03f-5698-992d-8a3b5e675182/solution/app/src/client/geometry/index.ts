import type { JobName, WorkerJobs, WorkerRequest, WorkerResponse } from "./types";

export type { MeshData, SolidResult } from "./types";
export { meshVolume, primitiveMesh } from "./mesh";

interface Pending {
  resolve: (output: WorkerJobs[JobName]["output"]) => void;
  reject: (error: Error) => void;
}

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, Pending>();

function failAll(message: string): void {
  for (const job of pending.values()) job.reject(new Error(message));
  pending.clear();
}

function geometryWorker(): Worker {
  if (worker) return worker;
  const created = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  created.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const response = event.data;
    const job = pending.get(response.id);
    if (!job) return;
    pending.delete(response.id);
    if (response.ok) job.resolve(response.output);
    else job.reject(new Error(response.message));
  };
  created.onerror = () => {
    failAll("The geometry worker stopped.");
    created.terminate();
    worker = null;
  };
  worker = created;
  return created;
}

/**
 * Runs one job in the geometry Web Worker. `resolveObject` gives a top-level object's mesh (a group is the union of its
 * solid children minus the union of its holes, turned by its rotationZ; null with no solid); `resolveDesign` and
 * `buildDesignFile` treat the whole design as one group; `buildCircuitFile` draws the 297 x 210 mm wiring diagram.
 * Equal inputs always give equal output.
 */
export function geometryJob<K extends JobName>(job: K, input: WorkerJobs[K]["input"]): Promise<WorkerJobs[K]["output"]> {
  return new Promise((resolve, reject) => {
    nextId += 1;
    const request = { id: nextId, job, input } as WorkerRequest;
    pending.set(nextId, { resolve: resolve as Pending["resolve"], reject });
    geometryWorker().postMessage(request);
  });
}

/** Starts the worker and its WebAssembly module so the first real job does not wait for them. */
export function warmUp(): void {
  void geometryJob("resolveDesign", []);
}
