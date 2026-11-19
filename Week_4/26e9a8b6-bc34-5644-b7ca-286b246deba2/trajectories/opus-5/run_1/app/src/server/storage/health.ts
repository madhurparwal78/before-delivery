import { storageAnswers } from './s3.js';

const REFRESH_MS = 2000;

let answering = true;
let checkedAt = 0;
let inFlight: Promise<void> | null = null;

function refresh(): Promise<void> {
  if (inFlight !== null) return inFlight;
  inFlight = storageAnswers()
    .then((result) => {
      answering = result;
      checkedAt = Date.now();
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/**
 * The last known storage state, refreshed in the background so a page render
 * never waits on a closed port.
 */
export function storageIsAnswering(): boolean {
  if (Date.now() - checkedAt > REFRESH_MS) void refresh();
  return answering;
}

export async function storageIsAnsweringNow(): Promise<boolean> {
  await refresh();
  return answering;
}
