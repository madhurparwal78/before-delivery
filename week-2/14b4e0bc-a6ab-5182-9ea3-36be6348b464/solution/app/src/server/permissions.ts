import type { Role } from "./text.ts";

/** Role permissions, decided in this one place (DP-02). */
export const may = {
  curate: (role: Role) => role === "Admin" || role === "Steward",
  administer: (role: Role) => role === "Admin",
  downloadEvidence: (role: Role) => role !== "Viewer",
} as const;

export type Permission = (role: Role) => boolean;
