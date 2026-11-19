import type { Role } from "./types.js";

/** What each board role may do: the one table the server enforces and the client reads to show or hide controls. */
export type Action = "edit_pins" | "edit_board" | "manage_members" | "leave";

const ALLOWED: Record<Action, readonly Role[]> = {
  edit_pins: ["owner", "editor"],
  edit_board: ["owner"],
  manage_members: ["owner"],
  leave: ["editor", "viewer"],
};

export const can = (role: Role | null, action: Action): boolean => role !== null && ALLOWED[action].includes(role);

/** The member roles (never the owner, who is no member row) that may do `action`. */
export const memberRolesAllowing = (action: Action): readonly Role[] => ALLOWED[action].filter((role) => role !== "owner");

export const roleLabel = (role: "editor" | "viewer"): string => (role === "editor" ? "Editor" : "Viewer");
