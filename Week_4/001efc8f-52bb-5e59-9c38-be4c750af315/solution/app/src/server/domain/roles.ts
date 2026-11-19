export type Role = "dispatcher" | "field_technician" | "crew_lead" | "ops_manager";
export const ROLES: readonly Role[] = ["dispatcher", "field_technician", "crew_lead", "ops_manager"];

export type ChannelKind = "broadcast" | "crew";

// Crew leads, dispatchers and operations managers correct and remove anyone's messages and pin.
export function moderates(role: Role): boolean {
  return role !== "field_technician";
}

export function schedules(role: Role): boolean {
  return role === "dispatcher" || role === "ops_manager";
}

export function managesPeople(role: Role): boolean {
  return role === "ops_manager";
}

export function startsTopLevel(role: Role, kind: ChannelKind): boolean {
  return kind === "crew" || role !== "field_technician";
}
