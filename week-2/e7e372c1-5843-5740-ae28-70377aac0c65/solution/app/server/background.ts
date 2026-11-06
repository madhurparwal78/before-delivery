// Timers that keep the vault state, the seeded exhibits and the session closes current.

import { processPassedCloses } from "./closes.ts";
import { seedExhibits } from "./seed.ts";
import { probeVault, putObjectOnce } from "./vault.ts";

const PROBE_INTERVAL_MS = 2000;
const CLOSE_INTERVAL_MS = 1000;

let seedExhibitsWritten = false;

async function writeSeedExhibits(): Promise<void> {
  for (const exhibit of seedExhibits()) await putObjectOnce(exhibit.key, exhibit.bytes, "application/pdf");
  seedExhibitsWritten = true;
}

async function watchVault(): Promise<void> {
  if (await probeVault()) {
    if (!seedExhibitsWritten) await writeSeedExhibits();
  }
}

function every(milliseconds: number, work: () => Promise<void>): void {
  let busy = false;
  setInterval(() => {
    if (busy) return;
    busy = true;
    work()
      .catch(() => undefined)
      .finally(() => {
        busy = false;
      });
  }, milliseconds).unref();
}

export async function startBackground(): Promise<void> {
  await watchVault().catch(() => undefined);
  every(PROBE_INTERVAL_MS, watchVault);
  every(CLOSE_INTERVAL_MS, processPassedCloses);
}
