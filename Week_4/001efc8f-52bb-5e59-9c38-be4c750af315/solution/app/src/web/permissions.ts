import { serverNow } from "./api";
import type { Message, Role } from "./types";

// What the signed-in person may do, as the browser shows it. The server decides every request;
// these only keep the menus to actions the person may take (brief: Roles).

const LEADS: Role[] = ["crew_lead", "dispatcher", "ops_manager"];

const correctsOthers = (role: Role) => LEADS.includes(role);
export const pins = (role: Role) => LEADS.includes(role);
export const schedules = (role: Role) => role === "dispatcher" || role === "ops_manager";
export const managesPeople = (role: Role) => role === "ops_manager";

// Edit is listed while the server-time estimate is before editable_until; the browser's own
// clock is never read (brief: Interactions, Edit in the menu).
export function mayEdit(me: { id: string; role: Role }, message: Message): boolean {
  if (message.author.id !== me.id && !correctsOthers(me.role)) return false;
  return serverNow() < Date.parse(message.editable_until);
}

export const mayDelete = (me: { id: string; role: Role }, message: Message) => message.author.id === me.id || correctsOthers(me.role);
export const maySeeReceipts = (me: { id: string; role: Role }, message: Message) => message.author.id === me.id || correctsOthers(me.role);
export const startsTopLevel = (role: Role, kind: "broadcast" | "crew") => kind === "crew" || role !== "field_technician";
