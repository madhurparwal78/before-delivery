import type { Role } from "../../shared/types.js";

export interface Actor {
  id: string;
  teamId: string;
  email: string;
  name: string;
  role: Role;
}

export type Permission =
  | "document.upload"
  | "document.manage"
  | "template.save"
  | "template.manage"
  | "template.use"
  | "team.manage";

export function can(actor: Actor, permission: Permission, document?: { ownerId: string }): boolean {
  switch (permission) {
    case "document.upload":
    case "template.use":
      return actor.role === "owner" || actor.role === "member";
    case "document.manage":
      return actor.role === "owner" || (actor.role === "member" && document?.ownerId === actor.id);
    case "template.save":
    case "template.manage":
    case "team.manage":
      return actor.role === "owner";
  }
}
