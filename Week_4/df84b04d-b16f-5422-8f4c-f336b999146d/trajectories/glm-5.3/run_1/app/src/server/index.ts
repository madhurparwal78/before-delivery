import { bootstrap } from './bootstrap.js';

async function main() {
  const { pool, config } = await bootstrap();
  const { startServer } = await import('./server.js');
  await startServer(pool, config);
}

main().catch((err) => {
  console.error('failed to start', err);
  process.exit(1);
});
