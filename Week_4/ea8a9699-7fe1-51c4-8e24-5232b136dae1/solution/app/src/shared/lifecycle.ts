// Cluster status edges (brief: Business rules > Cluster lifecycle). The one place they are decided.

export const STATUSES = ["draft", "in_review", "embargoed", "public", "withdrawn"] as const;
export type Status = (typeof STATUSES)[number];
const isStatus = (value: string): value is Status => (STATUSES as readonly string[]).includes(value);

/** Edges a client may request. embargoed → public is never requested: it holds from liftsAt (lift.ts). */
const REQUESTABLE: Record<Status, readonly Status[]> = {
  draft: ["in_review"],
  in_review: ["draft", "embargoed"],
  embargoed: ["in_review"],
  public: ["withdrawn"],
  withdrawn: [],
};

export const canRequest = (from: Status, to: string): to is Status => isStatus(to) && REQUESTABLE[from].includes(to);

/** Only the cluster owner or a design ops lead withdraws a public cluster. */
export const mayWithdraw = (role: string, isOwner: boolean): boolean => role === "ops_lead" || isOwner;

/** "Seated": an ops lead, or a designer holding a pro seat in the workspace. */
export const seated = (role: string, holdsSeat: boolean): boolean => role === "ops_lead" || holdsSeat;

/** Locked clusters refuse changes to entries, order, privacy flags and public description. */
export const isLocked = (status: Status): boolean => status === "embargoed" || status === "public" || status === "withdrawn";
