import { db } from "./db.js";
import { reconcileSvix } from "./deliveries.js";
import { enqueue, renderJob } from "./outbox.js";
import { syncIndex, touchMeili } from "./meili.js";
import { runBroker } from "./queue.js";
import { touchBucket } from "./s3.js";
import { providers } from "./status.js";
import { touchSvix } from "./svix.js";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function every(ms: number, work: () => Promise<void>): void {
  void (async () => {
    for (;;) {
      await work().catch(() => undefined);
      await sleep(ms);
    }
  })();
}

/** Each boot retries versions still pending or failed, once. */
async function retryPrints(): Promise<void> {
  const versions = (await db.query("UPDATE notice_versions SET print_state = 'pending' WHERE print_state IN ('pending', 'failed') RETURNING number, version")).rows;
  for (const v of versions) await enqueue(db, renderJob(v.number as string, v.version as number));
}

/** Contact with every provider at least every few seconds, whether or not anything is queued. */
export async function startBackground(): Promise<void> {
  void runBroker();
  every(4000, async () => {
    await Promise.allSettled([touchSvix(), touchMeili(), touchBucket().catch(() => {
      providers.storage = false;
    })]);
  });
  every(3000, reconcileSvix);
  every(6000, syncIndex);
  await retryPrints().catch(() => undefined);
}
