import { nowIso } from "./clock.js";
import type { Queryable } from "./db.js";

type Job =
  | { jobId: string; kind: "render"; number: string; version: number }
  | { jobId: string; kind: "index"; skuCode: string }
  | { jobId: string; kind: "send"; eventId: string };

/** Work is written in the same transaction as the state change that needs it; the relay carries it to the queue. */
export async function enqueue(q: Queryable, job: Job): Promise<void> {
  await q.query("INSERT INTO outbox (job, created_at) VALUES ($1, $2)", [JSON.stringify(job), nowIso()]);
}

export const renderJob = (number: string, version: number): Job => ({ jobId: `render-${number}-v${version}`, kind: "render", number, version });
const indexJob = (skuCode: string): Job => ({ jobId: `index-${skuCode}`, kind: "index", skuCode });
export const sendJob = (eventId: string): Job => ({ jobId: eventId, kind: "send", eventId });

/** A change that search must pick up: bump the generation and ask for each SKU's document again. */
export async function searchChanged(q: Queryable, skuCodes: Iterable<string>): Promise<void> {
  await q.query("UPDATE meta SET value = (value::bigint + 1)::text WHERE key = 'search_gen'");
  for (const code of new Set(skuCodes)) await enqueue(q, indexJob(code));
}
