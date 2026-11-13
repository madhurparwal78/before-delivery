import type { ErrorCode } from "../../shared/errors";
import type { PostState } from "../../shared/reference";

export type PostSnapshot = {
  state: PostState;
  claimedBy: string | null;
  lapsedBy: string | null;
  decidedByName: string | null;
  claimedByName: string | null;
};

type Refusal = { code: ErrorCode; params: Record<string, string> };

function decidedRefusal(post: PostSnapshot): Refusal {
  return {
    code: "already_decided",
    params: { decision: post.state === "approved" ? "approved" : "rejected", name: post.decidedByName ?? "" },
  };
}

/** The moves a moderator may make on a post, decided in one place. Returns the refusal, or undefined when the move is allowed. */
export function moderationRefusal(move: "claim" | "renew" | "decide", post: PostSnapshot, actorId: string): Refusal | undefined {
  if (post.state === "approved" || post.state === "rejected") return decidedRefusal(post);
  if (post.state === "claimed") {
    if (post.claimedBy === actorId) return undefined;
    return { code: "already_claimed", params: { name: post.claimedByName ?? "" } };
  }
  if (move === "claim") return undefined;
  return { code: post.lapsedBy === actorId ? "claim_expired" : "not_claimed", params: {} };
}

/** The moves the author may make on a post. `withinWindow` is whether the edit window is still open. */
export function authorRefusal(move: "edit" | "delete", post: PostSnapshot, withinWindow: boolean): Refusal | undefined {
  if (post.state === "claimed") return { code: "in_review", params: {} };
  if (move === "edit" && (post.state === "rejected" || !withinWindow)) return { code: "edit_window_closed", params: {} };
  return undefined;
}
