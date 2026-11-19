// Role permission and row access: what a member may do and which rows they reach,
// decided here and nowhere else.
import type { Access, Stored, TableRec } from "./model.js";

// "own" actions are the Owner's alone; "write" actions are open to Owners and Editors.
export function may(access: Access, action: "own" | "write"): boolean {
  return action === "own" ? access.role === "owner" : access.role !== "viewer";
}

// A member shared with own-row scope reaches only their rows of a table with a row owner.
export function ownRowsOnly(access: Access, table: TableRec): boolean {
  return access.role !== "owner" && access.rowScope === "own" && table.ownerColumnId !== null;
}

// An owner cell names a member when it equals their email, ignoring case and surrounding spaces.
export function isOwnEmail(access: Access, stored: Stored | undefined): boolean {
  return typeof stored === "string" && stored.trim().toLowerCase() === access.email.toLowerCase();
}
