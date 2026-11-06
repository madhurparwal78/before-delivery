// Issue statuses and the only legal moves between them (brief: Status edges). Shared by the
// server, which enforces them, and the status picker, which offers them.

export const STATUSES = ["backlog", "todo", "in_progress", "in_review", "done", "cancelled"] as const;
export type IssueStatus = (typeof STATUSES)[number];

export const EDGES: Record<IssueStatus, readonly IssueStatus[]> = {
  backlog: ["todo", "cancelled"],
  todo: ["backlog", "in_progress", "cancelled"],
  in_progress: ["todo", "in_review", "cancelled"],
  in_review: ["in_progress", "done", "cancelled"],
  done: ["in_progress"],
  cancelled: ["backlog"],
};

export function isStatus(value: unknown): value is IssueStatus {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

export function isClosed(status: IssueStatus): boolean {
  return status === "done" || status === "cancelled";
}

export const STATUS_LABELS: Record<IssueStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
  cancelled: "Cancelled",
};
