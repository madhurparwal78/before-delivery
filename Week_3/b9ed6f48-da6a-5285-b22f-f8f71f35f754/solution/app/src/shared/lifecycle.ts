// The editorial lifecycle (brief: Business rules › Editorial lifecycle). The transition table is
// decided here; the studio API judges requests with it and the studio screen shows only the
// buttons it allows.

export const ITEM_STATUSES = ["draft", "review", "scheduled", "published", "withdrawn"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const STATUS_LABELS: Record<ItemStatus, string> = {
  draft: "Draft",
  review: "Review",
  scheduled: "Scheduled",
  published: "Published",
  withdrawn: "Withdrawn",
};

/**
 * Moves a person may request. Scheduling is the lead's alone (`judgeMover`);
 * `scheduled → published` belongs to the server and is absent.
 */
const TRANSITIONS: Record<ItemStatus, ItemStatus[]> = {
  draft: ["review"],
  review: ["draft", "scheduled"],
  scheduled: ["draft"],
  published: ["withdrawn"],
  withdrawn: ["draft"],
};

interface Curator {
  isOwner: boolean;
  isLead: boolean;
}

type RoleVerdict = "ok" | "lead_only" | "forbidden";

/** The role check, judged before the item's state: scheduling is the lead's alone. */
export function judgeMover(to: ItemStatus, curator: Curator): RoleVerdict {
  if (to === "scheduled" && !curator.isLead) return "lead_only";
  if (!curator.isOwner && !curator.isLead) return "forbidden";
  return "ok";
}

/** The state check, judged against the status at commit. */
export function isLegalMove(from: ItemStatus, to: ItemStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** The moves this curator may make from `from`, for the studio's buttons. */
export function movesFor(from: ItemStatus, curator: Curator): ItemStatus[] {
  return ITEM_STATUSES.filter((to) => isLegalMove(from, to) && judgeMover(to, curator) === "ok");
}
