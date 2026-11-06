import { createServer } from 'node:http';
import { config } from './config';
import { connectWhenReachable } from './db';
import { handleRequest } from './http';

// Listens at once; the API answers 503 until PostgreSQL has the schema and seed.
const server = createServer((req, res) => {
  void handleRequest(req, res);
});
server.listen(config.port, '0.0.0.0', () => {
  console.log(`Keel Outpost listening on 0.0.0.0:${config.port}`);
});
void connectWhenReachable();

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close();
    process.exit(0);
  });
}
