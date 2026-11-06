// Service status (brief: Services, Service status): every service probed at least every 5 seconds.
import { ensureReady, isReady, probeDatabase } from "./db.js";
import { probeRelay } from "./smtp.js";
import { probeStore } from "./s3.js";

type State = "up" | "down";
const PROBE_EVERY_MS = 2000;
const PROBE_TIMEOUT_MS = 2000;

let latest: { services: { database: State; imageStore: State; mailRelay: State }; checkedAt: string } = {
  services: { database: "down", imageStore: "down", mailRelay: "down" },
  checkedAt: new Date().toISOString(),
};

function within(probe: Promise<boolean>): Promise<boolean> {
  return Promise.race([probe, new Promise<boolean>((resolve) => setTimeout(() => resolve(false), PROBE_TIMEOUT_MS))]);
}

async function probeAll(): Promise<void> {
  const [database, imageStore, mailRelay] = await Promise.all([
    within(probeDatabase()),
    within(probeStore()),
    within(probeRelay()),
  ]);
  latest = {
    services: { database: database ? "up" : "down", imageStore: imageStore ? "up" : "down", mailRelay: mailRelay ? "up" : "down" },
    checkedAt: new Date().toISOString(),
  };
  if (database && !isReady()) await ensureReady().catch(() => undefined);
}

export function serviceStatus() {
  return latest;
}

export function startProbes(): void {
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    probeAll().finally(() => {
      running = false;
    });
  };
  tick();
  setInterval(tick, PROBE_EVERY_MS);
}
