import cluster from 'node:cluster';
import { config } from './config';
import { applySchemaAndSeed } from './db/seed';
import { waitForDatabase } from './db/pool';
import { startLive } from './events/live';
import { createApp } from './http/server';
import { storage } from './services/storage';

const WORKER_COUNT = 2;

async function runWorker(): Promise<void> {
  await waitForDatabase();
  await applySchemaAndSeed();
  storage.startProbing();
  startLive();
  createApp().listen(config.port, '0.0.0.0');
}

function runPrimary(): void {
  cluster.schedulingPolicy = cluster.SCHED_RR;
  const slots = new Map<number, string>();
  const spawn = (workerId: string): void => {
    const worker = cluster.fork({ KINFOLD_WORKER_ID: workerId });
    slots.set(worker.id, workerId);
  };
  for (let index = 1; index <= WORKER_COUNT; index += 1) spawn(String(index));
  cluster.on('exit', (worker) => {
    const workerId = slots.get(worker.id) ?? '1';
    slots.delete(worker.id);
    spawn(workerId);
  });
}

if (cluster.isPrimary) {
  runPrimary();
} else {
  void runWorker();
}
