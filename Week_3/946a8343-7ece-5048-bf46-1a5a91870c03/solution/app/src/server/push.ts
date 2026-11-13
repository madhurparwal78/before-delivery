// "One push, every consequence" (DP-16): everything a branch update causes happens in the caller's transaction.
import type { Tx } from "./db.ts";
import type { BranchUpdate, PipelineOutcome } from "./repo/types.ts";
import { onBranchPushed as mergeRequestsOnPush } from "./mr/index.ts";
import { onBranchPushed as pipelinesOnPush } from "./ci/index.ts";
import { onBranchPushed as trainOnPush } from "./train/index.ts";
import { dispatchPushWebhook } from "./admin/index.ts";

export async function afterBranchUpdate(tx: Tx, update: BranchUpdate): Promise<PipelineOutcome> {
  if (update.source === "seed") return { created: false, reason: "Seeded commits start no pipeline." };
  await mergeRequestsOnPush(tx, update);
  const pipeline = await pipelinesOnPush(tx, update);
  await trainOnPush(tx, update);
  await dispatchPushWebhook(tx, update);
  return pipeline;
}
