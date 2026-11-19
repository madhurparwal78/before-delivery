// Boots the app server for a test run and waits until the schema is seeded and
// the seeded view photographs are confirmed, so the first assertions see the
// published seed state.
import { spawn } from 'node:child_process';

async function globalSetup(): Promise<() => Promise<void>> {
  const server = spawn('node', ['dist/server.js'], {
    cwd: process.cwd(),
    stdio: 'ignore',
    env: { ...process.env, APP_PUBLIC_PORT: process.env.APP_PUBLIC_PORT ?? '4173' },
  });
  const port = process.env.APP_PUBLIC_PORT ?? '4173';
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60000;
  for (;;) {
    try {
      const health = await fetch(`${base}/api/health`);
      if (health.status === 200) {
        // The unit read reports the seeded photograph state; wait until a
        // photographed unit says so.
        const unit = await fetch(`${base}/api/units/27C`);
        if (unit.status === 200) {
          const body = (await unit.json()) as { unit: { viewPhotographed: boolean } };
          if (body.unit.viewPhotographed) break;
        }
      }
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error('server did not become healthy');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return async () => {
    server.kill();
  };
}

export default globalSetup;
