import { startServer } from './server/main.js';

startServer().catch((err) => {
  console.error('failed to start', err);
  process.exit(1);
});
