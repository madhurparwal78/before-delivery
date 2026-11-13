import type { Role } from "./types";

const RANK: Record<Role, number> = { viewer: 1, contributor: 2, moderator: 3, owner: 4 };

const rank = (role: Role | null): number => (role ? RANK[role] : 0);

/** The stronger of two roles; a person never loses a role by joining again. */
export const strongest = (held: Role | null, offered: Role): Role => (held !== null && rank(held) >= rank(offered) ? held : offered);

export type Capability = "react" | "contribute" | "moderate" | "manage" | "editPost" | "changePost";

/**
 * The permission table, used by the server to refuse and by the interface to show only what a role may use.
 * `authorId` names the author of the post for the two post capabilities.
 */
export function may(capability: Capability, role: Role | null, userId: string | null, authorId?: string): boolean {
  const own = userId !== null && userId === authorId;
  switch (capability) {
    case "react":
      return rank(role) >= RANK.viewer;
    case "contribute":
      return rank(role) >= RANK.contributor;
    case "moderate":
      return rank(role) >= RANK.moderator;
    case "manage":
      return role === "owner";
    case "editPost":
      return role === "owner" || (rank(role) >= RANK.contributor && own);
    case "changePost":
      return rank(role) >= RANK.moderator || (rank(role) >= RANK.contributor && own);
  }
}
