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
import { queueIndexWork, reindexAll } from './services/indexer.js';
import { activePlan } from './db/plan.js';

interface Step {
  readonly name: string;
  readonly needs: readonly string[];
  readonly run: () => Promise<void>;
}

/**
 * Schema creation, the seed, the bucket, index settings, the Kill Bill catalogue
 * and the reindex each retry until they succeed. A step waits only for what it
 * truly needs, so one unreachable provider never holds back the rest: the seed
 * needs PostgreSQL alone and lands while Kill Bill is still coming up.
 */
const STEPS: readonly Step[] = [
  { name: 'schema', needs: [], run: ensureSchema },
  { name: 'seed', needs: ['schema'], run: seed },
  { name: 'bucket', needs: [], run: ensureBucket },
  { name: 'search-index', needs: [], run: ensureIndex },
  {
    name: 'billing',
    needs: ['schema'],
    run: async () => {
      await ensureCatalogue();
      const accountId = await ensureAccount(authorAccountKey());
      const subscriptionId = await ensureAuthorSubscription(accountId);
      await rememberAccount(accountId, subscriptionId);
      await refreshPlanState();
    },
  },
  {
    // Also waits for billing: the plan decides which models rank within it, and
    // reindexing on the unconfirmed default would index only the Free allowance.
    name: 'reindex',
    needs: ['seed', 'search-index', 'billing'],
    run: async () => reindexAll(await activePlan()),
  },
];

const RETRY_MS = 5_000;

export function startBootstrap(): void {
  const done = new Set<string>();
  const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });

  const start = async (step: Step): Promise<void> => {
    while (!step.needs.every((name) => done.has(name))) await wait(RETRY_MS / 10);
    for (;;) {
      try {
        await step.run();
        done.add(step.name);
        return;
      } catch (error) {
        process.stderr.write(`Bootstrap step ${step.name} will retry: ${String(error)}\n`);
        await wait(RETRY_MS);
      }
    }
  };

  for (const step of STEPS) void start(step);
}
