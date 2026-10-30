// The three state machines of the brief (note states, feature status, release status), decided only here.

export type NoteStatus = "unprocessed" | "snoozed" | "processed";
export type NoteAction = "processed" | "unprocessed" | "snooze";

const NOTE_EDGES: Record<NoteStatus, Partial<Record<NoteAction, NoteStatus>>> = {
  unprocessed: { processed: "processed", snooze: "snoozed" },
  processed: { unprocessed: "unprocessed" },
  snoozed: { snooze: "snoozed" },
};

/** The status a note reaches by `action`, or null when the edge is illegal. */
export function noteTransition(from: NoteStatus, action: NoteAction): NoteStatus | null {
  return NOTE_EDGES[from][action] ?? null;
}

export type FeatureStatus = "candidate" | "planned" | "in_progress" | "released" | "archived";
export type FeatureTarget = FeatureStatus | "restore";

export const FEATURE_STATUS_LABELS: Record<FeatureStatus, string> = {
  candidate: "Candidate",
  planned: "Planned",
  in_progress: "In progress",
  released: "Released",
  archived: "Archived",
};

const FEATURE_EDGES: Partial<Record<FeatureStatus, FeatureStatus[]>> = {
  candidate: ["planned"],
  planned: ["in_progress"],
};

/**
 * The status a feature reaches when asked to move to `to`, or null when the edge is illegal.
 * Archive is legal from every non-archived status; restore returns an archived feature to `prior`.
 */
export function featureTransition(from: FeatureStatus, to: FeatureTarget, prior: FeatureStatus | null): FeatureStatus | null {
  if (to === "restore") return from === "archived" ? prior : null;
  if (to === "archived") return from === "archived" ? null : "archived";
  return FEATURE_EDGES[from]?.includes(to) ? to : null;
}

/** The manual targets a feature in `from` may move to, in the order the detail screen offers them. */
export function featureTargets(from: FeatureStatus): FeatureTarget[] {
  const targets: FeatureTarget[] = ["planned", "in_progress", "archived", "restore"];
  return targets.filter((to) => featureTransition(from, to, "candidate") !== null);
}

export type ReleaseStatus = "open" | "frozen" | "shipped";
export type ReleaseAction = "freeze" | "ship";

const RELEASE_EDGES: Record<ReleaseStatus, Partial<Record<ReleaseAction, ReleaseStatus>>> = {
  open: { freeze: "frozen" },
  frozen: { ship: "shipped" },
  shipped: {},
};

export function releaseTransition(from: ReleaseStatus, action: ReleaseAction): ReleaseStatus | null {
  return RELEASE_EDGES[from][action] ?? null;
}

/** The statuses a feature may hold while it sits in a release; shipping turns exactly these into released. */
export const RELEASABLE: readonly FeatureStatus[] = ["planned", "in_progress"];

/** Features may join a release only while planned or in progress. */
export function canJoinRelease(status: FeatureStatus): boolean {
  return RELEASABLE.includes(status);
}

/** A shipped release is immutable: no edit, move, reorder, freeze or second ship. */
export function releaseIsLocked(status: ReleaseStatus): boolean {
  return status === "shipped";
}

/** What archiving does to a feature's release membership: leave an open release, refuse a frozen one, stay in shipped history. */
export function archiveEffect(release: ReleaseStatus): "leave" | "refuse" | "stay" {
  return release === "open" ? "leave" : release === "frozen" ? "refuse" : "stay";
}
