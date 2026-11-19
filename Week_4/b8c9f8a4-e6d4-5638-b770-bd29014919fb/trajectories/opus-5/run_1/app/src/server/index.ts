import { config } from './config';
import { waitForDatabase } from './db';
import { applySchema } from './schema';
import { seedIfAbsent } from './seed';
import { startBackgroundPass } from './background';
import { buildApp } from './http/app';

const start = async (): Promise<void> => {
  await waitForDatabase();
  await applySchema();
  await seedIfAbsent();
  startBackgroundPass();

  const app = buildApp();
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`Open Bonnet is serving on port ${config.port}`);
  });
};

start().catch((error) => {
  console.error('The server could not start', error);
  process.exit(1);
});
