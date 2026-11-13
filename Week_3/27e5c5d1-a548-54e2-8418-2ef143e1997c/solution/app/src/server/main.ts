import cluster from 'node:cluster';
import { runWorker } from './worker.ts';

const WORKERS = [1, 2];

if (cluster.isPrimary) {
  const byId = new Map<number, number>();
  let shuttingDown = false;
  const start = (number: number): void => {
    const worker = cluster.fork({ KINFOLD_WORKER: String(number) });
    byId.set(worker.id, number);
  };
  WORKERS.forEach(start);
  cluster.on('exit', (worker) => {
    const number = byId.get(worker.id);
    byId.delete(worker.id);
    if (number !== undefined && !shuttingDown) setTimeout(() => start(number), 500);
  });
  const stop = (): void => {
    shuttingDown = true;
    for (const worker of Object.values(cluster.workers ?? {})) worker?.kill('SIGTERM');
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
} else {
  process.on('unhandledRejection', () => undefined);
  runWorker().catch(() => process.exit(1));
}
