import { isDbUp } from "./identity.ts";
import { head, workingKey } from "./s3.ts";

type Probe = { at: number; dbUp: boolean; storageUp: boolean };

let lastProbe: Probe = { at: 0, dbUp: false, storageUp: true };
let inFlight: Promise<Probe> | null = null;

async function runProbe(): Promise<Probe> {
  const dbUp = await isDbUp();
  let storageUp = lastProbe.storageUp;
  try {
    const result = await head(workingKey("__probe__"));
    storageUp = !result.unavailable;
  } catch {
    storageUp = false;
  }
  lastProbe = { at: Date.now(), dbUp, storageUp };
  return lastProbe;
}

/** Health answers from a probe at most five seconds old. */
export async function latestStorageProbe(): Promise<{ dbUp: boolean; storageUp: boolean }> {
  const age = Date.now() - lastProbe.at;
  if (age < 5000 && lastProbe.at > 0) return lastProbe;
  if (inFlight !== null) return inFlight;
  inFlight = runProbe().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
