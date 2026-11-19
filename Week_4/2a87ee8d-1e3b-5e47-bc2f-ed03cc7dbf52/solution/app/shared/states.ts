// Workshop states, their labels and the only legal edges between them.

export const STATUSES = ["draft", "open", "silent_round", "revealed", "voting", "closed", "archived"] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  draft: "Draft",
  open: "Open",
  silent_round: "Silent round",
  revealed: "Revealed",
  voting: "Voting",
  closed: "Closed",
  archived: "Archived",
};

const EDGES: Record<Status, readonly Status[]> = {
  draft: ["open"],
  open: ["silent_round"],
  silent_round: ["revealed"],
  revealed: ["silent_round", "voting"],
  voting: ["closed"],
  closed: ["archived"],
  archived: [],
};

export function isLegalEdge(from: Status, to: Status): boolean {
  return EDGES[from].includes(to);
}

export function nextStatuses(from: Status): readonly Status[] {
  return EDGES[from];
}

/** States with a running deadline: the live dot and the timer show in them. */
export function isLive(status: Status): boolean {
  return status === "silent_round" || status === "voting";
}

/** States out of which every edge answers workshop_closed. */
export function isEnded(status: Status): boolean {
  return status === "closed" || status === "archived";
}

export function isStatus(value: unknown): value is Status {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

/**
 * The state a workshop was in before it entered `status`, read off the legal edges. Only `silent_round` has two
 * ways in: the first round comes from `open`, every later one from `revealed`. `rounds` counts the silent rounds
 * entered up to and including this move.
 */
export function enteredBefore(status: Status, rounds: number): { status: Status; rounds: number } {
  const from = STATUSES.filter((s) => EDGES[s].includes(status));
  if (status !== "silent_round") return { status: from[0] ?? status, rounds };
  return { status: rounds > 1 ? "revealed" : "open", rounds: rounds - 1 };
}
