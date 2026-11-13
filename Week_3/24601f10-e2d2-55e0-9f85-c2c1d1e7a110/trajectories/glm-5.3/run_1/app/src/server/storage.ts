import { s3 } from "./s3.js";

let lastStorageCheck = 0;
let lastStorageResult = false;

/** Storage reachability is measured at most 5 seconds before the answer. */
export async function storageReachable(): Promise<boolean> {
  const now = Date.now();
  if (now - lastStorageCheck < 5000) return lastStorageResult;
  lastStorageCheck = now;
  lastStorageResult = await s3.ping();
  return lastStorageResult;
}
