import { databaseAnswers } from '../db.js';
import { ok, route, state } from '../http.js';
import { storageAnswers } from '../storage.js';
import { valkeyAnswers } from '../valkey.js';

const HEALTH_TIMEOUT_MS = 4000;

async function allServicesAnswer(): Promise<boolean> {
  if (!state.databaseReady) return false;
  const answers = await Promise.all([databaseAnswers(), storageAnswers(), valkeyAnswers()]);
  return answers.every(Boolean);
}

export function registerSystemRoutes(): void {
  route('GET', '/api/health', async () => {
    const healthy = await Promise.race([
      allServicesAnswer(),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), HEALTH_TIMEOUT_MS)),
    ]);
    return ok({ status: healthy ? 'ok' : 'unavailable' });
  });
}
