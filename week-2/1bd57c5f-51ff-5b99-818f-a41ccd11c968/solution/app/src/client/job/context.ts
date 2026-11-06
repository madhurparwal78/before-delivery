import { createContext, useContext } from "react";
import type { Item, Job, Person, Role, User } from "../../shared/domain";
import type { JobSession } from "./session";

/** What the parts of an open job share: the session, the viewer, selection and placement. */
export interface JobControls {
  session: JobSession;
  job: Job;
  user: User;
  role: Role;
  online: boolean;
  readOnly: boolean;
  reduced: boolean;
  selectedId: string | null;
  select: (item: Item) => void;
  clearSelection: () => void;
  startPlacement: (item: Item, row: HTMLElement | null) => void;
  canPlace: (item: Item) => boolean;
}

export const JobContext = createContext<JobControls | null>(null);

export function useJob(): JobControls {
  const controls = useContext(JobContext);
  if (!controls) throw new Error("useJob outside an open job");
  return controls;
}

/**
 * Whether the viewer is the person a record names. Records carry a name and role, not an id, so
 * this only gates which controls show; the server decides by id.
 */
export function isMe(person: Person, user: User, role: Role): boolean {
  return person.name === user.name && person.role === role;
}

export function isTextField(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return true;
  if (!(target instanceof HTMLInputElement)) return target instanceof HTMLElement && target.isContentEditable;
  return !["button", "checkbox", "radio", "file", "submit", "reset", "range", "color"].includes(target.type);
}
