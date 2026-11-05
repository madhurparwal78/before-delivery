import { ensureSchema } from './db/schema.js';
import { seed } from './db/seed.js';
import { rememberAccount, refreshPlanState } from './db/plan.js';
import { ensureBucket } from './services/s3.js';
import { ensureIndex } from './services/search.js';
import {
  authorAccountKey,
  ensureAccount,
  ensureAuthorSubscription,
  ensureCatalogue,
} from './services/killbill.js';
import { reindexAll } from './services/indexer.js';
import { activePlan } from './db/plan.js';

interface Step {
  readonly name: string;
  readonly run: () => Promise<void>;
}

/**
 * Schema creation, the Kill Bill catalogue, the author account, index settings
 * and the seed all retry until they succeed, so the server starts and recovers
 * with any provider unreachable.
 */
const STEPS: readonly Step[] = [
  { name: 'schema', run: ensureSchema },
  { name: 'bucket', run: ensureBucket },
  { name: 'search-index', run: ensureIndex },
  {
    name: 'billing',
    run: async () => {
      await ensureCatalogue();
      const accountId = await ensureAccount(authorAccountKey());
      const subscriptionId = await ensureAuthorSubscription(accountId);
      await rememberAccount(accountId, subscriptionId);
      await refreshPlanState();
    },
  },
  { name: 'seed', run: seed },
  { name: 'reindex', run: async () => reindexAll(await activePlan()) },
];

const RETRY_MS = 5_000;

export function startBootstrap(): void {
  const remaining = [...STEPS];
  const run = async (): Promise<void> => {
    while (remaining.length > 0) {
      const step = remaining[0];
      if (step === undefined) return;
      try {
        await step.run();
        remaining.shift();
      } catch (error) {
        process.stderr.write(`Bootstrap step ${step.name} will retry: ${String(error)}\n`);
        await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
      }
    }
  };
  void run();
}
