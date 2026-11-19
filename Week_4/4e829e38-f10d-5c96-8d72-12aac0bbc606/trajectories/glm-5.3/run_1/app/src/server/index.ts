import { start } from './server';

process.on('unhandledRejection', (err: unknown) => {
  console.error('unhandled', err instanceof Error ? err.message : err);
});

void start().catch((err: unknown) => {
  console.error('failed to start', err instanceof Error ? err.message : err);
  process.exit(1);
});
