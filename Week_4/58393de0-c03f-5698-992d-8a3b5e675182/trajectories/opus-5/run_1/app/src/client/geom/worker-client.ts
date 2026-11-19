import type { CircuitComponent, CircuitWire, SceneObject } from '../../shared/types.js';
import type { ExportReply, GroupReply, WorkerReply, WorkerRequest } from '../workers/geometry.worker.js';

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, (reply: WorkerReply) => void>();

const ensureWorker = (): Worker => {
  if (worker) return worker;
  worker = new Worker('/geometry-worker.js');
  worker.addEventListener('message', (event: MessageEvent<WorkerReply>) => {
    const reply = event.data;
    const resolve = waiting.get(reply.id);
    if (resolve) {
      waiting.delete(reply.id);
      resolve(reply);
    }
  });
  return worker;
};

type Unidentified<T> = T extends { id: number } ? Omit<T, 'id'> : never;

const ask = <R extends WorkerReply>(request: Unidentified<WorkerRequest>): Promise<R> =>
  new Promise<R>((resolve) => {
    const id = nextId;
    nextId += 1;
    waiting.set(id, (reply) => resolve(reply as R));
    ensureWorker().postMessage({ ...request, id } as WorkerRequest);
  });

/** Grouping runs in a Web Worker. */
export const groupInWorker = (members: SceneObject[]): Promise<GroupReply> =>
  ask<GroupReply>({ type: 'group', members });

/** Export files are built in a Web Worker. */
export const exportInWorker = (input: {
  format: 'stl' | 'obj' | 'svg';
  unit: 'mm' | 'in';
  name: string;
  objects: SceneObject[];
  components?: CircuitComponent[];
  wires?: CircuitWire[];
}): Promise<ExportReply> => ask<ExportReply>({ type: 'export', ...input });
