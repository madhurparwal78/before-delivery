import type { Audience } from "../live/events.js";

export const ADMIN: Audience = { roles: ["founder_admin"] };

export function grantAudience(holderId: string | null, includeBoard = false): Audience {
  const roles: Audience["roles"] = includeBoard ? ["founder_admin", "board_member"] : ["founder_admin"];
  return holderId === null ? { roles } : { persons: [holderId], roles };
}

export function personAudience(personId: string): Audience {
  return { persons: [personId] };
}

export const TENDER_AUDIENCE: Audience = { roles: ["founder_admin", "investor"] };
