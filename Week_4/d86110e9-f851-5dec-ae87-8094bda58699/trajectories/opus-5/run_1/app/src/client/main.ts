import { refreshSession, render, startRouter } from './router';

async function boot(): Promise<void> {
  await refreshSession();
  startRouter();
  await render();
}

void boot();
