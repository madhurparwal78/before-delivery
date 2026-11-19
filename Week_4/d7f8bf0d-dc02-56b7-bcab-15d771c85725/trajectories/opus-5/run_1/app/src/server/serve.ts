import { fork, type ChildProcess } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, INSTANCE_IDS, type InstanceId } from './config.js';
import { errors } from './errors.js';
import { ROUTE_HEADER } from './http.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTANCE_ENTRY = join(HERE, 'instance.js');

interface Child {
  id: InstanceId;
  process: ChildProcess | null;
  port: number;
  restartAfterMs: number;
}

const children = new Map<InstanceId, Child>(
  INSTANCE_IDS.map((id) => [id, { id, process: null, port: 0, restartAfterMs: 0 }]),
);

function spawn(child: Child): void {
  const process_ = fork(INSTANCE_ENTRY, [], {
    env: { ...process.env, GANDYBOARD_INSTANCE: child.id },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  child.process = process_;
  child.port = 0;

  process_.on('message', (message: unknown) => {
    const payload = message as { kind?: string; port?: number; restartAfterMs?: number };
    if (payload.kind === 'ready' && typeof payload.port === 'number') child.port = payload.port;
    if (payload.kind === 'stop') child.restartAfterMs = payload.restartAfterMs ?? 0;
  });

  process_.on('exit', () => {
    child.process = null;
    child.port = 0;
    const delay = child.restartAfterMs;
    child.restartAfterMs = 0;
    setTimeout(() => spawn(child), Math.max(delay, 100));
  });
}

function liveChildren(): Child[] {
  return [...children.values()].filter((child) => child.port > 0);
}

let nextIndex = 0;

function pick(routeHeader: string | undefined): Child | null {
  if (routeHeader) {
    const child = children.get(routeHeader as InstanceId);
    return child && child.port > 0 ? child : null;
  }
  const live = liveChildren();
  if (live.length === 0) return null;
  nextIndex = (nextIndex + 1) % live.length;
  return live[nextIndex];
}

/** The front router holds no product state: it only picks a live instance. */
const router = createServer((clientRequest, clientResponse) => {
  const routeHeader = clientRequest.headers[ROUTE_HEADER];
  const target = pick(typeof routeHeader === 'string' ? routeHeader : undefined);

  if (!target) {
    const error = errors.instancesRestarting();
    const payload = JSON.stringify(error.body());
    clientResponse.writeHead(503, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'Retry-After': '1',
    });
    clientResponse.end(payload);
    return;
  }

  const upstream = httpRequest(
    {
      host: '127.0.0.1',
      port: target.port,
      method: clientRequest.method,
      path: clientRequest.url,
      headers: clientRequest.headers,
    },
    (upstreamResponse) => {
      clientResponse.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(clientResponse);
    },
  );

  upstream.on('error', () => {
    if (clientResponse.headersSent) {
      clientResponse.end();
      return;
    }
    const error = errors.instancesRestarting();
    const payload = JSON.stringify(error.body());
    clientResponse.writeHead(503, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    });
    clientResponse.end(payload);
  });

  clientRequest.pipe(upstream);
});

for (const child of children.values()) spawn(child);

router.listen(config.publicPort, '0.0.0.0', () => {
  process.stdout.write(`Gandyboard listening on 0.0.0.0:${config.publicPort}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    for (const child of children.values()) child.process?.kill('SIGKILL');
    process.exit(0);
  });
}
