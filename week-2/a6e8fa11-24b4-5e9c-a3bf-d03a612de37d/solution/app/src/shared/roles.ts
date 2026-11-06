// Roles and season states, and which edits each role may make in each state (Business rules · Role
// table). The server enforces this table; the browser reads it only to show or disable controls.

export const ROLES = ["viewer", "technician", "lead", "data_manager"] as const;
export type Role = (typeof ROLES)[number];

export type SeasonState = "draft" | "in_season" | "locked" | "archived";

/** "cell" is setCell and setFormat; "structure" is the sheet and chart ops. */
export type EditKind = "cell" | "structure";

const EDITS: Record<EditKind, Record<Role, readonly SeasonState[]>> = {
  cell: { viewer: [], technician: ["in_season"], lead: ["draft", "in_season"], data_manager: ["draft", "in_season"] },
  structure: { viewer: [], technician: [], lead: ["draft", "in_season"], data_manager: ["draft", "in_season"] },
};

export function canEdit(role: Role, kind: EditKind, state: SeasonState): boolean {
  return EDITS[kind][role].includes(state);
}
