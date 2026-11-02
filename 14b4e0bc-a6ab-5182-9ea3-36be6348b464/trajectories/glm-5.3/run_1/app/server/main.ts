import 'dotenv/config';
import { createApp } from './app';

const PORT = Number(process.env.APP_PUBLIC_PORT ?? 4173);

async function main(): Promise<void> {
  const { app } = await createApp();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Strata serving on 0.0.0.0:${PORT}`);
  });
}

main().catch((err) => {
  console.error('failed to start', err);
  process.exit(1);
});
