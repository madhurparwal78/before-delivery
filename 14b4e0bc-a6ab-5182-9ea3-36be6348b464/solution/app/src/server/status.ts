import { sendQueuedNotices } from "./notices.ts";
import { probeStore } from "./s3.ts";
import { probeRelay } from "./smtp.ts";

/** This instance's view of its dependencies, from probes every 5 seconds (DP-66). */
export const services = { evidence: "down" as "up" | "down", mail: "down" as "up" | "down" };

export function markEvidenceDown(): void {
  services.evidence = "down";
}

let sending = false;

/** The sender claims notices only while this instance reaches the relay. */
export async function deliverNotices(): Promise<void> {
  if (sending || services.mail !== "up") return;
  sending = true;
  try {
    await sendQueuedNotices();
  } catch (error) {
    console.error("notice delivery", error);
  } finally {
    sending = false;
  }
}

async function probe(): Promise<void> {
  const [evidence, mail] = await Promise.all([probeStore(), probeRelay()]);
  services.evidence = evidence ? "up" : "down";
  services.mail = mail ? "up" : "down";
  await deliverNotices();
}

export async function startProbes(): Promise<void> {
  await probe();
  setInterval(() => void probe(), 5_000).unref();
}
