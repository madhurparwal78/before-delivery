import type { CommitResult } from "../shared/api.js";

export const EMPTY_ENTRY = "Type a time, D for DNF or R for rerun.";

const place = (result: CommitResult): string =>
  `P${result.entry.classPosition} in ${result.entry.classCode}, P${result.entry.position} overall`;

/** The sentence announced after a run is committed. */
export function commitSentence(result: CommitResult): string {
  const car = `Car ${result.entry.carNumber} ${result.entry.classCode}`;
  const { run } = result;
  if (run.outcome === "rerun") return `${car}: rerun granted for run ${run.runNumber}`;
  if (run.outcome === "dnf") return result.entry.position === null ? `${car}: DNF, no time yet` : `${car}: DNF, ${place(result)}`;
  return `${car}: indexed ${run.indexedTime}, ${place(result)}`;
}

/** The sentence announced after a correction is saved. */
export function correctionSentence(result: CommitResult): string {
  const car = `Car ${result.entry.carNumber} ${result.entry.classCode} run ${result.run.runNumber} corrected`;
  if (result.run.outcome === "dnf") {
    return result.entry.position === null ? `${car}: DNF, no time yet` : `${car}: DNF, ${place(result)}`;
  }
  return `${car}: indexed ${result.run.indexedTime}, ${place(result)}`;
}
