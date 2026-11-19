import { createApp } from './app';
import { config } from './config';
import { applySchema } from './db';
import { ensureBucket } from './storage';

async function start(): Promise<void> {
  const app = createApp();
  app.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`jarful listening on ${config.port}\n`);
  });

  const applyUntilReady = async (): Promise<void> => {
    for (;;) {
      try {
        await applySchema();
        return;
      } catch (error) {
        process.stderr.write(`database not ready: ${String(error)}\n`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  };

  void applyUntilReady();
  void ensureBucket().catch(() => undefined);
}

void start();
