// Service status (brief: Services › Service status): each service probed with a 2-second timeout,
// the result reused for at most 5 seconds. This is this process's own view of what it can reach.
import type { ServiceStatus } from "../shared/api.js";
import { healthy as killbillAnswers } from "./killbill.js";
import { smtpAnswers } from "./mail.js";
import { bucketAnswers } from "./storage.js";

const PROBE_TIMEOUT_MS = 2000;
const REUSE_MS = 5000;

let last: { at: number; status: ServiceStatus } | null = null;
let probing: Promise<ServiceStatus> | null = null;

/** One probe, tried a second time before a service is reported down, so one slow answer is not an outage. */
async function answers(check: (timeoutMs: number) => Promise<boolean>): Promise<boolean> {
  return (await check(PROBE_TIMEOUT_MS)) || (await check(PROBE_TIMEOUT_MS));
}

async function probe(): Promise<ServiceStatus> {
  const [storage, billing, mail] = await Promise.all([
    answers(bucketAnswers),
    answers(killbillAnswers),
    answers(smtpAnswers),
  ]);
  return { storage: storage ? "up" : "down", billing: billing ? "up" : "down", mail: mail ? "up" : "down" };
}

export async function serviceStatus(): Promise<ServiceStatus> {
  if (last && Date.now() - last.at < REUSE_MS) return last.status;
  probing ??= probe().then((status) => {
    last = { at: Date.now(), status };
    probing = null;
    return status;
  });
  return probing;
}
