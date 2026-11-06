/** Boot: listen at once, then bring PostgreSQL, the providers and the background workers up on their own time. */
import { config } from './config.js';
import { connect, isReady } from './db.js';
import { HttpError, logError } from './errors.js';
import { startServer } from './http.js';
import { KillBillUnreachable, nextCallbackCheck, nextKillBillProbe, registerCallback, runKillBillProbe } from './killbill.js';
import { sendQueued } from './mail.js';
import { collectDue } from './payments.js';
import { sendUnsentDraws } from './refunds.js';
import { REGISTRY_PROBE_MS, runRegistryProbe } from './registry.js';
import { registerRoutes } from './routes.js';
import { expireHolds } from './rides.js';

registerRoutes();
startServer(config.port);
void connect();

/** A lost database or Kill Bill is already reported by its own health, and the next round picks the work up. */
function logUnlessProviderDown(error: unknown): void {
  if (!(error instanceof KillBillUnreachable) && !(error instanceof HttpError && error.status === 503)) logError(error);
}

/** One round after another: the next starts only once this one has ended, and no round runs without a database. */
function repeat(task: () => Promise<void>, nextDelayMs: (succeeded: boolean) => number): void {
  const round = async (): Promise<void> => {
    let succeeded = false;
    try {
      if (isReady()) {
        await task();
        succeeded = true;
      }
    } catch (error) {
      logUnlessProviderDown(error);
    }
    setTimeout(() => { void round(); }, nextDelayMs(succeeded)).unref();
  };
  void round();
}

const CLOCK_ROUND_MS = 500;

repeat(runKillBillProbe, nextKillBillProbe);
repeat(runRegistryProbe, () => REGISTRY_PROBE_MS);
repeat(registerCallback, nextCallbackCheck);
repeat(sendQueued, () => CLOCK_ROUND_MS);
repeat(expireHolds, () => CLOCK_ROUND_MS);
repeat(collectDue, () => CLOCK_ROUND_MS);
repeat(sendUnsentDraws, () => 2 * CLOCK_ROUND_MS);

process.stdout.write(`listening on ${config.port}\n`);
