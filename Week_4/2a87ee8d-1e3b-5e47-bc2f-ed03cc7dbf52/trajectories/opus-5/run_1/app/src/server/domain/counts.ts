import type { StoredCluster, StoredFrame, StoredNote } from './views.js';
import type { FrameCounts } from './views.js';

/**
 * The one place the board counts are computed. Every count is derived from the stored
 * notes and ledger, never kept as a separately edited number.
 */

/** A frame's `noteCount` counts its non-facilitator-only notes; `hiddenCount` those of them still unrevealed. */
export function frameCounts(frameId: string, notes: readonly StoredNote[]): FrameCounts {
  let noteCount = 0;
  let hiddenCount = 0;
  for (const note of notes) {
    if (note.frameId !== frameId || note.facilitatorOnly) continue;
    noteCount += 1;
    if (!note.revealed) hiddenCount += 1;
  }
  return { noteCount, hiddenCount };
}

/** A cluster's ordered note ids. Facilitator-only notes never join a cluster. */
export function clusterNoteIds(clusterId: string, notes: readonly StoredNote[]): string[] {
  return notes
    .filter((note) => note.clusterId === clusterId && !note.facilitatorOnly)
    .sort((a, b) => {
      const left = a.clusterIndex ?? 0;
      const right = b.clusterIndex ?? 0;
      if (left !== right) return left - right;
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
      return a.id < b.id ? -1 : 1;
    })
    .map((note) => note.id);
}

/** A participant's notes in non-trashed frames from the current round. */
export function notesThisRound(
  participantId: string,
  roundNumber: number,
  notes: readonly StoredNote[],
): number {
  return notes.filter(
    (note) => note.authorParticipantId === participantId && note.roundNumber === roundNumber,
  ).length;
}

export interface DotLedgerEntry {
  readonly clusterId: string;
  readonly participantId: string;
  readonly cancelled: boolean;
}

/** A cluster's `dotTotal` is its number of uncancelled spends. */
export function clusterDotTotal(clusterId: string, ledger: readonly DotLedgerEntry[]): number {
  return ledger.filter((entry) => entry.clusterId === clusterId && !entry.cancelled).length;
}

/** `myDots` is the same count restricted to one participant. */
export function clusterMyDots(
  clusterId: string,
  participantId: string | null,
  ledger: readonly DotLedgerEntry[],
): number {
  if (participantId === null) return 0;
  return ledger.filter(
    (entry) => entry.clusterId === clusterId && entry.participantId === participantId && !entry.cancelled,
  ).length;
}

/**
 * `dotsRemaining` is the budget minus the caller's uncancelled spends on every cluster,
 * including clusters inside a trashed frame.
 */
export function dotsRemaining(
  budget: number,
  participantId: string,
  ledger: readonly DotLedgerEntry[],
): number {
  const spent = ledger.filter((entry) => entry.participantId === participantId && !entry.cancelled).length;
  return budget - spent;
}

export interface RankableCluster {
  readonly cluster: StoredCluster;
  readonly frame: StoredFrame;
  readonly dotTotal: number;
}

/**
 * The one cluster ranking order used everywhere clusters are ranked: dot total highest
 * first, then the rail position of the cluster's frame, then cluster title alphabetically
 * ignoring case.
 */
export function rankClusters<T extends RankableCluster>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => {
    if (a.dotTotal !== b.dotTotal) return b.dotTotal - a.dotTotal;
    if (a.frame.position !== b.frame.position) return a.frame.position - b.frame.position;
    const left = a.cluster.title.toLocaleLowerCase();
    const right = b.cluster.title.toLocaleLowerCase();
    if (left !== right) return left < right ? -1 : 1;
    return a.cluster.id < b.cluster.id ? -1 : 1;
  });
}
