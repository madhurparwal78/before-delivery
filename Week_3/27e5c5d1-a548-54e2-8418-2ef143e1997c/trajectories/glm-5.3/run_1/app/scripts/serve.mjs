// Serve script: exactly two web worker processes sharing one listening socket.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

const port = Number.parseInt(process.env.APP_PUBLIC_PORT ?? '4173', 10) || 4173;
const entry = resolve(process.cwd(), 'server-dist/main.mjs');

const server = createServer({ pauseOnConnect: true });
const workers = [];
let nextWorker = 0;

server.on('connection', (socket) => {
  const worker = workers[nextWorker % workers.length];
  nextWorker += 1;
  if (worker) {
    worker.send({ type: 'connection' }, socket);
  } else {
    socket.destroy();
  }
});

function startWorker(id) {
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, KINFOLD_WORKER_ID: String(id) },
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  });
  child.on('message', () => {});
  const handle = () => {
    const index = workers.indexOf(child);
    if (index !== -1) workers.splice(index, 1);
    setTimeout(() => {
      workers.push(startWorker(id));
    }, 1000);
  };
  child.on('exit', handle);
  child.on('error', handle);
  workers.push(child);
  return child;
}

// The parent owns the one listening socket; both workers accept from it.
server.listen(port, '0.0.0.0', () => {
  console.log(`kinfold serving on port ${port} with two workers`);
  startWorker(1);
  startWorker(2);
});

process.on('SIGTERM', () => {
  for (const worker of workers) worker.kill('SIGTERM');
  server.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  for (const worker of workers) worker.kill('SIGINT');
  server.close(() => process.exit(0));
});
